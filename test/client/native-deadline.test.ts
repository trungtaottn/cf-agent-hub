import {it,expect} from 'vitest';
import {buildSync} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
it('separates zero-progress rejection from deadline precedence in a guarded subprocess',()=>{
 // Task-owned synthetic clock only; the parent watchdog remains real and unchanged.
 const directory=mkdtempSync(resolve('.native-deadline-'));
 try{
  const file=join(directory,'probe.mjs');buildSync({stdin:{resolveDir:process.cwd(),contents:`
   import {boundedStream} from './packages/client/src/streams';
   import {Deadline,HttpTransport} from './packages/client/src/transport';
   const counts={streamPulls:0,streamCancelled:0,jsonPulls:0,jsonCancelled:0,expiredReads:0,expiredCancelled:0};
   const empty=kind=>new ReadableStream({pull(c){counts[kind+'Pulls']++;c.enqueue(new Uint8Array());},cancel(){counts[kind+'Cancelled']++;}},{highWaterMark:0});
   // Response/fetch setup is not part of a controlled consumption interval.
   const source=empty('stream'),response=new Response(empty('json'),{headers:{'content-type':'application/json'}}),transport=new HttpTransport(fetch);
   const expiredHeaders=new Headers({'content-type':'application/json'});
   let clock=0,nextTimer=0,timerCallbacks=0;const timers=new Map(),deadlines=[];
   const oldNow=Object.getOwnPropertyDescriptor(performance,'now'),oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;
   const advance=(elapsed,fire)=>{clock+=elapsed;if(fire)for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timerCallbacks++;timer.fn(...timer.args);}};
   Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
   globalThis.setTimeout=(fn,delay,...args)=>{const id=++nextTimer;timers.set(id,{at:clock+delay,fn,args});return id;};
   globalThis.clearTimeout=id=>{timers.delete(id);};
   const deadline=()=>{const value=new Deadline(50);deadlines.push(value);return value;};
   try{
    const streamDeadline=deadline(),relay=boundedStream(source,1,streamDeadline,()=>streamDeadline.check());
    try{await relay.body.getReader().read();}catch{}const stream=await relay.completion;streamDeadline.dispose();
    const jsonDeadline=deadline(),json=await transport.json(response,{maxBytes:1024,deadline:jsonDeadline});jsonDeadline.dispose();
    const expiredDeadline=deadline();
    const expired=await transport.json({status:200,headers:expiredHeaders,body:{getReader:()=>({
     read:()=>{counts.expiredReads++;return Promise.resolve().then(()=>{advance(51,false);return {done:false,value:new Uint8Array()};});},
     cancel:async()=>{counts.expiredCancelled++;},releaseLock:()=>{}
    })}},{maxBytes:1024,deadline:expiredDeadline});expiredDeadline.dispose();
    // Exercise the real Deadline timer callback as well as its monotonic check.
    const timerDeadline=deadline();advance(50,true);let timer='UNEXPECTED_SUCCESS';
    try{timerDeadline.check();}catch(error){timer=error.code;}const timerAborted=timerDeadline.signal.aborted;timerDeadline.dispose();
    if(stream.ok||json.ok||expired.ok)process.exitCode=1;
    else console.log(JSON.stringify({stream:stream.error.code,json:json.error.code,expired:expired.error.code,timer,timerAborted,timerCallbacks,...counts,pendingTimers:timers.size}));
   }finally{
    for(const value of deadlines)value.dispose();timers.clear();globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;
    if(oldNow)Object.defineProperty(performance,'now',oldNow);else delete performance.now;
   }
  `},outfile:file,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const result=spawnSync(process.execPath,[file],{timeout:2000,encoding:'utf8'});expect(result.error).toBeUndefined();expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout.trim())).toEqual({stream:'STREAM_INVALID',json:'INVALID_RESPONSE',expired:'REQUEST_TIMEOUT',timer:'REQUEST_TIMEOUT',timerAborted:true,timerCallbacks:1,streamPulls:1,streamCancelled:1,jsonPulls:1,jsonCancelled:1,expiredReads:1,expiredCancelled:1,pendingTimers:0});
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('observes rejected capture and reader promises even when synchronous work exhausted the deadline',()=>{
 const directory=mkdtempSync(resolve('.native-deadline-'));
 try{
  const file=join(directory,'expired.mjs');buildSync({stdin:{resolveDir:process.cwd(),contents:`
   import {createNativeClient} from './packages/client/src/native-client';
   import {Deadline,HttpTransport} from './packages/client/src/transport';
   const unhandled=[];process.on('unhandledRejection',error=>unhandled.push(error));
   const busy=()=>{const until=performance.now()+80;while(performance.now()<until){}};
   const runtime={id:'runtime_one',workspace_id:'ws',agent_id:'agent_one',runtime_version:1,label:'Runtime',status:'online',last_seen_at:'2026-10-27T00:00:00Z',presence_expires_at:'2026-10-27T00:01:30Z',created_at:'2026-10-27T00:00:00Z'};
   let fetched=0,released=0;
   const client=createNativeClient({origin:'https://hub.example.invalid',workspaceId:'ws',timeoutMs:50,credentialProvider:{acquire:async()=>({slotId:'slot',slotGeneration:1,provenance:null,isCurrent:()=>true,use:fn=>fn('A'.repeat(43)),release:()=>released++})},fetch:async()=>{fetched++;return Response.json({data:{runtime,runtime_token:'B'.repeat(43),revealed:true},request_id:'req'},{status:201});}});
   const result=await client.enrollRuntime({body:{label:'Runtime'}},{idempotencyKey:'key',captureRuntime:()=>{busy();return Promise.reject(Error('synthetic_secret_capture'));}});
   const deadline=new Deadline(50);
   const readerResult=await new HttpTransport(fetch).json({status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({read:()=>{busy();return Promise.reject(Error('synthetic_secret_reader'));},cancel:async()=>{},releaseLock:()=>{}})}},{maxBytes:1024,deadline});deadline.dispose();
   const misuse=createNativeClient({origin:'https://hub.example.invalid',workspaceId:'ws',credentialProvider:{acquire:async()=>({slotId:'slot',slotGeneration:1,provenance:null,isCurrent:()=>true,use:()=>Promise.reject(Error('synthetic_secret_adapter')),release:()=>{}})},fetch:async()=>{throw Error('unexpected fetch');}});
   const adapterResult=await misuse.call('getConfiguration',{});
   await new Promise(r=>setTimeout(r,0));
   console.log(JSON.stringify({capture:result.ok?'UNEXPECTED_SUCCESS':result.error.code,reader:readerResult.ok?'UNEXPECTED_SUCCESS':readerResult.error.code,fetched,released,adapter:adapterResult.ok?'UNEXPECTED_SUCCESS':adapterResult.error.code,unhandled:unhandled.length,leaked:JSON.stringify([result,readerResult]).includes('synthetic_secret')}));
  `},outfile:file,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const result=spawnSync(process.execPath,[file],{timeout:2000,encoding:'utf8'});expect(result.error).toBeUndefined();expect(result.status).toBe(0);expect(JSON.parse(result.stdout.trim())).toEqual({capture:'REQUEST_TIMEOUT',reader:'REQUEST_TIMEOUT',fetched:1,released:1,adapter:'CREDENTIAL_CHANGED',unhandled:0,leaked:false});
 }finally{rmSync(directory,{recursive:true,force:true});}
});
