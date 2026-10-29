import frozenStorage from '../../validation/r2-storage-contract.json';
import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {migrate} from '../../src/storage/migrations';
import {assertCurrentSchema,assertSchemaVersion,CURRENT_SCHEMA_VERSION} from '../../src/storage/schema-version';
import {inspectRegistry,TABLE_REGISTRY} from '../../src/recovery/table-registry';
import {withTransaction} from '../../src/storage/transaction';
import m1 from '../../src/storage/migrations/0001-foundation.sql';
import m2 from '../../src/storage/migrations/0002-session-auth-epoch.sql';
import m3 from '../../src/storage/migrations/0003-preference-owner.sql';
import m4 from '../../src/storage/migrations/0004-message-admission.sql';
import m5 from '../../src/storage/migrations/0005-cursor-retention.sql';
import m6 from '../../src/storage/migrations/0006-outbox-scheduler-diagnostics.sql';
import m7 from '../../src/storage/migrations/0007-maintenance-generation.sql';
import m8 from '../../src/storage/migrations/0008-durable-work.sql';
import m9 from '../../src/storage/migrations/0009-catalog-reference-indexes.sql';
const v8=[m1,m2,m3,m4,m5,m6,m7,m8].map((sql,i)=>({version:i+1,sql}));
const v9=[...v8,{version:9,sql:m9}];
const target=(name:string)=>env.WORKSPACE.getByName('catalog_indexes_'+name);
const schema=(s:DurableObjectStorage)=>s.sql.exec('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').toArray();
const rows=(s:DurableObjectStorage)=>Object.fromEntries(frozenStorage.tables.filter(t=>t.name!=='schema_migrations').map(t=>[t.name,s.sql.exec('SELECT * FROM '+t.name).toArray()]));
function seedTask(s:DurableObjectStorage,id:string,project='project_source',role='role_source'){
 s.sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,project_id,work_role_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES(?,'ws_example','Retained 日本語','Exact metadata','backlog',3,0,?,?,1,2,'[]',1,2)",id,project,role);
}
async function old8(name:string){const stub=target(name);await runInDurableObject(stub,async(_o,state)=>{await state.storage.deleteAll();migrate(state.storage,v8);});return stub;}
it('catalog_schema9_upgrade_preserves_all_existing_domain_bytes_and_registers_only_indexes',async()=>{
 const stub=await old8('preservation');await runInDurableObject(stub,(_o,state)=>{
  seedTask(state.storage,'task_retained');
  state.storage.sql.exec("INSERT INTO catalog_plans VALUES('plan_retained','ws_example','human_synthetic',1,900001,'{ \"retained\": true }','[ ]','previewed',1)");
  state.storage.sql.exec("INSERT INTO idempotency_outcomes VALUES('human_synthetic','domain.profile:edit','catalog:preview','key','ws_example','fingerprint',200,'{ \"retained\": true }','request',NULL,1,86400001)");
  const before=rows(state.storage),oldSchema=schema(state.storage),versions=state.storage.sql.exec('SELECT * FROM schema_migrations ORDER BY version').toArray();
  expect(()=>withTransaction(state.storage,assertCurrentSchema)).toThrow('UNSUPPORTED_SCHEMA');
  migrate(state.storage,v9);
  expect(CURRENT_SCHEMA_VERSION).toBe(16);expect(rows(state.storage)).toEqual(before);
  const afterSchema=schema(state.storage);expect(afterSchema.filter(x=>!['tasks_catalog_project','tasks_catalog_role'].includes(String(x.name)))).toEqual(oldSchema);
  expect(afterSchema.filter(x=>['tasks_catalog_project','tasks_catalog_role'].includes(String(x.name)))).toHaveLength(2);
  expect(state.storage.sql.exec('SELECT * FROM schema_migrations WHERE version<=8 ORDER BY version').toArray()).toEqual(versions);
  expect(()=>withTransaction(state.storage,tx=>assertSchemaVersion(tx,9))).not.toThrow();
  expect(()=>withTransaction(state.storage,assertCurrentSchema)).toThrow('UNSUPPORTED_SCHEMA');
  expect(()=>withTransaction(state.storage,tx=>assertSchemaVersion(tx,7))).toThrow('UNSUPPORTED_SCHEMA');
  expect(state.storage.sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
 });
});
it.each(['capturing','captured','restoring','restored','retired'])('catalog_schema9_upgrade_preserves_frozen_%s_guard',async status=>{
 const stub=await old8('frozen_'+status);await runInDurableObject(stub,(_o,state)=>{
  state.storage.sql.exec('INSERT INTO maintenance_state(id,state,authority_epoch,updated_at,generation) VALUES(1,?,0,1,4)',status);
  const before={schema:schema(state.storage),rows:rows(state.storage),versions:state.storage.sql.exec('SELECT * FROM schema_migrations').toArray()};
  expect(()=>migrate(state.storage,v9)).toThrow('FROZEN_SCHEMA_MIGRATION');
  expect({schema:schema(state.storage),rows:rows(state.storage),versions:state.storage.sql.exec('SELECT * FROM schema_migrations').toArray()}).toEqual(before);
 });
});
it('catalog_schema9_index_creation_failure_rolls_back_ddl_and_version',async()=>{
 const stub=await old8('fault');await runInDurableObject(stub,(_o,state)=>{
  seedTask(state.storage,'task_retained');const before={schema:schema(state.storage),rows:rows(state.storage),versions:state.storage.sql.exec('SELECT * FROM schema_migrations').toArray()};
  expect(()=>migrate(state.storage,[...v8,{version:9,sql:'CREATE INDEX tasks_catalog_project ON tasks(workspace_id,project_id,id); INSERT INTO missing_catalog_fault VALUES(1);'}])).toThrow();
  expect({schema:schema(state.storage),rows:rows(state.storage),versions:state.storage.sql.exec('SELECT * FROM schema_migrations').toArray()}).toEqual(before);
  migrate(state.storage,v9);expect(()=>withTransaction(state.storage,tx=>assertSchemaVersion(tx,9))).not.toThrow();
 });
});
it('current_schema_restart_is_idempotent_and_gapped_sequence_rejects',async()=>{
 const stub=target('restart'),before=await runInDurableObject(stub,(_o,state)=>{seedTask(state.storage,'task_restart');migrate(state.storage);return {schema:schema(state.storage),rows:rows(state.storage),versions:state.storage.sql.exec('SELECT * FROM schema_migrations ORDER BY version').toArray()};});
 await evictDurableObject(stub);
 await runInDurableObject(stub,(_o,state)=>{
  expect({schema:schema(state.storage),rows:rows(state.storage),versions:state.storage.sql.exec('SELECT * FROM schema_migrations ORDER BY version').toArray()}).toEqual(before);
  expect(before.versions).toHaveLength(16);state.storage.sql.exec('DELETE FROM schema_migrations WHERE version=8');
  expect(()=>withTransaction(state.storage,assertCurrentSchema)).toThrow('UNSUPPORTED_SCHEMA');
  expect(()=>withTransaction(state.storage,inspectRegistry)).toThrow('RECOVERY_SCHEMA_MISMATCH');
 });
});
it('catalog_schema9_reference_queries_bound_rows_read_independent_of_unrelated_tasks',async()=>{
 await runInDurableObject(target('query_work'),(_o,state)=>{
  state.storage.transactionSync(()=>{for(let i=0;i<10000;i++)seedTask(state.storage,'unrelated_'+String(i).padStart(5,'0'),'unrelated','unrelated');for(let i=0;i<202;i++)seedTask(state.storage,'target_'+String(i).padStart(3,'0'));});
  for(const [column,index]of [['project_id','tasks_catalog_project'],['work_role_id','tasks_catalog_role']]){
   const sql=`SELECT id,task_version,project_id,work_role_id FROM tasks WHERE workspace_id=? AND ${column}=? ORDER BY id LIMIT 201`;
   const plan=state.storage.sql.exec<{detail:string}>('EXPLAIN QUERY PLAN '+sql,'ws_example',column==='project_id'?'project_source':'role_source').toArray();expect(plan.some(r=>r.detail.includes(index))).toBe(true);
   const cursor=state.storage.sql.exec(sql,'ws_example',column==='project_id'?'project_source':'role_source');expect(cursor.toArray()).toHaveLength(201);expect(cursor.rowsRead).toBeLessThanOrEqual(402);
   const absent=state.storage.sql.exec(sql,'ws_example','missing');expect(absent.toArray()).toEqual([]);expect(absent.rowsRead).toBeLessThanOrEqual(1);
  }
 });
});
it.each(['maintenance','retired'])('catalog_schema9_upgrade_preserves_%s_admission_guard',async admission=>{
 const stub=await old8('admission_'+admission);await runInDurableObject(stub,(_o,state)=>{
  state.storage.sql.exec("INSERT INTO workspace_metadata(id,workspace_id,object_name,config_epoch,config_digest,installation_digest,config_json,bundle_json,installed_at,admission_state) VALUES(1,'ws_example','synthetic',1,'digest','installation','{}','{}',1,?)",admission);
  const before={schema:schema(state.storage),rows:rows(state.storage)};
  expect(()=>migrate(state.storage,v9)).toThrow('FROZEN_SCHEMA_MIGRATION');expect({schema:schema(state.storage),rows:rows(state.storage)}).toEqual(before);
 });
});
it.each([9,16] as const)('schema%s keeps historical recovery closed or requires current capture authority before effects',async version=>{
 const {assertRecoveryContext}=await import('../../src/recovery/protocol');
 const {systemClock,systemEntropy}=await import('../../src/workspace/context');
 const selected=version===9?await old8('recovery_historical'):target('recovery_current');
 await runInDurableObject(selected,(_o,state)=>{
  if(version===9)migrate(state.storage,v9);expect(()=>withTransaction(state.storage,tx=>assertSchemaVersion(tx,version))).not.toThrow();
  let effects=0;
  const workspace:import('../../src/recovery/protocol').RecoveryWorkspace={storage:state.storage,bucket:new Proxy({}, {get(){effects++;throw Error('unexpected object effect');}}) as R2Bucket,workspaceId:'ws_example',objectName:'synthetic',environmentId:'synthetic',clock:systemClock,entropy:systemEntropy,integrity:{keyId:'synthetic',key:btoa('a'.repeat(32))},release:{revision:'synthetic',worker_version:'synthetic',binding_ids:[],catalog_mapping:{workspace_id:'ws_example',object_name:'synthetic'}},repairSchedule:async()=>{effects++;throw Error('unexpected schedule effect');}};
  const context:import('../../src/recovery/protocol').RecoveryContext={principalId:'synthetic_operator',workspaceId:'ws_example',objectName:'synthetic',environmentId:'synthetic',requestId:'synthetic_request',operationId:'synthetic_operation',operation:'capture',captureId:'synthetic_capture',expectedEpoch:1,expectedInstallationDigest:null,proofExpiresAt:Date.now()+120000,requestFingerprint:'a'.repeat(64),ledgerAnchor:null};
  const before=rows(state.storage);
  expect(()=>withTransaction(state.storage,tx=>assertRecoveryContext(tx,workspace,context))).toThrow(version===9?'RECOVERY_FORMAT_UNAVAILABLE':'RECOVERY_EPOCH_CONFLICT');
  expect(()=>withTransaction(state.storage,tx=>assertRecoveryContext(tx,workspace,{...context,operation:'restore'}))).toThrow(version===9?'RECOVERY_FORMAT_UNAVAILABLE':'RECOVERY_EPOCH_CONFLICT');
  expect(rows(state.storage)).toEqual(before);expect(effects).toBe(0);
 });
});
