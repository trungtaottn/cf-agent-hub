import {afterAll,beforeAll,expect,it} from 'vitest';
import {createServer,type Server} from 'node:https';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,X509Certificate} from 'node:crypto';
import {readFixtureResponse,sendFixtureReady,type FixtureReadTrust} from '../helpers/fixture-https-read';

const origin='https://hub.fixture.example.invalid';
let directory:string,server:Server,trust:FixtureReadTrust,otherCertificate:string,requests=0;
beforeAll(async()=>{
 directory=mkdtempSync(join(tmpdir(),'fixture-reader-test-'));
 for(const label of ['app','other'])execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=hub.fixture.example.invalid','-addext','subjectAltName=DNS:hub.fixture.example.invalid','-addext','basicConstraints=critical,CA:FALSE','-keyout',join(directory,label+'.key'),'-out',join(directory,label+'.crt')],{stdio:'ignore'});
 const certificate=readFileSync(join(directory,'app.crt'),'utf8');otherCertificate=readFileSync(join(directory,'other.crt'),'utf8');
 const pin=createHash('sha256').update(new X509Certificate(certificate).publicKey.export({type:'spki',format:'der'})).digest('base64');
 server=createServer({key:readFileSync(join(directory,'app.key')),cert:certificate},(req,res)=>{
  requests++;if(req.url==='/redirect'){res.writeHead(302,{location:'https://external.example.invalid/'});res.end();return;}
  if(req.method==='POST'){const chunks:Buffer[]=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({method:req.method,body:Buffer.concat(chunks).toString('utf8'),cookie:req.headers.cookie,csrf:req.headers['x-csrf-token'],key:req.headers['idempotency-key'],origin:req.headers.origin,contentType:req.headers['content-type']}));});return;}
  if(req.url==='/large'){res.end(Buffer.alloc(2*1024*1024+1));return;}
  if(req.url==='/cookies'){res.writeHead(200,{'set-cookie':['a=1','b=2']});res.end('{}');return;}
  if(req.url==='/encoded'){res.writeHead(200,{'content-encoding':'gzip'});res.end('not a plain JSON response');return;}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({host:req.headers.host,cookie:req.headers.cookie}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 trust={port:(server.address() as {port:number}).port,certificate,pin};
});
afterAll(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));if(directory)rmSync(directory,{recursive:true,force:true});});
it('reads exact trusted fixture with hostname validation and preserves request cookie',async()=>{
 const response=await readFixtureResponse(origin+'/data',{cookie:'synthetic=test','host':'wrong.example.invalid'},trust);
 expect(response.status).toBe(200);expect(JSON.parse(response.body.toString())).toEqual({host:'hub.fixture.example.invalid',cookie:'synthetic=test'});
});
it('rejects a different certificate even when its own pin matches',async()=>{
 const pin=createHash('sha256').update(new X509Certificate(otherCertificate).publicKey.export({type:'spki',format:'der'})).digest('base64');
 await expect(readFixtureResponse(origin+'/data',{}, {...trust,certificate:otherCertificate,pin})).rejects.toThrow();
});
it('rejects mismatched readiness pin before sending a request',async()=>{
 const before=requests;await expect(readFixtureResponse(origin+'/data',{}, {...trust,pin:Buffer.alloc(32).toString('base64')})).rejects.toThrow('FIXTURE_TRUST_INVALID');expect(requests).toBe(before);
});
it.each(['http://hub.fixture.example.invalid/data','https://other.example.invalid/data','https://user@hub.fixture.example.invalid/data','https://hub.fixture.example.invalid:444/data'])('rejects foreign authority %s before sending cookies',async url=>{
 const before=requests;await expect(readFixtureResponse(url,{cookie:'synthetic=test'},trust)).rejects.toThrow('FIXTURE_ORIGIN_DENIED');expect(requests).toBe(before);
});
it('rejects redirects rather than following their target',async()=>{await expect(readFixtureResponse(origin+'/redirect',{},trust)).rejects.toThrow('FIXTURE_REDIRECT_DENIED');});
it('bounds buffered response bytes',async()=>{await expect(readFixtureResponse(origin+'/large',{},trust)).rejects.toThrow('FIXTURE_RESPONSE_LIMIT');});
it.each(['/cookies','/encoded'])('rejects unsupported response metadata rather than silently changing semantics: %s',async path=>{await expect(readFixtureResponse(origin+path,{},trust)).rejects.toThrow('FIXTURE_RESPONSE_UNSUPPORTED');});
const readyPath='/v2/workspaces/ws_example/tasks/task_example:ready';
const commandHeaders={cookie:'synthetic=session',origin,'content-type':'application/json','x-csrf-token':'synthetic-csrf','idempotency-key':'synthetic-key'};
it('preserves exact ready command bytes and browser authorization/replay headers',async()=>{
 const bytes=Buffer.from('{ "expected_version": 1, "note": "synthetic" }');const response=await sendFixtureReady(origin+readyPath,commandHeaders,bytes,trust);
 expect(JSON.parse(response.body.toString())).toEqual({method:'POST',body:bytes.toString(),cookie:commandHeaders.cookie,csrf:commandHeaders['x-csrf-token'],key:commandHeaders['idempotency-key'],origin,contentType:'application/json'});
});
it.each(['cookie','origin','content-type','x-csrf-token','idempotency-key'])('refuses missing ready authority header %s before dispatch',async key=>{
 const headers:Record<string,string>={...commandHeaders};delete headers[key];const before=requests;await expect(sendFixtureReady(origin+readyPath,headers,Buffer.from('{}'),trust)).rejects.toThrow('FIXTURE_READY_INVALID');expect(requests).toBe(before);
});
it.each(['/v2/workspaces/ws_other/tasks/task_example:ready','/v2/workspaces/ws_example/tasks/task_example:cancel',readyPath+'?extra=1'])('refuses unrelated mutation target %s',async path=>{
 const before=requests;await expect(sendFixtureReady(origin+path,commandHeaders,Buffer.from('{}'),trust)).rejects.toThrow('FIXTURE_READY_INVALID');expect(requests).toBe(before);
});
it('bounds ready body before network dispatch',async()=>{const before=requests;await expect(sendFixtureReady(origin+readyPath,commandHeaders,Buffer.alloc(65537),trust)).rejects.toThrow('FIXTURE_READY_INVALID');expect(requests).toBe(before);});
