/** Fixed local-profile client. Supplying a signing key does not install trust. */
import {createPublicKey} from 'node:crypto';
import {validateObserverPolicy,observerReservation,validateObserverRequest,validateObserverResponse,OBSERVER_CAPABILITIES,observerCanonical} from './native-host-v2-protocol.mjs';
import {verifyNativeOriginal} from './native-host-v2-original-wire.mjs';
const reject=()=>{throw Error('OBSERVER_CLIENT_REJECTED');},check=v=>{if(!v)reject();};
export function createNativeObserverClient({policy:input,send,publicKeyDer}){
 const policy=validateObserverPolicy(input,Date.now()),reserve=observerReservation(policy);check(typeof send==='function'&&publicKeyDer instanceof Uint8Array&&publicKeyDer.byteLength===44);const key=Buffer.from(publicKeyDer);check(createPublicKey({key,type:'spki',format:'der'}).asymmetricKeyType==='ed25519');
 let active=false,activeController=null,activeCompletion=null,disposal=null,cleanupFailed=false,failed=false,closed=false,bound=false,sequence=0,requestBytes=0,responseBytes=0,originalsRead=0;
 const observed=new Map(),consumed=new Set(),pending=new Set(),ownedResponses=new WeakSet();
 const track=p=>{const actual=Promise.resolve(p);pending.add(actual);actual.then(()=>pending.delete(actual),()=>pending.delete(actual));return actual;};
 async function wait(p,signal){const actual=track(p);let listener;try{check(!signal.aborted);return await Promise.race([actual,new Promise((_,no)=>{listener=()=>no(Error('OBSERVER_CLIENT_REJECTED'));signal.addEventListener('abort',listener,{once:true});})]);}finally{if(listener)signal.removeEventListener('abort',listener);}}
 async function cancelResponse(response){if(!(response instanceof Response)){cleanupFailed=true;return;}if(!response.body)return;if(response.body.locked){if(!ownedResponses.has(response))cleanupFailed=true;return;}try{await response.body.cancel();}catch{cleanupFailed=true;}}
 async function dispose(){closed=true;activeController?.abort();if(!disposal){const activeWork=activeCompletion;disposal=(async()=>{if(activeWork)await activeWork;while(pending.size)await Promise.allSettled([...pending]);observed.clear();consumed.clear();return Object.freeze({status:cleanupFailed?'cleanup-unknown':'closed',installedAuthority:false,native_conformance:false});})();}let timer;try{return await Promise.race([disposal,new Promise(resolve=>{timer=setTimeout(()=>resolve(Object.freeze({status:'cleanup-unknown',installedAuthority:false,native_conformance:false})),1000);})]);}finally{if(timer)clearTimeout(timer);}}

 async function body(response,cap,signal){if(response.body?.locked){cleanupFailed=true;reject();}let reader;try{reader=response.body?.getReader();}catch{cleanupFailed=true;reject();}check(reader);ownedResponses.add(response);let cancellation=null,done=false,n=0;const chunks=[];const cancel=()=>cancellation??(cancellation=track(Promise.resolve().then(()=>reader.cancel()).catch(()=>{cleanupFailed=true;throw Error('OBSERVER_CLIENT_CLEANUP_REJECTED');})));const abort=()=>{void cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();try{for(;;){check(!signal.aborted);const part=await track(reader.read());check(!signal.aborted);if(part.done){done=true;break;}check(part.value instanceof Uint8Array&&part.value.byteLength>0&&n+part.value.byteLength<=cap);n+=part.value.byteLength;chunks.push(Buffer.from(part.value));}return Buffer.concat(chunks,n);}finally{signal.removeEventListener('abort',abort);try{if(!done||cancellation)await cancel();}finally{reader.releaseLock();ownedResponses.delete(response);}}}
 async function invoke(operation,payload){
  if(active){failed=true;activeController?.abort();reject();}check(!closed&&!failed&&Date.now()<policy.expires_at);active=true;let finishActive;activeCompletion=new Promise(resolve=>{finishActive=resolve;});
  const controller=new AbortController();activeController=controller;const timer=setTimeout(()=>controller.abort(),Math.min(10000,Math.max(1,policy.expires_at-Date.now())));timer.unref?.();let actual,response;
  try{
   check(sequence+1<=reserve.service_calls);const request=validateObserverRequest({version:2,service_id:policy.service_id,instance_id:policy.instance_id,run_id:policy.run_id,descriptor_sha256:policy.descriptor_sha256,sequence:++sequence,request_id:'request_'+sequence,operation,payload},policy),text=observerCanonical(request);requestBytes+=Buffer.byteLength(text);check(requestBytes<=reserve.request_bytes);
   actual=track(Promise.resolve().then(()=>send(new Request(policy.origin+'/native-observer/v2',{method:'POST',headers:{'content-type':'application/json'},body:text,signal:controller.signal}))));
   response=await wait(actual,controller.signal);
   check(!controller.signal.aborted&&Date.now()<policy.expires_at&&response instanceof Response&&response.status===200&&response.headers.get('content-type')==='application/json');
   const cap=operation==='read-original'?(payload.kind==='sql-canonical'?23312:88859):operation==='observe-resource'?16384:operation==='bind-run'?4096:1024;
   const wire=await wait(body(response,cap,controller.signal),controller.signal);responseBytes+=wire.length;check(responseBytes<=reserve.response_bytes&&!controller.signal.aborted&&Date.now()<policy.expires_at);
   if(operation==='read-original'){
    const manifest=observed.get(payload.invocation_id);check(manifest);const expected={service_id:policy.service_id,descriptor_sha256:policy.descriptor_sha256,run_id:policy.run_id,instance_id:policy.instance_id,step_id:manifest.subject.step_id,invocation_id:payload.invocation_id,request_id:request.request_id,sequence:request.sequence,producer_id:'private_source_observer',record_id:payload.record_id,kind:payload.kind,byte_size:payload.byte_size,sha256:payload.sha256};const result=verifyNativeOriginal({expected,wire,publicKeyDer:key});originalsRead++;return result;
   }
   const raw=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(wire),value=JSON.parse(raw);check(observerCanonical(value)===raw);const result=validateObserverResponse(value,request,policy,Date.now());
   if(operation==='close-run'){check(result.data.requests===sequence&&result.data.request_bytes===requestBytes&&result.data.response_bytes===responseBytes&&result.data.originals_read===originalsRead&&result.data.observations===observed.size);closed=true;}
   return result.data;
  }catch{
   failed=true;controller.abort();if(actual)track(actual.then(value=>cancelResponse(response??value),()=>{}));else if(response)track(cancelResponse(response));reject();
  }finally{clearTimeout(timer);active=false;activeController=null;finishActive();}

 }
 async function bind(){check(!bound);const result=await invoke('bind-run',{required_capabilities:OBSERVER_CAPABILITIES});bound=true;return result;}
 async function observe(stepId){check(bound);const entry=policy.entries.find(e=>e.step_id===stepId);check(entry&&!observed.has(entry.invocation_id));const result=await invoke('observe-resource',{step_id:entry.step_id,invocation_id:entry.invocation_id,prepared_request_sha256:entry.prepared_request_sha256,credential_handle:entry.credential_handle});observed.set(entry.invocation_id,result);return result;}
 async function readOriginal(stepId,recordId){check(bound);const entry=policy.entries.find(e=>e.step_id===stepId),manifest=entry&&observed.get(entry.invocation_id),record=manifest?.records.find(r=>r.record_id===recordId);check(record);const id=entry.invocation_id+':'+recordId;check(!consumed.has(id));consumed.add(id);return invoke('read-original',{invocation_id:entry.invocation_id,...record});}
 async function close(){check(bound);return invoke('close-run',{});}
 return Object.freeze({bind,observe,readOriginal,close,dispose,snapshot:()=>Object.freeze({sequence,requestBytes,responseBytes,originalsRead,observations:observed.size,pending:pending.size+(active?1:0),closed,failed,cleanupFailed,installedAuthority:false,native_conformance:false})});
}
