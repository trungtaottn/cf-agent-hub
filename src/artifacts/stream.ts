import {HttpError} from '../http/envelopes';
import {ARTIFACT_MAX_BYTES} from './repository';
export const ARTIFACT_CHUNK_BYTES=65536;
export interface ByteIdentity {byteSize:number;sha256:string;}
/** Serial backpressure: no tee, accumulated chunks, whole-body digest or base64. */
export async function inspectArtifactStream(body:ReadableStream<Uint8Array>,expectedSize:number,sink?:WritableStreamDefaultWriter<Uint8Array>,signal?:AbortSignal):Promise<ByteIdentity>{
 if(!Number.isSafeInteger(expectedSize)||expectedSize<0||expectedSize>ARTIFACT_MAX_BYTES)throw new HttpError('LIMIT_EXCEEDED',413);
 const reader=body.getReader(),digest=new (crypto as Crypto & {DigestStream:typeof DigestStream}).DigestStream('SHA-256'),hasher=digest.getWriter();
 // Abort rejects digest too; attach immediately so failure never leaks an unhandled promise.
 const hash=digest.digest.then(value=>({value}),error=>({error}));let count=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try{
  for(;;){if(signal?.aborted)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);const {done,value}=await reader.read();if(signal?.aborted)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);if(done)break;
   if(!(value instanceof Uint8Array))throw new HttpError('INVALID_REQUEST',400);
   count+=value.byteLength;if(count>ARTIFACT_MAX_BYTES)throw new HttpError('LIMIT_EXCEEDED',413);
   if(count>expectedSize)throw new HttpError('INVALID_REQUEST',400);
   for(let offset=0;offset<value.byteLength;offset+=ARTIFACT_CHUNK_BYTES){const part=value.subarray(offset,offset+ARTIFACT_CHUNK_BYTES);await hasher.write(part);if(sink)await sink.write(part);}
  }
  if(count!==expectedSize)throw new HttpError('INVALID_REQUEST',400);
  await hasher.close();if(sink)await sink.close();const result=await hash;if('error'in result)throw result.error;
  return {byteSize:count,sha256:Array.from(new Uint8Array(result.value),x=>x.toString(16).padStart(2,'0')).join('')};
 }catch(error){
  await Promise.allSettled([reader.cancel(),hasher.abort(error),...(sink?[sink.abort(error)]:[])]);throw error;
 }finally{signal?.removeEventListener('abort',abort);reader.releaseLock();hasher.releaseLock();sink?.releaseLock();}
}
