import {recordCurrentProbe} from './current-probes';
import {recoverySchema} from './protocol';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {canonicalJson} from '../config/bootstrap';
import {admissionOpen,maintenanceRow,readAdmissionFence,sameFence} from './maintenance-v1';
import {inspectRegistry,RECOVERY_SCHEMA_VERSION} from './table-registry-v1';
import {assertRecoveryContext,priorOperation,storeOperation,type RecoveryContext,type RecoveryWorkspace,type ProbeReceipt,type ResumeReceipt} from './protocol';
import {validateProbeReceipt,validateResumeReceipt} from './generated/recovery-validators.js';
import {closed,digestBytes,canonicalBytes} from './encoding';
export type {ProbeReceipt,ResumeReceipt};
export const PROBE_MAX_AGE_MS=300000;
export const PROBE_CHECK_NAMES=['sql_write_read','rollback','schema','scheduler'] as const;
export interface StoredProbe {format_version:1;maintenance_generation:number;installation_digest:string;receipt:ProbeReceipt;}
export function parseStoredProbe(value:unknown):StoredProbe|null {
 try{if(typeof value==='string')value=JSON.parse(value);if(!closed(value,['format_version','maintenance_generation','installation_digest','receipt'])||value.format_version!==1||!Number.isSafeInteger(value.maintenance_generation)||Number(value.maintenance_generation)<0||typeof value.installation_digest!=='string'||!/^[a-f0-9]{64}$/.test(value.installation_digest)||!validateProbeReceipt(value.receipt)||JSON.stringify(value.receipt.checks.map(x=>x.name).sort())!==JSON.stringify([...PROBE_CHECK_NAMES].sort()))return null;return value as unknown as StoredProbe;}catch{return null;}
}
export function readStoredProbe(tx:WorkspaceTransaction,workspaceId:string):StoredProbe|null {
 const row=tx.one<{receipt_json:string}>('SELECT receipt_json FROM probe_receipts WHERE workspace_id=? ORDER BY checked_at DESC,id DESC LIMIT 1',[workspaceId]);return row?parseStoredProbe(row.receipt_json):null;
}
export function readResumeProbeLink(tx:WorkspaceTransaction,workspaceId:string,authorityEpoch:number,newGeneration:number):ResumeReceipt|null {
 const row=tx.one<{outcome_json:string}>("SELECT outcome_json FROM idempotency_outcomes WHERE workspace_id=? AND operation='operator.recovery.resume' AND json_extract(outcome_json,'$.authority_epoch')=? AND json_extract(outcome_json,'$.new_generation')=? ORDER BY created_at DESC LIMIT 1",[workspaceId,authorityEpoch,newGeneration]);
 try{const receipt:unknown=row?JSON.parse(row.outcome_json):null;return validateResumeReceipt(receipt)?receipt:null;}catch{return null;}
}
export async function recordProbe(w:RecoveryWorkspace,ctx:RecoveryContext):Promise<ProbeReceipt>{
 if(withTransaction(w.storage,tx=>recoverySchema(tx,ctx))===16)return recordCurrentProbe(w,ctx);
 if(ctx.operation!=='probe'||ctx.captureId!==null)throw Error('INVALID_RECOVERY_CONTEXT');
 const fence=withTransaction(w.storage,tx=>{const fence=assertRecoveryContext(tx,w,ctx);const row=maintenanceRow(tx);if(row&&!['open','captured','restored'].includes(row.state))throw Error('RECOVERY_BUSY');return fence;});
 const prior=withTransaction(w.storage,tx=>{assertRecoveryContext(tx,w,ctx,fence);return priorOperation(tx,ctx);});if(prior){if(!validateProbeReceipt(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return prior;}
 const id='probe_'+(await digestBytes(canonicalBytes([w.workspaceId,ctx.principalId,ctx.operationId]))).slice(0,48),temporary=id+'_rollback';
 let read=false,rollback=false;const sentinel={probeRollback:true};
 try{withTransaction(w.storage,tx=>{assertRecoveryContext(tx,w,ctx,fence);inspectRegistry(tx);tx.exec('INSERT INTO probe_receipts (id,workspace_id,authority_epoch,request_id,checked_at,receipt_json) VALUES (?,?,?,?,?,?)',[temporary,w.workspaceId,ctx.expectedEpoch,ctx.requestId,w.clock.nowMs(),'{}']);read=tx.one<{id:string}>('SELECT id FROM probe_receipts WHERE id=?',[temporary])?.id===temporary;if(!read)throw Error('PROBE_READ_FAILED');throw sentinel;});}
 catch(error){if(error!==sentinel)throw error;rollback=true;}
 withTransaction(w.storage,tx=>{assertRecoveryContext(tx,w,ctx,fence);if(tx.one('SELECT id FROM probe_receipts WHERE id=?',[temporary]))throw Error('PROBE_ROLLBACK_FAILED');});
 let scheduled=false,original:number|null=null,touched=false;
 const guard=()=>withTransaction(w.storage,tx=>assertRecoveryContext(tx,w,ctx,fence));
 const unchanged=()=>withTransaction(w.storage,tx=>{try{return sameFence(readAdmissionFence(tx),fence);}catch{return false;}});
 const open=withTransaction(w.storage,tx=>maintenanceRow(tx)?.state==='open');
 try{
  guard();original=await w.storage.getAlarm();guard();
  if(open){const schedule=await w.repairSchedule();guard();const alarm=await w.storage.getAlarm();guard();scheduled=!schedule.dirty&&(schedule.nextDueAt===null?alarm===null:alarm!==null&&alarm>=schedule.nextDueAt);}
  else {const future=w.clock.nowMs()+60000;guard();touched=true;await w.storage.setAlarm(future);guard();scheduled=(await w.storage.getAlarm())===future;guard();}
 }catch(error){if(!unchanged())throw error;scheduled=false;}
 finally{
  if(touched){
   if(unchanged()){if(original===null)await w.storage.deleteAlarm();else await w.storage.setAlarm(original);}
   // A late physical set/restore can cross resume even when publication is rejected.
   // Reconcile under current authority without writing frozen scheduler SQL.
   if(!unchanged()){
    const current=withTransaction(w.storage,tx=>({fence:readAdmissionFence(tx),open:admissionOpen(tx)}));
    if(current.open)await w.repairSchedule();
    else {await w.storage.deleteAlarm();if(withTransaction(w.storage,tx=>!sameFence(readAdmissionFence(tx),current.fence)))await w.repairSchedule();}
   }
  }
 }
 const receipt:ProbeReceipt={id,workspace_id:w.workspaceId,config_epoch:ctx.expectedEpoch,schema_version:RECOVERY_SCHEMA_VERSION,checked_at:new Date(w.clock.nowMs()).toISOString(),checks:[{name:'sql_write_read',passed:read,code:read?'OK':'WRITE_READ_FAILED'},{name:'rollback',passed:rollback,code:rollback?'OK':'ROLLBACK_FAILED'},{name:'schema',passed:true,code:'OK'},{name:'scheduler',passed:scheduled,code:scheduled?'OK':'SCHEDULER_FAILED'}]};
 return withTransaction(w.storage,tx=>{assertRecoveryContext(tx,w,ctx,fence);const prior=priorOperation(tx,ctx);if(prior){if(!validateProbeReceipt(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return prior;}const digest=tx.one<{installation_digest:string}>('SELECT installation_digest FROM workspace_metadata WHERE id=1')!.installation_digest;const stored:StoredProbe={format_version:1,maintenance_generation:fence.maintenanceGeneration,installation_digest:digest,receipt};tx.exec('INSERT INTO probe_receipts (id,workspace_id,authority_epoch,request_id,checked_at,receipt_json) VALUES (?,?,?,?,?,?)',[id,w.workspaceId,ctx.expectedEpoch,ctx.requestId,w.clock.nowMs(),canonicalJson(stored)]);storeOperation(tx,ctx,receipt,w.clock.nowMs());return receipt;});
}
