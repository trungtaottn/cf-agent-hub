import type {WorkspaceTransaction} from '../storage/transaction';
import type {TaskRow} from '../tasks/repository';
import type {RunRow} from '../tasks/lease';
import {approvalRecord,assertDecisionHead,assertStoredApprovedProvenance,type ProposalRow} from './repository';
import {parsePersistedBinding} from './stored-validation';
import {HttpError} from '../http/envelopes';
/** Provenance only: callers independently authenticate the current settlement actor/run.
 * Original approval expiry is deliberately not renewed or required for settlement.
 * This check cannot authorize a new claim or external dispatch. */
export function assertBoundDecisionRun(tx:WorkspaceTransaction,task:TaskRow,run:RunRow,nowMs:number){
 if(task.approval_id===null)return null;
 let approval:ReturnType<typeof approvalRecord>;
 try{approval=approvalRecord(tx,task.workspace_id,task.approval_id);}
 catch(error){
  // A dangling internal reference is an unavailable settlement dependency;
  // public approval lookups retain NOT_FOUND and other failures stay unchanged.
  if(error instanceof HttpError&&error.code==='NOT_FOUND'&&error.status===404)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  throw error;
 }
 const head=assertDecisionHead(tx,task,approval,nowMs);
 const stored=tx.one<ProposalRow>('SELECT * FROM decision_proposals WHERE workspace_id=? AND id=?',[task.workspace_id,approval.proposal_id]);
 if(!stored)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 const binding=parsePersistedBinding(stored.binding_json),checkpoint=tx.one<{task_id:string;run_id:string;checkpoint_json:string}>('SELECT task_id,run_id,checkpoint_json FROM decision_checkpoints WHERE workspace_id=? AND id=?',[task.workspace_id,approval.checkpoint_id]);
 const paused=tx.one<{task_id:string;agent_id:string;credential_id:string;status:string;fence:number;ended_at:number|null}>('SELECT task_id,agent_id,credential_id,status,fence,ended_at FROM runs WHERE workspace_id=? AND id=?',[task.workspace_id,approval.run_id]);
 const last=tx.one<{run_id:string|null}>('SELECT run_id FROM decision_lifecycle_transitions WHERE workspace_id=? AND approval_id=? AND id=?',[task.workspace_id,approval.id,head.last_transition_id]);
 if(![task.next_fence,run.run_version].every(n=>Number.isSafeInteger(n)&&n>0)||![run.started_at,run.lease_expires_at,...(run.ended_at===null?[]:[run.ended_at])].every(n=>Number.isSafeInteger(n)&&n>=0)||approval.status!=='approved'||approval.task_id!==task.id||approval.consumed_run_id!==run.id||approval.consumed_fence!==run.fence||run.id===approval.run_id||run.workspace_id!==task.workspace_id||run.task_id!==task.id||task.latest_run_id!==run.id||!Number.isSafeInteger(run.fence)||run.fence<1||task.next_fence!==run.fence+1||last?.run_id!==run.id||
  !paused||paused.task_id!==task.id||paused.status!=='paused'||paused.ended_at!==approval.created_at||!Number.isSafeInteger(paused.fence)||paused.fence<1||paused.fence>=run.fence||
  stored.task_id!==task.id||stored.proposal_version!==approval.proposal_version||task.proposal_version!==approval.proposal_version||binding.workspaceId!==task.workspace_id||binding.taskId!==task.id||binding.taskVersion!==approval.task_version_at_request||binding.taskProposalVersion+1!==approval.proposal_version||stored.proposal_json!==binding.proposalCanonicalJson||!checkpoint||checkpoint.task_id!==task.id||checkpoint.run_id!==approval.run_id||checkpoint.checkpoint_json!==binding.checkpointCanonicalJson||
  (task.state==='doing'?(task.active_run_id!==run.id||run.status!=='active'||run.ended_at!==null):task.state==='review'?(task.active_run_id!==null||run.status!=='submitted'||run.ended_at===null):true))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 assertStoredApprovedProvenance(approval,binding,paused);
 if(run.started_at<approval.decided_at!||run.started_at>nowMs||run.started_at>=approval.expires_at||run.lease_expires_at<=run.started_at||run.ended_at!==null&&(run.ended_at<run.started_at||run.ended_at>nowMs))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 // Fixed first-consumption anchor, NOT a lifetime transition-count cap. The closed
 // grammar is request(1), approve(2), first claim(3); any future grammar expansion
 // must review this producer/consumer invariant rather than scanning history.
 const claim=tx.one<{task_id:string;run_id:string|null;kind:string;before_version:number;after_version:number;before_state:string;after_state:string;created_at:number}>('SELECT task_id,run_id,kind,before_version,after_version,before_state,after_state,created_at FROM decision_lifecycle_transitions WHERE workspace_id=? AND approval_id=? AND sequence=3',[task.workspace_id,approval.id]);
 const before=approval.task_version_at_request+2,after=before+1;
 if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after)||!claim||claim.task_id!==task.id||claim.run_id!==run.id||claim.kind!=='claim'||claim.before_state!=='ready'||claim.after_state!=='doing'||claim.before_version!==before||claim.after_version!==after||claim.created_at!==run.started_at)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 return head;
}
