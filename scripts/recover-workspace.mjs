#!/usr/bin/env node
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {COMMANDS} from './lib/recovery-config.mjs';
import {runRecovery} from './lib/recovery-client.mjs';
import {RecoveryTransportError} from './lib/recovery-transport.mjs';
function safeFailure(error,command){
 const message=error instanceof Error?error.message:'';
 const code=/^(RECOVERY|INVALID|NONCANONICAL)_[A-Z0-9_]{1,80}$/.test(message)?message:'RECOVERY_INPUT_REJECTED';
 const failure={format_version:1,operation:COMMANDS.includes(command)?command:'unknown',outcome:'error',error:{code}};
 if(error instanceof RecoveryTransportError){failure.error.status=error.status;failure.error.request_id=error.requestId;if(error.serverCode)failure.error.server_code=error.serverCode;}
 return failure;
}
export async function main(args=process.argv.slice(2)){
 if(args.length===1&&args[0]==='--help'){
  process.stdout.write('Usage: node scripts/recover-workspace.mjs <capture|restore|verify|probe|resolve-delivery|retire|resume|status> --input <protected-config.json>\n');
  return 0;
 }
 const command=args[0];
 try{
  if(args.length!==3||!COMMANDS.includes(command)||args[1]!=='--input'||!args[2])throw Error('RECOVERY_INPUT_REJECTED');
  const result=await runRecovery(command,args[2]);process.stdout.write(JSON.stringify(result)+'\n');return result.outcome==='failed'?1:0;
 }catch(error){process.stdout.write(JSON.stringify(safeFailure(error,command))+'\n');return 1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)process.exitCode=await main();
