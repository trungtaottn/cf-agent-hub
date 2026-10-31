import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,chmodSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {buildSync} from 'esbuild';
import {ProtectedCredentialProvider,type RuntimeProofBinding} from '../../packages/cli/src/secret-store';
import {createNativeClient} from '../../packages/client/src/native-client';
import type {RuntimeCapture,CredentialDispatchLease,VerifiedPrincipalBinding} from '../../packages/client/src/types';
const token='S'.repeat(43),proof='P'.repeat(43),origin='https://hub.example.invalid';
const runtime={id:'runtime_synthetic',workspace_id:'ws',agent_id:'agent_synthetic',runtime_version:1,label:'Synthetic',status:'online' as const,last_seen_at:'2026-10-27T00:00:00Z',presence_expires_at:'2026-10-27T00:01:30Z',created_at:'2026-10-27T00:00:00Z'};
const roots:string[]=[],providers:ProtectedCredentialProvider[]=[];
function directory(){const value=mkdtempSync(join(dirname(process.cwd()),'cfhub-secret-'));chmodSync(value,0o700);roots.push(value);return value;}
function provider(dir=directory(),create=true){const result=new ProtectedCredentialProvider({directory:dir,create});providers.push(result);return result;}
function fixture(p=provider()){
 const fetch=vi.fn(async()=>Response.json({data:{runtime,runtime_token:proof,revealed:true},request_id:'synthetic_request'},{status:201}));
 const client=createNativeClient({origin,workspaceId:'ws',credentialProvider:p,fetch});
 const enroll=(capture?:(value:RuntimeCapture)=>unknown)=>client.enrollRuntime({body:{label:'Synthetic'}},{idempotencyKey:'synthetic_enroll',captureRuntime:(capture??((value:RuntimeCapture)=>p.captureRuntime(value))) as never});
 return {p,fetch,client,enroll};
}
afterEach(()=>{for(const p of providers.splice(0))try{p.close();}catch{}for(const dir of roots.splice(0))rmSync(dir,{recursive:true,force:true});});
describe('protected runtime proof store',()=>{
 it('imports opaque token unbound and rejects invented principal metadata without fetch',async()=>{
  const f=fixture();f.p.importCredential(token);expect(f.p.binding()).toBeNull();const lease=await f.p.acquire(null);
  const forged:RuntimeProofBinding={origin,workspaceId:'ws',principalId:'agent_synthetic',slotId:lease.slotId,slotGeneration:lease.slotGeneration,provenanceId:'forged',runtimeId:runtime.id};
  await expect(f.p.putRuntimeProof(forged,lease,proof)).rejects.toThrow('SECRET_STORE_REJECTED');
  expect(await f.client.call('createTask',{body:{title:'Synthetic',description:''}},{idempotencyKey:'synthetic_task'})).toMatchObject({ok:false,error:{code:'CREDENTIAL_UNBOUND'}});expect(f.fetch).not.toHaveBeenCalled();lease.release();
 });
 it('captures exact actual lease, persists active association, and reopens without credential_id or hidden query',async()=>{
  const dir=directory(),f=fixture(provider(dir));f.p.importCredential(token);expect(await f.enroll()).toMatchObject({ok:true,data:runtime});
  const before=f.p.runtimeBinding()!;expect(before).toMatchObject({origin,workspaceId:'ws',principalId:runtime.agent_id,runtimeId:runtime.id});f.p.close();
  const restored=provider(dir,false);expect(restored.runtimeBinding()).toEqual(before);const lease=await restored.acquire(restored.binding());let received='';
  await expect(restored.withRuntimeProof(before,lease,value=>{received=value;return value;})).resolves.toBeUndefined();expect(received).toBe(proof);lease.release();
  const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({error:{code:'FORBIDDEN',message:'Denied',retryable:false,request_id:'synthetic_deny'}},{status:403}));
  const client=createNativeClient({origin,workspaceId:'ws',credentialProvider:restored,fetch});
  expect(await client.call('claimTask',{path:{task_id:'task_synthetic'},body:{expected_version:1,runtime_instance_id:runtime.id}},{idempotencyKey:'synthetic_claim',expectedBinding:restored.binding()!,runtimeProof:proof})).toMatchObject({ok:false,status:403});
  expect(fetch).toHaveBeenCalledTimes(1);expect(String(fetch.mock.calls[0]?.[0])).toContain('/tasks/task_synthetic:claim');expect(f.fetch).toHaveBeenCalledTimes(1);
 });
 it('does not expose staged capture as authority and aborts failed capture',async()=>{
  const f=fixture();f.p.importCredential(token);let binding:RuntimeProofBinding|undefined;
  const result=await f.enroll(capture=>{const finalizer=f.p.captureRuntime(capture);binding={...capture.provenance.binding,runtimeId:capture.runtime.id};expect(f.p.binding()).toBeNull();finalizer.abort();throw Error('synthetic '+proof);});
  expect(result).toMatchObject({ok:false,error:{code:'CAPTURE_FAILED'}});expect(JSON.stringify(result)).not.toContain(proof);expect(f.p.binding()).toBeNull();
  const lease=await f.p.acquire(null);await expect(f.p.withRuntimeProof(binding!,lease,()=>{throw Error('must not invoke');})).rejects.toThrow('SECRET_STORE_REJECTED');lease.release();
 });
 it.each(['principalId','slotGeneration','runtimeId','origin','workspaceId','provenanceId'] as const)('denies proof reads and puts with mismatched %s',async field=>{
  const f=fixture();f.p.importCredential(token);expect((await f.enroll()).ok).toBe(true);const binding=f.p.runtimeBinding()!,lease=await f.p.acquire(f.p.binding());
  const changed={...binding,[field]:field==='slotGeneration'?binding.slotGeneration+1:'other'} as RuntimeProofBinding;const dispatch=vi.fn();
  await expect(f.p.withRuntimeProof(changed,lease,dispatch)).rejects.toThrow('SECRET_STORE_REJECTED');await expect(f.p.putRuntimeProof(changed,lease,proof)).rejects.toThrow('SECRET_STORE_REJECTED');expect(dispatch).not.toHaveBeenCalled();lease.release();
 });
 it('denies foreign or structural copied actual lease, despite colliding metadata',async()=>{
  const a=fixture();a.p.importCredential(token);await a.enroll();const lease=await a.p.acquire(a.p.binding());const clone={...lease};const dispatch=vi.fn();
  await expect(a.p.withRuntimeProof(a.p.runtimeBinding()!,clone,dispatch)).rejects.toThrow('SECRET_STORE_REJECTED');
  const b=provider();b.importCredential(token);await expect(b.withRuntimeProof(a.p.runtimeBinding()!,lease,dispatch)).rejects.toThrow('SECRET_STORE_REJECTED');expect(dispatch).not.toHaveBeenCalled();lease.release();
 });
 it('explicit rotation advances generation, invalidates leased proof and remains unbound',async()=>{
  const f=fixture();f.p.importCredential(token);await f.enroll();const binding=f.p.runtimeBinding()!,lease=await f.p.acquire(f.p.binding());
  f.p.rotateCredential('T'.repeat(43));expect(lease.isCurrent()).toBe(false);expect(f.p.binding()).toBeNull();const next=await f.p.acquire(null);expect(next.slotId).toBe(lease.slotId);expect(next.slotGeneration).toBe(lease.slotGeneration+1);
  await expect(f.p.withRuntimeProof(binding,lease,vi.fn())).rejects.toThrow('SECRET_STORE_REJECTED');expect(()=>f.p.importCredential(token)).toThrow('SECRET_STORE_REJECTED');lease.release();next.release();
 });
 it('validates expected binding, revokes closed leases and prevents secret journal values',async()=>{
  const f=fixture();f.p.importCredential(token);await f.enroll();const binding=f.p.binding()!;
  await expect(f.p.acquire({...binding,principalId:'other'})).rejects.toThrow('SECRET_STORE_REJECTED');
  expect(()=>f.p.assertNoSecrets(JSON.stringify({value:token}))).toThrow('SECRET_STORE_REJECTED');expect(()=>f.p.assertNoSecrets(JSON.stringify({value:proof}))).toThrow('SECRET_STORE_REJECTED');expect(()=>f.p.assertNoSecrets('{"safe":true}')).not.toThrow();
  const lease=await f.p.acquire(binding);f.p.assertLeaseBinding(binding,lease);f.p.close();expect(lease.isCurrent()).toBe(false);expect(()=>lease.use(()=>null)).toThrow('SECRET_STORE_REJECTED');
 });
});

const enrollmentRequest={operation:'createRuntime' as const,method:'POST',path:'/v2/workspaces/ws/runtimes',queryCanonical:'',canonicalBody:'{"label":"Synthetic"}',origin,workspaceId:'ws'};
describe('durable unbound enrollment attempt',()=>{
 it('records before attaching key, persists single-send consumption and never recreates permit after reopen',async()=>{
  const dir=directory(),p=provider(dir);p.importCredential(token);const lease=await p.acquire(null);
  const attempt=p.recordEnrollmentIntent(enrollmentRequest,lease);expect(attempt.key).toBeNull();expect(attempt.principalId).toBeNull();
  expect(p.attachEnrollmentKey(attempt.id,'synthetic_key').key).toBe('synthetic_key');expect(()=>p.attachEnrollmentKey(attempt.id,'changed')).toThrow('SECRET_STORE_REJECTED');
  const permit=p.authorizeEnrollmentDispatch(attempt.id,enrollmentRequest,lease);lease.use(()=>permit());expect(()=>lease.use(()=>permit())).toThrow('SECRET_STORE_REJECTED');lease.release();p.close();
  const reopened=provider(dir,false),next=await reopened.acquire(null);expect(()=>reopened.authorizeEnrollmentDispatch(attempt.id,enrollmentRequest,next)).toThrow('SECRET_STORE_REJECTED');next.release();
 });
 it('rejects changed complete request and slot generation before enrollment dispatch',async()=>{
  const p=provider();p.importCredential(token);const lease=await p.acquire(null),attempt=p.recordEnrollmentIntent(enrollmentRequest,lease,'synthetic_key');
  expect(()=>p.authorizeEnrollmentDispatch(attempt.id,{...enrollmentRequest,canonicalBody:'{"label":"Changed"}'},lease)).toThrow('SECRET_STORE_REJECTED');
  p.rotateCredential('T'.repeat(43));expect(()=>p.authorizeEnrollmentDispatch(attempt.id,enrollmentRequest,lease)).toThrow('SECRET_STORE_REJECTED');lease.release();
 });
 it('rejects secrets in semantic enrollment record and never accepts manual principal',async()=>{
  const p=provider();p.importCredential(token);const lease=await p.acquire(null);
  expect(()=>p.recordEnrollmentIntent({...enrollmentRequest,canonicalBody:JSON.stringify({label:token})},lease)).toThrow('SECRET_STORE_REJECTED');
  expect(()=>p.recordEnrollmentIntent({...enrollmentRequest,principalId:'invented'} as never,lease)).toThrow('SECRET_STORE_REJECTED');lease.release();
 });
});

describe('secret boundary fault handling',()=>{
 it('redacts a rejected asynchronous proof dispatch error',async()=>{
  const f=fixture();f.p.importCredential(token);await f.enroll();const lease=await f.p.acquire(f.p.binding());
  await expect(f.p.withRuntimeProof(f.p.runtimeBinding()!,lease,()=>Promise.reject(Error(proof)))).rejects.toThrow('SECRET_STORE_REJECTED');lease.release();
 });
 it('denies capture activation when protected storage becomes inaccessible after staging',async()=>{
  const dir=directory(),f=fixture(provider(dir));f.p.importCredential(token);
  const result=await f.enroll(capture=>{const finalizer=f.p.captureRuntime(capture);chmodSync(join(dir,'secrets.sqlite'),0o400);return finalizer;});
  expect(result.ok).toBe(false);expect(JSON.stringify(result)).not.toContain(proof);f.p.close();chmodSync(join(dir,'secrets.sqlite'),0o600);const reopened=provider(dir,false);expect(reopened.binding()).toBeNull();
 });
});

describe('protected association lifecycle',()=>{
 it('invalidates older leases after a different authenticated enrollment becomes active',async()=>{
  const f=fixture();f.p.importCredential(token);await f.enroll();const old=await f.p.acquire(f.p.binding()),prior=f.p.runtimeBinding()!;
  expect((await f.enroll()).ok).toBe(true);expect(f.p.runtimeBinding()!.provenanceId).not.toBe(prior.provenanceId);expect(old.isCurrent()).toBe(false);old.release();
 });
 it('rejects unexpected schema objects instead of executing attacker-shaped triggers',()=>{
  const dir=directory(),p=provider(dir);p.importCredential(token);p.close();const db=new DatabaseSync(join(dir,'secrets.sqlite'));db.exec("CREATE TRIGGER extra AFTER INSERT ON runtime_proofs BEGIN DELETE FROM credential_slot; END");db.close();
  expect(()=>provider(dir,false)).toThrow('SECRET_STORE_REJECTED');
 });
});

describe('real process capture durability',()=>{
 it.each(['staged','active'] as const)('SIGKILL then reopen preserves %s capture semantics and exact protected slot',async mode=>{
  const root=directory(),state=join(root,'state'),script=join(root,'secret-fixture.mjs');
  const built=buildSync({entryPoints:[join(process.cwd(),'test/cli/secret-process-fixture.ts')],bundle:true,write:false,format:'esm',platform:'node',target:'node24'});writeFileSync(script,built.outputFiles[0].contents,{mode:0o600});
  const child=spawn(process.execPath,[script,mode,state],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stderr.on('data',bytes=>stderr+=String(bytes));
  try{
   const receipt=await new Promise<{state:string;binding:RuntimeProofBinding}>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('SECRET_PROCESS_TIMEOUT')),15000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(Error('SECRET_PROCESS_EXIT_'+code));});
    child.stdout.on('data',bytes=>{stdout+=String(bytes);if(stdout.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(stdout.split('\n')[0]));}catch{reject(Error('SECRET_PROCESS_OUTPUT'));}}});
   });
   const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await exited;
   expect(stdout+stderr).not.toContain(token);expect(stdout+stderr).not.toContain(proof);expect(receipt.state).toBe(mode);
   const reopened=provider(state,false);
   if(mode==='staged'){expect(reopened.binding()).toBeNull();const f=fixture(reopened);expect((await f.enroll()).ok).toBe(true);}
   else{expect(reopened.runtimeBinding()).toEqual(receipt.binding);const lease=await reopened.acquire(reopened.binding());let matched=false;lease.use(()=>reopened.dispatchRuntimeProof(receipt.binding,lease,value=>{matched=value===proof;}));expect(matched).toBe(true);lease.release();}
  }finally{if(child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await exited;}}
 },25000);
});

describe('pending capture provenance checks',()=>{
 it.each(['principal','generation','proof','runtime','lease'] as const)('denies %s substitution while a genuine capture is pending',async field=>{
  const f=fixture();f.p.importCredential(token);
  const result=await f.enroll(capture=>{
   const changed={...capture};
   if(field==='principal')changed.provenance={...capture.provenance,binding:{...capture.provenance.binding,principalId:'forged'}};
   if(field==='generation')changed.provenance={...capture.provenance,binding:{...capture.provenance.binding,slotGeneration:capture.provenance.binding.slotGeneration+1}};
   if(field==='proof')changed.runtimeProof='Q'.repeat(43);
   if(field==='runtime')changed.runtime={...capture.runtime,id:'runtime_forged'};
   if(field==='lease')changed.lease={...capture.lease};
   return f.p.captureRuntime(changed);
  });
  expect(result).toMatchObject({ok:false,error:{code:'CAPTURE_FAILED'}});expect(f.p.binding()).toBeNull();expect(f.fetch).toHaveBeenCalledTimes(1);expect(JSON.stringify(result)).not.toContain(proof);
 });
});

describe('bounded enrollment control records',()=>{
 it('rejects reusing an enrollment key across durable attempts on the same slot generation',async()=>{
  const p=provider();p.importCredential(token);const lease=await p.acquire(null),first=p.recordEnrollmentIntent(enrollmentRequest,lease,'used_key');
  const permit=p.authorizeEnrollmentDispatch(first.id,enrollmentRequest,lease);lease.use(()=>permit());
  expect(()=>p.recordEnrollmentIntent(enrollmentRequest,lease,'used_key')).toThrow('SECRET_STORE_REJECTED');
  const other=p.recordEnrollmentIntent(enrollmentRequest,lease);expect(()=>p.attachEnrollmentKey(other.id,'used_key')).toThrow('SECRET_STORE_REJECTED');expect(p.getEnrollmentAttempt(other.id).key).toBeNull();lease.release();
 });
 it('retains existing enrollment evidence and refuses new admission at the explicit attempt cap',async()=>{
  const p=provider();p.importCredential(token);const lease=await p.acquire(null);let first='';
  for(let i=0;i<1000;i++){const attempt=p.recordEnrollmentIntent(enrollmentRequest,lease,'synthetic_key_'+i);if(i===0)first=attempt.id;}
  expect(()=>p.recordEnrollmentIntent(enrollmentRequest,lease,'over_cap')).toThrow('SECRET_STORE_REJECTED');expect(p.getEnrollmentAttempt(first)).toMatchObject({key:'synthetic_key_0',consumed:false});lease.release();
 },20000);
});
