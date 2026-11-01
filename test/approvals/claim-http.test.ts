import {it,expect,vi,afterEach} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import worker from '../../src/index';
import {ingressFixture,ingressReady} from '../helpers/task-ingress';
import {decisionFixture,descriptor,syntheticPolicy} from '../helpers/decision-policy';
import {admitted} from '../helpers/persisted-decision';
import {createDecisionCommands} from '../../src/approvals/commands-source';
import {createTaskClaimCommands} from '../../src/tasks/claim-source';
import {executeCommand} from '../../src/workspace/commands';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {hashRuntimeProof} from '../../src/auth/runtime-proof';
import {claimContext} from '../helpers/claims';
import {login} from '../helpers/auth';
afterEach(()=>vi.restoreAllMocks());
const origin='https://hub.example.invalid',base=origin+'/v2/workspaces/ws_example/',native='D'.repeat(42)+'A';
function snapshot(s:DurableObjectStorage){return Object.fromEntries(['tasks','runs','approvals','decision_checkpoints','decision_proposals','decision_artifact_edges','decision_notice_intents','decision_lifecycle_heads','decision_lifecycle_transitions','task_results','task_acceptances','events','task_history','idempotency_outcomes'].map(t=>[t,s.sql.exec('SELECT * FROM '+t+' ORDER BY rowid').toArray()]));}
/** Signed synthetic bootstrap and actual public runtime enrollment. Private source
 * admission/approval/consumption is setup only, never production action activation. */
async function boundFixture(name:string,consumed=false,shortLifetime=false){
 const f=await decisionFixture(name,shortLifetime?{...syntheticPolicy,expiry_seconds:3}:syntheticPolicy,2,true,true,native),configured={...env,DEPLOYMENT_CONFIG:JSON.stringify(f.raw.config)} as Env;
 const req=(path:string,body:unknown,key:string,proof?:string)=>new Request(base+path,{method:'POST',headers:{authorization:'Bearer '+native,'content-type':'application/json','idempotency-key':key,...(proof?{'x-runtime-token':proof}:{})},body:JSON.stringify(body)});
 const send=(path:string,body:unknown,key:string,proof?:string)=>worker.fetch(req(path,body,key,proof),configured);
 const setup=await runInDurableObject(f.stub,async(object,s)=>{
  const x=await admitted(s.storage,f.name),approved={expected_version:4,expected_approval_version:1,expected_proposal_version:1,reason:'Synthetic exact intent review'},a=await createDecisionCommands([descriptor]).prepareApprovalDecision({...x.humanContext,idempotencyKey:'approve'},'approval_a','approve',approved);
  executeCommand({...x.execution,workspace:x.humanContext.workspace,idempotencyKey:'approve',fingerprint:await fingerprintRequest('POST','/approve',{},approved)},x.humanContext.identity,a,approved);
  const response=await object.fetch(req('runtimes',{label:'Fresh synthetic ingress runtime'},'fresh_runtime'));expect(response.status).toBe(201);
  const {data}=await response.json() as {data:{runtime:{id:string};runtime_token:string}},body={expected_version:5,runtime_instance_id:data.runtime.id};
  if(consumed){const context={...x.ctx,workspace:{...x.ctx.workspace,clock:{nowMs:()=>Date.now()}},idempotencyKey:'claim_http'},command=await createTaskClaimCommands([descriptor]).prepareClaimTaskCommand(context,'task_a','run_http',await hashRuntimeProof(data.runtime_token),body);executeCommand({...await claimContext(s.storage,f.name,body,'claim_http',Date.now()),workspace:context.workspace},x.identity,command,body);}
  return {body,runtimeId:data.runtime.id,proof:data.runtime_token,expiresAt:s.storage.sql.exec<{expires_at:number}>('SELECT expires_at FROM approvals').one().expires_at};
 });
 const humanSend=async(path:string,body:unknown,key:string)=>{
  const session=await login(f.stub);expect(session.response.status).toBe(302);await session.response.text();
  const response=await worker.fetch(new Request(base+'auth/session',{headers:{cookie:session.cookie,origin}}),configured);expect(response.status).toBe(200);const {data}=await response.json() as {data:{csrf_token:string}};
  return worker.fetch(new Request(base+path,{method:'POST',headers:{cookie:session.cookie,origin,'x-csrf-token':data.csrf_token,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)}),configured);
 };
 return {...f,...setup,configured,req,send,humanSend,snapshot:()=>runInDurableObject(f.stub,(_o,s)=>snapshot(s.storage))};
}
it('actual DO claim captures the original runtime proof before body/auth/fingerprint awaits',async()=>{
 const f=await ingressFixture('claim_http_proof_capture'),v=await ingressReady(f),body={expected_version:2,runtime_instance_id:v.runtimeId};
 await runInDurableObject(f.stub,async(object,_s)=>{
  const request=f.req('tasks/'+v.taskId+':claim','POST',body,'claim',v.proof),digest=crypto.subtle.digest.bind(crypto.subtle);let raced=0;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,input)=>{const value=await digest(algorithm,input);if(new TextDecoder().decode(input).includes('/tasks/'+v.taskId+':claim')){raced++;request.headers.set('x-runtime-token','B'.repeat(42)+'A');}return value;});
  try{const response=await object.fetch(request);expect(raced).toBe(1);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({data:{task:{state:'doing'},run:{runtime_instance_id:v.runtimeId}}});}finally{spy.mockRestore();}
 });
});
it('public Worker and DO preserve ordinary R2 claim replay conflict and current revoked proof denial',async()=>{
 const f=await ingressFixture('claim_http_ordinary'),v=await ingressReady(f),body={expected_version:2,runtime_instance_id:v.runtimeId},send=(b=body)=>f.send('tasks/'+v.taskId+':claim','POST',b,'claim',v.proof);
 const first=await send();expect(first.status).toBe(200);const original=await first.json();const replay=await send();expect(replay.status).toBe(200);expect(await replay.json()).toMatchObject({data:(original as {data:unknown}).data});expect((await send({...body,expected_version:3})).status).toBe(409);
 await runInDurableObject(f.stub,(_o,s)=>s.storage.sql.exec('UPDATE runtimes SET revoked_at=? WHERE id=?',Date.now(),v.runtimeId));const before=await runInDurableObject(f.stub,(_o,s)=>snapshot(s.storage));expect((await send()).status).toBe(401);expect(await runInDurableObject(f.stub,(_o,s)=>snapshot(s.storage))).toEqual(before);
});
it('public fresh bound claim keeps the empty production registry closed with no domain effects',async()=>{
 const f=await boundFixture('claim_http_empty'),before=await f.snapshot(),response=await f.send('tasks/task_a:claim',f.body,'claim_http',f.proof);expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:{code:'DEPENDENCY_UNAVAILABLE'}});expect(await f.snapshot()).toEqual(before);
});
it('public retained approved claim is historical only and changed runtime payload conflicts canonically',async()=>{
 const f=await boundFixture('claim_http_retained',true),before=await f.snapshot(),response=await f.send('tasks/task_a:claim',f.body,'claim_http',f.proof);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({data:{task:{state:'doing',task_version:6},run:{id:'run_http',fence:2},approval:{status:'approved',approval_version:2}}});
 const conflict=await f.send('tasks/task_a:claim',{...f.body,runtime_instance_id:'missing_runtime'},'claim_http',f.proof);expect(conflict.status).toBe(409);expect(await conflict.json()).toMatchObject({error:{code:'IDEMPOTENCY_CONFLICT'}});expect(await f.snapshot()).toEqual(before);
 await runInDurableObject(f.stub,(_o,s)=>s.storage.sql.exec("UPDATE native_credentials SET revoked_at=? WHERE credential_id='credential_research_1'",Date.now()));const revoked=await f.snapshot();expect((await f.send('tasks/task_a:claim',f.body,'claim_http',f.proof)).status).toBe(401);expect(await f.snapshot()).toEqual(revoked);
});
it('public consumed heartbeat and failure use existing owners without minting reusable authority',async()=>{
 const f=await boundFixture('claim_http_settlement',true);expect((await f.send('runs/run_http:heartbeat',{expected_run_version:1,fence:2},'heartbeat',f.proof)).status).toBe(200);
 const response=await f.send('tasks/task_a:fail',{expected_version:6,run_id:'run_http',fence:2,outcome_unknown:false,reason:'Synthetic failure'},'fail',f.proof);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({data:{task:{state:'waiting',task_version:7,flags:['outcome_unknown']},approval:null}});
 const cancelled=await f.humanSend('tasks/task_a:cancel',{expected_version:7,reason:'Close uncertain attempt'},'cancel');expect(cancelled.status).toBe(200);
 await runInDurableObject(f.stub,(_o,s)=>{expect(s.storage.sql.exec('SELECT status,consumed_run_id,consumed_fence FROM approvals').one()).toEqual({status:'invalidated',consumed_run_id:'run_http',consumed_fence:2});expect(s.storage.sql.exec('SELECT task_state,task_version FROM decision_lifecycle_heads').one()).toEqual({task_state:'cancelled',task_version:8});});
});
it('public already-consumed result can settle after approval TTL and only independent acceptance completes it',async()=>{
 const f=await boundFixture('claim_http_result_after_ttl',true,true);await scheduler.wait(Math.max(0,f.expiresAt-Date.now()+10));
 const response=await f.send('tasks/task_a:submit-result',{expected_version:6,run_id:'run_http',fence:2,result:{summary:'Authentic settled result',artifact_ids:[]}},'submit',f.proof);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({data:{task:{state:'review',task_version:7},approval:null}});
 const accepted=await f.humanSend('tasks/task_a:accept-result',{expected_version:7,reason:'Independent result review'},'accept');expect(accepted.status).toBe(200);expect(await accepted.json()).toMatchObject({data:{task:{state:'done',task_version:8},approval:null}});
 await runInDurableObject(f.stub,(_o,s)=>expect(s.storage.sql.exec('SELECT status,approval_version,consumed_run_id FROM approvals').one()).toEqual({status:'approved',approval_version:2,consumed_run_id:'run_http'}));
});
it.each(['scope','runtime','maintenance'] as const)('actual DO claim rechecks current %s after runtime-proof await',async change=>{
 const f=await ingressFixture('claim_http_await_'+change),v=await ingressReady(f),body={expected_version:2,runtime_instance_id:v.runtimeId};
 await runInDurableObject(f.stub,async(object,s)=>{
  const before=snapshot(s.storage),digest=crypto.subtle.digest.bind(crypto.subtle);let raced=0;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,input)=>{const value=await digest(algorithm,input);if(new TextDecoder().decode(input)===v.proof){raced++;if(change==='scope')s.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"tasks:read\"]' WHERE credential_id='credential_research_1'");if(change==='runtime')s.storage.sql.exec('UPDATE runtimes SET revoked_at=? WHERE id=?',Date.now(),v.runtimeId);if(change==='maintenance')s.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1');}return value;});
  try{const response=await object.fetch(f.req('tasks/'+v.taskId+':claim','POST',body,'claim',v.proof));expect(raced).toBe(1);expect(response.status).toBe(change==='scope'?403:401);expect(snapshot(s.storage)).toEqual(before);}finally{spy.mockRestore();}
 });
});
