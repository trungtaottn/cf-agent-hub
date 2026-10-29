import {createServer} from 'node:https';
import {execFile} from 'node:child_process';
import {readFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {createTestHarness} from 'wrangler';
import {operatorFixture} from './operator-fixture';
export async function operatorCliHarness(directory:string){
 const fixture=await operatorFixture(),originalFetch=globalThis.fetch;
 const key=join(directory,'tls.key'),certificate=join(directory,'tls.crt');
 await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=operator.example.invalid','-addext','subjectAltName=DNS:operator.example.invalid','-keyout',key,'-out',certificate],{maxBuffer:65536});
 await chmod(key,0o600);
 const untrustedCertificate=join(directory,'untrusted.crt'),untrustedKey=join(directory,'untrusted.key');
 await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=operator.example.invalid','-addext','subjectAltName=DNS:operator.example.invalid','-keyout',untrustedKey,'-out',untrustedCertificate],{maxBuffer:65536});
 await chmod(untrustedKey,0o600);
 globalThis.fetch=async(input,init)=>fixture.handler(new Request(input,init));
 const harness=createTestHarness({workers:[
  {configPath:'./workers/operator/wrangler.jsonc',secrets:fixture.bindings},
  {configPath:'./wrangler.jsonc'},
  {configPath:'./workers/recovery-anchor/wrangler.jsonc'}
 ]});
 let server:ReturnType<typeof createServer>|undefined;
 const sockets=new Set<import('node:stream').Duplex>();
 const calls:{count:number;secretFormat:string;mode:string}={count:0,secretFormat:'',mode:'normal'};
 const secrets=new Set<string>();
 const close=async()=>{
  for(const socket of sockets)socket.destroy();
  if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
  await harness.close();globalThis.fetch=originalFetch;
 };
 try{
  await harness.listen();const worker=harness.getWorker('cf-agent-hub-operator');
  server=createServer({key:await readFile(key),cert:await readFile(certificate)},(request,response)=>{void(async()=>{
   calls.count++;
   const clientSecret=request.headers['cf-access-client-secret'],clientId=request.headers['cf-access-client-id'];
   if(request.headers.host!=='operator.example.invalid'||request.url!=='/operator/recovery'||request.method!=='POST'||request.headers.cookie||clientId!=='fixture-client.access'||typeof clientSecret!=='string'||!secrets.has(clientSecret)){
    response.writeHead(403);response.end();return;
   }
   calls.secretFormat=clientSecret.startsWith('cfast_')?'new':'legacy';
   if(calls.mode==='redirect'){response.writeHead(302,{location:'https://untrusted.example.invalid/'});response.end();return;}
   const parts:Buffer[]=[];let size=0;for await(const part of request){size+=part.length;if(size>65536)throw Error('FIXTURE_LIMIT');parts.push(part);}
   const assertion=await (await fixture.handler(new Request('https://operator-fixture.example.invalid/assertion',{method:'POST',body:JSON.stringify(calls.mode==='human'?{claims:{sub:'human'}}:{})}))).text();
   const upstream=await worker.fetch('https://operator.example.invalid/operator/recovery',{method:'POST',headers:{'content-type':'application/json','cf-access-jwt-assertion':assertion},body:Buffer.concat(parts)});
   response.writeHead(upstream.status,{'content-type':'application/json'});response.end(await upstream.text());
  })().catch(()=>{response.writeHead(502);response.end();});});
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(0,'127.0.0.1',resolve);});
  return {key:{key_id:'fixture_key',key_base64:fixture.bindings.BOOTSTRAP_INTEGRITY_KEY},calls,secrets,certificate,untrustedCertificate,authority:async()=>{
   const storage=await harness.getWorker('cf-agent-hub').getDurableObjectStorage('WORKSPACE',{name:'operator-fixture-workspace'});
   const metadata=await storage.exec('SELECT config_epoch AS epoch FROM workspace_metadata');
   const active=await storage.exec('SELECT COUNT(*) AS n FROM native_credentials WHERE enabled=1');
   const retired=await storage.exec('SELECT COUNT(*) AS n FROM native_credentials WHERE retired_at_epoch IS NOT NULL');
   const receipts=await storage.exec("SELECT COUNT(*) AS n FROM idempotency_outcomes WHERE operation='operator.install'");
   const events=await storage.exec('SELECT COUNT(*) AS n FROM events');
   return {epoch:metadata[0].epoch,active:active[0].n,retired:retired[0].n,receipts:receipts[0].n,events:events[0].n};
  },port:(server.address() as {port:number}).port,close,worker};
 }catch(error){await close();throw error;}
}
