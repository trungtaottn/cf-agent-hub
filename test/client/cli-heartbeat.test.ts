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

describe('provider serialized heartbeat stop',()=>{
 it('blocks a new heartbeat key after an uncertain heartbeat without a second fetch',async()=>{
  const f=await fixture();f.fetch.mockImplementation(async()=>{throw Error('synthetic response loss');});
  const first=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'first'});
  expect((await f.mutations.dispatch(first.id)).ok).toBe(false);
  const next=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'new-key'});
  expect((await f.mutations.dispatch(next.id)).ok).toBe(false);
  expect(f.fetch).toHaveBeenCalledTimes(1);
  expect((await f.mutations.inspect(next.id))?.replayState).toBe('unsent');
 });
 it('blocks dependent artifact staging but leaves unrelated task creation available',async()=>{
  const f=await fixture();f.fetch.mockImplementation(async()=>{throw Error('synthetic response loss');});
  const first=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'first'});await f.mutations.dispatch(first.id);
  const stage=await f.mutations.prepare('stageArtifact',{body:{task_id:null,run_id:null,filename:'synthetic.txt',media_type:'text/plain',byte_size:4,sha256:'a'.repeat(64)}},{idempotencyKey:'stage'});
  await f.mutations.dispatch(stage.id);expect(f.fetch).toHaveBeenCalledTimes(1);
  const task=await f.mutations.prepare('createTask',{body:{title:'Unrelated',description:''}},{idempotencyKey:'task'});await f.mutations.dispatch(task.id);expect(f.fetch).toHaveBeenCalledTimes(2);
 });
 it('does not stamp an unsent intent before the final provider proof handoff',async()=>{
  const f=await fixture();const intent=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'proof-denied'});
  f.provider.dispatchRuntimeProof=()=>{throw Error('synthetic proof unavailable');};
  await f.mutations.dispatch(intent.id);expect(f.fetch).not.toHaveBeenCalled();
  expect((await f.mutations.inspect(intent.id))?.replayState).toBe('unsent');
 });
});

it('settles only the original heartbeat before allowing a different heartbeat',async()=>{
 const f=await fixture();f.fetch.mockImplementationOnce(async()=>{throw Error('lost');});
 const first=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'first'});await f.mutations.dispatch(first.id);
 const next=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'next'});
 expect((await f.mutations.dispatch(next.id)).ok).toBe(false);expect(f.fetch).toHaveBeenCalledTimes(1);
 expect((await f.mutations.dispatch(first.id)).ok).toBe(true);
 expect((await f.mutations.dispatch(next.id)).ok).toBe(true);expect(f.fetch).toHaveBeenCalledTimes(3);
});
it('allows final upload guard only after exact protected runtime matching and no pending heartbeat',async()=>{
 const f=await fixture(),binding=f.provider.binding()!,lease=await f.provider.acquire(binding);
 try{
  expect(()=>lease.use(()=>f.mutations.assertUploadHeartbeatAllowed(binding,runtime.id,lease))).not.toThrow();
  expect(()=>lease.use(()=>f.mutations.assertUploadHeartbeatAllowed(binding,'runtime_other',lease))).toThrow();
 }finally{lease.release();}
 const first=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'first'});f.fetch.mockImplementationOnce(async()=>{throw Error('lost');});await f.mutations.dispatch(first.id);
 const nextLease=await f.provider.acquire(binding);
 try{expect(()=>nextLease.use(()=>f.mutations.assertUploadHeartbeatAllowed(binding,runtime.id,nextLease))).toThrow();}finally{nextLease.release();}
});

import {writeFileSync,existsSync} from 'node:fs';
import {spawn,type ChildProcess} from 'node:child_process';
import {build} from 'esbuild';
const children:ChildProcess[]=[];
afterEach(()=>{for(const child of children.splice(0))child.kill('SIGKILL');});
async function processFixture(root:string){
 const outfile=join(root,'heartbeat-child.mjs');
 await build({stdin:{contents:`
 import {writeFileSync,existsSync} from 'node:fs';
 import {join} from 'node:path';
 import {ProtectedCredentialProvider} from '${process.cwd()}/packages/cli/src/secret-store';
 import {DurableMutations} from '${process.cwd()}/packages/cli/src/durable-mutations';
 import {Journal} from '${process.cwd()}/packages/cli/src/journal';
 const [root,id,mode]=process.argv.slice(2);const keepAlive=setInterval(()=>{},1000);
 const emit=value=>writeFileSync(join(root,mode+'-'+value),'1',{mode:0o600});
 emit('started');
 if(mode==='same-intent'){const get=Journal.prototype.getSync;let reads=0;Journal.prototype.getSync=function(id){const entry=get.call(this,id);if(++reads===2&&entry?.firstDispatch===null)emit('unsent-read');return entry;};}
 const provider=new ProtectedCredentialProvider({directory:join(root,'secrets')});
 if(mode==='rotation'){provider.rotateCredential('Q'.repeat(43));emit('rotated');provider.close();process.exit(0);}
 if(mode==='paused'){
  const original=provider.dispatchRuntimeProof.bind(provider);
  provider.dispatchRuntimeProof=(binding,lease,send)=>original(binding,lease,proof=>{
   emit('pinned');while(!existsSync(join(root,'continue')))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
   return send(proof);
  });
 }
 const mutations=new DurableMutations({origin:'https://hub.example.invalid',workspaceId:'ws',provider,journalDirectory:join(root,'journal'),fetch:()=>{
  emit('fetched');return new Promise(()=>{});
 }});
 const result=await mutations.dispatch(id);emit('done');
 writeFileSync(join(root,mode+'-result'),JSON.stringify(result),{mode:0o600});
 mutations.close();provider.close();clearInterval(keepAlive);
 `,resolveDir:process.cwd(),sourcefile:'heartbeat-child.ts',loader:'ts'},bundle:true,platform:'node',format:'esm',target:'node24',outfile});
 return (id:string,mode:string)=>{const child=spawn(process.execPath,[outfile,root,id,mode],{stdio:['ignore','pipe','pipe']});children.push(child);let errors='';child.stderr?.on('data',chunk=>{errors+=String(chunk);});return {child,errors:()=>errors};};
}
async function until(check:()=>boolean,label:string){const end=Date.now()+12000;while(!check()){if(Date.now()>end)throw Error('Timed out: '+label);await new Promise(resolve=>setTimeout(resolve,10));}}
it('serializes two processes at final proof pin; pending heartbeat blocks owner and restart replay',async()=>{
 const f=await fixture();const heartbeat=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'paused-heartbeat'});
 const stage=await f.mutations.prepare('stageArtifact',{body:{task_id:null,run_id:null,filename:'synthetic.txt',media_type:'text/plain',byte_size:4,sha256:'a'.repeat(64)}},{idempotencyKey:'stage'});
 const launch=await processFixture(f.root),heartbeatChild=launch(heartbeat.id,'paused');await until(()=>existsSync(join(f.root,'paused-pinned')),'heartbeat pin');
 const owner=launch(stage.id,'owner');await until(()=>existsSync(join(f.root,'owner-started')),'owner start');
 launch(heartbeat.id,'same-intent');await until(()=>existsSync(join(f.root,'same-intent-unsent-read')),'same intent preliminary unsent read');
 expect(existsSync(join(f.root,'owner-fetched'))).toBe(false);
 writeFileSync(join(f.root,'continue'),'1',{mode:0o600});await until(()=>existsSync(join(f.root,'paused-fetched')),'heartbeat first fetch');
 await until(()=>existsSync(join(f.root,'owner-done')),'owner denied');expect(existsSync(join(f.root,'owner-fetched'))).toBe(false);
 await until(()=>existsSync(join(f.root,'same-intent-done')),'same intent denied');expect(existsSync(join(f.root,'same-intent-fetched'))).toBe(false);
 // Fetch Promise remains pending, but provider lock has already been released.
 expect(owner.errors()).not.toContain('PROTECTED_STORAGE_REJECTED');
 heartbeatChild.child.kill('SIGKILL');
 const replay=launch(heartbeat.id,'replay');await until(()=>existsSync(join(f.root,'replay-done')),'restart denied');expect(existsSync(join(f.root,'replay-fetched'))).toBe(false);
 expect(readFileSync(join(f.root,'replay-result'),'utf8')).toContain('JOURNAL_RECONCILIATION_REQUIRED');
},20000);
it('rotation waits for final admission but not for the unresolved network Promise',async()=>{
 const f=await fixture(),heartbeat=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'rotation-heartbeat'}),launch=await processFixture(f.root);
 launch(heartbeat.id,'paused');await until(()=>existsSync(join(f.root,'paused-pinned')),'heartbeat pin');launch('', 'rotation');await until(()=>existsSync(join(f.root,'rotation-started')),'rotation start');
 expect(existsSync(join(f.root,'rotation-rotated'))).toBe(false);writeFileSync(join(f.root,'continue'),'1',{mode:0o600});
 await until(()=>existsSync(join(f.root,'paused-fetched')),'admitted fetch');await until(()=>existsSync(join(f.root,'rotation-rotated')),'rotation after pin release');
},20000);
it('one pending run heartbeat stops another run with the same protected runtime',async()=>{
 const f=await fixture();f.fetch.mockImplementation(async()=>{throw Error('lost run heartbeat');});
 const first=await f.mutations.prepare('heartbeatRun',{path:{run_id:'run_one'},body:{expected_run_version:1,fence:1}},{idempotencyKey:'run-one'});
 await f.mutations.dispatch(first.id);expect(f.fetch).toHaveBeenCalledTimes(1);
 const second=await f.mutations.prepare('heartbeatRun',{path:{run_id:'run_two'},body:{expected_run_version:1,fence:1}},{idempotencyKey:'run-two'});
 await f.mutations.dispatch(second.id);expect(f.fetch).toHaveBeenCalledTimes(1);
 expect((await f.mutations.inspect(second.id))?.replayState).toBe('unsent');
});
it('exposes only exact settled canonical artifact intent evidence to the upload coordinator',async()=>{
 const f=await fixture(),binding=f.provider.binding()!;
 expect(typeof f.mutations.inspectSettledArtifactIntent).toBe('function');
 const intent=await f.mutations.prepare('stageArtifact',{body:{task_id:null,run_id:null,filename:'synthetic.txt',media_type:'text/plain',byte_size:4,sha256:'a'.repeat(64)}},{idempotencyKey:'stage-proof'});
 expect(f.mutations.inspectSettledArtifactIntent(intent.id,'stageArtifact',binding)).toBeNull();
 const artifact={id:'artifact_test',workspace_id:'ws',task_id:null,run_id:null,owner:{kind:'agent',principal_id:runtime.agent_id,agent_id:runtime.agent_id},artifact_version:1,filename:'synthetic.txt',media_type:'text/plain',byte_size:4,sha256:'a'.repeat(64),status:'staged',created_at:'2026-10-27T00:00:00Z',committed_at:null,expires_at:null};
 f.fetch.mockImplementationOnce(async()=>Response.json({data:artifact,request_id:'stage'}, {status:201}));
 expect((await f.mutations.dispatch(intent.id)).ok).toBe(true);
 const evidence=f.mutations.inspectSettledArtifactIntent(intent.id,'stageArtifact',binding);
 expect(evidence).toMatchObject({id:intent.id,principal:binding,request:{operation:'stageArtifact'}});expect(Object.isFrozen(evidence)).toBe(true);expect(Object.isFrozen(evidence!.request)).toBe(true);
 expect(f.mutations.inspectSettledArtifactIntent(intent.id,'commitArtifact',binding)).toBeNull();
 expect(f.mutations.inspectSettledArtifactIntent(intent.id,'stageArtifact',{...binding,provenanceId:'other'})).toBeNull();
});

import {Journal,requestFingerprint} from '../../packages/cli/src/journal';
import {prepareNativeOperation} from '../../packages/client/src/native-request';
it.each(['runtime','provenance','generation'] as const)('does not treat unrelated %s heartbeat metadata as this protected runtime stop',async kind=>{
 const f=await fixture(),binding=f.provider.binding()!;
 const journal=new Journal({directory:join(f.root,'journal'),authority:()=>true});closed.push(journal);
 const {request:_snapshot,...semantic}=prepareNativeOperation(origin,'ws','heartbeatRuntime',{path:{runtime_instance_id:kind==='runtime'?'other_runtime':runtime.id},body:{expected_runtime_version:1}});
 const principal={...binding,...(kind==='provenance'?{provenanceId:'unrelated_provenance'}:{}),...(kind==='generation'?{slotGeneration:binding.slotGeneration+1}:{})};
 const old=journal.recordIntentSync({request:semantic,principal,suppliedKey:'unrelated'});journal.markFirstDispatchSync(old.id,f.clock.stamp(requestFingerprint(semantic)));
 const current=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'current'});expect((await f.mutations.dispatch(current.id)).ok).toBe(true);expect(f.fetch).toHaveBeenCalledTimes(1);
});
it('outcome persistence failure cannot clear a heartbeat stop',async()=>{
 const f=await fixture(),first=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'first'});
 const record=vi.spyOn(Journal.prototype,'recordOutcomeSync').mockImplementationOnce(()=>{throw Error('synthetic disk failure');});
 try{expect((await f.mutations.dispatch(first.id)).ok).toBe(false);}finally{record.mockRestore();}
 const next=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'next'});await f.mutations.dispatch(next.id);expect(f.fetch).toHaveBeenCalledTimes(1);
 expect((await f.mutations.inspect(first.id))?.replayState).toBe('within-window');
});
it('deadline expiring during bounded scan sends nothing and retains conservative pending state',async()=>{
 const f=await fixture();f.mutations.close();const mutations=new DurableMutations({...f.opts,timeoutMs:30});closed.push(mutations);
 const intent=await mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'slow-scan'}),original=Journal.prototype.someValidatedSync;
 const scan=vi.spyOn(Journal.prototype,'someValidatedSync').mockImplementation(function(this:Journal,predicate){const result=original.call(this,predicate);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);return result;});
 try{expect((await mutations.dispatch(intent.id)).ok).toBe(false);}finally{scan.mockRestore();}
 expect(f.fetch).not.toHaveBeenCalled();expect((await mutations.inspect(intent.id))?.replayState).toBe('within-window');
});
it('provider busy timeout denies competing process without any owner fetch',async()=>{
 const f=await fixture(),heartbeat=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'busy-heartbeat'}),owner=await f.mutations.prepare('heartbeatRuntime',request,{idempotencyKey:'busy-owner'}),launch=await processFixture(f.root);
 launch(heartbeat.id,'paused');await until(()=>existsSync(join(f.root,'paused-pinned')),'heartbeat pin');launch(owner.id,'busy');
 await until(()=>existsSync(join(f.root,'busy-done')),'bounded busy timeout');expect(existsSync(join(f.root,'busy-fetched'))).toBe(false);
 writeFileSync(join(f.root,'continue'),'1',{mode:0o600});await until(()=>existsSync(join(f.root,'paused-fetched')),'release heartbeat');
},15000);
