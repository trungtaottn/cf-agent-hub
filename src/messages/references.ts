import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import type {MessageCreateRequest} from '../http/dto';
import {refreshActor} from '../auth/authorize';
import {HttpError} from '../http/envelopes';
export interface Participant{kind:'human'|'agent';id:string;}
interface ReadGrant{kind:'human'|'agent';id:string;scopes:ReadonlySet<string>;projectIds:readonly string[]|null;}
interface GrantRow{scopes_json:string;project_ids_json:string;}
export const inaccessible=():never=>{throw new HttpError('NOT_FOUND',404);};
export function threadParticipants(tx:WorkspaceTransaction,workspaceId:string,threadId:string):readonly Participant[]{
 if(!tx.one('SELECT id FROM threads WHERE id=? AND workspace_id=?',[threadId,workspaceId]))return inaccessible();
 return tx.all<{participant_kind:Participant['kind'];participant_id:string}>('SELECT p.participant_kind,p.participant_id FROM thread_participants p JOIN threads t ON t.id=p.thread_id WHERE t.id=? AND t.workspace_id=?',[threadId,workspaceId]).map(x=>({kind:x.participant_kind,id:x.participant_id}));
}
export function isParticipant(participants:readonly Participant[],actor:Pick<ActorContext,'kind'|'principalId'|'agentId'>):boolean{
 return participants.some(p=>p.kind===actor.kind&&p.id===(actor.kind==='agent'?actor.agentId:actor.principalId));
}
/** R1 messages have no project association. Restricted project grants cannot widen to workspace-wide content. */
function hasRead(grant:ReadGrant):boolean{return grant.scopes.has('messages:read')&&grant.projectIds===null;}
function visible(tx:WorkspaceTransaction,workspaceId:string,grant:ReadGrant,id:string):boolean{
 if(!hasRead(grant))return false;
 const row=tx.one<{thread_id:string}>('SELECT m.thread_id FROM messages m JOIN threads t ON t.id=m.thread_id AND t.workspace_id=m.workspace_id WHERE m.id=? AND m.workspace_id=?',[id,workspaceId]);
 return !!row&&(grant.kind==='human'&&grant.scopes.has('messages:review')||!!tx.one('SELECT thread_id FROM thread_participants WHERE thread_id=? AND participant_kind=? AND participant_id=?',[row.thread_id,grant.kind,grant.id]));
}
function readGrant(row:GrantRow,participant:Participant):ReadGrant{
 try{return {...participant,scopes:new Set(JSON.parse(row.scopes_json) as string[]),projectIds:JSON.parse(row.project_ids_json) as string[]|null};}catch{return inaccessible();}
}
/** Eligibility only: these grants never become authentication proofs, sessions or ActorContexts. */
function participantGrants(tx:WorkspaceTransaction,workspaceId:string,participant:Participant,nowMs:number):readonly ReadGrant[]{
 const rows=participant.kind==='agent'?tx.all<GrantRow>(`SELECT c.scopes_json,c.project_ids_json FROM native_credentials c
  JOIN static_agents a ON a.agent_id=c.agent_id AND a.workspace_id=c.workspace_id
  JOIN workspace_metadata m ON m.workspace_id=c.workspace_id AND m.id=1
  WHERE c.workspace_id=? AND c.agent_id=? AND m.admission_state='installed' AND c.enabled=1 AND c.retired_at_epoch IS NULL
  AND c.expires_at>? AND c.config_epoch=m.config_epoch AND a.config_epoch=m.config_epoch`,[workspaceId,participant.id,nowMs]):
 tx.all<GrantRow>(`SELECT g.scopes_json,g.project_ids_json FROM human_grants g JOIN workspace_metadata m ON m.workspace_id=g.workspace_id AND m.id=1
  WHERE g.workspace_id=? AND g.principal_id=? AND g.enabled=1 AND g.config_epoch=m.config_epoch AND m.admission_state='installed'`,[workspaceId,participant.id]);
 return rows.map(r=>readGrant(r,participant));
}
export function assertMessageVisible(tx:WorkspaceTransaction,actor:ActorContext,id:string,nowMs:number):void{
 const live=refreshActor(tx,actor,nowMs),grant:ReadGrant={kind:live.kind,id:live.kind==='agent'?live.agentId!:live.principalId,scopes:live.scopes,projectIds:live.projectIds};
 if(!visible(tx,live.workspaceId,grant,id))inaccessible();
}
/** One coherent credential must satisfy ALL references; never union or authenticate as another participant. */
export function validateMessageReferences(tx:WorkspaceTransaction,actor:ActorContext,participants:readonly Participant[],refs:MessageCreateRequest['refs'],artifactIds:readonly string[],nowMs=Date.now()):void{
 if(artifactIds.length||refs.some(x=>x.kind==='artifact'))throw new HttpError('INVALID_REQUEST',400,{feature:'artifacts'});
 if(refs.some(x=>x.kind==='task'))throw new HttpError('INVALID_REQUEST',400,{feature:'tasks'});
 for(const ref of refs)assertMessageVisible(tx,actor,ref.id,nowMs);
 for(const participant of participants){
  const grants=participantGrants(tx,actor.workspaceId,participant,nowMs);
  if(!grants.some(grant=>hasRead(grant)&&refs.every(ref=>visible(tx,actor.workspaceId,grant,ref.id))))inaccessible();
 }
}
