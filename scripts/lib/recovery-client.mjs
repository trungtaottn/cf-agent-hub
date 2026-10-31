import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {canonicalBytes,decodeChunk,decodeCurrentChunk,digestBytes,CONTROL_LIMIT,CHUNK_LIMIT,isSlug,closed} from '../../src/recovery/encoding.ts';
import {verifyManifest,validateManifestShape,verifyRecord,verifyCurrentLedger,verifyRetirement,verifyCutover} from '../../src/recovery/manifest.ts';
import {TABLE_REGISTRY} from '../../src/recovery/table-registry-v1.ts';
import {registryForSchema} from '../../src/recovery/table-registry.ts';
import {assertRecoveryEnvelope,isCurrent16Manifest,RESUME_ENVELOPE_LIMIT} from '../../src/recovery/operator-envelope.ts';
import {validateRecoveryCommand,validateRecoveryJobProgress,validateRecoveryReceipt,validateProbeReceipt,validateResumeReceipt,validateRetirementReceipt} from '../../src/recovery/generated/recovery-validators.js';
import {readProtectedJson,readProtectedBytes,readEncryptedArtifact,writeEncryptedArtifact,replaceEncryptedState,fileSha256} from './recovery-io.mjs';
import {acquireRecoveryLease,assertOperationCapacity} from './recovery-capacity.mjs';
import {loadRecoveryConfig} from './recovery-config.mjs';
import {createRecoveryTransport,RecoveryTransportError,validRecoveryRequestId} from './recovery-transport.mjs';

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Error(code);};
const same=(a,b)=>Buffer.from(canonicalBytes(a)).equals(Buffer.from(canonicalBytes(b)));
export const recoveryJobId=(workspaceId,captureId,kind)=>'job_'+hash(canonicalBytes([workspaceId,captureId,kind])).slice(0,48);
const artifactContext=(config,purpose,extra={})=>({purpose,workspace_id:config.workspaceId,capture_id:config.captureId,...extra});
const stateContext=config=>artifactContext(config,'state',{origin:config.origin,environment_id:config.environmentId,operation_id:config.rootOperationId});
const responseContext=(config,id,attempt)=>artifactContext(config,'response',{origin:config.origin,environment_id:config.environmentId,operation_id:id,attempt});
const chunkFile=(config,index)=>path.join(config.artifactDirectory,'chunk-'+String(index).padStart(4,'0')+'.enc');
const manifestFile=config=>path.join(config.artifactDirectory,'manifest.enc');
function parseJson(bytes){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('RECOVERY_ARTIFACT_REJECTED');}}
export async function verifyCliManifest(value,integrity){
 validateManifestShape(value);
 if(value.format_version===1)return verifyManifest(value,integrity);
 await verifyRecord(value,integrity);return structuredClone(value);
}
export function decodeCliChunk(bytes,manifest,expected){
 if(manifest.format_version!==2)return decodeChunk(bytes,expected);
 const decoded=decodeCurrentChunk(bytes,expected?{...expected,schema_version:manifest.checkpoint.schema_version}:undefined);
 if(decoded.schema_version!==manifest.checkpoint.schema_version)fail('RECOVERY_CHUNK_IDENTITY');return decoded;
}
export function validateCliCommand(command,manifest){
 if(!validateRecoveryCommand(command)||command.operation==='install')fail('RECOVERY_INPUT_REJECTED');
 try{assertRecoveryEnvelope(command,{current16Job:isCurrent16Manifest(manifest)});}catch{fail('RECOVERY_INPUT_REJECTED');}
 return command;
}
export function supportedControlManifest(manifest){if(manifest.format_version===2&&!isCurrent16Manifest(manifest))fail('RECOVERY_FORMAT_UNAVAILABLE');}
export function bindSessionManifest(session,manifest){
 const digest=hash(canonicalBytes(manifest));
 if(session.state.manifest_sha256!==null&&session.state.manifest_sha256!==digest)fail('RECOVERY_MANIFEST_MISMATCH');
 session.manifest=manifest;if(session.state.manifest_sha256===null){if(session.state.complete)fail('RECOVERY_STATE_IDENTITY_MISMATCH');session.state.manifest_sha256=digest;session.save();}
}
export function retainedControlLimit(command,manifest){return command==='resume'&&isCurrent16Manifest(manifest)?RESUME_ENVELOPE_LIMIT:CONTROL_LIMIT;}
async function readManifest(config){
 if(!config.integrity)fail('RECOVERY_INPUT_REJECTED');
 const manifest=await verifyCliManifest(parseJson(readEncryptedArtifact(manifestFile(config),config.encryption,artifactContext(config,'manifest'),CONTROL_LIMIT)),config.integrity);
 if(manifest.workspace_id!==config.workspaceId||manifest.capture_id!==config.captureId)fail('RECOVERY_MANIFEST_MISMATCH');
 return manifest;
}
function localChunk(config,manifest,index){
 const reference=manifest.database.chunks[index];
 if(!reference||reference.index!==index)fail('RECOVERY_CHUNK_MISMATCH');
 const bytes=readEncryptedArtifact(chunkFile(config,index),config.encryption,artifactContext(config,'chunk',{index}),CHUNK_LIMIT);
 if(bytes.length!==reference.byte_size||hash(bytes)!==reference.sha256)fail('RECOVERY_CHUNK_MISMATCH');
 decodeCliChunk(bytes,manifest,{capture_id:config.captureId,index,table:reference.table,row_count:reference.row_count,byte_size:reference.byte_size});
 return bytes;
}
/** Pure local verification; never contacts an operator or creates an authority claim. */
export async function verifyCapture(config,lease=null){
 lease?.check();const manifest=await readManifest(config);lease?.check();
 if(['capture','verify','retire'].includes(config.command)&&(manifest.environment_id!==config.environmentId||manifest.checkpoint.authority_epoch!==config.expectedEpoch||manifest.release.catalog_mapping.object_name!==config.objectName))fail('RECOVERY_MANIFEST_MISMATCH');
 const digest=crypto.createHash('sha256'),counts=Object.fromEntries((manifest.format_version===2?registryForSchema(manifest.checkpoint.schema_version):TABLE_REGISTRY).map(table=>[table.name,0]));let bytes=0;
 for(const reference of manifest.database.chunks){
  const chunk=localChunk(config,manifest,reference.index),decoded=decodeCliChunk(chunk,manifest);digest.update(chunk);bytes+=chunk.length;counts[decoded.table]+=decoded.rows.length;
 }
 const sha256=digest.digest('hex');
 if(sha256!==manifest.database.sha256||bytes!==manifest.database.byte_size||!same(counts,manifest.database.table_counts))fail('RECOVERY_DATABASE_MISMATCH');
 return {manifest,metadata:{manifest_sha256:hash(canonicalBytes(manifest)),database_sha256:sha256,byte_size:bytes,chunk_count:manifest.database.chunks.length,table_counts:counts}};
}
async function ledgerFor(config,minimumEpoch){
 const selected=config.raw.current_ledger;if(!selected||!config.integrity)fail('RECOVERY_INPUT_REJECTED');
 const value=readProtectedJson(selected.path,CONTROL_LIMIT);
 return verifyCurrentLedger(value,{authorityEpoch:selected.authority_epoch,sha256:selected.sha256},{workspaceId:config.workspaceId,objectName:config.objectName,environmentId:config.environmentId,integrity:config.integrity},minimumEpoch);
}
class Session{
 constructor(config,transport,lease=null){
  this.lease=lease;
  this.config=config;this.transport=transport;this.requests=0;this.manifest=null;this.targetEpoch=null;this.fileHash=null;
  if(fs.existsSync(config.statePath)){
   this.state=parseJson(readEncryptedArtifact(config.statePath,config.encryption,stateContext(config),1048576));this.fileHash=fileSha256(config.statePath);
   const keys=['format_version','command','identity','sequence','expected_epoch','pending','reconciliation','progress','terminal_response','last_response','manifest_sha256','evidence','complete','zero_retry_used','control_result','pending_finish'];
   if(!closed(this.state,keys)||this.state.format_version!==1||this.state.command!==config.command||this.state.identity!==config.identity||!Number.isSafeInteger(this.state.sequence)||this.state.sequence<0||!Number.isSafeInteger(this.state.expected_epoch)||this.state.expected_epoch<0||typeof this.state.complete!=='boolean'||typeof this.state.zero_retry_used!=='boolean')fail('RECOVERY_STATE_IDENTITY_MISMATCH');
   for(const name of ['pending','reconciliation'])if(this.state[name]!==null){
    const pending=this.state[name];if(!closed(pending,['command','binary_index','attempt'])||!validateRecoveryCommand(pending.command)||pending.command.operation==='install'||pending.command.workspace_id!==config.workspaceId||pending.command.capture_id!==config.captureId||!Number.isSafeInteger(pending.attempt)||pending.attempt<0||!(pending.binary_index===null||Number.isInteger(pending.binary_index)&&pending.binary_index>=0&&pending.binary_index<256))fail('RECOVERY_STATE_IDENTITY_MISMATCH');
    try{assertRecoveryEnvelope(pending.command,{provisional:true});}catch{fail('RECOVERY_STATE_IDENTITY_MISMATCH');}
   }
   if(this.state.progress!==null&&!validateRecoveryJobProgress(this.state.progress))fail('RECOVERY_STATE_IDENTITY_MISMATCH');
  }else{
   this.state={format_version:1,command:config.command,identity:config.identity,sequence:0,expected_epoch:config.expectedEpoch,pending:null,reconciliation:null,progress:null,terminal_response:null,last_response:null,manifest_sha256:null,evidence:null,complete:false,zero_retry_used:false,control_result:null,pending_finish:null};this.save();
  }
 }
 save(){this.lease?.check();this.fileHash=replaceEncryptedState(this.config.statePath,this.state,this.config.encryption,stateContext(this.config),this.fileHash);}
 makeId(operation,slot){
  if(slot==='reconciliation')return 'op_'+hash(canonicalBytes([this.config.rootOperationId,'restore-init-status',this.state.pending?.command.operation_id])).slice(0,56);
  return this.state.sequence===0?this.config.rootOperationId:'op_'+hash(canonicalBytes([this.config.rootOperationId,this.state.sequence,operation,this.config.captureId])).slice(0,56);
 }
 command(operation,payload,epoch,slot){
  const value={operation,workspace_id:this.config.workspaceId,capture_id:operation==='probe'?null:this.config.captureId,expected_authority_epoch:epoch,operation_id:this.makeId(operation,slot),reason:this.config.reason,payload};
  return validateCliCommand(value,this.manifest);
 }
 async validate(command,result){
  if(!result||result.status!==200||!(result.raw instanceof Uint8Array)||result.raw.length>(command.operation==='read-chunk'?CHUNK_LIMIT:CONTROL_LIMIT)||result.sha256!==hash(result.raw))fail('RECOVERY_INVALID_RESPONSE');
  const config=this.config;
  if(command.operation==='read-chunk'){
   const reference=this.manifest?.database.chunks[command.payload.index],chunk=result.chunk;
   if(!reference||!chunk||!Buffer.from(chunk.bytes).equals(Buffer.from(result.raw))||chunk.metadata.capture_id!==config.captureId||chunk.metadata.index!==reference.index||chunk.metadata.sha256!==reference.sha256||chunk.metadata.byte_size!==reference.byte_size||result.raw.length!==reference.byte_size)fail('RECOVERY_CHUNK_MISMATCH');
   decodeCliChunk(result.raw,this.manifest,{capture_id:config.captureId,index:reference.index,table:reference.table,row_count:reference.row_count,byte_size:reference.byte_size});return;
  }
  const envelope=parseJson(result.raw);
  if(!closed(envelope,['request_id','data'])||!validRecoveryRequestId(result.requestId)||envelope.request_id!==result.requestId||!same(envelope.data,result.data))fail('RECOVERY_INVALID_RESPONSE');
  const data=result.data;
  if(['capture','restore','write-chunk','verify','status'].includes(command.operation)){
   const kind=command.operation==='capture'?'capture':command.operation==='status'?(command.payload.job_id===recoveryJobId(config.workspaceId,config.captureId,'capture')?'capture':'restore'):'restore';
   const epoch=command.operation==='restore'?this.targetEpoch:command.expected_authority_epoch;
   if(!validateRecoveryJobProgress(data)||data.workspace_id!==config.workspaceId||data.capture_id!==config.captureId||data.job_id!==recoveryJobId(config.workspaceId,config.captureId,kind)||data.operation!==kind||data.authority_epoch!==epoch)fail('RECOVERY_INVALID_RESPONSE');
   if(this.state.progress&&(data.step<this.state.progress.step||data.counts.rows<this.state.progress.counts.rows||data.counts.chunks<this.state.progress.counts.chunks||data.counts.bytes<this.state.progress.counts.bytes))fail('RECOVERY_PROGRESS_REGRESSION');
   if(this.state.progress&&this.state.progress.state!=='running'&&data.state!==this.state.progress.state)fail('RECOVERY_PROGRESS_REGRESSION');
   if(data.receipt&&(data.receipt.workspace_id!==config.workspaceId||data.receipt.capture_id!==config.captureId))fail('RECOVERY_INVALID_RESPONSE');
   if(kind==='restore'){
    if(this.manifest){if(isCurrent16Manifest(this.manifest)?data.manifest!==null:!data.manifest||!same(data.manifest,this.manifest))fail('RECOVERY_MANIFEST_MISMATCH');}
    else if(config.command!=='status')fail('RECOVERY_MANIFEST_MISMATCH');
   }
   if(kind==='capture'&&data.state==='complete'&&!data.manifest)fail('RECOVERY_MANIFEST_MISMATCH');
   return;
  }
  if(command.operation==='probe'){
   if(!validateProbeReceipt(data)||data.workspace_id!==config.workspaceId||data.config_epoch!==command.expected_authority_epoch)fail('RECOVERY_INVALID_RESPONSE');return;
  }
  if(command.operation==='retire'){
   if(!validateRetirementReceipt(data)||data.workspace_id!==config.workspaceId||data.capture_id!==config.captureId||data.environment_id!==config.environmentId||data.authority_epoch!==command.expected_authority_epoch)fail('RECOVERY_INVALID_RESPONSE');
   await verifyRetirement(data,config.integrity);return;
  }
  if(command.operation==='resume'){
   if(!validateResumeReceipt(data)||data.workspace_id!==config.workspaceId||data.capture_id!==config.captureId||data.authority_epoch!==command.expected_authority_epoch)fail('RECOVERY_INVALID_RESPONSE');return;
  }
  if(command.operation==='resolve-delivery'){
   if(!validateRecoveryReceipt(data)||data.workspace_id!==config.workspaceId||data.capture_id!==config.captureId)fail('RECOVERY_INVALID_RESPONSE');return;
  }
  fail('RECOVERY_INVALID_RESPONSE');
 }
 async call(operation,payload,{epoch=this.state.expected_epoch,binaryIndex=null,slot='pending'}={}){
  if(this.requests>=this.config.maxRequests)fail('RECOVERY_BUDGET_PAUSED');
  assertOperationCapacity(this.state.sequence,this.state[slot]?.attempt??0);
  this.lease?.admit('dispatch');
  if(this.state[slot]===null){this.state[slot]={command:this.command(operation,payload,epoch,slot),binary_index:binaryIndex,attempt:0};this.save();}
  const pending=this.state[slot],command=pending.command;validateCliCommand(command,this.manifest);
  if(command.operation!==operation||command.expected_authority_epoch!==epoch||!same(command.payload,payload)||pending.binary_index!==binaryIndex)fail('RECOVERY_PENDING_INTENT_CONFLICT');
  let binary;
  if(binaryIndex!==null){if(!this.manifest)fail('RECOVERY_MANIFEST_MISMATCH');binary=localChunk(this.config,this.manifest,binaryIndex);}
  if(pending.attempt>=64)fail('RECOVERY_RETENTION_LIMIT');
  pending.attempt++;this.save();
  writeEncryptedArtifact(path.join(this.config.artifactDirectory,command.operation_id+'.request.enc'),canonicalBytes(command),this.config.encryption,artifactContext(this.config,'request',{origin:this.config.origin,environment_id:this.config.environmentId,operation_id:command.operation_id}));
  this.requests++;
  let result;
  try{result=await this.transport(command,binary);await this.validate(command,result);}
  catch(error){
   if(error?.code==='RECOVERY_NETWORK_ERROR'||error?.code==='RECOVERY_INVALID_RESPONSE'||error?.code==='RECOVERY_RESPONSE_LIMIT'||error?.message==='RECOVERY_INVALID_RESPONSE')fail('RECOVERY_OUTCOME_UNCERTAIN');
   throw error;
  }
  this.lease?.check();
  const relative=command.operation_id+'-a'+pending.attempt+'.response.enc';
  writeEncryptedArtifact(path.join(this.config.artifactDirectory,relative),result.raw,this.config.encryption,responseContext(this.config,command.operation_id,pending.attempt));
  this.state.last_response={request_id:result.requestId,command_sha256:hash(canonicalBytes(command)),response_sha256:hash(result.raw),response_operation_id:command.operation_id,response_attempt:pending.attempt,response_file:relative};
  if(['probe','retire','resume','resolve-delivery'].includes(command.operation)){
   this.state.control_result={operation:command.operation,response:this.state.last_response};
   this.state.terminal_response=this.state.last_response;
  }
  if(result.data&&validateRecoveryJobProgress(result.data)){
   this.state.progress=result.data;
   if(command.operation==='restore')this.state.expected_epoch=result.data.authority_epoch;
   if(result.data.state==='complete'||result.data.state==='failed')this.state.terminal_response=this.state.last_response;
  }
  this.state[slot]=null;if(slot==='pending')this.state.sequence++;this.save();return result;
 }
 async reconcileRestore(){
  const original=this.state.pending;
  if(!original||original.command.operation!=='restore'||original.attempt===0||original.command.expected_authority_epoch!==0)return;
  const id=recoveryJobId(this.config.workspaceId,this.config.captureId,'restore');
  let result;
  try{result=await this.call('status',{job_id:id},{epoch:this.targetEpoch,slot:'reconciliation'});}
  catch(error){
   if(!(error instanceof RecoveryTransportError)||error.status!==409||error.serverCode!=='CONFLICT'||error.canonicalError!==true)throw error;
   if(this.state.zero_retry_used)fail('RECOVERY_INIT_RECONCILIATION_REQUIRED');
   // A conflict is not proof of emptiness. One exact original attempt is safe only because
   // the current gateway epoch CAS and transactional empty-target checks still guard it.
   this.state.zero_retry_used=true;this.state.reconciliation=null;this.save();
   return this.call('restore',original.command.payload,{epoch:0});
  }
  if(result.data.authority_epoch!==this.targetEpoch||result.data.job_id!==id)fail('RECOVERY_INVALID_RESPONSE');
  this.state.expected_epoch=this.targetEpoch;this.state.pending=null;this.state.sequence++;this.save();
 }
 async acknowledgedControl(){
  this.lease?.check();
  const retained=this.state.control_result,config=this.config;
  if(!closed(retained,['operation','response'])||retained.operation!==config.command||!['probe','retire','resume','resolve-delivery'].includes(retained.operation))fail('RECOVERY_STATE_IDENTITY_MISMATCH');
  const metadata=retained.response;
  if(!metadata||!isSlug(metadata.response_operation_id)||!Number.isSafeInteger(metadata.response_attempt)||metadata.response_attempt<1||metadata.response_file!==metadata.response_operation_id+'-a'+metadata.response_attempt+'.response.enc')fail('RECOVERY_STATE_IDENTITY_MISMATCH');
  const commandBytes=readEncryptedArtifact(path.join(config.artifactDirectory,metadata.response_operation_id+'.request.enc'),config.encryption,artifactContext(config,'request',{origin:config.origin,environment_id:config.environmentId,operation_id:metadata.response_operation_id}),retainedControlLimit(config.command,this.manifest));
  const command=parseJson(commandBytes);validateCliCommand(command,this.manifest);
  if(!validateRecoveryCommand(command)||command.operation!==config.command||command.operation_id!==metadata.response_operation_id||command.workspace_id!==config.workspaceId||command.capture_id!==config.captureId||command.expected_authority_epoch!==this.state.expected_epoch||hash(commandBytes)!==metadata.command_sha256||!Buffer.from(canonicalBytes(command)).equals(commandBytes))fail('RECOVERY_STATE_IDENTITY_MISMATCH');
  const raw=readEncryptedArtifact(path.join(config.artifactDirectory,metadata.response_file),config.encryption,responseContext(config,metadata.response_operation_id,metadata.response_attempt),CONTROL_LIMIT),envelope=parseJson(raw);
  if(hash(raw)!==metadata.response_sha256)fail('RECOVERY_ARTIFACT_REJECTED');
  await this.validate(command,{status:200,requestId:metadata.request_id,data:envelope.data,raw,sha256:metadata.response_sha256});
  this.state.terminal_response=metadata;return envelope.data;
 }
 publishFinish(){
  this.lease?.admit('finish');
  const pending=this.state.pending_finish,config=this.config;
  if(!closed(pending,['result','sequence'])||pending.sequence!==this.state.sequence||!pending.result||pending.result.format_version!==1||pending.result.operation!==config.command||pending.result.origin!==config.origin||pending.result.environment_id!==config.environmentId||pending.result.workspace_id!==config.workspaceId||pending.result.capture_id!==config.captureId)fail('RECOVERY_STATE_IDENTITY_MISMATCH');
  const result=pending.result,name=config.command+'-'+config.rootOperationId+'-s'+pending.sequence+'.receipt.enc';
  writeEncryptedArtifact(path.join(config.artifactDirectory,name),canonicalBytes(result),config.encryption,artifactContext(config,'receipt',{operation:config.command,operation_id:config.rootOperationId,sequence:pending.sequence,origin:config.origin,environment_id:config.environmentId}));
  this.state.evidence=result;this.state.complete=config.command!=='status';this.state.pending_finish=null;this.state.control_result=null;this.save();return result;
 }
 finish(receipt,{manifest=null,localVerification=null,status=false,outcome=null}={}){
  if(this.state.pending_finish!==null)return this.publishFinish();
  this.lease?.admit('finish');
  const response=this.state.terminal_response??this.state.last_response,job=this.state.progress;
  const failed=receipt?.status==='failed'||Array.isArray(receipt?.checks)&&receipt.checks.some(check=>check.passed!==true);
  const result={format_version:1,operation:this.config.command,origin:this.config.origin,environment_id:this.config.environmentId,workspace_id:this.config.workspaceId,capture_id:this.config.captureId,job_id:job?.job_id??null,outcome:outcome??(failed?'failed':status?job.state:'complete'),request_id:response?.request_id??null,completed_at:new Date().toISOString(),command_sha256:response?.command_sha256??null,response_sha256:response?.response_sha256??null,response_operation_id:response?.response_operation_id??null,response_attempt:response?.response_attempt??null,response_file:response?.response_file??null,manifest_sha256:manifest?hash(canonicalBytes(manifest)):this.state.manifest_sha256,receipt:receipt??null,local_verification:localVerification,progress:status?{state:job.state,phase:job.phase,step:job.step,counts:job.counts,pending_operation_id:job.pending_operation_id,next_operation:job.next_operation,next_chunk_index:job.next_chunk_index}:null};
  this.state.pending_finish={result,sequence:this.state.sequence};this.save();return this.publishFinish();
 }
}

function terminalFailure(session){
 const job=session.state.progress;
 return job?.state==='failed'||job?.receipt?.status==='failed'||job?.receipt?.checks.some(check=>check.passed!==true);
}
async function capture(session){
 const config=session.config;
 if(session.state.complete){if(session.state.evidence?.outcome==='complete')await verifyCapture(config,session.lease);return session.state.evidence;}
 while(!session.state.progress||session.state.progress.state==='running'){
  await session.call('capture',{budget:config.raw.budget});
 }
 if(terminalFailure(session))return session.finish(session.state.progress.receipt,{outcome:'failed'});
 const manifest=await verifyCliManifest(session.state.progress.manifest,config.integrity);
 if(manifest.workspace_id!==config.workspaceId||manifest.capture_id!==config.captureId||manifest.environment_id!==config.environmentId||manifest.checkpoint.authority_epoch!==config.expectedEpoch||manifest.release.catalog_mapping.object_name!==config.objectName)fail('RECOVERY_MANIFEST_MISMATCH');
 const digest=hash(canonicalBytes(manifest));
 if(session.state.manifest_sha256&&session.state.manifest_sha256!==digest)fail('RECOVERY_MANIFEST_MISMATCH');
 session.manifest=manifest;if(session.state.manifest_sha256===null){if(session.state.complete)fail('RECOVERY_STATE_IDENTITY_MISMATCH');session.state.manifest_sha256=digest;session.save();}
 session.lease?.check();writeEncryptedArtifact(manifestFile(config),canonicalBytes(manifest),config.encryption,artifactContext(config,'manifest'));
 for(const reference of manifest.database.chunks){
  const local=chunkFile(config,reference.index);
  if(fs.existsSync(local)){localChunk(config,manifest,reference.index);continue;}
  const result=await session.call('read-chunk',{index:reference.index});
  session.lease?.check();writeEncryptedArtifact(local,result.chunk.bytes,config.encryption,artifactContext(config,'chunk',{index:reference.index}));
 }
 const verified=await verifyCapture(config,session.lease);
 return session.finish(session.state.progress.receipt,{manifest,localVerification:verified.metadata});
}
async function restore(session){
 const config=session.config,verified=await verifyCapture(config,session.lease),manifest=verified.manifest;
 supportedControlManifest(manifest);
 if(manifest.environment_id===config.environmentId)fail('RECOVERY_TARGET_NOT_ISOLATED');
 const selected=await ledgerFor(config,manifest.checkpoint.authority_epoch);
 bindSessionManifest(session,manifest);session.targetEpoch=selected.ledger.authority_epoch;
 if(session.state.complete)return session.state.evidence;
 await session.reconcileRestore();
 if(!session.state.progress)await session.call('restore',{manifest,ledger:selected.ledger});
 if(session.state.expected_epoch!==session.targetEpoch)fail('RECOVERY_EPOCH_MISMATCH');
 while(session.state.progress.state==='running'){
  const progress=session.state.progress;
  if(progress.next_operation==='write-chunk'){
   const index=progress.next_chunk_index,reference=manifest.database.chunks[index];
   if(!Number.isInteger(index)||!reference||reference.index!==index)fail('RECOVERY_INVALID_RESPONSE');
   await session.call('write-chunk',{index,sha256:reference.sha256,byte_size:reference.byte_size},{binaryIndex:index});
  }else if(progress.next_operation==='verify')await session.call('verify',{manifest});
  else fail('RECOVERY_INVALID_RESPONSE');
 }
 return session.finish(session.state.progress.receipt,{manifest,localVerification:verified.metadata,outcome:terminalFailure(session)?'failed':'complete'});
}
async function resumePayload(config,manifest,lease){
 const selected=await ledgerFor(config);
 if(selected.ledger.authority_epoch!==config.expectedEpoch)fail('RECOVERY_EPOCH_MISMATCH');
 let retirement=null,cutover=null;
 const values=config.raw.resume;
 if(values.source_retirement_path!==null){
  lease?.check();
  retirement=await verifyRetirement(parseJson(readEncryptedArtifact(values.source_retirement_path,config.encryption,artifactContext(config,'retirement'),CONTROL_LIMIT,false)),config.integrity);
  cutover=await verifyCutover(readProtectedJson(values.cutover_path,CONTROL_LIMIT),config.integrity);
  if(retirement.capture_id!==config.captureId||retirement.workspace_id!==config.workspaceId||retirement.environment_id!==manifest.environment_id||retirement.authority_epoch!==manifest.checkpoint.authority_epoch||cutover.capture_id!==config.captureId||cutover.workspace_id!==config.workspaceId||cutover.source_environment_id!==retirement.environment_id||cutover.source_authority_epoch!==retirement.authority_epoch||cutover.target_environment_id!==config.environmentId||cutover.target_authority_epoch!==config.expectedEpoch||cutover.source_retirement_receipt_id!==retirement.id||cutover.target_catalog_mapping.workspace_id!==config.workspaceId||cutover.target_catalog_mapping.object_name!==config.objectName)fail('RECOVERY_CUTOVER_MISMATCH');
 }else if(manifest.environment_id!==config.environmentId||manifest.checkpoint.authority_epoch!==config.expectedEpoch||manifest.release.catalog_mapping.object_name!==config.objectName)fail('RECOVERY_RETIREMENT_REQUIRED');
 return {receipt_id:values.receipt_id,ledger:selected.ledger,source_retirement_receipt:retirement,cutover_record:cutover};
}
async function control(session){
 const config=session.config;
 if(session.state.complete&&config.command!=='status')return session.state.evidence;
 if(session.state.control_result!==null){
  if(config.command==='retire'||config.command==='resume'){session.manifest=(await verifyCapture(config,session.lease)).manifest;supportedControlManifest(session.manifest);if(hash(canonicalBytes(session.manifest))!==session.state.manifest_sha256)fail('RECOVERY_MANIFEST_MISMATCH');}
  const data=await session.acknowledgedControl();
  if(config.command==='retire')session.lease?.check();
 if(config.command==='retire')writeEncryptedArtifact(path.join(config.artifactDirectory,'retirement.enc'),canonicalBytes(data),config.encryption,artifactContext(config,'retirement'));
  return session.finish(data);
 }
 let payload={},manifest=null;
 if(config.command==='status')payload={job_id:recoveryJobId(config.workspaceId,config.captureId,config.raw.job_kind)};
 if(config.command==='resolve-delivery'){
  const value=config.raw.resolution,evidence=readProtectedBytes(value.evidence_path,1048576);
  if(hash(evidence)!==value.evidence_sha256)fail('RECOVERY_EVIDENCE_MISMATCH');
  payload={delivery_id:value.delivery_id,disposition:value.disposition,evidence_sha256:value.evidence_sha256};
 }
 if(config.command==='retire'||config.command==='resume'){
  const checked=await verifyCapture(config,session.lease);manifest=checked.manifest;supportedControlManifest(manifest);bindSessionManifest(session,manifest);
  if(config.command==='resume')payload=await resumePayload(config,manifest,session.lease);
 }
 const result=await session.call(config.command,payload);
 if(config.command==='retire')session.lease?.check();
 if(config.command==='retire')writeEncryptedArtifact(path.join(config.artifactDirectory,'retirement.enc'),canonicalBytes(result.data),config.encryption,artifactContext(config,'retirement'));
 // Status has no integrity key requirement: a remote manifest is not locally authenticated.
 if(config.command==='status')return session.finish(result.data.receipt,{manifest:session.manifest,status:true});
 return session.finish(result.data,{manifest});
}
/** Eight public commands; read/write chunks and verify pages are private finite continuations. */
export async function runRecovery(command,inputPath,{transport}={}){
 const config=loadRecoveryConfig(command,inputPath);
 const lease=acquireRecoveryLease(config);
 try{
 if(!fs.existsSync(config.statePath))lease.admit('finish');
 const session=new Session(config,command==='verify'?null:transport??createRecoveryTransport({origin:config.origin,service:config.service}),lease);
 if(session.state.pending_finish!==null)return session.publishFinish();
 if(command==='verify'){
  const checked=await verifyCapture(config,session.lease);
  if(session.state.complete)return session.state.evidence;
  return session.finish(null,{manifest:checked.manifest,localVerification:checked.metadata,outcome:'verified_local'});
 }
 if(command==='capture')return await capture(session);
 if(command==='restore')return await restore(session);
 return await control(session);
 }finally{lease.release();}
}

// Named seams for deterministic validation tests; constructing a session still enforces protected I/O.
export {Session as RecoverySession};
