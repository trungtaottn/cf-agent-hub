import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import worker from '../../src/index';
import {decisionFixture,descriptor} from '../helpers/decision-policy';
import {admitted} from '../helpers/persisted-decision';
import {createDecisionCommands} from '../../src/approvals/commands-source';
import {executeCommand} from '../../src/workspace/commands';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {sha256} from '../../src/config/bootstrap';
const origin='https://hub.example.invalid',base=origin+'/v2/workspaces/ws_example/';
const body={expected_version:4,expected_proposal_version:1,expected_approval_version:1,reason:'Synthetic review'};
async function setup(name:string,settled=false){
 const f=await decisionFixture(name),token='A'.repeat(43),native='B'.repeat(42)+'A';
 await runInDurableObject(f.stub,async(_o,s)=>{const x=await admitted(s.storage,f.name);if(settled){const context={...x.humanContext,idempotencyKey:'human_http'},command=await createDecisionCommands([descriptor]).prepareApprovalDecision(context,'approval_a','approve',body);executeCommand({...x.execution,workspace:context.workspace,idempotencyKey:'human_http',fingerprint:await fingerprintRequest('POST','/v2/workspaces/ws_example/approvals/approval_a:approve',{},body)},context.identity,command,body);}s.storage.sql.exec("UPDATE sessions SET token_digest=? WHERE id='session_settings'",await sha256(token));s.storage.sql.exec("UPDATE native_credentials SET token_sha256=? WHERE credential_id='credential_research_1'",await sha256(native));});
 const configured={...env,DEPLOYMENT_CONFIG:JSON.stringify(f.raw.config)} as Env,cookie='cfhub_session='+token;
 const session=await worker.fetch(new Request(base+'auth/session',{headers:{cookie,origin}}),configured);expect(session.status).toBe(200);const data=await session.json() as {data:{csrf_token:string}};
 const send=(action='approve',headers:Record<string,string>={},value:unknown=body,path='approvals/approval_a:')=>worker.fetch(new Request(base+path+action,{method:'POST',headers:{origin,cookie,'content-type':'application/json','idempotency-key':'human_http','x-csrf-token':data.data.csrf_token,...headers},body:JSON.stringify(value)}),configured);
 const snapshot=()=>runInDurableObject(f.stub,(_o,s)=>Object.fromEntries(s.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name").toArray().map(({name})=>[name,s.storage.sql.exec('SELECT * FROM "'+name+'"').toArray()])));
 return {...f,configured,cookie,native,send,snapshot};
}
it('public human decision ingress requires actual session Origin CSRF and exact bounded schema',async()=>{
 const f=await setup('human_http_auth'),before=await f.snapshot();
 for(const [headers,status] of [[{cookie:''},401],[{'x-csrf-token':''},403],[{'x-csrf-token':'wrong'},403],[{origin:'https://foreign.example.invalid'},403]] as Array<[Record<string,string>,number]>)expect((await f.send('approve',headers)).status).toBe(status);
 expect((await f.send('approve',{}, {...body,unexpected:true})).status).toBe(400);
 expect((await f.send('approve',{authorization:'Bearer '+f.native})).status).toBe(400);
 expect((await f.send('approve',{'idempotency-key':''})).status).toBe(400);
 expect((await f.send('approve',{},body,'approvals/%ZZ:')).status).toBe(400);
 expect((await f.send('approve',{'content-type':'text/plain'})).status).toBe(400);
 expect((await f.send('approve',{}, {...body,reason:'x'.repeat(65537)})).status).toBe(413);
 expect(await f.snapshot()).toEqual(before);
});
it('actual native credential never authorizes human decision and empty production action stays unavailable',async()=>{
 const f=await setup('human_http_closed'),before=await f.snapshot();
 expect((await f.send('approve',{cookie:'',authorization:'Bearer '+f.native})).status).toBe(403);
 for(const action of ['approve','reject']){const response=await f.send(action);expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:{code:'DEPENDENCY_UNAVAILABLE'}});}
 expect((await f.send('approve',{},body,'approvals/missing:')).status).toBe(404);
 expect(await f.snapshot()).toEqual(before);
});
it('human decision preflight and methods stay closed at the public entry',async()=>{
 const f=await setup('human_http_preflight'),url=base+'approvals/approval_a:approve';
 const pre=(method:string,headers:string)=>worker.fetch(new Request(url,{method:'OPTIONS',headers:{origin,'access-control-request-method':method,'access-control-request-headers':headers}}),f.configured);
 expect((await pre('POST','content-type,idempotency-key,x-csrf-token')).status).toBe(204);
 expect((await pre('POST','authorization,x-runtime-token')).status).toBe(403);
 expect((await pre('GET','')).status).toBe(403);
 expect((await worker.fetch(new Request(url),f.configured)).status).toBe(404);
 expect((await worker.fetch(new Request(base+'approvals/approval_a:unknown',{method:'POST'}),f.configured)).status).toBe(404);
});

it('public retained human result replays original intent but current revocation and changed payload still deny',async()=>{
 const f=await setup('human_http_replay',true),before=await f.snapshot();
 const replay=await f.send();expect(replay.status).toBe(200);expect(await replay.json()).toMatchObject({data:{task:{state:'ready',task_version:5},approval:{status:'approved',approval_version:2},run:null}});
 expect((await f.send('approve',{}, {...body,reason:'changed intent'})).status).toBe(409);
 expect(await f.snapshot()).toEqual(before);
 await runInDurableObject(f.stub,(_o,s)=>s.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"tasks:read\"]' WHERE principal_id='human_operator'"));
 const revoked=await f.snapshot();expect((await f.send()).status).toBe(403);expect(await f.snapshot()).toEqual(revoked);
});
