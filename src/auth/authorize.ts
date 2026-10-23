import type { WorkspaceTransaction } from '../storage/transaction';
import type { VerifiedIdentity,ActorContext,ResourceAccess } from '../workspace/context';
import { deny,AuthError } from './context';
export interface SessionRecord {id:string;workspace_id:string;principal_id:string;issuer:string;subject:string;expires_at:number;revoked_at:number|null;auth_epoch:number;}
/** Synchronous current-authority check, including the original session, on every command/replay. */
export function resolveActor(tx:WorkspaceTransaction,identity:VerifiedIdentity,nowMs:number):ActorContext {
 if(identity.kind!=='human')deny();
 const human=identity as Extract<VerifiedIdentity,{kind:'human'}>;
 const row=tx.one<SessionRecord & {config_epoch:number;admission_state:string;enabled:number;grant_epoch:number;scopes_json:string;project_ids_json:string}>(
  `SELECT s.*,m.config_epoch,m.admission_state,g.enabled,g.config_epoch AS grant_epoch,g.scopes_json,g.project_ids_json
   FROM sessions s JOIN workspace_metadata m ON m.workspace_id=s.workspace_id
   JOIN human_grants g ON g.principal_id=s.principal_id AND g.workspace_id=s.workspace_id AND g.issuer=s.issuer AND g.subject=s.subject
   WHERE s.id=? AND s.workspace_id=? AND s.issuer=? AND s.subject=?`,[human.sessionId,human.workspaceId,human.issuer,human.subject]);
 if(!row||row.revoked_at!==null||row.expires_at<=nowMs||row.admission_state!=='installed'||row.enabled!==1||row.auth_epoch<=0||row.auth_epoch!==row.config_epoch||row.grant_epoch!==row.config_epoch)deny();
 return {workspaceId:row!.workspace_id,principalId:row!.principal_id,kind:'human',agentId:null,scopes:new Set(JSON.parse(row!.scopes_json) as string[]),projectIds:JSON.parse(row!.project_ids_json) as string[]|null,credentialId:null,runtimeId:null,sessionId:row!.id};
}
/** Domain callers pass their trusted command time, and receive freshly resolved authority. */
export function authorize(tx:WorkspaceTransaction,actor:ActorContext,operation:string,resource?:ResourceAccess,nowMs=Date.now()):void {
 if(actor.kind!=='human'||!actor.sessionId)deny();
 const session=tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=?',[actor.sessionId]);if(!session)deny();
 const live=resolveActor(tx,{kind:'human',issuer:session!.issuer,subject:session!.subject,workspaceId:actor.workspaceId,sessionId:actor.sessionId!},nowMs);
 if(live.principalId!==actor.principalId||!live.scopes.has(operation)||resource&&live.projectIds!==null&&(resource.projectId===null||!live.projectIds.includes(resource.projectId)))throw new AuthError('FORBIDDEN',403);
}
