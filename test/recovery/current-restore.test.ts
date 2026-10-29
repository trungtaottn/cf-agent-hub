import {describe,it,expect} from 'vitest';
import {withTransaction} from '../../src/storage/transaction';
import {decodeCurrentChunk,sqlBinding} from '../../src/recovery/encoding';
import {beginRestore} from '../../src/recovery/restore';
import {signRecord,verifyRecord,validateManifestShape} from '../../src/recovery/manifest';
import {fixtureIntegrity,recoveryContext} from '../helpers/recovery-fixture';
import {TABLE_REGISTRY} from '../../src/recovery/table-registry';
import {currentRestoreFixture,captureCurrentFixture,restoreCurrentFixture,withCurrentRecoveryWorkspace,targetArtifactBucket,mutateAuthenticatedCapture} from './current-restore-fixture';

describe('current schema16 isolated restore from genuine capture',()=>{
 it('restores real committed bytes, terminal result and active replay-safe run without resurrecting authority',async()=>{
  const f=await currentRestoreFixture('restore_current_fixture');
  const capture=await captureCurrentFixture(f,{evict:true});
  expect(capture.manifest.checkpoint.schema_version).toBe(16);
  expect(Object.keys(capture.manifest.database.table_counts).sort()).toEqual(TABLE_REGISTRY.map(t=>t.name).sort());
  expect(capture.manifest.artifacts).toHaveLength(1);
  expect(capture.manifest.database.table_counts.tasks).toBe(2);
  expect(capture.manifest.database.table_counts.runs).toBe(2);
  expect(capture.manifest.database.table_counts.task_results).toBe(1);
  expect(capture.manifest.database.table_counts.task_acceptances).toBe(1);
  const restored=await restoreCurrentFixture(f,capture,{evict:true});
  expect(restored.state).toBe('complete');
  await withCurrentRecoveryWorkspace(f,'target',w=>withTransaction(w.storage,tx=>{
   expect(tx.one<{state:string}>('SELECT state FROM maintenance_state')!.state).toBe('restored');
   expect(tx.one<{admission_state:string}>('SELECT admission_state FROM workspace_metadata')!.admission_state).toBe('maintenance');
   expect(tx.one("SELECT state,active_run_id,latest_run_id,retry_count,retry_limit FROM tasks WHERE id='task_b'")).toEqual({state:'backlog',active_run_id:null,latest_run_id:'run_b',retry_count:0,retry_limit:2});
   expect(JSON.parse(tx.one<{flags_json:string}>("SELECT flags_json FROM tasks WHERE id='task_b'")!.flags_json)).toContain('outcome_unknown');
   expect(tx.one<{status:string;ended_at:number|null;replay_policy_version:number}>("SELECT status,ended_at,replay_policy_version FROM runs WHERE id='run_b'")).toMatchObject({status:'expired',replay_policy_version:7});
   expect(tx.one<{ended_at:number|null}>("SELECT ended_at FROM runs WHERE id='run_b'")!.ended_at).not.toBeNull();
   expect(tx.one<{state:string}>("SELECT state FROM tasks WHERE id='task_a'")!.state).toBe('done');
   expect(tx.one<{n:number}>('SELECT count(*) AS n FROM task_acceptances')!.n).toBe(1);
   expect(tx.one<{n:number}>("SELECT count(*) AS n FROM runtimes WHERE status='online' OR revoked_at IS NULL")!.n).toBe(0);
   expect(tx.one<{n:number}>('SELECT count(*) AS n FROM sessions WHERE revoked_at IS NULL')!.n).toBe(0);
   expect(tx.one("SELECT nonce,pkce_verifier FROM login_attempts WHERE id='login_restore'")).toEqual({nonce:'',pkce_verifier:''});
   expect(tx.one<{enabled:number}>("SELECT enabled FROM native_credentials WHERE credential_id='credential_research_2'")!.enabled).toBe(0);
  }));
  const entry=capture.manifest.artifacts[0],object=await targetArtifactBucket().get(entry.object_key);
  expect(object).not.toBeNull();expect(await object!.text()).toBe('hello');
 },90000);
});


describe('current restore rich history',()=>{
 it('captures genuine messaging, archived identity and in-TTL applied/pending imports',async()=>{
  const f=await currentRestoreFixture('restore_current_rich_capture',{rich:true});
  const capture=await captureCurrentFixture(f);
  for(const table of ['messages','message_artifacts','artifact_associations','threads','thread_participants','inbox','import_mappings','catalog_plans'])expect(capture.manifest.database.table_counts[table as keyof typeof capture.manifest.database.table_counts],table).toBeGreaterThan(0);
  expect(capture.manifest.database.table_counts.import_plans).toBe(2);
  await withCurrentRecoveryWorkspace(f,'source',w=>{
   expect(w.storage.sql.exec<{status:string;expires_at:number}>("SELECT status,expires_at FROM catalog_plans WHERE id='catalog_pending'").one()).toMatchObject({status:'previewed'});
   expect(w.storage.sql.exec<{expires_at:number}>("SELECT expires_at FROM catalog_plans WHERE id='catalog_pending'").one().expires_at).toBeGreaterThan(Date.now());
   expect(w.storage.sql.exec<{status:string}>("SELECT status FROM static_agents WHERE agent_id='agent_archived'").one().status).toBe('archived');
  });
 },90000);
 it('expires still-valid previews, preserves report/provenance and archived identity',async()=>{
  const f=await currentRestoreFixture('restore_current_rich',{rich:true});
  const source=await withCurrentRecoveryWorkspace(f,'source',w=>({imports:w.storage.sql.exec('SELECT * FROM import_plans ORDER BY id').toArray(),mappings:w.storage.sql.exec('SELECT * FROM import_mappings').toArray(),messages:w.storage.sql.exec('SELECT * FROM messages').toArray(),links:w.storage.sql.exec('SELECT * FROM message_artifacts').toArray(),outbox:w.storage.sql.exec('SELECT id,payload_json,attempts,status FROM outbox ORDER BY id').toArray()}));
  const capture=await captureCurrentFixture(f);await restoreCurrentFixture(f,capture);
  // Exact preservation checks cover immutable tables, including intentionally empty tables.
  const preserved=['profiles','preferences','threads','thread_participants','messages','inbox','task_results','task_acceptances','result_artifacts','artifact_associations','message_artifacts','import_mappings'] as const;
  const capturedRows=new Map<string,Record<string,unknown>[]>();
  for(const part of capture.chunks){const chunk=decodeCurrentChunk(new Uint8Array(part.bytes));const rows=chunk.rows.map(row=>Object.fromEntries(chunk.columns.map((column,i)=>[column,sqlBinding(row[i])])));capturedRows.set(chunk.table,[...(capturedRows.get(chunk.table)??[]),...rows]);}
  await withCurrentRecoveryWorkspace(f,'target',w=>{
   for(const name of preserved){const definition=TABLE_REGISTRY.find(t=>t.name===name)!;const order=definition.primaryKey.map(key=>'"'+key+'"').join(',');expect(w.storage.sql.exec('SELECT * FROM "'+name+'" ORDER BY '+order).toArray(),name).toEqual(capturedRows.get(name)??[]);}
  });
  await withCurrentRecoveryWorkspace(f,'target',w=>{
   expect(w.storage.sql.exec("SELECT status FROM catalog_plans WHERE id='catalog_pending'").one().status).toBe('expired');
   expect(w.storage.sql.exec('SELECT * FROM import_plans ORDER BY id').toArray()).toEqual(source.imports.map(row=>({...row,status:row.status==='previewed'?'expired':row.status})));
   expect(w.storage.sql.exec('SELECT * FROM import_mappings').toArray()).toEqual(source.mappings);
   expect(w.storage.sql.exec('SELECT * FROM messages').toArray()).toEqual(source.messages);
   expect(w.storage.sql.exec('SELECT * FROM message_artifacts').toArray()).toEqual(source.links);
   // Match canonical authority overlay: archived identities and revoked dynamic credentials retain their original epoch.
   expect(w.storage.sql.exec("SELECT status,config_epoch FROM static_agents WHERE agent_id='agent_archived'").one()).toEqual({status:'archived',config_epoch:1});
   expect(w.storage.sql.exec("SELECT status,config_epoch FROM static_agents WHERE agent_id='agent_managed'").one()).toEqual({status:'active',config_epoch:2});
   expect(w.storage.sql.exec("SELECT enabled,config_epoch FROM native_credentials WHERE credential_id='credential_managed'").one()).toEqual({enabled:0,config_epoch:1});
   expect(w.storage.sql.exec("SELECT revoked_at FROM native_credentials WHERE credential_id='credential_managed'").one().revoked_at).not.toBeNull();
   expect(w.storage.sql.exec('SELECT id,payload_json,attempts,status FROM outbox ORDER BY id').toArray()).toEqual(source.outbox);
   expect(w.storage.sql.exec('SELECT admission_state FROM workspace_metadata').one().admission_state).toBe('maintenance');
   expect(w.storage.sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
  });
 },90000);
});


describe('current restore fail-closed admission',()=>{
 it('does not treat caller ledger digest as a trusted fresh anchor',async()=>{
  const f=await currentRestoreFixture('restore_missing_binding',{seed:false});
  const capture=await captureCurrentFixture(f);
  await withCurrentRecoveryWorkspace(f,'target',async w=>{
   const unbound={...w,trustedAnchor:undefined};
   const ctx=await recoveryContext(unbound,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'unbound_restore'});
   await expect(beginRestore(unbound,ctx,capture.manifest,f.ledger)).rejects.toThrow('RECOVERY_ANCHOR_UNAVAILABLE');
   expect(w.storage.sql.exec('SELECT count(*) AS n FROM recovery_jobs').one().n).toBe(0);
   expect(w.storage.sql.exec('SELECT count(*) AS n FROM workspace_metadata').one().n).toBe(0);
  });
 },90000);
 it('rejects even authenticated schema15 restore tuple before target mutation',async()=>{
  const f=await currentRestoreFixture('restore_deny_15',{seed:false});
  const capture=await captureCurrentFixture(f);
  // Deliberate authenticated tuple mutation, not represented as genuine historical capture.
  const manifest=await signRecord({...capture.manifest,checkpoint:{...capture.manifest.checkpoint,schema_version:15 as const}},fixtureIntegrity);
  await withCurrentRecoveryWorkspace(f,'target',async w=>{
   const ctx=await recoveryContext(w,'restore',{manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'deny15_restore'});
   await expect(beginRestore(w,ctx,manifest,f.ledger)).rejects.toThrow();
   expect(w.storage.sql.exec('SELECT count(*) AS n FROM recovery_jobs').one().n).toBe(0);
   expect(w.storage.sql.exec('SELECT count(*) AS n FROM workspace_metadata').one().n).toBe(0);
  });
 },90000);
});


describe('authenticated original source relationships cannot be laundered by invalidation',()=>{
 const cases=[
  ['active_pointer_to_submitted_run',(table:string,row:Record<string,unknown>)=>{if(table==='runs'&&row.id==='run_b'){row.status='submitted';row.ended_at=row.started_at;}}],
  ['latest_pointer_missing_active',(table:string,row:Record<string,unknown>)=>{if(table==='tasks'&&row.id==='task_b')row.latest_run_id=null;}],
  ['fence_not_monotonic',(table:string,row:Record<string,unknown>)=>{if(table==='tasks'&&row.id==='task_b')row.next_fence=1;}],
  ['done_current_result_missing',(table:string,row:Record<string,unknown>)=>{if(table==='tasks'&&row.id==='task_a')row.current_result_id=null;}],
  ['submitted_agent_principal_mismatch',(table:string,row:Record<string,unknown>)=>{if(table==='task_results')row.submitted_principal_id='agent_other';}],
  ['history_event_wrong_task',(table:string,row:Record<string,unknown>)=>{if(table==='events'&&row.resource_type==='task'&&row.resource_id==='task_a')row.resource_id='task_b';}],
  ['reviewer_is_submitter',(table:string,row:Record<string,unknown>)=>{if(table==='task_acceptances'){row.reviewer_principal_id='agent_research';row.reviewer_agent_id='agent_research';}}],
 ] as const;
 for(const [name,mutate] of cases)it(name,async()=>{
  const f=await currentRestoreFixture('restore_invalid_'+name,{artifacts:false});
  const original=await captureCurrentFixture(f),originalHash=original.manifest.database.sha256;
  const malformed=await mutateAuthenticatedCapture(original,mutate);
  expect(original.manifest.database.sha256).toBe(originalHash);
  expect(malformed.manifest.database.sha256).not.toBe(originalHash);
  validateManifestShape(malformed.manifest);
  await verifyRecord(malformed.manifest,fixtureIntegrity);
  // Every mutation respects row types, CHECK constraints and declared foreign keys;
  // the original-source semantic relationship must fail before transformed completion.
  await expect(restoreCurrentFixture(f,malformed)).rejects.toThrow(/RECOVERY_(RELATIONSHIP|SOURCE|TASK|RUN|RESULT|ACCEPTANCE|FENCE)/);
  await withCurrentRecoveryWorkspace(f,'target',w=>{
   expect(w.storage.sql.exec("SELECT count(*) AS n FROM recovery_jobs WHERE operation='restore' AND state='complete'").one().n).toBe(0);
   expect(w.storage.sql.exec('SELECT admission_state FROM workspace_metadata').one().admission_state).toBe('maintenance');
   expect(w.storage.sql.exec('SELECT state FROM maintenance_state').one().state).not.toBe('open');
  });
 },90000);
});


it('rejects an authenticated Done source without its current result acceptance',async()=>{
 const f=await currentRestoreFixture('restore_done_without_acceptance',{artifacts:false});
 await withCurrentRecoveryWorkspace(f,'source',w=>w.storage.sql.exec('DELETE FROM task_acceptances'));
 const capture=await captureCurrentFixture(f);
 expect(capture.manifest.database.table_counts.task_acceptances).toBe(0);
 await verifyRecord(capture.manifest,fixtureIntegrity);
 await expect(restoreCurrentFixture(f,capture)).rejects.toThrow('RECOVERY_RELATIONSHIP_MISMATCH');
 await withCurrentRecoveryWorkspace(f,'target',w=>expect(w.storage.sql.exec("SELECT count(*) AS n FROM recovery_jobs WHERE operation='restore' AND state='complete'").one().n).toBe(0));
},90000);
