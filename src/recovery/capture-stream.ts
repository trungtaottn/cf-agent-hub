/** Current16-only coalesced reads bound the number of provider checks independently of producer fragmentation. */
export function captureByobReader(body:ReadableStream<Uint8Array>){
 type Reader=ReadableStreamBYOBReader&{readAtLeast(minimum:number,view:Uint8Array):Promise<ReadableStreamReadResult<Uint8Array>>};
 let reader:Reader;
 try{reader=body.getReader({mode:'byob'}) as Reader;}catch{void body.cancel().catch(()=>{});throw Error('RECOVERY_BYOB_UNAVAILABLE');}
 if(typeof reader.readAtLeast!=='function'){void reader.cancel().catch(()=>{});reader.releaseLock();throw Error('RECOVERY_BYOB_UNAVAILABLE');}
 // Workers BYOB EOF may carry an empty view; do not inherit the default-reader done/value discriminant.
 return {read:(size:number)=>reader.readAtLeast(size,new Uint8Array(size)) as Promise<{done:boolean;value?:Uint8Array}>,cancel:()=>reader.cancel(),releaseLock:()=>reader.releaseLock()};
}
