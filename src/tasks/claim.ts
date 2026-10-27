import type {CommandDescriptor} from '../workspace/commands';
import type {CommandContext} from '../workspace/context';
import type {WorkspaceTransaction} from '../storage/transaction';
import type {TaskClaimRequest,TaskCommandResult} from '../http/dto';
import {requireRuntimeProof,type VerifiedRuntime} from '../auth/runtime-proof';
import {validateTaskClaimRequest,validateTaskCommandResult} from '../http/generated/auth-validators.js';
import {HttpError} from '../http/envelopes';
import {assertTaskEligible,installedExecutionPolicy} from '../config/execution-policy';
import {taskAccess,taskRecord,taskView,assertTaskOutcomeVisible} from './repository';
import {executionActor,runRecord,runView,assertRunOutcomeVisible,nextRunVersion,EXECUTION_LEASE_MS} from './lease';
import {markSchedulerDirty} from '../outbox/scheduler-state';
function body(request:TaskClaimRequest):void{if(!validateTaskClaimRequest(request))throw new HttpError('INVALID_REQUEST',400);if(new TextEncoder().encode(JSON.stringify(request)).byteLength>65536)throw new HttpError('LIMIT_EXCEEDED',413);}
/** runId is reserved by a trusted caller before SQL, never accepted from the request body. */
export function claimTask(tx:WorkspaceTransaction,ctx:CommandContext&{runId?:string},id:string,request:TaskClaimRequest,verified:VerifiedRuntime):TaskCommandResult{
 body(request);const actor=executionActor(tx,ctx,'tasks:claim',verified);taskAccess(tx,actor,'tasks:execute',id,ctx.nowMs);
 if(request.runtime_instance_id!==verified.runtime.id)throw new HttpError('FORBIDDEN',403);
 const row=taskRecord(tx,actor.workspaceId,id),task=taskView(tx,actor,row,ctx.nowMs);
 if(row.task_version!==request.expected_version)throw new HttpError('VERSION_CONFLICT',409,{current_version:row.task_version});
 if(row.state!=='ready'||row.active_run_id!==null)throw new HttpError('INVALID_STATE',409);
 if(row.approval_id!==null)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 const evidence=assertTaskEligible(tx,{...ctx,actor},task,actor.agentId),policy=installedExecutionPolicy(tx,actor);
 // Expired unswept rows still occupy capacity. A bounded indexed threshold probe
 // answers count >= limit without work proportional to retained terminal history.
 if(tx.all('SELECT 1 AS occupied FROM runs WHERE workspace_id=? AND agent_id=? AND status=\'active\' LIMIT ?',[actor.workspaceId,actor.agentId!,policy.agent_wip_limit]).length>=policy.agent_wip_limit)throw new HttpError('LIMIT_EXCEEDED',409);
 if(!ctx.runId||!/^[A-Za-z0-9_-]{1,128}$/.test(ctx.runId))throw new HttpError('INTERNAL_ERROR',500);
 if(tx.one('SELECT id FROM runs WHERE id=?',[ctx.runId]))throw new HttpError('INVALID_STATE',409);
 const version=nextRunVersion(row.task_version),nextFence=nextRunVersion(row.next_fence),deadline=ctx.nowMs+EXECUTION_LEASE_MS;
 if(!Number.isSafeInteger(deadline))throw new HttpError('LIMIT_EXCEEDED',409);
 const rule=evidence.replaySafetyRuleId===null?undefined:policy.replay_safety_rules.find(r=>r.id===evidence.replaySafetyRuleId);
 // Existing schema stores unknown classification as all null. It is never safe retry evidence.
 tx.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at,ended_at,replay_policy_version,replay_rule_id,replay_evidence_ref) VALUES(?,?,?,?,?,?,?,'active',1,?,?,?,NULL,?,?,?)",[ctx.runId,actor.workspaceId,id,actor.agentId!,verified.runtime.id,verified.credentialId,verified.authorityEpoch,row.next_fence,deadline,ctx.nowMs,rule?evidence.policyVersion:null,rule?.id??null,rule?.evidence_ref??null]);
 tx.exec("UPDATE tasks SET state='doing',active_run_id=?,latest_run_id=?,task_version=?,next_fence=?,updated_at=? WHERE workspace_id=? AND id=?",[ctx.runId,ctx.runId,version,nextFence,ctx.nowMs,actor.workspaceId,id]);markSchedulerDirty(tx);
 return {task:taskView(tx,actor,taskRecord(tx,actor.workspaceId,id),ctx.nowMs),run:runView(runRecord(tx,actor.workspaceId,ctx.runId)),approval:null};
}
export function claimTaskCommand(id:string,runId:string,proofHash:string):CommandDescriptor<TaskClaimRequest,TaskCommandResult>{
 const proof=(tx:WorkspaceTransaction,ctx:CommandContext,request:TaskClaimRequest)=>requireRuntimeProof(tx,ctx,request.runtime_instance_id,proofHash);
 return {operation:'tasks:claim',target:'tasks:'+id+':claim',
  resource(tx,ctx,request){body(request);taskAccess(tx,ctx.actor,'tasks:claim',null,ctx.nowMs);executionActor(tx,ctx,'tasks:claim',proof(tx,ctx,request));taskAccess(tx,ctx.actor,'tasks:execute',null,ctx.nowMs);const row=taskRecord(tx,ctx.actor.workspaceId,id);return {kind:'task',id,projectId:row.project_id};},
  checkAccess(tx,ctx,request){const actor=executionActor(tx,ctx,'tasks:claim',proof(tx,ctx,request));taskAccess(tx,actor,'tasks:execute',id,ctx.nowMs);taskView(tx,actor,taskRecord(tx,actor.workspaceId,id),ctx.nowMs);},
  checkReplay(tx,ctx,request,outcome){if(!validateTaskCommandResult(outcome.data)||outcome.data.task.id!==id||!outcome.data.run||outcome.data.run.task_id!==id||outcome.data.approval!==null)throw new HttpError('INTERNAL_ERROR',500);assertTaskOutcomeVisible(tx,ctx.actor,outcome.data.task,ctx.nowMs);assertRunOutcomeVisible(tx,ctx,outcome.data.run,proof(tx,ctx,request),'tasks:claim');},
  execute(tx,ctx,request){const data=claimTask(tx,{...ctx,runId},id,request,proof(tx,ctx,request));return {outcome:{status:200,data},event:{type:'task.claimed',resourceType:'task',resourceId:id,resourceVersion:null,threadId:null}};}
 };
}
