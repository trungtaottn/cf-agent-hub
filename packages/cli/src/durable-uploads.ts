import {randomUUID} from 'node:crypto';
import type {Artifact} from '../../../src/http/dto';
import {validateArtifact} from '../../../src/http/generated/auth-validators.js';
import {createNativeClient} from '../../client/src/native-client';
import {prepareNativeOperation,canonicalBody} from '../../client/src/native-request';
import {registerFinalClockCheck} from '../../client/src/native-provenance';
import type {ApiResult,CredentialDispatchLease,NativeClient,VerifiedPrincipalBinding} from '../../client/src/types';
import {ClientFault,failure} from '../../client/src/transport';
import {requestFingerprint} from './journal';
import {LinuxReplayClock,type DispatchStamp} from './replay-clock';
import {ProtectedCredentialProvider} from './secret-store';
import {DurableMutations,type ReplayClock} from './durable-mutations';
import {UploadStore,artifactReceipt,validArtifactTransition,type UploadIntent} from './upload-store';
import {openSealedContent} from './artifact-files';
export interface DurableUploadOptions {origin:string;workspaceId:string;provider:ProtectedCredentialProvider;store:UploadStore;mutations:DurableMutations;fetch:typeof globalThis.fetch;timeoutMs?:number;clock?:ReplayClock;}
const equal=(a:unknown,b:unknown)=>canonicalBody(a)===canonicalBody(b);
function denied():never{throw new ClientFault('JOURNAL_RECONCILIATION_REQUIRED');}
/** Raw bytes use a separate retained ledger, never the ordinary JSON journal. */
export class DurableUploads {
 readonly #options:DurableUploadOptions;readonly #client:NativeClient;readonly #clock:ReplayClock;#busy=false;
 constructor(options:DurableUploadOptions){this.#options=options;this.#clock=options.clock??new LinuxReplayClock();this.#client=createNativeClient({origin:options.origin,workspaceId:options.workspaceId,credentialProvider:options.provider,fetch:options.fetch,...(options.timeoutMs===undefined?{}:{timeoutMs:options.timeoutMs})});}
 async prepare(contentId:string,artifact:Artifact,options:{idempotencyKey?:string;interactive?:boolean}={}){
  if(this.#busy)denied();this.#busy=true;let lease:CredentialDispatchLease|undefined;
  try{const {provider,store,origin,workspaceId}=this.#options;
   if(Object.keys(options).some(k=>!['idempotencyKey','interactive'].includes(k))||options.idempotencyKey===undefined&&options.interactive!==true||!validateArtifact(artifact)||artifact.workspace_id!==workspaceId||!['staged','uploaded'].includes(artifact.status))denied();
   const binding=provider.binding(),runtime=provider.runtimeBinding();if(!binding||!runtime||binding.origin!==origin||binding.workspaceId!==workspaceId)denied();
   const {request:_input,...request}=prepareNativeOperation(origin,workspaceId,'uploadArtifactContent',{path:{artifact_id:artifact.id}});const key=options.idempotencyKey??null;provider.assertNoSecrets(JSON.stringify({artifact,key,request}));
   lease=await provider.acquire(binding);const activeLease=lease;
   const intent:UploadIntent={id:randomUUID(),contentId,binding,runtimeId:runtime.runtimeId,artifact:JSON.parse(JSON.stringify(artifact)),request,fingerprint:requestFingerprint(request),key,firstDispatch:null,state:'prepared',createdAt:Date.now(),outcome:null,receipt:null,settledAt:null};
   activeLease.use(()=>{provider.assertLeaseBinding(binding,activeLease);if(!equal(provider.runtimeBinding(),runtime))denied();store.createUpload(intent);});if(key===null){const generated=randomUUID();activeLease.use(()=>{provider.assertLeaseBinding(binding,activeLease);store.updateUpload(intent.id,current=>{if(current.key!==null||current.firstDispatch!==null)denied();current.key=generated;});});}return store.inspectUpload(intent.id);
  }finally{lease?.release();this.#busy=false;}
 }
 #validate(intent:UploadIntent):void{const {provider,origin,workspaceId}=this.#options;if(intent.binding.origin!==origin||intent.binding.workspaceId!==workspaceId||!validateArtifact(intent.artifact)||intent.artifact.workspace_id!==workspaceId||!['staged','uploaded'].includes(intent.artifact.status))denied();const {request:_input,...request}=prepareNativeOperation(origin,workspaceId,'uploadArtifactContent',{path:{artifact_id:intent.artifact.id}});if(!equal(intent.request,request)||intent.fingerprint!==requestFingerprint(request))denied();provider.assertNoSecrets(JSON.stringify(intent));}
 #clockCheck(stamp:DispatchStamp|null):void{if(!stamp)denied();const now=this.#clock.sample(),elapsed=now.nowMonotonicMs-stamp.firstDispatchMonotonicMs;if(!now.continuityVerified||!now.suspendAwareElapsedVerified||now.clockEpochId!==stamp.clockEpochId||!Number.isSafeInteger(now.nowMonotonicMs)||elapsed<0||elapsed>=86400000)denied();}
 async dispatch(id:string):Promise<ApiResult<unknown>>{
  if(this.#busy)return failure('LOCAL_INPUT_REJECTED','Upload coordinator is busy');this.#busy=true;let opened:ReturnType<typeof openSealedContent>|undefined;
  try{const {provider,store,mutations}=this.#options,intent=store.upload(id);this.#validate(intent);if(intent.key===null||intent.state==='settled'||intent.state==='reconciliation-required')denied();if(intent.firstDispatch)this.#clockCheck(intent.firstDispatch);
   const c=store.content(intent.contentId);if(c.state!=='ready'||!c.sealed||c.sealed.size!==intent.artifact.byte_size||c.sealed.sha256!==intent.artifact.sha256)denied();opened=openSealedContent(store.spoolDirectory,c.sealed);
   const result=await this.#client.call('uploadArtifactContent',{path:{artifact_id:intent.artifact.id}},{artifact:intent.artifact,upload:opened.body,idempotencyKey:intent.key,expectedBinding:intent.binding,
    runtimeProofDispatch:<T>(context:{binding:VerifiedPrincipalBinding;runtimeId:string;lease:CredentialDispatchLease},send:(proof:string)=>T)=>{if(context.runtimeId!==intent.runtimeId)denied();return provider.dispatchRuntimeProof({...context.binding,runtimeId:context.runtimeId},context.lease,send);},
    dispatchGuard:context=>{if(context.key!==intent.key||!equal(context.binding,intent.binding)||requestFingerprint(context.request)!==intent.fingerprint)denied();let admitted:DispatchStamp|null=null;
     registerFinalClockCheck(provider,context.lease,()=>this.#clockCheck(admitted));return ()=>{
      provider.assertLeaseBinding(intent.binding,context.lease);mutations.assertUploadHeartbeatAllowed(intent.binding,intent.runtimeId,context.lease);
      const current=store.updateUpload(id,value=>{this.#validate(value);if(!equal({...value,firstDispatch:intent.firstDispatch,state:intent.state,outcome:intent.outcome},intent)||value.state==='settled'||value.state==='reconciliation-required')denied();if(value.firstDispatch)this.#clockCheck(value.firstDispatch);else value.firstDispatch=this.#clock.stamp(value.fingerprint);value.state='pending';admitted={...value.firstDispatch};});if(!current.firstDispatch)denied();
     };
    }});
   provider.assertNoSecrets(JSON.stringify(result));if(result.ok&&!validArtifactTransition(artifactReceipt(intent.artifact),artifactReceipt(result.data),'uploaded'))denied();store.updateUpload(id,value=>{if(value.firstDispatch){value.outcome={status:result.status,ok:result.ok};if(result.ok){value.state='settled';value.receipt=artifactReceipt(result.data);}}});return result;
  }catch{return failure('JOURNAL_RECONCILIATION_REQUIRED','Upload remains retained; no automatic resend or replacement. Inspect its original intent.');}finally{opened?.close();this.#busy=false;}
 }
 inspect(id:string){const intent=this.#options.store.upload(id);this.#validate(intent);return this.#options.store.inspectUpload(id);}
}
