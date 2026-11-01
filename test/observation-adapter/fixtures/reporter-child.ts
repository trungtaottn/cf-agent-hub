import * as fs from 'node:fs';
import type {StateFs} from '../../../packages/observation-adapter/src/state-file';
import {Readable} from 'node:stream';
import {runHook} from '../../../packages/observation-adapter/src/main';
import {Deadline} from '../../../packages/client/src/transport';
import type {OwnerTransport,OwnerOutcome,OwnerStatusOutcome} from '../../../packages/observation-adapter/src/contract';
import {binding,record} from '../helpers';
const [directory,port,timeout='2000',profile='claude-posttooluse-path-docs-20261101-v1',stage='',pin]=process.argv.slice(2);
const faultAbort=new AbortController();let abortTimer:ReturnType<typeof setTimeout>|undefined;
// Test-only fault clock starts after the server confirms an actually held request.
process.on('message',(value:any)=>{if(stage==='abort-after-held'&&value?.kind==='held'&&!abortTimer)abortTimer=setTimeout(()=>faultAbort.abort(),80);});
const deadline=new Deadline(Number(timeout),faultAbort.signal);let requests=0,writingPhase='';
const checkpoint=()=>{process.send?.({kind:'checkpoint'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000);};
const io:StateFs={...fs,writeSync:(fd,bytes,offset,length,position)=>{if(offset===0)writingPhase=JSON.parse(Buffer.from(bytes).toString('utf8')).phase;return fs.writeSync(fd,bytes,offset,length,position);},fsyncSync:fd=>{const directory=fs.fstatSync(fd).isDirectory();if(writingPhase==='awaiting-owner-status'&&!directory&&stage==='before-awaiting-fsync')checkpoint();fs.fsyncSync(fd);if(writingPhase==='awaiting-owner-status'&&directory&&stage==='after-awaiting-dirsync')checkpoint();}};
// Loopback test-only transport. Production HTTPS/protected-provider policy is not
// weakened; this fixture is deliberately not evidence of server authorization.
const send=async(path:string,body?:string)=>{if(++requests>1)throw Error('MORE_THAN_ONE_HTTP');const response=await fetch('http://127.0.0.1:'+port+path,{method:body?'POST':'GET',body,signal:deadline.signal});if(!response.ok)return {kind:'blocked' as const};return {kind:'data' as const,data:await response.json()};};
const transport:OwnerTransport={dispatch:async pending=>{const r=await send(pending.path,pending.canonicalBody);if(r.kind==='blocked')return r;return {kind:pending.intent.kind==='establish'?'established':pending.intent.kind==='append'?'appended':'replaced',data:r.data} as OwnerOutcome;},status:async(b,sid)=>{const r=await send('/v2/workspaces/'+b.workspaceId+'/tasks/'+encodeURIComponent(b.taskId)+'/observation-sessions/'+sid+'/owner-status');return r.kind==='blocked'?r:{kind:'status',data:r.data} as OwnerStatusOutcome;}};
try{await runHook({binding,root:'/private/checkout',profile,observedAt:record.observed_at,state:{directory,worktreeRoot:process.cwd(),fs:io,flock:JSON.parse(pin)},deadline,currentBinding:()=>binding,transportFactory:()=>transport},Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>);process.send?.({kind:'done',requests,faultAborted:faultAbort.signal.aborted});}finally{if(abortTimer)clearTimeout(abortTimer);deadline.dispose();process.disconnect?.();}
