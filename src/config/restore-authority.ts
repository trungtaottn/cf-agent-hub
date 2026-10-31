import {canonicalJson,assertCredentialContinuity,assertPrincipalContinuity,assertNewCredentialExpiry,nextAuthorityVersion,validateRetirement,type ValidatedBootstrap,type Credential} from './bootstrap';
import {parseDeployment,type DeploymentConfig} from './deployment';
import {validateBundle,type VerificationBundle} from './generated/validators.js';
import type {SqlValue} from '../storage/transaction';
export type RestoreAuthorityTable='human_grants'|'static_agents'|'native_credentials'|'runtimes';
export type AuthorityRow=Record<string,SqlValue>;
export interface RestoreAuthorityPlan {
 readonly workspaceId:string;readonly nowMs:number;readonly config:DeploymentConfig;
 readonly grants:ReadonlyMap<string,DeploymentConfig['human_grants'][number]>;
 readonly agents:ReadonlyMap<string,DeploymentConfig['static_participants'][number]>;
 readonly references:ReadonlyMap<string,DeploymentConfig['static_credential_refs'][number]>;
 readonly hashes:ReadonlyMap<string,VerificationBundle['credentials'][number]>;
 readonly retired:ReadonlyMap<string,VerificationBundle['retired_credentials'][number]>;
}
/** Current ledger only: size-bounded configuration maps, never an inventory of source identities. */
export function prepareRestoreAuthority(input:ValidatedBootstrap,nowMs:number):RestoreAuthorityPlan {
 if(!Number.isSafeInteger(nowMs)||nowMs<0||new TextEncoder().encode(canonicalJson({config:input.config,bundle:input.bundle})).length>131072)throw Error('RESTORE_AUTHORITY_LIMIT');
 const config=parseDeployment(input.config),bundle=structuredClone(input.bundle),workspaceId=input.workspaceId;
 if(!validateBundle(bundle)||bundle.config_epoch!==config.config_epoch||!config.workspace_catalog.some(x=>x.workspace_id===workspaceId))throw Error('INVALID_BUNDLE');
 const key=(w:string,id:string)=>JSON.stringify([w,id]);
 const allHashes=new Map(bundle.credentials.map(x=>[key(x.workspace_id,x.credential_id),x])),allRetired=new Map(bundle.retired_credentials.map(x=>[key(x.workspace_id,x.credential_id),x]));
 if(allHashes.size!==bundle.credentials.length||allRetired.size!==bundle.retired_credentials.length)throw Error('DUPLICATE_CREDENTIAL');
 if(allHashes.size!==config.static_credential_refs.length)throw Error('CREDENTIAL_SET_MISMATCH');
 for(const ref of config.static_credential_refs)if(!allHashes.has(key(ref.workspace_id,ref.credential_id))||allRetired.has(key(ref.workspace_id,ref.credential_id)))throw Error('CREDENTIAL_SET_MISMATCH');
 for(const tombstone of bundle.retired_credentials)validateRetirement(config,tombstone);
 return {workspaceId,nowMs,config,grants:new Map(config.human_grants.filter(x=>x.workspace_id===workspaceId).map(x=>[x.principal_id,x])),agents:new Map(config.static_participants.filter(x=>x.workspace_id===workspaceId).map(x=>[x.agent_id,x])),references:new Map(config.static_credential_refs.filter(x=>x.workspace_id===workspaceId).map(x=>[x.credential_id,x])),hashes:new Map(bundle.credentials.filter(x=>x.workspace_id===workspaceId).map(x=>[x.credential_id,x])),retired:new Map(bundle.retired_credentials.filter(x=>x.workspace_id===workspaceId).map(x=>[x.credential_id,x]))};
}
function text(row:AuthorityRow,key:string):string{if(typeof row[key]!=='string')throw Error('INVALID_RESTORE_AUTHORITY_ROW');return row[key];}
function version(row:AuthorityRow,key:string,advance:boolean):number{return nextAuthorityVersion(Number(row[key]),advance);}
/** Pure projection from immutable authenticated source row, safe to recompute across retries. */
export function transformRestoredAuthorityRow(p:RestoreAuthorityPlan,table:RestoreAuthorityTable,row:AuthorityRow):AuthorityRow {
 if(row.workspace_id!==p.workspaceId)throw Error('RECOVERY_WORKSPACE_ROW_MISMATCH');
 const out={...row},epoch=p.config.config_epoch;
 if(table==='human_grants'){
  const grant=p.grants.get(text(row,'principal_id'));out.enabled=0;out.config_epoch=epoch;
  if(grant){assertPrincipalContinuity({issuer:text(row,'issuer'),subject:text(row,'subject')},grant);out.scopes_json=canonicalJson(grant.scopes);out.project_ids_json=canonicalJson(grant.project_ids);out.enabled=Number(grant.enabled);}return out;
 }
 if(table==='static_agents'){
  const agent=p.agents.get(text(row,'agent_id'));
  if(row.origin==='human_managed'){if(agent)throw Error('R2_IDENTITY_COLLISION');if(row.status==='active')out.config_epoch=epoch;return out;}
  if(row.origin!=='operator_static')throw Error('INVALID_RESTORE_AUTHORITY_ROW');
  if(agent){out.agent_version=version(row,'agent_version',row.display_name!==agent.display_name);out.display_name=agent.display_name;out.config_epoch=epoch;out.updated_at=p.nowMs;}return out;
 }
 if(table==='runtimes'){
  out.runtime_version=version(row,'runtime_version',row.revoked_at===null);out.revoked_at=row.revoked_at??p.nowMs;out.status='expired';return out;
 }
 const id=text(row,'credential_id'),ref=p.references.get(id),tombstone=p.retired.get(id);
 if(row.origin==='human_managed'){
  if(ref||tombstone)throw Error('R2_IDENTITY_COLLISION');out.credential_version=version(row,'credential_version',row.revoked_at===null);out.enabled=0;out.revoked_at=row.revoked_at??p.nowMs;return out;
 }
 if(row.origin!=='operator_static')throw Error('INVALID_RESTORE_AUTHORITY_ROW');
 assertCredentialContinuity(p.config,p.workspaceId,{credential_id:id,agent_id:text(row,'agent_id'),token_sha256:text(row,'token_sha256'),retired_at_epoch:row.retired_at_epoch as number|null} satisfies Credential,ref,p.hashes.get(id),tombstone);
 out.config_epoch=epoch;
 if(ref){
  const scopes=canonicalJson(ref.scopes),projects=canonicalJson(ref.project_ids),expiry=Date.parse(ref.expires_at),enabled=Number(ref.enabled);
  out.credential_version=version(row,'credential_version',row.scopes_json!==scopes||row.project_ids_json!==projects||row.expires_at!==expiry||row.enabled!==enabled);
  Object.assign(out,{scopes_json:scopes,project_ids_json:projects,expires_at:expiry,enabled});
 }else{out.credential_version=version(row,'credential_version',row.retired_at_epoch===null);out.enabled=0;out.retired_at_epoch=tombstone!.retired_at_epoch;}
 return out;
}
/** Only call for a genuinely missing PK after a bounded target lookup. Existing IDs are not recreated. */
export function assertRestoreAddition(p:RestoreAuthorityPlan,table:RestoreAuthorityTable,row:AuthorityRow):void {
 if(row.workspace_id!==p.workspaceId)throw Error('RECOVERY_WORKSPACE_ROW_MISMATCH');
 if(table==='native_credentials'&&row.retired_at_epoch===null)assertNewCredentialExpiry(Number(row.expires_at),p.nowMs);
}
/** Caller imports missing identities by PK. Cursor advances over candidates, including already-present IDs. */
export function restoreAuthorityAdditions(p:RestoreAuthorityPlan,table:RestoreAuthorityTable,offset:number,limit=200):{rows:AuthorityRow[];nextOffset:number;done:boolean}{
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('RESTORE_AUTHORITY_LIMIT');
 const ids=table==='human_grants'?[...p.grants.keys()]:table==='static_agents'?[...p.agents.keys()]:table==='native_credentials'?[...p.references.keys(),...p.retired.keys()]:[];
 ids.sort();if(offset>ids.length)throw Error('RESTORE_AUTHORITY_CURSOR');
 const rows=ids.slice(offset,offset+limit).map(id=>{
  const common={workspace_id:p.workspaceId,config_epoch:p.config.config_epoch};
  if(table==='human_grants'){const g=p.grants.get(id)!;return {...common,principal_id:id,issuer:g.issuer,subject:g.subject,scopes_json:canonicalJson(g.scopes),project_ids_json:canonicalJson(g.project_ids),enabled:Number(g.enabled)};}
  if(table==='static_agents'){const a=p.agents.get(id)!;return {...common,agent_id:id,display_name:a.display_name,origin:'operator_static',agent_version:1,description:'',work_role_ids_json:'[]',framework:null,model:null,status:'active',created_at:p.nowMs,updated_at:p.nowMs};}
  const ref=p.references.get(id),retired=p.retired.get(id),base={...common,credential_id:id,agent_id:ref?.agent_id??retired!.agent_id,token_sha256:ref?p.hashes.get(id)!.token_sha256:retired!.token_sha256,origin:'operator_static',credential_version:1,label:'',created_at:p.nowMs,revoked_at:null,issued_by_principal_id:null};
  return {...base,scopes_json:ref?canonicalJson(ref.scopes):'[]',project_ids_json:ref?canonicalJson(ref.project_ids):'null',expires_at:ref?Date.parse(ref.expires_at):0,enabled:ref?Number(ref.enabled):0,retired_at_epoch:ref?null:retired!.retired_at_epoch};
 });return {rows,nextOffset:offset+rows.length,done:offset+rows.length===ids.length};
}
