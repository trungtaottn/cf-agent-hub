import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {canonicalBytes,encodeChunk} from '../../src/recovery/encoding.ts';
import {TABLE_REGISTRY,RECOVERY_SCHEMA_VERSION} from '../../src/recovery/table-registry-v1.ts';
import {signRecord} from '../../src/recovery/manifest.ts';
import {prepareBootstrap} from '../../src/config/bootstrap.ts';
export const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const jobId=(workspace,capture,kind)=>'job_'+sha(canonicalBytes([workspace,capture,kind])).slice(0,48);
export const receipt=(capture='capture_one')=>({id:'receipt_one',capture_id:capture,workspace_id:'ws_example',status:'complete',checks:[{name:'capture',passed:true,code:'OK'}],unresolved_effect_ids:[],unresolved_effect_count:0,unresolved_effect_ids_complete:true,started_at:'2026-10-25T00:00:00Z',ended_at:'2026-10-25T00:01:00Z'});
export async function protocolFixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cfhub-cli-flow-'));fs.chmodSync(directory,0o700);
 const integrityBytes=crypto.randomBytes(32),encryptionBytes=crypto.randomBytes(32),integrity={keyId:'integrity_key',key:integrityBytes.toString('base64')},encryption={keyId:'snapshot_key',key:encryptionBytes};
 const descriptors=[];
 const secret=(name,value)=>{const file=path.join(directory,name);fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});const fd=fs.openSync(file,'r');descriptors.push(fd);return fd;};
 const raw={format_version:1,origin:'https://operator.example.invalid',environment_id:'source_env',workspace_id:'ws_example',object_name:'source_object',allowed_workspace_ids:['ws_example'],expected_authority_epoch:1,operation_id:'capture_one',capture_id:'capture_one',reason:'Disposable isolated protocol fixture',service:{principal_id:'operator_one',credentials_fd:secret('service.json',{client_id:'synthetic_service_id',client_secret:'synthetic_service_secret'})},integrity:{key_id:'integrity_key',key_fd:secret('integrity.json',{key:integrity.key})},encryption:{key_id:'snapshot_key',key_fd:secret('encryption.json',{key:encryptionBytes.toString('base64')})},state_path:path.join(directory,'capture-state.enc'),artifact_directory:path.join(directory,'artifacts'),budget:{max_rows:1000,max_artifacts:0,max_total_bytes:1000000},max_requests:64};
 const input=path.join(directory,'capture.json');fs.writeFileSync(input,JSON.stringify(raw),{mode:0o600});
 const tables=['schema_migrations','workspace_metadata','maintenance_state'],chunks=[];
 for(const [index,name]of tables.entries()){
  const table=TABLE_REGISTRY.find(t=>t.name===name),count=name==='schema_migrations'?RECOVERY_SCHEMA_VERSION:1;
  const rows=Array.from({length:count},(_,row)=>table.columns.map(column=>{
   if(column.type==='INTEGER')return column.name==='version'?row+1:1;
   if(column.type==='REAL')return 1;
   if(column.type==='BLOB')return {type:'blob',base64:Buffer.from('private_canary').toString('base64')};
   return column.name==='config_json'?'sensitive_row_canary':'value';
  }));
  chunks.push(Buffer.from(encodeChunk({format_version:1,capture_id:'capture_one',index,table:name,columns:table.columns.map(c=>c.name),rows})));
 }
 const tableCounts=Object.fromEntries(TABLE_REGISTRY.map(t=>[t.name,t.name==='schema_migrations'?RECOVERY_SCHEMA_VERSION:['workspace_metadata','maintenance_state'].includes(t.name)?1:0]));
 let manifest={format_version:1,capture_id:'capture_one',workspace_id:'ws_example',environment_id:'source_env',started_at:'2026-10-25T00:00:00Z',ended_at:'2026-10-25T00:01:00Z',checkpoint:{barrier_id:'barrier_one',event_sequence:0,schema_version:RECOVERY_SCHEMA_VERSION,contract_revision:'0.1',authority_epoch:1},release:{revision:'fixture_revision',worker_version:'fixture_worker',binding_ids:['workspace_binding','recovery_bucket'],catalog_mapping:{workspace_id:'ws_example',object_name:'source_object'}},database:{sha256:sha(Buffer.concat(chunks)),byte_size:chunks.reduce((n,b)=>n+b.length,0),table_counts:tableCounts,chunks:chunks.map((bytes,index)=>({index,table:tables[index],sha256:sha(bytes),byte_size:bytes.length,row_count:index===0?RECOVERY_SCHEMA_VERSION:1}))},artifacts:[],unfinished_artifact_ids:[],auth:{key_id:'integrity_key',algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}};
 manifest=await signRecord(manifest,integrity);
 const counts={rows:RECOVERY_SCHEMA_VERSION+2,chunks:chunks.length,bytes:manifest.database.byte_size};
 let requests=0;
 const reply=data=>{const requestId='request_'+(++requests),wire={request_id:requestId,data},bytes=Buffer.from(JSON.stringify(wire));return {status:200,requestId,data,raw:bytes,sha256:sha(bytes)};};
 const progress=(kind,complete=false,step=1)=>({job_id:jobId('ws_example','capture_one',kind),capture_id:'capture_one',workspace_id:'ws_example',operation:kind,authority_epoch:kind==='capture'?1:3,state:complete?'complete':'running',phase:complete?'complete':kind==='capture'?'capture_pages':'awaiting_chunks',step,counts:complete?counts:{rows:0,chunks:0,bytes:0},pending_operation_id:null,next_operation:complete?null:kind==='capture'?'capture':'write-chunk',next_chunk_index:!complete&&kind==='restore'?0:null,receipt:complete?receipt():null,manifest:complete||kind==='restore'?manifest:null});
 const captureTransport=async command=>{
  if(command.operation==='capture')return reply(progress('capture',true,1));
  if(command.operation==='read-chunk'){const bytes=chunks[command.payload.index],metadata={capture_id:'capture_one',index:command.payload.index,sha256:sha(bytes),byte_size:bytes.length};return {status:200,requestId:null,chunk:{metadata,bytes},raw:bytes,sha256:sha(bytes)};}
  throw Error('UNEXPECTED_PROTOCOL_OPERATION');
 };
 async function target(){
  const config=JSON.parse(fs.readFileSync(new URL('../../examples/config/deployment.example.json',import.meta.url),'utf8')),bundle=JSON.parse(fs.readFileSync(new URL('../../examples/config/r1-bootstrap.example.json',import.meta.url),'utf8'));
  config.config_epoch=3;config.workspace_catalog[0].object_name='target_object';config.static_credential_refs[0].expires_at=new Date(Date.now()+30*86400000).toISOString();
  bundle.config_epoch=3;bundle.config_digest=sha(canonicalBytes(config));
  const prepared=await prepareBootstrap(config,bundle,'ws_example');
  let ledger={workspace_id:'ws_example',environment_id:'target_env',authority_epoch:3,config,verification_bundle:bundle,installation_digest:prepared.installationDigest,retired_authorities:[],auth:{key_id:'integrity_key',algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}};
  ledger=await signRecord(ledger,integrity);const ledgerPath=path.join(directory,'ledger.json');fs.writeFileSync(ledgerPath,JSON.stringify(ledger),{mode:0o600});
  const targetRaw={...raw,environment_id:'target_env',object_name:'target_object',expected_authority_epoch:0,operation_id:'restore_one',state_path:path.join(directory,'restore-state.enc'),current_ledger:{path:ledgerPath,authority_epoch:3,sha256:sha(canonicalBytes(ledger))}};delete targetRaw.budget;
  const targetInput=path.join(directory,'restore.json');fs.writeFileSync(targetInput,JSON.stringify(targetRaw),{mode:0o600});return {raw:targetRaw,input:targetInput,ledger};
 }
 return {directory,raw,input,integrity,encryption,manifest,chunks,counts,reply,progress,captureTransport,target,close(){for(const fd of descriptors)fs.closeSync(fd);fs.rmSync(directory,{recursive:true,force:true});}};
}
