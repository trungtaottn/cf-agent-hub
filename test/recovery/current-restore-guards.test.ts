import {describe,it,expect} from 'vitest';
import {evictDurableObject} from 'cloudflare:test';
import {beginRestore,writeRestoreChunk} from '../../src/recovery/restore';
import {restoreGuard,loadCurrentRestoreJob} from '../../src/recovery/restore-job';
import {withTransaction} from '../../src/storage/transaction';
import {recoveryContext} from '../helpers/recovery-fixture';
import {currentRestoreFixture,captureCurrentFixture,withCurrentRecoveryWorkspace} from './current-restore-fixture';

describe('current restore fresh resolver and exact admission retry',()=>{
 it('returns original epoch0 outcome after eviction only with exact original fingerprint and fresh installed digest',async()=>{
  const f=await currentRestoreFixture('current_restore_replay',{seed:false}),capture=await captureCurrentFixture(f);
  const initial=await withCurrentRecoveryWorkspace(f,'target',async w=>{const ctx=await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'exact_begin'});return {ctx,result:await beginRestore(w,ctx,capture.manifest,f.ledger)};});
  await evictDurableObject(f.target);
  await withCurrentRecoveryWorkspace(f,'target',async w=>{
   const retry=await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'exact_begin',expectedEpoch:0});
   expect(retry.requestFingerprint).toBe(initial.ctx.requestFingerprint);expect(retry.expectedInstallationDigest).not.toBeNull();
   expect(await beginRestore(w,retry,capture.manifest,f.ledger)).toEqual(initial.result);
   for(const changed of [{...retry,principalId:'different_operator'},{...retry,operationId:'different_operation'},{...retry,requestFingerprint:'f'.repeat(64)},{...retry,expectedInstallationDigest:null}])await expect(beginRestore(w,changed,capture.manifest,f.ledger)).rejects.toThrow();
   expect(w.storage.sql.exec('SELECT count(*) AS n FROM recovery_jobs').one().n).toBe(1);
  });
 },90000);
 it('does not adopt a later generation with unchanged digest on exact replay',async()=>{
  const f=await currentRestoreFixture('current_restore_rotate_replay',{seed:false}),capture=await captureCurrentFixture(f);
  await withCurrentRecoveryWorkspace(f,'target',async w=>{
   const first=await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'rotate_begin'});await beginRestore(w,first,capture.manifest,f.ledger);
   f.resolver.generation++;const retry=await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'rotate_begin',expectedEpoch:0});
   await expect(beginRestore(w,retry,capture.manifest,f.ledger)).rejects.toThrow('RECOVERY_ANCHOR_MISMATCH');
  });
 },90000);
 it('retains pending when a dispatched chunk PUT lands after resolver rotation',async()=>{
  const f=await currentRestoreFixture('current_restore_pending_rotation',{seed:false}),capture=await captureCurrentFixture(f);
  await withCurrentRecoveryWorkspace(f,'target',async w=>{
   await beginRestore(w,await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'pending_begin'}),capture.manifest,f.ledger);
   const bucket=w.bucket;w.bucket=new Proxy(bucket,{get(target,key){if(key==='put')return async(...args:Parameters<R2Bucket['put']>)=>{const result=await target.put(...args);f.resolver.generation++;return result;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
   const source=capture.chunks[0],metadata={index:source.metadata.index,sha256:source.metadata.sha256,byte_size:source.metadata.byte_size};
   const ctx=await recoveryContext(w,'write-chunk',metadata,f.captureId,{anchor:f.anchor,operationId:'rotating_write'});
   await expect(writeRestoreChunk(w,ctx,metadata,new Uint8Array(source.bytes))).rejects.toThrow('RECOVERY_ANCHOR_MISMATCH');
   const row=w.storage.sql.exec<{details_json:string}>('SELECT details_json FROM recovery_jobs').one(),details=JSON.parse(row.details_json);
   expect(details.pending.operationId).toBe('rotating_write');expect(details.counts.chunks).toBe(0);expect(w.storage.sql.exec('SELECT count(*) AS n FROM recovery_chunks').one().n).toBe(0);
   expect(w.storage.sql.exec("SELECT count(*) AS n FROM idempotency_outcomes WHERE operation='operator.recovery.write-chunk'").one().n).toBe(0);
  });
 },90000);
 it('fresh guard rejects installation/fence and missing binding after job admission',async()=>{
  const f=await currentRestoreFixture('current_restore_local_guard',{seed:false}),capture=await captureCurrentFixture(f);
  await withCurrentRecoveryWorkspace(f,'target',async w=>{
   const initial=await beginRestore(w,await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor}),capture.manifest,f.ledger);
   const ctx=await recoveryContext(w,'status',{job_id:initial.job_id},f.captureId,{anchor:f.anchor}),job=withTransaction(w.storage,tx=>loadCurrentRestoreJob(tx,initial.job_id)!);
   const guard=restoreGuard(w,ctx,job);await guard();w.storage.sql.exec("UPDATE maintenance_state SET generation=generation+1 WHERE id=1");await expect(guard()).rejects.toThrow();
  });
 },90000);
});
