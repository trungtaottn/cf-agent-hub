import * as fs from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {spawn,type ChildProcess,type SpawnOptions} from 'node:child_process';
import {createHash} from 'node:crypto';
import type {Deadline} from '../../client/src/transport';
import {emptyState,validateState,type State,type FrozenBinding} from './contract';
import {parseExactJson} from '../../../src/approvals/exact-json';
/** Trusted synchronous filesystem boundary permits fault tests without changing
 * path/security rules. No injected async operations are permitted. */
export interface StateFs {
 lstatSync(path:fs.PathLike):fs.Stats;fstatSync(fd:number):fs.Stats;statfsSync(path:fs.PathLike):fs.StatsFs;realpathSync(path:fs.PathLike):string;
 opendirSync(path:fs.PathLike):fs.Dir;
 mkdirSync(path:fs.PathLike,options:{mode:number}):unknown;openSync(path:fs.PathLike,flags:number,mode?:number):number;closeSync(fd:number):void;
 readSync(fd:number,buffer:Uint8Array,offset:number,length:number,position:number|null):number;writeSync(fd:number,buffer:Uint8Array,offset:number,length:number,position:number|null):number;
 fsyncSync(fd:number):void;renameSync(oldPath:fs.PathLike,newPath:fs.PathLike):void;unlinkSync(path:fs.PathLike):void;
}
export interface StateDirectoryOptions {directory:string;worktreeRoot:string;flock:{path:string;sha256:string;version:string};purpose?:'initialize'|'invoke';fs?:StateFs;}
/** Trusted code injection only; never populated from launch JSON/env/hook input. */
export interface StateDependencies {launchLock?:(executable:string,args:string[],options:SpawnOptions)=>ChildProcess;}
export interface LockedStateStore {read():State;persist(state:State):void;initialize(binding:FrozenBinding):void;}
function fail():never{throw new Error('OBSERVATION_STORAGE_UNAVAILABLE');}
const same=(a:fs.Stats,b:fs.Stats)=>a.dev===b.dev&&a.ino===b.ino;
const absent=(e:unknown)=>typeof e==='object'&&e!==null&&'code'in e&&e.code==='ENOENT';
const inside=(p:string,root:string)=>p===root||p.startsWith(root+sep);
const maxState=131072;
export async function withStateLock<T>(options:StateDirectoryOptions,deadline:Deadline,run:(store:LockedStateStore)=>Promise<T>,dependencies:StateDependencies={}):Promise<T>{
 const io=options.fs??fs,uid=process.getuid?.();let lock:number|undefined,active=true,validated=false,root:fs.Stats|undefined,lockStat:fs.Stats|undefined;
 const check=()=>{if(!active)fail();deadline.check();};
 const sync=<V>(fn:()=>V):V=>{check();const v=fn();if(v!==null&&(typeof v==='object'||typeof v==='function')&&'then'in v)fail();check();return v;};
 const stat=(p:string)=>{try{return sync(()=>io.lstatSync(p));}catch(e){if(absent(e))return null;throw e;}};
 const file=(s:fs.Stats,max=maxState)=>{if(!s.isFile()||s.isSymbolicLink()||s.uid!==uid||(s.mode&0o777)!==0o600||s.nlink!==1||s.size>max||s.size<0)fail();};
 let directory='';
 const ancestors=(p:string)=>{
  for(let cursor=p;;cursor=dirname(cursor)){
   const s=stat(cursor);if(!s||!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid&&s.uid!==0||(s.mode&0o022)!==0)fail();
   const git=stat(join(cursor,'.git'));if(git&&(git.isFile()||stat(join(cursor,'.git','HEAD'))))fail();
   if(cursor===dirname(cursor))break;
  }
 };
 const current=()=>{
  check();ancestors(directory);const s=stat(directory);if(!s||!root||!same(s,root)||(s.mode&0o777)!==0o700||s.uid!==uid)fail();
  if(sync(()=>io.realpathSync(directory))!==directory)fail();
  let entries:fs.Dir|undefined;try{sync(()=>entries=io.opendirSync(directory));for(let i=0;i<4;i++){const entry=sync(()=>entries!.readSync());if(entry===null)break;if(i===3||!['lock','state.json','state.tmp'].includes(entry.name))fail();}}finally{if(entries)entries.closeSync();}
  if(lock!==undefined){const named=stat(join(directory,'lock'));const opened=sync(()=>io.fstatSync(lock!));if(!named||!lockStat||!same(named,lockStat)||!same(opened,lockStat))fail();file(named,0);file(opened,0);}
 };
 const close=(fd:number)=>{ // Closing cannot be skipped because the budget expired.
  io.closeSync(fd);
 };
 const cleanupTemp=()=>{const p=join(directory,'state.tmp'),s=stat(p);if(s){file(s);sync(()=>io.unlinkSync(p));}};
 const persist=(state:State)=>{
  current();if(!validated)fail();const copy=validateState(state),bytes=Buffer.from(JSON.stringify(copy));check();if(bytes.length>maxState)fail();
  cleanupTemp();const tmp=join(directory,'state.tmp');let fd:number|undefined;
  try{
   sync(()=>fd=io.openSync(tmp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW|fs.constants.O_RDWR,0o600));file(sync(()=>io.fstatSync(fd!)));
   let offset=0,attempts=0;while(offset<bytes.length){if(++attempts>1024)fail();const n=sync(()=>io.writeSync(fd!,bytes,offset,bytes.length-offset,null));if(!Number.isSafeInteger(n)||n<1||n>bytes.length-offset)fail();offset+=n;}
   file(sync(()=>io.fstatSync(fd!)));sync(()=>io.fsyncSync(fd!));close(fd!);fd=undefined;check();current();
   sync(()=>io.renameSync(tmp,join(directory,'state.json')));
   let dirFd:number|undefined;try{sync(()=>dirFd=io.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW));sync(()=>io.fsyncSync(dirFd!));}finally{if(dirFd!==undefined)close(dirFd);}
   check();
  }finally{if(fd!==undefined)close(fd);}
 };
 const store:LockedStateStore={
  read:()=>{
   current();const p=join(directory,'state.json'),named=stat(p);if(!named)fail();file(named);let fd:number|undefined;
   try{
    sync(()=>fd=io.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW));const opened=sync(()=>io.fstatSync(fd!));file(opened);if(!same(named,opened))fail();
    const bytes=new Uint8Array(opened.size+1);let offset=0,attempts=0;
    while(offset<bytes.length){if(++attempts>1024)fail();const n=sync(()=>io.readSync(fd!,bytes,offset,bytes.length-offset,null));if(!Number.isSafeInteger(n)||n<0||n>bytes.length-offset)fail();if(n===0)break;offset+=n;}
    const final=sync(()=>io.fstatSync(fd!));file(final);if(offset!==opened.size||final.size!==opened.size||!same(final,opened))fail();
    const value=validateState(parseExactJson(bytes.subarray(0,offset),{maxBytes:maxState,maxDepth:16,maxNodes:8192}));check();validated=true;cleanupTemp();return value;
   }finally{if(fd!==undefined)close(fd);}
  },
  persist,
  initialize:binding=>{
   current();if(options.purpose!=='initialize'||stat(join(directory,'state.json'))||stat(join(directory,'state.tmp')))fail();validated=true;persist(emptyState(binding));
  }
 };
 try{
  check();if(process.platform!=='linux'||uid===undefined||!options||!['initialize','invoke',undefined].includes(options.purpose)||typeof options.directory!=='string'||typeof options.worktreeRoot!=='string')fail();
  directory=resolve(options.directory);const worktree=resolve(options.worktreeRoot);
  if(directory!==options.directory||worktree!==options.worktreeRoot||directory==='/'||inside(directory,worktree)||inside(directory,'/tmp')||inside(directory,'/var/tmp')||inside(directory,'/dev/shm'))fail();
  if(!stat(directory)){
   if(options.purpose!=='initialize')fail();ancestors(dirname(directory));sync(()=>io.mkdirSync(directory,{mode:0o700}));let parentFd:number|undefined;try{sync(()=>parentFd=io.openSync(dirname(directory),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW));sync(()=>io.fsyncSync(parentFd!));}finally{if(parentFd!==undefined)close(parentFd);}
  }
  ancestors(directory);root=stat(directory)??undefined;if(!root||root.uid!==uid||(root.mode&0o777)!==0o700||sync(()=>io.realpathSync(directory))!==directory)fail();
  if(![0xef53,0x58465342,0x794c7630].includes(sync(()=>io.statfsSync(directory)).type))fail();
  // A verified digest pins the versioned util-linux implementation. No PATH lookup
  // or shell. Operator installation/owner is trusted; identity/hash checks do
  // not exclude a malicious installation owner's hash-to-exec replacement.
  const pin=options.flock;if(!pin||!pin.path.startsWith('/')||resolve(pin.path)!==pin.path||!/^\d+\.\d+(?:\.\d+)?$/.test(pin.version)||!/^[a-f0-9]{64}$/.test(pin.sha256))fail();
  for(let cursor=dirname(pin.path);;cursor=dirname(cursor)){const parent=fs.lstatSync(cursor);check();if(!parent.isDirectory()||parent.isSymbolicLink()||(parent.mode&0o022)!==0)fail();if(cursor===dirname(cursor))break;}
  const executable=fs.lstatSync(pin.path);check();if(!executable.isFile()||executable.isSymbolicLink()||(executable.mode&0o022)!==0||(executable.mode&0o111)===0||executable.size>1048576)fail();
  if(fs.realpathSync(pin.path)!==pin.path)fail();check();
  let executableFd:number|undefined;let executableBytes:Uint8Array;
  try{executableFd=fs.openSync(pin.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);check();const opened=fs.fstatSync(executableFd);check();if(!same(opened,executable)||opened.size!==executable.size)fail();const bytes=new Uint8Array(executable.size+1);let offset=0,attempts=0;while(offset<bytes.length){if(++attempts>1024)fail();const n=fs.readSync(executableFd,bytes,offset,bytes.length-offset,null);check();if(n===0)break;offset+=n;}if(offset!==executable.size)fail();const after=fs.fstatSync(executableFd);check();if(!same(after,executable)||after.size!==executable.size||after.mtimeMs!==executable.mtimeMs)fail();executableBytes=bytes.subarray(0,offset);}finally{if(executableFd!==undefined)fs.closeSync(executableFd);}
  if(createHash('sha256').update(executableBytes).digest('hex')!==pin.sha256)fail();check();
  const existingLock=stat(join(directory,'lock'));if(existingLock)file(existingLock,0);
  sync(()=>lock=io.openSync(join(directory,'lock'),fs.constants.O_RDWR|fs.constants.O_NOFOLLOW|(options.purpose==='initialize'?fs.constants.O_CREAT:0),0o600));
  lockStat=sync(()=>io.fstatSync(lock!));file(lockStat,0);current();
  const executableNow=fs.lstatSync(pin.path);check();if(!same(executableNow,executable)||executableNow.size!==executable.size||executableNow.mtimeMs!==executable.mtimeMs)fail();
  const child=(dependencies.launchLock??spawn)(pin.path,['--nonblock','3'],{stdio:['ignore','ignore','ignore',lock!],shell:false});
  const finished=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
  try{if(await deadline.wait(finished)!==0)fail();}catch(e){child.kill('SIGKILL');try{await finished;}catch{}throw e;}
  current();return await deadline.wait(Promise.resolve(run(store)));
 }catch{return fail();}finally{active=false;if(lock!==undefined){try{close(lock);}catch{fail();}}}
}
