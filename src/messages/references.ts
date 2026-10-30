import {credentialGrantAllowed,type CredentialAuthorityRow} from '../auth/credential-authority';
import {actorResourceGrant,assertDirectReferences,assertResourceReferences,referenceBudget,spendReferenceWork,type ResourceGrant,type ReferenceBudget} from '../auth/resource-visibility';
import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import type {MessageCreateRequest} from '../http/dto';
import {refreshActor} from '../auth/authorize';
import {HttpError} from '../http/envelopes';
export interface Participant{kind:'human'|'agent';id:string;}
interface GrantRow{scopes_json:string;project_ids_json:string;}
export const inaccessible=():never=>{throw new HttpError('NOT_FOUND',404);};
export function threadParticipants(tx:WorkspaceTransaction,workspaceId:string,threadId:string):readonly Participant[]{
 if(!tx.one('SELECT id FROM threads WHERE id=? AND workspace_id=?',[threadId,workspaceId]))return inaccessible();
 const rows=tx.all<{participant_kind:Participant['kind'];participant_id:string}>('SELECT p.participant_kind,p.participant_id FROM thread_participants p JOIN threads t ON t.id=p.thread_id WHERE t.id=? AND t.workspace_id=? LIMIT 1001',[threadId,workspaceId]);
 if(rows.length>1000)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 return rows.map(x=>({kind:x.participant_kind,id:x.participant_id}));
}
export function isParticipant(participants:readonly Participant[],actor:Pick<ActorContext,'kind'|'principalId'|'agentId'>):boolean{
 return participants.some(p=>p.kind===actor.kind&&p.id===(actor.kind==='agent'?actor.agentId:actor.principalId));
}
/** Messages remain workspace-wide even when embedded tasks have a project. */
function hasRead(grant:ResourceGrant):boolean{return grant.scopes.has('messages:read')&&grant.projectIds===null;}
function readGrant(row:GrantRow,workspaceId:string,participant:Participant):ResourceGrant|null{
 try{const scopes:unknown=JSON.parse(row.scopes_json),projects:unknown=JSON.parse(row.project_ids_json);
  if(!Array.isArray(scopes)||!scopes.every(x=>typeof x==='string')||projects!==null&&(!Array.isArray(projects)||!projects.every(x=>typeof x==='string')))return null;
  return {...participant,workspaceId,scopes:new Set(scopes),projectIds:projects as string[]|null};
 }catch{return null;}
}
/** Index seeks only structurally current candidates; full current authority remains canonical.
 * One suitable candidate proves eligibility. A sentinel without proof is an explicit work hold. */
function participantHasGrant(tx:WorkspaceTransaction,workspaceId:string,participant:Participant,nowMs:number,budget:ReferenceBudget,accept:(grant:ResourceGrant)=>boolean):boolean{
 const metadata=tx.one<{config_epoch:number;admission_state:string}>('SELECT config_epoch,admission_state FROM workspace_metadata WHERE id=1 AND workspace_id=?',[workspaceId]);
 if(!metadata||metadata.admission_state!=='installed')return false;
 const rows=participant.kind==='agent'?tx.all<CredentialAuthorityRow>(`SELECT * FROM native_credentials WHERE workspace_id=? AND agent_id=? AND config_epoch=?
  AND enabled=1 AND retired_at_epoch IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY expires_at,credential_id LIMIT 1001`,[workspaceId,participant.id,metadata.config_epoch,nowMs]):
 tx.all<GrantRow>('SELECT scopes_json,project_ids_json FROM human_grants WHERE workspace_id=? AND principal_id=? AND enabled=1 AND config_epoch=? LIMIT 1001',[workspaceId,participant.id,metadata.config_epoch]);
 spendReferenceWork(budget,rows.length);
 for(const row of rows.slice(0,1000)){
  if(participant.kind==='agent'&&!credentialGrantAllowed(tx,row as CredentialAuthorityRow,nowMs))continue;
  const grant=readGrant(row,workspaceId,participant);if(grant&&accept(grant))return true;
 }
 if(rows.length>1000)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);return false;
}
function permitted(check:()=>void):boolean{try{check();return true;}catch(error){if(error instanceof HttpError&&error.code==='NOT_FOUND')return false;throw error;}}
/** Background eligibility; one current grant must satisfy the entire graph. */
export function participantCanReadMessages(tx:WorkspaceTransaction,workspaceId:string,participant:Participant,messageIds:readonly string[],nowMs:number,requiredScope?:string,budget=referenceBudget()):boolean{
 spendReferenceWork(budget);
 return participantHasGrant(tx,workspaceId,participant,nowMs,budget,grant=>hasRead(grant)&&(!requiredScope||grant.scopes.has(requiredScope))&&permitted(()=>assertResourceReferences(tx,grant,messageIds.map(id=>({kind:'message',id})),budget)));
}
export function assertMessageVisible(tx:WorkspaceTransaction,actor:ActorContext,id:string,nowMs:number):void{
 const grant=actorResourceGrant(refreshActor(tx,actor,nowMs));assertResourceReferences(tx,grant,[{kind:'message',id}]);
}
/** Actual caller's proof and each fixed participant are distinct coherent checks. */
export function validateMessageReferences(tx:WorkspaceTransaction,actor:ActorContext,participants:readonly Participant[],refs:MessageCreateRequest['refs'],artifactIds:readonly string[],nowMs=Date.now()):void{
 if(participants.length>1000)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 const budget=referenceBudget(),grant=actorResourceGrant(refreshActor(tx,actor,nowMs));
 if(!hasRead(grant))inaccessible();assertDirectReferences(tx,grant,refs,artifactIds,budget);
 for(const participant of participants){spendReferenceWork(budget);if(!participantHasGrant(tx,actor.workspaceId,participant,nowMs,budget,candidate=>hasRead(candidate)&&permitted(()=>assertDirectReferences(tx,candidate,refs,artifactIds,budget))))inaccessible();}
}
/** Check new reverse edges before the enclosing transaction can commit. */
export function assertAcceptedMessageVisible(tx:WorkspaceTransaction,actor:ActorContext,participants:readonly Participant[],id:string,nowMs:number):void{
 const budget=referenceBudget();assertResourceReferences(tx,actorResourceGrant(refreshActor(tx,actor,nowMs)),[{kind:'message',id}],budget);
 for(const participant of participants)if(!participantCanReadMessages(tx,actor.workspaceId,participant,[id],nowMs,undefined,budget))inaccessible();
}
