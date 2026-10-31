import {randomUUID} from 'node:crypto';
import {createNativeClient} from '../../client/src/native-client';
import {registerFinalClockCheck} from '../../client/src/native-provenance';
import {prepareNativeOperation} from '../../client/src/native-request';
import {clientOperations} from '../../../src/http/generated/client-operations';
import {ClientFault,failure} from '../../client/src/transport';
import type {ApiResult,VerifiedPrincipalBinding,CredentialDispatchLease,EnabledOperationId,NativeClient,NativeDispatchGuard,RequestFor,SemanticRequest} from '../../client/src/types';
import {Journal,requestFingerprint,type JournalEntry} from './journal';
import {LinuxReplayClock,type DispatchStamp,type ReplayClockEvidence} from './replay-clock';
import {ProtectedCredentialProvider} from './secret-store';
export interface ReplayClock {stamp(fingerprint:string):DispatchStamp;sample():ReplayClockEvidence;}
export interface DurableMutationOptions {origin:string;workspaceId:string;provider:ProtectedCredentialProvider;journalDirectory:string;create?:boolean;fetch:typeof globalThis.fetch;timeoutMs?:number;clock?:ReplayClock;}
export interface IntentHandle {id:string;key:string|null;operation:string;origin:string;workspaceId:string;}
function rejected():never {throw Error('CLI_INTENT_REJECTED');}
const handle=(entry:JournalEntry):IntentHandle=>({id:entry.id,key:entry.key,operation:entry.request.operation,origin:entry.request.origin,workspaceId:entry.request.workspaceId});
const sameBinding=(a:Readonly<VerifiedPrincipalBinding>,b:Readonly<VerifiedPrincipalBinding>)=>(['origin','workspaceId','principalId','slotId','slotGeneration','provenanceId'] as const).every(key=>a[key]===b[key]);
const ownerOperations=new Set(['claimTask','submitTaskResult','failTask','heartbeatRuntime','heartbeatRun','stageArtifact','uploadArtifactContent','commitArtifact']);
const escaped=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Reconstruct only the exact stored semantic request, then round-trip the one map.
 * Raw upload bytes require issue44's explicit retained-file identity and are closed here. */
function restoreRequest(request:JournalEntry['request']):{operation:EnabledOperationId;input:Record<string,unknown>} {
 const operation=request.operation as EnabledOperationId;
 if(!Object.hasOwn(clientOperations,operation))rejected();const contract=clientOperations[operation];
 if(!contract.native||!contract.idempotency||contract.upload||contract.invocationMode!=='ordinary'||request.queryCanonical!=='')rejected();
 const template=contract.path.replace('{workspace_id}',request.workspaceId),names:string[]=[];
 let pattern='',last=0;for(const match of template.matchAll(/\{([^}]+)\}/g)){pattern+=escaped(template.slice(last,match.index))+'([^/]+)';names.push(match[1]);last=match.index!+match[0].length;}pattern+=escaped(template.slice(last));
 const matched=new RegExp('^'+pattern+'$').exec(request.path);if(!matched)rejected();
 const input:Record<string,unknown>={};if(names.length)input.path=Object.fromEntries(names.map((name,i)=>[name,decodeURIComponent(matched![i+1])]));
 if(request.canonicalBody!=='')input.body=JSON.parse(request.canonicalBody);
 const {request:_snapshot,...prepared}=prepareNativeOperation(request.origin,request.workspaceId,operation,input);
 if(requestFingerprint(prepared)!==requestFingerprint(request))rejected();return {operation,input};
}

/** Local groundwork, not a command parser/login flow. Exactly one explicit send
 * per dispatch() call; never retries, enrolls, or replaces caller intent on error. */
export class DurableMutations {
 readonly #journal:Journal;readonly #provider:ProtectedCredentialProvider;readonly #client:NativeClient;readonly #clock:ReplayClock;
 readonly #origin:string;readonly #workspace:string;#lease:CredentialDispatchLease|null=null;#busy=false;#closed=false;
 constructor(options:DurableMutationOptions){
  this.#origin=options.origin;this.#workspace=options.workspaceId;this.#provider=options.provider;this.#clock=options.clock??new LinuxReplayClock();
  this.#client=createNativeClient({origin:options.origin,workspaceId:options.workspaceId,credentialProvider:options.provider,fetch:options.fetch,...(options.timeoutMs===undefined?{}:{timeoutMs:options.timeoutMs})});
  this.#journal=new Journal({directory:options.journalDirectory,create:options.create,authority:binding=>{if(!this.#lease)return false;try{this.#provider.assertLeaseBinding(binding,this.#lease);return true;}catch{return false;}}});
 }
 #start():void{if(this.#busy||this.#closed)rejected();this.#busy=true;}
 async prepare<K extends EnabledOperationId>(operation:K,input:RequestFor<K>,options:{idempotencyKey?:string;interactive?:boolean}={}):Promise<IntentHandle>{
  this.#start();let lease:CredentialDispatchLease|undefined;
  try{
   if(Object.keys(options).some(key=>!['idempotencyKey','interactive'].includes(key))||options.interactive!==undefined&&typeof options.interactive!=='boolean'||options.idempotencyKey===undefined&&options.interactive!==true)rejected();
   const {request:_input,...request}=prepareNativeOperation(this.#origin,this.#workspace,operation,input);restoreRequest(request);
   this.#provider.assertNoSecrets(JSON.stringify(request));if(options.idempotencyKey!==undefined)this.#provider.assertNoSecrets(options.idempotencyKey);
   const principal=this.#provider.binding();if(!principal)rejected();lease=await this.#provider.acquire(principal);this.#lease=lease;
   return lease.use(()=>{
    let entry=this.#journal.recordIntentSync({request,principal,...(options.idempotencyKey===undefined?{}:{suppliedKey:options.idempotencyKey})});
    // The generator runs only after the keyless journal transaction committed.
    if(entry.key===null)entry=this.#journal.attachKeySync(entry.id,randomUUID());return handle(entry);
   });
  }catch{return rejected();}finally{this.#lease=null;lease?.release();this.#busy=false;}
 }
 /** Final upload guard. Caller invokes within its actual provider-pinned send guard,
  * before entering the upload ledger. No journal payload leaves this method. */
 assertUploadHeartbeatAllowed(binding:Readonly<VerifiedPrincipalBinding>,runtimeId:string,lease:CredentialDispatchLease):void {
  this.#provider.assertLeaseBinding(binding,lease);
  this.#assertHeartbeatAllowed(binding,runtimeId);
 }
 #assertHeartbeatAllowed(binding:Readonly<VerifiedPrincipalBinding>,runtimeId:string,excludeId?:string):void {
  const runtime=this.#provider.runtimeBinding();
  if(!runtime||!sameBinding(runtime,binding)||runtime.runtimeId!==runtimeId)throw new ClientFault('CREDENTIAL_CHANGED');
  const stopped=this.#journal.someValidatedSync(entry=>{
   // Decode every entry through the canonical map, even after an earlier match.
   const restored=restoreRequest(entry.request);
   if(restored.operation!=='heartbeatRuntime'&&restored.operation!=='heartbeatRun')return false;
   // Run heartbeat has no runtime field. Its exact protected provenance is the
   // runtime association; run_id itself never supplies that authority.
   let candidateRuntime=runtimeId;
   if(restored.operation==='heartbeatRuntime'){
    const source=restored.input.path as Record<string,unknown>;
    if(!source||typeof source.runtime_instance_id!=='string')rejected();candidateRuntime=source.runtime_instance_id;
   }
   return entry.id!==excludeId&&sameBinding(entry.principal,binding)&&candidateRuntime===runtimeId&&entry.firstDispatch!==null&&entry.replayState!=='settled';
  });
  if(stopped)throw new ClientFault('JOURNAL_RECONCILIATION_REQUIRED');
 }
 #guard(id:string):NativeDispatchGuard{return async context=>{
  this.#lease=context.lease;const original=this.#journal.getSync(id);
  const exact=(entry:JournalEntry|null):entry is JournalEntry=>!!entry&&!!context.binding&&sameBinding(entry.principal,context.binding)&&context.key===entry.key&&entry.key!==null&&requestFingerprint(context.request)===requestFingerprint(entry.request);
  if(!exact(original))throw new ClientFault('JOURNAL_RECONCILIATION_REQUIRED');
  this.#provider.assertLeaseBinding(original.principal,context.lease);
  if(original.firstDispatch!==null){
   const allowed=context.lease.use(()=>this.#journal.authorizeReplaySync(id,context.binding!,context.request,this.#clock.sample()));
   if(allowed!=='send-once')throw new ClientFault('JOURNAL_RECONCILIATION_REQUIRED');
  }
  // An unsent intent has no replay clock yet. Admission belongs to the final pin.
  let stamp:Readonly<DispatchStamp>|null=null;
  registerFinalClockCheck(this.#provider,context.lease,()=>{
   if(stamp===null)throw new ClientFault('JOURNAL_RECONCILIATION_REQUIRED');
   const clock=this.#clock.sample(),elapsed=clock.nowMonotonicMs-stamp.firstDispatchMonotonicMs;
   if(clock.continuityVerified!==true||clock.suspendAwareElapsedVerified!==true||clock.clockEpochId!==stamp.clockEpochId||!Number.isSafeInteger(clock.nowMonotonicMs)||elapsed<0||elapsed>=86400000){
    try{this.#journal.authorizeReplaySync(id,context.binding!,context.request,clock);}catch{/* Retain no-send even if reconciliation marking fails. */}
    throw new ClientFault('JOURNAL_RECONCILIATION_REQUIRED');
   }
  });
  return ()=>{
   this.#lease=context.lease;this.#provider.assertLeaseBinding(original.principal,context.lease);
   let entry=this.#journal.getSync(id);if(!exact(entry)||entry.replayState==='settled'||entry.replayState==='reconciliation-required')throw new ClientFault('JOURNAL_RECONCILIATION_REQUIRED');
   if(ownerOperations.has(entry.request.operation)){
    const runtime=this.#provider.runtimeBinding();if(!runtime)throw new ClientFault('CREDENTIAL_CHANGED');
    this.#assertHeartbeatAllowed(entry.principal,runtime.runtimeId,['heartbeatRuntime','heartbeatRun'].includes(entry.request.operation)?id:undefined);
   }
   if(entry.firstDispatch===null)entry=this.#journal.markFirstDispatchSync(id,this.#clock.stamp(requestFingerprint(entry.request)));
   stamp=entry.firstDispatch;
   if(this.#journal.authorizeDispatchSync(id,context.binding!,context.request,()=>this.#clock.sample())!=='send-once')throw new ClientFault('JOURNAL_RECONCILIATION_REQUIRED');
  };
 };}
 async dispatch(id:string):Promise<ApiResult<unknown>>{
  try{this.#start();}catch{return failure('LOCAL_INPUT_REJECTED','Local mutation is unavailable');}
  try{
   const entry=await this.#journal.get(id);if(!entry||entry.key===null||entry.replayState==='settled'||entry.replayState==='reconciliation-required')return failure('JOURNAL_RECONCILIATION_REQUIRED','Retained intent requires read/manual reconciliation; no request sent');
   if(entry.request.origin!==this.#origin||entry.request.workspaceId!==this.#workspace)rejected();
   const {operation,input}=restoreRequest(entry.request);this.#provider.assertNoSecrets(JSON.stringify(entry.request));
   const result=await this.#client.call(operation,input as never,{idempotencyKey:entry.key,expectedBinding:entry.principal,dispatchGuard:this.#guard(id),...(clientOperations[operation].runtimeProof?{runtimeProofDispatch:<T>(context:{binding:typeof entry.principal;runtimeId:string;lease:CredentialDispatchLease},send:(proof:string)=>T)=>this.#provider.dispatchRuntimeProof({...context.binding,runtimeId:context.runtimeId},context.lease,send)}:{})});
   // Bodies, auth headers, error details and arbitrary request IDs never enter outcomes.
   if(result.ok||result.error.code!=='JOURNAL_RECONCILIATION_REQUIRED'){
    // A successful heartbeat clears its stop only behind the same provider barrier.
    // The native client released its lease after the response; reacquire exact authority.
    const lease=await this.#provider.acquire(entry.principal);this.#lease=lease;
    try{lease.use(()=>{this.#provider.assertLeaseBinding(entry.principal,lease);this.#journal.recordOutcomeSync(id,{status:result.status,code:result.ok?null:result.error.code,requestId:null});});}
    finally{this.#lease=null;lease.release();}
   }
   this.#provider.assertNoSecrets(JSON.stringify(result));return result as ApiResult<unknown>;
  }catch{return failure('JOURNAL_UNAVAILABLE','Local durability or credential binding unavailable; retain original intent for reconciliation');}
  finally{this.#lease=null;this.#busy=false;}
 }
 /** Explicit enrollment has no verified principal yet; its separate protected
  * attempt binds the opaque credential slot, never a guessed agent label. */
 async prepareEnrollment(input:RequestFor<'createRuntime'>,options:{idempotencyKey?:string;interactive?:boolean}={}):Promise<IntentHandle>{
  this.#start();let lease:CredentialDispatchLease|undefined;
  try{
   if(Object.keys(options).some(key=>!['idempotencyKey','interactive'].includes(key))||options.interactive!==undefined&&typeof options.interactive!=='boolean'||options.idempotencyKey===undefined&&options.interactive!==true)rejected();
   const {request:_input,...request}=prepareNativeOperation(this.#origin,this.#workspace,'createRuntime',input);lease=await this.#provider.acquire(null);
   let attempt=this.#provider.recordEnrollmentIntent(request,lease,options.idempotencyKey);
   if(attempt.key===null)attempt=this.#provider.attachEnrollmentKey(attempt.id,randomUUID());
   return {id:attempt.id,key:attempt.key,operation:'createRuntime',origin:this.#origin,workspaceId:this.#workspace};
  }catch{return rejected();}finally{lease?.release();this.#busy=false;}
 }
 async dispatchEnrollment(id:string):Promise<ApiResult<unknown>>{
  try{this.#start();}catch{return failure('LOCAL_INPUT_REJECTED','Local enrollment is unavailable');}
  try{
   const attempt=this.#provider.getEnrollmentAttempt(id);
   if(attempt.key===null||attempt.consumed||attempt.request.origin!==this.#origin||attempt.request.workspaceId!==this.#workspace)rejected();
   const input={body:JSON.parse(attempt.request.canonicalBody)};
   const {request:_input,...prepared}=prepareNativeOperation(this.#origin,this.#workspace,'createRuntime',input);
   if(requestFingerprint(prepared)!==requestFingerprint(attempt.request))rejected();
   const result=await this.#client.enrollRuntime(input,{idempotencyKey:attempt.key,captureRuntime:capture=>this.#provider.captureRuntime(capture),dispatchGuard:context=>{
    if(context.key!==attempt.key)throw new ClientFault('CREDENTIAL_CHANGED');
    return this.#provider.authorizeEnrollmentDispatch(id,context.request,context.lease);
   }});
   this.#provider.assertNoSecrets(JSON.stringify(result));return result.ok?result:{...result,requestId:null};
  }catch{return failure('ENROLLMENT_RECONCILIATION_REQUIRED','Enrollment may have committed; do not replay a consumed attempt. Explicit fresh enrollment is required if proof was not captured');}
  finally{this.#busy=false;}
 }
 /** Internal immutable settlement evidence, never a CLI presentation. Read before
  * entering the upload transaction; settled journal success is monotonic. */
 inspectSettledArtifactIntent(id:string,expectedOperation:'stageArtifact'|'commitArtifact',binding:Readonly<VerifiedPrincipalBinding>):Readonly<{id:string;request:Readonly<SemanticRequest>;principal:Readonly<VerifiedPrincipalBinding>}>|null {
  if(expectedOperation!=='stageArtifact'&&expectedOperation!=='commitArtifact')rejected();
  const entry=this.#journal.getSync(id);
  if(!entry||entry.replayState!=='settled'||entry.request.operation!==expectedOperation||!sameBinding(entry.principal,binding))return null;
  const restored=restoreRequest(entry.request);
  return Object.freeze({id:entry.id,request:Object.freeze({...entry.request,operation:restored.operation}),principal:Object.freeze({...entry.principal})});
 }
 /** Nonsecret metadata only. Exact task/message body stays inside the journal. */
 async inspect(id:string):Promise<(IntentHandle&{replayState:JournalEntry['replayState']})|null>{const entry=await this.#journal.get(id);return entry?{...handle(entry),replayState:entry.replayState}:null;}
 close():void{if(this.#busy)rejected();if(!this.#closed){this.#closed=true;this.#journal.close();}}
}
