import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext,CommandContext} from '../workspace/context';
import type {Credential,CredentialIssue,CredentialCreateRequest,CredentialRevokeRequest} from '../http/dto';
import type {CommandDescriptor} from '../workspace/commands';
import {authorize,refreshActor} from './authorize';
import {credentialGrantAllowed,grantsCover,nativeScopes,delegationCeiling,type CredentialAuthorityRow} from './credential-authority';
import {settingsPolicy} from '../config/policy';
import {storedProfile} from '../config/profile';
import {canonicalJson} from '../config/bootstrap';
import {agentRecord} from '../agents/commands';
import {HttpError} from '../http/envelopes';
import {validateCredential,validateCredentialCreateRequest,validateCredentialRevokeRequest,validateCredentialIssue} from '../http/generated/auth-validators.js';
export interface PreparedCredential {credentialId:string;tokenSha256:string;}
export interface CredentialRow extends CredentialAuthorityRow {token_sha256:string;origin:'operator_static'|'human_managed';credential_version:number;label:string;created_at:number;revoked_at:number|null;issued_by_principal_id:string|null;}
export function credentialView(row:CredentialRow,nowMs:number):Credential{
 const result:Credential={id:row.credential_id,workspace_id:row.workspace_id,agent_id:row.agent_id,credential_version:row.credential_version,label:row.label||'Operator credential',scopes:JSON.parse(row.scopes_json) as Credential['scopes'],project_ids:JSON.parse(row.project_ids_json) as string[]|null,status:row.revoked_at!==null||row.retired_at_epoch!==null||row.enabled!==1?'revoked':row.expires_at<=nowMs?'expired':'active',created_at:new Date(row.created_at).toISOString(),expires_at:new Date(row.expires_at).toISOString(),revoked_at:row.revoked_at===null?null:new Date(row.revoked_at).toISOString()};
 if(!validateCredential(result))throw new HttpError('INTERNAL_ERROR',500);return result;
}
export function credentialAccess(tx:WorkspaceTransaction,actor:ActorContext,nowMs:number):ActorContext{
 const live=refreshActor(tx,actor,nowMs);authorize(tx,live,'credentials:manage',undefined,nowMs);settingsPolicy(tx,live);
 if(live.kind!=='human'||!live.sessionId)throw new HttpError('FORBIDDEN',403);return live;
}
export function credentialRecord(tx:WorkspaceTransaction,workspaceId:string,id:string):CredentialRow{
 const row=tx.one<CredentialRow>('SELECT * FROM native_credentials WHERE workspace_id=? AND credential_id=?',[workspaceId,id]);if(!row)throw new HttpError('NOT_FOUND',404);return row;
}
export function assertCredentialVisible(tx:WorkspaceTransaction,actor:ActorContext,row:CredentialRow):void{
 const scopes=JSON.parse(row.scopes_json) as string[],projects=JSON.parse(row.project_ids_json) as string[]|null;
 const ceiling=actor.kind==='human'?delegationCeiling(tx,actor.workspaceId,actor.principalId):null;
 if(!ceiling||!grantsCover(ceiling.scopes,ceiling.projects,scopes,projects))throw new HttpError('NOT_FOUND',404);
}
export function issueCredential(tx:WorkspaceTransaction,ctx:CommandContext,request:CredentialCreateRequest,prepared:PreparedCredential):CredentialIssue{
 const actor=credentialAccess(tx,ctx.actor,ctx.nowMs);
 if(!validateCredentialCreateRequest(request))throw new HttpError('INVALID_REQUEST',400);
 if(!prepared||!/^[a-zA-Z0-9_-]{1,128}$/.test(prepared.credentialId)||!/^[a-f0-9]{64}$/.test(prepared.tokenSha256))throw new HttpError('INTERNAL_ERROR',500);
 const ceiling=delegationCeiling(tx,actor.workspaceId,actor.principalId);
 if(!ceiling||request.scopes.some(scope=>!nativeScopes.has(scope))||!grantsCover(ceiling.scopes,ceiling.projects,request.scopes,request.project_ids))throw new HttpError('FORBIDDEN',403);
 const expiry=Date.parse(request.expires_at);if(!Number.isSafeInteger(expiry)||expiry<=ctx.nowMs||expiry>ctx.nowMs+90*86400000)throw new HttpError('INVALID_REQUEST',400);
 if(request.project_ids!==null){const projects=storedProfile(tx,actor).profile.projects;if(new Set(request.project_ids).size!==request.project_ids.length)throw new HttpError('INVALID_REQUEST',400);if(request.project_ids.some(id=>!projects.some(project=>project.id===id&&!project.archived)))throw new HttpError('NOT_FOUND',404);}
 const agent=agentRecord(tx,actor.workspaceId,request.agent_id),{epoch}=settingsPolicy(tx,actor);
 if(agent.status!=='active'||agent.config_epoch!==epoch)throw new HttpError('INVALID_STATE',409);
 const row:CredentialRow={credential_id:prepared.credentialId,workspace_id:actor.workspaceId,agent_id:agent.agent_id,token_sha256:prepared.tokenSha256,scopes_json:canonicalJson(request.scopes),project_ids_json:canonicalJson(request.project_ids),expires_at:expiry,enabled:1,retired_at_epoch:null,config_epoch:epoch,origin:'human_managed',credential_version:1,label:request.label,created_at:ctx.nowMs,revoked_at:null,issued_by_principal_id:actor.principalId};
 if(!credentialGrantAllowed(tx,row,ctx.nowMs))throw new HttpError('FORBIDDEN',403);
 if(tx.one('SELECT credential_id FROM native_credentials WHERE credential_id=?',[prepared.credentialId])||tx.one('SELECT credential_id FROM native_credentials WHERE token_sha256=?',[prepared.tokenSha256]))throw new HttpError('INVALID_STATE',409);
 tx.exec("INSERT INTO native_credentials(credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch,origin,credential_version,label,created_at,revoked_at,issued_by_principal_id) VALUES(?,?,?,?,?,?,?,1,?,NULL,'human_managed',1,?,?,NULL,?)",[row.credential_id,row.workspace_id,row.agent_id,row.token_sha256,row.scopes_json,row.project_ids_json,row.expires_at,row.config_epoch,row.label,row.created_at,row.issued_by_principal_id]);
 return {credential:credentialView(row,ctx.nowMs),token:null,revealed:false};
}
export function revokeCredential(tx:WorkspaceTransaction,ctx:CommandContext,id:string,request:CredentialRevokeRequest):Credential{
 const actor=credentialAccess(tx,ctx.actor,ctx.nowMs);if(!validateCredentialRevokeRequest(request))throw new HttpError('INVALID_REQUEST',400);
 const row=credentialRecord(tx,actor.workspaceId,id);assertCredentialVisible(tx,actor,row);
 if(row.credential_version!==request.expected_credential_version)throw new HttpError('VERSION_CONFLICT',409,{current_version:row.credential_version});
 if(row.revoked_at!==null)throw new HttpError('INVALID_STATE',409);
 if(!Number.isSafeInteger(row.credential_version)||row.credential_version>=Number.MAX_SAFE_INTEGER||tx.one('SELECT id FROM runtimes WHERE workspace_id=? AND credential_id=? AND revoked_at IS NULL AND runtime_version>=? LIMIT 1',[actor.workspaceId,id,Number.MAX_SAFE_INTEGER]))throw new HttpError('LIMIT_EXCEEDED',409);
 tx.exec('UPDATE native_credentials SET enabled=0,revoked_at=?,credential_version=credential_version+1 WHERE workspace_id=? AND credential_id=?',[ctx.nowMs,actor.workspaceId,id]);
 tx.exec("UPDATE runtimes SET revoked_at=?,status='expired',runtime_version=runtime_version+1 WHERE workspace_id=? AND credential_id=? AND revoked_at IS NULL",[ctx.nowMs,actor.workspaceId,id]);
 return credentialView(credentialRecord(tx,actor.workspaceId,id),ctx.nowMs);
}
export function issueCredentialCommand(prepared:PreparedCredential):CommandDescriptor<CredentialCreateRequest,CredentialIssue>{return {
 operation:'credentials:manage',target:'credentials:create',resource:()=>undefined,
 checkAccess(tx,ctx){credentialAccess(tx,ctx.actor,ctx.nowMs);},
 checkReplay(tx,ctx,_body,outcome){const actor=credentialAccess(tx,ctx.actor,ctx.nowMs);if(!validateCredentialIssue(outcome.data)||outcome.data.token!==null||outcome.data.revealed||outcome.data.credential.workspace_id!==actor.workspaceId)throw new HttpError('INTERNAL_ERROR',500);assertCredentialVisible(tx,actor,credentialRecord(tx,actor.workspaceId,outcome.data.credential.id));const ceiling=delegationCeiling(tx,actor.workspaceId,actor.principalId);if(!ceiling||!grantsCover(ceiling.scopes,ceiling.projects,outcome.data.credential.scopes,outcome.data.credential.project_ids))throw new HttpError('FORBIDDEN',403);},
 execute(tx,ctx,body){const data=issueCredential(tx,ctx,body,prepared);return {outcome:{status:201,data},event:{type:'credential.issued',resourceType:'credential',resourceId:data.credential.id,resourceVersion:null,threadId:null}};}
};}
export function revokeCredentialCommand(id:string):CommandDescriptor<CredentialRevokeRequest,Credential>{return {
 operation:'credentials:manage',target:'credentials:'+id+':revoke',resource:()=>undefined,
 checkAccess(tx,ctx){const actor=credentialAccess(tx,ctx.actor,ctx.nowMs);assertCredentialVisible(tx,actor,credentialRecord(tx,actor.workspaceId,id));},
 checkReplay(tx,ctx,_body,outcome){const actor=credentialAccess(tx,ctx.actor,ctx.nowMs);assertCredentialVisible(tx,actor,credentialRecord(tx,actor.workspaceId,id));if(!validateCredential(outcome.data)||outcome.data.id!==id||outcome.data.workspace_id!==actor.workspaceId)throw new HttpError('INTERNAL_ERROR',500);const ceiling=delegationCeiling(tx,actor.workspaceId,actor.principalId);if(!ceiling||!grantsCover(ceiling.scopes,ceiling.projects,outcome.data.scopes,outcome.data.project_ids))throw new HttpError('FORBIDDEN',403);},
 execute(tx,ctx,body){const data=revokeCredential(tx,ctx,id,body);return {outcome:{status:200,data},event:{type:'credential.revoked',resourceType:'credential',resourceId:data.id,resourceVersion:null,threadId:null}};}
};}
