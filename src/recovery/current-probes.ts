import {withTransaction} from '../storage/transaction';
import {canonicalJson} from '../config/bootstrap';
import {admissionOpen,readAdmissionFence,sameFence} from './maintenance';
import {inspectRegistry} from './table-registry';
import type {RecoveryContext,RecoveryWorkspace,ProbeReceipt} from './protocol';
import {validateProbeReceipt} from './generated/recovery-validators.js';
import {digestBytes,canonicalBytes} from './encoding';
import type {StoredProbe} from './probes';
import {admitCurrentControl} from './current-control-admission';
export async function recordCurrentProbe(w:RecoveryWorkspace,ctx:RecoveryContext):Promise<ProbeReceipt> {
 ctx=structuredClone(ctx);
 if(ctx.operation!=='probe'||ctx.captureId!==null)throw Error('INVALID_RECOVERY_CONTEXT');
 const session=await admitCurrentControl(w,ctx);await session.guard();if(session.prior){if(!validateProbeReceipt(session.prior))throw Error('RECOVERY_OPERATION_CONFLICT');return session.prior;}
 const id='probe_'+(await digestBytes(canonicalBytes([w.workspaceId,ctx.principalId,ctx.operationId]))).slice(0,48);await session.guard();
 const temporary=id+'_rollback',sentinel={rollback:true};let read=false,rollback=false;
 try{withTransaction(w.storage,tx=>{session.assertPending(tx);inspectRegistry(tx,16);tx.exec('INSERT INTO probe_receipts (id,workspace_id,authority_epoch,request_id,checked_at,receipt_json) VALUES (?,?,?,?,?,?)',[temporary,w.workspaceId,ctx.expectedEpoch,ctx.requestId,w.clock.nowMs(),'{}']);read=tx.one<{id:string}>('SELECT id FROM probe_receipts WHERE id=?',[temporary])?.id===temporary;if(!read)throw Error('PROBE_READ_FAILED');throw sentinel;});}catch(error){if(error!==sentinel)throw error;rollback=true;}
 withTransaction(w.storage,tx=>{session.assertPending(tx);if(tx.one('SELECT id FROM probe_receipts WHERE id=?',[temporary]))throw Error('PROBE_ROLLBACK_FAILED');});
 let original:number|null=null,touched=false,scheduled=false;
 try{
  original=await w.storage.getAlarm();await session.guard();
  if(session.record.local.state==='open'){
   const schedule=await w.repairSchedule();await session.guard();const alarm=await w.storage.getAlarm();await session.guard();scheduled=!schedule.dirty&&(schedule.nextDueAt===null?alarm===null:alarm!==null&&alarm>=schedule.nextDueAt);
  }else{
   const future=w.clock.nowMs()+60000;touched=true;await w.storage.setAlarm(future);await session.guard();const actual=await w.storage.getAlarm();await session.guard();scheduled=actual===future;
  }
 }finally{
  if(touched){
   try{
    await session.guard();
    if(original===null)await w.storage.deleteAlarm();else await w.storage.setAlarm(original);
    await session.guard();
   }catch(error){
    // Late set OR restore can cross a transition. Reconcile current physical authority;
    // cleanup never grants permission to publish the stale probe's SQL outcome.
    const current=withTransaction(w.storage,tx=>({fence:readAdmissionFence(tx),open:admissionOpen(tx)}));
    if(current.open)await w.repairSchedule();
    else {await w.storage.deleteAlarm();if(withTransaction(w.storage,tx=>!sameFence(readAdmissionFence(tx),current.fence)))await w.repairSchedule();}
    throw error;
   }
  }
 }
 const receipt:ProbeReceipt={id,workspace_id:w.workspaceId,config_epoch:ctx.expectedEpoch,schema_version:16,checked_at:new Date(w.clock.nowMs()).toISOString(),checks:[{name:'sql_write_read',passed:read,code:read?'OK':'WRITE_READ_FAILED'},{name:'rollback',passed:rollback,code:rollback?'OK':'ROLLBACK_FAILED'},{name:'schema',passed:true,code:'OK'},{name:'scheduler',passed:scheduled,code:scheduled?'OK':'SCHEDULER_FAILED'}]};
 const digest=await digestBytes(canonicalBytes(receipt));await session.guard();
 return withTransaction(w.storage,tx=>{session.assertPending(tx);const stored:StoredProbe={format_version:1,maintenance_generation:session.record.local.generation,installation_digest:session.record.local.installationDigest,receipt};tx.exec('INSERT INTO probe_receipts (id,workspace_id,authority_epoch,request_id,checked_at,receipt_json) VALUES (?,?,?,?,?,?)',[id,w.workspaceId,ctx.expectedEpoch,ctx.requestId,w.clock.nowMs(),canonicalJson(stored)]);session.complete(tx,receipt,digest);return receipt;});
}
