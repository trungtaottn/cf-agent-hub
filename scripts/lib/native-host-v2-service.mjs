/** Run-bound source-only service. No installed identity or native capability is implied. */
import {createHash,createPublicKey,KeyObject} from 'node:crypto';
import {types} from 'node:util';
import {validateObserverPolicy,observerPolicyDigest,observerReservation,validateObserverRequest,validateObserverClaims,validateObserverManifest,validateObserverResponse,OBSERVER_CAPABILITIES,observerCanonical,observerHash} from './native-host-v2-protocol.mjs';
import {encodeNativeOriginal} from './native-host-v2-original-wire.mjs';
const reject=()=>{throw Error('OBSERVER_SERVICE_REJECTED');},check=v=>{if(!v)reject();};
const byteSize=v=>Buffer.byteLength(observerCanonical(v));
export function createNativeObserverService({policy:input,verify,backend,privateKey}){
 const policy=validateObserverPolicy(input,Date.now()),digest=observerPolicyDigest(policy),reserve=observerReservation(policy);
 check(typeof verify==='function'&&backend?.scope==='local-private-observer-backend'&&backend.installedAuthority===false&&backend.native_conformance===false&&observerPolicyDigest(backend.policy)===digest&&['bind','observe','readOriginal','close'].every(k=>typeof backend[k]==='function'));
 check(privateKey instanceof KeyObject&&!types.isProxy(privateKey)&&!['type','asymmetricKeyType','export'].some(k=>Object.hasOwn(privateKey,k))&&Object.getOwnPropertyDescriptor(KeyObject.prototype,'type').get.call(privateKey)==='private');
 check(createPublicKey(privateKey).asymmetricKeyType==='ed25519');
 let active=null,activeController=null,closing=null,cleanupState='open',closed=false,failed=false,bound=false,sequence=0,requests=0,requestBytes=0,responseBytes=0,originalsRead=0,cleanupFailed=false;
 const seen=new Set(),observed=new Map(),consumed=new Set(),pending=new Set(),cancellations=new Set();
 const track=p=>{const actual=Promise.resolve(p);pending.add(actual);actual.then(()=>pending.delete(actual),()=>pending.delete(actual));return actual;};
 const healthy=signal=>check(!closed&&!failed&&!signal.aborted&&Date.now()<policy.expires_at);
 async function cancel(reader){const p=Promise.resolve().then(()=>reader.cancel());cancellations.add(p);try{await p;}catch{cleanupFailed=true;throw Error('OBSERVER_SERVICE_CLEANUP_REJECTED');}finally{cancellations.delete(p);}}
 async function parse(message,signal){check(message.body);if(message.body.locked){cleanupFailed=true;reject();}let reader;try{reader=message.body.getReader();}catch{cleanupFailed=true;reject();}const chunks=[];let n=0,done=false,cancellation=null;const cancelOnce=()=>cancellation??(cancellation=cancel(reader));const onAbort=()=>{void cancelOnce().catch(()=>{});};signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();try{for(;;){healthy(signal);const part=await track(reader.read());healthy(signal);if(part.done){done=true;break;}check(part.value instanceof Uint8Array&&part.value.byteLength>0&&n+part.value.byteLength<=4096);n+=part.value.byteLength;chunks.push(Buffer.from(part.value));}const text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks,n)),value=JSON.parse(text);check(observerCanonical(value)===text);check(requestBytes+n<=reserve.request_bytes);requestBytes+=n;return value;}finally{signal.removeEventListener('abort',onAbort);try{if(!done||cancellation)await cancelOnce();}finally{reader.releaseLock();}}}
 async function drain(){while(pending.size||cancellations.size)await Promise.allSettled([...pending,...cancellations]);const result=await backend.close();check(result?.status==='closed'&&result.installedAuthority===false&&result.native_conformance===false&&!cleanupFailed);observed.clear();consumed.clear();}
 const unknown=()=>Object.freeze({status:'cleanup-unknown',pending:pending.size+cancellations.size+(active?1:0),installedAuthority:false,native_conformance:false});
 function beginCleanup(){if(closing)return closing;closed=true;activeController?.abort();const task=active;closing=(async()=>{if(task)await Promise.allSettled([task]);await drain();cleanupState='closed';return Object.freeze({status:'closed',installedAuthority:false,native_conformance:false});})().catch(()=>{cleanupState='unknown';return unknown();});return closing;}
 async function close(){const cleanup=beginCleanup();let timer;try{const result=await Promise.race([cleanup,new Promise(resolve=>{timer=setTimeout(()=>{if(cleanupState!=='closed')cleanupState='unknown';resolve(unknown());},1000);})]);if(result.status==='closed'&&(cleanupFailed||pending.size||cancellations.size)){cleanupState='unknown';return unknown();}if(result.status==='closed')cleanupState='closed';return result;}finally{if(timer)clearTimeout(timer);}}
 function ownRejectedBody(message){if(!(message instanceof Request)||!message.body)return;cleanupState='unknown';if(message.body.locked){cleanupFailed=true;return;}try{const task=track(message.body.cancel());task.catch(()=>{cleanupFailed=true;});}catch{cleanupFailed=true;}}
 function errorResponse(cleaned){const body=cleaned?'{"error":{"code":"OBSERVER_REQUEST_REJECTED","retryable":false}}':'{"error":{"code":"OBSERVER_CLEANUP_UNKNOWN","retryable":false}}';check(responseBytes+Buffer.byteLength(body)<=reserve.response_bytes);responseBytes+=Buffer.byteLength(body);return new Response(body,{status:cleaned?403:503,headers:{'content-type':'application/json','cache-control':'no-store'}});}
 function envelope(request,data){return {type:'native-observer-response',version:2,service_id:policy.service_id,instance_id:policy.instance_id,run_id:policy.run_id,descriptor_sha256:policy.descriptor_sha256,sequence:request.sequence,request_id:request.request_id,operation:request.operation,data};}
 function emit(request,data){let value=envelope(request,data);if(request.operation==='close-run'){for(let i=0;i<5;i++){const length=byteSize(value),next=responseBytes+length;if(value.data.response_bytes===next)break;value={...value,data:{...value.data,response_bytes:next}};}}
  value=validateObserverResponse(value,request,policy,Date.now());const body=observerCanonical(value),length=Buffer.byteLength(body);check(responseBytes+length<=reserve.response_bytes);responseBytes+=length;return new Response(body,{headers:{'content-type':'application/json','cache-control':'no-store'}});
 }
 async function processRequest(message,signal){
  healthy(signal);check(message instanceof Request&&message.url===policy.origin+'/native-observer/v2'&&message.method==='POST'&&message.headers.get('content-type')==='application/json'&&!message.signal.aborted);check(requests+1<=reserve.service_calls);requests++;
  const request=validateObserverRequest(await parse(message,signal),policy);healthy(signal);check(request.sequence===sequence+1&&!seen.has(request.request_id));sequence=request.sequence;seen.add(request.request_id);
  const claims=validateObserverClaims(await track(verify(message,Object.freeze({policy,policy_sha256:digest,request_sha256:observerHash(request),request,signal}))),request,policy,Date.now());healthy(signal);
  const current=()=>{healthy(signal);check(Date.now()<claims.expires_at&&!message.signal.aborted);};current();
  if(request.operation==='bind-run'){
   check(!bound&&sequence===1&&request.payload.required_capabilities.every(c=>OBSERVER_CAPABILITIES.includes(c)&&claims.capabilities.includes(c)));
   await track(backend.bind({signal}));current();bound=true;
   return emit(request,{status:'bound',assurance:'source-test-only',capabilities:OBSERVER_CAPABILITIES,reservation:reserve,installedAuthority:false,native_conformance:false});
  }
  check(bound);
  if(request.operation==='observe-resource'){
   const entry=policy.entries.find(e=>e.step_id===request.payload.step_id);check(entry&&!observed.has(entry.invocation_id));
   const manifest=validateObserverManifest(await track(backend.observe(entry,{signal})),entry,policy);current();observed.set(entry.invocation_id,manifest);return emit(request,manifest);
  }
  if(request.operation==='read-original'){
   const p=request.payload,manifest=observed.get(p.invocation_id),record=manifest?.records.find(r=>r.record_id===p.record_id);check(record);for(const k of ['record_id','kind','byte_size','sha256'])check(record[k]===p[k]);const key=p.invocation_id+':'+p.record_id;check(!consumed.has(key));consumed.add(key);
   const result=await track(backend.readOriginal(p,{signal}));current();check(result.bytes instanceof Uint8Array&&result.bytes.byteLength===record.byte_size&&createHash('sha256').update(result.bytes).digest('hex')===record.sha256);
   const expected={service_id:policy.service_id,descriptor_sha256:policy.descriptor_sha256,run_id:policy.run_id,instance_id:policy.instance_id,step_id:manifest.subject.step_id,invocation_id:p.invocation_id,request_id:request.request_id,sequence:request.sequence,producer_id:'private_source_observer',...record};
   const wire=encodeNativeOriginal({expected,bytes:result.bytes,privateKey});const cap=record.kind==='sql-canonical'?23312:88859;check(wire.length<=cap&&responseBytes+wire.length<=reserve.response_bytes);current();responseBytes+=wire.length;originalsRead++;return new Response(wire,{headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
  check(request.operation==='close-run');const cleanup=await track(backend.close());check(cleanup?.status==='closed'&&cleanup.installedAuthority===false&&cleanup.native_conformance===false);current();const response=emit(request,{status:'closed',observations:observed.size,originals_read:originalsRead,requests,request_bytes:requestBytes,response_bytes:responseBytes,installedAuthority:false,native_conformance:false});closed=true;cleanupState='closed';observed.clear();consumed.clear();return response;
 }
 async function handle(message){
  if(closed||failed||active){failed=true;activeController?.abort();ownRejectedBody(message);beginCleanup();reject();}
  const controller=new AbortController();activeController=controller;const timer=setTimeout(()=>controller.abort(),Math.min(10000,Math.max(1,policy.expires_at-Date.now())));timer.unref?.();let listener;
  const task=Promise.resolve().then(()=>processRequest(message,controller.signal));active=task;
  try{return await Promise.race([task,new Promise((_,no)=>{listener=()=>no(Error('OBSERVER_SERVICE_REJECTED'));controller.signal.addEventListener('abort',listener,{once:true});})]);}
  catch{failed=true;controller.abort();if(!message?.body?.locked)ownRejectedBody(message);beginCleanup();if(pending.size||cancellations.size){cleanupState='unknown';return errorResponse(false);}const result=await close();return errorResponse(result.status==='closed');}
  finally{clearTimeout(timer);if(listener)controller.signal.removeEventListener('abort',listener);active=null;activeController=null;}
 }

 return Object.freeze({handle,close,policy,snapshot:()=>Object.freeze({requests,requestBytes,responseBytes,originalsRead,observations:observed.size,pending:pending.size+(active?1:0),closed,failed,cleanupFailed,cleanupState,installedAuthority:false,native_conformance:false})});
}
