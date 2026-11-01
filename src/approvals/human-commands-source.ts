/** Internal source composition. Actual current humans only; no requester impersonation. */
import type {DecisionActionDescriptor} from './action-registry';
import {createPersistedInputVerifier,type PersistedDecisionEvidence} from './persisted-input-source';
import type {DecisionPreparationContext} from './commands-source';
import type {CommandDescriptor} from '../workspace/commands';
import type {CommandContext} from '../workspace/context';
import {currentConfiguration} from '../auth/context';
import {resolveActor} from '../auth/authorize';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {findOutcome} from '../workspace/idempotency';
import {canonicalJson} from '../config/bootstrap';
import {HttpError} from '../http/envelopes';
import type {ApprovalDecisionRequest,TaskCommandResult} from '../http/dto';
import {validateApprovalDecisionRequest,validateTaskCommandResult} from '../http/generated/auth-validators.js';
import {taskAccess,taskRecord,taskView,assertTaskOutcomeVisible} from '../tasks/repository';
import {nextRunVersion} from '../tasks/lease';
import {getApproval} from './queries';
import {approvalRecord,approvalView,assertApprovalOutcomeVisible} from './repository';
import {appendDecisionTransition} from './lifecycle';
import {markSchedulerDirty} from '../outbox/scheduler-state';
function validate(body:ApprovalDecisionRequest):void{
 if(!validateApprovalDecisionRequest(body)||![body.expected_version,body.expected_proposal_version,body.expected_approval_version].every(n=>Number.isSafeInteger(n)&&n>0))throw new HttpError('INVALID_REQUEST',400);
 if(new TextEncoder().encode(JSON.stringify(body)).length>65536)throw new HttpError('LIMIT_EXCEEDED',413);
}
export function createHumanDecisionCommands(descriptors:readonly DecisionActionDescriptor[]){
 const verifier=createPersistedInputVerifier(descriptors);
 async function prepareApprovalDecision(context:DecisionPreparationContext,id:string,action:'approve'|'reject',body:ApprovalDecisionRequest):Promise<CommandDescriptor<ApprovalDecisionRequest,TaskCommandResult>>{
  validate(body);if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!['approve','reject'].includes(action))throw new HttpError('INVALID_REQUEST',400);
  const request=structuredClone(body),ctx={...context},operation='approvals:decide',target='approvals:'+id+':'+action;
  function access(tx:WorkspaceTransaction,c:CommandContext){
   if(c.actor.kind!=='human'||!c.actor.sessionId)throw new HttpError('FORBIDDEN',403);
   taskAccess(tx,c.actor,operation,null,c.nowMs);const view=getApproval(tx,c,id);
   if(!view.assigned_human_principal_ids.includes(c.actor.principalId))throw new HttpError('FORBIDDEN',403);
   assertApprovalOutcomeVisible(tx,c.actor,view,c.nowMs);return approvalRecord(tx,c.actor.workspaceId,id);
  }
  function fresh(tx:WorkspaceTransaction,c:CommandContext,b:ApprovalDecisionRequest){
   const approval=access(tx,c),task=taskRecord(tx,c.actor.workspaceId,approval.task_id);
   if(task.task_version!==b.expected_version||approval.proposal_version!==b.expected_proposal_version||approval.approval_version!==b.expected_approval_version)throw new HttpError('VERSION_CONFLICT',409,{current_version:task.task_version});
   if(c.nowMs>=approval.expires_at)throw new HttpError('APPROVAL_EXPIRED',409);
   if(approval.status!=='pending'||task.state!=='waiting'||task.approval_id!==id||task.active_run_id!==null||approval.consumed_run_id!==null)throw new HttpError('INVALID_STATE',409);
   return {approval,task};
  }
  const retained=withTransaction(ctx.workspace.storage,tx=>{
   currentConfiguration(tx,ctx.workspace,ctx.admission);const nowMs=ctx.workspace.clock.nowMs(),actor=resolveActor(tx,ctx.identity,nowMs),c={actor,nowMs,requestId:ctx.requestId,idempotencyKey:ctx.idempotencyKey};
   access(tx,c);const prior=findOutcome(tx,actor.principalId,operation,target,ctx.idempotencyKey,actor.workspaceId);if(!prior)fresh(tx,c,request);return prior!==null;
  });
  let evidence:PersistedDecisionEvidence|undefined;
  if(!retained){try{evidence=action==='approve'?await verifier.verifyPersistedDecisionInput(ctx,id,'human'):verifier.verifyPersistedDecisionMetadata(ctx,id);}catch{
   // Preserve direct deadline denial even if the R2 await crossed expiry.
   withTransaction(ctx.workspace.storage,tx=>{currentConfiguration(tx,ctx.workspace,ctx.admission);const nowMs=ctx.workspace.clock.nowMs(),actor=resolveActor(tx,ctx.identity,nowMs);fresh(tx,{actor,nowMs,requestId:ctx.requestId,idempotencyKey:ctx.idempotencyKey},request);});
   throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  }}
  return {operation,target,
   resource(tx,c,b){validate(b);const approval=access(tx,c),task=taskRecord(tx,c.actor.workspaceId,approval.task_id);return {kind:'task',id:task.id,projectId:task.project_id};},
   checkAccess(tx,c){access(tx,c);},
   checkReplay(tx,c,_b,outcome){
    if(!validateTaskCommandResult(outcome.data)||!outcome.data.approval||outcome.data.approval.id!==id||outcome.data.run!==null)throw new HttpError('INTERNAL_ERROR',500);
    assertTaskOutcomeVisible(tx,c.actor,outcome.data.task,c.nowMs);assertApprovalOutcomeVisible(tx,c.actor,outcome.data.approval,c.nowMs);
   },
   execute(tx,c,b,eventId){
    if(!evidence)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);if(canonicalJson(b)!==canonicalJson(request))throw new HttpError('INVALID_REQUEST',400);
    const {approval,task}=fresh(tx,c,b);let checked;
    try{checked=action==='approve'?verifier.recheckPersistedDecisionInput(tx,ctx,id,evidence):verifier.recheckPersistedDecisionMetadata(tx,ctx,id,evidence);}catch{throw new HttpError('DEPENDENCY_UNAVAILABLE',503);}
    if(checked.actor.principalId!==c.actor.principalId||checked.actor.sessionId!==c.actor.sessionId||checked.actor.workspaceId!==c.actor.workspaceId)throw new HttpError('FORBIDDEN',403);
    const taskVersion=nextRunVersion(task.task_version),approvalVersion=nextRunVersion(approval.approval_version),state=action==='approve'?'ready':'backlog',status=action==='approve'?'approved':'rejected';
    tx.exec('UPDATE approvals SET status=?,approval_version=?,decided_at=?,decided_by_json=?,decision_reason=? WHERE workspace_id=? AND id=?',[status,approvalVersion,c.nowMs,canonicalJson({kind:'human',principal_id:c.actor.principalId,agent_id:null}),b.reason,c.actor.workspaceId,id]);
    tx.exec('UPDATE tasks SET state=?,task_version=?,updated_at=? WHERE workspace_id=? AND id=?',[state,taskVersion,c.nowMs,c.actor.workspaceId,task.id]);
    appendDecisionTransition(tx,checked.head,eventId,action,state,taskVersion,null,c.nowMs);markSchedulerDirty(tx);
    const data={task:taskView(tx,c.actor,taskRecord(tx,c.actor.workspaceId,task.id),c.nowMs),run:null,approval:approvalView(tx,c.actor,approvalRecord(tx,c.actor.workspaceId,id),c.nowMs)};
    if(!validateTaskCommandResult(data))throw new HttpError('INTERNAL_ERROR',500);
    return {outcome:{status:200,data},event:{type:action==='approve'?'task.decision_approved':'task.decision_rejected',resourceType:'task',resourceId:task.id,resourceVersion:null,threadId:null,historyReason:b.reason}};
   }
  };
 }
 return Object.freeze({prepareApprovalDecision});
}
