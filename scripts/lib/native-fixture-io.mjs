/** Bounded UTF-8 JSON transport; cancellation remains owned until settlement. */
export function cancelFixtureBody(message,track){if(message?.body&&!message.body.locked)track(message.body.cancel());}
export async function readFixtureJson(message,limit,signal,track){
 if(!message.body)throw Error('FIXTURE_BODY_REJECTED');
 const reader=message.body.getReader(),chunks=[];let size=0,complete=false,cancelled=false;
 const cancel=()=>{if(!cancelled){cancelled=true;track(reader.cancel());}};
 signal.addEventListener('abort',cancel,{once:true});
 try{while(true){if(signal.aborted)throw Error('FIXTURE_BODY_REJECTED');const {done,value}=await reader.read();if(signal.aborted)throw Error('FIXTURE_BODY_REJECTED');if(done){complete=true;break;}if(!(value instanceof Uint8Array)||!value.byteLength||size+value.byteLength>limit)throw Error('FIXTURE_BODY_REJECTED');size+=value.byteLength;chunks.push(Buffer.from(value));}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}
 finally{signal.removeEventListener('abort',cancel);if(!complete)cancel();reader.releaseLock();}
}
