import https from 'node:https';
import crypto from 'node:crypto';
import {approvedHttpsUrl} from '../../src/config/deployment.ts';
import {canonicalBytes,encodeHeader,decodeHeader,closed,CONTROL_LIMIT,CHUNK_LIMIT,CONTROL_HEADER_LIMIT} from '../../src/recovery/encoding.ts';
import {validateRecoveryCommand,validateRecoveryJobProgress,validateRecoveryReceipt,validateProbeReceipt,validateResumeReceipt,validateRetirementReceipt,validateChunkMetadata} from '../../src/recovery/generated/recovery-validators.js';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const errors=new Set(['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','CONFLICT','AUTH_UNAVAILABLE','NOT_FOUND','LIMIT_EXCEEDED','DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR']);
export class RecoveryTransportError extends Error{
 constructor(code,status=null,requestId=null,serverCode=null,canonicalError=false){super(code);this.code=code;this.status=status;this.requestId=requestId;this.serverCode=serverCode;this.canonicalError=canonicalError;}
}
const bad=(code,status=null,id=null,server=null,canonical=false)=>new RecoveryTransportError(code,status,id,server,canonical);
const opaque=value=>typeof value==='string'&&value.length>0;
function serviceValid(service){return service&&typeof service.client_id==='string'&&service.client_id.length>0&&service.client_id.length<=2048&&typeof service.client_secret==='string'&&service.client_secret.length>0&&service.client_secret.length<=4096&&!/[\r\n]/.test(service.client_id+service.client_secret);}
function validatedData(value){return [validateRecoveryJobProgress,validateRecoveryReceipt,validateProbeReceipt,validateResumeReceipt,validateRetirementReceipt].some(validate=>validate(value));}
/** Production callers use the verified system HTTPS transport; requestImpl is dependency injection for local TLS tests only. */
export function createRecoveryTransport(config,{requestImpl=https.request,timeoutMs=10000}={}){
 let origin;try{origin=new URL(config.origin);}catch{throw bad('RECOVERY_INPUT_REJECTED');}
 if(origin.origin!==config.origin||!approvedHttpsUrl(config.origin+'/')||!serviceValid(config.service)||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw bad('RECOVERY_INPUT_REJECTED');
 const endpoint=new URL('/operator/recovery',origin);
 return async function send(command,binary){
  if(!validateRecoveryCommand(command)||command.operation==='install')throw bad('RECOVERY_INPUT_REJECTED');
  const writing=command.operation==='write-chunk',reading=command.operation==='read-chunk',control=Buffer.from(canonicalBytes(command));
  if(control.length>CONTROL_LIMIT)throw bad('RECOVERY_INPUT_REJECTED');
  let body=control;
  const headers={host:origin.host,accept:reading?'application/octet-stream, application/json':'application/json','content-type':'application/json','CF-Access-Client-Id':config.service.client_id,'CF-Access-Client-Secret':config.service.client_secret};
  if(writing){
   if(!(binary instanceof Uint8Array))throw bad('RECOVERY_INPUT_REJECTED');body=Buffer.from(binary);
   if(body.length<1||body.length>CHUNK_LIMIT||body.length!==command.payload.byte_size||hash(body)!==command.payload.sha256)throw bad('RECOVERY_INPUT_REJECTED');
   const encoded=encodeHeader(command);if(encoded.length>CONTROL_HEADER_LIMIT)throw bad('RECOVERY_INPUT_REJECTED');
   headers['content-type']='application/octet-stream';headers['X-CFHub-Recovery-Control']=encoded;
  }else if(binary!==undefined)throw bad('RECOVERY_INPUT_REJECTED');
  headers['content-length']=body.length;
  return new Promise((resolve,reject)=>{
   let settled=false,timeout;
   const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timeout);if(error)reject(error);else resolve(value);};
   const outgoing=requestImpl(endpoint,{method:'POST',agent:false,rejectUnauthorized:true,headers},response=>{
    const status=response.statusCode??0;
    if(status>=300&&status<400){done(bad('RECOVERY_REDIRECT_DENIED',status));response.destroy();return;}
    const maximum=status===200&&reading?CHUNK_LIMIT:CONTROL_LIMIT,chunks=[];let size=0;
    response.on('data',chunk=>{size+=chunk.length;if(size>maximum){done(bad('RECOVERY_RESPONSE_LIMIT',status));response.destroy();return;}chunks.push(Buffer.from(chunk));});
    response.on('error',()=>done(bad('RECOVERY_NETWORK_ERROR',status)));
    response.on('end',()=>{
     const raw=Buffer.concat(chunks),contentType=String(response.headers['content-type']??'').split(';')[0].trim().toLowerCase();
     if(status!==200){
      let id=null,server=null,canonical=false;try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));if(opaque(value?.error?.request_id))id=value.error.request_id;canonical=contentType==='application/json'&&closed(value,['error'])&&closed(value.error,['code','message','retryable','request_id'])&&errors.has(value.error.code)&&typeof value.error.message==='string'&&value.error.message.length>0&&value.error.retryable===false&&opaque(value.error.request_id);if(canonical)server=value.error.code;}catch{}
      done(bad('RECOVERY_HTTP_DENIED',status,id,server,canonical));return;
     }
     if(reading){
      try{
       if(contentType!=='application/octet-stream')throw Error();
       const header='x-cfhub-recovery-chunk',count=response.rawHeaders.filter((_,index)=>index%2===0&&response.rawHeaders[index].toLowerCase()===header).length;
       if(count!==1||typeof response.headers[header]!=='string')throw Error();
       const metadata=decodeHeader(response.headers[header]);
       if(!validateChunkMetadata(metadata)||metadata.capture_id!==command.capture_id||metadata.index!==command.payload.index||metadata.byte_size!==raw.length||metadata.sha256!==hash(raw))throw Error();
       done(null,{requestId:null,chunk:{metadata,bytes:raw},raw,sha256:hash(raw),status});return;
      }catch{done(bad('RECOVERY_INVALID_RESPONSE',status));return;}
     }
     try{
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
      if(contentType!=='application/json'||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'request_id')||!Object.hasOwn(value,'data')||!opaque(value.request_id)||!validatedData(value.data))throw Error();
      done(null,{requestId:value.request_id,data:value.data,raw,sha256:hash(raw),status});
     }catch{done(bad('RECOVERY_INVALID_RESPONSE',status));}
    });
   });
   timeout=setTimeout(()=>{done(bad('RECOVERY_NETWORK_ERROR'));outgoing.destroy();},timeoutMs);
   outgoing.on('error',()=>done(bad('RECOVERY_NETWORK_ERROR')));outgoing.end(body);
  });
 };
}
