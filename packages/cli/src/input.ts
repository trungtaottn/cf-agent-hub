import {constants,openSync,closeSync,fstatSync,readSync} from 'node:fs';
const MAX_INPUT_BYTES=65536;
/** Read one bounded regular file descriptor. Never include payload or path in errors. */
export function readInputFile(path:string):unknown {
 let fd:number|undefined;
 try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=fstatSync(fd,{bigint:true});
  if(!before.isFile()||before.size>BigInt(MAX_INPUT_BYTES))throw Error();
  const bytes=Buffer.alloc(MAX_INPUT_BYTES+1);let count=0;
  while(count<bytes.length){const read=readSync(fd,bytes,count,bytes.length-count,null);if(read===0)break;count+=read;}
  const after=fstatSync(fd,{bigint:true});
  if(count>MAX_INPUT_BYTES||BigInt(count)!==before.size||after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs)throw Error();
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,count)));
 }catch{throw Error('CLI_INPUT_REJECTED');}finally{if(fd!==undefined)closeSync(fd);}
}
