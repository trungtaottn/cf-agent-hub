import {parseConfig} from './config';
import {initializeMcpJournal,openMcpHost} from './host';
import {startStdio,type StdioSession} from './server';
// Fixed diagnostics only; asynchronous pipe failures never trigger a second send.
process.stderr.on('error',()=>{});
let session:StdioSession|undefined,stopping=false;
const stop=()=>{stopping=true;void session?.close().catch(()=>{process.exitCode=1;});};
process.stdout.on('error',stop);process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{
 const config=parseConfig(process.argv.slice(2));
 if(config.initialize){initializeMcpJournal(config.stateDirectory);process.stderr.write('MCP local journal initialized.\n');}
 else {const host=openMcpHost(config);try{session=await startStdio(host);if(stopping)await session.close();await session.finished;}catch{try{host.close();}catch{}throw Error();}}
}catch{process.exitCode=1;process.stderr.write('MCP startup or local operation unavailable.\n');}
