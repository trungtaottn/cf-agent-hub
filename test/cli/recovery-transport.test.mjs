import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import https from 'node:https';import {execFileSync} from 'node:child_process';
import {createRecoveryTransport} from '../../scripts/lib/recovery-transport.mjs';
import {encodeHeader} from '../../src/recovery/encoding.ts';
const command={operation:'probe',workspace_id:'ws_example',capture_id:null,expected_authority_epoch:1,operation_id:'probe_one',reason:'Isolated transport test',payload:{}};
const receipt={id:'probe_one',workspace_id:'ws_example',config_epoch:1,schema_version:7,checked_at:'2026-10-25T00:00:00Z',checks:[{name:'rollback',passed:true,code:'OK'}]};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cfhub-cli-tls-'));fs.chmodSync(dir,0o700);
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=operator.fixture.example.invalid','-addext','subjectAltName=DNS:operator.fixture.example.invalid','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem')],{stdio:'ignore'});
const key=fs.readFileSync(path.join(dir,'key.pem')),cert=fs.readFileSync(path.join(dir,'cert.pem'));fs.chmodSync(path.join(dir,'key.pem'),0o600);
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
async function fixture(handler){
 const server=https.createServer({key,cert},handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port,requestImpl=(url,options,callback)=>https.request(url,{...options,hostname:'127.0.0.1',port,servername:'operator.fixture.example.invalid',ca:cert},callback);
 return {transport:createRecoveryTransport({origin:'https://operator.fixture.example.invalid',service:{client_id:'synthetic_id',client_secret:'synthetic_secret'}},{requestImpl}),close:()=>new Promise(resolve=>server.close(resolve))};
}
test('strict HTTPS sends exact control once with Access service credentials only',async()=>{
 let count=0;const f=await fixture(async(req,res)=>{count++;const chunks=[];for await(const chunk of req)chunks.push(chunk);
  assert.equal(req.url,'/operator/recovery');assert.equal(req.method,'POST');assert.equal(req.headers['cf-access-client-id'],'synthetic_id');assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.cookie,undefined);
  assert.deepEqual(JSON.parse(Buffer.concat(chunks)),command);res.setHeader('content-type','application/json');res.end(JSON.stringify({request_id:'request:opaque.1',data:receipt}));
 });
 try{const result=await f.transport(command);assert.equal(result.requestId,'request:opaque.1');assert.deepEqual(result.data,receipt);assert.equal(count,1);}finally{await f.close();}
});
test('redirect and malformed responses are denied without automatic retry',async()=>{
 let count=0;const f=await fixture((_req,res)=>{count++;res.writeHead(302,{location:'https://other.example.invalid/'});res.end();});
 try{await assert.rejects(f.transport(command),error=>error.code==='RECOVERY_REDIRECT_DENIED');assert.equal(count,1);}finally{await f.close();}
 const malformed=await fixture((_req,res)=>{res.setHeader('content-type','application/json');res.end('{"data":{}}');});
 try{await assert.rejects(malformed.transport(command),error=>error.code==='RECOVERY_INVALID_RESPONSE');}finally{await malformed.close();}
});
test('binary response metadata and exact digest are checked before bytes are returned',async()=>{
 const bytes=Buffer.from('canonical_binary_fixture'),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
 const read={...command,operation:'read-chunk',capture_id:'capture_one',payload:{index:0}};
 const f=await fixture((_req,res)=>{res.setHeader('content-type','application/octet-stream');res.setHeader('X-CFHub-Recovery-Chunk',encodeHeader({capture_id:'capture_one',index:0,sha256,byte_size:bytes.length}));res.end(bytes);});
 try{const result=await f.transport(read);assert.deepEqual(result.chunk.bytes,bytes);assert.equal(result.chunk.metadata.sha256,sha256);}finally{await f.close();}
});
test('binary upload control binds the unchanged body and digest',async()=>{
 const bytes=Buffer.from('canonical_binary_fixture'),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
 const write={...command,operation:'write-chunk',capture_id:'capture_one',payload:{index:0,sha256,byte_size:bytes.length}};
 let count=0;const f=await fixture(async(req,res)=>{count++;assert.equal(req.headers['content-type'],'application/octet-stream');assert.equal(req.headers['x-cfhub-recovery-control'],encodeHeader(write));const chunks=[];for await(const chunk of req)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);res.setHeader('content-type','application/json');res.end(JSON.stringify({request_id:'req',data:receipt}));});
 try{await f.transport(write,bytes);assert.equal(count,1);await assert.rejects(f.transport(write,Buffer.from('changed')),error=>error.code==='RECOVERY_INPUT_REJECTED');assert.equal(count,1);}finally{await f.close();}
});

test('a valid-looking denial with text MIME is not canonical reconciliation evidence',async()=>{
 const f=await fixture((_req,res)=>{res.writeHead(409,{'content-type':'text/plain'});res.end(JSON.stringify({error:{code:'CONFLICT',message:'Operator request denied',retryable:false,request_id:'req'}}));});
 try{await assert.rejects(f.transport(command),error=>error.status===409&&error.canonicalError===false&&error.serverCode===null);}finally{await f.close();}
});
