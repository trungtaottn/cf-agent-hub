import type {ApiResult,HubClientOptions,Operation,OperationInputs,Page,RequestOptions,ServerErrorCode} from './types';
import {
 validateAuthStartRequest,validateAuthLogoutRequest,validateAuthStartData,validateAuthSession,validateAuthLogoutData,validateProfileWriteRequest,validatePreferencesWriteRequest,
 validateWorkspace,validateConfiguration,validateProfileData,validateProfilePreview,validateProfileExport,validatePreferencesData,
 validateOperations,validateEvent,validateMessage
} from '../../../src/http/generated/auth-validators.js';
import {httpFieldNames} from '../../../src/http/generated/http-schemas';

type Route = {path:string;method:'GET'|'POST'|'PUT';csrf?:boolean;key?:boolean;page?:boolean;validate?:(data:unknown)=>boolean};
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
const requestId=(value:unknown,maxLength?:number):string|null=>nonempty(value)&&(maxLength===undefined||Array.from(value).length<=maxLength)?value:null;
const routes:Record<Operation,Route>={
 getWorkspace:{path:'',method:'GET',validate:validateWorkspace},
 startAuth:{path:'auth/start',method:'POST',validate:validateAuthStartData},
 getAuthSession:{path:'auth/session',method:'GET',validate:validateAuthSession},
 logoutAuth:{path:'auth/logout',method:'POST',csrf:true,validate:validateAuthLogoutData},
 getConfiguration:{path:'configuration',method:'GET',validate:validateConfiguration},
 getProfile:{path:'profile',method:'GET',validate:validateProfileData},
 previewProfile:{path:'profile:preview',method:'POST',csrf:true,key:true,validate:validateProfilePreview},
 putProfile:{path:'profile',method:'PUT',csrf:true,key:true,validate:validateProfileData},
 exportProfile:{path:'profile:export',method:'GET',validate:validateProfileExport},
 getPreferences:{path:'preferences',method:'GET',validate:validatePreferencesData},
 putPreferences:{path:'preferences',method:'PUT',csrf:true,key:true,validate:validatePreferencesData},
 getOperations:{path:'operations',method:'GET',validate:validateOperations},
 listEvents:{path:'events',method:'GET',page:true,validate:data=>Array.isArray(data)&&data.every(validateEvent)},
 getThread:{path:'threads',method:'GET',page:true,validate:data=>Array.isArray(data)&&data.every(validateMessage)}
};
const messages:Record<ServerErrorCode,string>={
 INVALID_REQUEST:'Invalid request',UNAUTHENTICATED:'Authentication required',FORBIDDEN:'Access denied',NOT_FOUND:'Resource unavailable',
 VERSION_CONFLICT:'Resource version changed',IDEMPOTENCY_CONFLICT:'Idempotency key conflicts with original intent',INVALID_STATE:'Invalid resource state',
 STALE_RUN:'Run is stale',APPROVAL_EXPIRED:'Approval expired',CURSOR_EXPIRED:'Cursor expired',LIMIT_EXCEEDED:'Request limit exceeded',
 RATE_LIMITED:'Request rate exceeded',DEPENDENCY_UNAVAILABLE:'Dependency unavailable',INTERNAL_ERROR:'Internal request failure'
};
const failure=(code:string,message:string,status:number|null=null,retryable=false,id:string|null=null,details?:Record<string,unknown>):ApiResult<never>=>({
 ok:false,status,error:{code,message,retryable,...(details&&Object.keys(details).length?{details}:{})},requestId:id
});
function parsePage(value:unknown):Page|null{
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
function validInput(operation:Operation,input:Record<string,unknown>):boolean{
 if(operation==='startAuth')return validateAuthStartRequest(input);
 if(operation==='logoutAuth')return validateAuthLogoutRequest(input);
 if(operation==='putPreferences')return validatePreferencesWriteRequest(input);
 if(operation==='previewProfile'||operation==='putProfile')return validateProfileWriteRequest(input);
 if(operation!=='listEvents'&&operation!=='getThread')return Object.keys(input).length===0;
 const keys=operation==='listEvents'?['cursor','limit','after_sequence']:['cursor','limit','thread_id'];
 if(Object.keys(input).some(key=>!keys.includes(key)))return false;
 if(operation==='getThread'&&(!nonempty(input.thread_id)||input.thread_id==='.'||input.thread_id==='..'))return false;
 if(input.cursor!==undefined&&!nonempty(input.cursor))return false;
 if(input.limit!==undefined&&(!Number.isInteger(input.limit)||Number(input.limit)<1||Number(input.limit)>(operation==='getThread'?500:200)))return false;
 if(input.after_sequence!==undefined&&(!Number.isSafeInteger(input.after_sequence)||Number(input.after_sequence)<0||input.cursor!==undefined))return false;
 return true;
}

/** Browser-only R1 cookie transport. One fetch per call; replay belongs to the caller. */
export class HubClient {
 readonly #workspaceId:string;
 readonly #fetch:typeof globalThis.fetch;
 #csrfToken:string|null=null;
 constructor(workspaceId:string,options:HubClientOptions={}){
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(workspaceId))throw new Error('Invalid workspace ID');
  this.#workspaceId=workspaceId;this.#fetch=options.fetch??globalThis.fetch.bind(globalThis);
 }
 /** Session-bound token stays in this object only; callers supply the /auth/session token. */
 setCsrfToken(token:string|null):void{
  if(token!==null&&(!nonempty(token)||/[\r\n]/.test(token)))throw new Error('Invalid CSRF token');
  this.#csrfToken=token;
 }
 async request<T=unknown,O extends Operation=Operation>(operation:O,input:OperationInputs[O],options:RequestOptions={}):Promise<ApiResult<T>>{
  if(!Object.hasOwn(routes,operation))return failure('OPERATION_UNAVAILABLE','Operation unavailable in the R1 browser client');
  const route=routes[operation];
  if(!record(input)||!validInput(operation,input))return failure('INVALID_REQUEST','Invalid request');
  if(route.key&&(!nonempty(options.idempotencyKey)||options.idempotencyKey.trim()!==options.idempotencyKey||/[\r\n]/.test(options.idempotencyKey)))
   return failure('INVALID_REQUEST','Explicit idempotency key required');
  if(route.csrf&&!this.#csrfToken)return failure('CSRF_REQUIRED','Session CSRF token required');
  let url='/v2/workspaces/'+this.#workspaceId+(route.path?'/'+route.path:'');
  const headers=new Headers({accept:'application/json'});
  let body:string|undefined;
  try{
   if(operation==='getThread')url+='/'+encodeURIComponent((input as OperationInputs['getThread']).thread_id);
   if(route.page){
    const query=new URLSearchParams();
    for(const name of ['cursor','limit','after_sequence'])if((input as Record<string,unknown>)[name]!==undefined)query.set(name,String((input as Record<string,unknown>)[name]));
    if(query.size)url+='?'+query.toString();
   }
   if(route.method!=='GET'){body=JSON.stringify(input);headers.set('content-type','application/json');}
   if(route.key)headers.set('idempotency-key',options.idempotencyKey!);
   if(route.csrf)headers.set('x-csrf-token',this.#csrfToken!);
  }catch{return failure('INVALID_REQUEST','Invalid request');}
  let response:Response;
  try{
   response=await this.#fetch(url,{method:route.method,headers,body,credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:options.signal});
  }catch(error){
   const aborted=options.signal?.aborted||(error instanceof Error&&error.name==='AbortError');
   return failure(aborted?'REQUEST_ABORTED':'NETWORK_ERROR',aborted?'Request aborted':'Network request failed',null,!aborted);
  }
  if(response.status===401||response.status===403)this.#csrfToken=null;
  let envelope:unknown;
  try{envelope=await response.json();}catch{return failure('INVALID_RESPONSE','Invalid server response',response.status);}
  if(!record(envelope))return failure('INVALID_RESPONSE','Invalid server response',response.status);
  if(!response.ok){
   const error=envelope.error;
   if(!record(error)||typeof error.code!=='string'||!Object.hasOwn(messages,error.code)||typeof error.retryable!=='boolean'||typeof error.message!=='string'||!requestId(error.request_id))
    return failure('INVALID_RESPONSE','Invalid server response',response.status);
   return failure(error.code,messages[error.code as ServerErrorCode],response.status,error.retryable,requestId(error.request_id),safeDetails(error.details));
  }
  const id=requestId(envelope.request_id,route.page?undefined:128),page=route.page?parsePage(envelope.page):undefined;
  if(!id||!Object.hasOwn(envelope,'data')||!route.validate?.(envelope.data)||(route.page&&!page))
   return failure('INVALID_RESPONSE','Invalid server response',response.status);
  if(operation==='logoutAuth')this.#csrfToken=null;
  return {ok:true,status:response.status,data:envelope.data as T,requestId:id,...(page?{page}:{})};
 }
}
