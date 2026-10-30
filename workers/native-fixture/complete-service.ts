/** Fixed private service attachment. Operator-installed bindings only; no public
 * SQL, module selector, credential creation, deployment or default trust. */
import {DurableObject} from 'cloudflare:workers';
// JavaScript source modules are independently tested and bundled into this fixed graph.
// @ts-ignore fixed source module
import {verifyCompleteServiceConfiguration,readCompleteServiceConfiguration,assertCompleteServiceConfigurationCurrent,deriveCompleteServiceRun} from '../../scripts/lib/native-complete-service-configuration.mjs';
// @ts-ignore fixed source module
import {createCompleteServiceAuthenticator} from '../../scripts/lib/native-complete-service-auth.mjs';
// @ts-ignore fixed source module
import {createCompleteServiceCore} from '../../scripts/lib/native-complete-service.mjs';
export {RequiredFixtureController} from './required-controller';
export {RequiredFixtureWorkspace as WorkspaceDO} from './required-source-projection';
type ServiceEnv=Env&{COMPLETE_SERVICE:DurableObjectNamespace;CONTROLLER:DurableObjectNamespace;[key:string]:unknown};
const names={NATIVE_CONFIG:65536,NATIVE_TRUST_ANCHOR:4096,NATIVE_INSTALLATION:16384,NATIVE_AUTHORITY:1024,NATIVE_PRIVATE_INPUTS:3446,NATIVE_HUMAN:123,NATIVE_TOKEN_S:43,NATIVE_TOKEN_R:43,NATIVE_TOKEN_X:43,NATIVE_SERVICE_KEY_PKCS8:64} as const;
const methods=['installRequiredRun','provisionRequiredRun','openRequiredPhase','openRequiredAuxiliary','closeRequiredPhase','closeRequiredAuxiliary','observeRequiredControl','completeRequiredExternalE1','readRequiredPrivateProjection','closeRequiredRun'] as const;
const reject=()=>{throw Error('COMPLETE_SERVICE_ENTRY_REJECTED');};
function check(v:unknown):asserts v{if(!v)reject();}
function capture(env:ServiceEnv){const out:Record<string,string>={};for(const [name,cap]of Object.entries(names)){const value=env[name];check(typeof value==='string'&&value.length>0&&value.length<=cap&&new TextEncoder().encode(value).length<=cap);out[name]=value;}return Object.freeze(out);}
function configured(raw:Record<string,string>){const bytes=(name:string)=>Buffer.from(raw[name],'utf8'),key=Buffer.from(raw.NATIVE_SERVICE_KEY_PKCS8,'base64');check(key.length===48&&key.toString('base64')===raw.NATIVE_SERVICE_KEY_PKCS8);try{return verifyCompleteServiceConfiguration({configBytes:bytes('NATIVE_CONFIG'),anchorBytes:bytes('NATIVE_TRUST_ANCHOR'),descriptorBytes:bytes('NATIVE_INSTALLATION'),authorityBytes:bytes('NATIVE_AUTHORITY'),privateInputsBytes:bytes('NATIVE_PRIVATE_INPUTS'),credentials:{S:raw.NATIVE_TOKEN_S,R:raw.NATIVE_TOKEN_R,X:raw.NATIVE_TOKEN_X},humanBytes:bytes('NATIVE_HUMAN'),serviceKeyBytes:key,now:Date.now()});}finally{key.fill(0);}}
function controlHeaders(request:Request){
 const kept=new Set(['content-type','accept','host','content-length','connection','x-native-client-key-id','x-native-client-signature']);
 // Observed native transport metadata only; never an authority or routing input.
 const ignored=new Set(['accept-encoding','accept-language','cf-connecting-ip','sec-fetch-mode','user-agent','cf-ray','cf-worker','x-forwarded-for','x-forwarded-proto','cdn-loop']);
 const out:Record<string,string>={};let count=0,size=2;
 for(const [name,value]of request.headers){check(++count<=32);size+=Buffer.byteLength(name)+Buffer.byteLength(value)+4;check(size<=8192&&!/[\r\n]/.test(value));check(kept.has(name)||ignored.has(name));if(kept.has(name))out[name]=value;}
 return out;
}
const safeError=()=>new Response('Private fixture service unavailable.',{status:403,headers:{'content-type':'text/plain','cache-control':'no-store'}});
/** Exactly one durable claim; restarting a claimed object does not resume it. */
export class CompleteFixtureService extends DurableObject<ServiceEnv>{
 #raw:Readonly<Record<string,string>>;#binding:any;#origins:any;#startup:Promise<unknown>;#core:any=null;#claiming=false;#failed=false;#bodyBusy=false;#bodyUnknown=false;#bodyPending=new Set<Promise<unknown>>();
 constructor(ctx:DurableObjectState,env:ServiceEnv){super(ctx,env);this.#raw=capture(env);this.#binding=configured(this.#raw);this.#origins=readCompleteServiceConfiguration(this.#binding);this.#startup=ctx.storage.get('complete-service-run-claim');}
 #current(allowFailed=false){check(allowFailed||!this.#failed);for(const name of Object.keys(names))check(this.env[name]===this.#raw[name]);assertCompleteServiceConfigurationCurrent(this.#binding,Date.now());}
 #poison(){this.#failed=true;this.#core?.failClosed();}
 #track<T>(promise:Promise<T>):Promise<T>{this.#bodyPending.add(promise);void promise.then(()=>this.#bodyPending.delete(promise),()=>this.#bodyPending.delete(promise));return promise;}
 async #body(request:Request,allowFailed=false){check(request.body&&!request.bodyUsed&&!request.body.locked&&!request.signal.aborted);const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0,timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
  const stopped=new Promise<never>((_,no)=>{abort=()=>no(Error('COMPLETE_SERVICE_ENTRY_REJECTED'));request.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,Math.max(1,Math.min(5000,this.#origins.deadline+1000-Date.now())));});
  try{for(;;){const row=await Promise.race([this.#track(reader.read()),stopped]);this.#current(allowFailed);if(row.done)break;check(row.value instanceof Uint8Array&&row.value.byteLength>0);size+=row.value.byteLength;check(size<=45543);chunks.push(new Uint8Array(row.value));}check(size>0);const result=Buffer.alloc(size);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;chunk.fill(0);}return result;}
  catch{this.#poison();const cancellation=this.#track(reader.cancel());void cancellation.catch(()=>{this.#bodyUnknown=true;});reject();}finally{if(timer)clearTimeout(timer);if(abort)request.signal.removeEventListener('abort',abort);try{reader.releaseLock();}catch{this.#poison();}}
 }
 async fetch(request:Request):Promise<Response>{let ownsBody=false;try{
  this.#current(!!this.#core);check(this.ctx.id.toString()===this.env.COMPLETE_SERVICE.idFromName('complete-fixture-service').toString());const url=new URL(request.url);
  if(url.origin===this.#origins.targetOrigin){this.#current();check(this.#core&&!this.#claiming);return await this.#core.forwardApplication(request);}
  check(url.origin===this.#origins.serviceOrigin&&url.pathname==='/native-complete/v2'&&!url.search&&!url.hash&&request.method==='POST');
  // Rejected, unacquired bodies remain native transport-owned; no reader or
  // cancellation task is adopted and no drained claim is made for them.
  check(!this.#bodyBusy&&this.#bodyPending.size===0);this.#bodyBusy=true;ownsBody=true;
  const headers=controlHeaders(request);check(headers['content-type']==='application/json');
  const body=await this.#body(request,!!this.#core);this.#current(!!this.#core);
  if(!this.#core){check(!this.#claiming);this.#claiming=true;
   const text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(body),candidate=JSON.parse(text);check(candidate&&typeof candidate==='object'&&candidate.operation==='preflight'&&candidate.sequence===1&&typeof candidate.run_id==='string');
   const run=deriveCompleteServiceRun(this.#binding,candidate.run_id,Date.now()),auth=createCompleteServiceAuthenticator({policy:run.policy,validationOptions:run.validationOptions,installation:run.installation});
   auth.verify(body,{'x-native-client-key-id':headers['x-native-client-key-id'],'x-native-client-signature':headers['x-native-client-signature']});
   check(await this.#startup===undefined);this.#current();
   const claim=JSON.stringify({type:'complete-service-run-claim',version:1,run_id:candidate.run_id,descriptor_sha256:this.#origins.descriptorSha256,config_sha256:this.#origins.configSha256,status:'claimed'});check(Buffer.byteLength(claim)<=1024);
   await this.ctx.storage.put('complete-service-run-claim',claim);this.#current();
   const stub=this.env.CONTROLLER.getByName('required-fixture-controller') as any,controller:Record<string,unknown>={fetch:(r:Request)=>stub.fetch(r)};
   for(const name of methods)controller[name]=(text:string)=>stub[name](text);
   const {policySha256,...coreInput}=run;this.#core=createCompleteServiceCore({...coreInput,controller});this.#claiming=false;
  }
  const result=await this.#core.handle({method:'POST',url:request.url,headers,body});
  // Core cleanup cannot certify unresolved wrapper ingress ownership. A fixed
  // failure response leaves the caller's cleanup outcome unknown, never closed.
  check(!this.#bodyUnknown&&this.#bodyPending.size===0);return new Response(result.body,{status:result.status,headers:result.headers});
 }catch{this.#poison();return safeError();}finally{if(ownsBody)this.#bodyBusy=false;}}
}
export default {fetch(request:Request,env:ServiceEnv){return env.COMPLETE_SERVICE.getByName('complete-fixture-service').fetch(request);}};
