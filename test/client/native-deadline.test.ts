import {it,expect} from 'vitest';
import {buildSync} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
it('terminates infinite zero-progress producers in a guarded subprocess',()=>{
 // Task-owned temporary directory; this is not a recovery fixture or protected-I/O bypass.
 const directory=mkdtempSync(resolve('.native-deadline-'));
 try{
  const file=join(directory,'probe.mjs');buildSync({stdin:{resolveDir:process.cwd(),contents:`
   import {boundedStream} from './packages/client/src/streams';
   import {Deadline,HttpTransport} from './packages/client/src/transport';
   const empty=()=>new ReadableStream({pull(c){c.enqueue(new Uint8Array());}},{highWaterMark:0});
   const deadline=new Deadline(50);const relay=boundedStream(empty(),1,deadline,()=>deadline.check());
   try{await relay.body.getReader().read();}catch{}const stream=await relay.completion;deadline.dispose();
   const jsonDeadline=new Deadline(50);const result=await new HttpTransport(fetch).json(new Response(empty(),{headers:{'content-type':'application/json'}}),{maxBytes:1024,deadline:jsonDeadline});jsonDeadline.dispose();
   if(stream.ok||result.ok)process.exitCode=1;else console.log(JSON.stringify({stream:stream.error.code,json:result.error.code}));
  `},outfile:file,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const result=spawnSync(process.execPath,[file],{timeout:2000,encoding:'utf8'});expect(result.error).toBeUndefined();expect(result.status).toBe(0);expect(JSON.parse(result.stdout.trim())).toEqual({stream:'STREAM_INVALID',json:'INVALID_RESPONSE'});
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
