import {describe,it,expect} from 'vitest';
import {withTransaction} from '../../src/storage/transaction';
import {restoredFixture,recoveryFixture,captureFixture,restoreFixture,withRecoveryWorkspace,recoveryContext,fixtureIntegrity} from '../helpers/recovery-fixture';
import {decodeChunk,canonicalBytes,digestBytes} from '../../src/recovery/encoding';
import {verifyManifest,signRecord} from '../../src/recovery/manifest';
import {readRecoveryStatus} from '../../src/recovery/capture';
import {beginRestore,writeRestoreChunk} from '../../src/recovery/restore';
import {recordProbe,readStoredProbe} from '../../src/recovery/probes';
import {resolveDelivery,retireWorkspace,resumeWorkspace} from '../../src/recovery/controls';
import {currentConfiguration} from '../../src/auth/context';
import type {CutoverRecord} from '../../src/recovery/protocol';
describe('R1 bounded actual Workers recovery',()=>{
 it('captures typed chunks, restores revoked authority, retains history, and stays paused across eviction',async()=>{
  const {fixture:f,capture,restored}=await restoredFixture('flow_history',{evict:true});
  const joined=new Uint8Array(capture.chunks.reduce((sum,c)=>sum+c.bytes.byteLength,0));let at=0;for(const c of capture.chunks){joined.set(new Uint8Array(c.bytes),at);at+=c.bytes.byteLength;}expect(await digestBytes(joined)).toBe(capture.manifest.database.sha256);
  expect(capture.manifest.checkpoint.event_sequence).toBe(500);expect(capture.manifest.database.chunks.every(c=>c.row_count<=200&&c.byte_size<=1048576)).toBe(true);
  for(const c of capture.chunks)expect(decodeChunk(new Uint8Array(c.bytes)).columns.length).toBeGreaterThan(0);
  expect(await verifyManifest(capture.manifest,fixtureIntegrity)).toEqual(capture.manifest);
  await withRecoveryWorkspace(f,'target',w=>withTransaction(w.storage,tx=>{
   expect(tx.one<{admission_state:string;config_epoch:number}>('SELECT admission_state,config_epoch FROM workspace_metadata')).toEqual({admission_state:'maintenance',config_epoch:2});
   expect(tx.one<{enabled:number;config_epoch:number}>('SELECT enabled,config_epoch FROM native_credentials')).toEqual({enabled:0,config_epoch:2});
   expect(tx.one<{revoked_at:number|null}>('SELECT revoked_at FROM sessions')!.revoked_at).not.toBeNull();
   expect(tx.one<{consumed_at:number|null;pkce_verifier:string;nonce:string}>('SELECT consumed_at,pkce_verifier,nonce FROM login_attempts')).toMatchObject({pkce_verifier:'',nonce:''});
   expect(tx.one<{seq:number}>("SELECT seq FROM sqlite_sequence WHERE name='events'")!.seq).toBe(500);
   expect(tx.one<{record_id:string}>('SELECT record_id FROM preferences')!.record_id).toBe('pref_'+'1'.repeat(32));
   expect(tx.one<{body:string}>('SELECT body FROM messages')!.body).toBe('Retained message body');
   expect(tx.one<{attempts:number;last_status:number;last_error:string;status:string}>('SELECT attempts,last_status,last_error,status FROM outbox')).toEqual({attempts:1,last_status:503,last_error:'network',status:'pending'});
   expect(tx.one<{n:number}>("SELECT count(*) AS n FROM idempotency_outcomes WHERE operation='operator.install'")!.n).toBe(0);
   expect(tx.one<{outcome_json:string}>("SELECT outcome_json FROM idempotency_outcomes WHERE operation='domain.messages:send' AND key='domain_fixture'")!.outcome_json).toBe('{"id":"message_fixture"}');
  }));
  expect(restored.receipt!.unresolved_effect_ids).toContain('delivery_fixture');
 },60000);
 it('reconciles a lost restore-init only through new authorized target-epoch status and rejects stale replay',async()=>{
  const f=await recoveryFixture('flow_lost_init',{seed:false}),capture=await captureFixture(f);
  await withRecoveryWorkspace(f,'target',async w=>{
   const ctx=await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'restore_initial'});
   const first=await beginRestore(w,ctx,capture.manifest,f.ledger);
   await expect(beginRestore(w,ctx,capture.manifest,f.ledger)).rejects.toThrow('RECOVERY_EPOCH_CONFLICT');
   const status=readRecoveryStatus(w,await recoveryContext(w,'status',{job_id:first.job_id},f.captureId,{anchor:f.anchor,operationId:'status_current',expectedEpoch:2}),first.job_id);
   expect(status.job_id).toBe(first.job_id);expect(status.phase).toBe('awaiting_chunks');
  });
 },60000);
 it('rejects chunk tampering and non-current ledger anchors without admitting target work',async()=>{
  const f=await recoveryFixture('flow_tamper',{seed:false}),capture=await captureFixture(f);
  await withRecoveryWorkspace(f,'target',async w=>{
   const bad=await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:{...f.anchor,sha256:'0'.repeat(64)}});
   await expect(beginRestore(w,bad,capture.manifest,f.ledger)).rejects.toThrow('RECOVERY_LEDGER_ANCHOR_CONFLICT');
   expect(withTransaction(w.storage,tx=>tx.one('SELECT id FROM workspace_metadata'))).toBeNull();
   await beginRestore(w,await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor}),capture.manifest,f.ledger);
   const first=capture.chunks[0],bytes=new Uint8Array(first.bytes).slice();bytes[bytes.length-1]^=1;const meta={index:0,sha256:first.metadata.sha256,byte_size:first.metadata.byte_size};
   await expect(writeRestoreChunk(w,await recoveryContext(w,'write-chunk',meta,f.captureId,{anchor:f.anchor}),meta,bytes)).rejects.toThrow('RECOVERY_CHUNK_MISMATCH');
   expect(withTransaction(w.storage,tx=>tx.one<{n:number}>('SELECT count(*) AS n FROM recovery_chunks')!.n)).toBe(0);
  });
 },60000);
 it('requires resolution, actual probe, permanent source retirement and matching cutover before resume',async()=>{
  const {fixture:f,capture,restored}=await restoredFixture('flow_exclusive');
  const proof=await withRecoveryWorkspace(f,'source',async w=>retireWorkspace(w,await recoveryContext(w,'retire',{},f.captureId)));
  const cutover=await signRecord<CutoverRecord>({id:'cutover_fixture',capture_id:f.captureId,workspace_id:'ws_example',source_environment_id:'fixture_source',source_authority_epoch:1,target_environment_id:'fixture_target',target_authority_epoch:2,source_retirement_receipt_id:proof.id,target_catalog_mapping:{workspace_id:'ws_example',object_name:f.targetName},cutover_at:new Date().toISOString(),auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
  await withRecoveryWorkspace(f,'target',async w=>{
   const input={receipt_id:restored.receipt!.id,ledger:f.ledger,source_retirement_receipt:proof,cutover_record:cutover};
   await expect(resumeWorkspace(w,await recoveryContext(w,'resume',input,f.captureId,{anchor:f.anchor}),input)).rejects.toThrow('RECOVERY_UNRESOLVED_EFFECTS');
   const disposition={delivery_id:'delivery_fixture',disposition:'failed_without_redrive' as const,evidence_sha256:'e'.repeat(64)};
   await resolveDelivery(w,await recoveryContext(w,'resolve-delivery',disposition,f.captureId,{anchor:f.anchor}),disposition);
   await expect(resumeWorkspace(w,await recoveryContext(w,'resume',input,f.captureId,{anchor:f.anchor}),input)).rejects.toThrow('RECOVERY_PROBE_REQUIRED');
   const probe=await recordProbe(w,await recoveryContext(w,'probe',{},null,{anchor:f.anchor}));expect(probe.checks.every(x=>x.passed)).toBe(true);expect(withTransaction(w.storage,tx=>readStoredProbe(tx,'ws_example'))!.receipt.id).toBe(probe.id);
   const receipt=await resumeWorkspace(w,await recoveryContext(w,'resume',input,f.captureId,{anchor:f.anchor}),input);expect(receipt.probe_id).toBe(probe.id);expect(receipt.new_generation).toBe(receipt.old_generation+1);
   expect(withTransaction(w.storage,tx=>tx.one<{status:string;attempts:number}>('SELECT status,attempts FROM outbox'))).toEqual({status:'cancelled',attempts:1});
   expect(withTransaction(w.storage,tx=>tx.one<{acknowledged_at:number|null}>('SELECT acknowledged_at FROM inbox'))!.acknowledged_at).toBeNull();
  });
  await withRecoveryWorkspace(f,'source',w=>expect(withTransaction(w.storage,tx=>tx.one<{state:string}>('SELECT state FROM maintenance_state'))!.state).toBe('retired'));
 },60000);
});
