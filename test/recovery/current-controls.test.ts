import {describe,it,expect} from 'vitest';
import {evictDurableObject} from 'cloudflare:test';
import {currentRestoreFixture,captureCurrentFixture,restoreCurrentFixture,withCurrentRecoveryWorkspace} from './current-restore-fixture';
import {recoveryContext,fixtureIntegrity} from '../helpers/recovery-fixture';
import {signRecord} from '../../src/recovery/manifest';
import {canonicalBytes,digestBytes} from '../../src/recovery/encoding';
import {retireWorkspace,resumeWorkspace,resolveDelivery} from '../../src/recovery/controls';
import {recordProbe} from '../../src/recovery/probes';
import {messageInput,owned,commandContext} from '../helpers/messages';
import {claimIdentity} from '../helpers/claims';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
import type {CurrentLedger,CutoverRecord} from '../../src/recovery/protocol';
async function sourceFixture(name:string){
 const f=await currentRestoreFixture(name,{seed:false});const capture=await captureCurrentFixture(f);
 const ledger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_source',authority_epoch:1,config:f.sourceInput.config,verification_bundle:f.sourceInput.bundle,installation_digest:f.sourceInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 f.resolver.anchor={authorityEpoch:1,sha256:await digestBytes(canonicalBytes(ledger))};
 return {f,capture,ledger};
}
describe('current control admission and exact post-transition replay',()=>{
 it('retires a real current capture, replays after eviction, rejects rotated anchor and altered post-fence without changing capture evidence',async()=>{
  const {f}=await sourceFixture('control_retire');
  const before=await withCurrentRecoveryWorkspace(f,'source',w=>w.storage.sql.exec('SELECT * FROM recovery_jobs').toArray());
  const retire=()=>withCurrentRecoveryWorkspace(f,'source',async w=>retireWorkspace(w,await recoveryContext(w,'retire',{},f.captureId,{anchor:f.resolver.anchor,operationId:'retire_exact'})));
  const receipt=await retire();await evictDurableObject(f.source);expect(await retire()).toEqual(receipt);
  expect(await withCurrentRecoveryWorkspace(f,'source',w=>w.storage.sql.exec('SELECT * FROM recovery_jobs').toArray())).toEqual(before);
  f.resolver.generation++;await expect(retire()).rejects.toThrow();f.resolver.generation--;
  await withCurrentRecoveryWorkspace(f,'source',w=>w.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1'));
  await expect(retire()).rejects.toThrow('RECOVERY_CONTROL_ADMISSION_CONFLICT');
 },90000);
 it('probes and resumes captured authority, replays completed receipt without another alarm repair',async()=>{
  const {f,capture,ledger}=await sourceFixture('control_resume');
  const probe=await withCurrentRecoveryWorkspace(f,'source',async w=>recordProbe(w,await recoveryContext(w,'probe',{},null,{anchor:f.resolver.anchor,operationId:'probe_exact'})));
  expect(probe.schema_version).toBe(16);expect(probe.checks.every(c=>c.passed)).toBe(true);
  const body={receipt_id:capture.progress.receipt!.id,ledger,source_retirement_receipt:null,cutover_record:null};let repairs=0;
  const resume=()=>withCurrentRecoveryWorkspace(f,'source',async w=>{w.repairSchedule=async()=>{repairs++;return {armed:false,nextDueAt:null,generation:0,dirty:false};};return resumeWorkspace(w,await recoveryContext(w,'resume',body,f.captureId,{anchor:f.resolver.anchor,operationId:'resume_exact'}),body);});
  const receipt=await resume();expect(repairs).toBe(1);await evictDurableObject(f.source);expect(await resume()).toEqual(receipt);expect(repairs).toBe(1);
 },90000);
 it('denies malformed completed pairs and never creates an admission without a trusted binding',async()=>{
  const {f}=await sourceFixture('control_pair');
  await withCurrentRecoveryWorkspace(f,'source',async w=>{w.trustedAnchor=undefined;await expect(retireWorkspace(w,await recoveryContext(w,'retire',{},f.captureId,{anchor:f.resolver.anchor,operationId:'missing_binding'}))).rejects.toThrow();expect(w.storage.sql.exec("SELECT key FROM idempotency_outcomes WHERE operation LIKE 'operator.recovery.admission.%'").toArray()).toEqual([]);});
  await withCurrentRecoveryWorkspace(f,'source',async w=>{const ctx=await recoveryContext(w,'retire',{},f.captureId,{anchor:f.resolver.anchor,operationId:'corrupt_pair'});await retireWorkspace(w,ctx);w.storage.sql.exec("DELETE FROM idempotency_outcomes WHERE operation='operator.recovery.admission.retire'");await expect(retireWorkspace(w,ctx)).rejects.toThrow('RECOVERY_CONTROL_ADMISSION_CONFLICT');});
 },90000);
});

it('resumes a genuine restored target using source retirement and cutover, preserving completed replay after eviction',async()=>{
 const {f,capture}=await sourceFixture('control_target');
 const proof=await withCurrentRecoveryWorkspace(f,'source',async w=>retireWorkspace(w,await recoveryContext(w,'retire',{},f.captureId,{anchor:f.resolver.anchor,operationId:'retire_source'})));
 f.resolver.anchor={...f.anchor};
 const restored=await restoreCurrentFixture(f,capture);
 await withCurrentRecoveryWorkspace(f,'target',async w=>recordProbe(w,await recoveryContext(w,'probe',{},null,{anchor:f.anchor,operationId:'probe_target'})));
 const cutover=await signRecord<CutoverRecord>({id:'cutover_current',capture_id:f.captureId,workspace_id:'ws_example',source_environment_id:'current_source',source_authority_epoch:1,target_environment_id:'current_target',target_authority_epoch:2,source_retirement_receipt_id:proof.id,target_catalog_mapping:{workspace_id:'ws_example',object_name:f.targetName},cutover_at:new Date().toISOString(),auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 const body={receipt_id:restored.receipt!.id,ledger:f.ledger,source_retirement_receipt:proof,cutover_record:cutover};
 const resume=()=>withCurrentRecoveryWorkspace(f,'target',async w=>resumeWorkspace(w,await recoveryContext(w,'resume',body,f.captureId,{anchor:f.anchor,operationId:'resume_target'}),body));
 const result=await resume();await evictDurableObject(f.target);expect(await resume()).toEqual(result);
 f.resolver.generation++;await expect(resume()).rejects.toThrow();f.resolver.generation--;
 await withCurrentRecoveryWorkspace(f,'target',w=>w.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1'));await expect(resume()).rejects.toThrow('RECOVERY_CONTROL_ADMISSION_CONFLICT');
},90000);

it('resolves beyond the first 64 effects on a restored target with bounded replay receipts and preserved transport evidence',async()=>{
 const f=await currentRestoreFixture('control_backlog',{rich:true,artifacts:false});
 await withCurrentRecoveryWorkspace(f,'source',async w=>{
  // Rich history addresses agent_other, which has no notification destination.
  // Create a real notification for the configured recipient before copying its
  // immutable message/event/inbox-linked intent into a large synthetic backlog.
  const message=messageInput();
  await executeCommand(await commandContext(w.storage,f.sourceName,message,'control_backlog_message'),claimIdentity(w.storage),messageCommand(owned(w.storage,f.sourceName)),message);
  const row=w.storage.sql.exec<Record<string,string|number|null>>('SELECT * FROM outbox ORDER BY id LIMIT 1').one(),columns=Object.keys(row);
  for(let i=0;i<66;i++){
   const id='delivery_control_'+String(i).padStart(3,'0'),payload=JSON.parse(String(row.payload_json));payload.delivery_id=id;
   const copy={...row,id,notification_id:id,payload_json:JSON.stringify(payload),status:'in_flight',attempts:3,lease_token:'lease_control',lease_expires_at:Date.now()+3600000};
   w.storage.sql.exec('INSERT INTO outbox ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')',...columns.map(k=>copy[k as keyof typeof copy]));
  }
 });
 const capture=await captureCurrentFixture(f),restored=await restoreCurrentFixture(f,capture);expect(restored.receipt!.unresolved_effect_count).toBeGreaterThan(64);
 const body={delivery_id:'delivery_control_065',disposition:'failed_without_redrive' as const,evidence_sha256:'e'.repeat(64)};
 const resolve=()=>withCurrentRecoveryWorkspace(f,'target',async w=>resolveDelivery(w,await recoveryContext(w,'resolve-delivery',body,f.captureId,{anchor:f.anchor,operationId:'resolve_beyond_prefix'}),body));
 const result=await resolve();expect(result.unresolved_effect_ids).toHaveLength(64);expect(result.unresolved_effect_ids_complete).toBe(false);expect(result.unresolved_effect_count).toBe(restored.receipt!.unresolved_effect_count-1);
 await evictDurableObject(f.target);expect(await resolve()).toEqual(result);
 await withCurrentRecoveryWorkspace(f,'target',w=>expect(w.storage.sql.exec("SELECT status,attempts,lease_token FROM outbox WHERE id='delivery_control_065'").one()).toEqual({status:'cancelled',attempts:3,lease_token:'lease_control'}));
 f.resolver.generation++;await expect(resolve()).rejects.toThrow();
},90000);

it('serializes competing source retire operations and preserves exactly one transition',async()=>{
 const {f}=await sourceFixture('control_race');
 await withCurrentRecoveryWorkspace(f,'source',async w=>{
  const a=await recoveryContext(w,'retire',{},f.captureId,{anchor:f.resolver.anchor,operationId:'retire_a'}),b=await recoveryContext(w,'retire',{},f.captureId,{anchor:f.resolver.anchor,operationId:'retire_b'});
  const before=w.storage.sql.exec<{generation:number}>('SELECT generation FROM maintenance_state').one().generation;
  const results=await Promise.allSettled([retireWorkspace(w,a),retireWorkspace(w,b)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(w.storage.sql.exec<{generation:number}>('SELECT generation FROM maintenance_state').one().generation).toBe(before+1);
  expect(w.storage.sql.exec("SELECT key FROM idempotency_outcomes WHERE operation='operator.recovery.retire'").toArray()).toHaveLength(1);
 });
},90000);
it('rejects resolver rotation during retirement before transition or receipt publication',async()=>{
 const {f}=await sourceFixture('control_rotation');
 await withCurrentRecoveryWorkspace(f,'source',async w=>{
  const base=w.trustedAnchor!.binding.fetch;let calls=0;w.trustedAnchor!.binding.fetch=async request=>{if(++calls===3)f.resolver.generation++;return base(request);};
  const ctx=await recoveryContext(w,'retire',{},f.captureId,{anchor:f.resolver.anchor,operationId:'rotating_retire'});
  await expect(retireWorkspace(w,ctx)).rejects.toThrow();
  expect(w.storage.sql.exec<{state:string}>('SELECT state FROM maintenance_state').one().state).toBe('captured');
  expect(w.storage.sql.exec("SELECT key FROM idempotency_outcomes WHERE operation='operator.recovery.retire'").toArray()).toEqual([]);
 });
},90000);
