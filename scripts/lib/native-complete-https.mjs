/** Fixed HTTPS request owner; transport framing is not evidence authentication. */
import {request as httpsRequest} from 'node:https';
import {types} from 'node:util';
import {createCompleteClientProof,assertCompleteClientConfigBinding,completeClientFields as fields} from './native-complete-client-proof.mjs';
import {completeInstallationMaterials,assertCompleteInstallationCurrent} from './native-host-v2-custody.mjs';
import {validateCompleteRequest} from './native-complete-request.mjs';
import {completeResponseByteLimit,parseCompleteResponseWire} from './native-complete-response.mjs';
import {selectCompleteProfile} from './native-profile-selection.mjs';
import {snapshotCompleteValue as snapshot,freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
const rejected=()=>Error('NATIVE_COMPLETE_HTTPS_REJECTED'),check=v=>{if(!v)throw rejected();};
function headerBytes(raw){check(Array.isArray(raw)&&raw.length%2===0&&raw.length<=64);let n=2;const seen=new Set();for(let i=0;i<raw.length;i+=2){check(typeof raw[i]==='string'&&typeof raw[i+1]==='string'&&!/[\r\n]/.test(raw[i]+raw[i+1]));const key=raw[i].toLowerCase();check(!seen.has(key));seen.add(key);n+=Buffer.byteLength(raw[i])+Buffer.byteLength(raw[i+1])+4;check(n<=8192);}return n;}
/** Only production entry: a forged binding cannot supply a key or current-check. */
export function createCompleteHttpsClient(input){try{const a=fields(input,['binding','policy','validationOptions']),m=completeInstallationMaterials(a.binding);assertCompleteInstallationCurrent(a.binding);assertCompleteClientConfigBinding(m.config,a.policy,a.validationOptions);return createCompleteHttpsClientCore({policy:a.policy,validationOptions:a.validationOptions,installation:m.statement,privateKey:m.clientAuth.privateKey,assertCurrent:()=>assertCompleteInstallationCurrent(a.binding)},httpsRequest);}catch{throw rejected();}}
/** Explicit source harness seam, never selectable through configuration. */
export function createCompleteHttpsClientCore(input,requestImplementation){
 let a,proof;try{a=fields(input,['policy','validationOptions','installation','privateKey','assertCurrent']);check(typeof a.assertCurrent==='function'&&!types.isProxy(a.assertCurrent)&&typeof requestImplementation==='function'&&!types.isProxy(requestImplementation));const {assertCurrent,...rest}=a;proof=createCompleteClientProof(rest);check(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0');}catch{throw rejected();}
 const p=proof.policy,o=proof.validationOptions,selected=selectCompleteProfile(p.profile),maxCalls=selected.profile.limits.service_calls,ledger=selected.profile.ledger.logical_output_bytes;
 const reservation=Object.freeze({calls:maxCalls,request_body_bytes:ledger.service_request,response_body_bytes:ledger.service_response,selected_proof_bytes:216*maxCalls,request_header_bytes:8192*maxCalls,response_header_bytes:8192*maxCalls,request_body_and_header_bytes:ledger.service_request+8192*maxCalls,response_body_and_header_bytes:ledger.service_response+8192*maxCalls});
 const deadline=Math.min(o.now+o.operationalMs,p.expires_at,proof.expires_at),mono=performance.now(),initialRemaining=deadline-Date.now();check(initialRemaining>0);
 let calls=0,failed=false,closed=false,closeAttempted=false,active=null,lastNow=Date.now();const pending=new Set(),controllers=new Set(),ids=new Set();let cleanupFailed=false;
 const usage={request_body_bytes:0,response_body_bytes:0,selected_proof_bytes:0,request_header_bytes:0,response_header_bytes:0};
 const track=(promise,cleanup=false)=>{const actual=Promise.resolve(promise);pending.add(actual);actual.then(()=>pending.delete(actual),()=>{pending.delete(actual);if(cleanup)cleanupFailed=true;});return actual;};
 function healthy(signal){const now=Date.now();check(!closed&&now>=lastNow&&now<deadline&&performance.now()-mono<initialRemaining&&!signal.aborted&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0');lastNow=now;}
 async function current(signal){healthy(signal);check(await a.assertCurrent()===undefined);healthy(signal);}
 function exchange(r,wire,cap,signal){return new Promise((resolve,reject)=>{
  let req,res,socket,reqClosed=false,resClosed=false,socketClosed=false,ended=false,bad=false,settled=false,size=0,expected=null;const parts=[];
  const late=stream=>{if(!stream)return;const done=new Promise(resolve=>{stream.once('close',resolve);stream.on('error',()=>{});});track(done,true);stream.destroy();};
  const settle=()=>{if(settled||!reqClosed||(res&&!resClosed)||(socket&&!socketClosed))return;settled=true;signal.removeEventListener('abort',abort);if(bad||!socket||!res||!ended||!res.complete||signal.aborted){reject(rejected());return;}try{healthy(signal);resolve(Buffer.concat(parts,size));}catch{reject(rejected());}};
  const fail=()=>{bad=true;req?.destroy();res?.destroy();socket?.destroy();settle();},abort=()=>fail();signal.addEventListener('abort',abort,{once:true});
  const accept=response=>{if(settled||res){late(response);if(!settled)fail();return;}res=response;res.on('error',fail);res.on('aborted',fail);res.on('close',()=>{resClosed=true;if(!ended)bad=true;settle();});
   try{healthy(signal);check(!bad&&res.statusCode===200);const n=headerBytes(res.rawHeaders);usage.response_header_bytes+=n;check(usage.response_header_bytes<=reservation.response_header_bytes);check(res.headers['content-type']==='application/json'&&!res.headers['content-encoding']&&!res.headers.location&&!res.headers.trailer);if(res.headers['content-length']!==undefined){check(typeof res.headers['content-length']==='string'&&/^(0|[1-9][0-9]*)$/.test(res.headers['content-length']));expected=Number(res.headers['content-length']);check(Number.isSafeInteger(expected)&&expected<=cap);}}catch{fail();return;}
   res.on('data',chunk=>{try{healthy(signal);check(chunk instanceof Uint8Array&&chunk.byteLength>0&&size+chunk.byteLength<=cap);size+=chunk.byteLength;usage.response_body_bytes+=chunk.byteLength;check(usage.response_body_bytes<=reservation.response_body_bytes);parts.push(Buffer.from(chunk));}catch{fail();}});
   res.on('end',()=>{try{healthy(signal);check(res.complete&&Array.isArray(res.rawTrailers)&&res.rawTrailers.length===0&&(expected===null||expected===size));ended=true;}catch{bad=true;}if(bad)fail();settle();});
  };
  try{healthy(signal);const headers={'content-type':'application/json',accept:'application/json',...wire.headers,'content-length':String(Buffer.byteLength(wire.body)),connection:'close',host:new URL(proof.origin).host};usage.request_header_bytes+=headerBytes(Object.entries(headers).flat());check(usage.request_header_bytes<=reservation.request_header_bytes);req=requestImplementation(proof.origin+'/native-complete/v2',{method:'POST',headers,agent:false,rejectUnauthorized:true,maxHeaderSize:8192},accept);
   req.on('error',fail);req.on('information',fail);const unexpected=(response,assigned)=>{late(response);if(assigned!==socket)late(assigned);fail();};req.on('upgrade',unexpected);req.on('connect',unexpected);
   req.on('socket',assigned=>{if(settled||socket){late(assigned);if(!settled)fail();return;}socket=assigned;socket.on('error',fail);socket.on('close',()=>{socketClosed=true;settle();});if(bad||signal.aborted)socket.destroy();});req.on('close',()=>{reqClosed=true;settle();});if(signal.aborted){fail();return;}req.end(wire.body);
  }catch{bad=true;if(req)fail();else{reqClosed=true;settle();}}
 });}
 function send(input,sendOptions={signal:null,slotSubject:null}){
  let r,signal,controller,actual,timer,listener;
  try{const so=fields(sendOptions,['signal','slotSubject']);check(so.signal===null||so.signal instanceof AbortSignal);check(!closed&&!active&&pending.size===0&&calls<maxCalls);r=validateCompleteRequest(input,p,o);const remoteClose=r.operation==='close-run';check(!closeAttempted&&(!failed||remoteClose)&&r.sequence===calls+1&&!ids.has(r.request_id));if(remoteClose)closeAttempted=true;ids.add(r.request_id);calls++;
   const subject=so.slotSubject===null?null:freeze(snapshot(so.slotSubject,512)),wire=proof.sign(r),cap=completeResponseByteLimit(r,p,o);controller=new AbortController();controllers.add(controller);signal=so.signal?AbortSignal.any([so.signal,controller.signal]):controller.signal;healthy(signal);
   usage.request_body_bytes+=Buffer.byteLength(wire.body);usage.selected_proof_bytes+=212;check(usage.request_body_bytes<=reservation.request_body_bytes&&usage.selected_proof_bytes<=reservation.selected_proof_bytes);
   actual=Promise.resolve().then(async()=>{await current(signal);check(!failed||remoteClose);const bytes=await exchange(r,wire,cap,signal);await current(signal);check(!failed||remoteClose);return parseCompleteResponseWire(bytes,r,p,o,subject);});active=actual;track(actual);
   actual.then(()=>{if(active===actual)active=null;controllers.delete(controller);},()=>{if(active===actual)active=null;controllers.delete(controller);failed=true;});
   const cutoff=new Promise((_,reject)=>{listener=()=>{failed=true;reject(rejected());};signal.addEventListener('abort',listener,{once:true});timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(10000,deadline-Date.now())));if(signal.aborted)listener();});
   return Promise.race([actual,cutoff]).catch(()=>{failed=true;controller.abort();throw rejected();}).finally(()=>{clearTimeout(timer);signal.removeEventListener('abort',listener);});
  }catch{failed=true;for(const c of controllers)c.abort();return Promise.reject(rejected());}
 }
 async function close(){closed=true;for(const c of controllers)c.abort();let timer;try{await Promise.race([Promise.allSettled([...pending]),new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);return Object.freeze({status:pending.size||cleanupFailed?'cleanup-unknown':'closed'});}finally{clearTimeout(timer);}}
 return Object.freeze({send,close,snapshot:()=>Object.freeze({scope:'transport-only',installedAuthority:false,native_conformance:false,calls,pending:pending.size,failed,closed,closeAttempted,reservation,usage:Object.freeze({...usage})})});
}
