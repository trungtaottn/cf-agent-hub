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
export async function sha256(value:string):Promise<string> {
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
function validateRetirement(config:DeploymentConfig,tombstone:{workspace_id:string;agent_id:string;retired_at_epoch:number}):void {
 if(!config.workspace_catalog.some(x=>x.workspace_id===tombstone.workspace_id)||
  !config.static_participants.some(x=>x.workspace_id===tombstone.workspace_id&&x.agent_id===tombstone.agent_id)||
  tombstone.retired_at_epoch>config.config_epoch)throw Error('INVALID_RETIREMENT');
}
export async function prepareBootstrap(configInput:unknown,bundleInput:unknown,workspaceId:string):Promise<ValidatedBootstrap> {
 const config=parseDeployment(configInput);
 if(!validateBundle(bundleInput))throw Error('INVALID_BUNDLE');
 const bundle=structuredClone(bundleInput);resolveWorkspace(config,workspaceId);
 if(bundle.config_epoch!==config.config_epoch||bundle.config_digest!==await sha256(canonicalJson(config)))throw Error('CONFIG_DIGEST_MISMATCH');
 for(const tombstone of bundle.retired_credentials)validateRetirement(config,tombstone);
 const order=(a:{workspace_id:string;credential_id:string},b:{workspace_id:string;credential_id:string})=>
  a.workspace_id<b.workspace_id?-1:a.workspace_id>b.workspace_id?1:a.credential_id<b.credential_id?-1:a.credential_id>b.credential_id?1:0;
 return {config,bundle,workspaceId,installationDigest:await sha256(canonicalJson({config,credentials:[...bundle.credentials].sort(order),retired_credentials:[...bundle.retired_credentials].sort(order)}))};

}
interface Metadata {workspace_id:string;object_name:string;config_epoch:number;installation_digest:string;admission_state:string;}
interface Credential {credential_id:string;agent_id:string;token_sha256:string;retired_at_epoch:number|null;}
export function installConfiguration(tx:WorkspaceTransaction,config:DeploymentConfig,input:ValidatedBootstrap,nowMs:number):{epoch:number;installationDigest:string} {
 const {workspaceId,bundle,installationDigest}=input,mapping=resolveWorkspace(config,workspaceId);
 const old=tx.one<Metadata>('SELECT * FROM workspace_metadata WHERE id=1');
 if(old) {
  if(old.workspace_id!==workspaceId||old.object_name!==mapping.objectName)throw Error('WORKSPACE_IDENTITY_MISMATCH');
  if(old.admission_state!=='installed')throw Error('ADMISSION_CLOSED');
  if(config.config_epoch<old.config_epoch)throw Error('STALE_EPOCH');
  if(config.config_epoch===old.config_epoch) {
   if(installationDigest!==old.installation_digest)throw Error('EPOCH_CONFLICT');
   return {epoch:old.config_epoch,installationDigest};
  }
 }
 const keyed=(workspace:string,credential:string)=>JSON.stringify([workspace,credential]);
 const hashes=new Map(bundle.credentials.map(x=>[keyed(x.workspace_id,x.credential_id),x]));
 const retired=new Map(bundle.retired_credentials.map(x=>[keyed(x.workspace_id,x.credential_id),x]));
 if(hashes.size!==bundle.credentials.length||retired.size!==bundle.retired_credentials.length)throw Error('DUPLICATE_CREDENTIAL');
 if(hashes.size!==config.static_credential_refs.length)throw Error('CREDENTIAL_SET_MISMATCH');
 for(const ref of config.static_credential_refs)if(!hashes.has(keyed(ref.workspace_id,ref.credential_id))||retired.has(keyed(ref.workspace_id,ref.credential_id)))throw Error('CREDENTIAL_SET_MISMATCH');
 for(const tombstone of retired.values())validateRetirement(config,tombstone);
 const existing=tx.all<Credential>('SELECT credential_id,agent_id,token_sha256,retired_at_epoch FROM native_credentials');
 const references=config.static_credential_refs.filter(x=>x.workspace_id===workspaceId);
 for(const credential of existing) {
  // Stored tombstones remain bound to the reviewed catalog even when incoming history is omitted.
  if(credential.retired_at_epoch!==null)validateRetirement(config,{...credential,workspace_id:workspaceId,retired_at_epoch:credential.retired_at_epoch});
  const ref=references.find(x=>x.credential_id===credential.credential_id),tombstone=retired.get(keyed(workspaceId,credential.credential_id));
  if(ref) {
   if(credential.retired_at_epoch!==null||ref.agent_id!==credential.agent_id||hashes.get(keyed(workspaceId,ref.credential_id))!.token_sha256!==credential.token_sha256)throw Error('CREDENTIAL_IMMUTABLE');
  } else if(!tombstone||tombstone.agent_id!==credential.agent_id||tombstone.token_sha256!==credential.token_sha256||
    (credential.retired_at_epoch!==null?tombstone.retired_at_epoch!==credential.retired_at_epoch:tombstone.retired_at_epoch!==config.config_epoch))throw Error('RETIREMENT_REQUIRED');
 }
 for(const ref of references)if(!existing.some(x=>x.credential_id===ref.credential_id)) {
  const expiry=Date.parse(ref.expires_at);
  if(expiry<=nowMs||expiry>nowMs+90*86400000)throw Error('CREDENTIAL_EXPIRY');
 }
 // Retain disabled identity records so future installs cannot silently rebind principals.
 tx.exec('UPDATE human_grants SET enabled=0,config_epoch=?',[config.config_epoch]);
 for(const grant of config.human_grants.filter(x=>x.workspace_id===workspaceId)) {
  const prior=tx.one<{issuer:string;subject:string}>('SELECT issuer,subject FROM human_grants WHERE principal_id=?',[grant.principal_id]);
  if(prior&&(prior.issuer!==grant.issuer||prior.subject!==grant.subject))throw Error('PRINCIPAL_IMMUTABLE');
  tx.exec('INSERT INTO human_grants (principal_id,workspace_id,issuer,subject,scopes_json,project_ids_json,enabled,config_epoch) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(principal_id) DO UPDATE SET scopes_json=excluded.scopes_json,project_ids_json=excluded.project_ids_json,enabled=excluded.enabled,config_epoch=excluded.config_epoch',[grant.principal_id,workspaceId,grant.issuer,grant.subject,canonicalJson(grant.scopes),canonicalJson(grant.project_ids),Number(grant.enabled),config.config_epoch]);
 }
 for(const agent of config.static_participants.filter(x=>x.workspace_id===workspaceId))
  tx.exec('INSERT INTO static_agents (agent_id,workspace_id,display_name,config_epoch) VALUES (?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET display_name=excluded.display_name,config_epoch=excluded.config_epoch',[agent.agent_id,workspaceId,agent.display_name,config.config_epoch]);
 for(const ref of references)
  tx.exec('INSERT INTO native_credentials (credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch) VALUES (?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(credential_id) DO UPDATE SET scopes_json=excluded.scopes_json,project_ids_json=excluded.project_ids_json,expires_at=excluded.expires_at,enabled=excluded.enabled,config_epoch=excluded.config_epoch',[ref.credential_id,workspaceId,ref.agent_id,hashes.get(keyed(workspaceId,ref.credential_id))!.token_sha256,canonicalJson(ref.scopes),canonicalJson(ref.project_ids),Date.parse(ref.expires_at),Number(ref.enabled),config.config_epoch]);
 for(const item of bundle.retired_credentials.filter(x=>x.workspace_id===workspaceId))
  tx.exec("INSERT INTO native_credentials (credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch) VALUES (?,?,?,?,'[]','null',0,0,?,?) ON CONFLICT(credential_id) DO UPDATE SET enabled=0,config_epoch=excluded.config_epoch,retired_at_epoch=excluded.retired_at_epoch",[item.credential_id,workspaceId,item.agent_id,item.token_sha256,config.config_epoch,item.retired_at_epoch]);
 tx.exec("INSERT INTO workspace_metadata (id,workspace_id,object_name,config_epoch,config_digest,installation_digest,config_json,bundle_json,installed_at) VALUES (1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET config_epoch=excluded.config_epoch,config_digest=excluded.config_digest,installation_digest=excluded.installation_digest,config_json=excluded.config_json,bundle_json=excluded.bundle_json,installed_at=excluded.installed_at",[workspaceId,mapping.objectName,config.config_epoch,bundle.config_digest,installationDigest,canonicalJson(config),canonicalJson(bundle),nowMs]);
 return {epoch:config.config_epoch,installationDigest};
}
