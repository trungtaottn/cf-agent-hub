import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,lstatSync,fstatSync,readSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
const MiB=1024*1024;
export const R2_LIMITS=Object.freeze({root:4*MiB,sourceFile:16*MiB,sourceTotal:32*MiB,componentFile:16*MiB,componentTotal:32*MiB,evidenceFile:4*MiB,evidenceTotal:16*MiB,command:64*1024,referenceCount:256,sourceCount:2048});
const reject=code=>{throw Error(code);};
export const safeR2Path=path=>typeof path==='string'&&Buffer.byteLength(path)<=256&&path.length>0&&!/[\\\x00-\x20\x7f]/.test(path)&&!path.startsWith('/')&&!/^[a-z]:/i.test(path)&&path.split('/').every(x=>x!==''&&x!=='.'&&x!=='..');
function diskBytes(root,path,size,bound){
 if(!safeR2Path(path))reject('R2_PATH');
 const base=realpathSync(root),absolute=resolve(base,path),rel=relative(base,absolute);
 if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)||realpathSync(absolute)!==absolute)reject('R2_PATH');
 const before=lstatSync(absolute);if(!before.isFile())reject('R2_PATH');
 if(before.size>bound)reject('R2_BUDGET');if(size!==null&&before.size!==size)reject('R2_SIZE');
 let fd;try{
  fd=openSync(absolute,constants.O_RDONLY|constants.O_NOFOLLOW);const observed=fstatSync(fd);
  if(!observed.isFile()||observed.dev!==before.dev||observed.ino!==before.ino||observed.size!==before.size)reject('R2_CHANGED');
  const bytes=Buffer.alloc(observed.size);let offset=0;
  while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)reject('R2_CHANGED');offset+=n;}
  if(readSync(fd,Buffer.alloc(1),0,1,null)!==0||fstatSync(fd).size!==observed.size)reject('R2_CHANGED');
  return bytes;
 }finally{if(fd!==undefined)closeSync(fd);}
}
function decode(bytes){
 if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)reject('R2_ENCODING');
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{reject('R2_ENCODING');}
}
export function readR2Root(root,path){return JSON.parse(decode(diskBytes(root,path,null,R2_LIMITS.root)));}
/** Finite budgets cover verifier-owned reads/copies, not allocations made by a Map caller. */
export function createR2Reader({files,root,releaseId}){
 if((files instanceof Map)===(typeof root==='string')||typeof releaseId!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(releaseId))reject('R2_INPUT');
 const prefix='validation/releases/'+releaseId+'/',seen=new Map(),usage={source:0,component:0,evidence:0,sourceCount:0,referenceCount:0};
 const reserveAll=batch=>{
  if(!Array.isArray(batch))reject('R2_BUDGET');
  const pending=new Map(),next={...usage};
  for(const {ref,category,type,bound=Number.MAX_SAFE_INTEGER} of batch){
   if(!ref||!safeR2Path(ref.path))reject('R2_PATH');
   if(!/^([a-f0-9]{64})$/.test(ref.sha256)||!Number.isSafeInteger(ref.byte_size)||ref.byte_size<0||!['source','component','evidence'].includes(category)||typeof type!=='string'||!type.length||!Number.isSafeInteger(bound)||bound<0)reject('R2_REF');
   if(category==='source'?(ref.path.startsWith(prefix)||ref.path.split('/').some(x=>['.git','node_modules','.superpowers'].includes(x))):!ref.path.startsWith(prefix))reject('R2_PATH');
   const previous=pending.get(ref.path)??seen.get(ref.path);
   if(previous&&(previous.sha256!==ref.sha256||previous.byte_size!==ref.byte_size||previous.category!==category||previous.type!==type))reject('R2_REF_CONFLICT');
   const cap=R2_LIMITS[category+'File'],total=R2_LIMITS[category+'Total'],count=category==='source'?'sourceCount':'referenceCount';
   if(ref.byte_size>Math.min(cap,bound))reject('R2_BUDGET');
   if(previous)continue;
   if(next[category]+ref.byte_size>total||next[count]+1>R2_LIMITS[count])reject('R2_BUDGET');
   next[category]+=ref.byte_size;next[count]++;pending.set(ref.path,{...ref,category,type});
  }
  for(const [path,value]of pending)seen.set(path,value);
  Object.assign(usage,next);
 };
 const read=(ref,category,type,bound)=>{
  reserveAll([{ref,category,type,bound}]);
  const reserved=seen.get(ref.path);if(reserved.bytes)return reserved.bytes;
  const cap=R2_LIMITS[category+'File'];
  let bytes;
  if(files){const value=files.get(ref.path);if(typeof value!=='string'&&!(value instanceof Uint8Array))reject('R2_MISSING');if(Buffer.byteLength(value)!==ref.byte_size)reject('R2_SIZE');bytes=Buffer.from(value);}
  else bytes=diskBytes(root,ref.path,ref.byte_size,Math.min(cap,bound));
  if(createHash('sha256').update(bytes).digest('hex')!==ref.sha256)reject('R2_DIGEST');
  seen.set(ref.path,{...ref,category,type,bytes});return bytes;
 };
 return {reserveAll,get usage(){return {...usage};},bytes:(ref,category,type,bound=Number.MAX_SAFE_INTEGER)=>read(ref,category,type,bound),json:(ref,category,type,bound=R2_LIMITS.evidenceFile)=>JSON.parse(decode(read(ref,category,type,bound)))};
}
