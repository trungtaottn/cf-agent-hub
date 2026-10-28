import type {StreamCompletion} from './types';
import {ClientFault,Deadline,faultResult} from './transport';
/** Pull-driven relay: at most one source chunk retained; never tee/collect the full object.
 * Source chunk allocation belongs to the producer; emitted slices are at most 64KiB. */
export function boundedStream(source:ReadableStream<Uint8Array>,expectedSize:number,deadline:Deadline,current:()=>void,onFinish:()=>void=()=>{}){
 const reader=source.getReader();let total=0,finished=false,pending:Uint8Array|undefined,offset=0;
 let controller:ReadableStreamDefaultController<Uint8Array>;
 let resolve!:(result:StreamCompletion)=>void;const completion=new Promise<StreamCompletion>(r=>resolve=r);
 const cleanup=()=>{deadline.signal.removeEventListener('abort',aborted);try{reader.releaseLock();}catch{}onFinish();};
 const stop=(error:unknown)=>{
  if(finished)return;finished=true;pending=undefined;
  const safe=faultResult(error instanceof ClientFault?error:new ClientFault('STREAM_INVALID'));
  const code=!safe.ok?safe.error.code:'STREAM_INVALID',message=!safe.ok?safe.error.message:'Invalid artifact stream';
  void reader.cancel().catch(()=>{});controller?.error(new ClientFault(code));resolve({ok:false,error:{code,message}});cleanup();
 };
 const aborted=()=>{try{deadline.check();}catch(error){stop(error);}};
 const body=new ReadableStream<Uint8Array>({
  start(c){controller=c;deadline.signal.addEventListener('abort',aborted,{once:true});if(deadline.signal.aborted)aborted();},
  async pull(c){
   try{
    current();
    if(!pending){const result=await deadline.wait(reader.read());current();if(finished)return;
     if(result.done){if(total!==expectedSize)throw new ClientFault('STREAM_INVALID');finished=true;c.close();resolve({ok:true,byteSize:total});cleanup();return;}
     if(!(result.value instanceof Uint8Array)||result.value.byteLength===0)throw new ClientFault('STREAM_INVALID');
     total+=result.value.byteLength;if(total>expectedSize)throw new ClientFault('STREAM_INVALID');pending=result.value;offset=0;
    }
    const end=Math.min(offset+65536,pending.length);c.enqueue(pending.subarray(offset,end));offset=end;if(offset===pending.length){pending=undefined;offset=0;}
   }catch(error){stop(error);}
  },
  cancel(){stop(new ClientFault('REQUEST_ABORTED'));}
 },{highWaterMark:0});
 return {body,completion,stop};
}
