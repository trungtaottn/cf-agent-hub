import {it,expect} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {messageFixture,messageInput,commandContext,owned} from '../helpers/messages';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
import {migrate} from '../../src/storage/migrations';
import {inspectRegistry} from '../../src/recovery/table-registry';
import {withTransaction,type SqlValue} from '../../src/storage/transaction';
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
const thirteen=[m1,m2,m3,m4,m5,m6,m7,m8,m9,m10,m11,m12,m13].map((sql,i)=>({version:i+1,sql}));
function evidence(s:DurableObjectStorage){return {data:data(s),versions:s.sql.exec('SELECT * FROM schema_migrations ORDER BY version').toArray(),schema:s.sql.exec('SELECT type,name,sql FROM sqlite_schema ORDER BY name').toArray()};}
function data(s:DurableObjectStorage){return Object.fromEntries(s.sql.exec<{name:string}>("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations' ORDER BY rowid").toArray().map(({name})=>[name,s.sql.exec<Record<string,SqlValue>>('SELECT * FROM '+name).toArray()]));}
async function old13(name:string){const f=await messageFixture(name);await runInDurableObject(f.stub,async(_o,s)=>{const body=messageInput();executeCommand(await commandContext(s.storage,f.name,body,'retained'),f.identity,messageCommand(owned(s.storage,f.name)),body);const rows=data(s.storage);await s.storage.deleteAll();migrate(s.storage,thirteen);s.storage.transactionSync(()=>{for(const [table,items] of Object.entries(rows))for(const row of items)s.storage.sql.exec(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`,...Object.values(row));});});return f;}
it('genuine13 to14 preserves all application rows and exact historical migrations across eviction',async()=>{const f=await old13('message_index_upgrade');const after=await runInDurableObject(f.stub,(_o,s)=>{const before=data(s.storage),history=s.storage.sql.exec('SELECT * FROM schema_migrations ORDER BY version').toArray();migrate(s.storage);expect(withTransaction(s.storage,inspectRegistry).schemaVersion).toBe(15);expect(data(s.storage)).toEqual(before);expect(s.storage.sql.exec('SELECT * FROM schema_migrations WHERE version<=13 ORDER BY version').toArray()).toEqual(history);expect(s.storage.sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);expect(s.storage.sql.exec("SELECT name FROM sqlite_schema WHERE type='index' AND name='credentials_live_read'").toArray()).toHaveLength(1);migrate(s.storage);return evidence(s.storage);});await evictDurableObject(f.stub);await runInDurableObject(f.stub,(_o,s)=>expect(evidence(s.storage)).toEqual(after));});
it('migration14 insertion fault rolls back index and schema evidence without touching data',async()=>{const f=await old13('message_index_rollback');await runInDurableObject(f.stub,(_o,s)=>{s.storage.sql.exec("CREATE TRIGGER index_fault BEFORE INSERT ON schema_migrations WHEN NEW.version=14 BEGIN SELECT RAISE(ABORT,'index_fault'); END");const before=data(s.storage),versions=s.storage.sql.exec('SELECT * FROM schema_migrations ORDER BY version').toArray(),schema=s.storage.sql.exec('SELECT * FROM sqlite_schema ORDER BY name').toArray();expect(()=>migrate(s.storage)).toThrow('index_fault');expect(data(s.storage)).toEqual(before);expect(s.storage.sql.exec('SELECT * FROM schema_migrations ORDER BY version').toArray()).toEqual(versions);expect(s.storage.sql.exec('SELECT * FROM sqlite_schema ORDER BY name').toArray()).toEqual(schema);s.storage.sql.exec('DROP TRIGGER index_fault');migrate(s.storage);expect(withTransaction(s.storage,inspectRegistry).schemaVersion).toBe(15);});});
it('compiled schema14 current credentials seek is index-backed without ordering sort',async()=>{const f=await messageFixture('message_index_plan');await runInDurableObject(f.stub,(_o,s)=>{const plan=JSON.stringify(s.storage.sql.exec("EXPLAIN QUERY PLAN SELECT * FROM native_credentials WHERE workspace_id='ws_example' AND agent_id='agent_research' AND config_epoch=1 AND enabled=1 AND retired_at_epoch IS NULL AND revoked_at IS NULL AND expires_at>100 ORDER BY expires_at,credential_id LIMIT 1001").toArray());expect(plan).toContain('credentials_live_read');expect(plan).not.toContain('TEMP B-TREE');});});

it('closed13 maintenance refuses upgrade without changing index rows or version',async()=>{const f=await old13('message_index_closed');await runInDurableObject(f.stub,(_o,s)=>{s.storage.sql.exec("UPDATE workspace_metadata SET admission_state='maintenance'");s.storage.sql.exec("UPDATE maintenance_state SET state='capturing',barrier_id='closed',capture_id='pending',generation=1");const before=evidence(s.storage);expect(()=>migrate(s.storage)).toThrow('FROZEN_SCHEMA_MIGRATION');expect(evidence(s.storage)).toEqual(before);});});
