import {prepareBootstrap,type ValidatedBootstrap} from '../config/bootstrap.ts';
import {resolveWorkspace} from '../config/deployment.ts';
import {canonicalBytes,digestBytes,fromBase64,hex,CONTROL_LIMIT,CHUNK_LIMIT,CHUNK_COUNT} from './encoding.ts';
import {TABLE_REGISTRY} from './table-registry-v1.ts';
import {registryForSchema} from './table-registry.ts';
import {validateRecoveryManifest,validateCurrentLedger,validateRetirementReceipt,validateCutoverRecord,type RecoveryManifest,type CurrentLedger,type RetirementReceipt,type CutoverRecord} from './generated/recovery-validators.js';
import type {RecoveryIntegrity,RecoveryWorkspace,LedgerAnchor} from './protocol';
interface Authenticated {auth:{key_id:string;algorithm:'HMAC-SHA256';tag:string};}
async function integrityKey(integrity:RecoveryIntegrity,uses:Array<'sign'|'verify'>):Promise<CryptoKey>{const bytes=fromBase64(integrity.key);if(bytes.length<32||bytes.length>128)throw Error('RECOVERY_KEY_UNAVAILABLE');return crypto.subtle.importKey('raw',bytes.buffer,{name:'HMAC',hash:'SHA-256'},false,uses);}
export function integrityPreimage(value:Authenticated):Uint8Array<ArrayBuffer>{const {tag,...auth}=value.auth;return canonicalBytes({...value,auth});}
export async function signRecord<T extends Authenticated>(value:T,integrity:RecoveryIntegrity,guard:()=>unknown=()=>{}):Promise<T>{
 if(value.auth.key_id!==integrity.keyId||value.auth.algorithm!=='HMAC-SHA256')throw Error('RECOVERY_KEY_MISMATCH');
 guard();const key=await integrityKey(integrity,['sign']);guard();const tag=hex(await crypto.subtle.sign('HMAC',key,integrityPreimage(value).buffer));guard();return {...value,auth:{...value.auth,tag}};
}
export async function signRecordAsync<T extends Authenticated>(input:T,integrity:RecoveryIntegrity,guard:()=>Promise<void>):Promise<T>{
 const value=structuredClone(input);
 if(value.auth.key_id!==integrity.keyId||value.auth.algorithm!=='HMAC-SHA256')throw Error('RECOVERY_KEY_MISMATCH');
 if(canonicalBytes(value).length>CONTROL_LIMIT)throw Error('RECOVERY_RESULT_LIMIT');
 await guard();const key=await integrityKey(integrity,['sign']);await guard();
 const tag=hex(await crypto.subtle.sign('HMAC',key,integrityPreimage(value).buffer));await guard();return {...value,auth:{...value.auth,tag}};
}
export async function verifyRecord(input:Authenticated,integrity:RecoveryIntegrity,guard?:()=>Promise<void>):Promise<void>{
 const value=guard?structuredClone(input):input;
 if(value.auth.key_id!==integrity.keyId||value.auth.algorithm!=='HMAC-SHA256'||!/^[a-f0-9]{64}$/.test(value.auth.tag))throw Error('RECOVERY_AUTH_MISMATCH');
 if(guard){if(canonicalBytes(value).length>CONTROL_LIMIT)throw Error('RECOVERY_RESULT_LIMIT');await guard();}
 const key=await integrityKey(integrity,['verify']);if(guard)await guard();
 const tag=Uint8Array.from(value.auth.tag.match(/../g)!,s=>parseInt(s,16));
 const verified=await crypto.subtle.verify('HMAC',key,tag.buffer,integrityPreimage(value).buffer);if(guard)await guard();
 if(!verified)throw Error('RECOVERY_AUTH_MISMATCH');
}
export function validateManifestShape(value:unknown):asserts value is RecoveryManifest {
 if(!validateRecoveryManifest(value)||canonicalBytes(value).length>CONTROL_LIMIT)throw Error('INVALID_RECOVERY_MANIFEST');
 const m=value,current=m.format_version===2&&m.checkpoint.contract_revision==='0.2';if((current?m.checkpoint.schema_version!==15&&m.checkpoint.schema_version!==16&&m.checkpoint.schema_version!==17:m.checkpoint.schema_version!==7||m.checkpoint.contract_revision!=='0.1')||m.release.catalog_mapping.workspace_id!==m.workspace_id||Date.parse(m.started_at)>Date.parse(m.ended_at)||(m.format_version===1&&(m.artifacts.length>0||m.unfinished_artifact_ids.length>0)))throw Error('RECOVERY_MANIFEST_MISMATCH');
 if(m.format_version===2){
  const ids=new Set<string>(),objects=new Set<string>(),recovery=new Set<string>(),generations=new Set<string>();let artifactBytes=0;
  for(const entry of m.artifacts){
   const generation=current&&'generation_id'in entry?entry.generation_id+'/':'';
   if(current&&generations.has(generation))throw Error('RECOVERY_ARTIFACT_IDENTITY_MISMATCH');generations.add(generation);
   if(ids.has(entry.artifact_id)||objects.has(entry.object_key)||recovery.has(entry.recovery_object_key)||entry.object_key!==`artifacts/${m.workspace_id}/${entry.artifact_id}/${generation}${entry.sha256}`||entry.recovery_object_key!==`r2/${m.workspace_id}/${m.capture_id}/artifacts/${entry.artifact_id}/${generation}${entry.sha256}`)throw Error('RECOVERY_ARTIFACT_IDENTITY_MISMATCH');
   ids.add(entry.artifact_id);objects.add(entry.object_key);recovery.add(entry.recovery_object_key);artifactBytes+=entry.byte_size;
  }
  if(m.unfinished_artifact_ids.some(id=>ids.has(id)))throw Error('RECOVERY_ARTIFACT_IDENTITY_MISMATCH');
  if(m.database.byte_size+artifactBytes>268435456)throw Error('RECOVERY_TOTAL_BYTES_LIMIT');
 }
 const names:readonly string[]=(current?registryForSchema(m.checkpoint.schema_version as 15|16|17):TABLE_REGISTRY).map(t=>t.name);
 const counts=m.database.table_counts as Record<string,number>;if(Object.values(counts).reduce((a,b)=>a+b,0)>1000000)throw Error('RECOVERY_ROW_BUDGET_LIMIT');if(JSON.stringify(Object.keys(m.database.table_counts).sort())!==JSON.stringify([...names].sort()))throw Error('RECOVERY_MANIFEST_REGISTRY');
 const totals=new Map(names.map(name=>[name,0]));let totalBytes=0,last=-1;
 if(m.database.chunks.length>CHUNK_COUNT)throw Error('RECOVERY_CHUNK_LIMIT');
 m.database.chunks.forEach((entry,i)=>{const index=names.indexOf(entry.table);if(entry.index!==i||index<last||index<0||entry.row_count<1||entry.row_count>200||entry.byte_size<1||entry.byte_size>CHUNK_LIMIT)throw Error('RECOVERY_MANIFEST_CHUNKS');last=index;totalBytes+=entry.byte_size;totals.set(entry.table,totals.get(entry.table)!+entry.row_count);});
 if(totalBytes!==m.database.byte_size||names.some(n=>totals.get(n)!==counts[n])||m.database.table_counts.schema_migrations!==(current?m.checkpoint.schema_version:7)||m.database.table_counts.workspace_metadata!==1||m.database.table_counts.maintenance_state!==1)throw Error('RECOVERY_MANIFEST_COUNTS');
}
export async function verifyManifest(value:unknown,integrity:RecoveryIntegrity):Promise<Extract<RecoveryManifest,{format_version:1}>>{validateManifestShape(value);if(value.format_version!==1)throw Error('RECOVERY_FORMAT_UNAVAILABLE');await verifyRecord(value,integrity);return structuredClone(value);}
export interface VerifiedLedger {ledger:CurrentLedger;input:ValidatedBootstrap;digest:string;}
export async function verifyCurrentLedger(incoming:unknown,anchor:LedgerAnchor|null,w:Pick<RecoveryWorkspace,'workspaceId'|'objectName'|'environmentId'|'integrity'>,minimumEpoch?:number,guard?:()=>Promise<void>):Promise<VerifiedLedger>{
 if(!validateCurrentLedger(incoming)||!anchor||canonicalBytes(incoming).length>CONTROL_LIMIT||incoming.workspace_id!==w.workspaceId||incoming.environment_id!==w.environmentId||incoming.authority_epoch!==anchor.authorityEpoch)throw Error('RECOVERY_LEDGER_MISMATCH');
 const value=guard?structuredClone(incoming):incoming;
 await verifyRecord(value,w.integrity,guard);if(guard)await guard();
 const digest=await digestBytes(canonicalBytes(value));if(guard)await guard();if(digest!==anchor.sha256)throw Error('RECOVERY_LEDGER_ANCHOR_CONFLICT');
 const input=await prepareBootstrap(value.config,value.verification_bundle,w.workspaceId,guard);if(guard)await guard();const mapping=resolveWorkspace(input.config,w.workspaceId);
 if(input.config.config_epoch!==value.authority_epoch||input.installationDigest!==value.installation_digest||mapping.objectName!==w.objectName||minimumEpoch!==undefined&&value.authority_epoch<=minimumEpoch)throw Error('RECOVERY_LEDGER_MISMATCH');
 const identities=new Set<string>();for(const prior of value.retired_authorities){if(!validateRetirementReceipt(prior)||prior.workspace_id!==w.workspaceId||prior.authority_epoch>=value.authority_epoch||identities.has(prior.id))throw Error('RECOVERY_LEDGER_HISTORY_MISMATCH');identities.add(prior.id);await verifyRecord(prior,w.integrity,guard);if(guard)await guard();}
 return {ledger:structuredClone(value),input,digest};
}
export async function verifyRetirement(incoming:unknown,integrity:RecoveryIntegrity,guard?:()=>Promise<void>):Promise<RetirementReceipt>{
 if(!validateRetirementReceipt(incoming)||guard&&canonicalBytes(incoming).length>CONTROL_LIMIT)throw Error('INVALID_RETIREMENT_RECEIPT');const value=guard?structuredClone(incoming):incoming;await verifyRecord(value,integrity,guard);if(guard)await guard();return structuredClone(value);
}
export async function verifyCutover(incoming:unknown,integrity:RecoveryIntegrity,guard?:()=>Promise<void>):Promise<CutoverRecord>{
 if(!validateCutoverRecord(incoming)||guard&&canonicalBytes(incoming).length>CONTROL_LIMIT)throw Error('INVALID_CUTOVER_RECORD');const value=guard?structuredClone(incoming):incoming;await verifyRecord(value,integrity,guard);if(guard)await guard();return structuredClone(value);
}
