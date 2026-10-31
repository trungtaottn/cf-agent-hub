import {captureByobReader} from './capture-stream';
import type {ArtifactCopyEffect} from './restore-artifact-effect';
import {requireArtifactBucket} from './artifacts';
import {ARTIFACT_BYTES,closed,hex,isSlug} from './encoding';
import type {RecoveryWorkspace,CurrentRecoveryArtifactEntry} from './protocol';

/** Restore guards are explicitly asynchronous; never pass these into capture's void callbacks. */
type FreshGuard=()=>Promise<void>;
function validateEntry(w:RecoveryWorkspace,e:CurrentRecoveryArtifactEntry):void {
 if(!closed(e,['artifact_id','generation_id','artifact_version','object_key','recovery_object_key','byte_size','sha256'])||!isSlug(e.artifact_id)||!/^generation_[a-f0-9]{48}$/.test(e.generation_id)||!Number.isSafeInteger(e.artifact_version)||e.artifact_version<1||!Number.isSafeInteger(e.byte_size)||e.byte_size<0||e.byte_size>ARTIFACT_BYTES||!/^[a-f0-9]{64}$/.test(e.sha256))throw Error('RECOVERY_ARTIFACT_IDENTITY_MISMATCH');
 const suffix=`${w.workspaceId}/${e.artifact_id}/${e.generation_id}/${e.sha256}`,parts=e.recovery_object_key.split('/');
 if(e.object_key!==`artifacts/${suffix}`||parts.length!==7||parts[0]!=='r2'||parts[1]!==w.workspaceId||!isSlug(parts[2])||parts.slice(3).join('/')!==`artifacts/${e.artifact_id}/${e.generation_id}/${e.sha256}`)throw Error('RECOVERY_ARTIFACT_IDENTITY_MISMATCH');
}
/** Retain one source chunk; writes to the hash and destination have serial backpressure. */
async function verifyStream(body:ReadableStream<Uint8Array>,entry:CurrentRecoveryArtifactEntry,guard:FreshGuard,sink?:WritableStreamDefaultWriter<Uint8Array>,signal?:AbortSignal):Promise<void>{
 let reader:ReturnType<typeof captureByobReader>;
 try{reader=captureByobReader(body);}
 catch(error){await Promise.allSettled([body.cancel(),...(sink?[sink.abort()]:[])]);sink?.releaseLock();throw error;}
 const digest=new (crypto as Crypto&{DigestStream:typeof DigestStream}).DigestStream('SHA-256'),writer=digest.getWriter();
 const hash=digest.digest.then(value=>({value}),()=>({error:true as const}));let count=0;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
 const check=async()=>{await guard();if(signal?.aborted)throw Error('RECOVERY_ARTIFACT_COPY_INTERRUPTED');};
 try{
  for(;;){await check();const part=await reader.read(65536);await check();if(part.done&&!part.value?.byteLength)break;
   if(!(part.value instanceof Uint8Array)||!part.value.byteLength)throw Error('RECOVERY_ARTIFACT_BYTES_MISMATCH');count+=part.value.byteLength;if(count>entry.byte_size||count>ARTIFACT_BYTES)throw Error('RECOVERY_ARTIFACT_BYTES_MISMATCH');
   for(let offset=0;offset<part.value.byteLength;offset+=65536){const bytes=part.value.subarray(offset,offset+65536);await check();await writer.write(bytes);await check();if(sink){await sink.write(bytes);await check();}}
   if(part.done)break;
  }
  if(count!==entry.byte_size)throw Error('RECOVERY_ARTIFACT_BYTES_MISMATCH');await check();await writer.close();await check();const result=await hash;await check();if('error'in result||hex(result.value)!==entry.sha256)throw Error('RECOVERY_ARTIFACT_BYTES_MISMATCH');
  if(sink){await sink.close();await check();}
 }catch(error){
  // Cleanup is not an external object mutation and cannot prove a dispatched PUT had no effect.
  await Promise.allSettled([reader.cancel(),writer.abort(),...(sink?[sink.abort()]:[])]);throw error;
 }finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();writer.releaseLock();sink?.releaseLock();}
}
async function readObject(bucket:R2Bucket,key:string,entry:CurrentRecoveryArtifactEntry,guard:FreshGuard):Promise<R2ObjectBody|null>{
 await guard();const object=await bucket.get(key);try{await guard();}catch(error){void object?.body.cancel().catch(()=>{});throw error;}
 if(object&&object.size!==entry.byte_size){void object.body.cancel().catch(()=>{});throw Error('RECOVERY_ARTIFACT_BYTES_MISMATCH');}return object;
}
async function verifyObject(bucket:R2Bucket,key:string,entry:CurrentRecoveryArtifactEntry,guard:FreshGuard):Promise<boolean>{
 const object=await readObject(bucket,key,entry,guard);if(!object)return false;await verifyStream(object.body,entry,guard);await guard();return true;
}
/** One immutable, conditional transfer. Caller keeps its durable pending reservation until this succeeds. */
export async function copyArtifactFromRecovery(w:RecoveryWorkspace,input:CurrentRecoveryArtifactEntry,fresh:FreshGuard,effect:ArtifactCopyEffect):Promise<void>{
 const target=requireArtifactBucket(w),sourceBucket=w.bucket,workspaceId=w.workspaceId,entry=structuredClone(input);validateEntry(w,entry);
 const local=()=>{if(w.bucket!==sourceBucket||w.artifactBucket!==target||w.workspaceId!==workspaceId||target===sourceBucket)throw Error('RECOVERY_ARTIFACT_BINDING_UNAVAILABLE');};
 let guardFailure:{error:unknown}|null=null;
 const guard=async()=>{try{local();await fresh();local();}catch(error){guardFailure={error};throw error;}};
 await guard();const effectState=effect.inspect();
 // Even a preexisting destination is not a substitute for authenticated source completeness.
 if(!await verifyObject(sourceBucket,entry.recovery_object_key,entry,guard))throw Error('RECOVERY_ARTIFACT_MISSING');await guard();
 if(await verifyObject(target,entry.object_key,entry,guard)){await guard();if(effectState==='reserved')effect.existing();return;}await guard();
 if(effectState==='terminal')throw Error('RECOVERY_ARTIFACT_MISSING');
 const source=await readObject(sourceBucket,entry.recovery_object_key,entry,guard);if(!source)throw Error('RECOVERY_ARTIFACT_MISSING');
 try{await guard();}catch(error){void source.body.cancel().catch(()=>{});throw error;}
 const fixed=new FixedLengthStream(entry.byte_size),writer=fixed.writable.getWriter(),abort=new AbortController();
 // Observe rejection immediately and unblock a producer waiting for destination backpressure.
 let request:Promise<R2Object|null>;
 try{effect.dispatch();request=target.put(entry.object_key,fixed.readable,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:entry.sha256});}
 catch(error){void source.body.cancel().catch(()=>{});void writer.abort().catch(()=>{});writer.releaseLock();throw error;}
 const put=request.then(async value=>{
  try{await guard();effect.settled();}catch(error){abort.abort();void writer.abort().catch(()=>{});return {error};}
  if(value===null){abort.abort();void writer.abort().catch(()=>{});}return {value};
 },error=>{abort.abort();void writer.abort().catch(()=>{});return {error};});
 let failure:{error:unknown}|null=null;try{await verifyStream(source.body,entry,guard,writer,abort.signal);await guard();}catch(error){failure={error};}
 const result=await put;await guard();if('error'in result)throw result.error;
 // Conditional conflict is recoverable only through a fresh full destination readback.
 if(guardFailure)throw (guardFailure as {error:unknown}).error;
 if(failure&&(result.value!==null||failure.error instanceof Error&&failure.error.message==='RECOVERY_ARTIFACT_BYTES_MISMATCH'))throw failure.error;
 if(!await verifyObject(target,entry.object_key,entry,guard))throw Error('RECOVERY_ARTIFACT_MISSING');await guard();
}
