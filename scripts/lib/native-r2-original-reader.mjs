/** Controller-owned custody ingestion. No arbitrary filenames, secrets or authority inference. */
import {constants,openSync,closeSync,fstatSync,lstatSync,readSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectNativeDirectory} from './native-r2-admission.mjs';
const reject=()=>{throw Error('NATIVE_ORIGINAL_READ_REJECTED');};
const kinds=['prepared','spawned','final'];
function closed(value,keys){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)reject();
 const ds=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!Object.hasOwn(ds,k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))reject();
 return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
export function planNativeOriginalReads(invocationId,custody,remainingBytes){
 if(typeof invocationId!=='string'||!/^inv_[a-z0-9]{1,64}$/.test(invocationId)||!Number.isSafeInteger(remainingBytes)||remainingBytes<0||remainingBytes>16777216)reject();
 const refs=closed(custody,kinds);let totalBytes=0;
 const entries=kinds.map(kind=>{
  const ref=closed(refs[kind],['name','sha256','byteSize']);
  if(ref.name!==invocationId+'.'+kind+'.json'||typeof ref.sha256!=='string'||!/^[a-f0-9]{64}$/.test(ref.sha256)||!Number.isSafeInteger(ref.byteSize)||ref.byteSize<1||ref.byteSize>65536)reject();
  totalBytes+=ref.byteSize;return Object.freeze({kind,...ref});
 });
 if(totalBytes>remainingBytes)reject();return Object.freeze({entries:Object.freeze(entries),totalBytes});
}
/** Pure metadata policy; source tests of this predicate are not actual filesystem custody. */
export function nativeOriginalStatAllowed(stat,uid,expectedBytes){
 return Boolean(Number.isSafeInteger(uid)&&uid>=0&&Number.isSafeInteger(expectedBytes)&&expectedBytes>0&&expectedBytes<=65536&&stat?.regular===true&&stat.uid===BigInt(uid)&&typeof stat.mode==='bigint'&&(stat.mode&0o7777n)===0o600n&&stat.nlink===1n&&stat.size===BigInt(expectedBytes));
}
export function nativeOriginalDirectoryAllowed(stat,admitted,uid){
 return Boolean(Number.isSafeInteger(uid)&&uid>=0&&stat?.directory===true&&stat.uid===BigInt(uid)&&typeof stat.mode==='bigint'&&(stat.mode&0o7777n)===0o700n&&String(stat.dev)===admitted?.dev&&String(stat.ino)===admitted?.ino);
}
const directoryInfo=s=>({directory:s.isDirectory(),uid:s.uid,mode:s.mode,dev:s.dev,ino:s.ino});
const fileInfo=s=>({regular:s.isFile(),uid:s.uid,mode:s.mode,nlink:s.nlink,size:s.size});
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid&&a.mode===b.mode&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const sameDirectory=(a,b)=>a.isDirectory()&&b.isDirectory()&&!b.isSymbolicLink()&&a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid&&a.mode===b.mode&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
/** Caller must subtract totalBytes from its run-wide reservation before another read.
 * All three exact lengths are admitted before any payload allocation/read. */
export function readNativeProcessOriginals(input){
 const opened=[];let dirFd;
 try{
  const {outputDirectory,invocationId,custody,remainingBytes}=closed(input,['outputDirectory','invocationId','custody','remainingBytes']);
  const plan=planNativeOriginalReads(invocationId,custody,remainingBytes);
  const admittedOutput=inspectNativeDirectory(outputDirectory);const directory=join(outputDirectory,invocationId),admittedChild=inspectNativeDirectory(directory);
  const namedDirectory=lstatSync(directory,{bigint:true});
  dirFd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const pinnedDirectory=fstatSync(dirFd,{bigint:true});if(!sameDirectory(pinnedDirectory,namedDirectory)||!nativeOriginalDirectoryAllowed(directoryInfo(pinnedDirectory),admittedChild,process.getuid()))reject();
  const uid=process.getuid(),anchor='/proc/self/fd/'+dirFd;
  // Open/stat every bounded member before any payload is allocated or read.
  for(const entry of plan.entries){
   const path=join(anchor,entry.name),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);opened.push({fd,path,entry});
   const before=fstatSync(fd,{bigint:true}),named=lstatSync(path,{bigint:true});
   if(named.isSymbolicLink()||!nativeOriginalStatAllowed(fileInfo(before),uid,entry.byteSize)||!sameFile(before,named))reject();opened.at(-1).before=before;
  }
  if(!sameDirectory(pinnedDirectory,lstatSync(directory,{bigint:true})))reject();
  const records=[];
  for(const item of opened){
   const bytes=Buffer.alloc(item.entry.byteSize);let offset=0;
   while(offset<bytes.length){const n=readSync(item.fd,bytes,offset,bytes.length-offset,offset);if(n<1)reject();offset+=n;}
   const extra=Buffer.alloc(1);if(readSync(item.fd,extra,0,1,offset)!==0)reject();
   const after=fstatSync(item.fd,{bigint:true}),named=lstatSync(item.path,{bigint:true});
   if(named.isSymbolicLink()||!sameFile(item.before,after)||!sameFile(after,named)||createHash('sha256').update(bytes).digest('hex')!==item.entry.sha256)reject();
   records.push({kind:item.entry.kind,id:invocationId+'_'+item.entry.kind,sha256:item.entry.sha256,bytes});
  }
  if(!sameDirectory(pinnedDirectory,fstatSync(dirFd,{bigint:true}))||!sameDirectory(pinnedDirectory,lstatSync(directory,{bigint:true})))reject();
  const finalOutput=inspectNativeDirectory(outputDirectory);if(finalOutput.dev!==admittedOutput.dev||finalOutput.ino!==admittedOutput.ino)reject();
  const result={status:'read',recordCount:records.length,totalBytes:plan.totalBytes};
  Object.defineProperty(result,'readProtectedRecords',{enumerable:false,value:()=>records.map(r=>({...r,bytes:Buffer.from(r.bytes)}))});return Object.freeze(result);
 }catch{reject();}
 finally{for(const {fd} of opened)try{closeSync(fd);}catch{}if(dirFd!==undefined)try{closeSync(dirFd);}catch{}}
}
