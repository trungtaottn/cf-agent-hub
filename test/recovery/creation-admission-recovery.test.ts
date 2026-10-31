import {it,expect} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {CURRENT_SCHEMA_VERSION} from '../../src/storage/schema-version';
import {decodeCurrentChunk,encodeCurrentChunk,CHUNK_LIMIT} from '../../src/recovery/encoding';
import {validateManifestShape} from '../../src/recovery/manifest';
import {currentRestoreFixture,captureCurrentFixture,restoreCurrentFixture,withCurrentRecoveryWorkspace} from './current-restore-fixture';

it('schema17 preserves pending preparation on restart but invalidates a pre-consume snapshot on restore',async()=>{
 expect(CURRENT_SCHEMA_VERSION).toBe(17);
 const f=await currentRestoreFixture('restore_creation_admission',{seed:false,artifacts:false});
 const id='event_'+'a'.repeat(48),now=Date.now();
 await runInDurableObject(f.source,async(_instance,{storage})=>{
  storage.sql.exec('INSERT INTO creation_admissions (id,workspace_id,principal_id,operation,target,key_hash,fingerprint,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)',id,'ws_example','human_admin','tasks:create','workspace:ws_example','b'.repeat(64),'c'.repeat(64),now,now+86400000);
  storage.sql.exec("INSERT INTO events (id,workspace_id,type,actor_json,resource_type,resource_id,request_id,occurred_at,summary,creation_binding) VALUES ('event_evidence','ws_example','task.created','{}','task','task_old','request_old',?,'Synthetic historical evidence',?)",now,'d'.repeat(64));
 });
 await evictDurableObject(f.source);
 await runInDurableObject(f.source,async(_instance,{storage})=>{expect(storage.sql.exec('SELECT id FROM creation_admissions').one().id).toBe(id);});
 const capture=await captureCurrentFixture(f);
 expect(capture.manifest.checkpoint.schema_version).toBe(17);
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
  // Recreate the exact reviewed pre17 layout, with no historical receipt mutation.
  storage.sql.exec('DROP TABLE creation_admissions');storage.sql.exec('ALTER TABLE events DROP COLUMN creation_binding');storage.sql.exec('DELETE FROM schema_migrations WHERE version=17');
  expect(withTransaction(storage,tx=>inspectRegistry(tx,16)).schemaVersion).toBe(16);
  const before=storage.sql.exec('SELECT * FROM events ORDER BY sequence').toArray();
  migrate(storage);
  expect(withTransaction(storage,tx=>inspectRegistry(tx)).schemaVersion).toBe(17);
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
