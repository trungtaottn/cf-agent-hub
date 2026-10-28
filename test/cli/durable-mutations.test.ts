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
 const opts={origin,workspaceId:'ws',provider,journalDirectory:join(root,'journal'),fetch,clock};const mutations=new DurableMutations({...opts,create:true});closed.push(mutations);return {root,provider,fetch,clock,mutations,opts};
}
afterEach(()=>{for(const obj of closed.splice(0))try{obj.close();}catch{}for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
describe('durable native mutation coordinator',()=>{
 it('records interactive keyless intent before generated attachment then dispatches exact stored body/key',async()=>{
  const f=await fixture(),intent=await f.mutations.prepare('heartbeatRuntime',request,{interactive:true});expect(intent.key).toBeTruthy();expect(f.fetch).not.toHaveBeenCalled();
  const result=await f.mutations.dispatch(intent.id);expect(result).toMatchObject({ok:true,data:runtime});expect(f.fetch).toHaveBeenCalledTimes(1);const [url,init]=f.fetch.mock.calls[0]!;expect(url).toBe(origin+'/v2/workspaces/ws/runtimes/runtime_mutation:heartbeat');expect(init!.body).toBe('{"expected_runtime_version":1}');expect(new Headers(init!.headers).get('idempotency-key')).toBe(intent.key);expect(new Headers(init!.headers).get('x-runtime-token')).toBe(proof);
  const bytes=readFileSync(join(f.root,'journal/journal.sqlite')).toString('utf8');expect(bytes).not.toContain(proof);expect(bytes).not.toContain(token);expect(JSON.stringify(result)).not.toContain(proof);
 });
 it('noninteractive omission and known secret bodies are rejected before any fetch',async()=>{
  const f=await fixture();await expect(f.mutations.prepare('heartbeatRuntime',request)).rejects.toThrow('CLI_INTENT_REJECTED');await expect(f.mutations.prepare('createTask',{body:{title:'Synthetic',description:proof}},{idempotencyKey:'body'})).rejects.toThrow('CLI_INTENT_REJECTED');expect(f.fetch).not.toHaveBeenCalled();
 });
 it('preserves unknown response identity, reopens and replays only within a proven original clock epoch',async()=>{
  const f=await fixture();const intent=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'original'});f.fetch.mockImplementationOnce(async()=>{throw Error('synthetic lost response');});expect(await f.mutations.dispatch(intent.id)).toMatchObject({ok:false});f.mutations.close();
  const reopened=new DurableMutations(f.opts);closed.push(reopened);expect(await reopened.dispatch(intent.id)).toMatchObject({ok:true});expect(f.fetch).toHaveBeenCalledTimes(2);expect(f.fetch.mock.calls.map(([,init])=>new Headers(init!.headers).get('idempotency-key'))).toEqual(['original','original']);
 });
 it('changed epoch or expired horizon preserves unresolved intent without a second fetch',async()=>{
  for(const kind of ['epoch','deadline']){const f=await fixture();const intent=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'original'});f.fetch.mockImplementationOnce(async()=>{throw Error('lost');});await f.mutations.dispatch(intent.id);if(kind==='epoch')f.clock.epoch='restarted';else f.clock.now+=86400000;
   expect(await f.mutations.dispatch(intent.id)).toMatchObject({ok:false});expect(f.fetch).toHaveBeenCalledTimes(1);expect((await f.mutations.inspect(intent.id))?.replayState).toBe('reconciliation-required');
  }
 });
 it('same-agent credential rotation never silently rebinds stored journal intent',async()=>{
  const f=await fixture();const intent=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'original'});f.provider.rotateCredential('Q'.repeat(43));expect(await f.mutations.dispatch(intent.id)).toMatchObject({ok:false});expect(f.fetch).not.toHaveBeenCalled();
 });
 it('does not repeat a settled command or automatically enroll to recover authority',async()=>{
  const f=await fixture();const intent=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'original'});await f.mutations.dispatch(intent.id);expect(await f.mutations.dispatch(intent.id)).toMatchObject({ok:false});expect(f.fetch).toHaveBeenCalledTimes(1);
 });
});
it('samples trusted final clock after the last provider currentness read',async()=>{
 const f=await fixture(),intent=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'final-clock'});
 const original=f.provider.dispatchRuntimeProof.bind(f.provider);let afterProof=false;
 f.provider.dispatchRuntimeProof=((binding,lease,send)=>original(binding,lease,value=>{afterProof=true;return send(value);})) as typeof f.provider.dispatchRuntimeProof;
 const validate=f.provider.assertLeaseBinding.bind(f.provider);let checks=0;
 f.provider.assertLeaseBinding=(binding,lease)=>{validate(binding,lease);if(afterProof&&++checks>=2)f.clock.now+=86400000;};
 expect((await f.mutations.dispatch(intent.id)).ok).toBe(false);expect(f.fetch).not.toHaveBeenCalled();
});
it('durably records an unbound enrollment before key generation and never repeats consumed attempt',async()=>{
 const root=mkdtempSync(join(dirname(process.cwd()),'cfhub-enrollment-'));roots.push(root);const provider=new ProtectedCredentialProvider({directory:join(root,'secrets'),create:true});closed.push(provider);provider.importCredential(token);
 const fetch=vi.fn(async()=>Response.json({data:{runtime,runtime_token:proof,revealed:true},request_id:'synthetic'},{status:201}));const coordinator=new DurableMutations({origin,workspaceId:'ws',provider,journalDirectory:join(root,'journal'),create:true,fetch});closed.push(coordinator);
 const handle=await coordinator.prepareEnrollment({body:{label:'Synthetic'}},{interactive:true});expect(handle.key).toBeTruthy();expect(fetch).not.toHaveBeenCalled();expect(provider.getEnrollmentAttempt(handle.id).principalId).toBeNull();
 const result=await coordinator.dispatchEnrollment(handle.id);expect(result).toMatchObject({ok:true,data:runtime});expect(JSON.stringify(result)).not.toContain(proof);expect(provider.getEnrollmentAttempt(handle.id).consumed).toBe(true);expect(provider.binding()?.principalId).toBe(runtime.agent_id);
 expect((await coordinator.dispatchEnrollment(handle.id)).ok).toBe(false);expect(fetch).toHaveBeenCalledTimes(1);
});
it('retains consumed enrollment after response loss and requires explicit fresh intent',async()=>{
 const root=mkdtempSync(join(dirname(process.cwd()),'cfhub-enrollment-'));roots.push(root);const provider=new ProtectedCredentialProvider({directory:join(root,'secrets'),create:true});closed.push(provider);provider.importCredential(token);
 const fetch=vi.fn(async()=>{throw Error('synthetic response lost');});const coordinator=new DurableMutations({origin,workspaceId:'ws',provider,journalDirectory:join(root,'journal'),create:true,fetch});closed.push(coordinator);
 const handle=await coordinator.prepareEnrollment({body:{label:'Synthetic'}},{idempotencyKey:'original'});expect((await coordinator.dispatchEnrollment(handle.id)).ok).toBe(false);expect((await coordinator.dispatchEnrollment(handle.id)).ok).toBe(false);expect(fetch).toHaveBeenCalledTimes(1);expect(provider.binding()).toBeNull();expect(provider.getEnrollmentAttempt(handle.id).consumed).toBe(true);
});
