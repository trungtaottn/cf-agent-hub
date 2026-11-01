import {expect} from 'vitest';
import {isDeepStrictEqual} from 'node:util';
import {Journal,type JournalEntry} from '../../packages/cli/src/journal';
import {prepareNativeOperation} from '../../packages/client/src/native-request';
import {validateTaskCommandResult} from '../../src/http/generated/auth-validators.js';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import {Agent,fetch as trustedFetch} from 'undici';
import {ProtectedCredentialProvider} from '../../packages/cli/src/secret-store';
import type {NativeClient,NativeRequestOptions,CredentialDispatchLease,VerifiedPrincipalBinding} from '../../packages/client/src/types';
import type {Task,Run,TaskCommandResult,Artifact,Message} from '../../src/http/dto';
import {createNativeClient} from '../../packages/client/src/native-client';
import {formatResult} from '../../packages/cli/src/output';
import {initializeMcpJournal} from '../../packages/mcp-stdio/src/host';
import {Client} from '../../packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../../packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
export interface ReadParityRow {tool:string;operation:'getWorkspace'|'listAgents'|'listTasks'|'getTask';scope:'workspace:read'|'agents:read'|'tasks:read';path:string;}
type Observed={key:string|null;proof:boolean;path:string;method:string;status:number;requestId:string;body:string;upstream:string};
function uncorrelated(value:Record<string,unknown>){const copy=structuredClone(value);if(copy.error){const error=copy.error as Record<string,unknown>;delete error.request_id;}else delete copy.request_id;return copy;}
function correlation(value:Record<string,unknown>):unknown{return value.error?(value.error as Record<string,unknown>).request_id:value.request_id;}
export async function runReadParity(row:ReadParityRow){
 const root=mkdtempSync(join(dirname(process.cwd()),'mcp-read-parity-'));
 let mf:Miniflare|undefined,server:ReturnType<typeof createServer>|undefined,client:Client|undefined,provider:ProtectedCredentialProvider|undefined,agent:Agent|undefined;
 const started=performance.now();
 try{
  await build({entryPoints:['test/mcp/native-worker-parity-fixture.ts'],outfile:join(root,'worker.mjs'),bundle:true,format:'esm',platform:'browser',loader:{'.sql':'text'},external:['cloudflare:workers'],logLevel:'silent'});
  await build({entryPoints:['packages/mcp-stdio/src/main.ts'],outfile:join(root,'main.mjs'),bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
  const sdkEntry='packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
  const sdkPackage='packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/package.json';
  const sdkVersion=(JSON.parse(readFileSync(sdkPackage,'utf8')) as {version:string}).version;expect(sdkVersion).toBe('1.32.2');
  const identity={worker_sha256:digest(join(root,'worker.mjs')),adapter_sha256:digest(join(root,'main.mjs')),sdk_version:sdkVersion,sdk_entry:sdkEntry,sdk_entry_sha256:digest(sdkEntry),sdk_package_sha256:digest(sdkPackage)};
  console.info('MCP_READ_PARITY_BUILD',row.tool,JSON.stringify(identity));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-days','1'],{stdio:'ignore'});
  const seen:Observed[]=[];
  server=createServer({key:readFileSync(join(root,'key.pem')),cert:readFileSync(join(root,'cert.pem'))},async(req,res)=>{
   try{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks).toString(),path=req.url!;
    if(path.startsWith('/__fixture/'))throw Error('PARITY_PRIVATE_ROUTE');
    const upstream=new URL(path,'https://hub.example.invalid');
    if(upstream.origin!=='https://hub.example.invalid'||upstream.pathname+upstream.search!==path)throw Error('PARITY_ORIGIN');
    const response=await mf!.dispatchFetch(upstream.href,{method:req.method,headers:Object.entries(req.headers).flatMap(([k,v])=>typeof v==='string'?[[k,v]]:[]),...(body?{body}:{})});
    const output=Buffer.from(await response.arrayBuffer()),envelope=JSON.parse(output.toString()) as Record<string,unknown>;
    const requestId=correlation(envelope);if(typeof requestId!=='string'||!requestId)throw Error('PARITY_CORRELATION');
    seen.push({key:typeof req.headers['idempotency-key']==='string'?req.headers['idempotency-key']:null,proof:!!req.headers['x-runtime-token'],path,method:req.method!,body,status:response.status,requestId,upstream:upstream.href});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(output);
   }catch{res.destroy();}
  });
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('PARITY_LISTEN');
  const origin='https://127.0.0.1:'+address.port,allowedToken='B'.repeat(42)+'A',deniedToken='C'.repeat(42)+'A';
  const options={modules:true,modulesRoot:root,scriptPath:join(root,'worker.mjs'),compatibilityDate:'2026-10-19',durableObjects:{WORKSPACE:{className:'ParityFixtureDO',useSQLite:true}},r2Buckets:['RECOVERY_BUCKET','ARTIFACT_BUCKET'],bindings:{CSRF_SECRET:'synthetic-csrf-fixture-secret-value-long-enough',CURSOR_ENCRYPTION_KEY:'f'.repeat(64)}};
  mf=new Miniflare(convertV4MiniflareOptions(options));
  const seeded=await mf.dispatchFetch(origin+'/__fixture/seed',{method:'POST',body:JSON.stringify({scope:row.scope,allowedToken,deniedToken})});expect(seeded.status).toBe(200);
  const config=await seeded.json();await mf.setOptions(convertV4MiniflareOptions({...options,bindings:{...options.bindings,DEPLOYMENT_CONFIG:JSON.stringify(config)}}));
  agent=new Agent({connect:{ca:readFileSync(join(root,'cert.pem'),'utf8')}});
  const fetch=(async(url:RequestInfo|URL,init?:RequestInit)=>trustedFetch(String(url),{...init,dispatcher:agent} as never)) as unknown as typeof globalThis.fetch;
  const snapshot=async()=>{const response=await mf!.dispatchFetch(origin+'/__fixture/snapshot');expect(response.status).toBe(200);return response.json();};
  for(const lane of ['allowed','denied'] as const){
   const state=join(root,lane),token=lane==='allowed'?allowedToken:deniedToken;
   mkdirSync(state,{mode:0o700});
   provider=new ProtectedCredentialProvider({directory:join(state,'secrets'),create:true});provider.importCredential(token);
   const native=createNativeClient({origin,workspaceId:'ws_example',credentialProvider:provider,fetch});
   const enrollment=await native.enrollRuntime({body:{label:'Synthetic parity '+lane}},{idempotencyKey:'enroll-'+lane,captureRuntime:value=>provider!.captureRuntime(value)});expect(enrollment.ok).toBe(true);
   expect((await mf.dispatchFetch(origin+'/__fixture/settle')).status).toBe(204);
   const before=await snapshot(),offset=seen.length;
   const nativeResult=row.operation==='getTask'?await native.call('getTask',{path:{task_id:'task_parity'}}):await native.call(row.operation,{});expect(nativeResult.status).toBe(lane==='allowed'?200:403);
   const nativeEnvelope=JSON.parse(formatResult(nativeResult).stdout) as Record<string,unknown>;
   expect(await snapshot()).toEqual(before);
   initializeMcpJournal(state);provider.close();provider=undefined;
   const transport=new StdioClientTransport({command:process.execPath,args:[join(root,'main.mjs'),'--origin',origin,'--workspace','ws_example','--state-dir',state],env:{NODE_EXTRA_CA_CERTS:join(root,'cert.pem')},stderr:'pipe'});
   let diagnostics='';transport.stderr?.on('data',chunk=>diagnostics+=chunk);
   client=new Client({name:'native-read-parity',version:'1.32.2'});await client.connect(transport);
   const result=await client.callTool({name:row.tool,arguments:{workspace_id:'ws_example',...(row.operation==='getTask'?{task_id:'task_parity'}:{})}});
   expect(result.isError).toBe(lane==='denied');expect(result.structuredContent).toBeDefined();
   const envelope=result.structuredContent as Record<string,unknown>;
   expect(uncorrelated(envelope)).toEqual(uncorrelated(nativeEnvelope));
   if(lane==='allowed'){
    const task={id:'task_parity',workspace_id:'ws_example',title:'Parity source task',description:'Synthetic fixed read fixture',state:'backlog',task_version:1,proposal_version:0,project_id:null,work_role_id:null,assigned_agent_id:'agent_research',active_run_id:null,latest_run_id:null,approval_id:null,result:null,retry_count:0,retry_limit:2,flags:[]};
    if(row.operation==='getWorkspace')expect(envelope.data).toMatchObject({id:'ws_example',contract_revision:'0.1',actor:{kind:'agent',principal_id:'agent_research',agent_id:'agent_research'},effective_scopes:['agents:read','tasks:read','workspace:read']});
    if(row.operation==='listAgents'){expect(envelope.data).toHaveLength(1);expect(envelope.data).toMatchObject([{id:'agent_research',workspace_id:'ws_example',agent_version:1,display_name:'Research participant',status:'active'}]);expect(envelope.page).toEqual({next_cursor:null,has_more:false});}
    if(row.operation==='listTasks'){expect(envelope.data).toHaveLength(1);expect(envelope.data).toMatchObject([task]);expect(envelope.page).toEqual({next_cursor:null,has_more:false});}
    if(row.operation==='getTask')expect(envelope.data).toMatchObject(task);
   }
   if(lane==='denied')expect(envelope).toMatchObject({error:{code:'FORBIDDEN',retryable:false}});
   const requests=seen.slice(offset);expect(requests).toHaveLength(2);
   for(const request of requests)expect(request).toMatchObject({path:row.path,method:'GET',body:'',status:lane==='allowed'?200:403,upstream:'https://hub.example.invalid'+row.path});
   expect(nativeResult.requestId).toBe(requests[0].requestId);expect(correlation(envelope)).toBe(requests[1].requestId);
   expect(await snapshot()).toEqual(before);
   expect(diagnostics+JSON.stringify(result)).not.toContain(allowedToken);expect(diagnostics+JSON.stringify(result)).not.toContain(deniedToken);
   await client.close();client=undefined;
  }
  return {identity,tool:row.tool,operation:row.operation,allowed:{status:200,dispatches:2,unchanged:true},denied:{status:403,code:'FORBIDDEN',retryable:false,dispatches:2,unchanged:true},acceptance_eligible:false};
 }finally{
  await client?.close();provider?.close();await agent?.close();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await mf?.dispose();rmSync(root,{recursive:true,force:true});
  console.info('MCP_READ_PARITY_DURATION',row.tool,Math.round(performance.now()-started));
 }
}
export interface TaskParityRow {tool:string;operation:'createTask'|'claimTask'|'getRun'|'heartbeatRun'|'submitTaskResult'|'failTask';scope:'tasks:create'|'tasks:claim'|'tasks:read'|'tasks:execute';status:200|201;}
export async function runTaskParity(row:TaskParityRow){
 const root=mkdtempSync(join(dirname(process.cwd()),'mcp-read-parity-'));
 let mf:Miniflare|undefined,server:ReturnType<typeof createServer>|undefined,client:Client|undefined,provider:ProtectedCredentialProvider|undefined,agent:Agent|undefined;
 const started=performance.now();
 try{
  await build({entryPoints:['test/mcp/native-worker-parity-fixture.ts'],outfile:join(root,'worker.mjs'),bundle:true,format:'esm',platform:'browser',loader:{'.sql':'text'},external:['cloudflare:workers'],logLevel:'silent'});
  await build({entryPoints:['packages/mcp-stdio/src/main.ts'],outfile:join(root,'main.mjs'),bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
  const sdkEntry='packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
  const sdkPackage='packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/package.json';
  const sdkVersion=(JSON.parse(readFileSync(sdkPackage,'utf8')) as {version:string}).version;expect(sdkVersion).toBe('1.32.2');
  const identity={worker_sha256:digest(join(root,'worker.mjs')),adapter_sha256:digest(join(root,'main.mjs')),sdk_version:sdkVersion,sdk_entry:sdkEntry,sdk_entry_sha256:digest(sdkEntry),sdk_package_sha256:digest(sdkPackage)};
  console.info('MCP_TASK_PARITY_BUILD',row.tool,JSON.stringify(identity));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-days','1'],{stdio:'ignore'});
  const seen:Observed[]=[];
  server=createServer({key:readFileSync(join(root,'key.pem')),cert:readFileSync(join(root,'cert.pem'))},async(req,res)=>{
   try{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks).toString(),path=req.url!;
    if(path.startsWith('/__fixture/'))throw Error('PARITY_PRIVATE_ROUTE');
    const upstream=new URL(path,'https://hub.example.invalid');
    if(upstream.origin!=='https://hub.example.invalid'||upstream.pathname+upstream.search!==path)throw Error('PARITY_ORIGIN');
    const response=await mf!.dispatchFetch(upstream.href,{method:req.method,headers:Object.entries(req.headers).flatMap(([k,v])=>typeof v==='string'?[[k,v]]:[]),...(body?{body}:{})});
    const output=Buffer.from(await response.arrayBuffer()),envelope=JSON.parse(output.toString()) as Record<string,unknown>;
    const requestId=correlation(envelope);if(typeof requestId!=='string'||!requestId)throw Error('PARITY_CORRELATION');
    seen.push({key:typeof req.headers['idempotency-key']==='string'?req.headers['idempotency-key']:null,proof:!!req.headers['x-runtime-token'],path,method:req.method!,body,status:response.status,requestId,upstream:upstream.href});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(output);
   }catch{res.destroy();}
  });
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('PARITY_LISTEN');
  const origin='https://127.0.0.1:'+address.port,allowedToken='B'.repeat(42)+'A',deniedToken='C'.repeat(42)+'A';
  const options={modules:true,modulesRoot:root,scriptPath:join(root,'worker.mjs'),compatibilityDate:'2026-10-19',durableObjects:{WORKSPACE:{className:'ParityFixtureDO',useSQLite:true}},r2Buckets:['RECOVERY_BUCKET','ARTIFACT_BUCKET'],bindings:{CSRF_SECRET:'synthetic-csrf-fixture-secret-value-long-enough',CURSOR_ENCRYPTION_KEY:'f'.repeat(64)}};
  mf=new Miniflare(convertV4MiniflareOptions(options));
  const seeded=await mf.dispatchFetch(origin+'/__fixture/seed',{method:'POST',body:JSON.stringify({scope:row.scope,allowedToken,deniedToken,taskFamily:true})});expect(seeded.status).toBe(200);
  const config=await seeded.json();await mf.setOptions(convertV4MiniflareOptions({...options,bindings:{...options.bindings,DEPLOYMENT_CONFIG:JSON.stringify(config)}}));
  agent=new Agent({connect:{ca:readFileSync(join(root,'cert.pem'),'utf8')}});
  const fetch=(async(url:RequestInfo|URL,init?:RequestInit)=>trustedFetch(String(url),{...init,dispatcher:agent} as never)) as unknown as typeof globalThis.fetch;
  const snapshot=async()=>{const response=await mf!.dispatchFetch(origin+'/__fixture/snapshot');expect(response.status).toBe(200);return response.json();};

  for(const lane of ['allowed','denied'] as const){
   const state=join(root,lane),token=lane==='allowed'?allowedToken:deniedToken;mkdirSync(state,{mode:0o700});
   provider=new ProtectedCredentialProvider({directory:join(state,'secrets'),create:true});provider.importCredential(token);
   let native=createNativeClient({origin,workspaceId:'ws_example',credentialProvider:provider,fetch});
   const enrollment=await native.enrollRuntime({body:{label:'Synthetic task parity '+lane}},{idempotencyKey:'enroll-'+lane,captureRuntime:value=>provider!.captureRuntime(value)});expect(enrollment.ok).toBe(true);if(!enrollment.ok)throw Error('PARITY_ENROLLMENT');
   const context:TaskInput={taskId:'task_'+lane,runtimeId:enrollment.data.id,runId:'',lane};
   const prepared=await mf.dispatchFetch(origin+'/__fixture/prepare',{method:'POST',body:JSON.stringify({lane})});expect(prepared.status).toBe(200);expect(await prepared.json()).toEqual({task_id:context.taskId,task_version:2});
   const proofOptions=(key:string):NativeRequestOptions=>({idempotencyKey:key,runtimeProofDispatch:<T>(c:{binding:Readonly<VerifiedPrincipalBinding>;runtimeId:string;lease:CredentialDispatchLease},send:(proof:string)=>T)=>provider!.dispatchRuntimeProof({...c.binding,runtimeId:c.runtimeId},c.lease,send)});
   if(!['createTask','claimTask'].includes(row.operation)){
    const claimed=await native.call('claimTask',{path:{task_id:context.taskId},body:{expected_version:2,runtime_instance_id:context.runtimeId}},proofOptions('prepare-claim-'+lane));
    expect(claimed.ok).toBe(true);if(!claimed.ok||!claimed.data.run)throw Error('PARITY_CLAIM_SETUP');
    expect(claimed.data).toMatchObject({task:{state:'doing',task_version:3},run:{status:'active',run_version:1,fence:1,runtime_instance_id:context.runtimeId}});context.runId=claimed.data.run.id;
   }
   expect((await mf.dispatchFetch(origin+'/__fixture/settle')).status).toBe(204);
   if(lane==='denied'&&row.scope==='tasks:execute'){
    const beforeControl=await snapshot() as SafeSnapshot;
    const control=await mf.dispatchFetch(origin+'/__fixture/downscope',{method:'POST'});expect(control.status).toBe(200);expect(await control.json()).toEqual({kind:'test-only-current-scope-removal',credential_id:'credential_denied',removed:['tasks:execute'],other_fields_unchanged:true});
    const afterControl=await snapshot() as SafeSnapshot;assertDelta(beforeControl,afterControl,{native_credentials:[0,1,0]});expect(afterControl.domain).toEqual(beforeControl.domain);
   }
   const before=await snapshot() as SafeSnapshot,offset=seen.length,key='parity-'+row.operation+'-'+lane;
   initializeMcpJournal(state);provider.close();provider=undefined;
   const transport=new StdioClientTransport({command:process.execPath,args:[join(root,'main.mjs'),'--origin',origin,'--workspace','ws_example','--state-dir',state],env:{NODE_EXTRA_CA_CERTS:join(root,'cert.pem')},stderr:'pipe'});let diagnostics='';transport.stderr?.on('data',chunk=>diagnostics+=chunk);
   client=new Client({name:'native-task-parity',version:'1.32.2'});await client.connect(transport);
   const args=taskArguments(row.operation,context),result=await client.callTool({name:row.tool,arguments:{workspace_id:'ws_example',...args,...(row.operation==='getRun'?{}:{idempotency_key:key})}});
   expect(result.isError).toBe(lane==='denied');expect(result.structuredContent).toBeDefined();const envelope=result.structuredContent as Record<string,unknown>;
   if(lane==='denied')expect(envelope).toMatchObject({error:{code:'FORBIDDEN',retryable:false}});
   let after=await snapshot() as SafeSnapshot;
   for(let attempt=0;attempt<50&&after.domain.scheduler_state.some(r=>r.dirty!==0);attempt++){await new Promise(resolve=>setTimeout(resolve,10));after=await snapshot() as SafeSnapshot;}
   expect(after.domain.scheduler_state.every(r=>r.dirty===0)).toBe(true);
   if(lane==='denied'||row.operation==='getRun')expect(after).toEqual(before);
   if(lane==='allowed')assertTaskEffect(row.operation,context,envelope.data,before,after,seen[offset]);
   await client.close();client=undefined;
   provider=new ProtectedCredentialProvider({directory:join(state,'secrets')});native=createNativeClient({origin,workspaceId:'ws_example',credentialProvider:provider,fetch});
   const nativeResult=await callTaskNative(native,row.operation,context,row.operation==='createTask'?{idempotencyKey:key}:row.operation==='getRun'?{}:proofOptions(key));
   expect(nativeResult.status).toBe(lane==='allowed'?row.status:403);
   const nativeEnvelope=JSON.parse(formatResult(nativeResult).stdout) as Record<string,unknown>;expect(uncorrelated(envelope)).toEqual(uncorrelated(nativeEnvelope));
   expect(await snapshot()).toEqual(after);
   const requests=seen.slice(offset);expect(requests).toHaveLength(2);
   const path=taskPath(row.operation,context),method=row.operation==='getRun'?'GET':'POST';
   for(const request of requests)expect(request).toMatchObject({path,method,status:lane==='allowed'?row.status:403,upstream:'https://hub.example.invalid'+path,proof:!['createTask','getRun'].includes(row.operation),key:row.operation==='getRun'?null:key});
   if(row.operation==='getRun'){expect(requests[0].body).toBe('');expect(requests[1].body).toBe('');}else assertSameSemanticBody(requests[0].body,requests[1].body);expect(correlation(envelope)).toBe(requests[0].requestId);expect(nativeResult.requestId).toBe(requests[1].requestId);
   expect(diagnostics+JSON.stringify(result)).not.toContain(allowedToken);expect(diagnostics+JSON.stringify(result)).not.toContain(deniedToken);
   provider.close();provider=undefined;
  }
  return {identity,tool:row.tool,operation:row.operation,status:row.status,allowed:true,denied:{status:403,code:'FORBIDDEN',retryable:false},native_replay_unchanged:row.operation==='getRun'?null:true,comparison_mode:row.operation==='getRun'?'read-repeat':'original-key-replay',acceptance_eligible:false,denial_control:row.scope==='tasks:execute'?'test-only-current-scope-removal':'signed-missing-scope'};

 }finally{await client?.close();provider?.close();await agent?.close();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await mf?.dispose();rmSync(root,{recursive:true,force:true});console.info('MCP_TASK_PARITY_DURATION',row.tool,Math.round(performance.now()-started));}
}
interface TaskInput {taskId:string;runtimeId:string;runId:string;lane:'allowed'|'denied';}
type SafeRow=Record<string,string|number|null>;
interface SafeSnapshot {tables:Record<string,{count:number;rows:{key:string;row:string}[]}>;domain:Record<string,SafeRow[]>;}
function assertDelta(before:SafeSnapshot,after:SafeSnapshot,expected:Record<string,[number,number,number]>){
 expect(Object.keys(after.tables)).toEqual(Object.keys(before.tables));
 for(const name of Object.keys(before.tables)){
  const a=new Map(before.tables[name].rows.map(r=>[r.key,r.row])),b=new Map(after.tables[name].rows.map(r=>[r.key,r.row]));
  expect(a.size).toBe(before.tables[name].count);expect(b.size).toBe(after.tables[name].count);
  const delta=[Array.from(b.keys()).filter(k=>!a.has(k)).length,Array.from(b.keys()).filter(k=>a.has(k)&&a.get(k)!==b.get(k)).length,Array.from(a.keys()).filter(k=>!b.has(k)).length];
  expect(delta,'exact table delta '+name).toEqual(expected[name]??[0,0,0]);
 }
}
const createBody=(c:TaskInput)=>({title:'MCP created '+c.lane,description:'Synthetic parity creation',project_id:null,work_role_id:null,assigned_agent_id:'agent_research'});
function taskArguments(op:TaskParityRow['operation'],c:TaskInput):Record<string,unknown>{
 switch(op){
  case 'createTask':return createBody(c);
  case 'claimTask':return {task_id:c.taskId,expected_version:2,runtime_instance_id:c.runtimeId};
  case 'getRun':return {run_id:c.runId};
  case 'heartbeatRun':return {run_id:c.runId,expected_run_version:1,fence:1};
  case 'submitTaskResult':return {task_id:c.taskId,expected_version:3,run_id:c.runId,fence:1,result:{summary:'Synthetic result',artifact_ids:[]}};
  case 'failTask':return {task_id:c.taskId,expected_version:3,run_id:c.runId,fence:1,reason:'Synthetic failure',outcome_unknown:true};
 }
}
function callTaskNative(native:NativeClient,op:TaskParityRow['operation'],c:TaskInput,options:NativeRequestOptions){
 switch(op){
  case 'createTask':return native.call('createTask',{body:createBody(c)},options);
  case 'claimTask':return native.call('claimTask',{path:{task_id:c.taskId},body:{expected_version:2,runtime_instance_id:c.runtimeId}},options);
  case 'getRun':return native.call('getRun',{path:{run_id:c.runId}},options);
  case 'heartbeatRun':return native.call('heartbeatRun',{path:{run_id:c.runId},body:{expected_run_version:1,fence:1}},options);
  case 'submitTaskResult':return native.call('submitTaskResult',{path:{task_id:c.taskId},body:{expected_version:3,run_id:c.runId,fence:1,result:{summary:'Synthetic result',artifact_ids:[]}}},options);
  case 'failTask':return native.call('failTask',{path:{task_id:c.taskId},body:{expected_version:3,run_id:c.runId,fence:1,reason:'Synthetic failure',outcome_unknown:true}},options);
 }
}
function taskPath(op:TaskParityRow['operation'],c:TaskInput){const base='/v2/workspaces/ws_example';switch(op){
 case 'createTask':return base+'/tasks';case 'claimTask':return base+'/tasks/'+c.taskId+':claim';case 'getRun':return base+'/runs/'+c.runId;case 'heartbeatRun':return base+'/runs/'+c.runId+':heartbeat';case 'submitTaskResult':return base+'/tasks/'+c.taskId+':submit-result';case 'failTask':return base+'/tasks/'+c.taskId+':fail';
}}
function assertTaskEffect(op:TaskParityRow['operation'],c:TaskInput,data:unknown,before:SafeSnapshot,after:SafeSnapshot,request:Observed){
 if(op==='getRun'){expect(data).toMatchObject({id:c.runId,task_id:c.taskId,runtime_instance_id:c.runtimeId,status:'active',run_version:1,fence:1,ended_at:null});expect(after.domain.runs.find(r=>r.id===c.runId)).toMatchObject({id:c.runId,task_id:c.taskId,runtime_instance_id:c.runtimeId,status:'active',run_version:1,fence:1,ended_at:null});expect(after).toEqual(before);return;}
 const expected:Record<string,[number,number,number]>={events:[1,0,0],task_history:[1,0,0],idempotency_outcomes:[1,0,0]};
 if(op==='createTask')expected.tasks=[1,0,0];else{
  expected.scheduler_state=[0,1,0];expected.runs=op==='claimTask'?[1,0,0]:[0,1,0];
  if(op!=='heartbeatRun')expected.tasks=[0,1,0];if(op==='submitTaskResult')expected.task_results=[1,0,0];
 }
 assertDelta(before,after,expected);
 const events=after.domain.events.filter(e=>!before.domain.events.some(old=>old.id===e.id));expect(events).toHaveLength(1);const event=events[0];
 const eventType={createTask:'task.created',claimTask:'task.claimed',heartbeatRun:'run.heartbeat',submitTaskResult:'task.result_submitted',failTask:'task.failed'}[op];
 expect(event).toMatchObject({type:eventType,request_id:request.requestId});expect(typeof event.occurred_at).toBe('number');
 const eventTime=event.occurred_at as number,history=after.domain.task_history.filter(h=>h.event_id===event.id);expect(history).toHaveLength(1);expect(history[0]).toMatchObject({id:event.id,kind:eventType,created_at:eventTime});
 const task=op==='createTask'?data as Task:op==='heartbeatRun'?null:(data as TaskCommandResult).task;
 const taskId=task?.id??c.taskId,persisted=after.domain.tasks.find(t=>t.id===taskId);expect(persisted).toBeDefined();expect(history[0].task_id).toBe(taskId);
 if(op==='createTask'){
  expect(task).toMatchObject({...createBody(c),workspace_id:'ws_example',state:'backlog',task_version:1,proposal_version:0,active_run_id:null,latest_run_id:null,approval_id:null,result:null,retry_count:0,flags:[]});
  expect(persisted).toMatchObject({state:'backlog',task_version:1,next_fence:1,current_result_id:null,active_run_id:null,latest_run_id:null});expect(history[0]).toMatchObject({task_version:1,run_id:null});expect(event).toMatchObject({resource_id:taskId,resource_version:null,task_version:1,run_id:null,fence:null});return;
 }
 const run=op==='heartbeatRun'?data as Run:(data as TaskCommandResult).run;expect(run).not.toBeNull();if(!run)throw Error('PARITY_RUN');
 expect(run).toMatchObject({task_id:c.taskId,runtime_instance_id:c.runtimeId,agent_id:'agent_research',fence:1});
 const storedRun=after.domain.runs.find(r=>r.id===run.id);expect(storedRun).toMatchObject({task_id:c.taskId,credential_id:'credential_research_1',runtime_instance_id:c.runtimeId,agent_id:'agent_research',fence:1});
 expect(storedRun).toMatchObject({status:run.status,run_version:run.run_version,started_at:Date.parse(run.started_at),lease_expires_at:Date.parse(run.lease_expires_at),ended_at:run.ended_at===null?null:Date.parse(run.ended_at)});
 if(task){expect(persisted).toMatchObject({state:task.state,task_version:task.task_version,active_run_id:task.active_run_id,latest_run_id:task.latest_run_id});expect(JSON.parse(String(persisted?.flags_json))).toEqual(task.flags);}
 expect(event).toMatchObject({resource_id:op==='heartbeatRun'?run.id:taskId,resource_version:null,task_version:op==='heartbeatRun'?3:task!.task_version,run_id:run.id,fence:run.fence});
 expect(history[0].task_version).toBe(event.task_version);
 expect(history[0].run_id).toBe(run.id);expect(persisted).toMatchObject({next_fence:2,latest_run_id:run.id,retry_count:0});
 if(op==='claimTask'){
  expect(task).toMatchObject({id:c.taskId,state:'doing',task_version:3,active_run_id:run.id,latest_run_id:run.id,approval_id:null,result:null});expect(run).toMatchObject({status:'active',run_version:1,ended_at:null,started_at:new Date(eventTime).toISOString(),lease_expires_at:new Date(eventTime+60000).toISOString()});expect(storedRun).toMatchObject({started_at:eventTime,ended_at:null,lease_expires_at:eventTime+60000});expect(history[0].task_version).toBe(3);
 }else if(op==='heartbeatRun'){
  expect(run).toMatchObject({id:c.runId,status:'active',run_version:2,ended_at:null,lease_expires_at:new Date(eventTime+60000).toISOString()});expect(storedRun).toMatchObject({ended_at:null,lease_expires_at:eventTime+60000});expect(persisted).toMatchObject({state:'doing',task_version:3,active_run_id:run.id});expect(history[0].task_version).toBe(3);
 }else{
  expect(run).toMatchObject({id:c.runId,status:op==='submitTaskResult'?'submitted':'failed',run_version:2,ended_at:new Date(eventTime).toISOString()});expect(storedRun?.ended_at).toBe(eventTime);expect(task).toMatchObject({id:c.taskId,state:op==='submitTaskResult'?'review':'backlog',task_version:4,active_run_id:null,approval_id:null,retry_count:0});expect(history[0].task_version).toBe(4);
  if(op==='submitTaskResult'){expect(task?.result).toEqual({summary:'Synthetic result',run_id:c.runId,artifact_ids:[],submitted_by:{kind:'agent',principal_id:'agent_research',agent_id:'agent_research'},submitted_at:new Date(eventTime).toISOString()});const added=after.domain.task_results.filter(r=>!before.domain.task_results.some(old=>old.id===r.id));expect(added).toHaveLength(1);expect(added[0]).toMatchObject({task_id:c.taskId,run_id:c.runId,created_at:eventTime});expect(persisted?.current_result_id).toBe(added[0].id);}else{expect(task?.flags).toEqual(['outcome_unknown']);expect(persisted?.current_result_id).toBeNull();}
 }
 const oldScheduler=before.domain.scheduler_state,newScheduler=after.domain.scheduler_state;expect(oldScheduler).toHaveLength(1);expect(newScheduler).toHaveLength(1);expect(newScheduler[0]).toMatchObject({id:oldScheduler[0].id,generation:Number(oldScheduler[0].generation)+1,dirty:0});
 for(const t of ['outbox','approvals','artifacts','artifact_generations'])expect(after.tables[t].count).toBe(0);
 const deadlines=[...after.domain.runs.filter(r=>r.status==='active').map(r=>Number(r.lease_expires_at)),...after.domain.artifact_inventory_state.map(r=>Number(r.next_due_at))];
 expect(newScheduler[0].next_due_at).toBe(Math.min(...deadlines));
}
/** Native fingerprintRequest canonicalizes the complete JSON body; no field is omitted. */
export function assertSameSemanticBody(left:string,right:string):void{expect(JSON.parse(left)).toEqual(JSON.parse(right));}
export interface OtherParityRow {tool:string;operation:'getInbox'|'getThread'|'createMessage'|'ackMessages'|'getArtifact'|'searchWorkspace';scope:'messages:read'|'messages:send'|'messages:ack'|'artifacts:read'|'search:read';status:200|201;}
export async function runOtherParity(row:OtherParityRow){
 const root=mkdtempSync(join(dirname(process.cwd()),'mcp-read-parity-'));
 let mf:Miniflare|undefined,server:ReturnType<typeof createServer>|undefined,client:Client|undefined,provider:ProtectedCredentialProvider|undefined,agent:Agent|undefined,setupProvider:ProtectedCredentialProvider|undefined;
 const started=performance.now();
 try{
  await build({entryPoints:['test/mcp/native-worker-parity-fixture.ts'],outfile:join(root,'worker.mjs'),bundle:true,format:'esm',platform:'browser',loader:{'.sql':'text'},external:['cloudflare:workers'],logLevel:'silent'});
  await build({entryPoints:['packages/mcp-stdio/src/main.ts'],outfile:join(root,'main.mjs'),bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
  const sdkEntry='packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
  const sdkPackage='packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/package.json';
  const sdkVersion=(JSON.parse(readFileSync(sdkPackage,'utf8')) as {version:string}).version;expect(sdkVersion).toBe('1.32.2');
  const identity={worker_sha256:digest(join(root,'worker.mjs')),adapter_sha256:digest(join(root,'main.mjs')),sdk_version:sdkVersion,sdk_entry:sdkEntry,sdk_entry_sha256:digest(sdkEntry),sdk_package_sha256:digest(sdkPackage)};
  console.info('MCP_OTHER_PARITY_BUILD',row.tool,JSON.stringify(identity));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-days','1'],{stdio:'ignore'});
  const seen:Observed[]=[];
  server=createServer({key:readFileSync(join(root,'key.pem')),cert:readFileSync(join(root,'cert.pem'))},async(req,res)=>{
   try{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks).toString(),path=req.url!;
    if(path.startsWith('/__fixture/'))throw Error('PARITY_PRIVATE_ROUTE');
    const upstream=new URL(path,'https://hub.example.invalid');
    if(upstream.origin!=='https://hub.example.invalid'||upstream.pathname+upstream.search!==path)throw Error('PARITY_ORIGIN');
    const response=await mf!.dispatchFetch(upstream.href,{method:req.method,headers:Object.entries(req.headers).flatMap(([k,v])=>typeof v==='string'?[[k,v]]:[]),...(body?{body}:{})});
    const output=Buffer.from(await response.arrayBuffer()),envelope=JSON.parse(output.toString()) as Record<string,unknown>;
    const requestId=correlation(envelope);if(typeof requestId!=='string'||!requestId)throw Error('PARITY_CORRELATION');
    seen.push({key:typeof req.headers['idempotency-key']==='string'?req.headers['idempotency-key']:null,proof:!!req.headers['x-runtime-token'],path,method:req.method!,body,status:response.status,requestId,upstream:upstream.href});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(output);
   }catch{res.destroy();}
  });
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('PARITY_LISTEN');
  const origin='https://127.0.0.1:'+address.port,allowedToken='B'.repeat(42)+'A',deniedToken='C'.repeat(42)+'A',setupToken='D'.repeat(42)+'A';
  const options={modules:true,modulesRoot:root,scriptPath:join(root,'worker.mjs'),compatibilityDate:'2026-10-19',durableObjects:{WORKSPACE:{className:'ParityFixtureDO',useSQLite:true}},r2Buckets:['RECOVERY_BUCKET','ARTIFACT_BUCKET'],bindings:{CSRF_SECRET:'synthetic-csrf-fixture-secret-value-long-enough',CURSOR_ENCRYPTION_KEY:'f'.repeat(64)}};
  mf=new Miniflare(convertV4MiniflareOptions(options));
  const seeded=await mf.dispatchFetch(origin+'/__fixture/seed',{method:'POST',body:JSON.stringify({scope:row.scope,allowedToken,deniedToken,otherFamily:true,setupToken})});expect(seeded.status).toBe(200);
  const config=await seeded.json();await mf.setOptions(convertV4MiniflareOptions({...options,bindings:{...options.bindings,DEPLOYMENT_CONFIG:JSON.stringify(config)}}));
  agent=new Agent({connect:{ca:readFileSync(join(root,'cert.pem'),'utf8')}});
  const fetch=(async(url:RequestInfo|URL,init?:RequestInit)=>trustedFetch(String(url),{...init,dispatcher:agent} as never)) as unknown as typeof globalThis.fetch;
  const snapshot=async()=>{const response=await mf!.dispatchFetch(origin+'/__fixture/snapshot');expect(response.status).toBe(200);return response.json();};

  let setupNative:NativeClient|undefined,artifact:Artifact|undefined;
  if(['getInbox','getThread','ackMessages'].includes(row.operation)){
   const state=join(root,'setup');mkdirSync(state,{mode:0o700});setupProvider=new ProtectedCredentialProvider({directory:join(state,'secrets'),create:true});setupProvider.importCredential(setupToken);
   setupNative=createNativeClient({origin,workspaceId:'ws_example',credentialProvider:setupProvider,fetch});
   const enrolled=await setupNative.enrollRuntime({body:{label:'Native B preparation'}},{idempotencyKey:'enroll-setup',captureRuntime:value=>setupProvider!.captureRuntime(value)});expect(enrolled.ok).toBe(true);
  }
  const objects=async()=>{const response=await mf!.dispatchFetch(origin+'/__fixture/objects');expect(response.status).toBe(200);return await response.json() as ObjectFact[];};
  for(const lane of ['allowed','denied'] as const){
   const state=join(root,lane),token=lane==='allowed'?allowedToken:deniedToken;mkdirSync(state,{mode:0o700});
   provider=new ProtectedCredentialProvider({directory:join(state,'secrets'),create:true});provider.importCredential(token);
   let native=createNativeClient({origin,workspaceId:'ws_example',credentialProvider:provider,fetch});
   const enrollment=await native.enrollRuntime({body:{label:'Synthetic other parity '+lane}},{idempotencyKey:'enroll-'+lane,captureRuntime:value=>provider!.captureRuntime(value)});expect(enrollment.ok).toBe(true);
   const proofOptions=(key:string):NativeRequestOptions=>({idempotencyKey:key,runtimeProofDispatch:<T>(c:{binding:Readonly<VerifiedPrincipalBinding>;runtimeId:string;lease:CredentialDispatchLease},send:(proof:string)=>T)=>provider!.dispatchRuntimeProof({...c.binding,runtimeId:c.runtimeId},c.lease,send)});
   const context:OtherInput={lane,message:null,artifact:null};
   if(setupNative){
    const sent=await setupNative.call('createMessage',{body:{thread_id:null,recipient_agent_ids:['agent_research'],body:'Native B fixture '+lane,refs:[],artifact_ids:[]}},{idempotencyKey:'prepare-message-'+lane});
    expect(sent.ok).toBe(true);if(!sent.ok)throw Error('PARITY_MESSAGE_SETUP');context.message=sent.data;
    expect(sent.data).toMatchObject({sender:{kind:'agent',principal_id:'agent_other',agent_id:'agent_other'},recipient_agent_ids:['agent_research'],acknowledged_at:null,refs:[],artifact_ids:[]});
   }
   if(row.operation==='getArtifact'){
    if(lane==='allowed'){
     const expectedHash=createHash('sha256').update('hello').digest('hex');
     const staged=await native.call('stageArtifact',{body:{task_id:null,run_id:null,filename:'parity.txt',media_type:'text/plain',byte_size:5,sha256:expectedHash}},proofOptions('prepare-stage'));
     expect(staged.ok).toBe(true);if(!staged.ok)throw Error('PARITY_ARTIFACT_STAGE');expect(staged.data).toMatchObject({status:'staged',artifact_version:1,byte_size:5,sha256:expectedHash});
     const uploaded=await native.call('uploadArtifactContent',{path:{artifact_id:staged.data.id}},{...proofOptions('prepare-upload'),artifact:staged.data,upload:new Blob(['hello']).stream()});
     expect(uploaded.ok).toBe(true);if(!uploaded.ok)throw Error('PARITY_ARTIFACT_UPLOAD');expect(uploaded.data).toMatchObject({id:staged.data.id,status:'uploaded',artifact_version:2});
     const committed=await native.call('commitArtifact',{path:{artifact_id:staged.data.id},body:{expected_artifact_version:uploaded.data.artifact_version}},proofOptions('prepare-commit'));
     expect(committed.ok).toBe(true);if(!committed.ok)throw Error('PARITY_ARTIFACT_COMMIT');expect(committed.data).toMatchObject({id:staged.data.id,status:'committed',artifact_version:3,byte_size:5,sha256:expectedHash,owner:{kind:'agent',principal_id:'agent_research',agent_id:'agent_research'}});artifact=committed.data;
    }
    if(!artifact)throw Error('PARITY_ARTIFACT_MISSING');context.artifact=artifact;
   }
   expect((await mf.dispatchFetch(origin+'/__fixture/settle')).status).toBe(204);
   const before=await snapshot() as SafeSnapshot,beforeObjects=row.operation==='getArtifact'?await objects():null,offset=seen.length,key='parity-'+row.operation+'-'+lane;
   initializeMcpJournal(state);provider.close();provider=undefined;
   const transport=new StdioClientTransport({command:process.execPath,args:[join(root,'main.mjs'),'--origin',origin,'--workspace','ws_example','--state-dir',state],env:{NODE_EXTRA_CA_CERTS:join(root,'cert.pem')},stderr:'pipe'});let diagnostics='';transport.stderr?.on('data',chunk=>diagnostics+=chunk);
   client=new Client({name:'native-other-parity',version:'1.32.2'});await client.connect(transport);
   const mutation=['createMessage','ackMessages'].includes(row.operation),result=await client.callTool({name:row.tool,arguments:{workspace_id:'ws_example',...otherArguments(row.operation,context),...(mutation?{idempotency_key:key}:{})}});
   expect(result.isError).toBe(lane==='denied');expect(result.structuredContent).toBeDefined();const envelope=result.structuredContent as Record<string,unknown>;
   const after=await snapshot() as SafeSnapshot;
   if(lane==='denied'){expect(envelope).toMatchObject({error:{code:'FORBIDDEN',retryable:false}});expect(after).toEqual(before);}else assertOtherEffect(row.operation,context,envelope,before,after,seen[offset],beforeObjects);
   if(beforeObjects)expect(await objects()).toEqual(beforeObjects);
   await client.close();client=undefined;
   provider=new ProtectedCredentialProvider({directory:join(state,'secrets')});native=createNativeClient({origin,workspaceId:'ws_example',credentialProvider:provider,fetch});
   const nativeResult=await callOtherNative(native,row.operation,context,mutation?{idempotencyKey:key}:{});expect(nativeResult.status).toBe(lane==='allowed'?row.status:403);
   expect(uncorrelated(envelope)).toEqual(uncorrelated(JSON.parse(formatResult(nativeResult).stdout) as Record<string,unknown>));expect(await snapshot()).toEqual(after);if(beforeObjects)expect(await objects()).toEqual(beforeObjects);
   const requests=seen.slice(offset);expect(requests).toHaveLength(2);
   for(const request of requests){const url=new URL(request.upstream);expect(request).toMatchObject({method:mutation?'POST':'GET',status:lane==='allowed'?row.status:403,proof:false,key:mutation?key:null});expect(url.origin).toBe('https://hub.example.invalid');expect(url.pathname).toBe(otherPath(row.operation,context));expect(Object.fromEntries(url.searchParams)).toEqual(row.operation==='searchWorkspace'?{q:'Parity',kind:'task'}:{});}
   if(mutation)assertSameSemanticBody(requests[0].body,requests[1].body);else for(const request of requests)expect(request.body).toBe('');
   expect(correlation(envelope)).toBe(requests[0].requestId);expect(nativeResult.requestId).toBe(requests[1].requestId);
   for(const secret of [allowedToken,deniedToken,setupToken])expect(diagnostics+JSON.stringify(result)).not.toContain(secret);
   provider.close();provider=undefined;
  }
  return {identity,tool:row.tool,operation:row.operation,status:row.status,allowed:true,denied:{status:403,code:'FORBIDDEN',retryable:false},denial_control:'signed-missing-scope',acceptance_eligible:false,comparison_mode:['createMessage','ackMessages'].includes(row.operation)?'original-key-replay':'read-repeat',actual_native_b_sender:['getInbox','getThread','ackMessages'].includes(row.operation)};

 }finally{await client?.close();provider?.close();setupProvider?.close();await agent?.close();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await mf?.dispose();rmSync(root,{recursive:true,force:true});console.info('MCP_OTHER_PARITY_DURATION',row.tool,Math.round(performance.now()-started));}
}

interface OtherInput {lane:'allowed'|'denied';message:Message|null;artifact:Artifact|null;}
interface ObjectFact {key_sha256:string;size:number;sha256:string;}
const messageBody=(c:OtherInput)=>({thread_id:null,recipient_agent_ids:['agent_other'],body:'SDK message '+c.lane,refs:[],artifact_ids:[]});
function requiredMessage(c:OtherInput):Message{if(!c.message)throw Error('PARITY_MESSAGE_REQUIRED');return c.message;}
function requiredArtifact(c:OtherInput):Artifact{if(!c.artifact)throw Error('PARITY_ARTIFACT_REQUIRED');return c.artifact;}
function otherArguments(op:OtherParityRow['operation'],c:OtherInput):Record<string,unknown>{switch(op){
 case 'getInbox':return {};case 'getThread':return {thread_id:requiredMessage(c).thread_id};case 'createMessage':return messageBody(c);case 'ackMessages':return {message_ids:[requiredMessage(c).id]};case 'getArtifact':return {artifact_id:requiredArtifact(c).id};case 'searchWorkspace':return {q:'Parity',kind:'task'};
}}
function callOtherNative(native:NativeClient,op:OtherParityRow['operation'],c:OtherInput,options:NativeRequestOptions){switch(op){
 case 'getInbox':return native.call('getInbox',{},options);case 'getThread':return native.call('getThread',{path:{thread_id:requiredMessage(c).thread_id}},options);case 'createMessage':return native.call('createMessage',{body:messageBody(c)},options);case 'ackMessages':return native.call('ackMessages',{body:{message_ids:[requiredMessage(c).id]}},options);case 'getArtifact':return native.call('getArtifact',{path:{artifact_id:requiredArtifact(c).id}},options);case 'searchWorkspace':return native.call('searchWorkspace',{query:{q:'Parity',kind:'task'}},options);
}}
function otherPath(op:OtherParityRow['operation'],c:OtherInput){const base='/v2/workspaces/ws_example';switch(op){
 case 'getInbox':return base+'/inbox';case 'getThread':return base+'/threads/'+requiredMessage(c).thread_id;case 'createMessage':return base+'/messages';case 'ackMessages':return base+'/messages:ack';case 'getArtifact':return base+'/artifacts/'+requiredArtifact(c).id;case 'searchWorkspace':return base+'/search';
}}
function assertOtherEffect(op:OtherParityRow['operation'],c:OtherInput,envelope:Record<string,unknown>,before:SafeSnapshot,after:SafeSnapshot,request:Observed,objects:ObjectFact[]|null){
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 if(!['createMessage','ackMessages'].includes(op)){
  expect(after).toEqual(before);
  if(op==='getInbox'||op==='getThread'){expect(envelope.data).toEqual([requiredMessage(c)]);expect(envelope.page).toEqual({has_more:false,next_cursor:null});const message=requiredMessage(c);expect(before.domain.inbox.find(r=>r.message_id===message.id&&r.recipient_agent_id==='agent_research')).toMatchObject({acknowledged_at:null});expect(before.domain.messages.find(r=>r.id===message.id)).toMatchObject({thread_id:message.thread_id,sender_kind:'agent',sender_principal_id:'agent_other',sender_agent_id:'agent_other',body_sha256:hash(message.body),refs_sha256:hash('[]'),created_at:Date.parse(message.created_at)});}
  if(op==='searchWorkspace'){const task=before.domain.tasks.find(t=>t.id==='task_parity');expect(task).toBeDefined();expect(envelope.data).toEqual([{kind:'task',id:'task_parity',title:'Parity source task',snippet:'Parity source task',created_at:new Date(Number(task?.created_at)).toISOString()}]);expect(envelope.page).toEqual({has_more:false,next_cursor:null});}
  if(op==='getArtifact'){
   const artifact=requiredArtifact(c);expect(envelope.data).toEqual(artifact);expect(artifact).toMatchObject({status:'committed',artifact_version:3,task_id:null,run_id:null,filename:'parity.txt',media_type:'text/plain',byte_size:5,sha256:hash('hello'),expires_at:null});expect(objects).toHaveLength(1);
   const stored=before.domain.artifacts.find(r=>r.id===artifact.id);expect(stored).toMatchObject({status:'committed',artifact_version:3,byte_size:5,sha256:hash('hello'),committed_at:Date.parse(artifact.committed_at!)});
   const generation=before.domain.artifact_generations.find(r=>r.id===stored?.committed_generation_id);expect(generation).toMatchObject({artifact_id:artifact.id,state:'committed',expected_byte_size:5,observed_byte_size:5,expected_sha256:hash('hello'),observed_sha256:hash('hello')});expect(objects![0]).toEqual({key_sha256:generation?.key_sha256,size:5,sha256:hash('hello')});
  }
  return;
 }
 const expected:Record<string,[number,number,number]>={events:[1,0,0],idempotency_outcomes:[1,0,0]};
 if(op==='createMessage'){expected.threads=[1,0,0];expected.thread_participants=[2,0,0];expected.messages=[1,0,0];expected.inbox=[1,0,0];}else expected.inbox=[0,1,0];
 assertDelta(before,after,expected);expect(after.tables.outbox.count).toBe(0);expect(after.domain.scheduler_state).toEqual(before.domain.scheduler_state);
 const events=after.domain.events.filter(e=>!before.domain.events.some(old=>old.id===e.id));expect(events).toHaveLength(1);const event=events[0];expect(event).toMatchObject({request_id:request.requestId,resource_version:null,task_version:null,run_id:null,fence:null});expect(typeof event.occurred_at).toBe('number');
 if(op==='createMessage'){
  const message=envelope.data as Message;expect(message).toMatchObject({workspace_id:'ws_example',sender:{kind:'agent',principal_id:'agent_research',agent_id:'agent_research'},recipient_agent_ids:['agent_other'],body:messageBody(c).body,refs:[],artifact_ids:[],created_at:new Date(Number(event.occurred_at)).toISOString(),acknowledged_at:null});
  expect(event).toMatchObject({type:'message.accepted',resource_id:message.id,thread_id:message.thread_id});expect(after.domain.messages.find(m=>m.id===message.id)).toMatchObject({thread_id:message.thread_id,sender_kind:'agent',sender_principal_id:'agent_research',sender_agent_id:'agent_research',body_sha256:hash(message.body),refs_sha256:hash('[]'),created_at:event.occurred_at});expect(after.domain.threads.find(t=>t.id===message.thread_id)).toMatchObject({workspace_id:'ws_example',created_at:event.occurred_at});
  expect(after.domain.thread_participants.filter(p=>p.thread_id===message.thread_id).map(p=>[p.participant_kind,p.participant_id]).sort()).toEqual([['agent','agent_other'],['agent','agent_research']]);expect(after.domain.inbox.find(i=>i.message_id===message.id)).toMatchObject({recipient_agent_id:'agent_other',created_at:event.occurred_at,acknowledged_at:null});
 }else{
  const message=requiredMessage(c);expect(envelope.data).toEqual({acknowledged_ids:[message.id],already_acknowledged_ids:[]});expect(event).toMatchObject({type:'message.acknowledged',resource_id:message.id,thread_id:null});expect(before.domain.inbox.find(i=>i.message_id===message.id&&i.recipient_agent_id==='agent_research')).toMatchObject({acknowledged_at:null});expect(after.domain.inbox.find(i=>i.message_id===message.id&&i.recipient_agent_id==='agent_research')).toMatchObject({acknowledged_at:event.occurred_at});
 }
}
export async function runSharedParity(kind:'cursor'|'authority'|'claim-loss'){
 const row={tool:'shared_'+kind,scope:'tasks:execute'} as const;
 const root=mkdtempSync(join(dirname(process.cwd()),'mcp-read-parity-'));
 let mf:Miniflare|undefined,server:ReturnType<typeof createServer>|undefined,client:Client|undefined,provider:ProtectedCredentialProvider|undefined,agent:Agent|undefined;
 const started=performance.now();
 try{
  await build({entryPoints:['test/mcp/native-worker-parity-fixture.ts'],outfile:join(root,'worker.mjs'),bundle:true,format:'esm',platform:'browser',loader:{'.sql':'text'},external:['cloudflare:workers'],logLevel:'silent'});
  await build({entryPoints:['packages/mcp-stdio/src/main.ts'],outfile:join(root,'main.mjs'),bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
  const sdkEntry='packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
  const sdkPackage='packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/package.json';
  const sdkVersion=(JSON.parse(readFileSync(sdkPackage,'utf8')) as {version:string}).version;expect(sdkVersion).toBe('1.32.2');
  const identity={worker_sha256:digest(join(root,'worker.mjs')),adapter_sha256:digest(join(root,'main.mjs')),sdk_version:sdkVersion,sdk_entry:sdkEntry,sdk_entry_sha256:digest(sdkEntry),sdk_package_sha256:digest(sdkPackage)};
  console.info('MCP_SHARED_PARITY_BUILD',row.tool,JSON.stringify(identity));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-days','1'],{stdio:'ignore'});
  const seen:Observed[]=[];const loss:{armed:boolean;dropped:TaskCommandResult|null}={armed:false,dropped:null};
  server=createServer({key:readFileSync(join(root,'key.pem')),cert:readFileSync(join(root,'cert.pem'))},async(req,res)=>{
   try{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks).toString(),path=req.url!;
    if(path.startsWith('/__fixture/'))throw Error('PARITY_PRIVATE_ROUTE');
    const upstream=new URL(path,'https://hub.example.invalid');
    if(upstream.origin!=='https://hub.example.invalid'||upstream.pathname+upstream.search!==path)throw Error('PARITY_ORIGIN');
    const response=await mf!.dispatchFetch(upstream.href,{method:req.method,headers:Object.entries(req.headers).flatMap(([k,v])=>typeof v==='string'?[[k,v]]:[]),...(body?{body}:{})});
    const output=Buffer.from(await response.arrayBuffer()),envelope=JSON.parse(output.toString()) as Record<string,unknown>;
    const requestId=correlation(envelope);if(typeof requestId!=='string'||!requestId)throw Error('PARITY_CORRELATION');
    seen.push({key:typeof req.headers['idempotency-key']==='string'?req.headers['idempotency-key']:null,proof:!!req.headers['x-runtime-token'],path,method:req.method!,body,status:response.status,requestId,upstream:upstream.href});
    if(kind==='claim-loss'&&loss.armed&&path.endsWith(':claim')&&req.headers['idempotency-key']==='lost-claim'){expect(response.status).toBe(200);expect(validateTaskCommandResult(envelope.data)).toBe(true);loss.dropped=structuredClone(envelope.data) as TaskCommandResult;req.socket.destroy();return;}
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(output);
   }catch{res.destroy();}
  });
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('PARITY_LISTEN');
  const origin='https://127.0.0.1:'+address.port,allowedToken='B'.repeat(42)+'A',deniedToken='C'.repeat(42)+'A',setupToken='D'.repeat(42)+'A';
  const options={modules:true,modulesRoot:root,scriptPath:join(root,'worker.mjs'),compatibilityDate:'2026-10-19',durableObjects:{WORKSPACE:{className:'ParityFixtureDO',useSQLite:true}},r2Buckets:['RECOVERY_BUCKET','ARTIFACT_BUCKET'],bindings:{CSRF_SECRET:'synthetic-csrf-fixture-secret-value-long-enough',CURSOR_ENCRYPTION_KEY:'f'.repeat(64)}};
  mf=new Miniflare(convertV4MiniflareOptions(options));
  const seeded=await mf.dispatchFetch(origin+'/__fixture/seed',{method:'POST',body:JSON.stringify({scope:row.scope,allowedToken,deniedToken,taskFamily:true,sharedFamily:kind,setupToken})});expect(seeded.status).toBe(200);
  const config=await seeded.json();await mf.setOptions(convertV4MiniflareOptions({...options,bindings:{...options.bindings,DEPLOYMENT_CONFIG:JSON.stringify(config)}}));
  agent=new Agent({connect:{ca:readFileSync(join(root,'cert.pem'),'utf8')}});
  const fetch=(async(url:RequestInfo|URL,init?:RequestInit)=>trustedFetch(String(url),{...init,dispatcher:agent} as never)) as unknown as typeof globalThis.fetch;
  const snapshot=async()=>{const response=await mf!.dispatchFetch(origin+'/__fixture/snapshot');expect(response.status).toBe(200);return response.json();};

  const stateA=join(root,'allowed'),stateB=join(root,'peer');
  const nativeFor=()=>createNativeClient({origin,workspaceId:'ws_example',credentialProvider:provider!,fetch});
  const closeProvider=():void=>{provider?.close();provider=undefined;};
  const openNative=(state:string)=>{provider?.close();provider=new ProtectedCredentialProvider({directory:join(state,'secrets')});return nativeFor();};
  const enroll=async(state:string,token:string,label:string)=>{mkdirSync(state,{mode:0o700});provider=new ProtectedCredentialProvider({directory:join(state,'secrets'),create:true});provider.importCredential(token);const native=nativeFor();const result=await native.enrollRuntime({body:{label}},{idempotencyKey:'enroll-'+label,captureRuntime:value=>provider!.captureRuntime(value)});expect(result.ok).toBe(true);if(!result.ok)throw Error('PARITY_ENROLLMENT');initializeMcpJournal(state);return {native,runtime:result.data,principal:provider.binding()!.principalId};};
  const openSdk=async(state:string)=>{await client?.close();client=undefined;provider?.close();provider=undefined;const transport=new StdioClientTransport({command:process.execPath,args:[join(root,'main.mjs'),'--origin',origin,'--workspace','ws_example','--state-dir',state],env:{NODE_EXTRA_CA_CERTS:join(root,'cert.pem')},stderr:'pipe'});client=new Client({name:'native-shared-parity',version:'1.32.2'});await client.connect(transport);return client;};
  const closeSdk=async()=>{await client?.close();client=undefined;};
  const proofOptions=(key:string):NativeRequestOptions=>({idempotencyKey:key,runtimeProofDispatch:<T>(c:{binding:Readonly<VerifiedPrincipalBinding>;runtimeId:string;lease:CredentialDispatchLease},send:(proof:string)=>T)=>provider!.dispatchRuntimeProof({...c.binding,runtimeId:c.runtimeId},c.lease,send)});
  const pair=async(state:string,tool:string,args:Record<string,unknown>,call:(native:NativeClient)=>Promise<import('../../packages/client/src/types').ApiResult<unknown>>,status:200|400|401|409,code:string|null,path:string,query:Record<string,string>={},key:string|null=null,proof=false)=>{
   const before=await snapshot(),offset=seen.length,native=openNative(state),result=await call(native);expect(result.status).toBe(status);if(code!==null)expect(result).toMatchObject({ok:false,error:{code,retryable:false}});else expect(result.ok).toBe(true);expect(await snapshot()).toEqual(before);
   const sdk=await openSdk(state),output=await sdk.callTool({name:tool,arguments:{workspace_id:'ws_example',...args}});expect(output.isError).toBe(code!==null);expect(output.structuredContent).toBeDefined();const envelope=output.structuredContent as Record<string,unknown>;
   expect(uncorrelated(envelope)).toEqual(uncorrelated(JSON.parse(formatResult(result).stdout) as Record<string,unknown>));expect(await snapshot()).toEqual(before);
   const requests=seen.slice(offset);expect(requests).toHaveLength(2);for(const r of requests){const url=new URL(r.upstream);expect(url.origin).toBe('https://hub.example.invalid');expect(url.pathname).toBe(path);expect(Object.fromEntries(url.searchParams)).toEqual(query);expect(r).toMatchObject({status,method:key?'POST':'GET',key,proof});}
   if(key)assertSameSemanticBody(requests[0].body,requests[1].body);else for(const r of requests)expect(r.body).toBe('');expect(result.requestId).toBe(requests[0].requestId);expect(correlation(envelope)).toBe(requests[1].requestId);await closeSdk();return {native:result,envelope};
  };
  const first=await enroll(stateA,allowedToken,'first');expect(first.principal).toBe('agent_research');expect(first.runtime.agent_id).toBe('agent_research');
  const prepared=await mf.dispatchFetch(origin+'/__fixture/prepare',{method:'POST',body:JSON.stringify({lane:'allowed'})});expect(prepared.status).toBe(200);expect(await prepared.json()).toEqual({task_id:'task_allowed',task_version:2});
  expect((await mf.dispatchFetch(origin+'/__fixture/settle')).status).toBe(204);
  if(kind==='cursor'){
   const before=await snapshot(),offset=seen.length,page=await first.native.call('listTasks',{query:{limit:1}});expect(page.ok).toBe(true);if(!page.ok||typeof page.page?.next_cursor!=='string')throw Error('PARITY_CURSOR_REQUIRED');expect(page.data).toHaveLength(1);expect(page.data[0].id).toBe('task_parity');expect(page.page.has_more).toBe(true);expect(seen.slice(offset)).toHaveLength(1);expect(await snapshot()).toEqual(before);
   const cursor=page.page.next_cursor,base='/v2/workspaces/ws_example/tasks';
   const continued=await pair(stateA,'hub_tasks_list',{limit:1,cursor},n=>n.call('listTasks',{query:{limit:1,cursor}}),200,null,base,{limit:'1',cursor});expect(continued.envelope.data).toMatchObject([{id:'task_allowed',state:'ready',task_version:2}]);expect(continued.envelope.data).toHaveLength(1);expect(continued.envelope.page).toEqual({next_cursor:null,has_more:false});
   await pair(stateA,'hub_tasks_list',{limit:2,cursor},n=>n.call('listTasks',{query:{limit:2,cursor}}),400,'INVALID_REQUEST',base,{limit:'2',cursor});
   await pair(stateA,'hub_tasks_list',{limit:1,state:'ready',cursor},n=>n.call('listTasks',{query:{limit:1,state:'ready',cursor}}),400,'INVALID_REQUEST',base,{limit:'1',state:'ready',cursor});
   closeProvider();const peer=await enroll(stateB,setupToken,'peer');expect(peer.principal).toBe('agent_other');expect(peer.runtime.agent_id).toBe('agent_other');expect(peer.principal).not.toBe(first.principal);closeProvider();
   const peerRead=await pair(stateB,'hub_tasks_list',{},n=>n.call('listTasks',{}),200,null,base);expect(peerRead.envelope.data).toHaveLength(2);expect(peerRead.envelope.page).toEqual({next_cursor:null,has_more:false});
   await pair(stateB,'hub_tasks_list',{limit:1,cursor},n=>n.call('listTasks',{query:{limit:1,cursor}}),400,'INVALID_REQUEST',base,{limit:'1',cursor});
   const stable=await snapshot(),requests=seen.length,sdk=await openSdk(stateA);
   expect((await sdk.listTools()).tools.map(t=>t.name).sort()).toEqual(['hub_workspace_get','hub_agents_list','hub_tasks_list','hub_task_get','hub_task_create','hub_task_claim','hub_run_get','hub_run_heartbeat','hub_task_submit_result','hub_task_fail','hub_inbox_get','hub_thread_get','hub_message_send','hub_messages_ack','hub_artifact_get','hub_search','hub_task_request_decision'].sort());
   await expect(sdk.callTool({name:'hub_tasks_list',arguments:{workspace_id:'ws_other'}})).rejects.toMatchObject({code:-32602});expect(seen).toHaveLength(requests);expect(await snapshot()).toEqual(stable);await closeSdk();
  }else if(kind==='authority'){
   let native=openNative(stateA);const claim=await native.call('claimTask',{path:{task_id:'task_allowed'},body:{expected_version:2,runtime_instance_id:first.runtime.id}},proofOptions('prepare-claim'));expect(claim.ok).toBe(true);if(!claim.ok||!claim.data.run)throw Error('PARITY_CLAIM_SETUP');const run=claim.data.run;expect(run).toMatchObject({status:'active',run_version:1,fence:1,runtime_instance_id:first.runtime.id});expect((await mf.dispatchFetch(origin+'/__fixture/settle')).status).toBe(204);
   const path='/v2/workspaces/ws_example/runs/'+run.id+':heartbeat';
   await pair(stateA,'hub_run_heartbeat',{run_id:run.id,expected_run_version:1,fence:2,idempotency_key:'wrong-fence'},n=>n.call('heartbeatRun',{path:{run_id:run.id},body:{expected_run_version:1,fence:2}},proofOptions('wrong-fence')),409,'STALE_RUN',path,{},'wrong-fence',true);
   native=openNative(stateA);const fresh=await native.enrollRuntime({body:{label:'second'}},{idempotencyKey:'enroll-second',captureRuntime:value=>provider!.captureRuntime(value)});expect(fresh.ok).toBe(true);if(!fresh.ok)throw Error('PARITY_NEW_RUNTIME');expect(fresh.data.id).not.toBe(first.runtime.id);expect(fresh.data.agent_id).toBe('agent_research');
   const positive=await native.call('heartbeatRuntime',{path:{runtime_instance_id:fresh.data.id},body:{expected_runtime_version:1}},proofOptions('positive-new-runtime'));expect(positive).toMatchObject({ok:true,data:{id:fresh.data.id,runtime_version:2,status:'online'}});
   await pair(stateA,'hub_run_heartbeat',{run_id:run.id,expected_run_version:1,fence:1,idempotency_key:'wrong-runtime'},n=>n.call('heartbeatRun',{path:{run_id:run.id},body:{expected_run_version:1,fence:1}},proofOptions('wrong-runtime')),401,'UNAUTHENTICATED',path,{},'wrong-runtime',true);
   const before=await snapshot() as SafeSnapshot,revoked=await mf.dispatchFetch(origin+'/__fixture/revoke',{method:'POST'});expect(revoked.status).toBe(200);expect(await revoked.json()).toMatchObject({status:200,data:{id:'credential_research_1',credential_version:2,status:'revoked'}});const after=await snapshot() as SafeSnapshot;
   assertDelta(before,after,{native_credentials:[0,1,0],runtimes:[0,2,0],events:[1,0,0],idempotency_outcomes:[1,0,0]});expect(after.domain.tasks).toEqual(before.domain.tasks);expect(after.domain.runs).toEqual(before.domain.runs);
   await pair(stateA,'hub_task_get',{task_id:'task_allowed'},n=>n.call('getTask',{path:{task_id:'task_allowed'}}),401,'UNAUTHENTICATED','/v2/workspaces/ws_example/tasks/task_allowed');
  }else{
   const body={expected_version:2,runtime_instance_id:first.runtime.id},before=await snapshot() as SafeSnapshot,offset=seen.length;loss.armed=true;
   const sdk=await openSdk(stateA),lost=await sdk.callTool({name:'hub_task_claim',arguments:{workspace_id:'ws_example',task_id:'task_allowed',...body,idempotency_key:'lost-claim'}});expect(lost.isError).toBe(true);expect(lost.structuredContent).toBeUndefined();expect(loss.dropped).not.toBeNull();const dropped=loss.dropped;if(!dropped?.run)throw Error('PARITY_COMMIT_NOT_OBSERVED');
   let after=await snapshot() as SafeSnapshot;for(let attempt=0;attempt<50&&after.domain.scheduler_state.some(r=>r.dirty!==0);attempt++){await new Promise(resolve=>setTimeout(resolve,10));after=await snapshot() as SafeSnapshot;}
   expect(seen.slice(offset)).toHaveLength(1);expect(seen[offset]).toMatchObject({path:'/v2/workspaces/ws_example/tasks/task_allowed:claim',method:'POST',status:200,key:'lost-claim',proof:true});assertTaskEffect('claimTask',{taskId:'task_allowed',runtimeId:first.runtime.id,runId:'',lane:'allowed'},dropped,before,after,seen[offset]);await closeSdk();
   const retained=readPrivateJournal(stateA),{request:_input,...semantic}=prepareNativeOperation(origin,'ws_example','claimTask',{path:{task_id:'task_allowed'},body});
   if(retained.key!=='lost-claim'||retained.firstDispatch===null||retained.replayState!=='within-window'||!isDeepStrictEqual(retained.request,semantic))throw Error('PARITY_RETAINED_INTENT');
   const observed=await pair(stateA,'hub_run_get',{run_id:dropped.run.id},n=>n.call('getRun',{path:{run_id:dropped!.run!.id}}),200,null,'/v2/workspaces/ws_example/runs/'+dropped.run.id);expect(observed.envelope.data).toEqual(dropped.run);
   expect(await snapshot()).toEqual(after);expect(seen.filter(r=>r.path.endsWith(':claim'))).toHaveLength(1);
   if(!isDeepStrictEqual(readPrivateJournal(stateA),retained))throw Error('PARITY_JOURNAL_CHANGED');
  }
  return {identity,kind,source_only:true,acceptance_eligible:false,completed:true};

 }finally{await client?.close();provider?.close();await agent?.close();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await mf?.dispose();rmSync(root,{recursive:true,force:true});console.info('MCP_SHARED_PARITY_DURATION',kind,Math.round(performance.now()-started));}
}


/** Read-only validation; complete entries stay private in-memory, never printed/exported. */
function readPrivateJournal(state:string):Readonly<JournalEntry>{
 const journal=new Journal({directory:join(state,'mcp-journal'),profile:'mcp-v1',authority:()=>false});
 try{const entries:Readonly<JournalEntry>[]=[];journal.someValidatedSync(entry=>{entries.push(structuredClone(entry));return false;});if(entries.length!==1)throw Error('PARITY_JOURNAL_INVENTORY');return entries[0];}finally{journal.close();}
}
