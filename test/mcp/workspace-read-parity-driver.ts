import {expect} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {Agent,fetch as trustedFetch} from 'undici';
import {ProtectedCredentialProvider} from '../../packages/cli/src/secret-store';
import {createNativeClient} from '../../packages/client/src/native-client';
import {formatResult} from '../../packages/cli/src/output';
import {initializeMcpJournal} from '../../packages/mcp-stdio/src/host';
import {Client} from '../../packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../../packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const ids=['ws_example','ws_peer'] as const;
type WorkspaceId=typeof ids[number];
type Envelope=Record<string,unknown>;
function correlation(value:Envelope){return value.error?(value.error as Envelope).request_id:value.request_id;}
function uncorrelated(value:Envelope){
 const copy=structuredClone(value);if(copy.error)delete (copy.error as Envelope).request_id;else delete copy.request_id;
 return copy;
}
/** Local source coverage only: two distinct configured DOs, never deployed acceptance. */
export async function runWorkspaceReadParity(){
 const root=mkdtempSync(join(dirname(process.cwd()),'mcp-workspace-read-'));
 let mf:Miniflare|undefined,server:ReturnType<typeof createServer>|undefined,agent:Agent|undefined;
 let provider:ProtectedCredentialProvider|undefined,client:Client|undefined;
 const seen:{path:string;method:string;status:number;requestId:string}[]=[];
 try{
  await build({entryPoints:['test/mcp/workspace-read-parity-fixture.ts'],outfile:join(root,'worker.mjs'),bundle:true,format:'esm',platform:'browser',loader:{'.sql':'text'},external:['cloudflare:workers'],logLevel:'silent'});
  await build({entryPoints:['packages/mcp-stdio/src/main.ts'],outfile:join(root,'main.mjs'),bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-days','1'],{stdio:'ignore'});
  server=createServer({key:readFileSync(join(root,'key.pem')),cert:readFileSync(join(root,'cert.pem'))},async(req,res)=>{
   try{
    const path=req.url!,upstream=new URL(path,'https://hub.example.invalid');
    if(path.startsWith('/__fixture/')||upstream.origin!=='https://hub.example.invalid'||upstream.pathname+upstream.search!==path)throw Error('PARITY_ROUTE');
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body=Buffer.concat(chunks),response=await mf!.dispatchFetch(upstream.href,{method:req.method,headers:Object.entries(req.headers).flatMap(([k,v])=>typeof v==='string'?[[k,v]]:[]),...(body.length?{body}:{})});
    const output=Buffer.from(await response.arrayBuffer()),requestId=correlation(JSON.parse(output.toString()) as Envelope);
    if(typeof requestId!=='string'||!requestId)throw Error('PARITY_CORRELATION');
    seen.push({path,method:req.method!,status:response.status,requestId});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(output);
   }catch{res.destroy();}
  });
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('PARITY_LISTEN');
  const origin='https://127.0.0.1:'+address.port;
  const options={modules:true,modulesRoot:root,scriptPath:join(root,'worker.mjs'),compatibilityDate:'2026-10-19',durableObjects:{WORKSPACE:{className:'WorkspaceReadParityDO',useSQLite:true}},r2Buckets:['RECOVERY_BUCKET','ARTIFACT_BUCKET'],bindings:{CSRF_SECRET:'synthetic-csrf-fixture-secret-value-long-enough',CURSOR_ENCRYPTION_KEY:'f'.repeat(64)}};
  mf=new Miniflare(convertV4MiniflareOptions(options));
  const seeded=await mf.dispatchFetch(origin+'/__fixture/seed',{method:'POST'});expect(seeded.status).toBe(200);
  const config=await seeded.json();
  await mf.setOptions(convertV4MiniflareOptions({...options,bindings:{...options.bindings,DEPLOYMENT_CONFIG:JSON.stringify(config)}}));
  agent=new Agent({connect:{ca:readFileSync(join(root,'cert.pem'),'utf8')}});
  const fetch=(async(url:RequestInfo|URL,init?:RequestInit)=>trustedFetch(String(url),{...init,dispatcher:agent} as never)) as unknown as typeof globalThis.fetch;
  const snapshot=async()=>{const r=await mf!.dispatchFetch(origin+'/__fixture/snapshot');expect(r.status).toBe(200);return r.json();};
  const tasks={} as Record<WorkspaceId,{id:string;title:string}>;
  for(const [index,id] of ids.entries()){
   const state=join(root,id);mkdirSync(state,{mode:0o700});
   provider=new ProtectedCredentialProvider({directory:join(state,'secrets'),create:true});
   provider.importCredential((index===0?'B':'C').repeat(42)+'A');
   const native=createNativeClient({origin,workspaceId:id,credentialProvider:provider,fetch});
   const enrollment=await native.enrollRuntime({body:{label:'Synthetic '+id}},{idempotencyKey:'enroll-'+id,captureRuntime:value=>provider!.captureRuntime(value)});
   expect(enrollment.ok).toBe(true);
   const title='Private synthetic task '+id;
   const created=await native.call('createTask',{body:{title,description:'Workspace read isolation'}},{idempotencyKey:'create-'+id});
   expect(created).toMatchObject({ok:true,status:201,data:{workspace_id:id,title,state:'backlog'}});
   if(!created.ok)throw Error('PARITY_TASK_SETUP');
   tasks[id]={id:created.data.id,title};
   initializeMcpJournal(state);provider.close();provider=undefined;
  }
  expect(tasks.ws_example.id).not.toBe(tasks.ws_peer.id);
  expect((await mf.dispatchFetch(origin+'/__fixture/settle',{method:'POST'})).status).toBe(204);
  const baseline=await snapshot();
  expect(Object.keys(baseline as object).sort()).toEqual([...ids].sort());
  for(const id of ids){
   const other=ids.find(value=>value!==id)!,state=join(root,id);
   for(const target of [id,other]){
    const own=target===id,task=tasks[target],offset=seen.length;
    provider=new ProtectedCredentialProvider({directory:join(state,'secrets')});
    const native=createNativeClient({origin,workspaceId:id,credentialProvider:provider,fetch});
    const result=await native.call('getTask',{path:{task_id:task.id}});
    expect(result.status).toBe(own?200:404);
    if(own)expect(result).toMatchObject({ok:true,data:{id:task.id,workspace_id:id,title:task.title}});
    else expect(result).toMatchObject({ok:false,error:{code:'NOT_FOUND',retryable:false}});
    const nativeEnvelope=JSON.parse(formatResult(result).stdout) as Envelope;
    expect(await snapshot()).toEqual(baseline);
    provider.close();provider=undefined;
    const transport=new StdioClientTransport({command:process.execPath,args:[join(root,'main.mjs'),'--origin',origin,'--workspace',id,'--state-dir',state],env:{NODE_EXTRA_CA_CERTS:join(root,'cert.pem')},stderr:'pipe'});
    let diagnostics='';transport.stderr?.on('data',chunk=>diagnostics+=chunk);
    client=new Client({name:'workspace-read-parity',version:'1.32.2'});await client.connect(transport);
    const output=await client.callTool({name:'hub_task_get',arguments:{workspace_id:id,task_id:task.id}});
    expect(output.isError).toBe(!own);expect(output.structuredContent).toBeDefined();
    const envelope=output.structuredContent as Envelope;
    expect(uncorrelated(envelope)).toEqual(uncorrelated(nativeEnvelope));
    expect(seen.slice(offset)).toHaveLength(2);
    for(const request of seen.slice(offset))expect(request).toMatchObject({path:'/v2/workspaces/'+id+'/tasks/'+task.id,method:'GET',status:own?200:404});
    expect(result.requestId).toBe(seen[offset].requestId);expect(correlation(envelope)).toBe(seen[offset+1].requestId);
    expect(await snapshot()).toEqual(baseline);
    if(!own){
     expect(JSON.stringify(envelope)).not.toContain(task.title);
     const count=seen.length;
     await expect(client.callTool({name:'hub_task_get',arguments:{workspace_id:other,task_id:task.id}})).rejects.toMatchObject({code:-32602});
     expect(seen).toHaveLength(count);expect(await snapshot()).toEqual(baseline);
    }
    await client.close();client=undefined;
    for(const token of ['B'.repeat(42)+'A','C'.repeat(42)+'A'])expect(diagnostics+JSON.stringify(envelope)).not.toContain(token);
   }
  }
  return {workspaces:2,own_task_pairs:2,foreign_task_pairs:2,protocol_workspace_rejections:2,both_stores_unchanged:true,source_only:true,acceptance_eligible:false};
 }finally{
  await client?.close();provider?.close();await agent?.close();
  if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
  await mf?.dispose();rmSync(root,{recursive:true,force:true});
 }
}
