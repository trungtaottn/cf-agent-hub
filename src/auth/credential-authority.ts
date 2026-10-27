import type {WorkspaceTransaction} from '../storage/transaction';
import {parseDeployment} from '../config/deployment';
import {admissionOpen} from '../recovery/maintenance';
import deploymentSchema from '../../spec/deployment-config.schema.json';
/** Policy derives from the canonical operator-native allowlist, not metadata labels. */
export const nativeScopes:ReadonlySet<string>=new Set(deploymentSchema.properties.static_credential_refs.items.properties.scopes.items.enum);
export interface CredentialAuthorityRow {
 credential_id:string;workspace_id:string;agent_id:string;scopes_json:string;project_ids_json:string;
 expires_at:number;enabled:number;retired_at_epoch:number|null;config_epoch:number;
 origin?:'operator_static'|'human_managed';revoked_at?:number|null;issued_by_principal_id?:string|null;
}
export function grantsCover(scopes:readonly string[],projects:readonly string[]|null,requestedScopes:readonly string[],requestedProjects:readonly string[]|null):boolean {
 return requestedScopes.every(scope=>scopes.includes(scope))&&(projects===null||requestedProjects!==null&&requestedProjects.every(id=>projects.includes(id)));
}
function grants(row:{scopes_json:string;project_ids_json:string}):{scopes:string[];projects:string[]|null}|null{
 try{const scopes:unknown=JSON.parse(row.scopes_json),projects:unknown=JSON.parse(row.project_ids_json);
  if(!Array.isArray(scopes)||!scopes.every(x=>typeof x==='string')||projects!==null&&(!Array.isArray(projects)||!projects.every(x=>typeof x==='string')))return null;
  return {scopes,projects:projects as string[]|null};
 }catch{return null;}
}
export interface DelegationCeiling {scopes:string[];projects:string[]|null;}
/** Installed operator metadata is the only delegation source. Never copy into actor scopes.
 * Re-read every transaction; the relational row can narrow, never broaden, installed policy. */
export function delegationCeiling(tx:WorkspaceTransaction,workspaceId:string,principalId:string):DelegationCeiling|null{
 if(!admissionOpen(tx))return null;
 const metadata=tx.one<{config_epoch:number;config_json:string;admission_state:string}>('SELECT config_epoch,config_json,admission_state FROM workspace_metadata WHERE workspace_id=?',[workspaceId]);
 const row=tx.one<{workspace_id:string;principal_id:string;issuer:string;subject:string;enabled:number;config_epoch:number;scopes_json:string;project_ids_json:string}>('SELECT * FROM human_grants WHERE workspace_id=? AND principal_id=?',[workspaceId,principalId]);
 if(!metadata||metadata.admission_state!=='installed'||!row||row.enabled!==1||row.config_epoch!==metadata.config_epoch)return null;
 const current=grants(row);if(!current||!current.scopes.includes('credentials:manage'))return null;
 try{
  const config=parseDeployment(JSON.parse(metadata.config_json));if(config.config_epoch!==metadata.config_epoch)return null;
  const entries=config.human_grants.filter(g=>g.workspace_id===workspaceId&&g.principal_id===principalId);
  if(entries.length!==1)return null;const configured=entries[0];
  if(!configured.enabled||configured.issuer!==row.issuer||configured.subject!==row.subject||!configured.scopes.includes('credentials:manage'))return null;
  const scopes=configured.delegable_native_scopes===undefined?current.scopes.filter(scope=>nativeScopes.has(scope)&&(configured.scopes as string[]).includes(scope)):[...configured.delegable_native_scopes];
  const operatorProjects=configured.project_ids as string[]|null;
  const projects=operatorProjects===null?current.projects:current.projects===null?operatorProjects:current.projects.filter(id=>operatorProjects.includes(id));
  return {scopes,projects};
 }catch{return null;}
}
export function delegationScopes(tx:WorkspaceTransaction,workspaceId:string,principalId:string):string[]|null{return delegationCeiling(tx,workspaceId,principalId)?.scopes??null;}
/** Current eligibility only; never manufactures authentication or combines credential grants.
 * Missing provenance is allowed only in the genuine historical schema7 store. */
export function credentialGrantAllowed(tx:WorkspaceTransaction,row:CredentialAuthorityRow,nowMs:number):boolean{
 const metadata=tx.one<{config_epoch:number;admission_state:string}>('SELECT config_epoch,admission_state FROM workspace_metadata WHERE workspace_id=?',[row.workspace_id]);
 const agent=tx.one<{config_epoch:number;status?:string;origin?:string}>('SELECT * FROM static_agents WHERE workspace_id=? AND agent_id=?',[row.workspace_id,row.agent_id]);
 if(!metadata||metadata.admission_state!=='installed'||!agent||agent.config_epoch!==metadata.config_epoch||agent.status!==undefined&&agent.status!=='active'||row.config_epoch!==metadata.config_epoch||row.enabled!==1||row.retired_at_epoch!==null||row.revoked_at!=null||row.expires_at<=nowMs)return false;
 if(row.origin===undefined){return tx.one<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations')?.version===7;}
 if(row.origin==='operator_static')return agent.origin==='operator_static';
 if(row.origin!=='human_managed'||!row.issued_by_principal_id)return false;
 const grant=grants(row);if(!grant||!grant.scopes.every(scope=>nativeScopes.has(scope)))return false;
 const ceiling=delegationCeiling(tx,row.workspace_id,row.issued_by_principal_id);
 if(!ceiling||!grantsCover(ceiling.scopes,ceiling.projects,grant.scopes,grant.projects))return false;
 if(agent.origin==='human_managed')return true;
 if(agent.origin!=='operator_static')return false;
 // The installed static reference set is bounded by the canonical configuration
 // (1000 globally). Historical retired credentials can grow without bound; never
 // filter-scan that table to discover current adoption authority.
 const installed=tx.one<{config_json:string}>('SELECT config_json FROM workspace_metadata WHERE workspace_id=?',[row.workspace_id]);
 if(!installed)return false;
 try{
  const config=parseDeployment(JSON.parse(installed.config_json));if(config.config_epoch!==metadata.config_epoch)return false;
  return config.static_credential_refs.some(ref=>{
   if(ref.workspace_id!==row.workspace_id||ref.agent_id!==row.agent_id||!ref.enabled||Date.parse(ref.expires_at)<row.expires_at||Date.parse(ref.expires_at)<=nowMs||!grantsCover(ref.scopes,ref.project_ids,grant.scopes,grant.projects))return false;
   const source=tx.one<CredentialAuthorityRow>('SELECT * FROM native_credentials WHERE workspace_id=? AND credential_id=?',[row.workspace_id,ref.credential_id]);
   if(!source||source.agent_id!==row.agent_id||source.origin!=='operator_static'||source.enabled!==1||source.retired_at_epoch!==null||source.revoked_at!=null||source.config_epoch!==metadata.config_epoch||source.expires_at<row.expires_at||source.expires_at<=nowMs)return false;
   const allowed=grants(source);return !!allowed&&grantsCover(allowed.scopes,allowed.projects,grant.scopes,grant.projects);
  });
 }catch{return false;}
}
