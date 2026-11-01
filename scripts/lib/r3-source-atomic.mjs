/** Atomic visibility, not an authenticated or crash-durable execution attestation. */
import {constants,openSync,closeSync,writeSync,fsyncSync,linkSync,unlinkSync,lstatSync,realpathSync} from 'node:fs';
export function publishJ1Execution(directory,bytes){
 let published=false,created=false;const pending=directory+'/execution.pending',final=directory+'/execution.json';
 const syncDirectory=()=>{const fd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}};
 try{
  const stat=lstatSync(directory);if(realpathSync(directory)!==directory||!stat.isDirectory()||stat.mode&0o077||stat.uid!==process.getuid()||Object.getPrototypeOf(bytes)!==Uint8Array.prototype||bytes.length<1||bytes.length>65536)throw Error();
  const fd=openSync(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;
  try{let offset=0;while(offset<bytes.length){const n=writeSync(fd,bytes,offset,bytes.length-offset);if(n<=0)throw Error();offset+=n;}fsyncSync(fd);}finally{closeSync(fd);}
  linkSync(pending,final);published=true;unlinkSync(pending);created=false;syncDirectory();
 }catch{
  // A caught post-publication fsync failure is FAILED/uncertain, never success.
  // Crash after link may leave complete final bytes without directory durability.
  // Filename presence alone must never substitute for whole-record validation.
  if(published){try{unlinkSync(final);}catch{}}
  if(created){try{unlinkSync(pending);}catch{}}
  try{syncDirectory();}catch{}
  throw Error('R3_SOURCE_ATOMIC_FAILED');
 }
}
