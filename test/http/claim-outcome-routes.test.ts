import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import worker from '../../src/index';
import {decisionFixture,claimSetup} from '../helpers/decision-policy';
import {claimContext,PROOF_A} from '../helpers/claims';
import {claimTaskCommand} from '../../src/tasks/claim';
import {executeCommand} from '../../src/workspace/commands';
import {sha256} from '../../src/config/bootstrap';
const token='B'.repeat(42)+'A',proof='C'.repeat(42)+'A',base='https://hub.example.invalid/v2/workspaces/ws_example/tasks/task_a';
const body={expected_version:2,runtime_instance_id:'runtime_a'};
function request(options:{suffix?:string;headers?:Record<string,string>;body?:string;method?:string}={}){
 return new Request(base+(options.suffix??':claim-outcome'),{method:options.method??'POST',headers:{authorization:'Bearer '+token,'x-runtime-token':proof,'content-type':'application/json','idempotency-key':'original',...options.headers},body:options.method==='GET'?undefined:options.body??JSON.stringify(body)});
}
function snapshot(storage:DurableObjectStorage){return Object.fromEntries(storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name").toArray().map(({name})=>[name,storage.sql.exec('SELECT * FROM "'+name+'"').toArray()]));}
async function setup(name:string,claim=true){
 const f=await decisionFixture(name,null,2,false,false,token);
 const original=await runInDurableObject(f.stub,async(_o,state)=>{
  const c=claimSetup(state.storage),ctx=await claimContext(state.storage,f.name,c.body,'original',c.now);
  const result=claim?executeCommand(ctx,c.identity,claimTaskCommand('task_a','run_original',PROOF_A),c.body):null;
  state.storage.sql.exec("UPDATE runtimes SET proof_sha256=? WHERE id='runtime_a'",await sha256(proof));
  return result;
 });
 return {...f,original,configured:{...env,DEPLOYMENT_CONFIG:JSON.stringify(f.raw.config)} as Env};
}
it('public_claim_lookup_returns_original_domain_data_with_fresh_correlation_and_no_effects',async()=>{
 const f=await setup('lookup-http-original'),before=await runInDurableObject(f.stub,(_o,s)=>snapshot(s.storage));
 const response=await worker.fetch(request(),f.configured);expect(response.status).toBe(200);
 const value=await response.json() as {data:unknown;request_id:string};expect(value.data).toEqual(f.original!.data);expect(value.request_id).not.toBe('request_original');expect(value.request_id).toMatch(/^[a-f0-9-]{36}$/);
 expect(await runInDurableObject(f.stub,(_o,s)=>snapshot(s.storage))).toEqual(before);
});
it('public_claim_lookup_missing_does_not_apply_ready_claim',async()=>{
 const f=await setup('lookup-http-missing',false),before=await runInDurableObject(f.stub,(_o,s)=>snapshot(s.storage));
 const response=await worker.fetch(request(),f.configured);expect(response.status).toBe(404);expect(await response.json()).toMatchObject({error:{code:'NOT_FOUND'}});
 expect(await runInDurableObject(f.stub,(_o,s)=>snapshot(s.storage))).toEqual(before);
});
for(const [name,options,status,code] of [
 ['key',{headers:{'idempotency-key':'invalid key'}},400,'INVALID_REQUEST'],
 ['query',{suffix:':claim-outcome?unexpected=1'},400,'INVALID_REQUEST'],
 ['extra',{body:JSON.stringify({...body,execute:true})},400,'INVALID_REQUEST'],
 ['cookie',{headers:{cookie:'cfhub_session='+'A'.repeat(43)}},400,'INVALID_REQUEST'],
 ['csrf',{headers:{'x-csrf-token':'synthetic'}},400,'INVALID_REQUEST'],
 ['admission',{headers:{'x-creation-admission':'event_'+'a'.repeat(48)}},400,'INVALID_REQUEST'],
 ['proof',{headers:{'x-runtime-token':'D'.repeat(42)+'A'}},401,'UNAUTHENTICATED'],
 ['bearer',{headers:{authorization:'Bearer '+'D'.repeat(42)+'A'}},401,'UNAUTHENTICATED'],
 ['origin',{headers:{origin:'https://foreign.invalid'}},403,'FORBIDDEN'],
 ['method',{method:'GET'},404,'NOT_FOUND'],
 ['oversize',{body:JSON.stringify({...body,padding:'x'.repeat(65536)})},413,'LIMIT_EXCEEDED'],
] as const)it('public_claim_lookup_rejects_'+name+'_without_effects',async()=>{
 const f=await setup('lookup-http-'+name),before=await runInDurableObject(f.stub,(_o,s)=>snapshot(s.storage));
 const response=await worker.fetch(request(options),f.configured);expect(response.status).toBe(status);expect(await response.json()).toMatchObject({error:{code}});
 expect(await runInDurableObject(f.stub,(_o,s)=>snapshot(s.storage))).toEqual(before);
});
import {claimOutcomeRoutes} from '../../src/http/claim-outcome-routes';
import {owned} from '../helpers/settings';
for(const change of ['credential','scope','generation'] as const)it('lookup_current_'+change+'_changed_during_body_await_denies_without_effects',async()=>{
 const f=await setup('lookup-http-await-'+change);
 await runInDurableObject(f.stub,async(_o,state)=>{
  let controller!:ReadableStreamDefaultController<Uint8Array>;
  const stream=new ReadableStream<Uint8Array>({start(value){controller=value;}}),ordinary=request();
  const pending=claimOutcomeRoutes(new Request(ordinary.url,{method:'POST',headers:ordinary.headers,body:stream}),owned(state.storage,f.name));
  if(change==='credential')state.storage.sql.exec("UPDATE native_credentials SET revoked_at=1 WHERE credential_id='credential_research_1'");
  if(change==='scope')state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"tasks:claim\",\"runtimes:manage\"]' WHERE credential_id='credential_research_1'");
  if(change==='generation')state.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1 WHERE id=1');
  const before=snapshot(state.storage);controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));controller.close();
  const response=await pending;expect(response.status).toBe(change==='scope'?403:401);expect(await response.json()).toMatchObject({error:{code:change==='scope'?'FORBIDDEN':'UNAUTHENTICATED'}});expect(snapshot(state.storage)).toEqual(before);
 });
});
