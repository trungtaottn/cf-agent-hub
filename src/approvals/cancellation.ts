import type {WorkspaceTransaction} from '../storage/transaction';
import type {TaskRow} from '../tasks/repository';
import {nextRunVersion} from '../tasks/lease';
import {isCompletedRestoreDecisionHead} from '../recovery/decision-provenance';
import {approvalRecord,assertDecisionHead,type LifecycleHead} from './repository';
import {appendDecisionTransition} from './lifecycle';
import {markSchedulerDirty} from '../outbox/scheduler-state';
import {HttpError} from '../http/envelopes';
/** Existing task-cancel authorization precedes this atomic invalidation. No bytes or new grant. */
export function cancelBoundDecision(tx:WorkspaceTransaction,task:TaskRow,taskVersion:number,eventId:string|undefined,nowMs:number):void{
 if(task.approval_id===null)return;
 if(!eventId)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 const approval=approvalRecord(tx,task.workspace_id,task.approval_id);let head:LifecycleHead;
 try{head=assertDecisionHead(tx,task,approval,nowMs);}catch{
  const prior=tx.one<LifecycleHead>('SELECT * FROM decision_lifecycle_heads WHERE workspace_id=? AND approval_id=?',[task.workspace_id,approval.id]);
  if(!prior||!isCompletedRestoreDecisionHead(tx,{...task},{...prior},{...approval},nowMs))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  // Historical row observation only, not an actor or authority reconstruction. Verify
  // immutable anchor/last transition before admitting the exact completed-restore gap.
  assertDecisionHead(tx,{...task,task_version:prior.task_version,state:prior.task_state},approval,nowMs);
  // No head write/reset: cancellation records the actual restored before tuple and
  // keeps the original predecessor/count. Recovery authenticates this one-step gap.
  head={...prior,task_version:task.task_version,task_state:task.state};
 }
 if(approval.status==='pending'||approval.status==='approved'){
  tx.exec("UPDATE approvals SET status='invalidated',approval_version=? WHERE workspace_id=? AND id=?",[nextRunVersion(approval.approval_version),task.workspace_id,approval.id]);
 }
 appendDecisionTransition(tx,head,eventId,'cancel','cancelled',taskVersion,task.active_run_id,nowMs);markSchedulerDirty(tx);
}
