import {testFlock} from './flock-profile';
import * as fs from 'node:fs';
import {dirname,join} from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {buildSync} from 'esbuild';
import {withStateLock} from '../../packages/observation-adapter/src/state-file';
import {Deadline} from '../../packages/client/src/transport';
import {binding} from './helpers';
export interface Runner {child:ChildProcess;messages:Array<{kind:string;stage?:string;childPid?:number}>;stdout:string;stderr:string;wait(kind:string):Promise<void>;exit:Promise<void>;}
export async function processHarness(){
 const root=fs.mkdtempSync(join(dirname(process.cwd()),'b2-process-test-')),directory=join(root,'state'),script=join(root,'fixture.mjs'),runners:Runner[]=[];
 const build=buildSync({entryPoints:[join(process.cwd(),'test/observation-adapter/fixtures/process-entry.ts')],bundle:true,write:false,platform:'node',format:'esm',target:'node24'});fs.writeFileSync(script,build.outputFiles[0].contents,{mode:0o600});
 const opts={directory,worktreeRoot:process.cwd(),flock:testFlock};
 const deadline=new Deadline(2000);try{await withStateLock({...opts,purpose:'initialize'},deadline,async s=>s.initialize(binding));}finally{deadline.dispose();}
 function start(mode='normal',stage='',sharedFd?:number,dir=directory):Runner{
  const child=spawn(process.execPath,[script,mode,dir,stage,JSON.stringify(testFlock)],{stdio:['ignore','pipe','pipe','ipc',sharedFd??'ignore']});
  const r:Runner={child,messages:[],stdout:'',stderr:'',exit:new Promise(resolve=>child.once('exit',()=>resolve())),wait:kind=>new Promise<void>((resolve,reject)=>{const check=()=>{if(r.messages.some(m=>m.kind===kind)){clearTimeout(timer);child.off('message',check);resolve();}};const timer=setTimeout(()=>{child.off('message',check);reject(new Error('FIXTURE_TIMEOUT_'+kind));},5000);child.on('message',check);check();})};
  child.on('message',v=>{r.messages.push(v as {kind:string;stage?:string;childPid?:number});});child.stdout!.on('data',v=>r.stdout+=String(v));child.stderr!.on('data',v=>r.stderr+=String(v));runners.push(r);return r;
 }
 return {root,directory,opts,start,async close(){for(const r of runners)if(r.child.exitCode===null&&r.child.signalCode===null)r.child.kill('SIGKILL');await Promise.all(runners.map(r=>r.exit));fs.rmSync(root,{recursive:true,force:true});}};
}
