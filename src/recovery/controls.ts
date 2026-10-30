import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {canonicalJson} from '../config/bootstrap';
import {markSchedulerDirty} from '../outbox/scheduler-state';
import {maintenanceRow,transitionMaintenance} from './maintenance-v1';
import {canonicalBytes,digestBytes} from './encoding';
import {signRecord,verifyCurrentLedger,verifyRetirement,verifyCutover} from './manifest';
import {assertRecoveryContext,priorOperation,storeOperation,type RecoveryContext,type RecoveryWorkspace,type RecoveryReceipt,type RetirementReceipt,type ResumeReceipt,type CurrentLedger,type CutoverRecord} from './protocol';
import {validateRecoveryReceipt,validateRetirementReceipt,validateResumeReceipt} from './generated/recovery-validators.js';
import {captureJob,assertJob,unresolvedSummary,unresolvedEffectCount,type RecoveryJob} from './jobs';
import {readStoredProbe,PROBE_MAX_AGE_MS} from './probes';
import {RECOVERY_SCHEMA_VERSION} from './table-registry-v1';
function controlJob(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext):RecoveryJob {
 assertRecoveryContext(tx,w,ctx);const found=captureJob(tx,ctx.captureId!);if(!found)throw Error('RECOVERY_JOB_CONFLICT');const job=assertJob(tx,w,ctx,found.id);
 const maintenance=maintenanceRow(tx);if(job.state!=='complete'||job.details.receipt?.status!=='complete'||!maintenance||maintenance.capture_id!==ctx.captureId||!['captured','restored'].includes(maintenance.state))throw Error('RECOVERY_CONTROL_CONFLICT');return job;
}
export async function resolveDelivery(w:RecoveryWorkspace,ctx:RecoveryContext,input:{delivery_id:string;disposition:'confirmed_delivered'|'failed_without_redrive';evidence_sha256:string}):Promise<RecoveryReceipt>{
 if(ctx.operation!=='resolve-delivery'||!ctx.captureId)throw Error('INVALID_RECOVERY_CONTEXT');
 withTransaction(w.storage,tx=>assertRecoveryContext(tx,w,ctx));
 const id='resolution_'+(await digestBytes(canonicalBytes([w.workspaceId,ctx.captureId,input.delivery_id]))).slice(0,48);
 return withTransaction(w.storage,tx=>{assertRecoveryContext(tx,w,ctx);const prior=priorOperation(tx,ctx);if(prior){if(!validateRecoveryReceipt(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return prior;}const job=controlJob(tx,w,ctx);
  const existing=tx.one<{fingerprint:string}>("SELECT fingerprint FROM idempotency_outcomes WHERE principal_id='system_recovery' AND operation='operator.recovery.evidence' AND target=? AND key=?",[job.id,input.delivery_id]);if(existing)throw Error('RECOVERY_RESOLUTION_CONFLICT');
  const row=tx.one<{status:string}>('SELECT status FROM outbox WHERE id=? AND workspace_id=?',[input.delivery_id,w.workspaceId]);if(!row||!['pending','in_flight'].includes(row.status))throw Error('RECOVERY_RESOLUTION_CONFLICT');
  const now=w.clock.nowMs();tx.exec('UPDATE outbox SET status=?,updated_at=? WHERE id=?',[input.disposition==='confirmed_delivered'?'succeeded':'cancelled',now,input.delivery_id]);
  // Preserve attempts, due time, payload, lease and prior transport evidence. Resolution never ACKs or dispatches.
  tx.exec("INSERT INTO idempotency_outcomes (principal_id,operation,target,key,workspace_id,fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at) VALUES ('system_recovery','operator.recovery.evidence',?,?,?,?,200,?,?,NULL,?,?)",[job.id,input.delivery_id,w.workspaceId,ctx.requestFingerprint,canonicalJson({...input,operator_principal_id:ctx.principalId,operation_id:ctx.operationId,resolved_at:new Date(now).toISOString()}),ctx.requestId,now,Number.MAX_SAFE_INTEGER]);
  const receipt:RecoveryReceipt={id,capture_id:ctx.captureId!,workspace_id:w.workspaceId,status:'complete',checks:[{name:'delivery_resolution',passed:true,code:input.disposition}],...unresolvedSummary(tx,job),started_at:new Date(now).toISOString(),ended_at:new Date(now).toISOString()};storeOperation(tx,ctx,receipt,now);return receipt;});
}
export async function retireWorkspace(w:RecoveryWorkspace,ctx:RecoveryContext):Promise<RetirementReceipt>{
 if(ctx.operation!=='retire'||!ctx.captureId)throw Error('INVALID_RECOVERY_CONTEXT');
 const admission=withTransaction(w.storage,tx=>{const fence=assertRecoveryContext(tx,w,ctx),prior=priorOperation(tx,ctx);if(prior){if(!validateRetirementReceipt(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return {fence,prior,job:null};}const job=controlJob(tx,w,ctx);if(job.operation!=='capture')throw Error('RECOVERY_RETIREMENT_CONFLICT');return {fence,prior:null,job};});if(admission.prior)return admission.prior;
 const id='retired_'+(await digestBytes(canonicalBytes([w.workspaceId,ctx.captureId,ctx.expectedEpoch]))).slice(0,48),job=admission.job!;
 const receipt=await signRecord<RetirementReceipt>({id,capture_id:ctx.captureId,workspace_id:w.workspaceId,environment_id:w.environmentId,authority_epoch:ctx.expectedEpoch,barrier_id:job.details.checkpoint.barrier_id,retired_at:new Date(w.clock.nowMs()).toISOString(),auth:{key_id:w.integrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},w.integrity);
 return withTransaction(w.storage,tx=>{assertRecoveryContext(tx,w,ctx,admission.fence);const prior=priorOperation(tx,ctx);if(prior){if(!validateRetirementReceipt(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return prior;}controlJob(tx,w,ctx);transitionMaintenance(tx,{state:'retired',epoch:ctx.expectedEpoch,barrierId:receipt.barrier_id,captureId:ctx.captureId!,nowMs:w.clock.nowMs(),advance:true});storeOperation(tx,ctx,receipt,w.clock.nowMs());return receipt;});
}
export async function resumeWorkspace(w:RecoveryWorkspace,ctx:RecoveryContext,input:{receipt_id:string;ledger:CurrentLedger;source_retirement_receipt:RetirementReceipt|null;cutover_record:CutoverRecord|null}):Promise<ResumeReceipt>{
 if(ctx.operation!=='resume'||!ctx.captureId)throw Error('INVALID_RECOVERY_CONTEXT');
 const admitted=withTransaction(w.storage,tx=>{const fence=assertRecoveryContext(tx,w,ctx),prior=priorOperation(tx,ctx);if(prior){if(!validateResumeReceipt(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return {fence,prior,job:null};}const job=controlJob(tx,w,ctx);if(job.details.receipt!.id!==input.receipt_id)throw Error('RECOVERY_RECEIPT_CONFLICT');return {fence,prior:null,job};});if(admitted.prior)return admitted.prior;const job=admitted.job!;
 const ledger=await verifyCurrentLedger(input.ledger,ctx.ledgerAnchor,w,job.operation==='restore'?job.details.checkpoint.authority_epoch:undefined);
 if(ledger.ledger.authority_epoch!==ctx.expectedEpoch||ledger.ledger.installation_digest!==ctx.expectedInstallationDigest)throw Error('RECOVERY_LEDGER_MISMATCH');
 if(job.operation==='restore'){
  if(!input.source_retirement_receipt||!input.cutover_record)throw Error('RECOVERY_EXCLUSIVE_AUTHORITY_CONFLICT');
  const retirement=await verifyRetirement(input.source_retirement_receipt,w.integrity),cutover=await verifyCutover(input.cutover_record,w.integrity),manifest=job.details.manifest!;
  if(retirement.capture_id!==job.capture_id||retirement.workspace_id!==w.workspaceId||retirement.environment_id!==manifest.environment_id||retirement.authority_epoch!==manifest.checkpoint.authority_epoch||retirement.barrier_id!==manifest.checkpoint.barrier_id||Date.parse(retirement.retired_at)<Date.parse(manifest.ended_at)||Date.parse(retirement.retired_at)>w.clock.nowMs()||
   cutover.capture_id!==job.capture_id||cutover.workspace_id!==w.workspaceId||cutover.source_environment_id!==retirement.environment_id||cutover.source_authority_epoch!==retirement.authority_epoch||cutover.target_environment_id!==w.environmentId||cutover.target_authority_epoch!==ctx.expectedEpoch||cutover.source_retirement_receipt_id!==retirement.id||cutover.target_catalog_mapping.workspace_id!==w.workspaceId||cutover.target_catalog_mapping.object_name!==w.objectName||cutover.target_authority_epoch<=cutover.source_authority_epoch||cutover.source_environment_id===cutover.target_environment_id||Date.parse(cutover.cutover_at)<Date.parse(retirement.retired_at)||Date.parse(cutover.cutover_at)>w.clock.nowMs())throw Error('RECOVERY_EXCLUSIVE_AUTHORITY_CONFLICT');
 }else if(input.source_retirement_receipt!==null||input.cutover_record!==null||ledger.ledger.retired_authorities.some(x=>x.environment_id===w.environmentId&&x.authority_epoch===ctx.expectedEpoch))throw Error('RECOVERY_EXCLUSIVE_AUTHORITY_CONFLICT');
 const id='resumed_'+(await digestBytes(canonicalBytes([w.workspaceId,ctx.captureId,ctx.operationId]))).slice(0,48);
 const receipt=withTransaction(w.storage,tx=>{assertRecoveryContext(tx,w,ctx,admitted.fence);const prior=priorOperation(tx,ctx);if(prior){if(!validateResumeReceipt(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return prior;}const current=controlJob(tx,w,ctx);if(unresolvedEffectCount(tx,current)!==0)throw Error('RECOVERY_UNRESOLVED_EFFECTS');
  const probe=readStoredProbe(tx,w.workspaceId),now=w.clock.nowMs();if(!probe||probe.maintenance_generation!==admitted.fence.maintenanceGeneration||probe.installation_digest!==ctx.expectedInstallationDigest||probe.receipt.config_epoch!==ctx.expectedEpoch||probe.receipt.schema_version!==RECOVERY_SCHEMA_VERSION||now-Date.parse(probe.receipt.checked_at)>PROBE_MAX_AGE_MS||Date.parse(probe.receipt.checked_at)>now||probe.receipt.checks.some(x=>!x.passed))throw Error('RECOVERY_PROBE_REQUIRED');
  const next=transitionMaintenance(tx,{state:'open',epoch:ctx.expectedEpoch,barrierId:maintenanceRow(tx)!.barrier_id!,captureId:ctx.captureId!,nowMs:now,advance:true});markSchedulerDirty(tx);
  const receipt:ResumeReceipt={id,capture_id:ctx.captureId!,workspace_id:w.workspaceId,authority_epoch:ctx.expectedEpoch,old_generation:admitted.fence.maintenanceGeneration,new_generation:next.maintenanceGeneration,probe_id:probe.receipt.id,resumed_at:new Date(now).toISOString()};storeOperation(tx,ctx,receipt,now);return receipt;});
 try{await w.repairSchedule();}catch{/* Durable resumed authority remains visible; readiness reports scheduler failure. */}return receipt;
}
