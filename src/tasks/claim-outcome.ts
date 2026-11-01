import type {CommandExecutionContext,CommandOutcome} from '../workspace/commands';
import type {VerifiedIdentity} from '../workspace/context';
import type {TaskClaimRequest,TaskCommandResult} from '../http/dto';
import {validateTaskClaimRequest,validateTaskCommandResult} from '../http/generated/auth-validators.js';
import {HttpError} from '../http/envelopes';
import {withTransaction} from '../storage/transaction';
import {currentConfiguration} from '../auth/context';
import {resolveActor} from '../auth/authorize';
import {requireRuntimeProof} from '../auth/runtime-proof';
import {maintenanceClosed} from '../recovery/maintenance';
import {OUTCOME_RETENTION_MS} from '../workspace/idempotency';
import {canonicalJson} from '../config/bootstrap';
import {taskAccess,taskRecord,taskView,assertTaskOutcomeVisible} from './repository';
import {executionActor,runRecord,assertRunOutcomeVisible,EXECUTION_LEASE_MS} from './lease';
import {approvalRecord,approvalView,assertApprovalOutcomeVisible} from '../approvals/repository';
import {TASK_RESPONSE_BYTES,jsonBytes} from './bounds';
interface RetainedClaim {fingerprint:string;status:number;event_id:string|null;created_at:number;expires_at:number;bytes:number;}
const corrupt=():never=>{throw new HttpError('INTERNAL_ERROR',500);};
/** Retained-positive read only. No descriptor, execute fallback, cleanup or authority renewal. */
export function lookupTaskClaimOutcome(ctx:CommandExecutionContext,identity:VerifiedIdentity,taskId:string,body:TaskClaimRequest,proofHash:string):CommandOutcome<TaskCommandResult>{
 if(identity.kind!=='agent'||identity.workspaceId!==ctx.workspace.workspaceId||ctx.creationAdmission!==undefined||!Number.isSafeInteger(ctx.admissionEpoch)||ctx.admissionEpoch<1||!Number.isSafeInteger(ctx.admissionGeneration)||ctx.admissionGeneration<0||!/^[a-f0-9]{64}$/.test(ctx.fingerprint)||!/^[\x21-\x7e]{1,256}$/.test(ctx.idempotencyKey)||!validateTaskClaimRequest(body)||!Number.isSafeInteger(body.expected_version)||body.expected_version>=Number.MAX_SAFE_INTEGER||jsonBytes(body)>65536)throw new HttpError('INVALID_REQUEST',400);
 return withTransaction(ctx.workspace.storage,tx=>{
  const nowMs=ctx.workspace.clock.nowMs();
  if(!Number.isSafeInteger(nowMs)||nowMs<0)corrupt();
  if(maintenanceClosed(tx))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  currentConfiguration(tx,ctx.workspace,{authorityEpoch:ctx.admissionEpoch,maintenanceGeneration:ctx.admissionGeneration});
  const actor=resolveActor(tx,identity,nowMs),context={actor,nowMs,requestId:ctx.requestId,idempotencyKey:ctx.idempotencyKey};
  taskAccess(tx,actor,'tasks:claim',taskId,nowMs);taskAccess(tx,actor,'tasks:execute',taskId,nowMs);
  const verified=requireRuntimeProof(tx,context,body.runtime_instance_id,proofHash);executionActor(tx,context,'tasks:claim',verified);
  const currentTask=taskRecord(tx,actor.workspaceId,taskId);taskView(tx,actor,currentTask,nowMs);
  const key=[actor.principalId,'domain.tasks:claim','tasks:'+taskId+':claim',ctx.idempotencyKey,actor.workspaceId];
  const where=' WHERE principal_id=? AND operation=? AND target=? AND key=? AND workspace_id=?';
  const prior=tx.one<RetainedClaim>('SELECT fingerprint,status,event_id,created_at,expires_at,length(CAST(outcome_json AS BLOB)) AS bytes FROM idempotency_outcomes'+where,key);
  if(!prior)throw new HttpError('NOT_FOUND',404);
  if(!Number.isSafeInteger(prior.created_at)||prior.created_at<0||!Number.isSafeInteger(prior.expires_at)||prior.expires_at-prior.created_at!==OUTCOME_RETENTION_MS||nowMs<prior.created_at)corrupt();
  if(nowMs>=prior.expires_at)throw new HttpError('NOT_FOUND',404);
  if(!/^[a-f0-9]{64}$/.test(prior.fingerprint))corrupt();
  if(prior.fingerprint!==ctx.fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT',409);
  if(prior.status!==200||typeof prior.event_id!=='string'||!Number.isSafeInteger(prior.bytes)||prior.bytes<1||prior.bytes>TASK_RESPONSE_BYTES)corrupt();
  const stored=tx.one<{outcome_json:string}>('SELECT outcome_json FROM idempotency_outcomes'+where,key);if(!stored)corrupt();
  let data:unknown;try{data=JSON.parse(stored!.outcome_json);}catch{corrupt();}
  if(!validateTaskCommandResult(data))corrupt();
  const result=data as TaskCommandResult,task=result.task,run=result.run;
  if(!run||task.workspace_id!==actor.workspaceId||task.id!==taskId||task.task_version!==body.expected_version+1||task.state!=='doing'||task.active_run_id!==run.id||task.latest_run_id!==run.id||run.task_id!==taskId||run.runtime_instance_id!==body.runtime_instance_id||run.status!=='active'||run.run_version!==1||run.ended_at!==null||!Number.isSafeInteger(currentTask.task_version)||currentTask.task_version<task.task_version||!Number.isSafeInteger(currentTask.next_fence)||currentTask.next_fence<=run.fence)corrupt();
  const historical=run!;
  assertTaskOutcomeVisible(tx,actor,task,nowMs);assertRunOutcomeVisible(tx,context,historical,verified,'tasks:claim');
  const row=runRecord(tx,actor.workspaceId,historical.id);
  const initialDeadline=prior.created_at+EXECUTION_LEASE_MS;
  if(!Number.isSafeInteger(initialDeadline)||historical.lease_expires_at!==new Date(initialDeadline).toISOString())corrupt();
  if(row.started_at!==prior.created_at||historical.started_at!==new Date(row.started_at).toISOString()||task.updated_at!==historical.started_at)corrupt();
  // Mutable current lease/status/version intentionally do not constrain historical success.
  const event=tx.one<{type:string;resource_type:string;resource_id:string;task_version:number;run_id:string;fence:number;occurred_at:number;actor_matches:number}>("SELECT type,resource_type,resource_id,task_version,run_id,fence,occurred_at,actor_json=? AS actor_matches FROM events WHERE workspace_id=? AND id=?",[canonicalJson({kind:actor.kind,principal_id:actor.principalId,agent_id:actor.agentId}),actor.workspaceId,prior.event_id!]);
  const history=tx.one<{task_id:string;task_version:number;run_id:string;kind:string;created_at:number}>('SELECT task_id,task_version,run_id,kind,created_at FROM task_history WHERE workspace_id=? AND event_id=?',[actor.workspaceId,prior.event_id!]);
  if(!event||event.type!=='task.claimed'||event.resource_type!=='task'||event.resource_id!==taskId||event.task_version!==task.task_version||event.run_id!==historical.id||event.fence!==historical.fence||event.occurred_at!==prior.created_at||event.actor_matches!==1||!history||history.task_id!==taskId||history.task_version!==task.task_version||history.run_id!==historical.id||history.kind!=='task.claimed'||history.created_at!==prior.created_at)corrupt();
  if(result.approval){
   if(task.approval_id!==result.approval.id||result.approval.task_id!==taskId)corrupt();
   assertApprovalOutcomeVisible(tx,actor,result.approval,nowMs);
   const approval=approvalRecord(tx,actor.workspaceId,result.approval.id);
   if(approval.consumed_run_id!==historical.id||approval.consumed_fence!==historical.fence)corrupt();
   // The closed lifecycle creates pending/v1, decides once to approved/v2,
   // and may later invalidate consumed approval/v3 without rewriting decision facts.
   if(!((approval.status==='approved'&&approval.approval_version===2)||(approval.status==='invalidated'&&approval.approval_version===3))||result.approval.status!=='approved'||result.approval.approval_version!==2||approval.decided_at===null||!Number.isSafeInteger(approval.decided_at)||approval.decided_at<approval.created_at||approval.decided_at>=approval.expires_at||approval.decided_at>prior.created_at||approval.decided_by_json===null||approval.decision_reason===null)corrupt();
   const currentApproval=approvalView(tx,actor,approval,nowMs);
   if(currentApproval.decided_by?.kind!=='human'||canonicalJson(result.approval)!==canonicalJson({...currentApproval,status:'approved',approval_version:2}))corrupt();
  }else if(task.approval_id!==null)corrupt();
  if(jsonBytes({data:result,request_id:ctx.requestId})>TASK_RESPONSE_BYTES)corrupt();
  return {status:200,data:result};
 });
}
