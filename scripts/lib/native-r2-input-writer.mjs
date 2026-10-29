/** Exclusive source-plan publication only. No host authorization or consumed-byte claim. */
import {constants,openSync,closeSync,fstatSync,lstatSync,writeSync,fsyncSync} from 'node:fs';
import {dirname,basename,join,relative,isAbsolute,normalize} from 'node:path';
import {createHash} from 'node:crypto';
import {getNativeScenario} from './native-r2-scenario.mjs';
import {inspectNativeDirectory} from './native-r2-admission.mjs';
const MAX_BYTES=65536,reject=()=>{throw Error('NATIVE_INPUT_WRITE_REJECTED');};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function closed(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype)reject();const ds=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!Object.hasOwn(ds,k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))reject();return Object.fromEntries(keys.map(k=>[k,ds[k].value]));}
function pathAllowed(path){return typeof path==='string'&&path.length<=4096&&isAbsolute(path)&&normalize(path)===path&&path!=='/'&&!/[\x00-\x1f\x7f]/.test(path);}
function canonicalBody(value){
 const seen=new Set();let nodes=0,serializedBytes=0;
 // Charge each emitted token exactly once before traversing the next child or
 // constructing aggregate strings. Per-token strings are independently bounded.
 function charge(token){serializedBytes+=Buffer.byteLength(token);if(serializedBytes>MAX_BYTES)reject();return token;}
 function visit(v,depth){
  if(++nodes>65536||depth>128)reject();
  if(v===null)return charge('null');if(typeof v==='string'){if(v.length>MAX_BYTES)reject();return charge(JSON.stringify(v));}if(typeof v==='boolean')return charge(String(v));if(typeof v==='number'){if(!Number.isFinite(v))reject();return charge(JSON.stringify(v));}
  if(!v||typeof v!=='object'||seen.has(v))reject();seen.add(v);
  const array=Array.isArray(v);if(Object.getPrototypeOf(v)!==(array?Array.prototype:Object.prototype))reject();const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);if(keys.length>65536||keys.some(k=>typeof k!=='string'||!Object.hasOwn(ds[k],'value')))reject();let out;
  if(array){const length=ds.length?.value;if(!Number.isSafeInteger(length)||length<0||length>65535||keys.length!==length+1)reject();charge('[]');const parts=[];for(let i=0;i<length;i++){if(!Object.hasOwn(ds,String(i))||!ds[i].enumerable)reject();if(i)charge(',');parts.push(visit(ds[i].value,depth+1));}out='['+parts.join(',')+']';}
  else{if(keys.some(k=>!ds[k].enumerable||k.length>MAX_BYTES))reject();charge('{}');const parts=[];for(const k of keys.sort()){if(parts.length)charge(',');const key=charge(JSON.stringify(k));charge(':');const child=visit(ds[k].value,depth+1);parts.push(key+':'+child);}out='{'+parts.join(',')+'}';}
  seen.delete(v);return out;
 }
 return visit(value,0);
}
function planSnapshot(value){const p=closed(value,['body','json','sha256','byteSize']);if(typeof p.json!=='string'||p.json.length>MAX_BYTES||typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256)||!Number.isSafeInteger(p.byteSize)||p.byteSize<1||p.byteSize>MAX_BYTES||Buffer.byteLength(p.json)!==p.byteSize)reject();if(!p.body||Object.getPrototypeOf(p.body)!==Object.prototype||canonicalBody(p.body)!==p.json)reject();const bytes=Buffer.from(p.json,'utf8');if(digest(bytes)!==p.sha256)reject();return {bytes,sha256:p.sha256,byteSize:p.byteSize};}
const identity=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid&&a.mode===b.mode;
const dirEqual=(a,b)=>a.isDirectory()&&b.isDirectory()&&!b.isSymbolicLink()&&identity(a,b);
const fileEqual=(a,b)=>identity(a,b)&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
function publish(fixture,path,plan,guard){
 let dirFd,fd;
 try{
  const fixtureAdmission=inspectNativeDirectory(fixture),fixtureStat=lstatSync(fixture,{bigint:true}),parent=dirname(path),parentAdmission=inspectNativeDirectory(parent),namedParent=lstatSync(parent,{bigint:true}),uid=BigInt(process.getuid());
  dirFd=openSync(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);const pinned=fstatSync(dirFd,{bigint:true});
  if(!dirEqual(pinned,namedParent)||pinned.uid!==uid||(pinned.mode&0o7777n)!==0o700n||String(pinned.dev)!==parentAdmission.dev||String(pinned.ino)!==parentAdmission.ino)reject();
  const anchor=join('/proc/self/fd/'+dirFd,basename(path));guard();
  // Never unlink, overwrite, chmod or retry: any partial file remains for explicit inspection.
  fd=openSync(anchor,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  const initial=fstatSync(fd,{bigint:true}),named=lstatSync(anchor,{bigint:true});
  if(!initial.isFile()||named.isSymbolicLink()||initial.uid!==uid||(initial.mode&0o7777n)!==0o600n||initial.nlink!==1n||initial.size!==0n||!fileEqual(initial,named)||!dirEqual(pinned,lstatSync(parent,{bigint:true})))reject();
  let offset=0;while(offset<plan.bytes.length){guard();const n=writeSync(fd,plan.bytes,offset,plan.bytes.length-offset,offset);if(!Number.isInteger(n)||n<1||n>plan.bytes.length-offset)reject();offset+=n;}
  fsyncSync(fd);fsyncSync(dirFd);guard();
  const after=fstatSync(fd,{bigint:true}),namedAfter=lstatSync(anchor,{bigint:true});
  if(!after.isFile()||namedAfter.isSymbolicLink()||!identity(initial,after)||after.nlink!==1n||after.size!==BigInt(plan.byteSize)||!fileEqual(after,namedAfter)||!dirEqual(pinned,fstatSync(dirFd,{bigint:true}))||!dirEqual(pinned,lstatSync(parent,{bigint:true}))||!dirEqual(fixtureStat,lstatSync(fixture,{bigint:true})))reject();
  const finalFixture=inspectNativeDirectory(fixture),finalParent=inspectNativeDirectory(parent);if(finalFixture.dev!==fixtureAdmission.dev||finalFixture.ino!==fixtureAdmission.ino||finalParent.dev!==parentAdmission.dev||finalParent.ino!==parentAdmission.ino)reject();
 }finally{let failed=false;if(fd!==undefined)try{closeSync(fd);}catch{failed=true;}if(dirFd!==undefined)try{closeSync(dirFd);}catch{failed=true;}if(failed)reject();}
}
export function createNativeInputWriter(configuration){
 let fixtureDirectory;try{({fixtureDirectory}=closed(configuration,['fixtureDirectory']));if(!pathAllowed(fixtureDirectory))reject();}catch{reject();}
 const roster=getNativeScenario().steps.filter(s=>s.refKeys.includes('input_file')).map(s=>s.id),allowed=new Set(roster),reservedBytes=roster.length*MAX_BYTES;if(roster.length!==27||allowed.size!==27||reservedBytes>8388608)reject();
 const steps=new Set(),paths=new Set(),records=[];let poisoned=false,writing=false;
 return Object.freeze({write(stepId,path,plan){try{
  if(poisoned||writing||typeof stepId!=='string'||!allowed.has(stepId)||steps.has(stepId)||!pathAllowed(path)||paths.has(path))reject();const local=relative(fixtureDirectory,path);if(local===''||isAbsolute(local)||local==='..'||local.startsWith('../'))reject();
  steps.add(stepId);paths.add(path);writing=true;const captured=planSnapshot(plan);const guard=()=>{if(poisoned)reject();};guard();publish(fixtureDirectory,path,captured,guard);guard();
  const receipt=Object.freeze({status:'published-input',stepId,sha256:captured.sha256,byteSize:captured.byteSize});records.push(receipt);return receipt;
 }catch{poisoned=true;reject();}finally{writing=false;}},readProtectedSummary(){return Object.freeze({status:poisoned?'incomplete':records.length===roster.length?'source-inputs-published':'pending',plannedInputs:roster.length,reservedBytes,attemptedInputs:steps.size,publishedInputs:records.length,records:Object.freeze(records.map(row=>Object.freeze({...row})))});}});
}
