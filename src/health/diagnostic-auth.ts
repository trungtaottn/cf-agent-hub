import {sha256} from '../config/bootstrap';
import {parseDeployment,type DeploymentConfig} from '../config/deployment';
import {AuthError,deny,readCookie,type AuthWorkspace} from '../auth/context';
import type {ActorContext,VerifiedIdentity} from '../workspace/context';
import type {SessionRecord} from '../auth/authorize';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {HttpError,securityHeaders,toHttpError,toHttpResponse} from '../http/envelopes';

interface DiagnosticConfiguration {config:DeploymentConfig;epoch:number;installationDigest:string;admissionState:'installed'|'maintenance'|'retired';}
/** Read-only diagnostics can inspect paused authority. This does not authorize
 * ordinary commands, login, session mutation, native access or maintenance exit. */
export function diagnosticConfiguration(tx:WorkspaceTransaction,workspace:AuthWorkspace):DiagnosticConfiguration{
 const row=tx.one<{workspace_id:string;object_name:string;config_epoch:number;config_json:string;installation_digest:string;admission_state:DiagnosticConfiguration['admissionState']}>('SELECT workspace_id,object_name,config_epoch,config_json,installation_digest,admission_state FROM workspace_metadata WHERE id=1');
 if(!row||row.workspace_id!==workspace.workspaceId||row.object_name!==workspace.objectName||!['installed','maintenance','retired'].includes(row.admission_state))deny();
 let config:DeploymentConfig;try{config=parseDeployment(JSON.parse(row!.config_json));}catch{throw new HttpError('DEPENDENCY_UNAVAILABLE',503);}
 if(config.config_epoch!==row!.config_epoch||!config.workspace_catalog.some(x=>x.workspace_id===workspace.workspaceId&&x.object_name===workspace.objectName))deny();
 return {config,epoch:row!.config_epoch,installationDigest:row!.installation_digest,admissionState:row!.admission_state};
}
export function resolveDiagnosticActor(tx:WorkspaceTransaction,workspace:AuthWorkspace,identity:VerifiedIdentity,nowMs:number):ActorContext{
 if(identity.kind!=='human'||identity.workspaceId!==workspace.workspaceId)throw new AuthError('FORBIDDEN',403);
 const installed=diagnosticConfiguration(tx,workspace);
 const row=tx.one<SessionRecord & {enabled:number;grant_epoch:number;scopes_json:string;project_ids_json:string}>(
  `SELECT s.*,g.enabled,g.config_epoch AS grant_epoch,g.scopes_json,g.project_ids_json
   FROM sessions s JOIN human_grants g ON g.principal_id=s.principal_id AND g.workspace_id=s.workspace_id AND g.issuer=s.issuer AND g.subject=s.subject
   WHERE s.id=? AND s.workspace_id=? AND s.issuer=? AND s.subject=?`,[identity.sessionId,workspace.workspaceId,identity.issuer,identity.subject]);
 if(!row||row.revoked_at!==null||row.expires_at<=nowMs||row.enabled!==1||row.auth_epoch!==installed.epoch||row.grant_epoch!==installed.epoch||row.issuer!==installed.config.authentication.issuer)deny();
 const scopes=new Set<string>(JSON.parse(row!.scopes_json)),projectIds=JSON.parse(row!.project_ids_json) as string[]|null;
 if(!scopes.has('operations:read')||projectIds!==null)throw new AuthError('FORBIDDEN',403);
 return {workspaceId:workspace.workspaceId,principalId:row!.principal_id,kind:'human',agentId:null,scopes,projectIds,credentialId:null,runtimeId:null,sessionId:row!.id};
}
/** Recheck an internal projection caller against current SQL; cached scopes
 * alone never grant the diagnostic exception. */
export function recheckDiagnosticActor(tx:WorkspaceTransaction,workspace:AuthWorkspace,actor:ActorContext,nowMs:number):ActorContext{
 if(actor.kind!=='human'||!actor.sessionId)throw new AuthError('FORBIDDEN',403);
 const session=tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=? AND workspace_id=?',[actor.sessionId,workspace.workspaceId]);if(!session)deny();
 const live=resolveDiagnosticActor(tx,workspace,{kind:'human',workspaceId:workspace.workspaceId,sessionId:session!.id,issuer:session!.issuer,subject:session!.subject},nowMs);
 if(live.principalId!==actor.principalId)deny();return live;
}
export async function diagnosticResponse<T>(request:Request,workspace:AuthWorkspace,project:(tx:WorkspaceTransaction,actor:ActorContext,nowMs:number)=>T):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);
 try{
  const url=new URL(request.url);if(request.method!=='GET')throw new HttpError('NOT_FOUND',404);
  if(url.searchParams.size)throw new HttpError('INVALID_REQUEST',400);
  const cookie=request.headers.get('cookie');
  if(request.headers.has('authorization')&&cookie?.split(';').some(x=>x.trim().startsWith('cfhub_session=')))throw new HttpError('INVALID_REQUEST',400);
  if(request.headers.has('authorization'))throw new AuthError('FORBIDDEN',403);
  const token=readCookie(cookie,'cfhub_session');if(!token)deny();
  const digest=await sha256(token!);
  const data=withTransaction(workspace.storage,tx=>{
   const installed=diagnosticConfiguration(tx,workspace);
   const redirect=installed.config.authentication.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
   const origin=new URL(redirect.redirect_uri).origin;
   if(url.origin!==origin||request.headers.has('origin')&&(request.headers.get('origin')!==origin||!installed.config.authentication.allowed_origins.includes(origin)))throw new AuthError('FORBIDDEN',403);
   if(request.headers.has('origin')){headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');}
   const session=tx.one<SessionRecord>('SELECT * FROM sessions WHERE token_digest=? AND workspace_id=?',[digest,workspace.workspaceId]);if(!session)deny();
   const nowMs=workspace.clock.nowMs();
   const actor=resolveDiagnosticActor(tx,workspace,{kind:'human',workspaceId:workspace.workspaceId,sessionId:session!.id,issuer:session!.issuer,subject:session!.subject},nowMs);
   return project(tx,actor,nowMs);
  });
  return toHttpResponse({status:200,data},requestId,headers);
 }catch(error){return toHttpError(error,requestId,headers);}
}
