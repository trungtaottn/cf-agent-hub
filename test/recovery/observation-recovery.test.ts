import {it,expect} from 'vitest';
import {evictDurableObject,runInDurableObject} from 'cloudflare:test';
import {canonicalJson} from '../../src/config/bootstrap';
import {withTransaction} from '../../src/storage/transaction';
import {assertAdmissionOpen} from '../../src/recovery/maintenance';
import {validateRecoveryManifest} from '../../src/recovery/generated/recovery-validators.js';
import {beginRestore,writeRestoreChunk,advanceVerify} from '../../src/recovery/restore';
import {token,proof} from '../helpers/results';
import {recoveryContext} from '../helpers/recovery-fixture';
import {storeObservationSlot,assertObservationGraph,type ObservationSlotRow,type ObservationMetadata} from '../../src/observations/repository';
import {currentRestoreFixture,captureCurrentFixture,restoreCurrentFixture,withCurrentRecoveryWorkspace,mutateAuthenticatedCapture} from './current-restore-fixture';
const session='obs_'+'a'.repeat(48);
async function denyImportedSession(f:Awaited<ReturnType<typeof currentRestoreFixture>>){
 const path='https://hub.example.invalid/v2/workspaces/ws_example/tasks/task_b';
 for(const [suffix,body] of [['/observations?expected_session_id='+session,undefined],['/observation-sessions/'+session+'/owner-status',undefined],['/observation-sessions/'+session+'/records',{run_id:'run_b',fence:1,first_sequence:2,records:[{observed_at:'2026-10-31T00:00:00.000Z',relative_path:'src/forbidden.ts',activity:'write-observed',source_oid:null}]}]] as const){
  const response=await f.target.fetch(new Request(path+suffix,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'x-runtime-token':proof,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  expect(response.status).toBe(401);expect(JSON.stringify(await response.json())).not.toContain('src/example.ts');
 }
}

async function source(name:string){
 const f=await currentRestoreFixture(name,{artifacts:false});
 await runInDurableObject(f.source,(_instance,{storage})=>withTransaction(storage,tx=>{
  const run=tx.one<any>("SELECT * FROM runs WHERE id='run_b'")!;
  const metadata:ObservationMetadata={repository_id:'repository_example',checkout_slot_id:'checkout_a',coverage:{configured_events:['write-observed'],completeness:'unknown',reported_loss:false},latest_batch_receipt:{kind:'batch_receipt',session_id:session,first_sequence:1,last_sequence:1,record_count:1,accepted_at:'2026-10-31T00:00:00.000Z',request_fingerprint:'b'.repeat(64)},latest_replacement_receipt:null,retained_range:{first_sequence:1,last_sequence:1},truncated:false};
  const row:ObservationSlotRow={slot:0,workspace_id:'ws_example',task_id:run.task_id,project_id:'historical_project',run_id:run.id,agent_id:run.agent_id,runtime_instance_id:run.runtime_instance_id,credential_id:run.credential_id,authority_epoch:run.authority_epoch,maintenance_generation:0,mapping_digest:'c'.repeat(64),session_id:session,session_epoch:1,high_water:1,created_at:1,metadata_json:'',metadata_bytes:0};
  storeObservationSlot(tx,row,metadata);
  const record=canonicalJson({observed_at:'2026-10-31T00:00:00.000Z',relative_path:'src/example.ts',activity:'write-observed',source_oid:null});
  tx.exec('INSERT INTO observation_records(session_id,sequence,ingest_order,received_at,record_json,record_bytes) VALUES (?,1,1,1,?,?)',[session,record,new TextEncoder().encode(record).length]);
  assertObservationGraph(tx);
 }));
 return f;
}
it('stages original18 diagnostics while CLOSED, validates before invalidation, and deletes records then slots in resumable phases',async()=>{
 const f=await source('observation_restore');const capture=await captureCurrentFixture(f,{evict:true});
 expect(capture.manifest.checkpoint.schema_version).toBe(18);
 expect(capture.manifest.database.table_counts).toHaveProperty('observation_slots',1);expect(capture.manifest.database.table_counts).toHaveProperty('observation_records',1);
 let progress=await withCurrentRecoveryWorkspace(f,'target',async w=>beginRestore(w,await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'begin_observation'}),capture.manifest,f.ledger));
 await denyImportedSession(f);
 for(const chunk of capture.chunks){const m={index:chunk.metadata.index,sha256:chunk.metadata.sha256,byte_size:chunk.metadata.byte_size};progress=await withCurrentRecoveryWorkspace(f,'target',async w=>writeRestoreChunk(w,await recoveryContext(w,'write-chunk',m,f.captureId,{anchor:f.anchor,operationId:'write_observation_'+m.index}),m,new Uint8Array(chunk.bytes)));await evictDurableObject(f.target);await denyImportedSession(f);}
 const seen=new Set<string>(),denied=new Set<string>();
 for(let i=0;i<500&&progress.state==='running';i++){
  const stage=await withCurrentRecoveryWorkspace(f,'target',w=>withTransaction(w.storage,tx=>{
   const job=JSON.parse(tx.one<{details_json:string}>("SELECT details_json FROM recovery_jobs WHERE operation='restore'")!.details_json),stage=job.stage;seen.add(stage);
   expect(()=>assertAdmissionOpen(tx)).toThrow('ADMISSION_CLOSED');
   const records=tx.one<{n:number}>('SELECT count(*) AS n FROM observation_records')!.n,slots=tx.one<{n:number}>('SELECT count(*) AS n FROM observation_slots')!.n;
   if(['fixup','validate','hash','artifacts','transform','invalidate_observation_records'].includes(stage)){expect(records).toBe(1);expect(slots).toBe(1);}
   if(stage==='invalidate_observation_slots'){expect(records).toBe(0);expect(slots).toBe(1);}
   if(stage==='additions'){expect(records).toBe(0);expect(slots).toBe(0);}
   return stage;
  }));
  if(!denied.has(stage)){await denyImportedSession(f);denied.add(stage);}
  if(stage==='invalidate_observation_records'||stage==='invalidate_observation_slots'){
   const table=stage==='invalidate_observation_records'?'observation_records':'observation_slots';
   await withCurrentRecoveryWorkspace(f,'target',w=>w.storage.sql.exec('CREATE TRIGGER reject_observation_delete BEFORE DELETE ON '+table+" BEGIN SELECT RAISE(ABORT,'synthetic_observation_delete_fault'); END"));
   await expect(withCurrentRecoveryWorkspace(f,'target',async w=>advanceVerify(w,await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'verify_observation_'+i}),capture.manifest))).rejects.toThrow('synthetic_observation_delete_fault');
   await evictDurableObject(f.target);await denyImportedSession(f);
   await withCurrentRecoveryWorkspace(f,'target',w=>{expect(JSON.parse(w.storage.sql.exec<{details_json:string}>("SELECT details_json FROM recovery_jobs WHERE operation='restore'").one().details_json).stage).toBe(stage);expect(w.storage.sql.exec('SELECT count(*) AS n FROM '+table).one().n).toBe(1);w.storage.sql.exec('DROP TRIGGER reject_observation_delete');});
  }
  progress=await withCurrentRecoveryWorkspace(f,'target',async w=>advanceVerify(w,await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'verify_observation_'+i}),capture.manifest));await evictDurableObject(f.target);
 }
 await denyImportedSession(f);
 expect(progress.state).toBe('complete');expect(seen).toContain('validate');expect(seen).toContain('invalidate_observation_records');expect(seen).toContain('invalidate_observation_slots');
 await withCurrentRecoveryWorkspace(f,'target',w=>{expect(w.storage.sql.exec('SELECT * FROM observation_records').toArray()).toEqual([]);expect(w.storage.sql.exec('SELECT * FROM observation_slots').toArray()).toEqual([]);});
},90000);
it('rejects authenticated orphan diagnostics before any invalidation or authority transform',async()=>{
 const f=await source('observation_bad_relationship'),capture=await captureCurrentFixture(f);
 const corrupt=await mutateAuthenticatedCapture(capture,(table,row)=>{if(table==='observation_slots')row.run_id='missing_run';});
 await expect(restoreCurrentFixture(f,corrupt,{evict:true})).rejects.toThrow();
 await withCurrentRecoveryWorkspace(f,'target',w=>{expect(w.storage.sql.exec('SELECT count(*) AS n FROM observation_records').one().n).toBe(1);expect(w.storage.sql.exec('SELECT count(*) AS n FROM observation_slots').one().n).toBe(1);expect(w.storage.sql.exec("SELECT status FROM runs WHERE id='run_b'").one().status).toBe('active');expect(w.storage.sql.exec('SELECT state FROM maintenance_state').one().state).toBe('restoring');});
},90000);
it('rejects corrupt observation metadata during capture rather than excluding diagnostics',async()=>{
 const f=await source('observation_bad_capture');
 await withCurrentRecoveryWorkspace(f,'source',w=>w.storage.sql.exec("UPDATE observation_slots SET metadata_json='{}',metadata_bytes=2"));
 await expect(captureCurrentFixture(f)).rejects.toThrow();
},90000);
for(const kind of ['metadata_capacity','noncanonical_metadata','invalid_record'] as const)it('rejects authenticated source18 '+kind+' before destructive transforms',async()=>{
 const f=await source('observation_reject_'+kind),capture=await captureCurrentFixture(f);
 const corrupt=await mutateAuthenticatedCapture(capture,(table,row)=>{
  if(table==='observation_slots'&&kind!=='invalid_record'){
   const metadata=JSON.parse(String(row.metadata_json));if(kind==='metadata_capacity')metadata.repository_id='r'.repeat(17000);
   row.metadata_json=kind==='noncanonical_metadata'?JSON.stringify(metadata,null,1):canonicalJson(metadata);row.metadata_bytes=new TextEncoder().encode(String(row.metadata_json)).length;
  }
  if(table==='observation_records'&&kind==='invalid_record'){const record=JSON.parse(String(row.record_json));record.relative_path='../outside';row.record_json=canonicalJson(record);row.record_bytes=new TextEncoder().encode(String(row.record_json)).length;}
 });
 await expect(restoreCurrentFixture(f,corrupt,{evict:true})).rejects.toThrow();
 await withCurrentRecoveryWorkspace(f,'target',w=>{expect(w.storage.sql.exec('SELECT count(*) AS n FROM observation_records').one().n).toBe(1);expect(w.storage.sql.exec('SELECT count(*) AS n FROM observation_slots').one().n).toBe(1);expect(w.storage.sql.exec("SELECT status FROM runs WHERE id='run_b'").one().status).toBe('active');expect(w.storage.sql.exec('SELECT state FROM maintenance_state').one().state).toBe('restoring');});
},90000);

it('current18 manifest schema enforces diagnostic-specific count bounds before allocating source rows',async()=>{
 const f=await source('observation_manifest_caps'),capture=await captureCurrentFixture(f);
 expect(validateRecoveryManifest(capture.manifest)).toBe(true);
 for(const [table,count] of [['observation_slots',3],['observation_records',513]] as const){const bad=structuredClone(capture.manifest);(bad.database.table_counts as Record<string,number>)[table]=count;expect(validateRecoveryManifest(bad)).toBe(false);}
});
