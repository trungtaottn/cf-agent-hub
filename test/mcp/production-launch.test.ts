import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createServer} from 'node:https';
import {build} from 'esbuild';
import {ProtectedCredentialProvider} from '../../packages/cli/src/secret-store';
import {createNativeClient} from '../../packages/client/src/native-client';
import {Client} from '../../packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../../packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
it('production built entrypoint initializes only journal then uses real HTTPS with existing protected custody',async()=>{
 const root=mkdtempSync(join(dirname(process.cwd()),'mcp-production-')),built=join(root,'main.mjs');let server:ReturnType<typeof createServer>|undefined,client:Client|undefined,provider:ProtectedCredentialProvider|undefined;
 try{
  await build({entryPoints:['packages/mcp-stdio/src/main.ts'],outfile:built,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
  const init=spawnSync(process.execPath,[built,'--init-journal','--state-dir',root],{encoding:'utf8'});expect(init.status).toBe(0);expect(init.stdout).toBe('');
  const again=spawnSync(process.execPath,[built,'--init-journal','--state-dir',root],{encoding:'utf8'});expect(again.status).not.toBe(0);expect(again.stdout).toBe('');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-days','1'],{stdio:'ignore'});
  const token='T'.repeat(43),proof='R'.repeat(43);let calls=0;
  server=createServer({key:readFileSync(join(root,'key.pem')),cert:readFileSync(join(root,'cert.pem'))},(request,response)=>{calls++;expect(request.headers.authorization).toBe('Bearer '+token);response.writeHead(403,{'content-type':'application/json'});response.end(JSON.stringify({error:{code:'FORBIDDEN',message:'Access denied',retryable:false,request_id:'https-synthetic'}}));});
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error();const origin='https://127.0.0.1:'+address.port;
  provider=new ProtectedCredentialProvider({directory:join(root,'secrets'),create:true});provider.importCredential(token);const runtime={id:'runtime',workspace_id:'ws',agent_id:'agent',runtime_version:1,label:'Synthetic',status:'online',last_seen_at:'2026-10-27T00:00:00Z',presence_expires_at:'2026-10-27T00:01:30Z',created_at:'2026-10-27T00:00:00Z'};
  const native=createNativeClient({origin,workspaceId:'ws',credentialProvider:provider,fetch:async()=>Response.json({data:{runtime,runtime_token:proof,revealed:true},request_id:'synthetic'},{status:201})});expect((await native.enrollRuntime({body:{label:'Synthetic'}},{idempotencyKey:'synthetic-enrollment',captureRuntime:value=>provider!.captureRuntime(value)})).ok).toBe(true);provider.close();provider=undefined;
  const transport=new StdioClientTransport({command:process.execPath,args:[built,'--origin',origin,'--workspace','ws','--state-dir',root],env:{NODE_EXTRA_CA_CERTS:join(root,'cert.pem')},stderr:'pipe'});let stderr='';transport.stderr?.on('data',chunk=>stderr+=chunk);
  client=new Client({name:'production-entry-canary',version:'1.32.2'});await client.connect(transport);expect(calls).toBe(0);expect((await client.listTools()).tools).toHaveLength(17);const result=await client.callTool({name:'hub_workspace_get',arguments:{workspace_id:'ws'}});expect(result).toMatchObject({isError:true,structuredContent:{error:{code:'FORBIDDEN',request_id:'https-synthetic'}}});expect(calls).toBe(1);expect(stderr+JSON.stringify(result)).not.toContain(token);expect(stderr+JSON.stringify(result)).not.toContain(proof);
 }finally{await client?.close();provider?.close();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
},20000);
