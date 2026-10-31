import type {ApiResult,Page,ServerErrorCode} from './types';
import {httpFieldNames} from '../../../src/http/generated/http-schemas';
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
const requestId=(value:unknown,maxLength?:number):string|null=>nonempty(value)&&(maxLength===undefined||Array.from(value).length<=maxLength)?value:null;
const messages:Record<ServerErrorCode,string>={
 INVALID_REQUEST:'Invalid request',UNAUTHENTICATED:'Authentication required',FORBIDDEN:'Access denied',NOT_FOUND:'Resource unavailable',
 VERSION_CONFLICT:'Resource version changed',IDEMPOTENCY_CONFLICT:'Idempotency key conflicts with original intent',INVALID_STATE:'Invalid resource state',
 STALE_RUN:'Run is stale',APPROVAL_EXPIRED:'Approval expired',CURSOR_EXPIRED:'Cursor expired',LIMIT_EXCEEDED:'Request limit exceeded',
 RATE_LIMITED:'Request rate exceeded',DEPENDENCY_UNAVAILABLE:'Dependency unavailable',INTERNAL_ERROR:'Internal request failure'
};
export const failure=(code:string,message:string,status:number|null=null,retryable=false,id:string|null=null,details?:Record<string,unknown>):ApiResult<never>=>({
 ok:false,status,error:{code,message,retryable,...(details&&Object.keys(details).length?{details}:{})},requestId:id
});
export function parsePage(value:unknown):Page|null{
 if(!record(value)||Object.keys(value).some(key=>key!=='next_cursor'&&key!=='has_more')||typeof value.has_more!=='boolean')return null;
 if(value.next_cursor!==null&&!nonempty(value.next_cursor))return null;
 if(value.has_more!==(value.next_cursor!==null))return null;
 return {next_cursor:value.next_cursor as string|null,has_more:value.has_more};
}
function safeDetails(value:unknown):Record<string,unknown>{
 const details:Record<string,unknown>={};if(!record(value))return details;
 const field=value.field;
 if(typeof field==='string'&&field.length<=256&&field.startsWith('/')&&field.slice(1).split('/').every(segment=>(httpFieldNames as readonly string[]).includes(segment)||/^[0-9]{1,5}$/.test(segment)))details.field=field;
 for(const key of ['current_version','current_proposal_version','current_revision','retry_after_seconds'] as const)
  if(typeof value[key]==='number'&&Number.isSafeInteger(value[key])&&value[key]>=0)details[key]=value[key];
 if(value.feature==='tasks'||value.feature==='artifacts')details.feature=value.feature;
 return details;
}

/** Safe local failures never retain the original exception, request or response. */
export class ClientFault extends Error {constructor(readonly code:string){super(code);}}
export function faultResult(error:unknown,status:number|null=null,id:string|null=null):ApiResult<never>{
 const supplied=error instanceof ClientFault?error.code:'NETWORK_ERROR';
 const descriptions:Record<string,string>={REQUEST_TIMEOUT:'Request timed out; reconcile the original intent',REQUEST_ABORTED:'Request aborted',CREDENTIAL_CHANGED:'Credential binding changed',CREDENTIAL_UNBOUND:'Verified credential provenance required',CREDENTIAL_UNAVAILABLE:'Credential unavailable',INVALID_RESPONSE:'Invalid server response',INVALID_REQUEST:'Invalid request',CAPTURE_FAILED:'Enrollment may have succeeded; proof capture failed',ENROLLMENT_PROOF_UNAVAILABLE:'Enrollment proof unavailable; explicitly enroll a fresh runtime',STREAM_INVALID:'Invalid artifact stream'};
 const code=Object.hasOwn(descriptions,supplied)?supplied:'NETWORK_ERROR';
 return failure(code,descriptions[code]??'Network request failed',status,false,id);
}
/** One total deadline includes credential acquisition, body consumption and capture. */
export class Deadline {
 readonly controller=new AbortController();readonly signal=this.controller.signal;
 #timer:ReturnType<typeof setTimeout>;#external?:AbortSignal;#abort:()=>void;#code='REQUEST_TIMEOUT';#expires:number;
 constructor(timeoutMs:number,external?:AbortSignal){
  this.#expires=performance.now()+timeoutMs;this.#external=external;this.#abort=()=>{this.#code='REQUEST_ABORTED';this.controller.abort();};
  this.#timer=setTimeout(()=>this.controller.abort(),timeoutMs);
  if(external?.aborted)this.#abort();else external?.addEventListener('abort',this.#abort,{once:true});
 }
 check():void{if(!this.signal.aborted&&performance.now()>=this.#expires)this.controller.abort();if(this.signal.aborted)throw new ClientFault(this.#code);}
 async wait<T>(pending:PromiseLike<T>):Promise<T>{
  // The caller already created this work; observe rejection even if check throws.
  const observed=Promise.resolve(pending);void observed.catch(()=>{});
  this.check();let abort:()=>void=()=>{};
  const stopped=new Promise<never>((_,reject)=>{abort=()=>reject(new ClientFault(this.#code));this.signal.addEventListener('abort',abort,{once:true});});
  try{const value=await Promise.race([observed,stopped]);this.check();return value;}finally{this.signal.removeEventListener('abort',abort);}
 }
 dispose():void{clearTimeout(this.#timer);this.#external?.removeEventListener('abort',this.#abort);}
}
export interface JsonPolicy {page?:boolean;validate?:(data:unknown)=>boolean;validateEnvelope?:(body:unknown)=>boolean;status?:number;maxBytes?:number;deadline?:Deadline;current?:()=>void;}
/** Both lanes share the one fetch, failure classification and JSON envelope parser. */
export class HttpTransport {
 constructor(readonly fetcher:typeof globalThis.fetch){}
 async open(url:string,init:RequestInit,deadline?:Deadline,dispatch?:(send:()=>Promise<Response>)=>Promise<Response>):Promise<Response>{
  const send=()=>this.fetcher(url,init);
  let pending:Promise<Response>|undefined;
  try{deadline?.check();pending=dispatch?dispatch(send):send();return await(deadline?deadline.wait(pending):pending);}
  catch(error){void pending?.then(response=>{void response.body?.cancel().catch(()=>{});},()=>{});if(error instanceof ClientFault)throw error;throw new ClientFault(init.signal?.aborted||error instanceof Error&&error.name==='AbortError'?'REQUEST_ABORTED':'NETWORK_ERROR');}
 }
 async json<T>(response:Response,policy:JsonPolicy):Promise<ApiResult<T>>{
  const invalid=()=>failure('INVALID_RESPONSE','Invalid server response',response.status);
  let envelope:unknown;
  try{
   if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'){void response.body?.cancel().catch(()=>{});return invalid();}
   if(policy.maxBytes!==undefined){
    const reader=response.body?.getReader();if(!reader)return invalid();const chunks:Uint8Array[]=[];let count=0;
    try{for(;;){const read=reader.read();const {value,done}=await(policy.deadline?policy.deadline.wait(read):read);policy.current?.();if(done)break;if(!value.byteLength)throw new ClientFault('INVALID_RESPONSE');count+=value.byteLength;if(count>policy.maxBytes)throw new ClientFault('INVALID_RESPONSE');chunks.push(value);}}
    finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   }else envelope=await response.json();
  }catch(error){if(error instanceof ClientFault)return faultResult(error,response.status);return invalid();}
  if(!record(envelope))return invalid();
  if(!response.ok){
   const error=envelope.error;
   if(!record(error)||typeof error.code!=='string'||!Object.hasOwn(messages,error.code)||typeof error.retryable!=='boolean'||typeof error.message!=='string'||!requestId(error.request_id))return invalid();
   return failure(error.code,messages[error.code as ServerErrorCode],response.status,error.retryable,requestId(error.request_id),safeDetails(error.details));
  }
  const id=requestId(envelope.request_id,policy.validateEnvelope||policy.page?undefined:128),page=policy.page?parsePage(envelope.page):undefined;
  if(policy.status!==undefined&&response.status!==policy.status||!id||!Object.hasOwn(envelope,'data')||policy.validate&&!policy.validate(envelope.data)||policy.validateEnvelope&&!policy.validateEnvelope(envelope)||policy.page&&!page)return invalid();
  return {ok:true,status:response.status,data:envelope.data as T,requestId:id,...(page?{page}:{})};
 }
}
