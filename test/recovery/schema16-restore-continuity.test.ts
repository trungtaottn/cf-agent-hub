import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import frozen from '../fixtures/genuine-schema16-restore-lifecycle-bundle.json';
import {migrate} from '../../src/storage/migrations';
import {SCHEMA16_TABLE_REGISTRY} from '../../src/recovery/table-registry';
import {withCurrentRecoveryWorkspace,targetArtifactBucket,type CurrentRestoreFixture} from './current-restore-fixture';
import {artifactBucket} from '../helpers/artifacts';
import {recordProbe} from '../../src/recovery/probes';
import {resumeWorkspace,resolveDelivery} from '../../src/recovery/controls';
import {writeRestoreChunk,advanceVerify} from '../../src/recovery/restore';
import {recoveryContext,fixtureIntegrity} from '../helpers/recovery-fixture';
import {signRecord} from '../../src/recovery/manifest';
import type {RecoveryWorkspace,CurrentRecoveryManifest,RetirementReceipt,CutoverRecord,RecoveryJobProgress} from '../../src/recovery/protocol';
import m1 from '../../src/storage/migrations/0001-foundation.sql';
import m2 from '../../src/storage/migrations/0002-session-auth-epoch.sql';
import m3 from '../../src/storage/migrations/0003-preference-owner.sql';
import m4 from '../../src/storage/migrations/0004-message-admission.sql';
import m5 from '../../src/storage/migrations/0005-cursor-retention.sql';
import m6 from '../../src/storage/migrations/0006-outbox-scheduler-diagnostics.sql';
import m7 from '../../src/storage/migrations/0007-maintenance-generation.sql';
import m8 from '../../src/storage/migrations/0008-durable-work.sql';
import m9 from '../../src/storage/migrations/0009-catalog-reference-indexes.sql';
import m10 from '../../src/storage/migrations/0010-outbox-due-indexes.sql';
import m11 from '../../src/storage/migrations/0011-task-history-reason.sql';
import m12 from '../../src/storage/migrations/0012-artifact-admission.sql';
import m13 from '../../src/storage/migrations/0013-artifact-cleanup.sql';
import m14 from '../../src/storage/migrations/0014-message-credential-seek.sql';
import m15 from '../../src/storage/migrations/0015-search-order.sql';
import m16 from '../../src/storage/migrations/0016-task-auth-return.sql';
const historical=[m1,m2,m3,m4,m5,m6,m7,m8,m9,m10,m11,m12,m13,m14,m15,m16].map((sql,index)=>({version:index+1,sql}));
const manifest=frozen.capture.manifest as unknown as CurrentRecoveryManifest;
async function install(lane:'inflight'|'completed'){
 const snapshot=frozen[lane].snapshot;
 const f={...structuredClone(frozen.fixture),source:env.WORKSPACE.getByName(frozen.fixture.sourceName),target:env.WORKSPACE.getByName(frozen.fixture.targetName)} as unknown as CurrentRestoreFixture;
 await runInDurableObject(f.target,async(_instance,{storage})=>{
  await storage.deleteAll();migrate(storage,historical);
  storage.transactionSync(()=>{
   storage.sql.exec('PRAGMA defer_foreign_keys=ON');storage.sql.exec('DELETE FROM schema_migrations');
   for(const table of SCHEMA16_TABLE_REGISTRY)for(const row of snapshot.tables[table.name] as Record<string,string|number|null>[]){const keys=Object.keys(row);storage.sql.exec('INSERT INTO "'+table.name+'" ('+keys.map(k=>'"'+k+'"').join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')',...keys.map(k=>row[k]));}
   storage.sql.exec('DELETE FROM sqlite_sequence');for(const row of snapshot.sequence)storage.sql.exec('INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)',row.name,row.seq);
  });
 });
 for(const object of snapshot.objects)await env.RECOVERY_BUCKET.put(object.key,new Uint8Array(object.bytes));
 for(const object of snapshot.sourceArtifactObjects)await artifactBucket().put(object.key,new Uint8Array(object.bytes));
 for(const object of snapshot.targetArtifactObjects)await targetArtifactBucket().put(object.key,new Uint8Array(object.bytes));
 await evictDurableObject(f.target);
 const work=<T>(body:(w:RecoveryWorkspace)=>Promise<T>|T)=>withCurrentRecoveryWorkspace(f,'target',w=>{w.release=structuredClone(snapshot.release);return body(w);});
 return {f,work};
}
it('continues a genuine in-flight16 import under its exact boundary and completes on physical16 across restart',async()=>{
 const {f,work}=await install('inflight');
 await work(w=>{expect(w.storage.sql.exec('SELECT MAX(version) AS v FROM schema_migrations').one().v).toBe(16);expect(w.storage.sql.exec('SELECT state FROM maintenance_state').one().state).toBe('restoring');});
 let progress:RecoveryJobProgress=frozen.inflight.progress as RecoveryJobProgress;
 for(const c of frozen.capture.chunks.slice(frozen.inflight.nextChunkIndex)){
  const metadata={index:c.metadata.index,sha256:c.metadata.sha256,byte_size:c.metadata.byte_size};
  progress=await work(async w=>writeRestoreChunk(w,await recoveryContext(w,'write-chunk',metadata,f.captureId,{anchor:f.anchor,operationId:'continued_write_'+metadata.index}),metadata,new Uint8Array(c.bytes)));
  await evictDurableObject(f.target);
 }
 for(let step=0;step<500&&progress.state==='running';step++){
  progress=await work(async w=>advanceVerify(w,await recoveryContext(w,'verify',{manifest},f.captureId,{anchor:f.anchor,operationId:'continued_verify_'+step}),manifest));
  await evictDurableObject(f.target);
 }
 expect(progress.state).toBe('complete');
 await work(w=>{expect(w.storage.sql.exec('SELECT MAX(version) AS v FROM schema_migrations').one().v).toBe(16);expect(w.storage.sql.exec('SELECT state FROM maintenance_state').one().state).toBe('restored');expect(w.storage.sql.exec("SELECT name FROM sqlite_schema WHERE name='creation_admissions'").toArray()).toEqual([]);});
},90000);
it('keeps exact release fences on existing16 restore execution without altering retained job state',async()=>{
 const {f,work}=await install('inflight');
 for(const field of ['revision','worker_version'] as const)await work(async w=>{
  const before=w.storage.sql.exec('SELECT * FROM recovery_jobs').toArray();w.release={...w.release,[field]:'different_declared_build'};
  await expect(advanceVerify(w,await recoveryContext(w,'verify',{manifest},f.captureId,{anchor:f.anchor,operationId:'different_'+field}),manifest)).rejects.toThrow('RECOVERY_SOURCE_IDENTITY_MISMATCH');
  expect(w.storage.sql.exec('SELECT * FROM recovery_jobs').toArray()).toEqual(before);expect(w.storage.sql.exec('SELECT MAX(version) AS v FROM schema_migrations').one().v).toBe(16);
 });
},90000);
it('restarts genuine completed16 restore, resolves historical effects, probes16 and migrates authorized resume atomically to17',async()=>{
 const {f,work}=await install('completed');
 const ids=await work(w=>w.storage.sql.exec<{id:string}>("SELECT id FROM outbox WHERE status IN ('pending','in_flight')").toArray().map(r=>r.id));
 for(const id of ids){const body={delivery_id:id,disposition:'failed_without_redrive' as const,evidence_sha256:'a'.repeat(64)};await work(async w=>resolveDelivery(w,await recoveryContext(w,'resolve-delivery',body,f.captureId,{anchor:f.anchor,operationId:'resolve_'+id}),body));}
 const probe=await work(async w=>recordProbe(w,await recoveryContext(w,'probe',{},null,{anchor:f.anchor,operationId:'restored16_probe'})));expect(probe.schema_version).toBe(16);
 // Synthetic external authority records: no real source retirement or cutover is performed.
 const retirement=await signRecord<RetirementReceipt>({id:'retired_lifecycle',capture_id:f.captureId,workspace_id:'ws_example',environment_id:'current_source',authority_epoch:1,barrier_id:manifest.checkpoint.barrier_id,retired_at:new Date().toISOString(),auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 const cutover=await signRecord<CutoverRecord>({id:'cutover_lifecycle',capture_id:f.captureId,workspace_id:'ws_example',source_environment_id:'current_source',source_authority_epoch:1,target_environment_id:'current_target',target_authority_epoch:2,source_retirement_receipt_id:retirement.id,target_catalog_mapping:{workspace_id:'ws_example',object_name:f.targetName},cutover_at:new Date().toISOString(),auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 const body={receipt_id:frozen.completed.progress.receipt!.id,ledger:f.ledger,source_retirement_receipt:retirement,cutover_record:cutover};
 const resume=()=>work(async w=>resumeWorkspace(w,await recoveryContext(w,'resume',body,f.captureId,{anchor:f.anchor,operationId:'restored16_resume'}),body));
 const result=await resume();await evictDurableObject(f.target);expect(await resume()).toEqual(result);
 await work(w=>{expect(w.storage.sql.exec('SELECT MAX(version) AS v FROM schema_migrations').one().v).toBe(17);expect(w.storage.sql.exec('SELECT * FROM creation_admissions').toArray()).toEqual([]);expect(w.storage.sql.exec('SELECT state FROM maintenance_state').one().state).toBe('open');});
},90000);
