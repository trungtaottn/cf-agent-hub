import {prepareBootstrap,type ValidatedBootstrap} from '../config/bootstrap.ts';
import {resolveWorkspace} from '../config/deployment.ts';
import {canonicalBytes,digestBytes,fromBase64,hex,CONTROL_LIMIT,CHUNK_LIMIT,CHUNK_COUNT} from './encoding.ts';
import {TABLE_REGISTRY,RECOVERY_SCHEMA_VERSION} from './table-registry.ts';
import {validateRecoveryManifest,validateCurrentLedger,validateRetirementReceipt,validateCutoverRecord,type RecoveryManifest,type CurrentLedger,type RetirementReceipt,type CutoverRecord} from './generated/recovery-validators.js';
import type {RecoveryIntegrity,RecoveryWorkspace,LedgerAnchor} from './protocol';
interface Authenticated {auth:{key_id:string;algorithm:'HMAC-SHA256';tag:string};}
async function integrityKey(integrity:RecoveryIntegrity,uses:Array<'sign'|'verify'>):Promise<CryptoKey>{const bytes=fromBase64(integrity.key);if(bytes.length<32||bytes.length>128)throw Error('RECOVERY_KEY_UNAVAILABLE');return crypto.subtle.importKey('raw',bytes.buffer,{name:'HMAC',hash:'SHA-256'},false,uses);}
export function integrityPreimage(value:Authenticated):Uint8Array<ArrayBuffer>{const {tag,...auth}=value.auth;return canonicalBytes({...value,auth});}
export async function signRecord<T extends Authenticated>(value:T,integrity:RecoveryIntegrity):Promise<T>{
 if(value.auth.key_id!==integrity.keyId||value.auth.algorithm!=='HMAC-SHA256')throw Error('RECOVERY_KEY_MISMATCH');
 const key=await integrityKey(integrity,['sign']),tag=hex(await crypto.subtle.sign('HMAC',key,integrityPreimage(value).buffer));return {...value,auth:{...value.auth,tag}};
}
export async function verifyRecord(value:Authenticated,integrity:RecoveryIntegrity):Promise<void>{
 if(value.auth.key_id!==integrity.keyId||value.auth.algorithm!=='HMAC-SHA256'||!/^[a-f0-9]{64}$/.test(value.auth.tag))throw Error('RECOVERY_AUTH_MISMATCH');
 const key=await integrityKey(integrity,['verify']),tag=Uint8Array.from(value.auth.tag.match(/../g)!,s=>parseInt(s,16));
 if(!await crypto.subtle.verify('HMAC',key,tag.buffer,integrityPreimage(value).buffer))throw Error('RECOVERY_AUTH_MISMATCH');
}
export function validateManifestShape(value:unknown):asserts value is RecoveryManifest {
 if(!validateRecoveryManifest(value)||canonicalBytes(value).length>CONTROL_LIMIT)throw Error('INVALID_RECOVERY_MANIFEST');
 const m=value;if(m.checkpoint.schema_version!==RECOVERY_SCHEMA_VERSION||m.checkpoint.contract_revision!=='0.1'||m.release.catalog_mapping.workspace_id!==m.workspace_id||Date.parse(m.started_at)>Date.parse(m.ended_at)||m.artifacts.length||m.unfinished_artifact_ids.length)throw Error('RECOVERY_MANIFEST_MISMATCH');
 const names=TABLE_REGISTRY.map(t=>t.name);if(JSON.stringify(Object.keys(m.database.table_counts).sort())!==JSON.stringify([...names].sort()))throw Error('RECOVERY_MANIFEST_REGISTRY');
 const totals=new Map(names.map(name=>[name,0]));let totalBytes=0,last=-1;
 if(m.database.chunks.length>CHUNK_COUNT)throw Error('RECOVERY_CHUNK_LIMIT');
 m.database.chunks.forEach((entry,i)=>{const index=names.indexOf(entry.table);if(entry.index!==i||index<last||index<0||entry.row_count<1||entry.row_count>200||entry.byte_size<1||entry.byte_size>CHUNK_LIMIT)throw Error('RECOVERY_MANIFEST_CHUNKS');last=index;totalBytes+=entry.byte_size;totals.set(entry.table,totals.get(entry.table)!+entry.row_count);});
 if(totalBytes!==m.database.byte_size||names.some(n=>totals.get(n)!==m.database.table_counts[n])||m.database.table_counts.schema_migrations!==RECOVERY_SCHEMA_VERSION||m.database.table_counts.workspace_metadata!==1||m.database.table_counts.maintenance_state!==1)throw Error('RECOVERY_MANIFEST_COUNTS');
}
export async function verifyManifest(value:unknown,integrity:RecoveryIntegrity):Promise<RecoveryManifest>{validateManifestShape(value);await verifyRecord(value,integrity);return structuredClone(value);}
export interface VerifiedLedger {ledger:CurrentLedger;input:ValidatedBootstrap;digest:string;}
export async function verifyCurrentLedger(value:unknown,anchor:LedgerAnchor|null,w:Pick<RecoveryWorkspace,'workspaceId'|'objectName'|'environmentId'|'integrity'>,minimumEpoch?:number):Promise<VerifiedLedger>{
 if(!validateCurrentLedger(value)||!anchor||canonicalBytes(value).length>CONTROL_LIMIT||value.workspace_id!==w.workspaceId||value.environment_id!==w.environmentId||value.authority_epoch!==anchor.authorityEpoch)throw Error('RECOVERY_LEDGER_MISMATCH');
 await verifyRecord(value,w.integrity);const digest=await digestBytes(canonicalBytes(value));if(digest!==anchor.sha256)throw Error('RECOVERY_LEDGER_ANCHOR_CONFLICT');
 const input=await prepareBootstrap(value.config,value.verification_bundle,w.workspaceId),mapping=resolveWorkspace(input.config,w.workspaceId);
 if(input.config.config_epoch!==value.authority_epoch||input.installationDigest!==value.installation_digest||mapping.objectName!==w.objectName||minimumEpoch!==undefined&&value.authority_epoch<=minimumEpoch)throw Error('RECOVERY_LEDGER_MISMATCH');
 const identities=new Set<string>();for(const prior of value.retired_authorities){if(!validateRetirementReceipt(prior)||prior.workspace_id!==w.workspaceId||prior.authority_epoch>=value.authority_epoch||identities.has(prior.id))throw Error('RECOVERY_LEDGER_HISTORY_MISMATCH');identities.add(prior.id);await verifyRecord(prior,w.integrity);}
 return {ledger:structuredClone(value),input,digest};
}
export async function verifyRetirement(value:unknown,integrity:RecoveryIntegrity):Promise<RetirementReceipt>{if(!validateRetirementReceipt(value))throw Error('INVALID_RETIREMENT_RECEIPT');await verifyRecord(value,integrity);return structuredClone(value);}
export async function verifyCutover(value:unknown,integrity:RecoveryIntegrity):Promise<CutoverRecord>{if(!validateCutoverRecord(value))throw Error('INVALID_CUTOVER_RECORD');await verifyRecord(value,integrity);return structuredClone(value);}
