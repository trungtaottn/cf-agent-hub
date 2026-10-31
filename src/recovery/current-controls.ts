import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {canonicalJson} from '../config/bootstrap';
import {markSchedulerDirty} from '../outbox/scheduler-state';
import {maintenanceRow,transitionMaintenance} from './maintenance';
import {canonicalBytes,digestBytes} from './encoding';
import {UNRESOLVED_EFFECT_IDS_LIMIT} from './generated/recovery-validators.js';
import {signRecordAsync,verifyCurrentLedger,verifyRetirement,verifyCutover} from './manifest';
import type {RecoveryContext,RecoveryWorkspace,RecoveryReceipt,RetirementReceipt,ResumeReceipt,CurrentLedger,CutoverRecord} from './protocol';
import {validateRecoveryReceipt,validateRetirementReceipt,validateResumeReceipt} from './generated/recovery-validators.js';
import {readStoredProbe,PROBE_MAX_AGE_MS} from './probes';
import {admitCurrentControl,type ControlJob} from './current-control-admission';
function effectSummary(tx:WorkspaceTransaction,job:ControlJob,exclude:string|null=null):Pick<RecoveryReceipt,'unresolved_effect_ids'|'unresolved_effect_count'|'unresolved_effect_ids_complete'> {
 const where="workspace_id=? AND status IN ("+(job.operation==='restore'?"'pending','in_flight'":"'in_flight'")+")"+(exclude===null?'':' AND id<>?'),args=exclude===null?[job.workspace_id]:[job.workspace_id,exclude];
 const count=tx.one<{n:number}>('SELECT COUNT(*) AS n FROM outbox WHERE '+where,args)!.n;
 if(!Number.isSafeInteger(count)||count<0)throw Error('RECOVERY_ROW_COUNT');
 const ids=tx.all<{id:string}>('SELECT id FROM outbox WHERE '+where+' ORDER BY id LIMIT ?',[...args,UNRESOLVED_EFFECT_IDS_LIMIT]).map(r=>r.id);
 if(ids.length!==Math.min(count,UNRESOLVED_EFFECT_IDS_LIMIT))throw Error('RECOVERY_ROW_COUNT');
 return {unresolved_effect_ids:ids,unresolved_effect_count:count,unresolved_effect_ids_complete:ids.length===count};
}
export async function resolveCurrentDelivery(w:RecoveryWorkspace,ctx:RecoveryContext,input:{delivery_id:string;disposition:'confirmed_delivered'|'failed_without_redrive';evidence_sha256:string}):Promise<RecoveryReceipt> {
 ctx=structuredClone(ctx);input=structuredClone(input);
 if(ctx.operation!=='resolve-delivery'||!ctx.captureId)throw Error('INVALID_RECOVERY_CONTEXT');
 const session=await admitCurrentControl(w,ctx);await session.guard();if(session.prior){if(!validateRecoveryReceipt(session.prior))throw Error('RECOVERY_OPERATION_CONFLICT');return session.prior;}
 const job=session.job!;if(!job)throw Error('RECOVERY_JOB_CONFLICT');
 const check=(tx:WorkspaceTransaction)=>{session.assertPending(tx);if(tx.one("SELECT fingerprint FROM idempotency_outcomes WHERE principal_id='system_recovery' AND operation='operator.recovery.evidence' AND target=? AND key=?",[job.id,input.delivery_id]))throw Error('RECOVERY_RESOLUTION_CONFLICT');const row=tx.one<{status:string}>('SELECT status FROM outbox WHERE id=? AND workspace_id=?',[input.delivery_id,w.workspaceId]);if(!row||!['pending','in_flight'].includes(row.status))throw Error('RECOVERY_RESOLUTION_CONFLICT');return effectSummary(tx,job,input.delivery_id);};
 const id='resolution_'+(await digestBytes(canonicalBytes([w.workspaceId,ctx.captureId,input.delivery_id]))).slice(0,48);await session.guard();
 const now=w.clock.nowMs(),summary=withTransaction(w.storage,check),receipt:RecoveryReceipt={id,capture_id:ctx.captureId,workspace_id:w.workspaceId,status:'complete',checks:[{name:'delivery_resolution',passed:true,code:input.disposition}],...summary,started_at:new Date(now).toISOString(),ended_at:new Date(now).toISOString()};
 const digest=await digestBytes(canonicalBytes(receipt));await session.guard();
 return withTransaction(w.storage,tx=>{if(canonicalJson(check(tx))!==canonicalJson(summary))throw Error('RECOVERY_RESOLUTION_CONFLICT');tx.exec('UPDATE outbox SET status=?,updated_at=? WHERE id=?',[input.disposition==='confirmed_delivered'?'succeeded':'cancelled',now,input.delivery_id]);
  tx.exec("INSERT INTO idempotency_outcomes (principal_id,operation,target,key,workspace_id,fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at) VALUES ('system_recovery','operator.recovery.evidence',?,?,?,?,200,?,?,NULL,?,?)",[job.id,input.delivery_id,w.workspaceId,ctx.requestFingerprint,canonicalJson({...input,operator_principal_id:ctx.principalId,operation_id:ctx.operationId,resolved_at:new Date(now).toISOString()}),ctx.requestId,now,Number.MAX_SAFE_INTEGER]);
  session.complete(tx,receipt,digest);return receipt;});
}
export async function retireCurrentWorkspace(w:RecoveryWorkspace,ctx:RecoveryContext):Promise<RetirementReceipt> {
 ctx=structuredClone(ctx);
 if(ctx.operation!=='retire'||!ctx.captureId)throw Error('INVALID_RECOVERY_CONTEXT');
 const session=await admitCurrentControl(w,ctx);await session.guard();if(session.prior){if(!validateRetirementReceipt(session.prior))throw Error('RECOVERY_OPERATION_CONFLICT');return session.prior;}
 const job=session.job;if(!job||job.operation!=='capture'||!job.details.checkpoint)throw Error('RECOVERY_RETIREMENT_CONFLICT');
 const id='retired_'+(await digestBytes(canonicalBytes([w.workspaceId,ctx.captureId,ctx.expectedEpoch]))).slice(0,48);await session.guard();
 const receipt=await signRecordAsync<RetirementReceipt>({id,capture_id:ctx.captureId,workspace_id:w.workspaceId,environment_id:w.environmentId,authority_epoch:ctx.expectedEpoch,barrier_id:job.details.checkpoint.barrier_id,retired_at:new Date(w.clock.nowMs()).toISOString(),auth:{key_id:w.integrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},w.integrity,session.guard);await session.guard();
 const digest=await digestBytes(canonicalBytes(receipt));await session.guard();
 return withTransaction(w.storage,tx=>{session.assertPending(tx);transitionMaintenance(tx,{state:'retired',epoch:ctx.expectedEpoch,barrierId:receipt.barrier_id,captureId:ctx.captureId!,nowMs:w.clock.nowMs(),advance:true});session.complete(tx,receipt,digest);return receipt;});
}
export async function resumeCurrentWorkspace(w:RecoveryWorkspace,ctx:RecoveryContext,input:{receipt_id:string;ledger:CurrentLedger;source_retirement_receipt:RetirementReceipt|null;cutover_record:CutoverRecord|null}):Promise<ResumeReceipt> {
 ctx=structuredClone(ctx);input=structuredClone(input);
 if(ctx.operation!=='resume'||!ctx.captureId)throw Error('INVALID_RECOVERY_CONTEXT');
 const session=await admitCurrentControl(w,ctx);await session.guard();if(session.prior){if(!validateResumeReceipt(session.prior))throw Error('RECOVERY_OPERATION_CONFLICT');return session.prior;}
 const job=session.job;if(!job||job.details.receipt?.id!==input.receipt_id)throw Error('RECOVERY_RECEIPT_CONFLICT');
 const manifest=job.details.manifest!;
 const ledger=await verifyCurrentLedger(input.ledger,ctx.ledgerAnchor,w,job.operation==='restore'?manifest.checkpoint.authority_epoch:undefined,session.guard);await session.guard();
 if(ledger.ledger.authority_epoch!==ctx.expectedEpoch||ledger.ledger.installation_digest!==ctx.expectedInstallationDigest)throw Error('RECOVERY_LEDGER_MISMATCH');
 if(job.operation==='restore'){
  if(!input.source_retirement_receipt||!input.cutover_record)throw Error('RECOVERY_EXCLUSIVE_AUTHORITY_CONFLICT');
  const retirement=await verifyRetirement(input.source_retirement_receipt,w.integrity,session.guard);await session.guard();
  const cutover=await verifyCutover(input.cutover_record,w.integrity,session.guard);await session.guard();
  if(retirement.capture_id!==job.capture_id||retirement.workspace_id!==w.workspaceId||retirement.environment_id!==manifest.environment_id||retirement.authority_epoch!==manifest.checkpoint.authority_epoch||retirement.barrier_id!==manifest.checkpoint.barrier_id||Date.parse(retirement.retired_at)<Date.parse(manifest.ended_at)||Date.parse(retirement.retired_at)>w.clock.nowMs()||cutover.capture_id!==job.capture_id||cutover.workspace_id!==w.workspaceId||cutover.source_environment_id!==retirement.environment_id||cutover.source_authority_epoch!==retirement.authority_epoch||cutover.target_environment_id!==w.environmentId||cutover.target_authority_epoch!==ctx.expectedEpoch||cutover.source_retirement_receipt_id!==retirement.id||cutover.target_catalog_mapping.workspace_id!==w.workspaceId||cutover.target_catalog_mapping.object_name!==w.objectName||cutover.target_authority_epoch<=cutover.source_authority_epoch||cutover.source_environment_id===cutover.target_environment_id||Date.parse(cutover.cutover_at)<Date.parse(retirement.retired_at)||Date.parse(cutover.cutover_at)>w.clock.nowMs())throw Error('RECOVERY_EXCLUSIVE_AUTHORITY_CONFLICT');
 }else if(input.source_retirement_receipt!==null||input.cutover_record!==null||ledger.ledger.retired_authorities.some(x=>x.environment_id===w.environmentId&&x.authority_epoch===ctx.expectedEpoch))throw Error('RECOVERY_EXCLUSIVE_AUTHORITY_CONFLICT');
 const id='resumed_'+(await digestBytes(canonicalBytes([w.workspaceId,ctx.captureId,ctx.operationId]))).slice(0,48);await session.guard();
 const inspect=(tx:WorkspaceTransaction)=>{session.assertPending(tx);if(effectSummary(tx,job).unresolved_effect_count!==0)throw Error('RECOVERY_UNRESOLVED_EFFECTS');const p=readStoredProbe(tx,w.workspaceId),now=w.clock.nowMs();if(!p||p.maintenance_generation!==session.record.local.generation||p.installation_digest!==ctx.expectedInstallationDigest||p.receipt.config_epoch!==ctx.expectedEpoch||p.receipt.schema_version!==16||now-Date.parse(p.receipt.checked_at)>PROBE_MAX_AGE_MS||Date.parse(p.receipt.checked_at)>now||p.receipt.checks.some(x=>!x.passed))throw Error('RECOVERY_PROBE_REQUIRED');return p;};
 const probe=withTransaction(w.storage,inspect),generation=session.record.local.generation+1;
 if(!Number.isSafeInteger(generation))throw Error('MAINTENANCE_GENERATION_EXHAUSTED');
 const receipt:ResumeReceipt={id,capture_id:ctx.captureId,workspace_id:w.workspaceId,authority_epoch:ctx.expectedEpoch,old_generation:session.record.local.generation,new_generation:generation,probe_id:probe.receipt.id,resumed_at:new Date(w.clock.nowMs()).toISOString()};
 const digest=await digestBytes(canonicalBytes(receipt));await session.guard();
 withTransaction(w.storage,tx=>{if(canonicalJson(inspect(tx))!==canonicalJson(probe))throw Error('RECOVERY_PROBE_REQUIRED');transitionMaintenance(tx,{state:'open',epoch:ctx.expectedEpoch,barrierId:maintenanceRow(tx)!.barrier_id!,captureId:ctx.captureId!,nowMs:w.clock.nowMs(),advance:true});markSchedulerDirty(tx);session.complete(tx,receipt,digest);});
 try{await w.repairSchedule();}catch{/* Durable completion remains; readiness exposes schedule failure. */}
 // This is the completed branch, not the obsolete pre-transition guard. No repeated transition.
 const completed=await admitCurrentControl(w,ctx);if(!completed.prior||!validateResumeReceipt(completed.prior))throw Error('RECOVERY_CONTROL_ADMISSION_CONFLICT');return completed.prior;
}
