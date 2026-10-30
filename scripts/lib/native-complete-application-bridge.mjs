/** Fixed source-owned application transport. No route or authority admission here. */
import {types} from 'node:util';
import applicationPlan from '../../workers/native-fixture/required-application-plan.json' with {type:'json'};
const rejected=()=>Error('NATIVE_COMPLETE_APPLICATION_BRIDGE_REJECTED');
const check=v=>{if(!v)throw rejected();};
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
const ordinals=freeze(applicationPlan).flatMap(p=>p.ordinals);
const typed=Object.getPrototypeOf(Uint8Array.prototype);
function chunkBytes(value,remaining){
 check(value!==null&&typeof value==='object'&&!types.isProxy(value));
 check(Object.getPrototypeOf(value)===Uint8Array.prototype||Object.getPrototypeOf(value)===Buffer.prototype);
 const size=get(typed,'byteLength',value),backing=get(typed,'buffer',value);
 check(size>0&&size<=remaining&&!types.isSharedArrayBuffer(backing));
 const keys=Reflect.ownKeys(value);check(keys.length===size&&keys.every((key,i)=>key===String(i)));
 const copy=new Uint8Array(size);Uint8Array.prototype.set.call(copy,value);return copy;
}
const limits=Object.freeze({calls:ordinals.length,
 request_max:Math.max(...ordinals.map(o=>o.capture_limits.requestBodyBytes)),
 response_max:Math.max(...ordinals.map(o=>o.capture_limits.responseBodyBytes)),
 request_total:ordinals.reduce((n,o)=>n+o.capture_limits.requestBodyBytes,0),
 response_total:ordinals.reduce((n,o)=>n+o.capture_limits.responseBodyBytes,0)});
const get=(proto,key,value)=>Object.getOwnPropertyDescriptor(proto,key).get.call(value);
const locked=body=>{check(!types.isProxy(body));return get(ReadableStream.prototype,'locked',body);};
function genuine(value,proto){check(value!==null&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===proto);for(const key of Object.getOwnPropertyNames(value))check(!Object.hasOwn(proto,key));}
/** controllerFetch must be the factory's captured fixed controller binding.
 * It is not accepted from public config/request and is not itself authority. */
export function createCompleteApplicationBridge(input){
 check(input!==null&&typeof input==='object'&&!types.isProxy(input)&&Object.getPrototypeOf(input)===Object.prototype);
 check(Reflect.ownKeys(input).length===1);const descriptor=Object.getOwnPropertyDescriptor(input,'controllerFetch');
 check(descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='function'&&!types.isProxy(descriptor.value));const fetch=descriptor.value;
 let calls=0,failed=false,closed=false,cleanupFailed=false;const usage={request:0,response:0};
 const fetches=new Set(),bodies=new Set(),cancellations=new Set(),operations=new Set();
 const trackCancel=promise=>{const p=Promise.resolve(promise);cancellations.add(p);p.then(()=>cancellations.delete(p),()=>{cancellations.delete(p);cleanupFailed=true;});return p;};
 function poison(){failed=true;for(const op of operations)op.abort();}
 function wrap(body,kind,op){
  if(body===null)return null;
  check(!types.isProxy(body)&&Object.getPrototypeOf(body)===ReadableStream.prototype&&!locked(body));
  const reader=ReadableStream.prototype.getReader.call(body);let done=false,cancelTask=null,controller,size=0;
  const owner={kind,cancel(){if(done)return Promise.resolve();if(cancelTask)return cancelTask;
    try{cancelTask=trackCancel(reader.cancel(rejected()));}catch{cancelTask=trackCancel(Promise.reject(rejected()));}
    cancelTask.then(()=>finish(),()=>{});return cancelTask;},error(){try{controller?.error(rejected());}catch{}}};
  function finish(){if(done)return;done=true;bodies.delete(owner);try{reader.releaseLock();}catch{cleanupFailed=true;}maybeFinish(op);}
  bodies.add(owner);op.bodies.add(owner);
  return new ReadableStream({start(c){controller=c;},async pull(c){
   try{check(!closed&&!failed&&!op.signal.aborted);const result=await reader.read();check(!closed&&!failed&&!op.signal.aborted);
    if(result.done){finish();c.close();return;}
    const bytes=chunkBytes(result.value,Math.min(limits[kind+'_max']-size,limits[kind+'_total']-usage[kind]));
    size+=bytes.byteLength;usage[kind]+=bytes.byteLength;c.enqueue(bytes);
   }catch{owner.error();poison();owner.cancel().catch(()=>{});}
  },cancel(){return owner.cancel();}},{highWaterMark:0});
 }
 function maybeFinish(op){if(op.fetchDone&&[...op.bodies].every(b=>!bodies.has(b))){op.originalSignal.removeEventListener('abort',op.listener);operations.delete(op);}}
 function forward(request){
  let op;
  try{
   check(!closed&&!failed&&calls<limits.calls);genuine(request,Request.prototype);
   const body=get(Request.prototype,'body',request),used=get(Request.prototype,'bodyUsed',request);check(!used&&(body===null||!locked(body)));
   const originalSignal=get(Request.prototype,'signal',request);check(!originalSignal.aborted);
   const controller=new AbortController();op={signal:controller.signal,originalSignal,bodies:new Set(),fetchDone:false,abort(){controller.abort();for(const b of this.bodies){b.error();b.cancel().catch(()=>{});}},listener:null};
   op.listener=()=>{poison();};operations.add(op);originalSignal.addEventListener('abort',op.listener,{once:true});calls++;
   const wrapped=wrap(body,'request',op);
   const forwarded=new Request(get(Request.prototype,'url',request),{method:get(Request.prototype,'method',request),headers:get(Request.prototype,'headers',request),body:wrapped,signal:controller.signal,duplex:'half',redirect:get(Request.prototype,'redirect',request)});
   let actual;
   actual=Promise.resolve().then(()=>{check(!closed&&!failed&&!controller.signal.aborted);return fetch(forwarded);}).then(response=>{
    let responseBody;try{genuine(response,Response.prototype);responseBody=get(Response.prototype,'body',response);check(!get(Response.prototype,'bodyUsed',response)&&(responseBody===null||!locked(responseBody)));}catch{cleanupFailed=true;throw rejected();}
    if(closed||failed||controller.signal.aborted){if(responseBody)trackCancel(ReadableStream.prototype.cancel.call(responseBody,rejected()));throw rejected();}
    try{return new Response(wrap(responseBody,'response',op),{status:get(Response.prototype,'status',response),statusText:get(Response.prototype,'statusText',response),headers:get(Response.prototype,'headers',response)});}catch{cleanupFailed=true;throw rejected();}
   }).catch(()=>{poison();throw rejected();}).finally(()=>{op.fetchDone=true;fetches.delete(actual);for(const b of op.bodies)if(b.kind==='request'&&bodies.has(b))b.cancel().catch(()=>{});maybeFinish(op);});
   fetches.add(actual);
   let listener;const aborted=new Promise((_,reject)=>{listener=()=>reject(rejected());controller.signal.addEventListener('abort',listener,{once:true});if(controller.signal.aborted)listener();});
   return Promise.race([actual,aborted]).finally(()=>controller.signal.removeEventListener('abort',listener));
  }catch{poison();if(op)op.abort();return Promise.reject(rejected());}
 }
 function snapshot(){return Object.freeze({scope:'source-transport-only',installedAuthority:false,native_conformance:false,calls,failed,closed,pending_fetches:fetches.size,pending_publications:[...bodies].filter(b=>b.kind==='response').length,pending_request_bodies:[...bodies].filter(b=>b.kind==='request').length,pending_cancellations:cancellations.size,cleanup_failed:cleanupFailed,limits,usage:Object.freeze({...usage})});}
 async function close(){closed=true;for(const op of operations)op.abort();let timer;
  try{await Promise.race([(async()=>{while(fetches.size||cancellations.size){await Promise.allSettled([...fetches,...cancellations]);}})(),new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);}
  finally{clearTimeout(timer);}
  return Object.freeze({status:fetches.size||bodies.size||cancellations.size||cleanupFailed?'cleanup-unknown':'closed'});
 }
 return Object.freeze({forward,snapshot,close});
}
