import {randomUUID} from 'node:crypto';
import {createNativeClient} from '../../client/src/native-client';
import {registerFinalClockCheck} from '../../client/src/native-provenance';
import {prepareNativeOperation} from '../../client/src/native-request';
import {clientOperations} from '../../../src/http/generated/client-operations';
import {ClientFault,failure} from '../../client/src/transport';
import type {ApiResult,CredentialDispatchLease,EnabledOperationId,NativeClient,NativeDispatchGuard,RequestFor,SemanticRequest} from '../../client/src/types';
import {Journal,requestFingerprint,type JournalEntry} from './journal';
import {LinuxReplayClock,type DispatchStamp,type ReplayClockEvidence} from './replay-clock';
import {ProtectedCredentialProvider} from './secret-store';
export interface ReplayClock {stamp(fingerprint:string):DispatchStamp;sample():ReplayClockEvidence;}
export interface DurableMutationOptions {origin:string;workspaceId:string;provider:ProtectedCredentialProvider;journalDirectory:string;create?:boolean;fetch:typeof globalThis.fetch;timeoutMs?:number;clock?:ReplayClock;}
export interface IntentHandle {id:string;key:string|null;operation:string;origin:string;workspaceId:string;}
function rejected():never {throw Error('CLI_INTENT_REJECTED');}
const handle=(entry:JournalEntry):IntentHandle=>({id:entry.id,key:entry.key,operation:entry.request.operation,origin:entry.request.origin,workspaceId:entry.request.workspaceId});
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
   let entry=await this.#journal.recordIntent({request,principal,...(options.idempotencyKey===undefined?{}:{suppliedKey:options.idempotencyKey})});
   // A generator is called only after the keyless intent transaction committed.
   if(entry.key===null)entry=await this.#journal.attachKey(entry.id,randomUUID());return handle(entry);
  }catch{return rejected();}finally{this.#lease=null;lease?.release();this.#busy=false;}
 }
 #guard(id:string):NativeDispatchGuard{return async context=>{
  this.#lease=context.lease;let entry=await this.#journal.get(id);
  if(!entry||!context.binding||context.key!==entry.key||entry.key===null||requestFingerprint(context.request)!==requestFingerprint(entry.request))throw new ClientFault('JOURNAL_RECONCILIATION_REQUIRED');
  this.#provider.assertLeaseBinding(entry.principal,context.lease);
  if(entry.firstDispatch===null)entry=await this.#journal.markFirstDispatch(id,this.#clock.stamp(requestFingerprint(entry.request)));
  if(await this.#journal.authorizeReplay(id,context.binding,context.request,this.#clock.sample())!=='send-once')throw new ClientFault('JOURNAL_RECONCILIATION_REQUIRED');
  const original=entry,stamp=Object.freeze({...entry.firstDispatch!});
  registerFinalClockCheck(this.#provider,context.lease,()=>{
   const clock=this.#clock.sample(),elapsed=clock.nowMonotonicMs-stamp.firstDispatchMonotonicMs;
   if(clock.continuityVerified!==true||clock.suspendAwareElapsedVerified!==true||clock.clockEpochId!==stamp.clockEpochId||!Number.isSafeInteger(clock.nowMonotonicMs)||elapsed<0||elapsed>=86400000){
    try{this.#journal.authorizeReplaySync(id,context.binding!,context.request,clock);}catch{/* Denial is no-send even if reconciliation marking fails. */}
    throw new ClientFault('JOURNAL_RECONCILIATION_REQUIRED');
   }
  });
  return ()=>{this.#lease=context.lease;this.#provider.assertLeaseBinding(original.principal,context.lease);if(this.#journal.authorizeDispatchSync(id,context.binding!,context.request,()=>this.#clock.sample())!=='send-once')throw new ClientFault('JOURNAL_RECONCILIATION_REQUIRED');};
 };}
 async dispatch(id:string):Promise<ApiResult<unknown>>{
  try{this.#start();}catch{return failure('LOCAL_INPUT_REJECTED','Local mutation is unavailable');}
  try{
   const entry=await this.#journal.get(id);if(!entry||entry.key===null||entry.replayState==='settled'||entry.replayState==='reconciliation-required')return failure('JOURNAL_RECONCILIATION_REQUIRED','Retained intent requires read/manual reconciliation; no request sent');
   if(entry.request.origin!==this.#origin||entry.request.workspaceId!==this.#workspace)rejected();
   const {operation,input}=restoreRequest(entry.request);this.#provider.assertNoSecrets(JSON.stringify(entry.request));
   const result=await this.#client.call(operation,input as never,{idempotencyKey:entry.key,expectedBinding:entry.principal,dispatchGuard:this.#guard(id),...(clientOperations[operation].runtimeProof?{runtimeProofDispatch:<T>(context:{binding:typeof entry.principal;runtimeId:string;lease:CredentialDispatchLease},send:(proof:string)=>T)=>this.#provider.dispatchRuntimeProof({...context.binding,runtimeId:context.runtimeId},context.lease,send)}:{})});
   // Bodies, auth headers, error details and arbitrary request IDs never enter outcomes.
   if(result.ok)await this.#journal.recordOutcome(id,{status:result.status,code:null,requestId:null});
   else if(!['JOURNAL_RECONCILIATION_REQUIRED'].includes(result.error.code))await this.#journal.recordOutcome(id,{status:result.status,code:result.error.code,requestId:null});
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
 /** Nonsecret metadata only. Exact task/message body stays inside the journal. */
 async inspect(id:string):Promise<(IntentHandle&{replayState:JournalEntry['replayState']})|null>{const entry=await this.#journal.get(id);return entry?{...handle(entry),replayState:entry.replayState}:null;}
 close():void{if(this.#busy)rejected();if(!this.#closed){this.#closed=true;this.#journal.close();}}
}
