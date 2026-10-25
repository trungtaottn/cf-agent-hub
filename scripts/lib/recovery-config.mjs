import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {approvedHttpsUrl} from '../../src/config/deployment.ts';
import {canonicalBytes,fromBase64,isSlug,closed} from '../../src/recovery/encoding.ts';
import {readProtectedJson,readSecretFd,ensureArtifactDirectory,outsideCheckout} from './recovery-io.mjs';
export const COMMANDS=['capture','restore','verify','probe','resolve-delivery','retire','resume','status'];
const fail=()=>{throw Error('RECOVERY_INPUT_REJECTED');};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const absolute=value=>{if(typeof value!=='string'||!path.isAbsolute(value)||path.resolve(value)!==value)fail();outsideCheckout(value);return value;};
function fields(value,required,optional=[]){if(!value||typeof value!=='object'||Array.isArray(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))fail();}
function key(reference,size){
 if(!closed(reference,['key_id','key_fd'])||!isSlug(reference.key_id))fail();
 const secret=readSecretFd(reference.key_fd);if(!closed(secret,['key'])||typeof secret.key!=='string')fail();
 const bytes=Buffer.from(fromBase64(secret.key));if(size?bytes.length!==size:bytes.length<32||bytes.length>128)fail();
 return {keyId:reference.key_id,key:bytes,base64:secret.key};
}
export function loadRecoveryConfig(command,inputPath){
 try{
  if(!COMMANDS.includes(command))fail();
  const input=path.resolve(inputPath);outsideCheckout(input);
  const raw=readProtectedJson(input,65536);
  const required=['format_version','origin','environment_id','workspace_id','object_name','allowed_workspace_ids','expected_authority_epoch','operation_id','capture_id','reason','encryption','state_path','artifact_directory'];
  const optional=['service','integrity','budget','current_ledger','resolution','resume','job_kind','max_requests'];
  fields(raw,required,optional);
  if(raw.format_version!==1||typeof raw.origin!=='string'||new URL(raw.origin).origin!==raw.origin||!approvedHttpsUrl(raw.origin+'/')||![raw.environment_id,raw.workspace_id,raw.object_name,raw.operation_id].every(isSlug)||!Number.isSafeInteger(raw.expected_authority_epoch)||raw.expected_authority_epoch<0||typeof raw.reason!=='string'||!raw.reason.length)fail();
  if(command==='probe'?raw.capture_id!==null:!isSlug(raw.capture_id))fail();
  if(!Array.isArray(raw.allowed_workspace_ids)||raw.allowed_workspace_ids.length<1||raw.allowed_workspace_ids.length>1000||raw.allowed_workspace_ids.some(id=>!isSlug(id))||new Set(raw.allowed_workspace_ids).size!==raw.allowed_workspace_ids.length||!raw.allowed_workspace_ids.includes(raw.workspace_id))fail();
  if(raw.max_requests!==undefined&&(!Number.isInteger(raw.max_requests)||raw.max_requests<1||raw.max_requests>2048))fail();
  const encryption=key(raw.encryption,32);let integrity=null,service=null;
  if(raw.integrity!==undefined){const value=key(raw.integrity);integrity={keyId:value.keyId,key:value.base64};if(value.key.length===encryption.key.length&&crypto.timingSafeEqual(value.key,encryption.key))fail();if(value.keyId===encryption.keyId)fail();}
  if(['capture','restore','verify','retire','resume'].includes(command)&&!integrity)fail();
  if(raw.service!==undefined){
   if(!closed(raw.service,['principal_id','credentials_fd'])||!isSlug(raw.service.principal_id))fail();
   service=readSecretFd(raw.service.credentials_fd);
   if(!closed(service,['client_id','client_secret'])||typeof service.client_id!=='string'||!service.client_id.length||service.client_id.length>2048||typeof service.client_secret!=='string'||!service.client_secret.length||service.client_secret.length>4096||/[\r\n]/.test(service.client_id+service.client_secret))fail();
  }
  if(command!=='verify'&&!service)fail();
  if(command==='capture'&&!raw.budget)fail();
  if(command==='status'&&!['capture','restore'].includes(raw.job_kind))fail();
  if(command==='resolve-delivery'){
   if(!closed(raw.resolution,['delivery_id','disposition','evidence_path','evidence_sha256'])||typeof raw.resolution.delivery_id!=='string'||!['confirmed_delivered','failed_without_redrive'].includes(raw.resolution.disposition)||!/^[a-f0-9]{64}$/.test(raw.resolution.evidence_sha256))fail();
   absolute(raw.resolution.evidence_path);
  }
  if(['restore','resume'].includes(command)){
   if(!closed(raw.current_ledger,['path','authority_epoch','sha256'])||!Number.isSafeInteger(raw.current_ledger.authority_epoch)||raw.current_ledger.authority_epoch<1||!/^[a-f0-9]{64}$/.test(raw.current_ledger.sha256))fail();
   absolute(raw.current_ledger.path);
  }
  if(command==='resume'){
   if(!closed(raw.resume,['receipt_id','source_retirement_path','cutover_path'])||!isSlug(raw.resume.receipt_id))fail();
   if((raw.resume.source_retirement_path===null)!==(raw.resume.cutover_path===null))fail();
   if(raw.resume.source_retirement_path!==null){absolute(raw.resume.source_retirement_path);absolute(raw.resume.cutover_path);}
  }
  const artifactDirectory=ensureArtifactDirectory(absolute(raw.artifact_directory),command==='capture');
  const statePath=absolute(raw.state_path);ensureArtifactDirectory(path.dirname(statePath));
  const outsideArtifacts=value=>{const relative=path.relative(artifactDirectory,value);if(relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)))fail();};
  outsideArtifacts(statePath);outsideArtifacts(input);
  if(raw.current_ledger)outsideArtifacts(raw.current_ledger.path);
  if(raw.resolution)outsideArtifacts(raw.resolution.evidence_path);
  if(raw.resume?.cutover_path!==null&&raw.resume?.cutover_path!==undefined)outsideArtifacts(raw.resume.cutover_path);
  const safe={...raw,service:raw.service?{principal_id:raw.service.principal_id,client_id_sha256:hash(service.client_id)}:null,integrity:raw.integrity?{key_id:raw.integrity.key_id}:null,encryption:{key_id:raw.encryption.key_id}};
  delete safe.max_requests;
  const identity=hash(canonicalBytes({command,config:safe}));
  return {command,raw,input,origin:raw.origin,environmentId:raw.environment_id,workspaceId:raw.workspace_id,objectName:raw.object_name,captureId:raw.capture_id,rootOperationId:raw.operation_id,expectedEpoch:raw.expected_authority_epoch,reason:raw.reason,identity,service,integrity,encryption,artifactDirectory,statePath,maxRequests:raw.max_requests??1024};
 }catch{fail();}
}
