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
import {it,expect} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {CURRENT_SCHEMA_VERSION} from '../../src/storage/schema-version';
import {decodeCurrentChunk,encodeCurrentChunk,CHUNK_LIMIT} from '../../src/recovery/encoding';
import {validateManifestShape} from '../../src/recovery/manifest';
import {currentRestoreFixture,captureCurrentFixture,restoreCurrentFixture,withCurrentRecoveryWorkspace} from './current-restore-fixture';

it('schema19 preserves pending preparation on restart but invalidates a pre-consume snapshot on restore',async()=>{
 expect(CURRENT_SCHEMA_VERSION).toBe(19);
 const f=await currentRestoreFixture('restore_creation_admission',{seed:false,artifacts:false});
 const id='event_'+'a'.repeat(48),now=Date.now();
 await runInDurableObject(f.source,async(_instance,{storage})=>{
  storage.sql.exec('INSERT INTO creation_admissions (id,workspace_id,principal_id,operation,target,key_hash,fingerprint,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)',id,'ws_example','human_admin','tasks:create','workspace:ws_example','b'.repeat(64),'c'.repeat(64),now,now+86400000);
  storage.sql.exec("INSERT INTO events (id,workspace_id,type,actor_json,resource_type,resource_id,request_id,occurred_at,summary,creation_binding) VALUES ('event_evidence','ws_example','task.created','{}','task','task_old','request_old',?,'Synthetic historical evidence',?)",now,'d'.repeat(64));
 });
 await evictDurableObject(f.source);
 await runInDurableObject(f.source,async(_instance,{storage})=>{expect(storage.sql.exec('SELECT id FROM creation_admissions').one().id).toBe(id);});
 const capture=await captureCurrentFixture(f);
 expect(capture.manifest.checkpoint.schema_version).toBe(19);
 expect(capture.manifest.database.table_counts).toHaveProperty('creation_admissions',1);
 expect(capture.chunks.some(c=>decodeCurrentChunk(new Uint8Array(c.bytes)).table==='creation_admissions')).toBe(true);
 const chunks=capture.chunks.map(c=>decodeCurrentChunk(new Uint8Array(c.bytes)));
 const pending=chunks.find(c=>c.table==='creation_admissions')!;
 expect(()=>encodeCurrentChunk({...pending,rows:Array.from({length:201},()=>pending.rows[0])})).toThrow('INVALID_RECOVERY_CHUNK');
 const events=chunks.find(c=>c.table==='events')!,oversized=structuredClone(events);
 oversized.rows[0][oversized.columns.indexOf('creation_binding')]='x'.repeat(CHUNK_LIMIT);
 expect(()=>encodeCurrentChunk(oversized)).toThrow('RECOVERY_CHUNK_LIMIT');
 const excessive=structuredClone(capture.manifest);
 (excessive.database.table_counts as Record<string,number>).creation_admissions=1000000;
 expect(()=>validateManifestShape(excessive)).toThrow('RECOVERY_ROW_BUDGET_LIMIT');
 const omitted=structuredClone(capture.manifest);
 delete (omitted.database.table_counts as Partial<Record<string,number>>).creation_admissions;
 expect(()=>validateManifestShape(omitted)).toThrow('INVALID_RECOVERY_MANIFEST');

 // Model the original authority having consumed this identity after the snapshot.
 await runInDurableObject(f.source,async(_instance,{storage})=>{storage.sql.exec('DELETE FROM creation_admissions WHERE id=?',id);});
 await restoreCurrentFixture(f,capture,{evict:true});
 await withCurrentRecoveryWorkspace(f,'target',w=>{
  expect(w.storage.sql.exec('SELECT id FROM creation_admissions').toArray()).toEqual([]);
  expect(w.storage.sql.exec("SELECT creation_binding FROM events WHERE id='event_evidence'").one().creation_binding).toBe('d'.repeat(64));
 });
},90000);

it('migrates a physical16 database without changing existing events or legacy evidence',async()=>{
 const {migrate}=await import('../../src/storage/migrations');
 const {inspectRegistry}=await import('../../src/recovery/table-registry');
 const {withTransaction}=await import('../../src/storage/transaction');
 const f=await currentRestoreFixture('migration_creation_admission',{seed:false});
 await runInDurableObject(f.source,async(_instance,{storage})=>{
  // Fresh disposable historical schema; never leave current19 with dropped product tables.
  const events=storage.sql.exec<Record<string,string|number|null>>('SELECT * FROM events ORDER BY sequence').toArray().map(({creation_binding,...row})=>row);
  await storage.deleteAll();migrate(storage,historical);
  for(const row of events){const columns=Object.keys(row);storage.sql.exec('INSERT INTO events ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')',...columns.map(k=>row[k]));}
  expect(withTransaction(storage,tx=>inspectRegistry(tx,16)).schemaVersion).toBe(16);
  const before=storage.sql.exec('SELECT * FROM events ORDER BY sequence').toArray();
  migrate(storage);
  expect(withTransaction(storage,tx=>inspectRegistry(tx)).schemaVersion).toBe(19);
  const after=storage.sql.exec('SELECT * FROM events ORDER BY sequence').toArray();
  expect(after.map(({creation_binding,...event})=>{expect(creation_binding).toBeNull();return event;})).toEqual(before);
  expect(storage.sql.exec('SELECT * FROM creation_admissions').toArray()).toEqual([]);
 });
});

it('decodes16 columns exactly and rejects treating16 event bytes as17',async()=>{
 const {SCHEMA16_TABLE_REGISTRY,tableDefinition}=await import('../../src/recovery/table-registry');
 const {encodeCurrentChunk}=await import('../../src/recovery/encoding');
 const f=await currentRestoreFixture('legacy_event_columns',{seed:false});
 await runInDurableObject(f.source,async(_instance,{storage})=>{
  const columns=SCHEMA16_TABLE_REGISTRY.find(t=>t.name==='events')!.columns.map(c=>c.name);
  const event=storage.sql.exec<Record<string,string|number|null>>('SELECT * FROM events ORDER BY sequence LIMIT 1').one();
  const old={format_version:2 as const,schema_version:16 as const,capture_id:'capture_legacy',index:0,table:'events' as const,columns,rows:[columns.map(c=>event[c])]};
  const bytes=(encodeCurrentChunk(old));expect(decodeCurrentChunk(bytes)).toEqual(old);
  expect(()=>encodeCurrentChunk({...old,schema_version:17})).toThrow('RECOVERY_COLUMN_MISMATCH');
  expect(tableDefinition('events',17).columns.at(-1)?.name).toBe('creation_binding');
  expect(()=>encodeCurrentChunk({...old,columns:[...columns,'creation_binding'],rows:[[...old.rows[0],null]]})).toThrow('RECOVERY_COLUMN_MISMATCH');
 });
});
