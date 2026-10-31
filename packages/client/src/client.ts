import {clientOperations} from '../../../src/http/generated/client-operations';
import {prepareNativeOperation} from './native-request';
import type {HttpOperationData} from '../../../src/http/dto';
import type {BrowserComposeOperation,BrowserComposeOptions,BrowserComposeReconciliation,BrowserReadOperation,BrowserTaskCommandOperation,BrowserTaskCommandOptions,RequestFor} from './types';
import {HttpTransport,Deadline,ClientFault,failure,faultResult} from './transport';
import type {ApiResult,HubClientOptions,Operation,OperationInputs,RequestOptions} from './types';
import {
 validateAuthStartRequest,validateAuthLogoutRequest,validateAuthStartData,validateAuthSession,validateAuthLogoutData,validateProfileWriteRequest,validatePreferencesWriteRequest,
 validateWorkspace,validateConfiguration,validateProfileData,validateProfilePreview,validateProfileExport,validatePreferencesData,
 validateOperations,validateEvent,validateMessage
} from '../../../src/http/generated/auth-validators.js';
import {httpFieldNames} from '../../../src/http/generated/http-schemas';

type Route = {path:string;method:'GET'|'POST'|'PUT';csrf?:boolean;key?:boolean;page?:boolean;validate?:(data:unknown)=>boolean};
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
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
type ValidationIssue={instancePath?:string;keyword?:string;params?:Record<string,unknown>};
type ValidatorWithErrors=((input:unknown)=>boolean)&{errors?:readonly ValidationIssue[]|null};
const knownFieldSegment=(segment:string):boolean=>
 (httpFieldNames as readonly string[]).includes(segment)||/^[0-9]{1,5}$/.test(segment);

/** Report a known JSON Pointer location, never an untrusted additional-property name. */
function localSettingsValidationDetails(operation:Operation,validated:boolean):Record<string,unknown>|undefined{
 const preferences=operation==='putPreferences';
 if(!preferences&&operation!=='previewProfile'&&operation!=='putProfile')return undefined;
 const fallback=preferences?'/preferences':'/profile';
 if(!validated)return {field:fallback};
 const validator=(preferences?validatePreferencesWriteRequest:validateProfileWriteRequest) as ValidatorWithErrors;
 const issue=validator.errors?.[0];
 const path=issue?.instancePath;
 const segments=typeof path==='string'&&path.startsWith('/')?path.slice(1).split('/'):[] as string[];
 if(issue?.keyword==='required'){
  const missing=issue.params?.missingProperty;
  // Ajv's missingProperty is attacker-influenced on an open object: admit only canonical field names.
  if(typeof missing==='string'&&knownFieldSegment(missing))segments.push(missing);
 }
 const permittedRoot=preferences?['preferences','expected_preferences_revision']:['profile','expected_profile_revision'];
 if(!segments.length||!permittedRoot.includes(segments[0]!)||!segments.every(knownFieldSegment))return {field:fallback};
 const field='/'+segments.join('/');
 return {field:field.length<=256?field:fallback};
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
 readonly #transport:HttpTransport;
 #csrfToken:string|null=null;
 constructor(workspaceId:string,options:HubClientOptions={}){
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(workspaceId))throw new Error('Invalid workspace ID');
  this.#workspaceId=workspaceId;this.#transport=new HttpTransport(options.fetch??globalThis.fetch.bind(globalThis));
 }
 /** Read-only cookie lane uses the same generated map, bounds and transport as native reads.
  * A map entry is implementation support, not a current permission/capability assertion. */
 async read<K extends BrowserReadOperation>(operation:K,input:RequestFor<K>,options:Pick<RequestOptions,'signal'>={}):Promise<ApiResult<HttpOperationData[K]>>{
  const allowed:readonly string[]=['listTasks','getTask','getRun','listTaskResults','getArtifact','listEvents','listAgents','getAgent'];
  if(!allowed.includes(operation))return failure('OPERATION_UNAVAILABLE','Operation unavailable in the browser read surface');
  let prepared:ReturnType<typeof prepareNativeOperation>;
  try{
   if(!record(options)||Object.keys(options).some(key=>key!=='signal')||options.signal!==undefined&&!(options.signal instanceof AbortSignal))throw new ClientFault('INVALID_REQUEST');
   // Base is validation-only; dispatch is exclusively root-relative, never this reserved origin.
   prepared=prepareNativeOperation('https://browser.invalid',this.#workspaceId,operation,input);
  }catch{return failure('INVALID_REQUEST','Invalid request');}
  const contract=clientOperations[operation],deadline=new Deadline(30_000,options.signal);
  try{
   const response=await this.#transport.open(prepared.path+(prepared.queryCanonical?'?'+prepared.queryCanonical:''),{method:'GET',headers:{accept:'application/json'},credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:deadline.signal},deadline);
   if(response.status===401||response.status===403)this.#csrfToken=null;
   return await this.#transport.json<HttpOperationData[K]>(response,{page:contract.page,status:contract.status,validateEnvelope:contract.validateResponse,maxBytes:1048576,deadline});
  }catch(error){return faultResult(error);}finally{deadline.dispose();}
 }
 /** Closed composition lane: durable intent/key ownership remains with the caller.
  * No native credential plumbing, automatic retry or caller-controlled headers. */
 async compose<K extends BrowserComposeOperation>(operation:K,input:RequestFor<K>,options:BrowserComposeOptions):Promise<ApiResult<HttpOperationData[K]>>{
  const allowed:readonly string[]=['createMessage','createTask'];
  if(!allowed.includes(operation))return failure('OPERATION_UNAVAILABLE','Operation unavailable in the browser composition surface');
  let prepared:ReturnType<typeof prepareNativeOperation>,headers:Headers,signal:AbortSignal|undefined;
  try{
   if(!record(options)||Object.keys(options).some(key=>key!=='idempotencyKey'&&key!=='signal'&&key!=='admissionId'))throw new ClientFault('INVALID_REQUEST');
   const key=options.idempotencyKey;signal=options.signal;
   if(options.admissionId!==undefined&&(typeof options.admissionId!=='string'||!/^event_[a-f0-9]{48}$/.test(options.admissionId)))throw new ClientFault('INVALID_REQUEST');
   if(!nonempty(key)||key.trim()!==key||/[\r\n]/.test(key)||signal!==undefined&&!(signal instanceof AbortSignal))throw new ClientFault('INVALID_REQUEST');
   prepared=prepareNativeOperation('https://browser.invalid',this.#workspaceId,operation,input);
   if(!this.#csrfToken)return failure('CSRF_REQUIRED','Session CSRF token required');
   headers=new Headers({accept:'application/json','content-type':'application/json','idempotency-key':key,'x-csrf-token':this.#csrfToken});
   if(options.admissionId)headers.set('x-creation-admission',options.admissionId);
  }catch{return failure('INVALID_REQUEST','Invalid request');}
  const contract=clientOperations[operation],deadline=new Deadline(30_000,signal);
  try{
   const response=await this.#transport.open(prepared.path,{method:prepared.method,headers,body:prepared.canonicalBody,credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:deadline.signal},deadline);
   if(response.status===401||response.status===403)this.#csrfToken=null;
   return await this.#transport.json<HttpOperationData[K]>(response,{status:contract.status,validateEnvelope:contract.validateResponse,maxBytes:1048576,deadline});
  }catch(error){return faultResult(error);}finally{deadline.dispose();}
 }
 /** Prepare identity without domain creation. Current cookie and CSRF are independently required. */
 async prepareCreation<K extends BrowserComposeOperation>(operation:K,input:RequestFor<K>,options:Pick<BrowserComposeOptions,'idempotencyKey'|'signal'>):Promise<ApiResult<HttpOperationData['prepareTaskCreation']>>{
  if(operation!=='createMessage'&&operation!=='createTask')return failure('OPERATION_UNAVAILABLE','Operation unavailable in browser admission recovery');
  const counterpart=operation==='createMessage'?'prepareMessageCreation':'prepareTaskCreation',contract=clientOperations[counterpart];
  let prepared:ReturnType<typeof prepareNativeOperation>,headers:Headers,signal:AbortSignal|undefined;
  try{
   if(!record(options)||Object.keys(options).some(key=>key!=='idempotencyKey'&&key!=='signal'))throw new ClientFault('INVALID_REQUEST');
   const key=options.idempotencyKey;signal=options.signal;
   if(!nonempty(key)||key.trim()!==key||/[\r\n]/.test(key)||signal!==undefined&&!(signal instanceof AbortSignal))throw new ClientFault('INVALID_REQUEST');
   prepared=prepareNativeOperation('https://browser.invalid',this.#workspaceId,operation,input);
   if(!(contract.validateRequest as (value:unknown)=>boolean)(input))throw new ClientFault('INVALID_REQUEST');
   if(!this.#csrfToken)return failure('CSRF_REQUIRED','Session CSRF token required');
   headers=new Headers({accept:'application/json','content-type':'application/json','idempotency-key':key,'x-csrf-token':this.#csrfToken});
  }catch{return failure('INVALID_REQUEST','Invalid request');}
  const deadline=new Deadline(30_000,signal);
  try{
   const path=contract.path.replace('{workspace_id}',this.#workspaceId);
   const response=await this.#transport.open(path,{method:contract.method,headers,body:prepared.canonicalBody,credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:deadline.signal},deadline);
   if(response.status===401||response.status===403)this.#csrfToken=null;
   return await this.#transport.json<HttpOperationData['prepareTaskCreation']>(response,{status:contract.status,validateEnvelope:contract.validateResponse,maxBytes:1048576,deadline});
  }catch(error){return faultResult(error);}finally{deadline.dispose();}
 }

 /** Read-only original-admission check; never retries creation. */
 async reconcileCreation<K extends BrowserComposeOperation>(operation:K,input:RequestFor<K>,options:BrowserComposeOptions):Promise<ApiResult<BrowserComposeReconciliation<K>>>{
  if(operation!=='createMessage'&&operation!=='createTask')return failure('OPERATION_UNAVAILABLE','Operation unavailable in browser admission recovery');
  const counterpart=operation==='createMessage'?'reconcileMessageCreation':'reconcileTaskCreation',contract=clientOperations[counterpart];
  let prepared:ReturnType<typeof prepareNativeOperation>,headers:Headers,signal:AbortSignal|undefined;
  try{
   if(!record(options)||Object.keys(options).some(key=>key!=='idempotencyKey'&&key!=='signal'&&key!=='admissionId'))throw new ClientFault('INVALID_REQUEST');
   const key=options.idempotencyKey;signal=options.signal;
   if(options.admissionId!==undefined&&(typeof options.admissionId!=='string'||!/^event_[a-f0-9]{48}$/.test(options.admissionId)))throw new ClientFault('INVALID_REQUEST');
   if(!nonempty(key)||key.trim()!==key||/[\r\n]/.test(key)||signal!==undefined&&!(signal instanceof AbortSignal))throw new ClientFault('INVALID_REQUEST');
   prepared=prepareNativeOperation('https://browser.invalid',this.#workspaceId,operation,input);
   if(!(contract.validateRequest as (value:unknown)=>boolean)(input))throw new ClientFault('INVALID_REQUEST');
   if(!this.#csrfToken)return failure('CSRF_REQUIRED','Session CSRF token required');
   headers=new Headers({accept:'application/json','content-type':'application/json','idempotency-key':key,'x-csrf-token':this.#csrfToken});
   if(options.admissionId)headers.set('x-creation-admission',options.admissionId);
  }catch{return failure('INVALID_REQUEST','Invalid request');}
  const deadline=new Deadline(30_000,signal);
  try{
   const path=contract.path.replace('{workspace_id}',this.#workspaceId);
   const response=await this.#transport.open(path,{method:contract.method,headers,body:prepared.canonicalBody,credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:deadline.signal},deadline);
   if(response.status===401||response.status===403)this.#csrfToken=null;
   return await this.#transport.json<BrowserComposeReconciliation<K>>(response,{status:contract.status,validateEnvelope:contract.validateResponse,maxBytes:1048576,deadline});
  }catch(error){return faultResult(error);}finally{deadline.dispose();}
 }
 /** Four canonical task mutations only. No native credentials, retries or caller headers. */
 async command<K extends BrowserTaskCommandOperation>(operation:K,input:RequestFor<K>,options:BrowserTaskCommandOptions):Promise<ApiResult<HttpOperationData[K]>>{
  const allowed:readonly string[]=['readyTask','cancelTask','requeueTask','acceptTaskResult'];
  if(!allowed.includes(operation))return failure('OPERATION_UNAVAILABLE','Operation unavailable in the browser task command surface');
  let prepared:ReturnType<typeof prepareNativeOperation>,headers:Headers,signal:AbortSignal|undefined;
  try{
   if(!record(options)||Object.keys(options).some(key=>key!=='idempotencyKey'&&key!=='signal'))throw new ClientFault('INVALID_REQUEST');
   const key=options.idempotencyKey;signal=options.signal;
   if(!nonempty(key)||key.trim()!==key||/[\r\n]/.test(key)||signal!==undefined&&!(signal instanceof AbortSignal))throw new ClientFault('INVALID_REQUEST');
   prepared=prepareNativeOperation('https://browser.invalid',this.#workspaceId,operation,input);
   if(!this.#csrfToken)return failure('CSRF_REQUIRED','Session CSRF token required');
   headers=new Headers({accept:'application/json','content-type':'application/json','idempotency-key':key,'x-csrf-token':this.#csrfToken});
  }catch{return failure('INVALID_REQUEST','Invalid request');}
  const contract=clientOperations[operation],deadline=new Deadline(30_000,signal);
  try{
   const response=await this.#transport.open(prepared.path,{method:prepared.method,headers,body:prepared.canonicalBody,credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:deadline.signal},deadline);
   if(response.status===401||response.status===403)this.#csrfToken=null;
   return await this.#transport.json<HttpOperationData[K]>(response,{status:contract.status,validateEnvelope:contract.validateResponse,maxBytes:1048576,deadline});
  }catch(error){return faultResult(error);}finally{deadline.dispose();}
 }
 /** Session-bound token stays in this object only; callers supply the /auth/session token. */
 setCsrfToken(token:string|null):void{
  if(token!==null&&(!nonempty(token)||/[\r\n]/.test(token)))throw new Error('Invalid CSRF token');
  this.#csrfToken=token;
 }
 async request<T=unknown,O extends Operation=Operation>(operation:O,input:OperationInputs[O],options:RequestOptions={}):Promise<ApiResult<T>>{
  if(!Object.hasOwn(routes,operation))return failure('OPERATION_UNAVAILABLE','Operation unavailable in the R1 browser client');
  const route=routes[operation];
  if(!record(input))return failure('INVALID_REQUEST','Invalid request',null,false,null,localSettingsValidationDetails(operation,false));
  if(!validInput(operation,input))return failure('INVALID_REQUEST','Invalid request',null,false,null,localSettingsValidationDetails(operation,true));
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
  try{response=await this.#transport.open(url,{method:route.method,headers,body,credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:options.signal});}
  catch(error){const result=faultResult(error);if(!result.ok&&result.error.code==='NETWORK_ERROR')result.error.retryable=true;return result;}
  if(response.status===401||response.status===403)this.#csrfToken=null;
  const result=await this.#transport.json<T>(response,route);
  if(result.ok&&operation==='logoutAuth')this.#csrfToken=null;
  return result;
 }
}
