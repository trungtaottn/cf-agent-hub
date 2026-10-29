import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readNativeConfig} from './lib/native-r2-admission.mjs';
/** Dedicated protected config consumer, never a Vitest configuration loader.
 * No live authority adapter ships by default. This entry cannot grant isolation. */
export function nativeRunnerMode(args){
 if(!Array.isArray(args)||args.some(x=>typeof x!=='string'))throw Error('NATIVE_ARGUMENT_REJECTED');
 if(args.length===1&&args[0]==='--local-sandbox')return 'local-sandbox';
 if(args.length===2&&args[0]==='--config'&&isAbsolute(args[1])&&resolve(args[1])===args[1])return 'protected-conformance';
 throw Error('NATIVE_ARGUMENT_REJECTED');
}
export async function nativeRunnerMain(args){
 let mode;
 try{mode=nativeRunnerMode(args);}catch{return {exitCode:2,stdout:'',stderr:'Native conformance input rejected; no request sent.\n'};}
 if(mode==='local-sandbox'){
  try{
   const {runLocalNativeSandbox}=await import('./lib/native-r2-local-host.mjs');
   const report=await runLocalNativeSandbox();
   return {exitCode:0,stdout:JSON.stringify(report)+'\n',stderr:''};
  }catch{return {exitCode:5,stdout:'',stderr:'Local sandbox checks failed or cleanup is uncertain; native conformance was not evaluated.\n'};}
 }
 try{readNativeConfig(args[1]);}
 catch{return {exitCode:2,stdout:'',stderr:'Native conformance input rejected; no request sent.\n'};}
 return {exitCode:3,stdout:'',stderr:'Native conformance blocked: independently authorized target, observer and control integration is unavailable; no request sent.\n'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await nativeRunnerMain(process.argv.slice(2));
 process.stdout.on('error',()=>{process.exitCode=5;});process.stderr.on('error',()=>{process.exitCode=5;});
 process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.exitCode;
}
