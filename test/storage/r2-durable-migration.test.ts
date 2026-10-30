import {describe,it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {migrate} from '../../src/storage/migrations';
import {withTransaction} from '../../src/storage/transaction';
import {inspectRegistry,TABLE_REGISTRY} from '../../src/recovery/table-registry';
import manifest from '../../validation/r2-storage-contract.json';
import m1 from '../../src/storage/migrations/0001-foundation.sql';
import m2 from '../../src/storage/migrations/0002-session-auth-epoch.sql';
import m3 from '../../src/storage/migrations/0003-preference-owner.sql';
import m4 from '../../src/storage/migrations/0004-message-admission.sql';
import m5 from '../../src/storage/migrations/0005-cursor-retention.sql';
import m6 from '../../src/storage/migrations/0006-outbox-scheduler-diagnostics.sql';
import m8 from '../../src/storage/migrations/0008-durable-work.sql';
import m7 from '../../src/storage/migrations/0007-maintenance-generation.sql';
import {installConfiguration} from '../../src/config/bootstrap';
import {prepared,operator} from '../helpers/environment';
const v7=[m1,m2,m3,m4,m5,m6,m7].map((sql,i)=>({version:i+1,sql}));
const stub=(name:string)=>env.WORKSPACE.getByName('r2_migration_'+name);
async function oldDatabase(name:string){
 const target=stub(name);
 await runInDurableObject(target,async(_o,state)=>{await state.storage.deleteAll();migrate(state.storage,v7);});
 const input=await prepared('r2_migration_'+name);
 await runInDurableObject(target,(_o,state)=>withTransaction(state.storage,tx=>installConfiguration(tx,input.config,input,Date.now())));
 return target;
}
const schema=(storage:DurableObjectStorage)=>storage.sql.exec("SELECT type,name,tbl_name AS 'table',sql FROM sqlite_schema ORDER BY type,name").toArray();
const rows=(storage:DurableObjectStorage,table:string)=>storage.sql.exec('SELECT * FROM '+table).toArray();
describe('R2 schema8 actual Workers SQLite storage (no domain activation)',()=>{
 it('historical_schema8_still_matches_immutable_manifest_and_current_registry_adds_only_reviewed_reason_and_artifact_admission',async()=>{
  await runInDurableObject(stub('fresh'),async(_o,state)=>{
   expect(withTransaction(state.storage,inspectRegistry).schemaVersion).toBe(13);
   expect(TABLE_REGISTRY.filter(t=>t.name!=='artifact_inventory_state').map(t=>({...t,columns:t.columns.filter(c=>!({task_history:['reason'],artifacts:['admission_generation','expiry_check_at'],artifact_generations:['artifact_version','upload_idempotency_sha256','cleanup_next_at','cleanup_error_code','delete_admission_epoch','delete_admission_generation']} as Record<string,string[]>)[t.name]?.includes(c.name))}))).toEqual(manifest.tables);
   await state.storage.deleteAll();migrate(state.storage,[...v7,{version:8,sql:m8}]);
   expect(schema(state.storage)).toEqual(manifest.sqlite_schema);
   expect(state.storage.sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
  });
 });
 it('static_adoption_preserves_identity_revocations_and_ceiling',async()=>{
  const target=await oldDatabase('adoption');
  await runInDurableObject(target,(_o,state)=>{
   const sql=state.storage.sql;
   for(const [id,enabled,projects,expiry,retired] of [['disabled',0,'[]',0,null],['expired',1,'null',0,null],['retired',0,'[]',0,1]] as const)
    sql.exec('INSERT INTO native_credentials SELECT ?,workspace_id,agent_id,?,scopes_json,?,?,?,config_epoch,? FROM native_credentials LIMIT 1',id,id.padEnd(64,'a'),projects,expiry,enabled,retired);
   sql.exec("INSERT INTO threads VALUES ('thread_bytes','ws_example','Bytes',1)");
   sql.exec("INSERT INTO messages VALUES ('message_bytes','ws_example','thread_bytes','agent','agent_research','agent_research','Retained Unicode: 日本語','[ ]',1)");
   sql.exec("INSERT INTO outbox (id,workspace_id,message_id,destination_id,notification_id,payload_json,status,attempts,next_due_at,created_at,updated_at) VALUES ('outbox_bytes','ws_example','message_bytes','dest_bytes','notification_bytes','{ \"exact\": \"bytes\" }','exhausted',6,100,1,1)");
   sql.exec("INSERT INTO idempotency_outcomes VALUES ('agent_research','domain.messages:send','messages','key_bytes','ws_example','fingerprint',201,'{ \"original\": true }','request_bytes',NULL,1,86400001)");
   sql.exec("INSERT INTO preferences VALUES ('human_bytes','ws_example',1,'{}',1,'pref_11111111111111111111111111111111')");
   sql.exec('UPDATE maintenance_state SET generation=12');
   const preserved=['native_credentials','static_agents','workspace_metadata','maintenance_state','messages','outbox','idempotency_outcomes','preferences'];
   const before=Object.fromEntries(preserved.map(t=>[t,rows(state.storage,t)]));
   migrate(state.storage);
   for(const table of ['native_credentials','static_agents'])for(const [i,row] of before[table].entries())expect(rows(state.storage,table)[i]).toMatchObject(row);
   for(const table of preserved.filter(x=>!['native_credentials','static_agents'].includes(x)))expect(rows(state.storage,table)).toEqual(before[table]);
   expect(rows(state.storage,'workspace_metadata')).toEqual(before.workspace_metadata);
   expect(rows(state.storage,'maintenance_state')).toEqual(before.maintenance_state);
   for(const row of rows(state.storage,'static_agents'))expect(row).toMatchObject({origin:'operator_static',agent_version:1,description:'',work_role_ids_json:'[]',framework:null,model:null,created_at:before.workspace_metadata[0].installed_at});
   expect(withTransaction(state.storage,inspectRegistry).schemaVersion).toBe(13);
  });
 });
 it('collision_rolls_back_schema_and_rows',async()=>{
  const target=await oldDatabase('collision');
  await runInDurableObject(target,(_o,state)=>{
   state.storage.sql.exec("UPDATE native_credentials SET workspace_id='foreign_workspace'");
   const before=schema(state.storage),credentials=rows(state.storage,'native_credentials');
   expect(()=>migrate(state.storage)).toThrow('R2_IDENTITY_COLLISION');
   expect(schema(state.storage)).toEqual(before);expect(rows(state.storage,'native_credentials')).toEqual(credentials);
   expect(rows(state.storage,'schema_migrations')).toHaveLength(7);
  });
 });
 it('frozen_maintenance_rejects_upgrade',async()=>{
  const target=await oldDatabase('frozen');
  await runInDurableObject(target,(_o,state)=>{
   state.storage.sql.exec("UPDATE maintenance_state SET state='capturing'");
   const before=schema(state.storage);expect(()=>migrate(state.storage)).toThrow('FROZEN_SCHEMA_MIGRATION');
   expect(schema(state.storage)).toEqual(before);expect(rows(state.storage,'schema_migrations')).toHaveLength(7);
  });
 });
 it('restart_does_not_duplicate_adoption',async()=>{
  const target=await oldDatabase('restart');
  const before=await runInDurableObject(target,(_o,state)=>{migrate(state.storage);migrate(state.storage);return {schema:schema(state.storage),agents:rows(state.storage,'static_agents'),versions:rows(state.storage,'schema_migrations')};});
  await evictDurableObject(target);
  expect(await runInDurableObject(target,(_o,state)=>({schema:schema(state.storage),agents:rows(state.storage,'static_agents'),versions:rows(state.storage,'schema_migrations')}))).toEqual(before);
  expect(before.versions).toHaveLength(13);
 });
});

describe('R2 migration fault and static bootstrap compatibility',()=>{
 it('failure_after_identity_adoption_rolls_back_schema_rows_and_bookkeeping',async()=>{
  const target=await oldDatabase('injected');
  await runInDurableObject(target,(_o,state)=>{
   const before={schema:schema(state.storage),agents:rows(state.storage,'static_agents'),credentials:rows(state.storage,'native_credentials'),versions:rows(state.storage,'schema_migrations')};
   expect(()=>migrate(state.storage,[...v7,{version:8,sql:m8+" INSERT INTO missing_fault_table VALUES(1);"}])).toThrow();
   expect({schema:schema(state.storage),agents:rows(state.storage,'static_agents'),credentials:rows(state.storage,'native_credentials'),versions:rows(state.storage,'schema_migrations')}).toEqual(before);
   migrate(state.storage);expect(rows(state.storage,'schema_migrations')).toHaveLength(13);
  });
 });
 it('fresh_static_metadata_uses_trusted_install_time_without_changing_revocations',async()=>{
  const target=stub('static_metadata'),input=await prepared('r2_migration_static_metadata');await target.reconcileConfiguration(operator(),input);
  await runInDurableObject(target,(_o,state)=>{
   const installed=rows(state.storage,'workspace_metadata')[0].installed_at;
   expect(rows(state.storage,'static_agents')[0]).toMatchObject({origin:'operator_static',created_at:installed,updated_at:installed});
   expect(rows(state.storage,'native_credentials')[0]).toMatchObject({origin:'operator_static',created_at:installed,revoked_at:null});
  });
 });
 it.each(['static_agents','native_credentials'] as const)('static_install_rejects_human_managed_collision_in_%s',async table=>{
  const name='provenance_'+table,target=stub(name),input=await prepared('r2_migration_'+name);await target.reconcileConfiguration(operator(),input);
  const next=await prepared('r2_migration_'+name,2);
  await runInDurableObject(target,(_o,state)=>{
   state.storage.sql.exec("UPDATE "+table+" SET origin='human_managed'");
   const before=Object.fromEntries(TABLE_REGISTRY.map(t=>[t.name,rows(state.storage,t.name)]));
   expect(()=>withTransaction(state.storage,tx=>installConfiguration(tx,next.config,next,Date.now()))).toThrow('R2_IDENTITY_COLLISION');
   expect(Object.fromEntries(TABLE_REGISTRY.map(t=>[t.name,rows(state.storage,t.name)]))).toEqual(before);
  });
 });
});

function task(tx:import('../../src/storage/transaction').WorkspaceTransaction,id:string,workspace='ws_example'){
 tx.exec("INSERT INTO tasks (id,workspace_id,title,description,state,task_version,proposal_version,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES (?,?,'Task','','ready',1,0,0,3,'[]',1,1)",[id,workspace]);
}
function runtime(tx:import('../../src/storage/transaction').WorkspaceTransaction){
 tx.exec("INSERT INTO runtimes (id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) SELECT 'runtime_one',workspace_id,agent_id,credential_id,config_epoch,?,1,'Synthetic','online',1,1,90001 FROM native_credentials LIMIT 1",['a'.repeat(64)]);
}
function run(tx:import('../../src/storage/transaction').WorkspaceTransaction,id:string,taskId:string,fence=1,status='active'){
 tx.exec("INSERT INTO runs (id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at,ended_at) SELECT ?,workspace_id,?,agent_id,id,credential_id,authority_epoch,?,1,?,60001,1,? FROM runtimes WHERE id='runtime_one'",[id,taskId,status,fence,status==='active'?null:2]);
}
describe('R2 scoped constraints and transaction behavior',()=>{
 it('active_run_and_provenance_uniqueness_reject',async()=>{
  const target=stub('constraints');await target.reconcileConfiguration(operator(),await prepared('r2_migration_constraints'));
  await runInDurableObject(target,(_o,state)=>{
   withTransaction(state.storage,tx=>{runtime(tx);task(tx,'task_one');run(tx,'run_one','task_one');tx.exec("UPDATE tasks SET state='doing',active_run_id='run_one',latest_run_id='run_one',next_fence=2 WHERE id='task_one'");});
   expect(()=>withTransaction(state.storage,tx=>run(tx,'run_two','task_one',2))).toThrow();
   expect(()=>withTransaction(state.storage,tx=>run(tx,'run_old_fence','task_one',1,'expired'))).toThrow();
   expect(()=>withTransaction(state.storage,tx=>tx.exec("UPDATE runs SET status='expired' WHERE id='run_one'"))).toThrow();
   expect(()=>withTransaction(state.storage,tx=>tx.exec("UPDATE tasks SET state='ready' WHERE id='task_one'"))).toThrow();
   withTransaction(state.storage,tx=>{
    tx.exec("INSERT INTO import_plans VALUES ('import_one','ws_example','human_example','ns',1,'{}','[]','{}',?,NULL,'previewed',100,1)",['b'.repeat(64)]);
    tx.exec("INSERT INTO import_mappings VALUES ('ws_example','ns','external','task_one',?,1,'v1','import_one','{}',1,1)",['b'.repeat(64)]);
   });
   expect(()=>withTransaction(state.storage,tx=>tx.exec("INSERT INTO import_mappings VALUES ('ws_example','ns','external','task_one',?,2,'v2','import_one','{}',1,1)",['c'.repeat(64)]))).toThrow();
   expect(state.storage.sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
  });
 });
 it('ordered_pointer_cycle_commits_together_and_wrong_task_pointer_rolls_back',async()=>{
  const target=stub('pointer');await target.reconcileConfiguration(operator(),await prepared('r2_migration_pointer'));
  await runInDurableObject(target,(_o,state)=>{
   withTransaction(state.storage,tx=>{runtime(tx);task(tx,'task_one');task(tx,'task_two');run(tx,'run_one','task_one');tx.exec("UPDATE tasks SET state='doing',active_run_id='run_one' WHERE id='task_one'");});
   expect(()=>withTransaction(state.storage,tx=>tx.exec("UPDATE tasks SET state='doing',active_run_id='run_one' WHERE id='task_two'"))).toThrow();
   expect(state.storage.sql.exec("SELECT state,active_run_id FROM tasks WHERE id='task_two'").one()).toEqual({state:'ready',active_run_id:null});
  });
 });
 it('workspace_runtime_and_artifact_relationships_reject_cross_binding',async()=>{
  const target=stub('isolation');await target.reconcileConfiguration(operator(),await prepared('r2_migration_isolation'));
  await runInDurableObject(target,(_o,state)=>{
   withTransaction(state.storage,tx=>{runtime(tx);task(tx,'foreign_task','ws_foreign');});
   expect(()=>withTransaction(state.storage,tx=>run(tx,'run_foreign','foreign_task'))).toThrow();
   expect(()=>withTransaction(state.storage,tx=>tx.exec("INSERT INTO runtimes SELECT 'runtime_foreign','ws_foreign',agent_id,credential_id,authority_epoch,proof_sha256,1,label,status,created_at,last_seen_at,presence_expires_at,revoked_at FROM runtimes"))).toThrow();
   expect(()=>withTransaction(state.storage,tx=>tx.exec("INSERT INTO message_artifacts VALUES ('ws_foreign','missing_message','missing_artifact',0)"))).toThrow();
  });
 });
 it('unknown_table_column_and_registry_drift_block_capture_inspection',async()=>{
  await runInDurableObject(stub('registry_drift'),(_o,state)=>{
   state.storage.sql.exec('CREATE TABLE unregistered(id TEXT)');expect(()=>withTransaction(state.storage,inspectRegistry)).toThrow('RECOVERY_SCHEMA_MISMATCH');
   state.storage.sql.exec('DROP TABLE unregistered');state.storage.sql.exec('ALTER TABLE tasks ADD COLUMN unregistered TEXT');expect(()=>withTransaction(state.storage,inspectRegistry)).toThrow('RECOVERY_SCHEMA_MISMATCH');
  });
 });
 it('due_and_order_queries_use_reviewed_indexes_without_capacity_claims',async()=>{
  await runInDurableObject(stub('indexes'),(_o,state)=>{
   for(const [query,index] of [
    ["SELECT id FROM tasks WHERE workspace_id='ws_example' AND state='ready' ORDER BY created_at,id LIMIT 20",'tasks_state_order'],
    ["SELECT id FROM runs WHERE workspace_id='ws_example' AND status='active' AND lease_expires_at<100 ORDER BY lease_expires_at,id LIMIT 20",'runs_lease_due'],
    ["SELECT id FROM artifacts WHERE workspace_id='ws_example' AND status='staged' AND expires_at<100 ORDER BY expires_at,id LIMIT 20",'artifacts_expiry_due'],
    ["SELECT id FROM task_results WHERE workspace_id='ws_example' AND task_id='task_one' AND submission_sequence>0 ORDER BY submission_sequence LIMIT 20",'results_task_order']]){
     const plan=state.storage.sql.exec<{detail:string}>('EXPLAIN QUERY PLAN '+query).toArray();expect(plan.some(row=>row.detail.includes(index))).toBe(true);console.log('R2_QUERY_PLAN',index,JSON.stringify(plan));
    }
  });
 });
});

describe('current schema8 recovery fails closed before effects',()=>{
 it('capture_and_restore_do_not_write_replay_maintenance_alarm_or_objects',async()=>{
  const {advanceCapture}=await import('../../src/recovery/capture');
  const {beginRestore}=await import('../../src/recovery/restore');
  const {recordProbe}=await import('../../src/recovery/probes');
  const {systemClock,systemEntropy}=await import('../../src/workspace/context');
  const target=stub('unavailable'),input=await prepared('r2_migration_unavailable');await target.reconcileConfiguration(operator(),input);
  await runInDurableObject(target,async(_o,state)=>{
   let objectEffects=0;const bucket=new Proxy({}, {get(){objectEffects++;throw Error('Unexpected object access');}}) as R2Bucket;
   const workspace:import('../../src/recovery/protocol').RecoveryWorkspace={storage:state.storage,bucket,workspaceId:'ws_example',objectName:'r2_migration_unavailable',environmentId:'synthetic_r2',clock:systemClock,entropy:systemEntropy,integrity:{keyId:'synthetic',key:btoa('a'.repeat(32))},release:{revision:'synthetic',worker_version:'synthetic',binding_ids:[],catalog_mapping:{workspace_id:'ws_example',object_name:'r2_migration_unavailable'}},repairSchedule:async()=>{throw Error('Unexpected scheduler effect');}};
   const context:import('../../src/recovery/protocol').RecoveryContext={principalId:'synthetic_operator',workspaceId:workspace.workspaceId,objectName:workspace.objectName,environmentId:workspace.environmentId,requestId:'request_unavailable',operationId:'operation_unavailable',operation:'capture',captureId:'capture_unavailable',expectedEpoch:1,expectedInstallationDigest:input.installationDigest,proofExpiresAt:Date.now()+120000,requestFingerprint:'a'.repeat(64),ledgerAnchor:null};
   const snapshot=()=>Object.fromEntries(TABLE_REGISTRY.map(t=>[t.name,rows(state.storage,t.name)])),before=snapshot(),alarm=await state.storage.getAlarm();
   await expect(advanceCapture(workspace,context,{max_rows:100,max_artifacts:0,max_total_bytes:100000})).rejects.toThrow('RECOVERY_FORMAT_UNAVAILABLE');
   await expect(beginRestore(workspace,{...context,operation:'restore'},{} as never,{} as never)).rejects.toThrow('RECOVERY_FORMAT_UNAVAILABLE');
   await expect(recordProbe(workspace,{...context,operation:'probe',captureId:null})).rejects.toThrow('RECOVERY_FORMAT_UNAVAILABLE');
   expect(snapshot()).toEqual(before);expect(await state.storage.getAlarm()).toBe(alarm);expect(objectEffects).toBe(0);
  });
 });
});

describe('artifact generation storage constraints (no object IO)',()=>{
 it('valid_generation_records_and_pointer_survive_restart',async()=>{
  const target=stub('artifact_valid');
  await runInDurableObject(target,(_o,state)=>withTransaction(state.storage,tx=>{
   artifact(tx,'artifact_one');generation(tx,'generation_one','artifact_one');
   tx.exec("UPDATE artifacts SET active_generation_id='generation_one' WHERE id='artifact_one'");
   tx.exec("UPDATE artifact_generations SET effect_operation_id='put_one',effect_kind='put',effect_state='in_flight',effect_started_at=1 WHERE id='generation_one'");
   tx.exec("UPDATE artifact_generations SET observed_sha256=expected_sha256,observed_byte_size=expected_byte_size,state='uploaded',effect_state='drained',effect_drained_at=2 WHERE id='generation_one'");
  }));
  await evictDurableObject(target);
  await runInDurableObject(target,(_o,state)=>{
   expect(rows(state.storage,'artifact_generations')[0]).toMatchObject({state:'uploaded',effect_operation_id:'put_one',effect_kind:'put',effect_state:'drained',effect_started_at:1,effect_drained_at:2,observed_byte_size:12});
   expect(rows(state.storage,'artifacts')[0].active_generation_id).toBe('generation_one');
  });
 });
 it('upload_deadline_digest_size_and_effect_evidence_must_be_consistent',async()=>{
  await runInDurableObject(stub('artifact_invalid'),(_o,state)=>{
   withTransaction(state.storage,tx=>{artifact(tx,'artifact_one');generation(tx,'generation_one','artifact_one');});
   for(const sql of [
    "UPDATE artifacts SET expires_at=NULL WHERE id='artifact_one'",
    "UPDATE artifact_generations SET state='uploaded' WHERE id='generation_one'",
    "UPDATE artifact_generations SET observed_sha256='"+'b'.repeat(64)+"',observed_byte_size=12,state='uploaded' WHERE id='generation_one'",
    "UPDATE artifact_generations SET observed_sha256=expected_sha256,observed_byte_size=13,state='committed' WHERE id='generation_one'",
    "UPDATE artifact_generations SET effect_state='in_flight' WHERE id='generation_one'",
    "UPDATE artifact_generations SET effect_operation_id='put_invalid',effect_kind='put',effect_state='drained',effect_started_at=1 WHERE id='generation_one'",
    "UPDATE artifact_generations SET effect_operation_id='put_invalid',effect_kind='put' WHERE id='generation_one'"
   ])expect(()=>withTransaction(state.storage,tx=>tx.exec(sql))).toThrow();
   expect(rows(state.storage,'artifact_generations')[0]).toMatchObject({state:'reserved',effect_state:'none',effect_operation_id:null,observed_sha256:null,observed_byte_size:null});
  });
 });
 it('generation_pointer_cannot_reference_other_artifact_or_workspace',async()=>{
  await runInDurableObject(stub('artifact_pointer'),(_o,state)=>{
   withTransaction(state.storage,tx=>{artifact(tx,'artifact_one');artifact(tx,'artifact_two');generation(tx,'generation_two','artifact_two');});
   expect(()=>withTransaction(state.storage,tx=>tx.exec("UPDATE artifacts SET active_generation_id='generation_two' WHERE id='artifact_one'"))).toThrow();
   expect(()=>withTransaction(state.storage,tx=>tx.exec("UPDATE artifact_generations SET workspace_id='ws_foreign' WHERE id='generation_two'"))).toThrow();
  });
 });
});
function artifact(tx:import('../../src/storage/transaction').WorkspaceTransaction,id:string){
 tx.exec("INSERT INTO artifacts (id,workspace_id,owner_kind,owner_principal_id,authority_epoch,artifact_version,filename,media_type,byte_size,sha256,status,created_at,expires_at) VALUES (?,'ws_example','human','human_synthetic',1,1,'file.txt','text/plain',12,?,'staged',1,100)",[id,'a'.repeat(64)]);
}
function generation(tx:import('../../src/storage/transaction').WorkspaceTransaction,id:string,artifactId:string){
 tx.exec("INSERT INTO artifact_generations (id,workspace_id,artifact_id,object_key,expected_sha256,expected_byte_size,state,admission_epoch,admission_generation,expires_at,created_at,updated_at) VALUES (?,'ws_example',?,?,?,12,'reserved',1,0,100,1,1)",[id,artifactId,'artifacts/ws_example/'+artifactId+'/'+'a'.repeat(64),'a'.repeat(64)]);
}
