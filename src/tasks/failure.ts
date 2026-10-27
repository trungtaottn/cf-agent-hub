import type {WorkspaceTransaction} from '../storage/transaction';
import type {CommandContext} from '../workspace/context';
import {requireRuntimeProof,type VerifiedRuntime} from '../auth/runtime-proof';
import type {TaskFailRequest,TaskCommandResult} from '../http/dto';
import type {CommandDescriptor} from '../workspace/commands';
import {validateTaskFailRequest,validateTaskCommandResult} from '../http/generated/auth-validators.js';
import {HttpError} from '../http/envelopes';
import {deny} from '../auth/context';
import {assertAdmissionOpen} from '../recovery/maintenance';
import {markSchedulerDirty} from '../outbox/scheduler-state';
import {appendRunExpiryEvent} from '../audit/events';
import {taskAccess,taskRecord,taskView,assertTaskOutcomeVisible} from './repository';
import {assertActiveRun,executionActor,runRecord,runView,assertRunOutcomeVisible,nextRunVersion} from './lease';
function body(input:TaskFailRequest):void {
 if(!validateTaskFailRequest(input))throw new HttpError('INVALID_REQUEST',400);
 if(new TextEncoder().encode(JSON.stringify(input)).byteLength>65536)throw new HttpError('LIMIT_EXCEEDED',413);
}
/** Captured by the trusted claim producer. No current policy or runtime assertion can upgrade it.
 * SQL returns one boolean, never private unbounded text. This bounds JS allocation, not SQL value inspection cost. */
function capturedSafe(tx:WorkspaceTransaction,workspaceId:string,id:string):boolean {
 return tx.one<{safe:number}>(`SELECT CASE WHEN typeof(replay_policy_version)='integer' AND replay_policy_version BETWEEN 1 AND 9007199254740991 AND typeof(replay_rule_id)='text' AND replay_rule_id<>'' AND typeof(replay_evidence_ref)='text' AND replay_evidence_ref<>'' THEN 1 ELSE 0 END AS safe FROM runs WHERE workspace_id=? AND id=?`,[workspaceId,id])?.safe===1;
}
function settle(tx:WorkspaceTransaction,workspaceId:string,taskId:string,runId:string,status:'failed'|'expired',unknown:boolean,nowMs:number):void {
 const task=taskRecord(tx,workspaceId,taskId),run=runRecord(tx,workspaceId,runId);
 if(task.state!=='doing'||task.active_run_id!==runId||task.latest_run_id!==runId||run.task_id!==taskId||run.status!=='active'||run.ended_at!==null)throw new HttpError('INVALID_STATE',409);
 const flags:unknown=JSON.parse(task.flags_json);
 if(!Array.isArray(flags)||flags.some(f=>typeof f!=='string')||!Number.isSafeInteger(task.retry_count)||task.retry_count<0||!Number.isSafeInteger(task.retry_limit)||task.retry_limit<0||task.retry_limit>10)throw new HttpError('INTERNAL_ERROR',500);
 const uncertain=unknown||flags.includes('outcome_unknown')||!capturedSafe(tx,workspaceId,runId);
 const retry=!uncertain&&!flags.includes('retry_exhausted')&&task.retry_count<task.retry_limit;
 const hold=uncertain?'outcome_unknown':retry?null:'retry_exhausted';
 if(hold&&!flags.includes(hold))flags.push(hold);
 tx.exec('UPDATE runs SET status=?,run_version=?,ended_at=? WHERE workspace_id=? AND id=?',[status,nextRunVersion(run.run_version),nowMs,workspaceId,runId]);
 tx.exec('UPDATE tasks SET state=?,task_version=?,active_run_id=NULL,retry_count=?,flags_json=?,updated_at=? WHERE workspace_id=? AND id=?',[retry?'ready':'backlog',nextRunVersion(task.task_version),task.retry_count+Number(retry),JSON.stringify(flags),nowMs,workspaceId,taskId]);
 markSchedulerDirty(tx);
}
export function failTask(tx:WorkspaceTransaction,ctx:CommandContext,id:string,input:TaskFailRequest,verified:VerifiedRuntime):TaskCommandResult {
 body(input);assertActiveRun(tx,ctx,id,input.run_id,input.fence,verified);
 const task=taskRecord(tx,ctx.actor.workspaceId,id);
 if(task.task_version!==input.expected_version)throw new HttpError('VERSION_CONFLICT',409,{current_version:task.task_version});
 settle(tx,ctx.actor.workspaceId,id,input.run_id,'failed',input.outcome_unknown,ctx.nowMs);
 return {task:taskView(tx,ctx.actor,taskRecord(tx,ctx.actor.workspaceId,id),ctx.nowMs),run:runView(runRecord(tx,ctx.actor.workspaceId,input.run_id)),approval:null};
}
export function failTaskCommand(id:string,proofHash:string):CommandDescriptor<TaskFailRequest,TaskCommandResult> {
 const proof=(tx:WorkspaceTransaction,ctx:CommandContext,input:TaskFailRequest)=>{
  body(input);const run=tx.one<{runtime_instance_id:string}>('SELECT runtime_instance_id FROM runs WHERE workspace_id=? AND id=?',[ctx.actor.workspaceId,input.run_id]);
  if(!run)deny();return requireRuntimeProof(tx,ctx,run!.runtime_instance_id,proofHash);
 };
 const access=(tx:WorkspaceTransaction,ctx:CommandContext,input:TaskFailRequest):undefined=>{
  const verified=proof(tx,ctx,input);executionActor(tx,ctx,'tasks:execute',verified);
  const run=runView(runRecord(tx,ctx.actor.workspaceId,input.run_id));assertRunOutcomeVisible(tx,ctx,run,verified,'tasks:execute');
  if(run.task_id!==id)throw new HttpError('FORBIDDEN',403);taskAccess(tx,ctx.actor,'tasks:execute',id,ctx.nowMs);
 };
 return {operation:'tasks:execute',target:'tasks:'+id+':fail',
  resource(tx,ctx,input){access(tx,ctx,input);return {kind:'task',id,projectId:taskRecord(tx,ctx.actor.workspaceId,id).project_id};},
  checkAccess:access,
  checkReplay(tx,ctx,input,outcome){if(!validateTaskCommandResult(outcome.data)||outcome.data.task.id!==id||outcome.data.run?.id!==input.run_id||outcome.data.run.task_id!==id||outcome.data.approval!==null)throw new HttpError('INTERNAL_ERROR',500);assertTaskOutcomeVisible(tx,ctx.actor,outcome.data.task,ctx.nowMs);assertRunOutcomeVisible(tx,ctx,outcome.data.run,proof(tx,ctx,input),'tasks:execute');},
  execute(tx,ctx,input){const data=failTask(tx,ctx,id,input,proof(tx,ctx,input));return {outcome:{status:200,data},event:{type:'task.failed',resourceType:'task',resourceId:id,resourceVersion:null,threadId:null}};}
 };
}
/** One workspace object: authoritative identity comes only from installed metadata. */
export function nextRunDue(tx:WorkspaceTransaction):number|null {
 return tx.one<{lease_expires_at:number}>("SELECT lease_expires_at FROM runs WHERE workspace_id=(SELECT workspace_id FROM workspace_metadata WHERE id=1) AND status='active' ORDER BY lease_expires_at,id LIMIT 1")?.lease_expires_at??null;
}
/** Caller owns the synchronous transaction. Scheduler calls limit=1 in independently committed units. */
export function expireDueRuns(tx:WorkspaceTransaction,nowMs:number,limit:number):{processed:number;nextDueAt:number|null} {
 if(!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(nowMs)||nowMs<0||nowMs>8640000000000000)throw new HttpError('INVALID_REQUEST',400);
 assertAdmissionOpen(tx);
 const workspaceId=tx.one<{workspace_id:string}>('SELECT workspace_id FROM workspace_metadata WHERE id=1')!.workspace_id;
 const rows=tx.all<{id:string;task_id:string}>("SELECT id,task_id FROM runs WHERE workspace_id=? AND status='active' AND lease_expires_at<=? ORDER BY lease_expires_at,id LIMIT ?",[workspaceId,nowMs,limit]);
 for(const row of rows){settle(tx,workspaceId,row.task_id,row.id,'expired',false,nowMs);appendRunExpiryEvent(tx,row.id,nowMs);}
 return {processed:rows.length,nextDueAt:nextRunDue(tx)};
}
