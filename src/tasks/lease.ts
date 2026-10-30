import type {CommandDescriptor} from '../workspace/commands';
import type {RunHeartbeatRequest,Run} from '../http/dto';
import type {WorkspaceTransaction} from '../storage/transaction';
import type {CommandContext,ActorContext} from '../workspace/context';
import {currentRuntime,requireRuntimeProof,type VerifiedRuntime} from '../auth/runtime-proof';
import {deny} from '../auth/context';
import {validateRun,validateRunHeartbeatRequest} from '../http/generated/auth-validators.js';
import {HttpError} from '../http/envelopes';
import {taskAccess,taskRecord,taskView} from './repository';
import {assertTaskExecutionEligible} from '../config/execution-policy';
import {assertStoredScalarBytes,assertTaskItemFits} from './bounds';
import {markSchedulerDirty} from '../outbox/scheduler-state';
export const EXECUTION_LEASE_MS=60000;
/** Authority/projection columns only; settlement reads private captured safety separately. */
export interface RunRow {id:string;workspace_id:string;task_id:string;agent_id:string;runtime_instance_id:string;credential_id:string;authority_epoch:number;status:Run['status'];run_version:number;fence:number;lease_expires_at:number;started_at:number;ended_at:number|null;}
export function nextRunVersion(version:number):number{
 if(!Number.isSafeInteger(version)||version<1||version>=Number.MAX_SAFE_INTEGER)throw new HttpError('LIMIT_EXCEEDED',409);return version+1;
}
export function runRecord(tx:WorkspaceTransaction,workspaceId:string,id:string):RunRow{
 const size=tx.one<{bytes:number}>('SELECT length(CAST(id AS BLOB))+length(CAST(workspace_id AS BLOB))+length(CAST(task_id AS BLOB))+length(CAST(agent_id AS BLOB))+length(CAST(runtime_instance_id AS BLOB))+length(CAST(credential_id AS BLOB)) AS bytes FROM runs WHERE workspace_id=? AND id=?',[workspaceId,id]);
 if(!size)throw new HttpError('NOT_FOUND',404);assertStoredScalarBytes(size.bytes);
 // Private safety evidence is not needed by execution/read paths and may be large.
 return tx.one<RunRow>('SELECT id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at,ended_at FROM runs WHERE workspace_id=? AND id=?',[workspaceId,id])!;
}
export function runView(row:RunRow):Run{
 const result:Run={id:row.id,workspace_id:row.workspace_id,task_id:row.task_id,agent_id:row.agent_id,runtime_instance_id:row.runtime_instance_id,status:row.status,run_version:row.run_version,fence:row.fence,lease_expires_at:new Date(row.lease_expires_at).toISOString(),started_at:new Date(row.started_at).toISOString(),ended_at:row.ended_at===null?null:new Date(row.ended_at).toISOString()};
 if(!validateRun(result))throw new HttpError('INTERNAL_ERROR',500);assertTaskItemFits(result);return result;
}
/** VerifiedRuntime is private transaction evidence, not a client authority object. */
export function executionActor(tx:WorkspaceTransaction,ctx:CommandContext,scope:string,verified:VerifiedRuntime):ActorContext{
 const actor=taskAccess(tx,ctx.actor,scope,null,ctx.nowMs);
 if(actor.kind!=='agent'||!actor.agentId||!actor.credentialId)deny();
 const current=currentRuntime(tx,{...ctx,actor},verified.runtime.id);
 if(verified.credentialId!==actor.credentialId||verified.authorityEpoch!==current.authority_epoch||verified.runtime.workspace_id!==actor.workspaceId||verified.runtime.agent_id!==actor.agentId)deny();
 return actor;
}
/** Current visibility does not require ownership, a live lease or an extra runtime proof. */
export function getRun(tx:WorkspaceTransaction,ctx:Pick<CommandContext,'actor'|'nowMs'>,id:string):Run{
 const actor=taskAccess(tx,ctx.actor,'tasks:read',null,ctx.nowMs),row=runRecord(tx,actor.workspaceId,id);
 taskAccess(tx,actor,'tasks:read',row.task_id,ctx.nowMs);taskView(tx,actor,taskRecord(tx,actor.workspaceId,row.task_id),ctx.nowMs);return runView(row);
}
/** Reusable exact ownership check; expiry is exclusive even before any scheduler runs. */
export function assertActiveRun(tx:WorkspaceTransaction,ctx:CommandContext,taskId:string,id:string,fence:number,verified:VerifiedRuntime):Run{
 const actor=executionActor(tx,ctx,'tasks:execute',verified),row=runRecord(tx,actor.workspaceId,id);
 taskAccess(tx,actor,'tasks:execute',taskId,ctx.nowMs);const task=taskRecord(tx,actor.workspaceId,taskId),view=taskView(tx,actor,task,ctx.nowMs);
 if(row.task_id!==taskId||row.agent_id!==actor.agentId||row.credential_id!==actor.credentialId||row.runtime_instance_id!==verified.runtime.id||row.authority_epoch!==verified.authorityEpoch||task.state!=='doing'||task.active_run_id!==id||task.latest_run_id!==id||row.status!=='active'||row.ended_at!==null||!Number.isSafeInteger(fence)||fence<1||row.fence!==fence||ctx.nowMs>=row.lease_expires_at)throw new HttpError('STALE_RUN',409);
 if(task.approval_id!==null)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 assertTaskExecutionEligible(tx,{...ctx,actor},view);return runView(row);
}
export function heartbeatRun(tx:WorkspaceTransaction,ctx:CommandContext,id:string,request:RunHeartbeatRequest,verified:VerifiedRuntime):Run{
 if(!validateRunHeartbeatRequest(request))throw new HttpError('INVALID_REQUEST',400);
 const row=runRecord(tx,ctx.actor.workspaceId,id);const run=assertActiveRun(tx,ctx,row.task_id,id,request.fence,verified);
 if(run.run_version!==request.expected_run_version)throw new HttpError('VERSION_CONFLICT',409,{current_version:run.run_version});
 const version=nextRunVersion(run.run_version),deadline=ctx.nowMs+EXECUTION_LEASE_MS;if(!Number.isSafeInteger(deadline))throw new HttpError('LIMIT_EXCEEDED',409);
 tx.exec('UPDATE runs SET run_version=?,lease_expires_at=? WHERE workspace_id=? AND id=?',[version,deadline,ctx.actor.workspaceId,id]);markSchedulerDirty(tx);return runView(runRecord(tx,ctx.actor.workspaceId,id));
}
/** Current exact owner and returned visibility only: no active/lease/version replay precondition. */
export function assertRunOutcomeVisible(tx:WorkspaceTransaction,ctx:CommandContext,run:Run,verified:VerifiedRuntime,scope:string):void{
 if(!validateRun(run)||run.workspace_id!==ctx.actor.workspaceId)throw new HttpError('INTERNAL_ERROR',500);
 const actor=executionActor(tx,ctx,scope,verified),row=runRecord(tx,actor.workspaceId,run.id);
 taskAccess(tx,actor,scope,row.task_id,ctx.nowMs);taskView(tx,actor,taskRecord(tx,actor.workspaceId,row.task_id),ctx.nowMs);
 if(row.agent_id!==actor.agentId||row.credential_id!==actor.credentialId||row.runtime_instance_id!==verified.runtime.id||row.authority_epoch!==verified.authorityEpoch)deny();
 if(run.task_id!==row.task_id||run.agent_id!==row.agent_id||run.runtime_instance_id!==row.runtime_instance_id||run.fence!==row.fence)throw new HttpError('INTERNAL_ERROR',500);
 assertTaskItemFits(run);
}
export function heartbeatRunCommand(id:string,proofHash:string):CommandDescriptor<RunHeartbeatRequest,Run>{
 const verified=(tx:WorkspaceTransaction,ctx:CommandContext)=>{
  // Until the run-bound proof is established, neither absence nor project is disclosed.
  const row=tx.one<{runtime_instance_id:string}>('SELECT runtime_instance_id FROM runs WHERE workspace_id=? AND id=?',[ctx.actor.workspaceId,id]);
  if(!row)deny();return requireRuntimeProof(tx,ctx,row!.runtime_instance_id,proofHash);
 };
 return {operation:'tasks:execute',target:'runs:'+id+':heartbeat',
  resource(tx,ctx,body){if(!validateRunHeartbeatRequest(body))throw new HttpError('INVALID_REQUEST',400);taskAccess(tx,ctx.actor,'tasks:execute',null,ctx.nowMs);executionActor(tx,ctx,'tasks:execute',verified(tx,ctx));const row=runRecord(tx,ctx.actor.workspaceId,id),task=taskRecord(tx,ctx.actor.workspaceId,row.task_id);return {kind:'run',id,projectId:task.project_id};},
  checkAccess(tx,ctx){const proof=verified(tx,ctx);assertRunOutcomeVisible(tx,ctx,runView(runRecord(tx,ctx.actor.workspaceId,id)),proof,'tasks:execute');},
  checkReplay(tx,ctx,_body,outcome){if(outcome.data.id!==id)throw new HttpError('INTERNAL_ERROR',500);assertRunOutcomeVisible(tx,ctx,outcome.data,verified(tx,ctx),'tasks:execute');},
  execute(tx,ctx,body){const data=heartbeatRun(tx,ctx,id,body,verified(tx,ctx));return {outcome:{status:200,data},event:{type:'run.heartbeat',resourceType:'run',resourceId:id,resourceVersion:null,threadId:null}};}
 };
}
