/** One private claim SQL primitive; trusted fixture composition is not production registration. */
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
import type {DecisionActionDescriptor} from '../approvals/action-registry';
import {createApprovedIntentGuard,type VerifiedApprovedIntent} from '../approvals/execution-guard-source';
import type {DecisionPreparationContext} from '../approvals/commands-source';
import {approvalRecord,approvalView,assertApprovalOutcomeVisible} from '../approvals/repository';
import {appendDecisionTransition} from '../approvals/lifecycle';
import {currentConfiguration} from '../auth/context';
import {resolveActor} from '../auth/authorize';
import {withTransaction} from '../storage/transaction';
import {findOutcome} from '../workspace/idempotency';
import {canonicalJson} from '../config/bootstrap';
export function createTaskClaimCommands(descriptors:readonly DecisionActionDescriptor[]){
const guard=createApprovedIntentGuard(descriptors);
function body(request:TaskClaimRequest):void{if(!validateTaskClaimRequest(request))throw new HttpError('INVALID_REQUEST',400);if(new TextEncoder().encode(JSON.stringify(request)).byteLength>65536)throw new HttpError('LIMIT_EXCEEDED',413);}
/** runId is reserved by a trusted caller before SQL, never accepted from the request body. */
function applyClaim(tx:WorkspaceTransaction,ctx:CommandContext&{runId?:string},id:string,request:TaskClaimRequest,verified:VerifiedRuntime,prepared?:{context:DecisionPreparationContext;evidence:VerifiedApprovedIntent|null;eventId:string}):TaskCommandResult{
 body(request);const actor=executionActor(tx,ctx,'tasks:claim',verified);taskAccess(tx,actor,'tasks:execute',id,ctx.nowMs);
 if(request.runtime_instance_id!==verified.runtime.id)throw new HttpError('FORBIDDEN',403);
 const row=taskRecord(tx,actor.workspaceId,id),task=taskView(tx,actor,row,ctx.nowMs);
 if(row.task_version!==request.expected_version)throw new HttpError('VERSION_CONFLICT',409,{current_version:row.task_version});
 if(row.state!=='ready'||row.active_run_id!==null)throw new HttpError('INVALID_STATE',409);
 let approved:ReturnType<typeof guard.assertApprovedIntentCurrent>=null;
 if(row.approval_id!==null){
  if(!prepared)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const current=approvalRecord(tx,actor.workspaceId,row.approval_id);if(ctx.nowMs>=current.expires_at)throw new HttpError('APPROVAL_EXPIRED',409);
  try{approved=guard.assertApprovedIntentCurrent(tx,prepared.context,row,prepared.evidence);}catch{throw new HttpError('DEPENDENCY_UNAVAILABLE',503);}
  if(!approved||approved.actor.principalId!==actor.principalId||approved.actor.credentialId!==actor.credentialId||row.next_fence<=approved.paused.fence)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 }else if(prepared){try{guard.assertApprovedIntentCurrent(tx,prepared.context,row,prepared.evidence);}catch{throw new HttpError('DEPENDENCY_UNAVAILABLE',503);}}
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
 if(approved){
  tx.exec('UPDATE approvals SET consumed_run_id=?,consumed_fence=? WHERE workspace_id=? AND id=? AND consumed_run_id IS NULL AND consumed_fence IS NULL',[ctx.runId,row.next_fence,actor.workspaceId,approved.approval.id]);
  appendDecisionTransition(tx,approved.head,prepared!.eventId,'claim','doing',version,ctx.runId,ctx.nowMs);
 }
 return {task:taskView(tx,actor,taskRecord(tx,actor.workspaceId,id),ctx.nowMs),run:runView(runRecord(tx,actor.workspaceId,ctx.runId)),approval:approved?approvalView(tx,actor,approvalRecord(tx,actor.workspaceId,approved.approval.id),ctx.nowMs):null};
}
function claimTaskCommand(id:string,runId:string,proofHash:string):CommandDescriptor<TaskClaimRequest,TaskCommandResult>{
 const proof=(tx:WorkspaceTransaction,ctx:CommandContext,request:TaskClaimRequest)=>requireRuntimeProof(tx,ctx,request.runtime_instance_id,proofHash);
 return {operation:'tasks:claim',target:'tasks:'+id+':claim',
  resource(tx,ctx,request){body(request);taskAccess(tx,ctx.actor,'tasks:claim',null,ctx.nowMs);executionActor(tx,ctx,'tasks:claim',proof(tx,ctx,request));taskAccess(tx,ctx.actor,'tasks:execute',null,ctx.nowMs);const row=taskRecord(tx,ctx.actor.workspaceId,id);return {kind:'task',id,projectId:row.project_id};},
  checkAccess(tx,ctx,request){const actor=executionActor(tx,ctx,'tasks:claim',proof(tx,ctx,request));taskAccess(tx,actor,'tasks:execute',id,ctx.nowMs);taskView(tx,actor,taskRecord(tx,actor.workspaceId,id),ctx.nowMs);},
  checkReplay(tx,ctx,request,outcome){if(!validateTaskCommandResult(outcome.data)||outcome.data.task.id!==id||!outcome.data.run||outcome.data.run.task_id!==id||outcome.data.approval!==null)throw new HttpError('INTERNAL_ERROR',500);assertTaskOutcomeVisible(tx,ctx.actor,outcome.data.task,ctx.nowMs);assertRunOutcomeVisible(tx,ctx,outcome.data.run,proof(tx,ctx,request),'tasks:claim');},
  execute(tx,ctx,request){const data=claimTask(tx,{...ctx,runId},id,request,proof(tx,ctx,request));return {outcome:{status:200,data},event:{type:'task.claimed',resourceType:'task',resourceId:id,resourceVersion:null,threadId:null}};}
 };
}

function claimTask(tx:WorkspaceTransaction,ctx:CommandContext&{runId?:string},id:string,request:TaskClaimRequest,verified:VerifiedRuntime):TaskCommandResult{return applyClaim(tx,ctx,id,request,verified);}
async function prepareClaimTaskCommand(context:DecisionPreparationContext,id:string,runId:string,proofHash:string,request:TaskClaimRequest):Promise<CommandDescriptor<TaskClaimRequest,TaskCommandResult>>{
 body(request);const ctx={...context},captured=structuredClone(request),base=claimTaskCommand(id,runId,proofHash);let runtimeId=captured.runtime_instance_id;
 const proof=(tx:WorkspaceTransaction,c:CommandContext)=>requireRuntimeProof(tx,c,runtimeId,proofHash);
 const access=(tx:WorkspaceTransaction,c:CommandContext):undefined=>{const actor=executionActor(tx,c,'tasks:claim',proof(tx,c));taskAccess(tx,actor,'tasks:execute',id,c.nowMs);taskView(tx,actor,taskRecord(tx,actor.workspaceId,id),c.nowMs);};
 const decision=withTransaction(ctx.workspace.storage,tx=>{
  currentConfiguration(tx,ctx.workspace,ctx.admission);const nowMs=ctx.workspace.clock.nowMs(),actor=resolveActor(tx,ctx.identity,nowMs),c={actor,nowMs,requestId:ctx.requestId,idempotencyKey:ctx.idempotencyKey};
  taskAccess(tx,actor,'tasks:claim',id,nowMs);taskAccess(tx,actor,'tasks:execute',id,nowMs);
  const prior=findOutcome(tx,actor.principalId,base.operation,base.target,ctx.idempotencyKey,actor.workspaceId);
  if(prior){const saved:unknown=JSON.parse(prior.outcome_json);if(!validateTaskCommandResult(saved)||saved.task.id!==id||!saved.run)throw new HttpError('INTERNAL_ERROR',500);if(saved.approval){runtimeId=runRecord(tx,actor.workspaceId,saved.run.id).runtime_instance_id;access(tx,c);assertRunOutcomeVisible(tx,c,saved.run,proof(tx,c),'tasks:claim');return 'replay' as const;}return 'ordinary' as const;}
  access(tx,c);const task=taskRecord(tx,actor.workspaceId,id);if(task.approval_id===null)return 'ordinary' as const;
  if(task.task_version!==captured.expected_version)throw new HttpError('VERSION_CONFLICT',409,{current_version:task.task_version});
  if(nowMs>=approvalRecord(tx,actor.workspaceId,task.approval_id).expires_at)throw new HttpError('APPROVAL_EXPIRED',409);
  return 'fresh' as const;
 });
 if(decision==='ordinary')return base;
 let evidence:VerifiedApprovedIntent|null|undefined;
 if(decision==='fresh'){try{evidence=await guard.verifyApprovedIntent(ctx,id);}catch{
  // Recover only current public conflict/expiry semantics after a failed await;
  // no bytes receipt or replacement authority is manufactured here.
  withTransaction(ctx.workspace.storage,tx=>{currentConfiguration(tx,ctx.workspace,ctx.admission);const nowMs=ctx.workspace.clock.nowMs(),actor=resolveActor(tx,ctx.identity,nowMs);access(tx,{actor,nowMs,requestId:ctx.requestId,idempotencyKey:ctx.idempotencyKey});const task=taskRecord(tx,actor.workspaceId,id);if(task.task_version!==captured.expected_version)throw new HttpError('VERSION_CONFLICT',409,{current_version:task.task_version});if(task.approval_id!==null&&nowMs>=approvalRecord(tx,actor.workspaceId,task.approval_id).expires_at)throw new HttpError('APPROVAL_EXPIRED',409);});
  throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 }}
 return {operation:base.operation,target:base.target,
  resource(tx,c,b){body(b);access(tx,c);const task=taskRecord(tx,c.actor.workspaceId,id);return {kind:'task',id,projectId:task.project_id};},
  checkAccess(tx,c){access(tx,c);},
  checkReplay(tx,c,_b,outcome){
   if(!validateTaskCommandResult(outcome.data)||outcome.data.task.id!==id||!outcome.data.run||!outcome.data.approval||outcome.data.approval.task_id!==id)throw new HttpError('INTERNAL_ERROR',500);
   assertTaskOutcomeVisible(tx,c.actor,outcome.data.task,c.nowMs);assertRunOutcomeVisible(tx,c,outcome.data.run,proof(tx,c),'tasks:claim');assertApprovalOutcomeVisible(tx,c.actor,outcome.data.approval,c.nowMs);
  },
  execute(tx,c,b,eventId){
   if(evidence===undefined)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);if(canonicalJson(b)!==canonicalJson(captured))throw new HttpError('INVALID_REQUEST',400);
   const data=applyClaim(tx,{...c,runId},id,b,proof(tx,c),{context:ctx,evidence,eventId});return {outcome:{status:200,data},event:{type:'task.claimed',resourceType:'task',resourceId:id,resourceVersion:null,threadId:null}};
  }
 };
}
return Object.freeze({claimTask,claimTaskCommand,prepareClaimTaskCommand});
}
