import * as fs from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {withStateLock,type StateFs} from '../../../packages/observation-adapter/src/state-file';
import {Deadline} from '../../../packages/client/src/transport';
// Isolated synthetic process fixture. IPC is test coordination, never hook output.
const [mode,directory,stage,pin]=process.argv.slice(2);
const message=(kind:string)=>new Promise<void>((resolve,reject)=>{process.send?.({kind},undefined,undefined,(error:Error|null)=>error?reject(error):resolve());});
const wait=(kind:string)=>new Promise<void>(resolve=>{const fn=(v:unknown)=>{if(v&&typeof v==='object'&&'kind'in v&&v.kind===kind){process.off('message',fn);resolve();}};process.on('message',fn);});
const checkpoint=(name:string)=>{if(stage===name){process.send?.({kind:'checkpoint',stage:name});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000);}};
const io:StateFs={...fs,openSync:(path,flags,mode)=>{if(String(path).endsWith('lock'))checkpoint('before-lock-open');const fd=fs.openSync(path,flags,mode);if(String(path).endsWith('lock'))checkpoint('after-lock-open');return fd;},fsyncSync:fd=>{const directory=fs.fstatSync(fd).isDirectory();if(!directory&&stage==='slow-filesync'){process.send?.({kind:'blocking-filesync'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}checkpoint(directory?'before-dir-fsync':'before-temp-fsync');fs.fsyncSync(fd);checkpoint(directory?'after-dir-fsync':'after-temp-fsync');},renameSync:(a,b)=>{checkpoint('before-rename');fs.renameSync(a,b);checkpoint('after-rename');}};
// Injected acquisition stall only: preholder's independent FD is NOT inherited
// by the tested child. Production nonblocking argv is asserted before override.
let preholder:number|undefined;const acquisitionChildren:ReturnType<typeof spawn>[]=[];
if(stage==='acquisition-child'){
 preholder=fs.openSync(directory+'/lock',fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);
 const locked=spawnSync(JSON.parse(pin).path,['--nonblock','3'],{stdio:['ignore','ignore','ignore',preholder],timeout:1000});if(locked.status!==0)throw Error('PREHOLDER_UNAVAILABLE');
}
const go=wait('go');await message('ready');await go;
try{
 if(mode==='shared-negative'){
  const child=spawn('/usr/bin/flock',['--nonblock','3'],{stdio:['ignore','ignore','ignore',4]});const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});if(code!==0)throw new Error('NO_LOCK');const release=wait('release');await message('entered');await release;
 }else{
  const deadline=new Deadline(stage==='slow-filesync'?100:2000);try{await withStateLock({directory,worktreeRoot:process.cwd(),flock:JSON.parse(pin),fs:io},deadline,async store=>{const state=store.read(),release=wait('release');await message('entered');if(mode==='crash'){state.reportedLocalLoss=true;store.persist(state);}else await release;},{launchLock:(executable,args,options)=>{if(stage==='acquisition-child'&&(JSON.stringify(args)!==JSON.stringify(['--nonblock','3'])||executable!==JSON.parse(pin).path||Array.isArray(options.stdio)&&options.stdio.includes(preholder as never)))throw Error('PRODUCTION_ARGV_OR_FD_CHANGED');
 const child=spawn(executable,stage==='acquisition-child'?['--exclusive','3']:args,options);
 if(stage==='acquisition-child'){
 acquisitionChildren.push(child);child.kill('SIGSTOP');const until=performance.now()+1000;let stopped=false;
 while(performance.now()<until){try{if(/^State:\s+T/m.test(fs.readFileSync('/proc/'+child.pid+'/status','utf8'))){stopped=true;break;}}catch{}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1);}
 if(!stopped){child.kill('SIGKILL');throw Error('ACQUISITION_STALL_NOT_CONFIRMED');}
 fs.closeSync(preholder!);preholder=undefined;process.send?.({kind:'acquisition-child',childPid:child.pid});
 }return child;}});}finally{deadline.dispose();}
 }
 await message('done');
}catch{await message('unavailable');}finally{if(preholder!==undefined)fs.closeSync(preholder);for(const child of acquisitionChildren){if(child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await exited;}}}
process.disconnect();
