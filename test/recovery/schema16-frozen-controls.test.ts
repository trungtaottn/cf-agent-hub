import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import frozen from '../fixtures/genuine-schema16-snapshot-bundle.json';
import {migrate} from '../../src/storage/migrations';
import {SCHEMA16_TABLE_REGISTRY} from '../../src/recovery/table-registry';
import {currentRestoreFixture,withCurrentRecoveryWorkspace} from './current-restore-fixture';
import {artifactBucket} from '../helpers/artifacts';
import {recordProbe} from '../../src/recovery/probes';
import {resumeWorkspace,retireWorkspace} from '../../src/recovery/controls';
import {recoveryContext,fixtureIntegrity} from '../helpers/recovery-fixture';
import {signRecord} from '../../src/recovery/manifest';
import {canonicalBytes,digestBytes} from '../../src/recovery/encoding';
import type {CurrentLedger} from '../../src/recovery/protocol';
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
async function install(){
 await runInDurableObject(env.WORKSPACE.getByName('genuine16_oldbinary_source'),async(_instance,{storage})=>{await storage.deleteAll();migrate(storage);});
 const f=await currentRestoreFixture('genuine16_oldbinary',{seed:false});
 await runInDurableObject(f.source,async(_instance,{storage})=>{
  await storage.deleteAll();migrate(storage,historical);
  storage.transactionSync(()=>{
   storage.sql.exec('PRAGMA defer_foreign_keys=ON');storage.sql.exec('DELETE FROM schema_migrations');
   for(const table of SCHEMA16_TABLE_REGISTRY)for(const row of frozen.snapshot.tables[table.name] as Record<string,string|number|null>[]){const keys=Object.keys(row);storage.sql.exec('INSERT INTO "'+table.name+'" ('+keys.map(k=>'"'+k+'"').join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')',...keys.map(k=>row[k]));}
   storage.sql.exec('DELETE FROM sqlite_sequence');for(const row of frozen.snapshot.sequence)storage.sql.exec('INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)',row.name,row.seq);
  });
 });
 f.sourceInput=frozen.fixture.sourceInput as unknown as typeof f.sourceInput;
 for(const object of frozen.snapshot.objects)await env.RECOVERY_BUCKET.put(object.key,new Uint8Array(object.bytes));
 for(const artifact of frozen.capture.artifacts)await artifactBucket().put(artifact.entry.object_key,new Uint8Array(artifact.bytes));
 const ledger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_source',authority_epoch:1,config:f.sourceInput.config,verification_bundle:f.sourceInput.bundle,installation_digest:f.sourceInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 f.resolver.anchor={authorityEpoch:1,sha256:await digestBytes(canonicalBytes(ledger))};
 await evictDurableObject(f.source);return {f,ledger};
}
it('retains frozen16 captured authority, probes16 and atomically migrates authorized resume to17',async()=>{
 const {f,ledger}=await install();
 const probe=await withCurrentRecoveryWorkspace(f,'source',async w=>recordProbe(w,await recoveryContext(w,'probe',{},null,{anchor:f.resolver.anchor,operationId:'probe16'})));
 expect(probe.schema_version).toBe(16);
 const body={receipt_id:frozen.capture.progress.receipt!.id,ledger,source_retirement_receipt:null,cutover_record:null};
 const resume=()=>withCurrentRecoveryWorkspace(f,'source',async w=>resumeWorkspace(w,await recoveryContext(w,'resume',body,f.captureId,{anchor:f.resolver.anchor,operationId:'resume16'}),body));
 await withCurrentRecoveryWorkspace(f,'source',w=>w.storage.sql.exec("CREATE TRIGGER reject_resume_migration BEFORE INSERT ON schema_migrations WHEN NEW.version=17 BEGIN SELECT RAISE(ABORT,'synthetic_resume_migration_fault'); END"));
 await expect(resume()).rejects.toThrow('synthetic_resume_migration_fault');
 await withCurrentRecoveryWorkspace(f,'source',w=>{
  expect(w.storage.sql.exec('SELECT MAX(version) AS v FROM schema_migrations').one().v).toBe(16);
  expect(w.storage.sql.exec('SELECT state FROM maintenance_state').one().state).toBe('captured');
  expect(w.storage.sql.exec("SELECT name FROM sqlite_schema WHERE name='creation_admissions'").toArray()).toEqual([]);
  expect(w.storage.sql.exec("SELECT key FROM idempotency_outcomes WHERE operation='operator.recovery.resume'").toArray()).toEqual([]);
  w.storage.sql.exec('DROP TRIGGER reject_resume_migration');
 });
 const receipt=await resume();
 await evictDurableObject(f.source);expect(await resume()).toEqual(receipt);
 await withCurrentRecoveryWorkspace(f,'source',w=>{expect(w.storage.sql.exec('SELECT MAX(version) AS v FROM schema_migrations').one().v).toBe(17);expect(w.storage.sql.exec('SELECT state FROM maintenance_state').one().state).toBe('open');expect(w.storage.sql.exec('SELECT * FROM creation_admissions').toArray()).toEqual([]);});
},90000);
it('retires a frozen16 source without migration and replays exact retirement after restart',async()=>{
 const {f}=await install();
 const retire=()=>withCurrentRecoveryWorkspace(f,'source',async w=>retireWorkspace(w,await recoveryContext(w,'retire',{},f.captureId,{anchor:f.resolver.anchor,operationId:'retire16'})));
 const receipt=await retire();await evictDurableObject(f.source);expect(await retire()).toEqual(receipt);
 await withCurrentRecoveryWorkspace(f,'source',w=>{expect(w.storage.sql.exec('SELECT MAX(version) AS v FROM schema_migrations').one().v).toBe(16);expect(w.storage.sql.exec('SELECT state FROM maintenance_state').one().state).toBe('retired');});
},90000);
it('retains16 data but refuses control execution under changed declared build identity',async()=>{
 const {f}=await install();
 for(const field of ['revision','worker_version'] as const)await withCurrentRecoveryWorkspace(f,'source',async w=>{
  const before=w.storage.sql.exec('SELECT * FROM idempotency_outcomes ORDER BY principal_id,operation,target,key').toArray();
  w.release={...w.release,[field]:'different_declared_build'};
  await expect(recordProbe(w,await recoveryContext(w,'probe',{},null,{anchor:f.resolver.anchor,operationId:'changed_'+field}))).rejects.toThrow('RECOVERY_SOURCE_IDENTITY_MISMATCH');
  expect(w.storage.sql.exec('SELECT * FROM idempotency_outcomes ORDER BY principal_id,operation,target,key').toArray()).toEqual(before);
  expect(w.storage.sql.exec('SELECT MAX(version) AS v FROM schema_migrations').one().v).toBe(16);
 });
},90000);
