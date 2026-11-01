import {it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import {Agent,fetch as trustedFetch} from 'undici';
import {ProtectedCredentialProvider} from '../../packages/cli/src/secret-store';
import {Journal,type JournalEntry} from '../../packages/cli/src/journal';
import {createNativeClient} from '../../packages/client/src/native-client';
import {DurableMutations} from '../../packages/cli/src/durable-mutations';
import {initializeMcpJournal} from '../../packages/mcp-stdio/src/host';
import type {TaskCommandResult} from '../../src/http/dto';
import {Client} from '../../packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../../packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
it('real SDK process restart reads original committed claim after settlement with current authority and no apply fallback',async()=>{
 const root=mkdtempSync(join(dirname(process.cwd()),'claim-outcome-chain-'));let mf:Miniflare|undefined,server:ReturnType<typeof createServer>|undefined,client:Client|undefined,provider:ProtectedCredentialProvider|undefined,agent:Agent|undefined;
 try{
  await build({entryPoints:['test/mcp/claim-outcome-worker-fixture.ts'],outfile:join(root,'worker.mjs'),bundle:true,format:'esm',platform:'browser',loader:{'.sql':'text'},external:['cloudflare:workers'],logLevel:'silent'});
  await build({entryPoints:['packages/mcp-stdio/src/main.ts'],outfile:join(root,'main.mjs'),bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-days','1'],{stdio:'ignore'});
  const seen:{path:string;key:string|null;proof:boolean;body:string;requestId?:string;status?:number}[]=[];let dropClaim=true,dropHeartbeat=false,original:TaskCommandResult|undefined,originalRequestId:string|undefined;
  server=createServer({key:readFileSync(join(root,'key.pem')),cert:readFileSync(join(root,'cert.pem'))},async(req,res)=>{
   try{
    const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>65536)throw Error();chunks.push(Buffer.from(chunk));}
    const body=Buffer.concat(chunks).toString(),path=req.url!;if(path.startsWith('/__fixture/'))throw Error();
    const observed:{path:string;key:string|null;proof:boolean;body:string;requestId?:string;status?:number}={path,key:typeof req.headers['idempotency-key']==='string'?req.headers['idempotency-key']:null,proof:!!req.headers['x-runtime-token'],body};seen.push(observed);
    if(dropHeartbeat&&path.endsWith(':heartbeat')){req.socket.destroy();return;}
    // Test-only origin mapping; method/path/query/body and original headers are untouched.
    const upstream=new URL(path,'https://hub.example.invalid');expect(upstream.pathname+upstream.search).toBe(path);
    const response=await mf!.dispatchFetch(upstream.href,{method:req.method,headers:Object.entries(req.headers).flatMap(([k,v])=>typeof v==='string'?[[k,v]]:[]),...(body?{body}:{})});
    const output=Buffer.from(await response.arrayBuffer()),envelope=JSON.parse(output.toString());observed.requestId=envelope.request_id??envelope.error?.request_id;observed.status=response.status;
    if(dropClaim&&path.endsWith(':claim')){dropClaim=false;expect(response.status).toBe(200);original=envelope.data;originalRequestId=envelope.request_id;req.socket.destroy();return;}
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(output);
   }catch{res.destroy();}
  });await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error();const origin='https://127.0.0.1:'+address.port,token='B'.repeat(42)+'A';
  const options={modules:true,modulesRoot:root,scriptPath:join(root,'worker.mjs'),compatibilityDate:'2026-10-19',durableObjects:{WORKSPACE:{className:'ClaimOutcomeFixtureDO',useSQLite:true}},r2Buckets:['RECOVERY_BUCKET','ARTIFACT_BUCKET'],bindings:{CSRF_SECRET:'synthetic-csrf-fixture-secret-value-long-enough',CURSOR_ENCRYPTION_KEY:'f'.repeat(64)}};
  mf=new Miniflare(convertV4MiniflareOptions(options));const seeded=await mf.dispatchFetch(origin+'/__fixture/seed',{method:'POST',body:JSON.stringify({origin:'https://hub.example.invalid',token})});expect(seeded.status).toBe(200);const config=await seeded.json();await mf.setOptions(convertV4MiniflareOptions({...options,bindings:{...options.bindings,DEPLOYMENT_CONFIG:JSON.stringify(config)}}));
  agent=new Agent({connect:{ca:readFileSync(join(root,'cert.pem'),'utf8')}});const fetch=(async(url:RequestInfo|URL,init?:RequestInit)=>trustedFetch(String(url),{...init,dispatcher:agent} as never)) as unknown as typeof globalThis.fetch;
  provider=new ProtectedCredentialProvider({directory:join(root,'secrets'),create:true});provider.importCredential(token);let native=createNativeClient({origin,workspaceId:'ws_example',credentialProvider:provider,fetch});
  const enrolled=await native.enrollRuntime({body:{label:'Synthetic restart'}},{idempotencyKey:'enroll',captureRuntime:value=>provider!.captureRuntime(value)});expect(enrolled.ok).toBe(true);if(!enrolled.ok)throw Error();const runtimeId=enrolled.data.id;
  initializeMcpJournal(root);provider.close();provider=undefined;
  const args={workspace_id:'ws_example',task_id:'task_a',expected_version:2,runtime_instance_id:runtimeId,idempotency_key:'original'};
  const connect=async()=>{const transport=new StdioClientTransport({command:process.execPath,args:[join(root,'main.mjs'),'--origin',origin,'--workspace','ws_example','--state-dir',root],env:{NODE_EXTRA_CA_CERTS:join(root,'cert.pem')},stderr:'pipe'});const result=new Client({name:'claim-restart-parity',version:'1.32.2'});await result.connect(transport);expect((await result.listTools()).tools).toHaveLength(17);return result;};
  const journal=()=>{const store=new Journal({directory:join(root,'mcp-journal'),profile:'mcp-v1',authority:()=>false});try{let found:Readonly<JournalEntry>|undefined;store.someValidatedSync(entry=>{if(entry.key==='original'&&entry.request.operation==='claimTask')found=entry;return false;});if(!found)throw Error('MISSING_INTENT');return found;}finally{store.close();}};
  client=await connect();const lost=await client.callTool({name:'hub_task_claim',arguments:args});expect(lost.isError).toBe(true);expect(lost.structuredContent).toBeUndefined();await client.close();client=undefined;
  expect(original?.run).toBeTruthy();const retained=journal();expect(retained.firstDispatch).not.toBeNull();
  provider=new ProtectedCredentialProvider({directory:join(root,'secrets')});native=createNativeClient({origin,workspaceId:'ws_example',credentialProvider:provider,fetch});
  const proofDispatch=<T>(context:{binding:Readonly<JournalEntry['principal']>;runtimeId:string;lease:import('../../packages/client/src/types').CredentialDispatchLease},send:(proof:string)=>T)=>provider!.dispatchRuntimeProof({...context.binding,runtimeId:context.runtimeId},context.lease,send);
  const failed=await native.call('failTask',{path:{task_id:'task_a'},body:{expected_version:original!.task.task_version,run_id:original!.run!.id,fence:original!.run!.fence,outcome_unknown:true,reason:'Synthetic explicit settlement'}},{idempotencyKey:'settle',runtimeProofDispatch:proofDispatch});expect(failed.ok).toBe(true);
  const before=await (await mf.dispatchFetch(origin+'/__fixture/snapshot')).json();
  const direct=await native.call('lookupTaskClaimOutcome',{path:{task_id:'task_a'},body:{expected_version:2,runtime_instance_id:runtimeId}},{idempotencyKey:'original',runtimeProofDispatch:proofDispatch});expect(direct).toMatchObject({ok:true,data:original});expect(direct.requestId).not.toBe(originalRequestId);provider.close();provider=undefined;
  client=await connect();const replay=await client.callTool({name:'hub_task_claim',arguments:args});expect(replay).toMatchObject({structuredContent:{data:original}});expect(replay.isError).not.toBe(true);const envelope=replay.structuredContent as {data:TaskCommandResult;request_id:string};expect(envelope.request_id).not.toBe(originalRequestId);expect(envelope.request_id).toBe(seen.at(-1)!.requestId);
  expect(await (await mf.dispatchFetch(origin+'/__fixture/snapshot')).json()).toEqual(before);expect(journal()).toEqual(retained);
  const count=seen.length;const changed=await client.callTool({name:'hub_task_claim',arguments:{...args,expected_version:3}});expect(changed.isError).toBe(true);expect(seen).toHaveLength(count);
  await mf.dispatchFetch(origin+'/__fixture/revoke');const revokedBefore=await (await mf.dispatchFetch(origin+'/__fixture/snapshot')).json();const revoked=await client.callTool({name:'hub_task_claim',arguments:args});expect(revoked).toMatchObject({isError:true,structuredContent:{error:{code:'UNAUTHENTICATED'}}});expect(await (await mf.dispatchFetch(origin+'/__fixture/snapshot')).json()).toEqual(revokedBefore);
  await client.close();client=undefined;provider=new ProtectedCredentialProvider({directory:join(root,'secrets')});const stopped=new DurableMutations({origin,workspaceId:'ws_example',provider,journalDirectory:join(root,'mcp-journal'),journalProfile:'mcp-v1',fetch});dropHeartbeat=true;const heartbeat=await stopped.prepareOrReuse('heartbeatRuntime',{path:{runtime_instance_id:runtimeId},body:{expected_runtime_version:1}},{idempotencyKey:'heartbeat-unknown'});expect((await stopped.dispatch(heartbeat.id)).ok).toBe(false);stopped.close();provider.close();provider=undefined;
  client=await connect();const blockedAt=seen.length,blocked=await client.callTool({name:'hub_task_claim',arguments:args});expect(blocked.isError).toBe(true);expect(blocked.structuredContent).toBeUndefined();expect(seen).toHaveLength(blockedAt);expect(journal()).toEqual(retained);
  const claims=seen.filter(x=>x.path.endsWith(':claim')),lookups=seen.filter(x=>x.path.endsWith(':claim-outcome'));expect(claims).toHaveLength(1);expect(lookups).toHaveLength(3);expect(lookups.map(x=>x.status)).toEqual([200,200,401]);expect(lookups.every(x=>x.body===claims[0].body&&x.key==='original'&&x.proof)).toBe(true);expect(JSON.stringify(replay)).not.toContain(token);
 }finally{await client?.close();provider?.close();await agent?.close();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await mf?.dispose();rmSync(root,{recursive:true,force:true});}
},60000);
