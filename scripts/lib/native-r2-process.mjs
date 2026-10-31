import {spawn} from 'node:child_process';
import {constants,openSync,closeSync,readSync,writeSync,fstatSync,lstatSync,realpathSync,fchmodSync,fsyncSync,readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const HASH=/^[a-f0-9]{64}$/;
const SUBJECTS=['config_sha256','candidate_sha','candidate_tree_sha','composition_sha256','node_sha256','build_sha256','authority_record_sha256','scenario_sha256','actors_sha256','workspaces_sha256'];
const KEYS=['nodePath','entryPath','args','cwd','env','receiptDirectory','timeoutMs','maxOutputBytes','invocationId','nodeSha256','entrySha256','subjects'];
export const PROCESS_LIMITS=Object.freeze({timeoutMs:300000,outputBytes:1048576,nodeBytes:268435456,entryBytes:33554432,receiptBytes:8192,termGraceMs:100,drainGraceMs:100});
const rejected=(code='NATIVE_PROCESS_INPUT_REJECTED')=>{throw Error(code);};
const closed=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const positive=(n,max)=>Number.isSafeInteger(n)&&n>0&&n<=max;
function validateInput(input){
 if(!closed(input,KEYS)||process.platform!=='linux'||typeof process.getuid!=='function')rejected();
 const {nodePath,entryPath,args,cwd,env,receiptDirectory,timeoutMs,maxOutputBytes,invocationId,nodeSha256,entrySha256,subjects}=input;
 for(const path of [nodePath,entryPath,cwd,receiptDirectory])if(typeof path!=='string'||path.length>4096||/[\x00-\x1f\x7f]/.test(path)||!isAbsolute(path)||resolve(path)!==path)rejected();
 if(!entryPath.endsWith('.mjs')||!HASH.test(nodeSha256)||!HASH.test(entrySha256)||typeof invocationId!=='string'||!/^inv_[a-z0-9]{1,64}$/.test(invocationId))rejected();
 if(!positive(timeoutMs,PROCESS_LIMITS.timeoutMs)||!positive(maxOutputBytes,PROCESS_LIMITS.outputBytes))rejected();
 if(!Array.isArray(args)||args.length>128||args.some(x=>typeof x!=='string'||Buffer.byteLength(x)>8192||/[\x00-\x1f\x7f]/.test(x))||Buffer.byteLength(JSON.stringify(args))>65536)rejected();
 if(!env||typeof env!=='object'||Array.isArray(env)||Object.keys(env).some(key=>!['LANG','LC_ALL','TZ'].includes(key))||Object.entries(env).some(([key,value])=>key==='TZ'?value!=='UTC':!['C','C.UTF-8'].includes(value)))rejected('NATIVE_PROCESS_ENV_REJECTED');
 if(!closed(subjects,SUBJECTS)||SUBJECTS.some(key=>!(key==='candidate_sha'||key==='candidate_tree_sha'?/^[a-f0-9]{40}$/:HASH).test(subjects[key]))||subjects.node_sha256!==nodeSha256||subjects.build_sha256!==entrySha256)rejected();
}
function directory(path,{privateLeaf=false,noGit=false}={}){
 if(realpathSync(path)!==path)rejected();
 for(let current=path;;current=dirname(current)){
  const stat=lstatSync(current),stickyRootTemporary=stat.uid===0&&(stat.mode&0o1000)!==0;
  if(!stat.isDirectory()||stat.isSymbolicLink()||![0,process.getuid()].includes(stat.uid)||((stat.mode&0o022)!==0&&!stickyRootTemporary))rejected();
  if(current===path&&privateLeaf&&(stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700))rejected();
  if(noGit&&existsSync(join(current,'.git')))rejected();
  if(dirname(current)===current)break;
 }
 const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW),opened=fstatSync(fd),named=lstatSync(path);
 if(opened.ino!==named.ino||opened.dev!==named.dev){closeSync(fd);rejected();}
 return fd;
}
function pinned(path,digest,maxBytes,executable){
 const parent=directory(dirname(path));closeSync(parent);
 if(realpathSync(path)!==path)rejected();
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=fstatSync(fd),named=lstatSync(path);
  if(!before.isFile()||before.nlink!==1||![0,process.getuid()].includes(before.uid)||(before.mode&0o022)!==0||before.size<1||before.size>maxBytes||before.ino!==named.ino||before.dev!==named.dev||(executable&&(before.mode&0o111)===0))rejected();
  const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let offset=0;
  while(offset<before.size){const n=readSync(fd,buffer,0,Math.min(buffer.length,before.size-offset),offset);if(n===0)rejected();hash.update(buffer.subarray(0,n));offset+=n;}
  const after=fstatSync(fd);
  if(hash.digest('hex')!==digest||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)rejected();
  return {fd,path,stat:after};
 }catch(error){closeSync(fd);throw error;}
}
function assertPinned(file){
 const named=lstatSync(file.path),opened=fstatSync(file.fd),before=file.stat;
 if(named.isSymbolicLink()||[named,opened].some(s=>s.dev!==before.dev||s.ino!==before.ino||s.size!==before.size||s.mtimeMs!==before.mtimeMs||s.ctimeMs!==before.ctimeMs))rejected();
}
function writeAll(fd,bytes){let offset=0;while(offset<bytes.length){const count=writeSync(fd,bytes,offset,bytes.length-offset);if(count<=0)rejected('NATIVE_PROCESS_CUSTODY_FAILED');offset+=count;}}
function exclusiveFile(dir,name){
 const fd=openSync(join(dir,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{fchmodSync(fd,0o600);return fd;}catch(error){closeSync(fd);throw error;}
}
function publish(dir,dirFd,name,value){
 const bytes=Buffer.from(canonical(value));if(bytes.length>PROCESS_LIMITS.receiptBytes)rejected('NATIVE_PROCESS_CUSTODY_FAILED');
 const fd=exclusiveFile(dir,name);try{writeAll(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}fsyncSync(dirFd);
 return {name,sha256:sha(bytes),byteSize:bytes.length};
}
function processIdentity(pid){
 const stat=readFileSync('/proc/'+pid+'/stat','utf8'),end=stat.lastIndexOf(')'),fields=stat.slice(end+2).split(' ');
 const start=fields[19],boot=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
 if(!/^\d+$/.test(start)||!/^[a-f0-9-]{36}$/.test(boot))rejected('NATIVE_PROCESS_CUSTODY_FAILED');
 return {pid,startTicks:start,bootId:boot};
}
/** Pure policy only: synthetic events neither start processes nor establish custody. */
export function initialProcessLifecycle({timeoutMs,maxOutputBytes},now=0){
 if(!positive(timeoutMs,PROCESS_LIMITS.timeoutMs)||!positive(maxOutputBytes,PROCESS_LIMITS.outputBytes)||!Number.isFinite(now)||now<0)rejected();
 return {phase:'running',deadline:now+timeoutMs,limit:maxOutputBytes,observedBytes:0,retainedBytes:0,truncated:false,reason:'exit',status:null,closeObserved:false,exitCode:null,signal:null,custodyFailed:false,killAt:null,drainAt:null};
}
export function reduceProcessLifecycle(prior,event){
 const state={...prior},actions=[];let retainBytes=0;
 if(state.phase==='finished')return {state,actions,retainBytes};
 const terminate=reason=>{if(state.phase==='running'){state.phase='terminating';state.reason=reason;state.killAt=event.now+PROCESS_LIMITS.termGraceMs;actions.push('SIGTERM');}};
 if(!event||!Number.isFinite(event.now)||event.now<0)rejected();
 switch(event.type){
  case 'data':
   if(!Number.isSafeInteger(event.byteLength)||event.byteLength<0)rejected();
   retainBytes=Math.min(event.byteLength,state.limit-state.retainedBytes);
   state.observedBytes=Math.min(Number.MAX_SAFE_INTEGER,state.observedBytes+event.byteLength);state.retainedBytes+=retainBytes;
   if(retainBytes<event.byteLength){state.truncated=true;terminate('output-limit');}break;
  case 'tick':
   if(state.phase==='running'&&event.now>=state.deadline)terminate('timeout');
   else if(state.phase==='terminating'&&event.now>=state.killAt){state.phase='draining';state.drainAt=event.now+PROCESS_LIMITS.drainGraceMs;actions.push('SIGKILL');}
   else if(state.phase==='draining'&&event.now>=state.drainAt){state.phase='finished';state.status='unknown';actions.push('abandon');}break;
  case 'spawn-error':terminate('spawn-error');break;
  case 'custody-error':state.custodyFailed=true;state.reason='custody-failure';terminate('custody-failure');break;
  case 'close':
   if(!(event.exitCode===null||Number.isInteger(event.exitCode))||!(event.signal===null||/^SIG[A-Z0-9]+$/.test(event.signal)))rejected();
   state.closeObserved=true;state.exitCode=event.exitCode;state.signal=event.signal;state.phase='finished';state.status=state.custodyFailed?'unknown':'terminal';break;
  default:rejected();
 }
 return {state,actions,retainBytes};
}
/** Protected prefix metadata only; never a public observation or authority proof. */
export function projectProcessTranscripts(state,transcripts){
 return Object.fromEntries(Object.entries(transcripts).map(([stream,record])=>[stream,state.custodyFailed?{name:record.name,sha256:null,byteSize:null,complete:false}:{...record,complete:state.closeObserved&&!state.truncated}]));
}
/** Trusted-host-only adapter. No authority is created by this function or its hashes.
 * Pathname execution assumes non-hostile same-UID/root owners. It is not a secure
 * launcher against same-UID replacement, nor a descendant containment mechanism.
 */
export async function runOwnedProcess(input){
 let spec;
 try{validateInput(input);spec=structuredClone(input);}
 catch(error){throw Error(error?.message==='NATIVE_PROCESS_ENV_REJECTED'?error.message:'NATIVE_PROCESS_INPUT_REJECTED');}
 // Snapshot caller values once; never inherit process.env or extra descriptors.
 let dirFd,node,entry,cwdFd,stdoutFd,stderrFd,prepared;
 const names={prepared:spec.invocationId+'.prepared.json',spawned:spec.invocationId+'.spawned.json',final:spec.invocationId+'.final.json',stdout:spec.invocationId+'.stdout',stderr:spec.invocationId+'.stderr'};
 try{
  dirFd=directory(spec.receiptDirectory,{privateLeaf:true,noGit:true});
  cwdFd=directory(spec.cwd);node=pinned(spec.nodePath,spec.nodeSha256,PROCESS_LIMITS.nodeBytes,true);entry=pinned(spec.entryPath,spec.entrySha256,PROCESS_LIMITS.entryBytes,false);
  // Any existing attempt artifact blocks automatic duplicate execution.
  for(const name of Object.values(names))if(existsSync(join(spec.receiptDirectory,name)))rejected('NATIVE_PROCESS_ALREADY_PREPARED');
  prepared=publish(spec.receiptDirectory,dirFd,names.prepared,{version:1,status:'prepared',invocationId:spec.invocationId,subjects:spec.subjects,invocationSha256:sha(canonical({nodeSha256:spec.nodeSha256,entrySha256:spec.entrySha256,args:spec.args,cwd:spec.cwd,env:spec.env})),timeoutMs:spec.timeoutMs,maxOutputBytes:spec.maxOutputBytes,preparedAt:Date.now(),retryAllowed:false});
  stdoutFd=exclusiveFile(spec.receiptDirectory,names.stdout);stderrFd=exclusiveFile(spec.receiptDirectory,names.stderr);fsyncSync(dirFd);
  assertPinned(node);assertPinned(entry);
 }catch(error){
  for(const fd of [stdoutFd,stderrFd,node?.fd,entry?.fd,cwdFd,dirFd])if(fd!==undefined)try{closeSync(fd);}catch{}
  throw Error(error?.message==='NATIVE_PROCESS_ALREADY_PREPARED'?error.message:'NATIVE_PROCESS_INPUT_REJECTED');
 }
 const startedAt=Date.now();let state=initialProcessLifecycle(spec,performance.now()),child,spawned=null,timer,finishing=false;
 const chunks={stdout:[],stderr:[]},sizes={stdout:0,stderr:0},hashes={stdout:createHash('sha256'),stderr:createHash('sha256')};
 return await new Promise(resolveResult=>{
  const finish=()=>{
   if(finishing)return;finishing=true;clearInterval(timer);
   let transcripts={};
   for(const stream of ['stdout','stderr']){
    const fd=stream==='stdout'?stdoutFd:stderrFd;
    try{fsyncSync(fd);}catch{state={...state,status:'unknown',reason:'custody-failure',custodyFailed:true};}
    finally{try{closeSync(fd);}catch{state={...state,status:'unknown',reason:'custody-failure',custodyFailed:true};}}
    transcripts[stream]={name:names[stream],sha256:hashes[stream].digest('hex'),byteSize:sizes[stream]};
   }
   transcripts=projectProcessTranscripts(state,transcripts);
   let final=null;
   try{final=publish(spec.receiptDirectory,dirFd,names.final,{version:1,invocationId:spec.invocationId,subjects:spec.subjects,status:state.status,reason:state.reason,startedAt,endedAt:Date.now(),closeObserved:state.closeObserved,exitCode:state.exitCode,signal:state.signal,observedBytes:state.observedBytes,retainedBytes:state.retainedBytes,truncated:state.truncated,prepared,spawned,transcripts,retryAllowed:false,effectOutcome:'unknown',descendants:'unverified'});}
   catch{state={...state,status:'unknown',reason:'custody-failure',custodyFailed:true};}
   for(const fd of [node.fd,entry.fd,cwdFd,dirFd])try{closeSync(fd);}catch{}
   if(!state.closeObserved){child?.stdout?.destroy();child?.stderr?.destroy();child?.unref();}
   // Enumerable summary deliberately omits arbitrary original-stream/argv hashes.
   const result={version:1,invocationId:spec.invocationId,status:state.status,reason:state.reason,exitCode:state.exitCode,signal:state.signal,observedBytes:state.observedBytes,retainedBytes:state.retainedBytes,truncated:state.truncated,record:final?{name:final.name,custody:'protected'}:null,effectOutcome:'unknown'};
   Object.defineProperty(result,'readCapturedOutput',{enumerable:false,value:()=>({stdout:Buffer.concat(chunks.stdout,sizes.stdout),stderr:Buffer.concat(chunks.stderr,sizes.stderr),custody:{prepared,spawned,final,transcripts}})});
   resolveResult(Object.freeze(result));
  };
  const transition=event=>{
   if(finishing)return {retainBytes:0};
   const step=reduceProcessLifecycle(state,{...event,now:performance.now()});state=step.state;
   for(const action of step.actions)if(action!=='abandon')try{child?.kill(action);}catch{/* Never recover by PID or assert rollback. */}
   if(state.phase==='finished')finish();return step;
  };
  const capture=(stream,bytes)=>{
   if(finishing)return;
   const {retainBytes}=transition({type:'data',byteLength:bytes.length});
   if(retainBytes){
    const retained=Buffer.from(bytes.subarray(0,retainBytes));
    hashes[stream].update(retained);chunks[stream].push(retained);sizes[stream]+=retained.length;
    try{writeAll(stream==='stdout'?stdoutFd:stderrFd,retained);}
    catch{transition({type:'custody-error'});}
   }
  };
  try{
   child=spawn(spec.nodePath,[spec.entryPath,...spec.args],{cwd:spec.cwd,env:spec.env,shell:false,stdio:['ignore','pipe','pipe'],detached:false,windowsHide:true});
   child.on('error',()=>transition({type:'spawn-error'}));
   child.stdout.on('data',bytes=>capture('stdout',bytes));child.stderr.on('data',bytes=>capture('stderr',bytes));
   child.on('close',(exitCode,signal)=>transition({type:'close',exitCode,signal}));
   child.on('spawn',()=>{
    try{spawned=publish(spec.receiptDirectory,dirFd,names.spawned,{version:1,status:'spawned',invocationId:spec.invocationId,subjects:spec.subjects,prepared,identity:processIdentity(child.pid),spawnedAt:Date.now(),retryAllowed:false});}
    catch{transition({type:'custody-error'});}
   });
  }catch{transition({type:'spawn-error'});}
  timer=setInterval(()=>transition({type:'tick'}),10);
 });
}
