import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {canonicalBytes,encodeChunk} from '../../src/recovery/encoding.ts';
import {TABLE_REGISTRY,tableDefinition} from '../../src/recovery/table-registry-v1.ts';
import {signRecord} from '../../src/recovery/manifest.ts';
import {readSecretFd,readEncryptedArtifact,writeEncryptedArtifact} from '../../scripts/lib/recovery-io.mjs';

const clientModule=new URL('../../scripts/lib/recovery-client.mjs',import.meta.url).href;
const ioModule=new URL('../../scripts/lib/recovery-io.mjs',import.meta.url).href;
const encodingModule=new URL('../../src/recovery/encoding.ts',import.meta.url).href;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const firstTime=1792886400000,secondTime=firstTime+1000;

// The child drives the production controller exactly once. Its transport only returns
// one deterministic terminal response and records every dispatch in a durable test log.
const childSource=`
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [clientUrl,ioUrl,encodingUrl,fixturePath,mode,clockText,resultPath]=process.argv.slice(1);
const {runRecovery}=await import(clientUrl);
const {readProtectedJson,readSecretFd,readEncryptedArtifact}=await import(ioUrl);
const {canonicalBytes}=await import(encodingUrl);
const fixture=readProtectedJson(fixturePath),config=readProtectedJson(fixture.input_path);
const secret=readSecretFd(3),key={keyId:config.encryption.key_id,key:Buffer.from(secret.key,'base64')};
const stateContext={purpose:'state',workspace_id:config.workspace_id,capture_id:config.capture_id,origin:config.origin,environment_id:config.environment_id,operation_id:config.operation_id};
const RealDate=Date,clock=Number(clockText);
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const realRename=fs.renameSync,realLink=fs.linkSync,realUnlink=fs.unlinkSync;
let receiptPublication=null;
fs.renameSync=function(source,destination,...options){
 realRename.call(fs,source,destination,...options);
 if(mode==='after_call'&&destination===config.state_path){
  const state=JSON.parse(readEncryptedArtifact(destination,key,stateContext));
  if(state.command==='resolve-delivery'&&state.pending===null&&state.sequence===1&&state.last_response&&state.complete===false&&state.pending_finish==null)process.exit(93);
 }
};
fs.linkSync=function(source,destination,...options){
 realLink.call(fs,source,destination,...options);
 if(mode==='after_receipt'&&path.dirname(destination)===config.artifact_directory&&destination.endsWith('.receipt.enc'))receiptPublication={source,destination};
};
fs.unlinkSync=function(value,...options){
 realUnlink.call(fs,value,...options);
 if(mode==='after_receipt'&&receiptPublication?.source===value)process.exit(94);
};
const transport=async command=>{
 const previous=fs.readFileSync(fixture.counter_path,'utf8').trim();
 const count=previous?previous.split('\\n').length:0;
 const fd=fs.openSync(fixture.counter_path,'a');
 try{fs.writeSync(fd,JSON.stringify({operation:command.operation,operation_id:command.operation_id,command_sha256:crypto.createHash('sha256').update(canonicalBytes(command)).digest('hex')})+'\\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 if(fixture.command==='verify')throw Error('LOCAL_VERIFY_DISPATCHED');
 if(command.operation!=='resolve-delivery')throw Error('UNEXPECTED_SYNTHETIC_OPERATION');
 const requestId='request_completion_'+(count+1),data=fixture.response;
 const raw=Buffer.from(canonicalBytes({request_id:requestId,data}));
 return {status:200,requestId,data,raw,sha256:crypto.createHash('sha256').update(raw).digest('hex')};
};
try{
 const result=await runRecovery(fixture.command,fixture.input_path,{transport});
 fs.writeFileSync(resultPath,canonicalBytes(result),{flag:'wx',mode:0o600});
}catch(error){process.stderr.write(String(error?.code??error?.message??'COMPLETION_CHILD_FAILED'));process.exit(95);}
`;

function fixture(command){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cfhub-completion-crash-'));fs.chmodSync(directory,0o700);
 const descriptors=[];
 const put=(name,value)=>{const target=path.join(directory,name);fs.writeFileSync(target,canonicalBytes(value),{flag:'wx',mode:0o600});return target;};
 const secretFd=(name,value)=>{const fd=fs.openSync(put(name,value),'r');descriptors.push(fd);return fd;};
 const aesFd=secretFd('encryption.json',{key:crypto.randomBytes(32).toString('base64')});
 const serviceFd=secretFd('service.json',{client_id:'completion_fixture.access',client_secret:'synthetic_completion_secret'});
 const integrityFd=secretFd('integrity.json',{key:crypto.randomBytes(32).toString('base64')});
 const artifactDirectory=path.join(directory,'artifacts');fs.mkdirSync(artifactDirectory,{mode:0o700});
 const evidence=Buffer.from('Synthetic completion fixture: resolve without redrive.'),evidencePath=path.join(directory,'delivery-evidence.txt');
 fs.writeFileSync(evidencePath,evidence,{flag:'wx',mode:0o600});
 const config={format_version:1,origin:'https://operator.example.invalid',environment_id:'completion_fixture',workspace_id:'ws_completion_fixture',object_name:'completion_workspace',allowed_workspace_ids:['ws_completion_fixture'],expected_authority_epoch:1,operation_id:'completion_'+command.replaceAll('-','_'),capture_id:'capture_completion_fixture',reason:'Synthetic controller completion crash',encryption:{key_id:'completion_encryption',key_fd:3},state_path:path.join(directory,'state.enc'),artifact_directory:artifactDirectory,max_requests:8,
  ...(command==='verify'?{integrity:{key_id:'completion_integrity',key_fd:5}}:{service:{principal_id:'operator_completion',credentials_fd:4},resolution:{delivery_id:'delivery_completion',disposition:'failed_without_redrive',evidence_path:evidencePath,evidence_sha256:hash(evidence)}})};
 const inputPath=put('input.json',config),counterPath=path.join(directory,'dispatch.jsonl');fs.writeFileSync(counterPath,'',{flag:'wx',mode:0o600});
 const response={id:'receipt_completion',capture_id:config.capture_id,workspace_id:config.workspace_id,status:'complete',checks:[{name:'delivery_resolution',passed:true,code:'failed_without_redrive'}],unresolved_effect_ids:[],unresolved_effect_count:0,unresolved_effect_ids_complete:true,started_at:new Date(firstTime).toISOString(),ended_at:new Date(firstTime).toISOString()};
 const fixturePath=put('transport-fixture.json',{command,input_path:inputPath,counter_path:counterPath,response});
 const key={keyId:config.encryption.key_id,key:Buffer.from(readSecretFd(aesFd).key,'base64')};
 const integrity={keyId:'completion_integrity',key:readSecretFd(integrityFd).key};
 const context=(purpose,extra={})=>({purpose,workspace_id:config.workspace_id,capture_id:config.capture_id,...extra});
 const stateContext=context('state',{origin:config.origin,environment_id:config.environment_id,operation_id:config.operation_id});
 const readState=()=>JSON.parse(readEncryptedArtifact(config.state_path,key,stateContext));
 const calls=()=>{const text=fs.readFileSync(counterPath,'utf8').trim();return text?text.split('\n').map(line=>JSON.parse(line)):[];};
 const invoke=(mode,time,resultName)=>spawnSync(process.execPath,['--input-type=module','--eval',childSource,'--',clientModule,ioModule,encodingModule,fixturePath,mode,String(time),path.join(directory,resultName)],{stdio:['ignore','pipe','pipe',aesFd,serviceFd,integrityFd],encoding:'utf8',timeout:10000,maxBuffer:65536});
 const readResult=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
 const receiptFiles=()=>fs.readdirSync(artifactDirectory).filter(name=>name.endsWith('.receipt.enc'));
 const receiptContext=sequence=>context('receipt',{operation:command,operation_id:config.operation_id,sequence,origin:config.origin,environment_id:config.environment_id});
 return {directory,config,key,integrity,response,context,readState,calls,invoke,readResult,receiptFiles,receiptContext,close(){for(const fd of descriptors)fs.closeSync(fd);fs.rmSync(directory,{recursive:true,force:true});}};
}

function childExited(child,code){
 assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.stdout,'');
 assert.equal(child.status,code,child.stderr||'Child did not reach the expected production boundary');
 assert.equal(child.stderr,'');
}

async function seedLocalCapture(f){
 // A minimal signed codec fixture for local verification only; it is never restored or
 // represented as a deployed database. All registry counts, rows, chunks and hashes agree.
 const metadata={id:1,workspace_id:f.config.workspace_id,object_name:f.config.object_name,config_epoch:1,config_digest:'a'.repeat(64),installation_digest:'b'.repeat(64),config_json:'{}',bundle_json:'{}',installed_at:firstTime,admission_state:'maintenance',message_retained_after_created_at:null,message_retained_after_id:null,event_retained_after_sequence:null};
 const maintenance={id:1,state:'capturing',barrier_id:'barrier_completion',authority_epoch:1,capture_id:f.config.capture_id,updated_at:firstTime,generation:1};
 const rows={schema_migrations:Array.from({length:7},(_,i)=>({version:i+1,applied_at:firstTime})),workspace_metadata:[metadata],maintenance_state:[maintenance]};
 const chunks=[],counts=Object.fromEntries(TABLE_REGISTRY.map(table=>[table.name,0]));
 for(const [table,values] of Object.entries(rows)){
  const columns=tableDefinition(table).columns.map(column=>column.name),index=chunks.length;
  const bytes=Buffer.from(encodeChunk({format_version:1,capture_id:f.config.capture_id,index,table,columns,rows:values.map(row=>columns.map(name=>row[name]))}));
  counts[table]=values.length;chunks.push({bytes,reference:{index,table,sha256:hash(bytes),byte_size:bytes.length,row_count:values.length}});
  writeEncryptedArtifact(path.join(f.config.artifact_directory,'chunk-'+String(index).padStart(4,'0')+'.enc'),bytes,f.key,f.context('chunk',{index}));
 }
 const database=Buffer.concat(chunks.map(chunk=>chunk.bytes));
 const manifest=await signRecord({format_version:1,capture_id:f.config.capture_id,workspace_id:f.config.workspace_id,environment_id:f.config.environment_id,started_at:new Date(firstTime).toISOString(),ended_at:new Date(firstTime).toISOString(),checkpoint:{barrier_id:'barrier_completion',event_sequence:0,schema_version:7,contract_revision:'0.1',authority_epoch:1},release:{revision:'synthetic_completion',worker_version:'synthetic_completion',binding_ids:['workspace_fixture','recovery_fixture'],catalog_mapping:{workspace_id:f.config.workspace_id,object_name:f.config.object_name}},database:{sha256:hash(database),byte_size:database.length,table_counts:counts,chunks:chunks.map(chunk=>chunk.reference)},artifacts:[],unfinished_artifact_ids:[],auth:{key_id:f.integrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},f.integrity);
 writeEncryptedArtifact(path.join(f.config.artifact_directory,'manifest.enc'),canonicalBytes(manifest),f.key,f.context('manifest'));
 return manifest;
}

test('terminal control resumes after acknowledged-call state publication without another dispatch', {timeout:30000},()=>{
 const f=fixture('resolve-delivery');
 try{
  childExited(f.invoke('after_call',firstTime,'interrupted.json'),93);
  const saved=f.readState();assert.equal(saved.complete,false);assert.equal(saved.pending,null);assert.equal(saved.sequence,1);
  assert.equal(f.calls().length,1);assert.deepEqual(f.receiptFiles(),[]);
  const responsePath=path.join(f.config.artifact_directory,saved.last_response.response_file),responseCiphertext=fs.readFileSync(responsePath);
  const responseContext=f.context('response',{origin:f.config.origin,environment_id:f.config.environment_id,operation_id:saved.last_response.response_operation_id,attempt:saved.last_response.response_attempt});
  const originalResponse=readEncryptedArtifact(responsePath,f.key,responseContext),original=JSON.parse(originalResponse);
  childExited(f.invoke('none',secondTime,'completed.json'),0);
  const result=f.readResult('completed.json');
  assert.equal(f.calls().length,1,'an acknowledged terminal control must never dispatch a new operation ID after restart');
  assert.deepEqual(result.receipt,original.data);assert.equal(result.request_id,original.request_id);assert.equal(result.response_sha256,hash(originalResponse));
  assert.equal(result.response_operation_id,saved.last_response.response_operation_id);assert.deepEqual(fs.readFileSync(responsePath),responseCiphertext);
  const complete=f.readState();assert.equal(complete.complete,true);assert.deepEqual(complete.evidence,result);
  assert.equal(f.receiptFiles().length,1);
  const receipt=readEncryptedArtifact(path.join(f.config.artifact_directory,f.receiptFiles()[0]),f.key,f.receiptContext(complete.sequence));
  assert.deepEqual(receipt,Buffer.from(canonicalBytes(result)));
 }finally{f.close();}
});

test('local verify resumes after receipt publication with identical receipt bytes and timestamp', {timeout:30000},async()=>{
 const f=fixture('verify');
 try{
  const manifest=await seedLocalCapture(f);
  childExited(f.invoke('after_receipt',firstTime,'interrupted.json'),94);
  const saved=f.readState();assert.equal(saved.complete,false);assert.equal(f.calls().length,0);assert.equal(f.receiptFiles().length,1);
  const name=f.receiptFiles()[0],receiptPath=path.join(f.config.artifact_directory,name),ciphertext=fs.readFileSync(receiptPath);
  assert.equal(fs.lstatSync(receiptPath).nlink,1,'this boundary follows unlink and isolates completion from publication-orphan repair');
  const originalBytes=readEncryptedArtifact(receiptPath,f.key,f.receiptContext(saved.sequence)),original=JSON.parse(originalBytes);
  assert.equal(original.completed_at,new Date(firstTime).toISOString());
  childExited(f.invoke('none',secondTime,'completed.json'),0);
  const result=f.readResult('completed.json');
  assert.deepEqual(result,original);assert.equal(result.outcome,'verified_local');assert.equal(result.manifest_sha256,hash(canonicalBytes(manifest)));
  assert.equal(f.calls().length,0,'local verification never contacts the operator on either invocation');
  assert.deepEqual(f.receiptFiles(),[name]);assert.deepEqual(fs.readFileSync(receiptPath),ciphertext);
  assert.deepEqual(readEncryptedArtifact(receiptPath,f.key,f.receiptContext(saved.sequence)),originalBytes);
  const complete=f.readState();assert.equal(complete.complete,true);assert.deepEqual(complete.evidence,original);
 }finally{f.close();}
});
