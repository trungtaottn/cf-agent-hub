/** Internal source composition only. Production fixes an empty action registry. */
import {createHumanDecisionCommands} from './human-commands-source';
import type {DecisionActionDescriptor} from './action-registry';
import {createProposalInputVerifier,type ProposalInputContext} from './input-binding-source';
import type {VerifiedProposalInput} from './contracts';
import {decisionExpiry} from './contracts';
import {currentConfiguration} from '../auth/context';
import {resolveActor} from '../auth/authorize';
import {requireRuntimeProof} from '../auth/runtime-proof';
import type {CommandDescriptor} from '../workspace/commands';
import type {CommandContext} from '../workspace/context';
import type {WorkspaceTransaction} from '../storage/transaction';
import {withTransaction} from '../storage/transaction';
import {findOutcome} from '../workspace/idempotency';
import {canonicalJson} from '../config/bootstrap';
import type {TaskRequestDecisionRequest,TaskCommandResult} from '../http/dto';
import {validateTaskRequestDecisionRequest,validateTaskCommandResult} from '../http/generated/auth-validators.js';
import {HttpError} from '../http/envelopes';
import {taskAccess,taskRecord,taskView,assertTaskOutcomeVisible} from '../tasks/repository';
import {assertActiveRun,runRecord,runView,executionActor,assertRunOutcomeVisible,nextRunVersion} from '../tasks/lease';
import {approvalRecord,approvalView,assertApprovalOutcomeVisible,semanticAnchor} from './repository';
import {parsePersistedBinding,parseSemanticAnchor,parseDecisionActor,parseReviewerIds} from './stored-validation';
import {assertDecisionProposalCapacity} from './capacity';
import {markSchedulerDirty} from '../outbox/scheduler-state';
export interface DecisionIds {approvalId:string;checkpointId:string;proposalId:string;}
export type DecisionPreparationContext=ProposalInputContext&{readonly idempotencyKey:string};
function validate(body:TaskRequestDecisionRequest):void{if(!validateTaskRequestDecisionRequest(body))throw new HttpError('INVALID_REQUEST',400);if(new TextEncoder().encode(JSON.stringify(body)).length>65536)throw new HttpError('LIMIT_EXCEEDED',413);}
export function createDecisionCommands(descriptors:readonly DecisionActionDescriptor[]){
 const verifier=createProposalInputVerifier(descriptors);
 async function prepareRequestTaskDecision(context:DecisionPreparationContext,id:string,body:TaskRequestDecisionRequest,proofHash:string,ids:DecisionIds):Promise<CommandDescriptor<TaskRequestDecisionRequest,TaskCommandResult>>{
  validate(body);const request=structuredClone(body),ctx={...context},capturedIds={...ids};
  for(const value of [id,...Object.values(capturedIds)])if(!/^[A-Za-z0-9_-]{1,128}$/.test(value))throw new HttpError('INVALID_REQUEST',400);
  const operation='tasks:execute',target='tasks:'+id+':request-decision';
  let authorizationRunId=request.run_id;
  function proof(tx:WorkspaceTransaction,c:CommandContext,b:TaskRequestDecisionRequest){
   const row=runRecord(tx,c.actor.workspaceId,authorizationRunId);return requireRuntimeProof(tx,c,row.runtime_instance_id,proofHash);
  }
  function access(tx:WorkspaceTransaction,c:CommandContext,b:TaskRequestDecisionRequest):void{
   const verified=proof(tx,c,b),actor=executionActor(tx,c,operation,verified);taskAccess(tx,actor,'tasks:read',id,c.nowMs);taskAccess(tx,actor,'artifacts:read',id,c.nowMs);taskAccess(tx,actor,operation,id,c.nowMs);
   const run=runRecord(tx,actor.workspaceId,authorizationRunId);if(run.task_id!==id)throw new HttpError('FORBIDDEN',403);assertRunOutcomeVisible(tx,{...c,actor},runView(run),verified,operation);
  }
  const retained=withTransaction(ctx.workspace.storage,tx=>{
   currentConfiguration(tx,ctx.workspace,ctx.admission);const actor=resolveActor(tx,ctx.identity,ctx.workspace.clock.nowMs()),c={actor,nowMs:ctx.workspace.clock.nowMs(),requestId:ctx.requestId,idempotencyKey:ctx.idempotencyKey};
   taskAccess(tx,actor,operation,id,c.nowMs);
   const prior=findOutcome(tx,actor.principalId,operation,target,ctx.idempotencyKey,actor.workspaceId);
   if(prior){
    const saved:unknown=JSON.parse(prior.outcome_json);
    if(!validateTaskCommandResult(saved)||saved.task.id!==id||!saved.run||saved.run.task_id!==id||!saved.approval)throw new HttpError('INTERNAL_ERROR',500);
    // Saved ID selects a current proof check, not authority. Changed body still reaches ledger conflict.
    authorizationRunId=saved.run.id;
   }
   access(tx,c,request);return prior!==null;
  });
  let input:VerifiedProposalInput|undefined;
  if(!retained){try{input=await verifier.verifyProposalInput(ctx,{taskId:id,taskVersion:request.expected_version},request.checkpoint,request.proposal);}catch{throw new HttpError('DEPENDENCY_UNAVAILABLE',503);}}
  return {operation,target,
   resource(tx,c,b){validate(b);access(tx,c,b);const row=taskRecord(tx,c.actor.workspaceId,id);return {kind:'task',id,projectId:row.project_id};},
   checkAccess(tx,c,b){access(tx,c,b);},
   checkReplay(tx,c,b,outcome){
    if(!validateTaskCommandResult(outcome.data)||outcome.data.task.id!==id||!outcome.data.run||outcome.data.run.id!==b.run_id||!outcome.data.approval)throw new HttpError('INTERNAL_ERROR',500);
    assertTaskOutcomeVisible(tx,c.actor,outcome.data.task,c.nowMs);assertRunOutcomeVisible(tx,c,outcome.data.run,proof(tx,c,b),operation);assertApprovalOutcomeVisible(tx,c.actor,outcome.data.approval,c.nowMs);
   },
   execute(tx,c,b,acceptedEventId){
    // Retention racing preparation cannot turn a historical request into new admission.
    if(!input)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
    if(canonicalJson(b)!==canonicalJson(request))throw new HttpError('INVALID_REQUEST',400);
    const row=taskRecord(tx,c.actor.workspaceId,id);if(row.task_version!==b.expected_version)throw new HttpError('VERSION_CONFLICT',409,{current_version:row.task_version});
    const run=assertActiveRun(tx,c,id,b.run_id,b.fence,proof(tx,c,b));
    let resolution;try{resolution=verifier.recheckProposalInput(tx,ctx,{taskId:id,taskVersion:b.expected_version},b.checkpoint,b.proposal,input);}catch{throw new HttpError('DEPENDENCY_UNAVAILABLE',503);}
    if(c.nowMs<resolution.resolvedAt||c.nowMs>=resolution.expiresAt)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
    if(!Number.isSafeInteger(row.proposal_version)||row.proposal_version<0||row.proposal_version>=Number.MAX_SAFE_INTEGER)throw new HttpError('LIMIT_EXCEEDED',409);
    const taskVersion=nextRunVersion(row.task_version),proposalVersion=row.proposal_version+1,runVersion=nextRunVersion(run.run_version);
    const expiry=decisionExpiry(c.nowMs,JSON.parse(resolution.policyCanonicalJson).expiry_seconds);
    const {input:_privateInput,...binding}=resolution;const actor={kind:c.actor.kind,principal_id:c.actor.principalId,agent_id:c.actor.agentId};
    parsePersistedBinding(canonicalJson(binding));parseSemanticAnchor(semanticAnchor(row));parseDecisionActor(canonicalJson(actor));parseReviewerIds(canonicalJson(resolution.reviewerIds));
    assertDecisionProposalCapacity({id:capturedIds.proposalId,workspace_id:row.workspace_id,task_id:id,proposal_version:proposalVersion,proposal_json:canonicalJson(b.proposal),binding_json:canonicalJson(binding),semantic_anchor_json:semanticAnchor(row),created_at:c.nowMs});
    tx.exec('INSERT INTO decision_checkpoints(id,workspace_id,task_id,run_id,checkpoint_json,created_at) VALUES(?,?,?,?,?,?)',[capturedIds.checkpointId,row.workspace_id,id,b.run_id,canonicalJson(b.checkpoint),c.nowMs]);
    tx.exec('INSERT INTO decision_proposals(id,workspace_id,task_id,proposal_version,proposal_json,binding_json,semantic_anchor_json,created_at) VALUES(?,?,?,?,?,?,?,?)',[capturedIds.proposalId,row.workspace_id,id,proposalVersion,canonicalJson(b.proposal),canonicalJson(binding),semanticAnchor(row),c.nowMs]);
    tx.exec("INSERT INTO approvals(id,workspace_id,task_id,run_id,checkpoint_id,proposal_id,approval_version,proposal_version,task_version_at_request,status,reviewer_ids_json,requested_by_json,created_at,expires_at) VALUES(?,?,?,?,?,?,1,?,?,'pending',?,?,?,?)",[capturedIds.approvalId,row.workspace_id,id,b.run_id,capturedIds.checkpointId,capturedIds.proposalId,proposalVersion,row.task_version,canonicalJson(resolution.reviewerIds),canonicalJson(actor),c.nowMs,expiry]);
    for(const edge of resolution.artifactEdges){const a=edge.artifact;tx.exec('INSERT INTO decision_artifact_edges(workspace_id,approval_id,role,artifact_id,generation_id,artifact_version,sha256,byte_size) VALUES(?,?,?,?,?,?,?,?)',[row.workspace_id,capturedIds.approvalId,edge.role,a.artifactId,a.generationId,a.artifactVersion,a.sha256,a.byteLength]);}
    tx.exec("UPDATE runs SET status='paused',run_version=?,ended_at=? WHERE workspace_id=? AND id=?",[runVersion,c.nowMs,row.workspace_id,b.run_id]);
    tx.exec("UPDATE tasks SET state='waiting',task_version=?,proposal_version=?,approval_id=?,active_run_id=NULL,updated_at=? WHERE workspace_id=? AND id=?",[taskVersion,proposalVersion,capturedIds.approvalId,c.nowMs,row.workspace_id,id]);
    const transitionId=acceptedEventId;
    tx.exec("INSERT INTO decision_lifecycle_transitions(id,workspace_id,approval_id,task_id,sequence,kind,before_version,after_version,before_state,after_state,run_id,created_at) VALUES(?,?,?,?,1,'request',?,?,'doing','waiting',?,?)",[transitionId,row.workspace_id,capturedIds.approvalId,id,row.task_version,taskVersion,b.run_id,c.nowMs]);
    tx.exec("INSERT INTO decision_lifecycle_heads(workspace_id,approval_id,task_id,task_version,task_state,transition_count,last_transition_id) VALUES(?,?,?,?,'waiting',1,?)",[row.workspace_id,capturedIds.approvalId,id,taskVersion,transitionId]);markSchedulerDirty(tx);
    for(const reviewerId of resolution.reviewerIds)tx.exec('INSERT INTO decision_notice_intents(workspace_id,approval_id,reviewer_principal_id,event_id,created_at) VALUES(?,?,?,?,?)',[row.workspace_id,capturedIds.approvalId,reviewerId,acceptedEventId,c.nowMs]);
    const data={task:taskView(tx,c.actor,taskRecord(tx,row.workspace_id,id),c.nowMs),run:runView(runRecord(tx,row.workspace_id,b.run_id)),approval:approvalView(tx,c.actor,approvalRecord(tx,row.workspace_id,capturedIds.approvalId),c.nowMs)};
    if(!validateTaskCommandResult(data))throw new HttpError('INTERNAL_ERROR',500);
    return {outcome:{status:200,data},event:{type:'task.decision_requested',resourceType:'task',resourceId:id,resourceVersion:null,threadId:null}};
   }
  };
 }
 return Object.freeze({prepareRequestTaskDecision,...createHumanDecisionCommands(descriptors)});
}
