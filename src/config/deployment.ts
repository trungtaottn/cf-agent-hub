import { validateDeployment, type DeploymentConfig } from './generated/validators.js';
export type { DeploymentConfig } from './generated/validators.js';
function invalid(field:string):never {throw Error('INVALID_CONFIGURATION: '+field);}
export function approvedHttpsUrl(value:string):boolean {
 try {
  const u=new URL(value),host=u.hostname;
  return u.protocol==='https:' && u.href===value && !u.username && !u.password && !u.search && !u.hash && !u.port
   && host.includes('.') && !/^[\d.]+$|:|(^|\.)(localhost|local|internal|metadata|home|lan|test)$|^metadata\./.test(host);
 } catch{return false;}
}
function unique<T>(items:readonly T[],key:(x:T)=>string,field:string) {
 const seen=new Set<string>(); for(const item of items) { const value=key(item);if(seen.has(value))invalid(field);seen.add(value); }
}
export function parseDeployment(input:unknown):DeploymentConfig {
 if(!validateDeployment(input))invalid('schema');
 const config=structuredClone(input),catalog=config.workspace_catalog,auth=config.authentication;
 unique(catalog,x=>x.workspace_id,'workspace_catalog.workspace_id');
 unique(catalog,x=>x.object_name,'workspace_catalog.object_name');
 const ids=new Set(catalog.map(x=>x.workspace_id));
 for(const list of [config.human_grants,config.static_participants,config.static_credential_refs,config.workspace_policies,auth.redirect_uris])
  for(const item of list)if(!ids.has(item.workspace_id))invalid('workspace_id');
 unique(config.human_grants,x=>JSON.stringify([x.workspace_id,x.issuer,x.subject]),'human_grants.subject');
 unique(config.human_grants,x=>JSON.stringify([x.workspace_id,x.principal_id]),'human_grants.principal_id');
 unique(config.static_participants,x=>JSON.stringify([x.workspace_id,x.agent_id]),'static_participants.agent_id');
 unique(config.static_credential_refs,x=>JSON.stringify([x.workspace_id,x.credential_id]),'static_credential_refs.credential_id');
 unique(config.workspace_policies,x=>x.workspace_id,'workspace_policies.workspace_id');
 unique(auth.redirect_uris,x=>x.workspace_id,'authentication.redirect_uris.workspace_id');
 if(auth.client_id!==auth.audience)invalid('authentication.client_id');
 // The issuer may be a bare origin; endpoint strings must already be canonical.
 if(!approvedHttpsUrl(auth.issuer.endsWith('/')?auth.issuer:auth.issuer+'/'))invalid('authentication.issuer');
 for(const endpoint of Object.values(auth.reviewed_oidc_endpoints))if(!approvedHttpsUrl(endpoint))invalid('authentication.reviewed_oidc_endpoints');
 for(const origin of auth.allowed_origins)if(new URL(origin).origin!==origin||!approvedHttpsUrl(origin+'/'))invalid('authentication.allowed_origins');
 if(auth.redirect_uris.length!==catalog.length)invalid('authentication.redirect_uris');
 for(const item of auth.redirect_uris) {
  const u=new URL(item.redirect_uri);
  if(!approvedHttpsUrl(item.redirect_uri)||!auth.allowed_origins.includes(u.origin)||u.pathname!=='/v2/workspaces/'+item.workspace_id+'/auth/callback')invalid('authentication.redirect_uris');
 }
 const subjects=new Map<string,string>(),principals=new Map<string,string>();
 for(const grant of config.human_grants) {
  const pair=JSON.stringify([grant.issuer,grant.subject]);
  if(grant.issuer!==auth.issuer||(subjects.has(pair)&&subjects.get(pair)!==grant.principal_id)||(principals.has(grant.principal_id)&&principals.get(grant.principal_id)!==pair))invalid('human_grants.principal_id');
  subjects.set(pair,grant.principal_id);principals.set(grant.principal_id,pair);
 }
 const agentExists=(workspace:string,agent:string)=>config.static_participants.some(x=>x.workspace_id===workspace&&x.agent_id===agent);
 for(const ref of config.static_credential_refs)if(!agentExists(ref.workspace_id,ref.agent_id))invalid('static_credential_refs.agent_id');
 if(config.workspace_policies.length!==catalog.length)invalid('workspace_policies');
 for(const policy of config.workspace_policies) {
  unique(policy.notification_destinations,x=>x.destination_id,'notification_destinations.destination_id');
  for(const dest of policy.notification_destinations)if(!approvedHttpsUrl(dest.url)||!agentExists(policy.workspace_id,dest.agent_id))invalid('notification_destinations');
 }
 return config;
}
export function resolveWorkspace(config:DeploymentConfig,id:string):{workspaceId:string;objectName:string} {
 const mapping=config.workspace_catalog.find(x=>x.workspace_id===id);
 if(!mapping)throw Error('UNKNOWN_WORKSPACE');
 return {workspaceId:mapping.workspace_id,objectName:mapping.object_name};
}
