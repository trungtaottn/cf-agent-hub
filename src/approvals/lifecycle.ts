import type {WorkspaceTransaction} from '../storage/transaction';
import type {LifecycleHead} from './repository';
import {validDecisionTransition} from './stored-validation';
import {nextRunVersion} from '../tasks/lease';
import {HttpError} from '../http/envelopes';
/** Caller already authenticated exact current head; no repair/reset or history scan. */
export function appendDecisionTransition(tx:WorkspaceTransaction,head:LifecycleHead,id:string,kind:string,state:string,version:number,runId:string|null,nowMs:number):void{
 if(!validDecisionTransition(kind,head.task_state,state)||version!==nextRunVersion(head.task_version)||!Number.isSafeInteger(nowMs)||nowMs<0)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 const sequence=nextRunVersion(head.transition_count);
 tx.exec('INSERT INTO decision_lifecycle_transitions(id,workspace_id,approval_id,task_id,sequence,kind,before_version,after_version,before_state,after_state,run_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[id,head.workspace_id,head.approval_id,head.task_id,sequence,kind,head.task_version,version,head.task_state,state,runId,nowMs]);
 tx.exec('UPDATE decision_lifecycle_heads SET task_version=?,task_state=?,transition_count=?,last_transition_id=? WHERE workspace_id=? AND approval_id=?',[version,state,sequence,id,head.workspace_id,head.approval_id]);
}
