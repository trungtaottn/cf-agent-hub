import {runCli} from './main';
import type {Writable} from 'node:stream';
function write(stream:Writable,text:string):Promise<void>{return new Promise((resolve,reject)=>{if(!text){resolve();return;}const onError=(error:Error)=>{stream.removeListener('error',onError);reject(error);};stream.once('error',onError);stream.write(text,error=>{stream.removeListener('error',onError);if(error)reject(error);else resolve();});});}
// Keep listeners installed for asynchronous EPIPE after a write callback. Journal
// settlement precedes presentation; a broken pipe never triggers a second send.
let failed=false;process.stdout.on('error',()=>{failed=true;process.exitCode=5;});process.stderr.on('error',()=>{failed=true;process.exitCode=5;});
try{
 const result=await runCli(process.argv.slice(2),{env:process.env,fetch:globalThis.fetch,stdinIsTTY:process.stdin.isTTY,stderrIsTTY:process.stderr.isTTY,beforeInteractiveMutation:async context=>{await write(process.stderr,'Target: '+JSON.stringify(context)+'\n');if(failed)throw Error();}});
 try{await write(process.stdout,result.stdout);await write(process.stderr,result.stderr);process.exitCode=failed?5:result.exitCode;}catch{process.exitCode=5;}
}catch{process.exitCode=5;}
