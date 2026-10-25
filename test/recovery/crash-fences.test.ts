import {describe,it,expect} from 'vitest';
import {evictDurableObject} from 'cloudflare:test';
import {recoveryFixture,captureFixture,withRecoveryWorkspace,recoveryContext} from '../helpers/recovery-fixture';
import {advanceCapture,readRecoveryStatus} from '../../src/recovery/capture';
import {jobIdFor} from '../../src/recovery/jobs';
import {withTransaction} from '../../src/storage/transaction';
import {transitionMaintenance} from '../../src/recovery/maintenance';
import {recordProbe} from '../../src/recovery/probes';

describe('recovery crash reservations and late physical effects',()=>{
 it('resumes the same durable step after R2 success followed by a lost completion',async()=>{
  const f=await recoveryFixture('crash_r2',{seed:false}),budget={max_rows:10000,max_artifacts:0 as const,max_total_bytes:16777216},operationId='capture_lost_r2',jobId=await jobIdFor('ws_example',f.captureId,'capture');
  await withRecoveryWorkspace(f,'source',async w=>{
   const bucket=new Proxy(w.bucket,{get(target,property){if(property==='put')return async(...args:Parameters<R2Bucket['put']>)=>{await target.put(...args);throw Error('synthetic_lost_R2_completion');};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
   await expect(advanceCapture({...w,bucket},await recoveryContext(w,'capture',{budget},f.captureId,{operationId}),budget)).rejects.toThrow('synthetic_lost_R2_completion');
   const status=readRecoveryStatus(w,await recoveryContext(w,'status',{job_id:jobId},f.captureId),jobId);
   expect(status.pending_operation_id).toBe(operationId);expect(status.counts.chunks).toBe(0);
   expect((await w.bucket.list({prefix:'r1/ws_example/'+jobId+'/'})).objects).toHaveLength(1);
  });
  await evictDurableObject(f.source);
  await withRecoveryWorkspace(f,'source',async w=>{
   const ctx=await recoveryContext(w,'capture',{budget},f.captureId,{operationId}),result=await advanceCapture(w,ctx,budget);
   expect(result.counts.chunks).toBe(1);expect(result.pending_operation_id).toBeNull();
   expect(await advanceCapture(w,await recoveryContext(w,'capture',{budget},f.captureId,{operationId}),budget)).toEqual(result);
   expect((await w.bucket.list({prefix:'r1/ws_example/'+jobId+'/'})).objects).toHaveLength(1);
   const changed={...budget,max_rows:9999};await expect(advanceCapture(w,await recoveryContext(w,'capture',{budget:changed},f.captureId,{operationId}),changed)).rejects.toThrow('RECOVERY_OPERATION_CONFLICT');
  });
  expect((await captureFixture(f)).progress.state).toBe('complete');
 },60000);
 it('reconciles a paused probe alarm that physically completes after same-epoch resume',async()=>{
  const f=await recoveryFixture('probe_late_alarm');await captureFixture(f);
  await withRecoveryWorkspace(f,'source',async w=>{
   let start!:()=>void,release!:()=>void,calls=0;const started=new Promise<void>(r=>start=r),gate=new Promise<void>(r=>release=r);
   const storage=new Proxy(w.storage,{get(target,property){if(property==='setAlarm')return async(time:number|Date)=>{if(++calls===1){start();await gate;}await target.setAlarm(time);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
   const pending=recordProbe({...w,storage},await recoveryContext(w,'probe',{},null)),denied=expect(pending).rejects.toThrow('STALE_ADMISSION_FENCE');await started;
   const due=withTransaction(w.storage,tx=>{transitionMaintenance(tx,{state:'open',epoch:1,barrierId:'probe_resume_barrier',captureId:f.captureId,nowMs:Date.now(),advance:true});return tx.one<{next_due_at:number}>('SELECT next_due_at FROM outbox')!.next_due_at;});
   await w.repairSchedule();expect(await w.storage.getAlarm()).toBe(due);
   release();await denied;
   expect(await w.storage.getAlarm()).toBe(due);
   expect(withTransaction(w.storage,tx=>tx.one<{n:number}>('SELECT count(*) AS n FROM probe_receipts')!.n)).toBe(0);
  });
 },60000);
});
