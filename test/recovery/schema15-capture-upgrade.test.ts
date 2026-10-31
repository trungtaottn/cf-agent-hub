import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import fixture from '../fixtures/schema15-capture-upgrade.json';
import {migrate} from '../../src/storage/migrations';
import {SCHEMA16_TABLE_REGISTRY as TABLE_REGISTRY} from '../../src/recovery/table-registry';
import {advanceCapture,readRecoveryChunk,readRecoveryStatus} from '../../src/recovery/capture';
import {decodeCurrentChunk,encodeCurrentChunk} from '../../src/recovery/encoding';
import {fixtureIntegrity,recoveryContext} from '../helpers/recovery-fixture';
import {artifactBucket} from '../helpers/artifacts';
import {systemClock,systemEntropy} from '../../src/workspace/context';
import type {RecoveryWorkspace,RecoveryJobProgress} from '../../src/recovery/protocol';
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
const historical=[m1,m2,m3,m4,m5,m6,m7,m8,m9,m10,m11,m12,m13,m14,m15].map((sql,index)=>({version:index+1,sql}));
const source=fixture as unknown as {name:string;release:RecoveryWorkspace['release'];environment:string;budget:{max_rows:number;max_artifacts:number;max_total_bytes:number};drain:Snapshot;pages:Snapshot};
interface Snapshot {tables:Record<string,Record<string,string|number|null>[]>;sequence:{name:string;seq:number}[];objects:{key:string;body:string}[];}
async function install(stage:'drain'|'pages') {
 const stub=env.WORKSPACE.getByName(source.name),snapshot=source[stage];
 await runInDurableObject(stub,async(_instance,state)=>{
  await state.storage.deleteAll();migrate(state.storage,historical);
  state.storage.transactionSync(()=>{
   state.storage.sql.exec('DELETE FROM schema_migrations');
   for(const table of TABLE_REGISTRY)for(const row of snapshot.tables[table.name]){const keys=Object.keys(row);state.storage.sql.exec('INSERT INTO "'+table.name+'" ('+keys.map(k=>'"'+k+'"').join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')',...keys.map(k=>row[k]));}
   state.storage.sql.exec('DELETE FROM sqlite_sequence');for(const row of snapshot.sequence)state.storage.sql.exec('INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)',row.name,row.seq);
  });
  for(const object of snapshot.objects)await env.RECOVERY_BUCKET.put(object.key,object.body);
 });return stub;
}
function workspace(storage:DurableObjectStorage):RecoveryWorkspace{return {storage,bucket:env.RECOVERY_BUCKET,artifactBucket:artifactBucket(),workspaceId:'ws_example',objectName:source.name,environmentId:source.environment,clock:systemClock,entropy:systemEntropy,integrity:fixtureIntegrity,release:{...source.release,revision:'synthetic_schema16_build',worker_version:'synthetic_schema16_worker'},repairSchedule:async()=>({armed:false,nextDueAt:null,generation:0,dirty:false})};}
for(const phase of ['drain','pages'] as const)it('retains actual frozen15 '+phase+' through current constructor eviction, completion and readback',async()=>{
 const stub=await install(phase);await evictDurableObject(stub);
 let result:RecoveryJobProgress|undefined;
 for(let i=0;i<100;i++){
  result=await runInDurableObject(stub,async(_instance,state)=>{expect(state.storage.sql.exec('SELECT MAX(version) AS v FROM schema_migrations').one().v).toBe(15);const w=workspace(state.storage);return advanceCapture(w,await recoveryContext(w,'capture',{budget:source.budget},'capture_frozen15',{operationId:'upgrade_'+phase+'_'+i}),source.budget);});
  if(result.state==='complete')break;if(i===0)await evictDurableObject(stub);
 }
 expect(result?.state).toBe('complete');expect(result!.manifest!.checkpoint.schema_version).toBe(15);
 expect(result!.manifest!.release.revision).toBe(phase==='pages'?source.release.revision:'synthetic_schema16_build');
 await evictDurableObject(stub);
 await runInDurableObject(stub,async(_instance,state)=>{
  const w=workspace(state.storage),status=readRecoveryStatus(w,await recoveryContext(w,'status',{},'capture_frozen15'),result!.job_id);expect(status.manifest).toEqual(result!.manifest);
  for(const entry of result!.manifest!.database.chunks){const chunk=await readRecoveryChunk(w,await recoveryContext(w,'read-chunk',{index:entry.index},'capture_frozen15'),entry.index);expect(decodeCurrentChunk(new Uint8Array(chunk.bytes)).schema_version).toBe(15);if(phase==='pages'&&entry.index===0)expect(new TextDecoder().decode(chunk.bytes)).toBe(source.pages.objects[0].body);}
  await expect(advanceCapture(w,await recoveryContext(w,'capture',{budget:source.budget},'capture_new_forbidden'),source.budget)).rejects.toThrow();
 });
});
it('rejects current chunk version mismatches rather than silently treating schema15 as schema16',()=>{
 const chunk=JSON.parse(source.pages.objects[0].body);const bytes=encodeCurrentChunk(chunk);
 expect(()=>decodeCurrentChunk(bytes,{capture_id:chunk.capture_id,index:chunk.index,table:chunk.table,row_count:chunk.rows.length,byte_size:bytes.length,schema_version:16} as Parameters<typeof decodeCurrentChunk>[1])).toThrow();
});
it('rejects malformed frozen15 state without upgrading or changing retained data',async()=>{
 const {retainFrozenSchema15}=await import('../../src/recovery/frozen-schema15');
 const mutations=[
  "UPDATE workspace_metadata SET admission_state='installed'",
  "UPDATE maintenance_state SET state='restored'",
  "UPDATE maintenance_state SET barrier_id='barrier_wrong'",
  "UPDATE maintenance_state SET authority_epoch=authority_epoch+1",
  "UPDATE maintenance_state SET generation=generation+1",
  "DELETE FROM schema_migrations WHERE version=9",
  "UPDATE recovery_jobs SET state='failed'",
  "DELETE FROM recovery_chunks",
  "UPDATE recovery_jobs SET details_json=json_set(details_json,'$.checkpoint.schema_version',16,'$.draft.checkpoint.schema_version',16)",
  "CREATE TABLE unexpected_capture_state (id INTEGER)"
 ];
 for(const sql of mutations){const stub=await install('pages');await runInDurableObject(stub,(_instance,{storage})=>{
  storage.sql.exec(sql);const before=storage.sql.exec('SELECT name,sql FROM sqlite_schema ORDER BY name').toArray(),jobs=storage.sql.exec('SELECT * FROM recovery_jobs').toArray(),versions=storage.sql.exec('SELECT * FROM schema_migrations').toArray();let admitted=false;try{admitted=retainFrozenSchema15(storage);}catch{}expect(admitted).toBe(false);
  expect(storage.sql.exec('SELECT name,sql FROM sqlite_schema ORDER BY name').toArray()).toEqual(before);expect(storage.sql.exec('SELECT * FROM recovery_jobs').toArray()).toEqual(jobs);expect(storage.sql.exec('SELECT * FROM schema_migrations').toArray()).toEqual(versions);
 });}
});
it('frozen15 continuation still rejects changed deployment binding, environment or catalogue',async()=>{
 const stub=await install('pages');await runInDurableObject(stub,async(_instance,{storage})=>{
  for(const alter of [(w:RecoveryWorkspace)=>{w.release.binding_ids=['foreign_binding'];},(w:RecoveryWorkspace)=>{w.environmentId='foreign_environment';},(w:RecoveryWorkspace)=>{w.release.catalog_mapping.object_name='foreign_object';}]){
   const w=workspace(storage);alter(w);const before=storage.sql.exec('SELECT * FROM recovery_jobs').toArray();await expect(advanceCapture(w,await recoveryContext(w,'capture',{budget:source.budget},'capture_frozen15'),source.budget)).rejects.toThrow();expect(storage.sql.exec('SELECT * FROM recovery_jobs').toArray()).toEqual(before);
  }
 });
});
