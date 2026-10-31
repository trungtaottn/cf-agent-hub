/** Controller-owned raw input admission, not host authorization or consumed-byte proof. */
import {constants,openSync,closeSync,fstatSync,lstatSync,readSync} from 'node:fs';
import {dirname,basename,join,isAbsolute,normalize} from 'node:path';
import {createHash} from 'node:crypto';
import {getNativeScenario} from './native-r2-scenario.mjs';
import {inspectNativeDirectory} from './native-r2-admission.mjs';
const MAX_BYTES=65536,MAX_INPUTS=128,MAX_TOTAL=8388608;
const reject=()=>{throw Error('NATIVE_INPUT_REJECTED');};
function frozen(value){const pending=[value];while(pending.length){const next=pending.pop();if(next&&typeof next==='object'){for(const child of Object.values(next))if(child&&typeof child==='object')pending.push(child);Object.freeze(next);}}return value;}
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid&&a.mode===b.mode&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const sameDirectory=(a,b)=>a.isDirectory()&&b.isDirectory()&&!b.isSymbolicLink()&&a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid&&a.mode===b.mode&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
function readSnapshot(path){
 let dirFd,fd;
 try{
  if(typeof path!=='string'||path.length>4096||!isAbsolute(path)||normalize(path)!==path||path==='/'||/[\x00-\x1f\x7f]/.test(path))reject();
  const parent=dirname(path),admitted=inspectNativeDirectory(parent),namedParent=lstatSync(parent,{bigint:true});
  dirFd=openSync(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const pinned=fstatSync(dirFd,{bigint:true}),uid=BigInt(process.getuid());
  if(!sameDirectory(pinned,namedParent)||pinned.uid!==uid||(pinned.mode&0o7777n)!==0o700n||String(pinned.dev)!==admitted.dev||String(pinned.ino)!==admitted.ino)reject();
  const anchored=join('/proc/self/fd/'+dirFd,basename(path));
  fd=openSync(anchored,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=fstatSync(fd,{bigint:true}),named=lstatSync(anchored,{bigint:true});
  if(!before.isFile()||named.isSymbolicLink()||before.uid!==uid||(before.mode&0o7777n)!==0o600n||before.nlink!==1n||before.size<1n||before.size>BigInt(MAX_BYTES)||!sameFile(before,named)||!sameDirectory(pinned,lstatSync(parent,{bigint:true})))reject();
  // Size and the entire fixed-roster reservation are admitted before allocation/read.
  const bytes=Buffer.alloc(Number(before.size)+1);let count=0;
  while(count<bytes.length){const n=readSync(fd,bytes,count,bytes.length-count,count);if(n===0)break;count+=n;}
  const after=fstatSync(fd,{bigint:true}),namedAfter=lstatSync(anchored,{bigint:true});
  if(BigInt(count)!==before.size||namedAfter.isSymbolicLink()||!sameFile(before,after)||!sameFile(after,namedAfter)||!sameDirectory(pinned,fstatSync(dirFd,{bigint:true}))||!sameDirectory(pinned,lstatSync(parent,{bigint:true})))reject();
  const finalParent=inspectNativeDirectory(parent);if(finalParent.dev!==admitted.dev||finalParent.ino!==admitted.ino)reject();
  const captured=bytes.subarray(0,count),sha256=createHash('sha256').update(captured).digest('hex');
  return frozen({sha256,byteSize:count,body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(captured))});
 }finally{if(fd!==undefined)try{closeSync(fd);}catch{}if(dirFd!==undefined)try{closeSync(dirFd);}catch{}}
}
/** No caller roster/cap overrides. Construct before the first scenario effect. */
export function createNativeInputAdmission(){
 if(arguments.length!==0)reject();
 const roster=getNativeScenario().steps.filter(step=>step.refKeys.includes('input_file')).map(step=>step.id),allowed=new Set(roster),reservedBytes=roster.length*MAX_BYTES;
 if(roster.length<1||roster.length>MAX_INPUTS||allowed.size!==roster.length||reservedBytes>MAX_TOTAL)reject();
 const attempted=new Set(),records=[];let poisoned=false,reading=false;
 return Object.freeze({
  read(stepId,path){
   try{
    if(poisoned||reading||typeof stepId!=='string'||!allowed.has(stepId)||attempted.has(stepId))reject();
    attempted.add(stepId);reading=true;
    const snapshot=readSnapshot(path);if(poisoned)reject();
    records.push(Object.freeze({stepId,sha256:snapshot.sha256,byteSize:snapshot.byteSize}));return snapshot;
   }catch{poisoned=true;reject();}finally{reading=false;}
  },
  readProtectedSummary(){return frozen({status:poisoned?'incomplete':records.length===roster.length?'admitted-input-byte-pins':'pending',plannedInputs:roster.length,reservedBytes,attemptedInputs:attempted.size,admittedInputs:records.length,records:records.map(row=>({...row}))});}
 });
}
