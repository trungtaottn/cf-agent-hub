import type {WorkspaceTransaction,SqlValue} from '../storage/transaction';
import {assertAdmissionOpen} from '../recovery/maintenance';
import {HttpError} from '../http/envelopes';
import {taskRecord} from '../tasks/repository';
import {nextRunVersion,runRecord} from '../tasks/lease';
import {approvalRecord,assertDecisionHead,type ProposalRow} from './repository';
import {parsePersistedBinding,parseReviewerIds,parseDecisionActor,parseSemanticAnchor} from './stored-validation';
import {decisionExpiry} from './contracts';
import {appendDecisionTransition} from './lifecycle';
import {appendDecisionExpiryEvent} from '../audit/events';
import {markSchedulerDirty} from '../outbox/scheduler-state';
import {canonicalJson} from '../config/bootstrap';
import {parseDeployment} from '../config/deployment';
class InvalidDecisionState extends Error {constructor(){super('DECISION_STATE_INVALID');}}
class OperationalReadFailure {constructor(readonly original:unknown){}}
function invalid():never{throw new InvalidDecisionState();}
/** These callbacks contain only deterministic shape/parser/arithmetic checks, never SQL. */
function pure<T>(check:()=>T):T{try{return check();}catch{return invalid();}}
/** Record helpers combine bounded SQL with structural checks. Preserve read failures
 * (even an HttpError with an identical code) before classifying known helper outputs. */
function storedRead<T>(tx:WorkspaceTransaction,read:(guarded:WorkspaceTransaction)=>T,head=false):T{
 const guarded:WorkspaceTransaction={
  one:<R>(sql:string,bindings?:readonly SqlValue[])=>{try{return tx.one<R>(sql,bindings);}catch(error){throw new OperationalReadFailure(error);}},
  all:<R>(sql:string,bindings?:readonly SqlValue[])=>{try{return tx.all<R>(sql,bindings);}catch(error){throw new OperationalReadFailure(error);}},
  exec:()=>{throw Error('UNEXPECTED_EXPIRY_PLAN_WRITE');}
 };
 try{return read(guarded);}catch(error){
  if(error instanceof OperationalReadFailure)throw error.original;
  // The exact helpers below emit only missing-row/scalar-bound errors or an
  // explicit head mismatch after their SQL reads. Unknown errors still propagate.
  if(error instanceof HttpError&&(head?error.code==='DEPENDENCY_UNAVAILABLE'&&error.status===503:(error.code==='NOT_FOUND'&&error.status===404)||(error.code==='INTERNAL_ERROR'&&error.status===500)))invalid();
  throw error;
 }
}
function dueRows(tx:WorkspaceTransaction,workspaceId:string,nowMs:number|null,limit:number){
 const deadline=nowMs===null?'':'AND expires_at<=?',bindings=nowMs===null?[workspaceId,limit]:[workspaceId,nowMs,limit];
 return tx.all<{id:string;expires_at:number}>(`WITH pending AS (SELECT id,expires_at FROM approvals WHERE workspace_id=? AND status='pending' AND consumed_run_id IS NULL AND expiry_hold_code IS NULL ${deadline} ORDER BY expires_at,id LIMIT ?), approved AS (SELECT id,expires_at FROM approvals WHERE workspace_id=? AND status='approved' AND consumed_run_id IS NULL AND expiry_hold_code IS NULL ${deadline} ORDER BY expires_at,id LIMIT ?) SELECT id,expires_at FROM pending UNION ALL SELECT id,expires_at FROM approved ORDER BY expires_at,id LIMIT ?`,[...bindings,...bindings,limit]);
}
export function nextApprovalDue(tx:WorkspaceTransaction):number|null{
 const workspaceId=tx.one<{workspace_id:string}>('SELECT workspace_id FROM workspace_metadata WHERE id=1')!.workspace_id;
 return dueRows(tx,workspaceId,null,1)[0]?.expires_at??null;
}
/** Only the installed explicit policy supplies a scheduler budget. No implicit policy activation. */
export function decisionExpiryBatchLimit(tx:WorkspaceTransaction):number|null{
 if((tx.one<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations')?.version??0)<19)return null;
 const row=tx.one<{workspace_id:string;config_json:string}>('SELECT workspace_id,config_json FROM workspace_metadata WHERE id=1');if(!row)return null;
 const policy=parseDeployment(JSON.parse(row.config_json)).workspace_policies.find(p=>p.workspace_id===row.workspace_id)?.decision_policy;
 return policy?.expiry_batch_limit??null;
}
/** No mutation until every expected bounded transition precondition is checked. */
function plan(tx:WorkspaceTransaction,workspaceId:string,id:string,nowMs:number){
 const approval=storedRead(tx,q=>approvalRecord(q,workspaceId,id)),task=storedRead(tx,q=>taskRecord(q,workspaceId,approval.task_id));
 if(!['pending','approved'].includes(approval.status)||approval.consumed_run_id!==null||approval.consumed_fence!==null||approval.expiry_hold_code!==null||approval.expires_at>nowMs||!Number.isSafeInteger(approval.created_at)||approval.created_at<0||!Number.isSafeInteger(approval.expires_at)||approval.expires_at>8640000000000000||approval.expires_at<=approval.created_at||task.active_run_id!==null||task.state!==(approval.status==='pending'?'waiting':'ready'))invalid();
 const proposal=tx.one<ProposalRow>('SELECT * FROM decision_proposals WHERE workspace_id=? AND id=?',[workspaceId,approval.proposal_id]);if(!proposal)invalid();
 pure(()=>parseSemanticAnchor(proposal.semantic_anchor_json));
 const head=storedRead(tx,q=>assertDecisionHead(q,task,approval,nowMs),true);
 const binding=pure(()=>parsePersistedBinding(proposal.binding_json)),reviewers=pure(()=>parseReviewerIds(approval.reviewer_ids_json)),requester=pure(()=>parseDecisionActor(approval.requested_by_json));
 const checkpoint=tx.one<{task_id:string;run_id:string;checkpoint_json:string}>('SELECT task_id,run_id,checkpoint_json FROM decision_checkpoints WHERE workspace_id=? AND id=?',[workspaceId,approval.checkpoint_id]);
 const paused=storedRead(tx,q=>runRecord(q,workspaceId,approval.run_id));
 if(proposal.task_id!==task.id||proposal.proposal_version!==approval.proposal_version||task.proposal_version!==approval.proposal_version||binding.workspaceId!==workspaceId||binding.taskId!==task.id||binding.taskVersion!==approval.task_version_at_request||binding.taskProposalVersion+1!==approval.proposal_version||proposal.proposal_json!==binding.proposalCanonicalJson||!checkpoint||checkpoint.task_id!==task.id||checkpoint.run_id!==approval.run_id||checkpoint.checkpoint_json!==binding.checkpointCanonicalJson||canonicalJson(reviewers)!==canonicalJson(binding.reviewerIds)||requester.kind!=='agent'||requester.principal_id!==binding.requestedBy.principalId||binding.resolvedAt>approval.created_at||approval.created_at>=binding.expiresAt||pure(()=>decisionExpiry(approval.created_at,JSON.parse(binding.policyCanonicalJson).expiry_seconds))!==approval.expires_at||paused.task_id!==task.id||paused.status!=='paused'||paused.ended_at!==approval.created_at||task.latest_run_id!==paused.id)invalid();
 if(approval.status==='pending'?(approval.decided_at!==null||approval.decided_by_json!==null||approval.decision_reason!==null):(approval.decided_at===null||approval.decided_by_json===null||approval.decision_reason===null||pure(()=>parseDecisionActor(approval.decided_by_json!)).kind!=='human'||!Number.isSafeInteger(approval.decided_at)||approval.decided_at<approval.created_at||approval.decided_at>=approval.expires_at))invalid();
 const flags:unknown=pure(()=>JSON.parse(task.flags_json));if(!Array.isArray(flags)||flags.length>3||flags.some(f=>!['outcome_unknown','retry_exhausted','approval_expired'].includes(f)))invalid();
 const taskVersion=pure(()=>nextRunVersion(task.task_version)),approvalVersion=pure(()=>nextRunVersion(approval.approval_version));pure(()=>nextRunVersion(head.transition_count));
 return {approval,task,head,taskVersion,approvalVersion,flags:[...new Set([...flags,'approval_expired'])]};
}
/** Bounded internal counts only. Held corrupt rows remain corrupt for capture and require explicit repair. */
export function expireDueApprovals(tx:WorkspaceTransaction,nowMs:number,limit:number):{processed:number;held:number;nextDueAt:number|null}{
 if(!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(nowMs)||nowMs<0||nowMs>8640000000000000)throw new HttpError('INVALID_REQUEST',400);
 assertAdmissionOpen(tx);const workspaceId=tx.one<{workspace_id:string}>('SELECT workspace_id FROM workspace_metadata WHERE id=1')!.workspace_id;
 const rows=dueRows(tx,workspaceId,nowMs,limit);
 let processed=0,held=0;
 for(const row of rows){
  let p:ReturnType<typeof plan>;
  try{p=plan(tx,workspaceId,row.id,nowMs);}catch(error){
   if(!(error instanceof InvalidDecisionState))throw error;
   // Only validation errors are quarantined. Mutation/event/SQL failures below propagate and roll back.
   tx.exec("UPDATE approvals SET expiry_hold_code='DECISION_STATE_INVALID' WHERE workspace_id=? AND id=? AND expiry_hold_code IS NULL",[workspaceId,row.id]);held++;markSchedulerDirty(tx);continue;
  }
  const eventId='event_'+crypto.randomUUID();
  tx.exec("UPDATE approvals SET status='expired',approval_version=? WHERE workspace_id=? AND id=?",[p.approvalVersion,workspaceId,row.id]);
  tx.exec("UPDATE tasks SET state='waiting',task_version=?,flags_json=?,updated_at=? WHERE workspace_id=? AND id=?",[p.taskVersion,canonicalJson(p.flags),nowMs,workspaceId,p.task.id]);
  appendDecisionTransition(tx,p.head,eventId,'expiry','waiting',p.taskVersion,null,nowMs);
  appendDecisionExpiryEvent(tx,row.id,eventId,nowMs);markSchedulerDirty(tx);processed++;
 }
 return {processed,held,nextDueAt:nextApprovalDue(tx)};
}
