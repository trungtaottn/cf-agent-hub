/** Restore provenance is historical evidence, not current authorization. */
import type {WorkspaceTransaction,SqlValue} from '../storage/transaction';
import type {Event} from '../http/dto';
import type {CurrentRestoreJob} from './restore-job';
import {isRestoreExpiryEvent} from './restore-audit';
import {isStagedRestoreExpiryEvent} from './restore-audit-history';
type Row=Record<string,SqlValue>;
function expiryBetween(tx:WorkspaceTransaction,a:Row,version:number,earliest:number,latest:number,job?:CurrentRestoreJob):boolean {
 if(a.consumed_run_id===null||!Number.isSafeInteger(version)||!Number.isSafeInteger(earliest)||!Number.isSafeInteger(latest)||earliest>latest)return false;
 const rows=tx.all<Row>("SELECT * FROM events WHERE workspace_id=? AND resource_id=? AND task_version=? AND run_id=? AND type='task.expired' LIMIT 2",[a.workspace_id,a.task_id,version,a.consumed_run_id]);
 if(rows.length!==1)return false;const r=rows[0];
 if(r.fence!==a.consumed_fence||Number(r.occurred_at)<earliest||Number(r.occurred_at)>latest)return false;
 const event={...r,actor:JSON.parse(String(r.actor_json)),occurred_at:new Date(Number(r.occurred_at)).toISOString()} as unknown as Event;
 return isRestoreExpiryEvent(tx,event)||!!job&&isStagedRestoreExpiryEvent(tx,event,job);
}
/** Command callers MUST independently check current actor, tuple and immutable semantic anchor.
 * No staged-job argument exists on this completed-only cancellation gate. */
export function isCompletedRestoreDecisionHead(tx:WorkspaceTransaction,task:Row,head:Row,a:Row,nowMs:number):boolean {
 try{
  if(task.workspace_id!==a.workspace_id||head.workspace_id!==a.workspace_id||task.id!==a.task_id||head.task_id!==a.task_id||head.approval_id!==a.id||task.approval_id!==a.id||task.proposal_version!==a.proposal_version||task.state!=='backlog'||task.active_run_id!==null||task.latest_run_id!==a.consumed_run_id||head.task_state!=='doing'||task.task_version!==Number(head.task_version)+1||!['approved','invalidated'].includes(String(a.status)))return false;
  const flags:unknown=JSON.parse(String(task.flags_json));if(!Array.isArray(flags)||!flags.includes('outcome_unknown'))return false;
  const previous=tx.one<Row>('SELECT * FROM decision_lifecycle_transitions WHERE workspace_id=? AND approval_id=? AND id=?',[a.workspace_id,a.id,head.last_transition_id]);
  if(!previous||previous.kind!=='claim'||previous.run_id!==a.consumed_run_id||previous.task_id!==a.task_id||previous.sequence!==head.transition_count||previous.after_version!==head.task_version||previous.after_state!==head.task_state)return false;
  if(tx.one('SELECT 1 FROM decision_lifecycle_transitions WHERE workspace_id=? AND approval_id=? AND sequence>? LIMIT 1',[a.workspace_id,a.id,head.transition_count]))return false;
  return expiryBetween(tx,a,Number(task.task_version),Number(previous.created_at),nowMs);
 }catch{return false;}
}
/** INTERNAL historical chain check. The optional job is source-validation-only. */
export function isRestoreDecisionCancellationGap(tx:WorkspaceTransaction,a:Row,previous:Row,next:Row,job?:CurrentRestoreJob):boolean {
 try{
  if(previous.kind!=='claim'||previous.run_id!==a.consumed_run_id||previous.workspace_id!==a.workspace_id||next.workspace_id!==a.workspace_id||previous.task_id!==a.task_id||next.task_id!==a.task_id||previous.approval_id!==a.id||next.approval_id!==a.id||next.sequence!==Number(previous.sequence)+1||previous.after_state!=='doing'||next.kind!=='cancel'||next.before_state!=='backlog'||next.after_state!=='cancelled'||next.before_version!==Number(previous.after_version)+1||next.after_version!==Number(next.before_version)+1||next.run_id!==null||a.status!=='invalidated')return false;
  return expiryBetween(tx,a,Number(next.before_version),Number(previous.created_at),Number(next.created_at),job);
 }catch{return false;}
}
