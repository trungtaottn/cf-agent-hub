import {requireRuntimeProof} from '../auth/runtime-proof';
import {assertActiveRun} from '../tasks/lease';
/** Trusted source composition only. No registry/receipt supplied by an HTTP caller. */
import type {DecisionActionDescriptor} from './action-registry';
import {createPersistedInputVerifier,type PersistedDecisionEvidence} from './persisted-input-source';
import type {ProposalInputContext} from './input-binding-source';
import {currentConfiguration} from '../auth/context';
import {resolveActor} from '../auth/authorize';
import {taskAccess,taskRecord,type TaskRow} from '../tasks/repository';
import {withTransaction,assertTransactionStorage,type WorkspaceTransaction} from '../storage/transaction';
import {canonicalJson} from '../config/bootstrap';
export interface ConsumedRunBinding {readonly runId:string;readonly fence:number;readonly runtimeInstanceId:string;readonly proofHash:string;}
export interface VerifiedConsumedIntent {readonly kind:'consumed-intent';}
export interface VerifiedApprovedIntent {readonly kind:'approved-intent';}
function unavailable():never{throw Error('DECISION_UNAVAILABLE');}
export function createApprovedIntentGuard(descriptors:readonly DecisionActionDescriptor[]){
 const verifier=createPersistedInputVerifier(descriptors),receipts=new WeakMap<object,{taskId:string;approvalId:string;evidence:PersistedDecisionEvidence}>();
 async function verifyApprovedIntent(ctx:ProposalInputContext,taskId:string):Promise<VerifiedApprovedIntent|null>{
  try{
   const approvalId=withTransaction(ctx.workspace.storage,tx=>{currentConfiguration(tx,ctx.workspace,ctx.admission);const now=ctx.workspace.clock.nowMs(),actor=resolveActor(tx,ctx.identity,now);if(actor.kind!=='agent')unavailable();taskAccess(tx,actor,'tasks:claim',taskId,now);taskAccess(tx,actor,'tasks:execute',taskId,now);return taskRecord(tx,actor.workspaceId,taskId).approval_id;});
   if(approvalId===null)return null;
   const evidence=await verifier.verifyPersistedDecisionInput(ctx,approvalId,'claim'),receipt=Object.freeze({kind:'approved-intent' as const});receipts.set(receipt,{taskId,approvalId,evidence});return receipt;
  }catch{return unavailable();}
 }
 function assertApprovedIntentCurrent(tx:WorkspaceTransaction,ctx:ProposalInputContext,task:TaskRow,evidence:VerifiedApprovedIntent|null){
  try{
   if(evidence===null){
    assertTransactionStorage(tx,ctx.workspace.storage);currentConfiguration(tx,ctx.workspace,ctx.admission);
    const now=ctx.workspace.clock.nowMs(),actor=resolveActor(tx,ctx.identity,now);if(actor.kind!=='agent')unavailable();taskAccess(tx,actor,'tasks:claim',task.id,now);taskAccess(tx,actor,'tasks:execute',task.id,now);
    const current=taskRecord(tx,actor.workspaceId,task.id);if(current.approval_id!==null||canonicalJson(current)!==canonicalJson(task))unavailable();return null;
   }
   const r=receipts.get(evidence);if(!r||r.taskId!==task.id||r.approvalId!==task.approval_id)unavailable();
   const state=verifier.recheckPersistedDecisionInput(tx,ctx,r.approvalId,r.evidence);if(canonicalJson(state.task)!==canonicalJson(task))unavailable();return state;
  }catch{return unavailable();}
 }

 const consumedReceipts=new WeakMap<object,{ctx:ProposalInputContext;taskId:string;approvalId:string;run:ConsumedRunBinding;evidence:PersistedDecisionEvidence}>();
 function currentRun(tx:WorkspaceTransaction,ctx:ProposalInputContext,taskId:string,run:ConsumedRunBinding){
  currentConfiguration(tx,ctx.workspace,ctx.admission);const nowMs=ctx.workspace.clock.nowMs(),actor=resolveActor(tx,ctx.identity,nowMs),c={actor,nowMs,requestId:ctx.requestId,idempotencyKey:'consumed-intent'};
  const proof=requireRuntimeProof(tx,c,run.runtimeInstanceId,run.proofHash);assertActiveRun(tx,c,taskId,run.runId,run.fence,proof);
  const task=taskRecord(tx,actor.workspaceId,taskId);if(task.approval_id===null)unavailable();return task;
 }
 async function verifyConsumedIntent(context:ProposalInputContext,taskId:string,binding:ConsumedRunBinding):Promise<VerifiedConsumedIntent>{
  try{
   const ctx={...context},run=Object.freeze({...binding}),task=withTransaction(ctx.workspace.storage,tx=>currentRun(tx,ctx,taskId,run));
   const evidence=await verifier.verifyPersistedDecisionInput(ctx,task.approval_id!,'dispatch');
   withTransaction(ctx.workspace.storage,tx=>{currentRun(tx,ctx,taskId,run);verifier.recheckPersistedDecisionInput(tx,ctx,task.approval_id!,evidence);});
   const receipt=Object.freeze({kind:'consumed-intent' as const});consumedReceipts.set(receipt,{ctx,taskId,approvalId:task.approval_id!,run,evidence});return receipt;
  }catch{return unavailable();}
 }
 /** Call immediately at the future owned effect boundary. Never a serialized permit. */
 function assertConsumedIntentCurrent(tx:WorkspaceTransaction,ctx:ProposalInputContext,taskId:string,evidence:VerifiedConsumedIntent){
  try{
   const r=consumedReceipts.get(evidence);if(!r||r.taskId!==taskId)unavailable();const task=currentRun(tx,ctx,taskId,r.run);
   if(task.approval_id!==r.approvalId)unavailable();const state=verifier.recheckPersistedDecisionInput(tx,ctx,r.approvalId,r.evidence);
   if(state.consumed?.id!==r.run.runId||state.consumed.fence!==r.run.fence||state.consumed.runtime_instance_id!==r.run.runtimeInstanceId)unavailable();
   return Object.freeze({actionId:state.binding.actionId,input:state.input});
  }catch{return unavailable();}
 }
 return Object.freeze({verifyApprovedIntent,assertApprovedIntentCurrent,verifyConsumedIntent,assertConsumedIntentCurrent});
}
