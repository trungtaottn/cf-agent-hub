import {EXPECTED_SCHEMA_VERSIONS,hasR2AuthoritySchema} from '../storage/schema-version.ts';
import {maintenanceClosed,retainOpenMaintenance} from '../recovery/maintenance.ts';
import { parseDeployment, resolveWorkspace, type DeploymentConfig } from './deployment.ts';
import { validateBundle, type VerificationBundle } from './generated/validators.js';
import type { WorkspaceTransaction } from '../storage/transaction';
export interface ValidatedBootstrap {config:DeploymentConfig;bundle:VerificationBundle;workspaceId:string;installationDigest:string;}
export function canonicalJson(value:unknown):string {
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 const record=value as Record<string,unknown>;
 return '{'+Object.keys(record).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(record[k])).join(',')+'}';
}
export async function sha256(value:string,guard?:()=>Promise<void>):Promise<string> {
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 if(guard)await guard();
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export function validateRetirement(config:DeploymentConfig,tombstone:{workspace_id:string;agent_id:string;retired_at_epoch:number}):void {
 if(!config.workspace_catalog.some(x=>x.workspace_id===tombstone.workspace_id)||
  !config.static_participants.some(x=>x.workspace_id===tombstone.workspace_id&&x.agent_id===tombstone.agent_id)||
  tombstone.retired_at_epoch>config.config_epoch)throw Error('INVALID_RETIREMENT');
}
export async function prepareBootstrap(configInput:unknown,bundleInput:unknown,workspaceId:string,guard?:()=>Promise<void>):Promise<ValidatedBootstrap> {
 const config=parseDeployment(configInput);
 if(!validateBundle(bundleInput))throw Error('INVALID_BUNDLE');
 const bundle=structuredClone(bundleInput);resolveWorkspace(config,workspaceId);
 if(bundle.config_epoch!==config.config_epoch||bundle.config_digest!==await sha256(canonicalJson(config),guard))throw Error('CONFIG_DIGEST_MISMATCH');
 for(const tombstone of bundle.retired_credentials)validateRetirement(config,tombstone);
 const order=(a:{workspace_id:string;credential_id:string},b:{workspace_id:string;credential_id:string})=>
  a.workspace_id<b.workspace_id?-1:a.workspace_id>b.workspace_id?1:a.credential_id<b.credential_id?-1:a.credential_id>b.credential_id?1:0;
 return {config,bundle,workspaceId,installationDigest:await sha256(canonicalJson({config,credentials:[...bundle.credentials].sort(order),retired_credentials:[...bundle.retired_credentials].sort(order)}),guard)};

}
/** Shared install/restore continuity rules; no authority source rows are enumerated here. */
export function assertPrincipalContinuity(prior:{issuer:string;subject:string},next:{issuer:string;subject:string}):void {
 if(prior.issuer!==next.issuer||prior.subject!==next.subject)throw Error('PRINCIPAL_IMMUTABLE');
}
export function assertCredentialContinuity(config:DeploymentConfig,workspaceId:string,credential:Credential,ref:DeploymentConfig['static_credential_refs'][number]|undefined,hash:VerificationBundle['credentials'][number]|undefined,tombstone:VerificationBundle['retired_credentials'][number]|undefined):void {
 if(credential.retired_at_epoch!==null)validateRetirement(config,{...credential,workspace_id:workspaceId,retired_at_epoch:credential.retired_at_epoch});
 if(ref){
  if(credential.retired_at_epoch!==null||ref.agent_id!==credential.agent_id||hash?.token_sha256!==credential.token_sha256)throw Error('CREDENTIAL_IMMUTABLE');
 }else if(!tombstone||tombstone.agent_id!==credential.agent_id||tombstone.token_sha256!==credential.token_sha256||(credential.retired_at_epoch!==null?tombstone.retired_at_epoch!==credential.retired_at_epoch:tombstone.retired_at_epoch!==config.config_epoch))throw Error('RETIREMENT_REQUIRED');
}
export function assertNewCredentialExpiry(expiresAt:number,nowMs:number):void {
 if(!Number.isFinite(expiresAt)||expiresAt<=nowMs||expiresAt>nowMs+90*86400000)throw Error('CREDENTIAL_EXPIRY');
}
export function nextAuthorityVersion(version:number,advance:boolean):number {
 if(!Number.isSafeInteger(version)||version<1||advance&&version>=Number.MAX_SAFE_INTEGER)throw Error('R2_VERSION_EXHAUSTED');return version+(advance?1:0);
}
interface Metadata {workspace_id:string;object_name:string;config_epoch:number;installation_digest:string;admission_state:string;}
export interface Credential {credential_id:string;agent_id:string;token_sha256:string;retired_at_epoch:number|null;}
export function installConfiguration(tx:WorkspaceTransaction,config:DeploymentConfig,input:ValidatedBootstrap,nowMs:number):{epoch:number;installationDigest:string} {
 const {workspaceId,bundle,installationDigest}=input,mapping=resolveWorkspace(config,workspaceId);
 const old=tx.one<Metadata>('SELECT * FROM workspace_metadata WHERE id=1');
 if(old) {
  if(old.workspace_id!==workspaceId||old.object_name!==mapping.objectName)throw Error('WORKSPACE_IDENTITY_MISMATCH');
  if(old.admission_state!=='installed'||maintenanceClosed(tx))throw Error('ADMISSION_CLOSED');
  if(config.config_epoch<old.config_epoch)throw Error('STALE_EPOCH');
  if(config.config_epoch===old.config_epoch) {
   if(installationDigest!==old.installation_digest)throw Error('EPOCH_CONFLICT');
   retainOpenMaintenance(tx,old.config_epoch,nowMs);return {epoch:old.config_epoch,installationDigest};
  }
 }
 applyAuthorityRows(tx,config,input,nowMs);
 tx.exec("INSERT INTO workspace_metadata (id,workspace_id,object_name,config_epoch,config_digest,installation_digest,config_json,bundle_json,installed_at) VALUES (1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET config_epoch=excluded.config_epoch,config_digest=excluded.config_digest,installation_digest=excluded.installation_digest,config_json=excluded.config_json,bundle_json=excluded.bundle_json,installed_at=excluded.installed_at",[workspaceId,mapping.objectName,config.config_epoch,bundle.config_digest,installationDigest,canonicalJson(config),canonicalJson(bundle),nowMs]);
 retainOpenMaintenance(tx,config.config_epoch,nowMs);return {epoch:config.config_epoch,installationDigest};
}

/** Private authority overlay: caller must already hold the restore barrier and verified ledger. */
export function restoreAuthorityOverlay(tx:WorkspaceTransaction,input:ValidatedBootstrap,nowMs:number):void {
 const {config,workspaceId}=input,mapping=resolveWorkspace(config,workspaceId);
 const metadata=tx.one<Metadata>('SELECT * FROM workspace_metadata WHERE id=1');
 if(!metadata||metadata.admission_state!=='maintenance'||metadata.workspace_id!==workspaceId||metadata.object_name!==mapping.objectName||metadata.config_epoch!==config.config_epoch||metadata.installation_digest!==input.installationDigest)throw Error('RESTORE_OVERLAY_CONFLICT');
 applyAuthorityRows(tx,config,input,nowMs);
}
function applyAuthorityRows(tx:WorkspaceTransaction,config:DeploymentConfig,input:ValidatedBootstrap,nowMs:number):void {
 const {workspaceId,bundle}=input;
 const schemaVersion=tx.one<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations')?.version;
 if(!EXPECTED_SCHEMA_VERSIONS.some(version=>version===schemaVersion))throw Error('UNSUPPORTED_SCHEMA');
 const r2=hasR2AuthoritySchema(schemaVersion);
 if(r2){
  for(const agent of config.static_participants.filter(x=>x.workspace_id===workspaceId)){
   const prior=tx.one<{workspace_id:string;origin:string}>('SELECT workspace_id,origin FROM static_agents WHERE agent_id=?',[agent.agent_id]);
   if(prior&&(prior.workspace_id!==workspaceId||prior.origin!=='operator_static'))throw Error('R2_IDENTITY_COLLISION');
  }
  for(const credential of [...config.static_credential_refs,...bundle.retired_credentials].filter(x=>x.workspace_id===workspaceId)){
   const prior=tx.one<{workspace_id:string;origin:string}>('SELECT workspace_id,origin FROM native_credentials WHERE credential_id=?',[credential.credential_id]);
   if(prior&&(prior.workspace_id!==workspaceId||prior.origin!=='operator_static'))throw Error('R2_IDENTITY_COLLISION');
  }
 }
 const priorAgents=r2?new Set(tx.all<{agent_id:string}>('SELECT agent_id FROM static_agents').map(x=>x.agent_id)):new Set<string>();
 const priorCredentials=r2?new Set(tx.all<{credential_id:string}>('SELECT credential_id FROM native_credentials').map(x=>x.credential_id)):new Set<string>();
 const keyed=(workspace:string,credential:string)=>JSON.stringify([workspace,credential]);
 const hashes=new Map(bundle.credentials.map(x=>[keyed(x.workspace_id,x.credential_id),x]));
 const retired=new Map(bundle.retired_credentials.map(x=>[keyed(x.workspace_id,x.credential_id),x]));
 if(hashes.size!==bundle.credentials.length||retired.size!==bundle.retired_credentials.length)throw Error('DUPLICATE_CREDENTIAL');
 if(hashes.size!==config.static_credential_refs.length)throw Error('CREDENTIAL_SET_MISMATCH');
 for(const ref of config.static_credential_refs)if(!hashes.has(keyed(ref.workspace_id,ref.credential_id))||retired.has(keyed(ref.workspace_id,ref.credential_id)))throw Error('CREDENTIAL_SET_MISMATCH');
 for(const tombstone of retired.values())validateRetirement(config,tombstone);
 const existing=tx.all<Credential>('SELECT credential_id,agent_id,token_sha256,retired_at_epoch FROM native_credentials'+(r2?" WHERE origin='operator_static'":''));
 const references=config.static_credential_refs.filter(x=>x.workspace_id===workspaceId);
 for(const credential of existing) {
  const ref=references.find(x=>x.credential_id===credential.credential_id),tombstone=retired.get(keyed(workspaceId,credential.credential_id));
  assertCredentialContinuity(config,workspaceId,credential,ref,hashes.get(keyed(workspaceId,credential.credential_id)),tombstone);
 }
 for(const ref of references)if(!existing.some(x=>x.credential_id===ref.credential_id)) {
  const expiry=Date.parse(ref.expires_at);
  assertNewCredentialExpiry(expiry,nowMs);
 }
 // Retain disabled identity records so future installs cannot silently rebind principals.
 tx.exec('UPDATE human_grants SET enabled=0,config_epoch=?',[config.config_epoch]);
 for(const grant of config.human_grants.filter(x=>x.workspace_id===workspaceId)) {
  const prior=tx.one<{issuer:string;subject:string}>('SELECT issuer,subject FROM human_grants WHERE principal_id=?',[grant.principal_id]);
  if(prior)assertPrincipalContinuity(prior,grant);
  tx.exec('INSERT INTO human_grants (principal_id,workspace_id,issuer,subject,scopes_json,project_ids_json,enabled,config_epoch) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(principal_id) DO UPDATE SET scopes_json=excluded.scopes_json,project_ids_json=excluded.project_ids_json,enabled=excluded.enabled,config_epoch=excluded.config_epoch',[grant.principal_id,workspaceId,grant.issuer,grant.subject,canonicalJson(grant.scopes),canonicalJson(grant.project_ids),Number(grant.enabled),config.config_epoch]);
 }
 for(const agent of config.static_participants.filter(x=>x.workspace_id===workspaceId)){
  if(r2){
   const old=tx.one<{display_name:string;agent_version:number}>('SELECT display_name,agent_version FROM static_agents WHERE agent_id=?',[agent.agent_id]);
   if(old&&old.display_name!==agent.display_name){if(old.agent_version>=Number.MAX_SAFE_INTEGER)throw Error('R2_VERSION_EXHAUSTED');tx.exec('UPDATE static_agents SET agent_version=agent_version+1 WHERE agent_id=?',[agent.agent_id]);}
  }
  tx.exec('INSERT INTO static_agents (agent_id,workspace_id,display_name,config_epoch) VALUES (?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET display_name=excluded.display_name,config_epoch=excluded.config_epoch',[agent.agent_id,workspaceId,agent.display_name,config.config_epoch]);
 }
 for(const ref of references){
  if(r2){
   const old=tx.one<{scopes_json:string;project_ids_json:string;expires_at:number;enabled:number;credential_version:number}>('SELECT scopes_json,project_ids_json,expires_at,enabled,credential_version FROM native_credentials WHERE credential_id=?',[ref.credential_id]);
   if(old&&(old.scopes_json!==canonicalJson(ref.scopes)||old.project_ids_json!==canonicalJson(ref.project_ids)||old.expires_at!==Date.parse(ref.expires_at)||old.enabled!==Number(ref.enabled))){
    if(old.credential_version>=Number.MAX_SAFE_INTEGER)throw Error('R2_VERSION_EXHAUSTED');
    tx.exec('UPDATE native_credentials SET credential_version=credential_version+1 WHERE credential_id=?',[ref.credential_id]);
   }
  }
  tx.exec('INSERT INTO native_credentials (credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch) VALUES (?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(credential_id) DO UPDATE SET scopes_json=excluded.scopes_json,project_ids_json=excluded.project_ids_json,expires_at=excluded.expires_at,enabled=excluded.enabled,config_epoch=excluded.config_epoch',[ref.credential_id,workspaceId,ref.agent_id,hashes.get(keyed(workspaceId,ref.credential_id))!.token_sha256,canonicalJson(ref.scopes),canonicalJson(ref.project_ids),Date.parse(ref.expires_at),Number(ref.enabled),config.config_epoch]);
 }
 for(const item of bundle.retired_credentials.filter(x=>x.workspace_id===workspaceId)){
  if(r2){
   const old=tx.one<{retired_at_epoch:number|null;credential_version:number}>('SELECT retired_at_epoch,credential_version FROM native_credentials WHERE credential_id=?',[item.credential_id]);
   if(old&&old.retired_at_epoch===null){if(old.credential_version>=Number.MAX_SAFE_INTEGER)throw Error('R2_VERSION_EXHAUSTED');tx.exec('UPDATE native_credentials SET credential_version=credential_version+1 WHERE credential_id=?',[item.credential_id]);}
  }
  tx.exec("INSERT INTO native_credentials (credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch) VALUES (?,?,?,?,'[]','null',0,0,?,?) ON CONFLICT(credential_id) DO UPDATE SET enabled=0,config_epoch=excluded.config_epoch,retired_at_epoch=excluded.retired_at_epoch",[item.credential_id,workspaceId,item.agent_id,item.token_sha256,config.config_epoch,item.retired_at_epoch]);
 }
 if(r2){
  if(tx.one("SELECT credential_id FROM native_credentials WHERE workspace_id=? AND origin='human_managed' AND revoked_at IS NULL AND credential_version>=?",[workspaceId,Number.MAX_SAFE_INTEGER])||tx.one('SELECT id FROM runtimes WHERE workspace_id=? AND revoked_at IS NULL AND runtime_version>=?',[workspaceId,Number.MAX_SAFE_INTEGER]))throw Error('R2_VERSION_EXHAUSTED');
  tx.exec("UPDATE native_credentials SET enabled=0,revoked_at=COALESCE(revoked_at,?),credential_version=credential_version+CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END WHERE workspace_id=? AND origin='human_managed'",[nowMs,workspaceId]);
  tx.exec("UPDATE runtimes SET revoked_at=COALESCE(revoked_at,?),status='expired',runtime_version=runtime_version+CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END WHERE workspace_id=?",[nowMs,workspaceId]);
  tx.exec("UPDATE static_agents SET config_epoch=? WHERE workspace_id=? AND origin='human_managed' AND status='active'",[config.config_epoch,workspaceId]);
  for(const agent of config.static_participants.filter(x=>x.workspace_id===workspaceId)){
   if(!priorAgents.has(agent.agent_id))tx.exec('UPDATE static_agents SET created_at=?,updated_at=? WHERE agent_id=?',[nowMs,nowMs,agent.agent_id]);
   else tx.exec('UPDATE static_agents SET updated_at=? WHERE agent_id=?',[nowMs,agent.agent_id]);
  }
  for(const credential of tx.all<{credential_id:string}>('SELECT credential_id FROM native_credentials'))if(!priorCredentials.has(credential.credential_id))tx.exec('UPDATE native_credentials SET created_at=? WHERE credential_id=?',[nowMs,credential.credential_id]);
 }
}
