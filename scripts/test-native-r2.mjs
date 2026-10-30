import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readNativeRunnerConfig} from './lib/native-complete-config-reader.mjs';
import {completeRunnerSummary} from './lib/native-complete-runner-result.mjs';
/** Dedicated protected config consumer, never a Vitest configuration loader.
 * Only fixed installed source adapters may execute; this entry cannot grant isolation. */
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
 let config;
 try{config=readNativeRunnerConfig(args[1]);}
 catch{return {exitCode:2,stdout:'',stderr:'Native conformance input rejected; no request sent.\n'};}
 if(config.version===2){
  let host;
  try{
   if(config.profile!=='native-r2-required-prepared-v1')throw Error('UNSUPPORTED_PROFILE');
   const {loadFixedCompleteHost}=await import('./lib/native-host-v2-custody.mjs');host=await loadFixedCompleteHost(config);
  }catch{return {exitCode:3,stdout:'',stderr:'Complete native execution blocked by fixed profile, installed authority or custody admission; no request sent.\n'};}
  try{
   const result=await host.execute(),summary=completeRunnerSummary(result);
   if(summary.status!=='observed'||summary.cleanup!=='closed'||!summary.reportReady)return {exitCode:5,stdout:JSON.stringify(summary)+'\n',stderr:'Complete native execution incomplete; no retry or acceptance inferred.\n'};
   const {publishCompleteOutput}=await import('./lib/native-complete-output.mjs');
   const publication=publishCompleteOutput({config,runId:summary.runId,result});
   const success=publication.status==='published'&&publication.cleanup==='closed'&&publication.filesWritten===493;
   const output={...summary,durability:success?'published':'incomplete',output:{status:publication.status,phase:publication.phase,relativeDirectory:publication.relativeDirectory??null,partialRetained:publication.partialRetained===true,filesWritten:publication.filesWritten??0,cleanup:publication.cleanup,retryAllowed:false}};
   return {exitCode:success?0:5,stdout:JSON.stringify(output)+'\n',stderr:success?'':'Complete native output publication incomplete; retain partial files and do not retry.\n'};
  }catch{return {exitCode:5,stdout:'',stderr:'Complete native execution or output failed; cleanup is unknown, no retry or acceptance inferred.\n'};}
 }
 let stdout='';
 try{const {diagnoseNativeReadiness}=await import('./lib/native-r2-readiness.mjs');stdout=JSON.stringify(diagnoseNativeReadiness(config))+'\n';}catch{/* Source/config mismatch is unavailable, never guessed support. */}
 return {exitCode:3,stdout,stderr:'Native conformance blocked: independently authorized target, observer and control integration is unavailable; no request sent.\n'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await nativeRunnerMain(process.argv.slice(2));
 process.stdout.on('error',()=>{process.exitCode=5;});process.stderr.on('error',()=>{process.exitCode=5;});
 process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.exitCode;
}
