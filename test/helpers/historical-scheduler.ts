/** Test-only historical scheduler snapshot; not production schema8 coverage.
 * Source: src/outbox/scheduler.ts at 3ea0fbf9a2d541919b611ac1e299b069e0bbb2c2
 * Git blob: 51393b8dfe3c5de0e48ed14c5a2084f4b716ff93
 * Adaptations only: relative import paths, explicit schema7 maintenance adapter,
 * and exported class name. The scheduler algorithm is the predecessor source.
 */
import type {AuthWorkspace} from '../../src/auth/context';
import type {WorkspaceTransaction} from '../../src/storage/transaction';
import {withTransaction} from '../../src/storage/transaction';
import {admissionOpen,assertAdmissionOpen,readAdmissionFence,sameFence,type AdmissionFence} from '../../src/recovery/maintenance-v1';
import {markSchedulerDirty} from '../../src/outbox/scheduler-state';
import {claimDue,finishAttempt} from '../../src/outbox/repository';
import {DeliveryDispatcher} from '../../src/outbox/dispatcher';
export interface ScheduleReceipt{armed:boolean;nextDueAt:number|null;generation:number;dirty:boolean;}
export interface AlarmPort{setAlarm(time:number):Promise<void>;deleteAlarm():Promise<void>;}
function nextDue(tx:WorkspaceTransaction):number|null{
 return tx.one<{due:number|null}>(`SELECT MIN(CASE WHEN status='in_flight' THEN lease_expires_at ELSE next_due_at END) AS due FROM outbox WHERE status IN ('pending','in_flight')`)?.due??null;
}
export class HistoricalOutboxScheduler{
 private readonly alarms:AlarmPort;
 constructor(readonly workspace:AuthWorkspace,private readonly dispatcher:DeliveryDispatcher,alarms?:AlarmPort){this.alarms=alarms??workspace.storage;}
 async repairSchedule():Promise<ScheduleReceipt>{return this.#repairSchedule(true);}
 async #repairSchedule(reconcile:boolean):Promise<ScheduleReceipt>{
  const {workspace}=this;
  const captured=withTransaction(workspace.storage,tx=>{
   if(!admissionOpen(tx)){const state=tx.one<{generation:number;dirty:number;next_due_at:number|null}>('SELECT generation,dirty,next_due_at FROM scheduler_state WHERE id=1');return {fence:null,generation:state?.generation??0,due:state?.next_due_at??null,dirty:state?.dirty===1};}
   const fence=assertAdmissionOpen(tx);
   tx.exec('INSERT OR IGNORE INTO scheduler_state (id,dirty,generation) VALUES (1,0,0)');
   const generation=tx.one<{generation:number}>('SELECT generation FROM scheduler_state WHERE id=1')!.generation;
   return {fence,generation,due:nextDue(tx),dirty:true};
  });
  if(!captured.fence)return {armed:false,nextDueAt:captured.due,generation:captured.generation,dirty:captured.dirty};
  let success=false;
  try{if(captured.due===null)await this.alarms.deleteAlarm();else await this.alarms.setAlarm(Math.max(captured.due,workspace.clock.nowMs()+1));success=true;}catch{/* Durable acceptance survives alarm failures. */}
  let stale=false;
  const receipt=withTransaction(workspace.storage,tx=>{
   if(!admissionOpen(tx,captured.fence!)){stale=true;const state=tx.one<{generation:number;dirty:number}>('SELECT generation,dirty FROM scheduler_state WHERE id=1');return {armed:false,nextDueAt:captured.due,generation:state?.generation??0,dirty:state?.dirty===1};}
   const current=tx.one<{generation:number}>('SELECT generation FROM scheduler_state WHERE id=1')!.generation;
   if(!success)tx.exec("UPDATE scheduler_state SET dirty=1,last_error_code='ALARM_ARM_FAILED' WHERE id=1");
   else if(current===captured.generation)tx.exec("UPDATE scheduler_state SET dirty=0,next_due_at=?,armed_at=?,last_error_code=CASE WHEN last_error_code='ALARM_ARM_FAILED' THEN NULL ELSE last_error_code END WHERE id=1",[captured.due,captured.due===null?null:workspace.clock.nowMs()]);
   else tx.exec('UPDATE scheduler_state SET dirty=1 WHERE id=1');
   return {armed:success,nextDueAt:captured.due,generation:current,dirty:!success||current!==captured.generation};
  });
  if(stale&&reconcile)await this.#reconcileCurrentAlarm();
  return receipt;
 }
 async #reconcileCurrentAlarm():Promise<void>{
  const current=withTransaction(this.workspace.storage,tx=>({fence:readAdmissionFence(tx),open:admissionOpen(tx)}));
  if(current.open){await this.#repairSchedule(false);return;}
  // The stale alarm effect has completed. Cancel its wakeup without changing frozen SQL.
  try{await this.alarms.deleteAlarm();}catch{return;}
  const changed=withTransaction(this.workspace.storage,tx=>!sameFence(readAdmissionFence(tx),current.fence));
  if(changed)await this.#repairSchedule(false);
 }
 async runDueWork(nowMs:number):Promise<void>{
  let fence:AdmissionFence|null=null;
  try{
   const attempts=withTransaction(this.workspace.storage,tx=>{
    if(!admissionOpen(tx))return null;fence=assertAdmissionOpen(tx);
    const claimed=claimDue(tx,nowMs,25);
    tx.exec('INSERT INTO scheduler_state (id,last_run_at,dirty,generation) VALUES (1,?,1,1) ON CONFLICT(id) DO UPDATE SET last_run_at=excluded.last_run_at',[nowMs]);
    return claimed;
   });
   if(attempts===null)return;
   await this.repairSchedule();
   const completed=await Promise.allSettled(attempts.map(async attempt=>{
    const result=await this.dispatcher.dispatchAttempt(attempt);
    withTransaction(this.workspace.storage,tx=>finishAttempt(tx,attempt.attemptId,result,this.workspace.clock.nowMs(),attempt.admissionFence));
   }));
   if(completed.some(result=>result.status==='rejected'))throw Error('DUE_WORK_FAILED');
   withTransaction(this.workspace.storage,tx=>{if(fence&&admissionOpen(tx,fence))tx.exec("UPDATE scheduler_state SET last_error_code=NULL WHERE last_error_code='DUE_WORK_FAILED'");});
  }catch{
   try{withTransaction(this.workspace.storage,tx=>{if(!fence||!admissionOpen(tx,fence))return;markSchedulerDirty(tx);tx.exec("UPDATE scheduler_state SET last_error_code='DUE_WORK_FAILED' WHERE id=1");});}catch{/* The catalog sweep remains the fallback. */}
  }finally{
   // A pre-barrier completion must not restart scheduling after same-epoch resume.
   if(fence&&withTransaction(this.workspace.storage,tx=>admissionOpen(tx,fence!)))try{await this.repairSchedule();}catch{/* Sweep/startup repair retries authoritative SQL. */}
  }
 }
}
/** Only trusted operator catalog entries reach this bounded internal binding lane. */
export async function sweepCatalog(catalog:readonly {workspace_id:string;object_name:string}[],namespace:{getByName(name:string):{repairSchedule():Promise<ScheduleReceipt>}}):Promise<void>{
 for(let start=0;start<catalog.length;start+=25)await Promise.all(catalog.slice(start,start+25).map(async mapping=>{try{await namespace.getByName(mapping.object_name).repairSchedule();}catch{/* Isolate one workspace's operational failure. */}}));
}
