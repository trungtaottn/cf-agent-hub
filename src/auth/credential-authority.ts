import type {WorkspaceTransaction} from '../storage/transaction';
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
 const issuer=tx.one<{enabled:number;config_epoch:number;scopes_json:string;project_ids_json:string}>('SELECT enabled,config_epoch,scopes_json,project_ids_json FROM human_grants WHERE workspace_id=? AND principal_id=?',[row.workspace_id,row.issued_by_principal_id]);
 const ceiling=issuer&&grants(issuer);
 if(!issuer||issuer.enabled!==1||issuer.config_epoch!==metadata.config_epoch||!ceiling||!ceiling.scopes.includes('credentials:manage')||!grantsCover(ceiling.scopes,ceiling.projects,grant.scopes,grant.projects))return false;
 if(agent.origin==='human_managed')return true;
 if(agent.origin!=='operator_static')return false;
 const sources=tx.all<CredentialAuthorityRow>("SELECT * FROM native_credentials WHERE workspace_id=? AND agent_id=? AND origin='operator_static' AND enabled=1 AND retired_at_epoch IS NULL AND revoked_at IS NULL AND config_epoch=? AND expires_at>=? AND expires_at>?",[row.workspace_id,row.agent_id,metadata.config_epoch,row.expires_at,nowMs]);
 return sources.some(source=>{const allowed=grants(source);return !!allowed&&grantsCover(allowed.scopes,allowed.projects,grant.scopes,grant.projects);});
}
