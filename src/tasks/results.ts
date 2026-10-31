import {assertResourceReferences,actorResourceGrant} from '../auth/resource-visibility';
import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import type {TaskResult} from '../http/dto';
import {validateTaskResult} from '../http/generated/auth-validators.js';
import {HttpError} from '../http/envelopes';
import {assertStoredScalarBytes,assertTaskItemFits} from './bounds';
export interface TaskResultRow {id:string;workspace_id:string;task_id:string;run_id:string;submission_sequence:number;submitted_kind:'human'|'agent'|'system';submitted_principal_id:string;submitted_agent_id:string|null;summary:string;created_at:number;}
/** Caller supplies one freshly resolved coherent grant inside this synchronous transaction.
 * No actor construction, refresh per artifact, network access or artifact bytes. */
export function projectTaskResult(tx:WorkspaceTransaction,actor:ActorContext,taskId:string,resultId:string):TaskResult|null {
 const size=tx.one<{bytes:number}>(`SELECT length(CAST(id AS BLOB))+length(CAST(workspace_id AS BLOB))+length(CAST(task_id AS BLOB))+length(CAST(run_id AS BLOB))+length(CAST(submitted_principal_id AS BLOB))+coalesce(length(CAST(submitted_agent_id AS BLOB)),0)+length(CAST(summary AS BLOB)) AS bytes FROM task_results WHERE workspace_id=? AND task_id=? AND id=?`,[actor.workspaceId,taskId,resultId]);
 if(!size)return null;assertStoredScalarBytes(size.bytes);
 const binding=tx.one<Pick<TaskResultRow,'run_id'>>('SELECT run_id FROM task_results WHERE workspace_id=? AND task_id=? AND id=?',[actor.workspaceId,taskId,resultId])!;
 const task=tx.one<{project_id:string|null}>('SELECT project_id FROM tasks WHERE workspace_id=? AND id=?',[actor.workspaceId,taskId]);
 if(!task||actor.projectIds!==null&&(task.project_id===null||!actor.projectIds.includes(task.project_id)))return null;
 if(!tx.one('SELECT id FROM runs WHERE workspace_id=? AND task_id=? AND id=?',[actor.workspaceId,taskId,binding.run_id]))return null;
 const lengths=tx.one<{bytes:number}>('SELECT coalesce(sum(length(CAST(artifact_id AS BLOB))),0) AS bytes FROM result_artifacts WHERE workspace_id=? AND result_id=?',[actor.workspaceId,resultId]);assertStoredScalarBytes(lengths?.bytes);
 const refs=tx.all<{artifact_id:string;visible:number}>(`SELECT ra.artifact_id,
  CASE WHEN a.status='committed' AND a.committed_at IS NOT NULL AND a.expires_at IS NULL
   AND (a.task_id IS NULL OR a.task_id=?) AND (a.run_id IS NULL OR a.run_id=?)
   AND g.state='committed' AND g.observed_sha256=a.sha256 AND g.expected_sha256=a.sha256
   AND g.observed_byte_size=a.byte_size AND g.expected_byte_size=a.byte_size
   AND (a.task_id IS NULL OR EXISTS(SELECT 1 FROM artifact_associations x WHERE x.workspace_id=ra.workspace_id AND x.artifact_id=ra.artifact_id AND x.resource_kind='task' AND x.resource_id=?))
   AND (a.run_id IS NULL OR EXISTS(SELECT 1 FROM artifact_associations x WHERE x.workspace_id=ra.workspace_id AND x.artifact_id=ra.artifact_id AND x.resource_kind='run' AND x.resource_id=?))
   AND EXISTS(SELECT 1 FROM artifact_associations x WHERE x.workspace_id=ra.workspace_id AND x.artifact_id=ra.artifact_id AND x.resource_kind='result' AND x.resource_id=?)
  THEN 1 ELSE 0 END AS visible
  FROM result_artifacts ra
  LEFT JOIN artifacts a ON a.workspace_id=ra.workspace_id AND a.id=ra.artifact_id
  LEFT JOIN artifact_generations g ON g.workspace_id=a.workspace_id AND g.artifact_id=a.id AND g.id=a.committed_generation_id
  WHERE ra.workspace_id=? AND ra.result_id=? ORDER BY ra.ordinal LIMIT 6`,[taskId,binding.run_id,taskId,binding.run_id,resultId,actor.workspaceId,resultId]);
 // The outer indexed relation has at most five schema-constrained ordinal rows.
 // Visibility is a projection, never a filter that can scan unbounded hidden rows.
 if(refs.length>5)throw new HttpError('INTERNAL_ERROR',500);
 if(refs.length&&!actor.scopes.has('artifacts:read')||refs.some(ref=>ref.visible!==1))return null;
 // Newly attached message associations must also remain visible in retained results/history.
 try{assertResourceReferences(tx,actorResourceGrant(actor),refs.map(ref=>({kind:'artifact',id:ref.artifact_id})));}
 catch(error){if(error instanceof HttpError&&error.code==='NOT_FOUND')return null;throw error;}
 const row=tx.one<TaskResultRow>('SELECT * FROM task_results WHERE workspace_id=? AND task_id=? AND id=?',[actor.workspaceId,taskId,resultId])!;
 const result:TaskResult={summary:row.summary,artifact_ids:refs.map(x=>x.artifact_id),run_id:row.run_id,submitted_by:{kind:row.submitted_kind,principal_id:row.submitted_principal_id,agent_id:row.submitted_agent_id},submitted_at:new Date(row.created_at).toISOString()};
 if(!validateTaskResult(result))throw new HttpError('INTERNAL_ERROR',500);assertTaskItemFits(result);return result;
}

import type {CommandContext} from '../workspace/context';
import type {TaskSubmitResultRequest,TaskReasonRequest,TaskCommandResult} from '../http/dto';
import type {CommandDescriptor} from '../workspace/commands';
import {validateTaskSubmitResultRequest,validateTaskReasonRequest,validateTaskCommandResult} from '../http/generated/auth-validators.js';
import {requireRuntimeProof,type VerifiedRuntime} from '../auth/runtime-proof';
import {deny} from '../auth/context';
import {assertCommittedArtifacts,ARTIFACT_MAX_BYTES} from '../artifacts/repository';
import {taskAccess,taskRecord,taskView,assertTaskOutcomeVisible} from './repository';
import {assertActiveRun,executionActor,runRecord,runView,assertRunOutcomeVisible,nextRunVersion} from './lease';
import {assertTaskResultAdmissionFits} from './bounds';
import {markSchedulerDirty} from '../outbox/scheduler-state';
function resultBody<T extends {expected_version:number}>(input:T,validate:(input:unknown)=>boolean):void {
 if(!validate(input)||!Number.isSafeInteger(input.expected_version))throw new HttpError('INVALID_REQUEST',400);
 if(new TextEncoder().encode(JSON.stringify(input)).byteLength>65536)throw new HttpError('LIMIT_EXCEEDED',413);
}
function currentVersion(actual:number,expected:number):void {if(actual!==expected)throw new HttpError('VERSION_CONFLICT',409,{current_version:actual});}
function serverId(id:string|undefined):string {if(!id||!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new HttpError('INTERNAL_ERROR',500);return id;}
/** First execution only; original response replay must not reapply ended-run preconditions. */
export function submitTaskResult(tx:WorkspaceTransaction,ctx:CommandContext&{resultId?:string},taskId:string,input:TaskSubmitResultRequest,verified:VerifiedRuntime):TaskCommandResult {
 resultBody(input,validateTaskSubmitResultRequest);const actor=executionActor(tx,ctx,'tasks:execute',verified);
 assertActiveRun(tx,{...ctx,actor},taskId,input.run_id,input.fence,verified);
 const row=taskRecord(tx,actor.workspaceId,taskId);currentVersion(row.task_version,input.expected_version);
 if(row.current_result_id!==null)throw new HttpError('INVALID_STATE',409);
 const artifacts=assertCommittedArtifacts(tx,{actor,nowMs:ctx.nowMs},input.result.artifact_ids);
 if(artifacts.some(a=>a.task_id!==null&&a.task_id!==taskId||a.run_id!==null&&a.run_id!==input.run_id))throw new HttpError('NOT_FOUND',404);
 if(artifacts.some(a=>a.byte_size>ARTIFACT_MAX_BYTES))throw new HttpError('LIMIT_EXCEEDED',413);
 const id=serverId(ctx.resultId),taskVersion=nextRunVersion(row.task_version),sequence=nextRunVersion(row.next_result_sequence),run=runRecord(tx,actor.workspaceId,input.run_id);
 tx.exec('INSERT INTO task_results(id,workspace_id,task_id,run_id,submission_sequence,submitted_kind,submitted_principal_id,submitted_agent_id,summary,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,actor.workspaceId,taskId,input.run_id,row.next_result_sequence,actor.kind,actor.principalId,actor.agentId,input.result.summary,ctx.nowMs]);
 for(const [ordinal,a] of artifacts.entries()){
  tx.exec('INSERT INTO result_artifacts(workspace_id,result_id,artifact_id,ordinal) VALUES(?,?,?,?)',[actor.workspaceId,id,a.id,ordinal]);
  tx.exec("INSERT INTO artifact_associations(workspace_id,artifact_id,resource_kind,resource_id) VALUES(?,?,'result',?)",[actor.workspaceId,a.id,id]);
 }
 tx.exec("UPDATE runs SET status='submitted',run_version=?,ended_at=? WHERE workspace_id=? AND task_id=? AND id=?",[nextRunVersion(run.run_version),ctx.nowMs,actor.workspaceId,taskId,input.run_id]);
 tx.exec("UPDATE tasks SET state='review',task_version=?,current_result_id=?,next_result_sequence=?,active_run_id=NULL,updated_at=? WHERE workspace_id=? AND id=?",[taskVersion,id,sequence,ctx.nowMs,actor.workspaceId,taskId]);
 markSchedulerDirty(tx);
 // Reproject after association writes: newly added edges must not create an unreadable outcome.
 const task=taskView(tx,actor,taskRecord(tx,actor.workspaceId,taskId),ctx.nowMs);
 if(task.result===null)throw new HttpError('INTERNAL_ERROR',500);
 assertTaskResultAdmissionFits(task.result,task);
 const data={task,run:runView(runRecord(tx,actor.workspaceId,input.run_id)),approval:null};assertTaskItemFits(data);return data;
}
/** Immutable submitter attribution is compared directly; current submitter credentials are irrelevant. */
export function acceptTaskResult(tx:WorkspaceTransaction,ctx:CommandContext&{acceptanceId?:string},taskId:string,input:TaskReasonRequest):TaskCommandResult {
 resultBody(input,validateTaskReasonRequest);const actor=taskAccess(tx,ctx.actor,'tasks:review',taskId,ctx.nowMs),row=taskRecord(tx,actor.workspaceId,taskId),task=taskView(tx,actor,row,ctx.nowMs);
 currentVersion(row.task_version,input.expected_version);
 if(row.state!=='review'||row.current_result_id===null||row.active_run_id!==null||row.approval_id!==null||task.flags.some(flag=>flag==='outcome_unknown'||flag==='retry_exhausted'))throw new HttpError('INVALID_STATE',409);
 const result=tx.one<TaskResultRow>('SELECT * FROM task_results WHERE workspace_id=? AND task_id=? AND id=?',[actor.workspaceId,taskId,row.current_result_id]);
 if(!result||result.run_id!==row.latest_run_id)throw new HttpError('INVALID_STATE',409);
 const run=runRecord(tx,actor.workspaceId,result.run_id);
 if(run.task_id!==taskId||run.status!=='submitted'||run.ended_at===null||result.submitted_kind!=='agent'||result.submitted_agent_id!==run.agent_id)throw new HttpError('INVALID_STATE',409);
 if(actor.principalId===result.submitted_principal_id||actor.agentId!==null&&actor.agentId===result.submitted_agent_id)throw new HttpError('FORBIDDEN',403);
 const id=serverId(ctx.acceptanceId),version=nextRunVersion(row.task_version);
 tx.exec('INSERT INTO task_acceptances(id,workspace_id,task_id,result_id,run_id,task_version,reviewer_principal_id,reviewer_agent_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,actor.workspaceId,taskId,result.id,result.run_id,version,actor.principalId,actor.agentId,input.reason,ctx.nowMs]);
 tx.exec("UPDATE tasks SET state='done',task_version=?,updated_at=? WHERE workspace_id=? AND id=?",[version,ctx.nowMs,actor.workspaceId,taskId]);
 const data={task:taskView(tx,actor,taskRecord(tx,actor.workspaceId,taskId),ctx.nowMs),run:null,approval:null};assertTaskItemFits(data);return data;
}
export function submitTaskResultCommand(id:string,proofHash:string):CommandDescriptor<TaskSubmitResultRequest,TaskCommandResult> {
 const proof=(tx:WorkspaceTransaction,ctx:CommandContext,input:TaskSubmitResultRequest)=>{
  resultBody(input,validateTaskSubmitResultRequest);taskAccess(tx,ctx.actor,'tasks:execute',null,ctx.nowMs);if(ctx.actor.kind!=='agent')throw new HttpError('FORBIDDEN',403);
  const run=tx.one<{runtime_instance_id:string}>('SELECT runtime_instance_id FROM runs WHERE workspace_id=? AND id=?',[ctx.actor.workspaceId,input.run_id]);if(!run)deny();return requireRuntimeProof(tx,ctx,run!.runtime_instance_id,proofHash);
 };
 const access=(tx:WorkspaceTransaction,ctx:CommandContext,input:TaskSubmitResultRequest):undefined=>{
  const verified=proof(tx,ctx,input),run=runView(runRecord(tx,ctx.actor.workspaceId,input.run_id));assertRunOutcomeVisible(tx,ctx,run,verified,'tasks:execute');
  if(run.task_id!==id)throw new HttpError('FORBIDDEN',403);
 };
 return {operation:'tasks:execute',target:'tasks:'+id+':submit-result',
  resource(tx,ctx,input){access(tx,ctx,input);return {kind:'task',id,projectId:taskRecord(tx,ctx.actor.workspaceId,id).project_id};},checkAccess:access,
  checkReplay(tx,ctx,input,outcome){if(!validateTaskCommandResult(outcome.data)||outcome.data.task.id!==id||outcome.data.run?.id!==input.run_id||outcome.data.run.status!=='submitted'||outcome.data.task.result?.run_id!==input.run_id||outcome.data.approval!==null)throw new HttpError('INTERNAL_ERROR',500);assertTaskOutcomeVisible(tx,ctx.actor,outcome.data.task,ctx.nowMs);assertRunOutcomeVisible(tx,ctx,outcome.data.run,proof(tx,ctx,input),'tasks:execute');assertTaskItemFits(outcome.data);},
  execute(tx,ctx,input,eventId){const data=submitTaskResult(tx,{...ctx,resultId:'result_'+eventId.slice(6)},id,input,proof(tx,ctx,input));return {outcome:{status:200,data},event:{type:'task.result_submitted',resourceType:'task',resourceId:id,resourceVersion:null,threadId:null}};}
 };
}
export function acceptTaskResultCommand(id:string):CommandDescriptor<TaskReasonRequest,TaskCommandResult> {
 return {operation:'tasks:review',target:'tasks:'+id+':accept-result',
  resource(tx,ctx,input){resultBody(input,validateTaskReasonRequest);taskAccess(tx,ctx.actor,'tasks:review',null,ctx.nowMs);return {kind:'task',id,projectId:taskRecord(tx,ctx.actor.workspaceId,id).project_id};},
  checkAccess(tx,ctx){const actor=taskAccess(tx,ctx.actor,'tasks:review',id,ctx.nowMs);taskView(tx,actor,taskRecord(tx,actor.workspaceId,id),ctx.nowMs);},
  checkReplay(tx,ctx,_input,outcome){const actor=taskAccess(tx,ctx.actor,'tasks:review',id,ctx.nowMs);if(!validateTaskCommandResult(outcome.data)||outcome.data.task.id!==id||outcome.data.task.state!=='done'||outcome.data.task.result===null||outcome.data.run!==null||outcome.data.approval!==null)throw new HttpError('INTERNAL_ERROR',500);assertTaskOutcomeVisible(tx,actor,outcome.data.task,ctx.nowMs);assertTaskItemFits(outcome.data);},
  execute(tx,ctx,input,eventId){const data=acceptTaskResult(tx,{...ctx,acceptanceId:'acceptance_'+eventId.slice(6)},id,input);return {outcome:{status:200,data},event:{type:'task.result_accepted',resourceType:'task',resourceId:id,resourceVersion:null,threadId:null,historyReason:input.reason}};}
 };
}
