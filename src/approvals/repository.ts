import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import type {Approval,TaskState} from '../http/dto';
import {parseDecisionActor,parseReviewerIds,parseSemanticAnchor,validDecisionTransition,type PersistedDecisionBinding} from './stored-validation';
export type {PersistedDecisionBinding} from './stored-validation';
import {canonicalJson} from '../config/bootstrap';
import {validateApproval} from '../http/generated/decision-validators.js';
import {HttpError} from '../http/envelopes';
import {assertStoredScalarBytes,assertTaskItemFits} from '../tasks/bounds';
import {taskAccess,taskRecord,type TaskRow} from '../tasks/repository';
import {assertResourceReferences,actorResourceGrant} from '../auth/resource-visibility';
export interface ApprovalRow {id:string;workspace_id:string;task_id:string;run_id:string;checkpoint_id:string;proposal_id:string;approval_version:number;proposal_version:number;task_version_at_request:number;status:Approval['status'];reviewer_ids_json:string;requested_by_json:string;created_at:number;expires_at:number;decided_at:number|null;decided_by_json:string|null;decision_reason:string|null;consumed_run_id:string|null;consumed_fence:number|null;expiry_hold_code:'DECISION_STATE_INVALID'|null;}
export interface ProposalRow {id:string;workspace_id:string;task_id:string;proposal_version:number;proposal_json:string;binding_json:string;semantic_anchor_json:string;created_at:number;}
/** Serialized immutable identities are provenance records, NEVER private verifier receipts. */

export function semanticAnchor(row:TaskRow):string{return canonicalJson({id:row.id,workspace_id:row.workspace_id,title:row.title,description:row.description,project_id:row.project_id,work_role_id:row.work_role_id,assigned_agent_id:row.assigned_agent_id,retry_limit:row.retry_limit,created_at:row.created_at});}
export function approvalRecord(tx:WorkspaceTransaction,workspaceId:string,id:string):ApprovalRow {
 const size=tx.one<{bytes:number}>('SELECT length(CAST(reviewer_ids_json AS BLOB))+length(CAST(requested_by_json AS BLOB))+coalesce(length(CAST(decided_by_json AS BLOB)),0)+coalesce(length(CAST(decision_reason AS BLOB)),0) AS bytes FROM approvals WHERE workspace_id=? AND id=?',[workspaceId,id]);
 if(!size)throw new HttpError('NOT_FOUND',404);assertStoredScalarBytes(size.bytes);
 return tx.one<ApprovalRow>('SELECT * FROM approvals WHERE workspace_id=? AND id=?',[workspaceId,id])!;
}
export function approvalView(tx:WorkspaceTransaction,actor:ActorContext,row:ApprovalRow,nowMs:number):Approval {
 taskAccess(tx,actor,'tasks:read',row.task_id,nowMs);
 const stored=tx.one<{checkpoint_json:string;proposal_json:string}>('SELECT c.checkpoint_json,p.proposal_json FROM decision_checkpoints c JOIN decision_proposals p ON p.workspace_id=c.workspace_id AND p.task_id=c.task_id WHERE c.workspace_id=? AND c.id=? AND p.id=?',[row.workspace_id,row.checkpoint_id,row.proposal_id]);
 if(!stored)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 assertStoredScalarBytes(new TextEncoder().encode(stored.checkpoint_json+stored.proposal_json).length);
 const result:Approval={id:row.id,workspace_id:row.workspace_id,task_id:row.task_id,run_id:row.run_id,approval_version:row.approval_version,proposal_version:row.proposal_version,task_version_at_request:row.task_version_at_request,status:row.status,checkpoint:JSON.parse(stored.checkpoint_json),proposal:JSON.parse(stored.proposal_json),assigned_human_principal_ids:[...parseReviewerIds(row.reviewer_ids_json)],requested_by:parseDecisionActor(row.requested_by_json),created_at:new Date(row.created_at).toISOString(),expires_at:new Date(row.expires_at).toISOString(),decided_at:row.decided_at===null?null:new Date(row.decided_at).toISOString(),decided_by:row.decided_by_json===null?null:parseDecisionActor(row.decided_by_json),decision_reason:row.decision_reason};
 if(!validateApproval(result))throw new HttpError('INTERNAL_ERROR',500);assertTaskItemFits(result);return result;
}
/** Exact returned artifacts remain separately authorized, including historical command replay. */
export function assertApprovalOutcomeVisible(tx:WorkspaceTransaction,actor:ActorContext,approval:Approval,nowMs:number):void {
 if(!validateApproval(approval)||approval.workspace_id!==actor.workspaceId)throw new HttpError('INTERNAL_ERROR',500);
 const row=approvalRecord(tx,actor.workspaceId,approval.id),current=approvalView(tx,actor,row,nowMs);
 if(current.task_id!==approval.task_id||current.run_id!==approval.run_id||canonicalJson(current.checkpoint)!==canonicalJson(approval.checkpoint)||canonicalJson(current.proposal)!==canonicalJson(approval.proposal))throw new HttpError('INTERNAL_ERROR',500);
 assertResourceReferences(tx,actorResourceGrant(actor),[{kind:'task',id:row.task_id},...[...new Set([...approval.checkpoint.artifact_ids,...approval.proposal.artifact_ids,approval.proposal.inputs.artifact_id])].map(id=>({kind:'artifact' as const,id}))]);
}
export interface LifecycleHead {workspace_id:string;approval_id:string;task_id:string;task_version:number;task_state:TaskState;transition_count:number;last_transition_id:string;}
/** Constant indexed head/last transition validation; no full history scan or count cap. */
export function assertDecisionHead(tx:WorkspaceTransaction,row:TaskRow,approval:ApprovalRow,nowMs:number):LifecycleHead {
 const head=tx.one<LifecycleHead>('SELECT * FROM decision_lifecycle_heads WHERE workspace_id=? AND approval_id=?',[row.workspace_id,approval.id]);
 const proposal=tx.one<{semantic_anchor_json:string}>('SELECT semantic_anchor_json FROM decision_proposals WHERE workspace_id=? AND id=?',[row.workspace_id,approval.proposal_id]);
 if(proposal)parseSemanticAnchor(proposal.semantic_anchor_json);
 const last=head?tx.one<{sequence:number;task_id:string;kind:string;before_version:number;before_state:string;after_version:number;after_state:string;run_id:string|null;created_at:number}>('SELECT sequence,task_id,kind,before_version,before_state,after_version,after_state,run_id,created_at FROM decision_lifecycle_transitions WHERE workspace_id=? AND approval_id=? AND id=?',[row.workspace_id,approval.id,head.last_transition_id]):null;
 if(!Number.isSafeInteger(nowMs)||nowMs<0||!head||!proposal||!last||last.created_at>nowMs||![head.task_version,head.transition_count,last.sequence,last.before_version,last.after_version].every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isSafeInteger(last.created_at)||last.created_at<approval.created_at||last.task_id!==row.id||last.before_version+1!==last.after_version||!validDecisionTransition(last.kind,last.before_state,last.after_state)||(last.sequence===1)!==(last.kind==='request')||last.sequence===1&&(last.before_version!==approval.task_version_at_request||last.before_state!=='doing'||last.after_state!=='waiting'||last.run_id!==approval.run_id||last.created_at!==approval.created_at)||row.approval_id!==approval.id||head.task_id!==row.id||head.task_version!==row.task_version||head.task_state!==row.state||last.sequence!==head.transition_count||last.after_version!==head.task_version||last.after_state!==head.task_state||proposal.semantic_anchor_json!==semanticAnchor(row))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 if(tx.one('SELECT 1 FROM decision_lifecycle_transitions WHERE workspace_id=? AND approval_id=? AND sequence>? LIMIT 1',[row.workspace_id,approval.id,head.transition_count]))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 return head;
}

/** Immutable stored provenance only, never reconstructed actor authority. Current
 * caller/session/runtime/grants are independently checked by each consuming lane. */
export function assertStoredApprovedProvenance(row:ApprovalRow,binding:PersistedDecisionBinding,paused:{agent_id:string;credential_id:string}):void{
 const requester=parseDecisionActor(row.requested_by_json),assigned=parseReviewerIds(row.reviewer_ids_json),decider=row.decided_by_json===null?null:parseDecisionActor(row.decided_by_json);
 if(row.status!=='approved'||requester.kind!=='agent'||requester.principal_id!==binding.requestedBy.principalId||requester.agent_id!==requester.principal_id||paused.agent_id!==requester.agent_id||paused.credential_id!==binding.requestedBy.credentialId||decider?.kind!=='human'||!assigned.includes(decider.principal_id)||row.decided_at===null||!Number.isSafeInteger(row.decided_at)||row.decided_at<row.created_at||row.decided_at>=row.expires_at)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
}
