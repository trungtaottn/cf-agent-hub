// Historical schema7 SQLite recovery regression, not schema8 operational acceptance.
import {it,expect} from 'vitest';
import {withTransaction} from '../../src/storage/transaction';
import {recoveryFixture,captureFixture,restoreFixture,withRecoveryWorkspace,recoveryContext,fixtureIntegrity} from '../helpers/recovery-fixture';
import {resolveDelivery,retireWorkspace,resumeWorkspace} from '../../src/recovery/controls';
import {readRecoveryStatus} from '../../src/recovery/capture';
import {canonicalBytes} from '../../src/recovery/encoding';
import {signRecord} from '../../src/recovery/manifest';
import type {CutoverRecord} from '../../src/recovery/protocol';

it('completes and resolves a permitted large uncertain backlog within the control byte limit',async()=>{
 const total=2000,f=await recoveryFixture('large_unresolved');
 await withRecoveryWorkspace(f,'source',w=>withTransaction(w.storage,tx=>{
  tx.exec("UPDATE outbox SET status='in_flight',lease_token='lease_fixture',lease_expires_at=?",[Date.now()+3600000]);
  for(let i=1;i<total;i++){
   const id='delivery_'+i.toString(16).padStart(32,'0');
   tx.exec("INSERT INTO outbox (id,workspace_id,message_id,destination_id,notification_id,payload_json,status,attempts,next_due_at,retry_multiplier,lease_token,lease_expires_at,last_status,last_error,created_at,updated_at,destination_snapshot_json) SELECT ?,workspace_id,message_id,destination_id,?,json_set(payload_json,'$.delivery_id',?),status,attempts,next_due_at,retry_multiplier,lease_token,lease_expires_at,last_status,last_error,created_at,updated_at,destination_snapshot_json FROM outbox WHERE id='delivery_fixture'",[id,id,id]);
  }
 }));
 const capture=await captureFixture(f),restored=await restoreFixture(f,capture);
 for(const result of [capture.progress,restored]){
  expect(result.receipt!.unresolved_effect_count).toBe(total);expect(result.receipt!.unresolved_effect_ids).toHaveLength(64);expect(result.receipt!.unresolved_effect_ids_complete).toBe(false);
  expect(canonicalBytes(result).length).toBeLessThan(65280);
 }
 const proof=await withRecoveryWorkspace(f,'source',async w=>retireWorkspace(w,await recoveryContext(w,'retire',{},f.captureId)));
 const cutover=await signRecord<CutoverRecord>({id:'cutover_large',capture_id:f.captureId,workspace_id:'ws_example',source_environment_id:'fixture_source',source_authority_epoch:1,target_environment_id:'fixture_target',target_authority_epoch:2,source_retirement_receipt_id:proof.id,target_catalog_mapping:{workspace_id:'ws_example',object_name:f.targetName},cutover_at:new Date().toISOString(),auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 await withRecoveryWorkspace(f,'target',async w=>{
  const last='delivery_'+(total-1).toString(16).padStart(32,'0');expect(restored.receipt!.unresolved_effect_ids).not.toContain(last);
  const input={delivery_id:last,disposition:'failed_without_redrive' as const,evidence_sha256:'e'.repeat(64)},ctx=await recoveryContext(w,'resolve-delivery',input,f.captureId,{anchor:f.anchor,operationId:'resolve_beyond_prefix'});
  const result=await resolveDelivery(w,ctx,input);expect(result.unresolved_effect_count).toBe(total-1);expect(result.unresolved_effect_ids).toHaveLength(64);expect(result.unresolved_effect_ids_complete).toBe(false);expect(canonicalBytes(result).length).toBeLessThan(65280);
  expect(await resolveDelivery(w,await recoveryContext(w,'resolve-delivery',input,f.captureId,{anchor:f.anchor,operationId:'resolve_beyond_prefix'}),input)).toEqual(result);
  expect(withTransaction(w.storage,tx=>tx.one<{status:string;attempts:number}>('SELECT status,attempts FROM outbox WHERE id=?',[last]))).toEqual({status:'cancelled',attempts:1});
  expect(withTransaction(w.storage,tx=>tx.one<{n:number}>("SELECT COUNT(*) AS n FROM outbox WHERE status IN ('pending','in_flight')")!.n)).toBe(total-1);
  const status=readRecoveryStatus(w,await recoveryContext(w,'status',{job_id:restored.job_id},f.captureId,{anchor:f.anchor}),restored.job_id);expect(status.receipt).toEqual(restored.receipt);
  const resume={receipt_id:restored.receipt!.id,ledger:f.ledger,source_retirement_receipt:proof,cutover_record:cutover};await expect(resumeWorkspace(w,await recoveryContext(w,'resume',resume,f.captureId,{anchor:f.anchor}),resume)).rejects.toThrow('RECOVERY_UNRESOLVED_EFFECTS');
 });
},90000);

import {validateRecoveryReceipt,validateRecoveryJobProgress} from '../../src/recovery/generated/recovery-validators.js';
it('closed shared validators reject inconsistent counts, non-exhaustive empty lists, duplicates and ordering',()=>{
 const small={id:'receipt_fixture',capture_id:'capture_fixture',workspace_id:'ws_example',status:'complete',checks:[{name:'capture',passed:true,code:'OK'}],unresolved_effect_ids:[],unresolved_effect_count:0,unresolved_effect_ids_complete:true,started_at:'2026-10-25T00:00:00.000Z',ended_at:'2026-10-25T00:00:01.000Z'};
 const ids=Array.from({length:64},(_,i)=>'delivery_'+i.toString(16).padStart(32,'0'));
 const large={...small,unresolved_effect_ids:ids,unresolved_effect_count:2000,unresolved_effect_ids_complete:false};
 expect(validateRecoveryReceipt(small)).toBe(true);expect(validateRecoveryReceipt(large)).toBe(true);
 const missing={...large} as Record<string,unknown>;delete missing.unresolved_effect_count;
 const invalid=[{...small,unresolved_effect_ids_complete:false},{...small,unresolved_effect_count:1,unresolved_effect_ids_complete:false},{...large,unresolved_effect_count:63},{...large,unresolved_effect_ids_complete:true},{...large,unresolved_effect_ids:[...ids, 'delivery_ffff']},{...large,unresolved_effect_ids:[ids[0],...ids.slice(0,63)]},{...large,unresolved_effect_ids:[...ids].reverse()},missing];
 for(const receipt of invalid){
  expect(validateRecoveryReceipt(receipt)).toBe(false);
  expect(validateRecoveryJobProgress({job_id:'job_fixture',capture_id:'capture_fixture',workspace_id:'ws_example',operation:'restore',authority_epoch:2,state:'complete',phase:'complete',step:1,counts:{rows:0,chunks:0,bytes:0},pending_operation_id:null,next_operation:null,next_chunk_index:null,receipt,manifest:null})).toBe(false);
 }
});
