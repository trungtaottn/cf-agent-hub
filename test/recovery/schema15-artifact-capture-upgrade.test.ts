import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import fixture from '../fixtures/schema15-artifact-capture-upgrade.json';
import {migrate} from '../../src/storage/migrations';
import {SCHEMA16_TABLE_REGISTRY as TABLE_REGISTRY} from '../../src/recovery/table-registry';
import {advanceCapture,readRecoveryChunk,readRecoveryStatus} from '../../src/recovery/capture';
import {decodeCurrentChunk,digestBytes} from '../../src/recovery/encoding';
import {verifyRecord} from '../../src/recovery/manifest';
import {fixtureIntegrity,recoveryContext} from '../helpers/recovery-fixture';
import {artifactBucket,wrapBucket} from '../helpers/artifacts';
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
interface Snapshot {tables:Record<string,Record<string,string|number|null>[]>;sequence:{name:string;seq:number}[];objects:{key:string;body:string}[];productObjects:{key:string;body:string}[];}
const source=fixture as unknown as {source:string;name:string;captureId:string;release:RecoveryWorkspace['release'];environment:string;budget:{max_rows:number;max_artifacts:number;max_total_bytes:number};entry:{object_key:string;recovery_object_key:string;generation_id:string;artifact_version:number;sha256:string;byte_size:number};snapshot:Snapshot};
function workspace(storage:DurableObjectStorage):RecoveryWorkspace{return {storage,bucket:env.RECOVERY_BUCKET,artifactBucket:artifactBucket(),workspaceId:'ws_example',objectName:source.name,environmentId:source.environment,clock:systemClock,entropy:systemEntropy,integrity:fixtureIntegrity,release:{...source.release,revision:'synthetic_schema16_build',worker_version:'synthetic_schema16_worker'},repairSchedule:async()=>({armed:false,nextDueAt:null,generation:0,dirty:false})};}
it('continues genuine pre16 artifact-copy checkpoint through constructor eviction, corrupt-byte refusal and exact retained15 copy',async()=>{
 const stub=env.WORKSPACE.getByName(source.name),snapshot=source.snapshot;
 await runInDurableObject(stub,async(_instance,state)=>{
  await state.storage.deleteAll();migrate(state.storage,historical);state.storage.transactionSync(()=>{
   state.storage.sql.exec('DELETE FROM schema_migrations');
   for(const table of TABLE_REGISTRY)for(const originalRow of snapshot.tables[table.name]){const row=table.name==='artifacts'?{...originalRow,status:'expired',active_generation_id:null,committed_generation_id:null,committed_at:null}:originalRow;const keys=Object.keys(row);state.storage.sql.exec('INSERT INTO "'+table.name+'" ('+keys.map(k=>'"'+k+'"').join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')',...keys.map(k=>row[k]));}
   // Resolve the artifact/generation FK cycle inside this fixture-only transaction,
   // then prove every imported row is exactly the original captured source state.
   for(const row of snapshot.tables.artifacts){const keys=Object.keys(row).filter(k=>k!=='id');state.storage.sql.exec('UPDATE artifacts SET '+keys.map(k=>'"'+k+'"=?').join(',')+' WHERE id=?',...keys.map(k=>row[k]),row.id);}
   for(const table of TABLE_REGISTRY){const order=table.primaryKey.map(k=>'"'+k+'"').join(',');const actual=state.storage.sql.exec('SELECT * FROM "'+table.name+'" ORDER BY '+order).toArray();expect(actual).toEqual([...snapshot.tables[table.name]].sort((a,b)=>{for(const k of table.primaryKey){if(a[k]!==b[k])return a[k]!<b[k]!?-1:1;}return 0;}));}
   expect(state.storage.sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
   state.storage.sql.exec('DELETE FROM sqlite_sequence');for(const row of snapshot.sequence)state.storage.sql.exec('INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)',row.name,row.seq);
  });
  for(const object of snapshot.objects)await env.RECOVERY_BUCKET.put(object.key,object.body);
  for(const object of snapshot.productObjects)await artifactBucket().put(object.key,object.body);
  await env.RECOVERY_BUCKET.delete(source.entry.recovery_object_key);
 });
 await evictDurableObject(stub);
 await runInDurableObject(stub,async(_instance,{storage})=>{
  expect(storage.sql.exec('SELECT MAX(version) AS v FROM schema_migrations').one().v).toBe(15);const w=workspace(storage);let effects=0;
  const before=storage.sql.exec('SELECT * FROM recovery_jobs').toArray();
  w.release={...w.release,binding_ids:['wrong_binding']};w.bucket=wrapBucket(w.bucket,{get:async()=>{effects++;throw Error('unexpected object read');},put:async()=>{effects++;throw Error('unexpected object write');}});
  await expect(advanceCapture(w,await recoveryContext(w,'capture',{budget:source.budget},source.captureId,{operationId:'wrong_binding'}),source.budget)).rejects.toThrow('RECOVERY_SOURCE_IDENTITY_MISMATCH');
  expect(effects).toBe(0);expect(storage.sql.exec('SELECT * FROM recovery_jobs').toArray()).toEqual(before);
 });
 const original=snapshot.productObjects[0].body;await artifactBucket().put(source.entry.object_key,'X'+original.slice(1));
 await runInDurableObject(stub,async(_instance,{storage})=>{
  const w=workspace(storage);await expect(advanceCapture(w,await recoveryContext(w,'capture',{budget:source.budget},source.captureId,{operationId:'resume_artifact'}),source.budget)).rejects.toThrow();
  const job=storage.sql.exec<{state:string;details_json:string}>('SELECT state,details_json FROM recovery_jobs').one(),details=JSON.parse(job.details_json);
  expect(job.state).toBe('running');expect(details.manifest).toBeNull();expect(details.artifactIndex).toBe(0);expect(details.phase).toBe('capture_artifacts');expect(storage.sql.exec('SELECT state FROM maintenance_state').one().state).toBe('capturing');
 });
 await artifactBucket().put(source.entry.object_key,original);await evictDurableObject(stub);
 let result:RecoveryJobProgress|undefined;
 for(let i=0;i<10;i++){
  result=await runInDurableObject(stub,async(_instance,{storage})=>{const w=workspace(storage);return advanceCapture(w,await recoveryContext(w,'capture',{budget:source.budget},source.captureId,{operationId:i===0?'resume_artifact':'finish_'+i}),source.budget);});
  if(result.state==='complete')break;await evictDurableObject(stub);
 }
 expect(result!.state).toBe('complete');const manifest=result!.manifest!;expect(manifest.checkpoint.schema_version).toBe(15);expect(manifest.release).toEqual(source.release);expect(manifest.artifacts).toHaveLength(1);expect(manifest.artifacts[0]).toEqual(source.entry);await verifyRecord(manifest,fixtureIntegrity);
 const copied=await env.RECOVERY_BUCKET.get(source.entry.recovery_object_key);expect(copied).not.toBeNull();const copiedBytes=new Uint8Array(await copied!.arrayBuffer());expect(new TextDecoder().decode(copiedBytes)).toBe(original);expect(copiedBytes.length).toBe(source.entry.byte_size);expect(await digestBytes(copiedBytes)).toBe(source.entry.sha256);
 await evictDurableObject(stub);await runInDurableObject(stub,async(_instance,{storage})=>{
  const w=workspace(storage);expect(storage.sql.exec('SELECT MAX(version) AS v FROM schema_migrations').one().v).toBe(15);expect(readRecoveryStatus(w,await recoveryContext(w,'status',{},source.captureId),result!.job_id).manifest).toEqual(manifest);
  for(const entry of manifest.database.chunks){const retained=await readRecoveryChunk(w,await recoveryContext(w,'read-chunk',{index:entry.index},source.captureId),entry.index);expect(decodeCurrentChunk(new Uint8Array(retained.bytes)).schema_version).toBe(15);expect(new TextDecoder().decode(retained.bytes)).toBe(snapshot.objects.find(object=>JSON.parse(object.body).index===entry.index)!.body);}
 });
},60000);
