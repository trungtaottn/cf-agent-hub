import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {DurableMutations} from '../../packages/cli/src/durable-mutations';
import {ProtectedCredentialProvider} from '../../packages/cli/src/secret-store';
import {createNativeClient} from '../../packages/client/src/native-client';
import type {DispatchStamp} from '../../packages/cli/src/replay-clock';
const origin='https://hub.example.invalid',token='M'.repeat(43),proof='N'.repeat(43);
const runtime={id:'runtime_mutation',workspace_id:'ws',agent_id:'agent_mutation',runtime_version:1,label:'Synthetic',status:'online' as const,last_seen_at:'2026-10-27T00:00:00Z',presence_expires_at:'2026-10-27T00:01:30Z',created_at:'2026-10-27T00:00:00Z'};
const roots:string[]=[],closed:{close():void}[]=[];
const request={path:{runtime_instance_id:runtime.id},body:{expected_runtime_version:1}};
class Clock {now=10;epoch='synthetic-clock';sample(){return {clockEpochId:this.epoch,nowMonotonicMs:this.now,continuityVerified:true,suspendAwareElapsedVerified:true};}stamp(requestFingerprint:string):DispatchStamp{return {firstDispatchWallMs:100,firstDispatchMonotonicMs:this.now,clockEpochId:this.epoch,guaranteedRetentionMs:86400000,requestFingerprint};}}
async function fixture(){
 const root=mkdtempSync(join(dirname(process.cwd()),'cfhub-mutations-'));roots.push(root);const provider=new ProtectedCredentialProvider({directory:join(root,'secrets'),create:true});closed.push(provider);provider.importCredential(token);
 const bootstrap=createNativeClient({origin,workspaceId:'ws',credentialProvider:provider,fetch:async()=>Response.json({data:{runtime,runtime_token:proof,revealed:true},request_id:'fixture'},{status:201})});
 expect((await bootstrap.enrollRuntime({body:{label:'Synthetic'}},{idempotencyKey:'enroll',captureRuntime:c=>provider.captureRuntime(c)})).ok).toBe(true);
 const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({data:runtime,request_id:'fixture'})),clock=new Clock();
 const opts={origin,workspaceId:'ws',provider,journalDirectory:join(root,'journal'),journalProfile:'mcp-v1' as const,fetch,clock};const mutations=new DurableMutations({...opts,create:true});closed.push(mutations);return {root,provider,fetch,clock,mutations,opts};
}
afterEach(()=>{for(const obj of closed.splice(0))try{obj.close();}catch{}for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
describe('MCP durable explicit-key admission',()=>{
 it('snapshots the checked explicit key before protected acquisition yields',async()=>{
  const f=await fixture(),options={idempotencyKey:'original'};
  const pending=f.mutations.prepareOrReuse('heartbeatRuntime',request,options);options.idempotencyKey=token;
  const intent=await pending;expect(intent.key==='original').toBe(true);expect(intent.key===token).toBe(false);
  expect(await f.mutations.prepareOrReuse('heartbeatRuntime',request,{idempotencyKey:'original'})).toEqual(intent);expect(f.fetch).not.toHaveBeenCalled();
 });
 it('reuses exact original intent through unknown response and restart',async()=>{
  const f=await fixture(),a=await f.mutations.prepareOrReuse('heartbeatRuntime',request,{idempotencyKey:'same'});
  f.fetch.mockImplementationOnce(async()=>{throw Error('lost');});expect((await f.mutations.dispatch(a.id)).ok).toBe(false);f.mutations.close();
  const next=new DurableMutations(f.opts);closed.push(next);const b=await next.prepareOrReuse('heartbeatRuntime',request,{idempotencyKey:'same'});expect(b).toEqual(a);expect((await next.dispatch(b.id)).ok).toBe(true);expect(f.fetch).toHaveBeenCalledTimes(2);
 });
 it('does not revive expired first dispatch with another prepare',async()=>{
  const f=await fixture(),a=await f.mutations.prepareOrReuse('heartbeatRuntime',request,{idempotencyKey:'same'});f.fetch.mockImplementationOnce(async()=>{throw Error('lost');});await f.mutations.dispatch(a.id);f.clock.now+=86400000;
  const b=await f.mutations.prepareOrReuse('heartbeatRuntime',request,{idempotencyKey:'same'});expect(b.id).toBe(a.id);expect((await f.mutations.dispatch(b.id)).ok).toBe(false);expect(f.fetch).toHaveBeenCalledTimes(1);
 });
 it('settled repeat requires reconciliation and never fabricates a second success',async()=>{
  const f=await fixture(),a=await f.mutations.prepareOrReuse('heartbeatRuntime',request,{idempotencyKey:'same'});expect((await f.mutations.dispatch(a.id)).ok).toBe(true);const b=await f.mutations.prepareOrReuse('heartbeatRuntime',request,{idempotencyKey:'same'});expect(b.id).toBe(a.id);expect(await f.mutations.dispatch(b.id)).toMatchObject({ok:false,error:{code:'JOURNAL_RECONCILIATION_REQUIRED'}});expect(f.fetch).toHaveBeenCalledTimes(1);
 });
 it('same-key changed body and missing key reject before dispatch',async()=>{
  const f=await fixture();await f.mutations.prepareOrReuse('heartbeatRuntime',request,{idempotencyKey:'same'});await expect(f.mutations.prepareOrReuse('heartbeatRuntime',{...request,body:{expected_runtime_version:2}},{idempotencyKey:'same'})).rejects.toThrow();await expect(f.mutations.prepareOrReuse('heartbeatRuntime',request,{} as never)).rejects.toThrow();expect(f.fetch).not.toHaveBeenCalled();
 });
 it('revoked protected binding cannot obtain a retained handle',async()=>{
  const f=await fixture();await f.mutations.prepareOrReuse('heartbeatRuntime',request,{idempotencyKey:'same'});f.provider.rotateCredential('Q'.repeat(43));await expect(f.mutations.prepareOrReuse('heartbeatRuntime',request,{idempotencyKey:'same'})).rejects.toThrow();expect(f.fetch).not.toHaveBeenCalled();
 });
});

it('unresolved owner heartbeat blocks decision request before native send',async()=>{
 const f=await fixture(),heartbeat=await f.mutations.prepareOrReuse('heartbeatRuntime',request,{idempotencyKey:'heartbeat-unknown'});f.fetch.mockImplementationOnce(async()=>{throw Error('lost');});await f.mutations.dispatch(heartbeat.id);
 const input={path:{task_id:'task'},body:{expected_version:3,run_id:'run',fence:1,checkpoint:{summary:'Synthetic',artifact_ids:[]},proposal:{summary:'Synthetic',action:'synthetic.task-review',scope:{project_id:null,resource_ids:['task']},artifact_ids:[],inputs:{artifact_id:'artifact',sha256:'a'.repeat(64)}}}};
 const decision=await f.mutations.prepareOrReuse('requestTaskDecision',input,{idempotencyKey:'decision'});const result=await f.mutations.dispatch(decision.id);expect(result).toMatchObject({ok:false,error:{code:'NETWORK_ERROR'}});expect(f.fetch).toHaveBeenCalledTimes(1);
});
it('decision UNKNOWN keeps exact key and first-dispatch lifetime through restart',async()=>{
 const f=await fixture(),input={path:{task_id:'task'},body:{expected_version:3,run_id:'run',fence:1,checkpoint:{summary:'Original',artifact_ids:[]},proposal:{summary:'Synthetic',action:'synthetic.task-review',scope:{project_id:null,resource_ids:['task']},artifact_ids:[],inputs:{artifact_id:'artifact',sha256:'a'.repeat(64)}}}};
 const first=await f.mutations.prepareOrReuse('requestTaskDecision',input,{idempotencyKey:'exact-decision'});f.fetch.mockImplementationOnce(async()=>{throw Error('lost');});expect((await f.mutations.dispatch(first.id)).ok).toBe(false);f.mutations.close();
 const next=new DurableMutations(f.opts);closed.push(next);expect(await next.prepareOrReuse('requestTaskDecision',input,{idempotencyKey:'exact-decision'})).toEqual(first);await expect(next.prepareOrReuse('requestTaskDecision',{...input,body:{...input.body,fence:2}},{idempotencyKey:'exact-decision'})).rejects.toThrow();f.clock.now+=86400000;expect((await next.dispatch(first.id)).ok).toBe(false);expect(f.fetch).toHaveBeenCalledTimes(1);
});
