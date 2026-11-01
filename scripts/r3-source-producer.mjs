#!/usr/bin/env node
/** Fixed J1-only actual local source runner. Not a release/production verifier. */
import {mkdtempSync,mkdirSync,openSync,writeSync,fsyncSync,closeSync,constants,realpathSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {canonical,sha,measureJ1Context,recheckJ1Context} from './lib/r3-source-producer-context.mjs';
import {validateJ1SourceContext,sealJ1Execution} from './lib/r3-source-producer-io.mjs';
import {writeJ1Failure} from './lib/r3-source-failure.mjs';
import {J1_MODULE} from './lib/r3-source-producer-policy.mjs';
let statePath,phase='preflight',closeFacts={exit_code:null,signal:null,closed:false,error_code:null,elapsed_ms:0,discarded_log_bytes:0};
const fail=()=>{throw Error('R3_SOURCE_CONTROLLER_FAILED');};
async function childRun(root,environment){return await new Promise((resolve,reject)=>{
 const start=performance.now(),child=spawn(process.execPath,[root+'/node_modules/vitest/vitest.mjs','run','--config',root+'/vitest.r3-source-producer.config.ts',J1_MODULE],{cwd:root,env:environment,stdio:['ignore','pipe','pipe'],detached:true,shell:false});
 let errorCode=null,outputBytes=0,closed=false,killTimer;const stop=code=>{errorCode??=code;try{process.kill(-child.pid,'SIGTERM');}catch{}killTimer??=setTimeout(()=>{if(!closed)try{process.kill(-child.pid,'SIGKILL');}catch{}},2000);};
 // Raw logs may contain fixture diagnostics. They are counted/discarded, never scraped or exported.
 const count=chunk=>{outputBytes+=chunk.length;if(outputBytes>2097152)stop('OUTPUT_BOUND');};child.stdout.on('data',count);child.stderr.on('data',count);
 const interrupted=()=>stop('INTERRUPTED');process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
 child.stdout.on('error',()=>stop('OUTPUT_ERROR'));child.stderr.on('error',()=>stop('OUTPUT_ERROR'));
 child.on('error',()=>{errorCode='SPAWN_ERROR';});const timer=setTimeout(()=>stop('TIMEOUT'),1195000);
 child.on('close',(code,signal)=>{closed=true;process.off('SIGINT',interrupted);process.off('SIGTERM',interrupted);clearTimeout(timer);clearTimeout(killTimer);const elapsed_ms=Math.ceil(performance.now()-start);closeFacts={exit_code:code,signal,closed:true,error_code:errorCode,elapsed_ms,discarded_log_bytes:outputBytes};if(code!==0||signal!==null||errorCode!==null||elapsed_ms>1200000){reject(Error('R3_SOURCE_CHILD_FAILED'));return;}resolve({exit_code:code,signal,closed:true,error_code:null,elapsed_ms});});
 });}
try{
 if(process.argv.length!==2||process.execArgv.length||process.platform!=='linux')fail();
 const allowed=new Set(['PATH','HOME','XDG_CONFIG_HOME','TMPDIR','TZ','LANG','CI','NODE_ENV']);if(Object.keys(process.env).some(k=>!allowed.has(k)))fail();
 const root=realpathSync(fileURLToPath(new URL('../',import.meta.url))),privateRoot=mkdtempSync('/tmp/agenthub-r3-source-');
 for(const part of ['home','config','tmp','outputs'])mkdirSync(privateRoot+'/'+part,{mode:0o700});
 const environment={PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:privateRoot+'/home',XDG_CONFIG_HOME:privateRoot+'/config',TMPDIR:privateRoot+'/tmp',TZ:'UTC',LANG:'C.UTF-8',CI:'true',NODE_ENV:'test',R3_SOURCE_RUN_STATE:privateRoot+'/input.json'};
 statePath=environment.R3_SOURCE_RUN_STATE;
 const context=await measureJ1Context(root,environment),contextBytes=new Uint8Array(Buffer.from(canonical(context)));validateJ1SourceContext(contextBytes);
 const binding={run_id:randomBytes(16).toString('hex'),nonce_sha256:sha(randomBytes(32)),source_context_sha256:sha(contextBytes)};
 const input=Buffer.from(canonical({format_version:1,stage:'j1-source-run-input',repository_root:root,output_root:privateRoot+'/outputs',...binding,context}));if(input.length>65536)fail();
 const fd=openSync(environment.R3_SOURCE_RUN_STATE,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{let offset=0;while(offset<input.length){const n=writeSync(fd,input,offset,input.length-offset);if(n<=0)fail();offset+=n;}fsyncSync(fd);}finally{closeSync(fd);}
 phase='child';const completion=await childRun(root,environment);phase='postflight';recheckJ1Context(root,context);
 phase='seal';const sealed=sealJ1Execution(privateRoot+'/outputs',binding,completion,contextBytes);
 process.stdout.write(JSON.stringify({stage:'j1-local-source-execution',acceptance_eligible:false,provenance_authenticated:false,output_root:privateRoot+'/outputs',execution:sealed.reference})+'\n');
}catch{try{writeJ1Failure(statePath,'controller',{phase,...closeFacts});}catch{}process.stderr.write('R3_SOURCE_CONTROLLER_FAILED\n');process.exitCode=1;}
