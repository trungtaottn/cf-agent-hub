import {uniqueNativeCredential} from './native-token-lookup';
import {credentialGrantAllowed,type CredentialAuthorityRow} from './credential-authority';
import {admissionOpen} from '../recovery/maintenance';
import type { WorkspaceTransaction } from '../storage/transaction';
import type { VerifiedIdentity,ActorContext,ResourceAccess } from '../workspace/context';
import { deny,AuthError } from './context';
export interface SessionRecord {id:string;workspace_id:string;principal_id:string;issuer:string;subject:string;expires_at:number;revoked_at:number|null;auth_epoch:number;}
/** Synchronous current-authority check, including the original session, on every command/replay. */
export function resolveActor(tx:WorkspaceTransaction,identity:VerifiedIdentity,nowMs:number):ActorContext {
 if(!admissionOpen(tx))deny();
 if(identity.kind==='agent') {
  // Recheck ambiguity at every current-authority boundary, including after async crypto.
  if(uniqueNativeCredential(tx,identity.workspaceId,identity.tokenDigest)!==identity.credentialId)deny();
  const row=tx.one<NativeRecord>(`SELECT c.*,m.config_epoch AS installed_epoch,m.admission_state,a.config_epoch AS agent_epoch
   FROM native_credentials c JOIN workspace_metadata m ON m.workspace_id=c.workspace_id
   JOIN static_agents a ON a.agent_id=c.agent_id AND a.workspace_id=c.workspace_id
   WHERE c.credential_id=? AND c.workspace_id=?`,[identity.credentialId,identity.workspaceId]);
  if(!row||!credentialGrantAllowed(tx,row,nowMs)||row.enabled!==1||row.retired_at_epoch!==null||row.expires_at<=nowMs||row.admission_state!=='installed'||row.config_epoch!==row.installed_epoch||row.agent_epoch!==row.installed_epoch||!equalDigest(identity.tokenDigest,row.token_sha256))deny();
  return {workspaceId:row!.workspace_id,principalId:row!.agent_id,kind:'agent',agentId:row!.agent_id,scopes:new Set(JSON.parse(row!.scopes_json) as string[]),projectIds:JSON.parse(row!.project_ids_json) as string[]|null,credentialId:row!.credential_id,runtimeId:null,sessionId:null};
 }
 const human=identity as Extract<VerifiedIdentity,{kind:'human'}>;
 const row=tx.one<SessionRecord & {config_epoch:number;admission_state:string;enabled:number;grant_epoch:number;scopes_json:string;project_ids_json:string}>(
  `SELECT s.*,m.config_epoch,m.admission_state,g.enabled,g.config_epoch AS grant_epoch,g.scopes_json,g.project_ids_json
   FROM sessions s JOIN workspace_metadata m ON m.workspace_id=s.workspace_id
   JOIN human_grants g ON g.principal_id=s.principal_id AND g.workspace_id=s.workspace_id AND g.issuer=s.issuer AND g.subject=s.subject
   WHERE s.id=? AND s.workspace_id=? AND s.issuer=? AND s.subject=?`,[human.sessionId,human.workspaceId,human.issuer,human.subject]);
 if(!row||row.revoked_at!==null||row.expires_at<=nowMs||row.admission_state!=='installed'||row.enabled!==1||row.auth_epoch<=0||row.auth_epoch!==row.config_epoch||row.grant_epoch!==row.config_epoch)deny();
 return {workspaceId:row!.workspace_id,principalId:row!.principal_id,kind:'human',agentId:null,scopes:new Set(JSON.parse(row!.scopes_json) as string[]),projectIds:JSON.parse(row!.project_ids_json) as string[]|null,credentialId:null,runtimeId:null,sessionId:row!.id};
}
/** Refresh an internal actor before passing current grants to a resource visibility predicate. */
export function refreshActor(tx:WorkspaceTransaction,actor:ActorContext,nowMs:number):ActorContext {
 let live:ActorContext;
 if(actor.kind==='agent') {
  if(!actor.credentialId||actor.sessionId!==null||actor.runtimeId!==null)deny();
  const credential=tx.one<{token_sha256:string}>('SELECT token_sha256 FROM native_credentials WHERE credential_id=? AND workspace_id=?',[actor.credentialId,actor.workspaceId]);if(!credential)deny();
  live=resolveActor(tx,{kind:'agent',workspaceId:actor.workspaceId,credentialId:actor.credentialId!,tokenDigest:credential!.token_sha256},nowMs);
  if(live.agentId!==actor.agentId)deny();
 } else {
 if(!actor.sessionId)deny();
 const session=tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=?',[actor.sessionId]);if(!session)deny();
 live=resolveActor(tx,{kind:'human',issuer:session!.issuer,subject:session!.subject,workspaceId:actor.workspaceId,sessionId:actor.sessionId!},nowMs);
 }
 if(live.principalId!==actor.principalId)throw new AuthError('FORBIDDEN',403);
 return live;
}
/** Domain callers pass their trusted command time; no cached actor grants authority. */
export function authorize(tx:WorkspaceTransaction,actor:ActorContext,operation:string,resource?:ResourceAccess,nowMs=Date.now()):void {
 const live=refreshActor(tx,actor,nowMs);
 if(!live.scopes.has(operation)||resource&&live.projectIds!==null&&(resource.projectId===null||!live.projectIds.includes(resource.projectId)))throw new AuthError('FORBIDDEN',403);
}

interface NativeRecord extends CredentialAuthorityRow {
 credential_id:string;workspace_id:string;agent_id:string;token_sha256:string;scopes_json:string;project_ids_json:string;
 expires_at:number;enabled:number;retired_at_epoch:number|null;config_epoch:number;installed_epoch:number;agent_epoch:number;admission_state:string;
}
function equalDigest(a:string,b:string):boolean {
 if(!/^[a-f0-9]{64}$/.test(a)||!/^[a-f0-9]{64}$/.test(b))return false;
 const bytes=(s:string)=>Uint8Array.from(s.match(/../g)!,x=>parseInt(x,16));
 // Workers supports this native primitive; Node's test ambient types omit its extension.
 const subtle=crypto.subtle as SubtleCrypto & {timingSafeEqual(a:ArrayBufferView,b:ArrayBufferView):boolean};
 return subtle.timingSafeEqual(bytes(a),bytes(b));
}
