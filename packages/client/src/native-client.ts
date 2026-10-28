import {protectedAssociationFor,beginPendingCapture,clearPendingCapture,runFinalClockCheck,clearFinalClockCheck} from './native-provenance';
import {prepareNativeOperation,snapshot,nativeOrigin} from './native-request';
import {boundedStream} from './streams';
import {validateArtifact} from '../../../src/http/generated/auth-validators.js';
import type {NativeClient,NativeClientOptions,NativeRequestOptions,EnrollmentOptions,RequestFor,ResponseFor,EnabledOperationId,CredentialDispatchLease,CredentialProvenance,RuntimeCaptureFinalizer,NativeDispatchGuard,NativeProofDispatch,SemanticRequest,VerifiedPrincipalBinding,ApiResult,ArtifactDownloadResult} from './types';
import type {Artifact,Runtime,RuntimeIssue} from '../../../src/http/dto';
import {clientOperations,artifactClientMaxBytes} from '../../../src/http/generated/client-operations';
import {HttpTransport,Deadline,ClientFault,failure,faultResult} from './transport';

const receipts=new WeakMap<object,{binding:Readonly<VerifiedPrincipalBinding>;active:boolean;runtimeId:string;provider:object}>();
const record=(x:unknown):x is Record<string,unknown>=>typeof x==='object'&&x!==null&&!Array.isArray(x);
const closed=(x:unknown,keys:readonly string[]):boolean=>record(x)&&Object.keys(x).every(k=>keys.includes(k));
function observe(value:unknown):void{try{void Promise.resolve(value).catch(()=>{});}catch{}}
function abortCapture(value:unknown):void{try{if(value&&typeof value==='object'&&'abort'in value&&typeof value.abort==='function')observe(value.abort());}catch{}}
const token=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x);
const bindingKeys=['origin','workspaceId','principalId','slotId','slotGeneration','provenanceId'] as const;
function sameBinding(a:Readonly<VerifiedPrincipalBinding>,b:Readonly<VerifiedPrincipalBinding>):boolean{return bindingKeys.every(k=>a[k]===b[k]);}
function validBinding(x:unknown):x is VerifiedPrincipalBinding{return record(x)&&closed(x,bindingKeys)&&bindingKeys.every(k=>k==='slotGeneration'?Number.isSafeInteger(x[k])&&Number(x[k])>=0:typeof x[k]==='string'&&x[k].length>0);}
/** Typed facade over the same one-fetch transport as HubClient. No retry or cached authority. */
export function createNativeClient(configuration:NativeClientOptions):NativeClient {
 if(!closed(configuration,['origin','workspaceId','credentialProvider','fetch','timeoutMs']))throw new Error('Invalid native configuration');
 const base=nativeOrigin(configuration.origin),workspace=configuration.workspaceId,provider=configuration.credentialProvider;
 if(typeof workspace!=='string'||!(/^[a-zA-Z0-9_-]{1,128}$/).test(workspace))throw new Error('Invalid workspace ID');
 if(!provider||typeof provider.acquire!=='function'||typeof configuration.fetch!=='function')throw new Error('Native credential provider and fetch required');
 const timeout=configuration.timeoutMs??30000;if(!Number.isSafeInteger(timeout)||timeout<1||timeout>120000)throw new Error('Invalid native timeout');
 const transport=new HttpTransport(configuration.fetch);
 async function execute(operation:EnabledOperationId,input:unknown,options:NativeRequestOptions|EnrollmentOptions,enrollment=false):Promise<ApiResult<unknown>|ArtifactDownloadResult>{
  if(typeof operation!=='string'||!Object.hasOwn(clientOperations,operation)||!clientOperations[operation].native)return failure('OPERATION_UNAVAILABLE','Operation unavailable for native credentials');
  const contract=clientOperations[operation];
  if(contract.invocationMode==='enrollment'&&!enrollment)return failure('ENROLLMENT_REQUIRED','Use explicit runtime enrollment with protected proof capture');
  let request:Record<string,unknown>,key:string|undefined,proof:string|undefined,proofDispatch:NativeProofDispatch|undefined,expected:VerifiedPrincipalBinding|null,artifact:Artifact|undefined;
  let capture:EnrollmentOptions['captureRuntime']|undefined,signal:AbortSignal|undefined,dispatchGuard:NativeDispatchGuard|undefined,semantic:Readonly<SemanticRequest>;
  let upload:ReadableStream<Uint8Array>|undefined,url:string,headers:Headers,body:BodyInit|undefined;
  try{
   if(!closed(options,enrollment?['idempotencyKey','signal','expectedBinding','captureRuntime','dispatchGuard']:['idempotencyKey','signal','runtimeProof','expectedBinding','artifact','upload','dispatchGuard','runtimeProofDispatch']))throw new ClientFault('INVALID_REQUEST');
   capture=enrollment?(options as EnrollmentOptions).captureRuntime:undefined;signal=options.signal;if(signal!==undefined&&!(signal instanceof AbortSignal))throw new ClientFault('INVALID_REQUEST');
   const prepared=prepareNativeOperation(base,workspace,operation,input);request=prepared.request;
   const {request:_input,...semanticFields}=prepared;semantic=Object.freeze(semanticFields);dispatchGuard=options.dispatchGuard;if(dispatchGuard!==undefined&&typeof dispatchGuard!=='function')throw new ClientFault('INVALID_REQUEST');
   key=options.idempotencyKey;proof='runtimeProof'in options?options.runtimeProof:undefined;proofDispatch='runtimeProofDispatch'in options?options.runtimeProofDispatch:undefined;
   if(contract.idempotency&&(typeof key!=='string'||!key||key.trim()!==key||/[\r\n]/.test(key)))throw new ClientFault('INVALID_REQUEST');
   if(!contract.idempotency&&key!==undefined)throw new ClientFault('INVALID_REQUEST');
   if(contract.runtimeProof?(proofDispatch===undefined?!token(proof):typeof proofDispatch!=='function'||proof!==undefined):proof!==undefined||proofDispatch!==undefined)throw new ClientFault('INVALID_REQUEST');
   if(enrollment&&typeof(options as EnrollmentOptions).captureRuntime!=='function')throw new ClientFault('INVALID_REQUEST');
   if('artifact'in options&&!contract.upload&&!contract.download||'upload'in options&&!contract.upload)throw new ClientFault('INVALID_REQUEST');
   if(contract.upload||contract.download){
    artifact=snapshot((options as NativeRequestOptions).artifact);
    if(!validateArtifact(artifact)||artifact.workspace_id!==workspace||artifact.id!==(request.path as Record<string,unknown>).artifact_id||!Number.isSafeInteger(artifact.byte_size)||artifact.byte_size<0||artifact.byte_size>artifactClientMaxBytes||(contract.download?artifact.status!=='committed':!['staged','uploaded'].includes(artifact.status)))throw new ClientFault('INVALID_REQUEST');
    if(contract.upload){upload=(options as NativeRequestOptions).upload;if(!(upload instanceof ReadableStream)||upload.locked)throw new ClientFault('INVALID_REQUEST');}
   }
   expected=options.expectedBinding===undefined?null:Object.freeze(snapshot(options.expectedBinding));if(expected&&!validBinding(expected))throw new ClientFault('INVALID_REQUEST');
   if(expected&&(expected.origin!==base||expected.workspaceId!==workspace))throw new ClientFault('CREDENTIAL_CHANGED');
   url=base+prepared.path+(prepared.queryCanonical?'?'+prepared.queryCanonical:'');headers=new Headers({accept:contract.download?'*/*':'application/json'});
   if(key)headers.set('idempotency-key',key);if(proof)headers.set('x-runtime-token',proof);
   body=request.body===undefined?undefined:JSON.stringify(request.body);if(body!==undefined)headers.set('content-type','application/json');
  }catch(error){return faultResult(error instanceof ClientFault?error:new ClientFault('INVALID_REQUEST'));}
  const deadline=new Deadline(timeout,signal);let lease:CredentialDispatchLease|undefined,released=false,pendingReceipt:object|undefined;
  let captureFinalizer:RuntimeCaptureFinalizer|undefined,captureSucceeded=false;
  let handedOff=false,transfer:ReturnType<typeof boundedStream>|undefined,capturedSlot:{id:string;generation:number}|undefined;
  const release=()=>{if(!released&&lease){released=true;try{lease.release();}catch{/* A trusted provider must not throw or block release. */}}};
  const current=()=>{deadline.check();if(!lease||lease.isCurrent()!==true||capturedSlot&&(lease.slotId!==capturedSlot.id||lease.slotGeneration!==capturedSlot.generation))throw new ClientFault('CREDENTIAL_CHANGED');};
  let status:number|null=null,requestId:string|null=null,response:Response|undefined;
  try{
   deadline.check();let lateReleased=false;const releaseLate=(value:CredentialDispatchLease)=>{if(!lateReleased){lateReleased=true;try{value.release();}catch{}}};
   const acquiring=Promise.resolve(provider.acquire(expected,deadline.signal));
   try{lease=await deadline.wait(acquiring);}catch(error){void acquiring.then(releaseLate,()=>{});throw error;}
   current();
   if(typeof lease.slotId!=='string'||!lease.slotId||!Number.isSafeInteger(lease.slotGeneration)||lease.slotGeneration<0||typeof lease.use!=='function'||typeof lease.release!=='function')throw new ClientFault('CREDENTIAL_UNAVAILABLE');
   const slotId=lease.slotId,slotGeneration=lease.slotGeneration;capturedSlot={id:slotId,generation:slotGeneration};
   const live=lease.provenance&&receipts.get(lease.provenance);
   const restored=live?null:protectedAssociationFor(provider,lease);
   const bound=live??(restored?{...restored,active:true,provider}:null);
   if(bound&&(!bound.active||bound.provider!==provider||bound.binding.origin!==base||bound.binding.workspaceId!==workspace||bound.binding.slotId!==slotId||bound.binding.slotGeneration!==slotGeneration))throw new ClientFault('CREDENTIAL_CHANGED');
   if(expected&&(!bound||!sameBinding(expected,bound.binding)))throw new ClientFault('CREDENTIAL_CHANGED');
   if(contract.method!=='GET'&&!enrollment&&!bound)throw new ClientFault('CREDENTIAL_UNBOUND');
   if(contract.runtimeProof&&bound){for(const location of [request.body,request.path])if(record(location)&&typeof location.runtime_instance_id==='string'&&location.runtime_instance_id!==bound.runtimeId)throw new ClientFault('CREDENTIAL_CHANGED');}
   const sendGuard=dispatchGuard?await deadline.wait(Promise.resolve(dispatchGuard({request:semantic,binding:bound?.binding??null,lease,key}))):undefined;
   current();if(dispatchGuard&&typeof sendGuard!=='function')throw new ClientFault('INVALID_REQUEST');
   if(upload){transfer=boundedStream(upload,artifact!.byte_size,deadline,current);body=transfer.body;headers.set('content-type','application/octet-stream');headers.set('content-length',String(artifact!.byte_size));}
   response=await transport.open(url,{method:contract.method,headers,body,credentials:'omit',redirect:'manual',cache:'no-store',signal:deadline.signal,...(upload?{duplex:'half'}:{})} as RequestInit,deadline,send=>{
    let calls=0,inside=true,dispatched:Promise<Response>|undefined;
    try{const result=lease!.use(credential=>{if(!inside||++calls!==1)throw new ClientFault('CREDENTIAL_CHANGED');current();if(!token(credential))throw new ClientFault('CREDENTIAL_CHANGED');headers.set('authorization','Bearer '+credential);
     const dispatchNow=()=>{current();if(sendGuard){const check=sendGuard();observe(check);if(check!==undefined)throw new ClientFault('INVALID_REQUEST');}current();deadline.check();runFinalClockCheck(provider,lease!);deadline.check();return dispatched=send();};
     if(!proofDispatch)return dispatchNow();
     if(!bound)throw new ClientFault('CREDENTIAL_UNBOUND');
     let proofCalls=0,proofInside=true;
     try{const result=proofDispatch({binding:bound.binding,runtimeId:bound.runtimeId,lease:lease!},value=>{
      if(!proofInside||++proofCalls!==1||!token(value))throw new ClientFault('CREDENTIAL_CHANGED');current();headers.set('x-runtime-token',value);return dispatchNow();
     });observe(result);if(proofCalls!==1||result!==dispatched)throw new ClientFault('CREDENTIAL_CHANGED');return result;}finally{proofInside=false;}});
     void Promise.resolve(result).catch(()=>{});
     if(calls!==1||result!==dispatched)throw new ClientFault('CREDENTIAL_CHANGED');return result;
    }catch(error){void dispatched?.then(response=>{void response.body?.cancel().catch(()=>{});},()=>{});throw error;}finally{inside=false;}
   });
   current();status=response.status;
   if(response.type==='opaqueredirect'||response.redirected||response.status>=300&&response.status<400||response.url&&new URL(response.url).origin!==base){void response.body?.cancel().catch(()=>{});throw new ClientFault('INVALID_RESPONSE');}
   if(contract.download&&response.ok){
    const media=artifact!.media_type,safeMedia=/^[A-Za-z0-9!#$&^_.+\-]+\/[A-Za-z0-9!#$&^_.+\-]+(?:;[ \x21-\x7e]*)?$/.test(media)&&media.length<=1024?media:'application/octet-stream';
    if(response.status!==contract.status||!response.body||response.headers.get('content-length')!==String(artifact!.byte_size)||response.headers.get('content-type')!==safeMedia.trim()||!/^attachment(?:;|$)/i.test(response.headers.get('content-disposition')??'')){void response.body?.cancel().catch(()=>{});throw new ClientFault('INVALID_RESPONSE');}
    transfer=boundedStream(response.body,artifact!.byte_size,deadline,current,()=>{release();deadline.dispose();});handedOff=true;
    return {ok:true,status:response.status,data:{body:transfer.body,completion:transfer.completion,artifact:Object.freeze(artifact!)},requestId:null};
   }
   const result=await transport.json(response,{page:contract.page,status:contract.status,validateEnvelope:contract.validateResponse!,maxBytes:1048576,deadline,current});
   current();requestId=result.requestId;
   if(!result.ok)return result;
   if(upload){const completion=await deadline.wait(transfer!.completion);current();if(!completion.ok)throw new ClientFault(completion.error.code);}
   if(!enrollment)return result;
   const issue=result.data as RuntimeIssue;
   // A schema-valid correlation/metadata string is not permission to echo the
   // one-time proof, including when subsequent protected capture would fail.
   if(token(issue.runtime_token)&&(result.requestId.includes(issue.runtime_token)||JSON.stringify(issue.runtime).includes(issue.runtime_token))){requestId=null;throw new ClientFault('INVALID_RESPONSE');}
   if(issue.revealed!==true||!token(issue.runtime_token))throw new ClientFault('ENROLLMENT_PROOF_UNAVAILABLE');
   if(issue.runtime.workspace_id!==workspace||bound&&bound.binding.principalId!==issue.runtime.agent_id)throw new ClientFault('CREDENTIAL_CHANGED');
   const binding=Object.freeze({origin:base,workspaceId:workspace,principalId:issue.runtime.agent_id,slotId,slotGeneration,provenanceId:crypto.randomUUID()});
   const provenance=Object.freeze({binding}) as CredentialProvenance;pendingReceipt=provenance;
   const state={binding,active:false,runtimeId:issue.runtime.id,provider};receipts.set(provenance,state);
   beginPendingCapture(provider,binding,lease,issue.runtime_token,issue.runtime.id);
   let captureResolved=false;let capturing:Promise<void|RuntimeCaptureFinalizer>|undefined;
   try{
    capturing=Promise.resolve(capture!({runtime:Object.freeze(snapshot(issue.runtime)),runtimeProof:issue.runtime_token,provenance,signal:deadline.signal,lease}));
    const finalizer=await deadline.wait(capturing);captureResolved=true;
    if(finalizer!==undefined){if(!closed(finalizer,['commit','abort'])||typeof finalizer.commit!=='function'||typeof finalizer.abort!=='function')throw new ClientFault('CAPTURE_FAILED');captureFinalizer=finalizer;}
    current();if(captureFinalizer){const committed=captureFinalizer.commit();observe(committed);if(committed!==undefined)throw new ClientFault('CAPTURE_FAILED');}current();
   }catch(error){if(!captureResolved&&capturing)void capturing.then(abortCapture,()=>{});if(error instanceof ClientFault)throw error;throw new ClientFault('CAPTURE_FAILED');}
   state.active=true;pendingReceipt=undefined;captureSucceeded=true;
   return {ok:true,status:result.status,data:issue.runtime,requestId:result.requestId};
  }catch(error){return faultResult(error,status,requestId);}
  finally{if(lease){clearPendingCapture(lease);clearFinalClockCheck(lease);}if(!captureSucceeded&&captureFinalizer)abortCapture(captureFinalizer);if(pendingReceipt)receipts.delete(pendingReceipt);if(!handedOff){void response?.body?.cancel().catch(()=>{});transfer?.stop(new ClientFault('REQUEST_ABORTED'));release();deadline.dispose();}}
 }
 return Object.freeze({
  call:<K extends EnabledOperationId>(operation:K,request:RequestFor<K>,options:NativeRequestOptions={})=>execute(operation,request,options) as Promise<ResponseFor<K>>,
  enrollRuntime:(request:RequestFor<'createRuntime'>,options:EnrollmentOptions)=>execute('createRuntime',request,options,true) as Promise<ApiResult<Runtime>>
 });
}
