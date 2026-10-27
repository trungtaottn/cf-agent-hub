import {expireDueRuns,nextRunDue} from '../tasks/failure';
import type {AuthWorkspace} from '../auth/context';
import type {WorkspaceTransaction} from '../storage/transaction';
import {withTransaction} from '../storage/transaction';
import {admissionOpen,assertAdmissionOpen,readAdmissionFence,sameFence,type AdmissionFence} from '../recovery/maintenance';
import {markSchedulerDirty} from './scheduler-state';
import {claimDue,finishAttempt,nextOutboxDue} from './repository';
import {DeliveryDispatcher} from './dispatcher';
export interface ScheduleReceipt{armed:boolean;nextDueAt:number|null;generation:number;dirty:boolean;}
export interface AlarmPort{setAlarm(time:number):Promise<void>;deleteAlarm():Promise<void>;}
function nextDue(tx:WorkspaceTransaction):number|null{
 const outbox=nextOutboxDue(tx),lease=nextRunDue(tx);
 return outbox===null?lease:lease===null?outbox:Math.min(outbox,lease);
}
export class OutboxScheduler{
 private readonly alarms:AlarmPort;
 constructor(readonly workspace:AuthWorkspace,private readonly dispatcher:DeliveryDispatcher,alarms?:AlarmPort){this.alarms=alarms??workspace.storage;}
 async repairSchedule():Promise<ScheduleReceipt>{return this.#repairSchedule(true);}
 async #repairSchedule(reconcile:boolean,retry=true):Promise<ScheduleReceipt>{
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
  if(stale){
   if(reconcile)await this.#reconcileCurrentAlarm();
   else return this.#armConservativeWake(captured.fence,false);
  }
  if(!stale&&success&&receipt.dirty){
   // A late stale write may have overwritten an earlier alarm. One exact retry,
   // then a persisted near-term wake bounds repair work even under continuous writes.
   if(retry)return this.#repairSchedule(reconcile,false);
   return this.#armConservativeWake(captured.fence,reconcile);
  }
  return receipt;
 }
 /** A final stale fence still permits a harmless physical wake, never frozen SQL mutation. */
 async #armConservativeWake(fence:AdmissionFence,reconcile:boolean):Promise<ScheduleReceipt>{
  let armed=false;try{await this.alarms.setAlarm(this.workspace.clock.nowMs()+1);armed=true;}catch{/* SQL stays dirty; existing request/catalog repair retries. */}
  let stale=false;
  const receipt=withTransaction(this.workspace.storage,tx=>{
   const state=tx.one<{generation:number;dirty:number;next_due_at:number|null}>('SELECT generation,dirty,next_due_at FROM scheduler_state WHERE id=1');
   if(!admissionOpen(tx,fence)){stale=true;return {armed:false,nextDueAt:state?.next_due_at??null,generation:state?.generation??0,dirty:state?.dirty===1};}
   const due=nextDue(tx);
   tx.exec("UPDATE scheduler_state SET dirty=1,next_due_at=?,last_error_code=CASE WHEN ?=0 THEN 'ALARM_ARM_FAILED' ELSE last_error_code END WHERE id=1",[due,Number(armed)]);
   return {armed,nextDueAt:due,generation:state!.generation,dirty:true};
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
  let fence:AdmissionFence|null=null,failed=false;
  try{
   fence=withTransaction(this.workspace.storage,tx=>{
    if(!admissionOpen(tx))return null;const current=assertAdmissionOpen(tx);
    tx.exec('INSERT INTO scheduler_state (id,last_run_at,dirty,generation) VALUES (1,?,1,1) ON CONFLICT(id) DO UPDATE SET last_run_at=excluded.last_run_at',[nowMs]);return current;
   });
   if(!fence)return;
   // Independent budgets: a bad lease never prevents already-due notification work.
   let attempts:ReturnType<typeof claimDue>=[];
   try{attempts=withTransaction(this.workspace.storage,tx=>{assertAdmissionOpen(tx,fence!);return claimDue(tx,nowMs,25);});}catch{failed=true;}
   await this.repairSchedule();
   for(let unit=0;unit<25;unit++){
    try{
     const processed=withTransaction(this.workspace.storage,tx=>{
      if(!admissionOpen(tx,fence!))return 0;
      return expireDueRuns(tx,this.workspace.clock.nowMs(),1).processed;
     });
     if(processed===0)break;
    }catch{failed=true;break;}
   }
   if(!withTransaction(this.workspace.storage,tx=>admissionOpen(tx,fence!)))return;
   const completed=await Promise.allSettled(attempts.map(async attempt=>{
    const result=await this.dispatcher.dispatchAttempt(attempt);
    withTransaction(this.workspace.storage,tx=>finishAttempt(tx,attempt.deliveryId,attempt.attemptId,result,this.workspace.clock.nowMs(),attempt.admissionFence));
   }));
   failed ||= completed.some(result=>result.status==='rejected');
   withTransaction(this.workspace.storage,tx=>{
    if(!admissionOpen(tx,fence!))return;
    if(failed){markSchedulerDirty(tx);tx.exec("UPDATE scheduler_state SET last_error_code='DUE_WORK_FAILED' WHERE id=1");}
    else tx.exec("UPDATE scheduler_state SET last_error_code=NULL WHERE last_error_code='DUE_WORK_FAILED'");
   });
  }catch{
   try{withTransaction(this.workspace.storage,tx=>{if(!fence||!admissionOpen(tx,fence))return;markSchedulerDirty(tx);tx.exec("UPDATE scheduler_state SET last_error_code='DUE_WORK_FAILED' WHERE id=1");});}catch{/* Existing authorized catalog sweep remains fallback. */}
  }finally{
   // A pre-barrier completion must not restart scheduling after same-epoch resume.
   if(fence&&withTransaction(this.workspace.storage,tx=>admissionOpen(tx,fence!)))try{await this.repairSchedule();}catch{/* Ordinary request/catalog repair retries authoritative SQL. */}
  }
 }
}
/** Only trusted operator catalog entries reach this bounded internal binding lane. */
export async function sweepCatalog(catalog:readonly {workspace_id:string;object_name:string}[],namespace:{getByName(name:string):{repairSchedule():Promise<ScheduleReceipt>}}):Promise<void>{
 for(let start=0;start<catalog.length;start+=25)await Promise.all(catalog.slice(start,start+25).map(async mapping=>{try{await namespace.getByName(mapping.object_name).repairSchedule();}catch{/* Isolate one workspace's operational failure. */}}));
}
