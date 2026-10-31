import {describe,it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {stage,artifactContext,bytes} from '../helpers/artifacts';
import {proof} from '../helpers/results';
import {sha256} from '../../src/config/bootstrap';
import {uploadArtifactContent} from '../../src/artifacts/content';
import {currentRestoreFixture,captureCurrentFixture,restoreCurrentFixture,withCurrentRecoveryWorkspace,targetArtifactBucket} from './current-restore-fixture';

describe('current restore incomplete artifact authority',()=>{
 it('expires staged/uploaded rows and retains never-dispatched reserved evidence without scheduling cleanup',async()=>{
  const f=await currentRestoreFixture('restore_incomplete_artifacts');
  const before=await runInDurableObject(f.source,async(_instance,{storage})=>{
   const ctx={...artifactContext(storage,f.sourceName,'incomplete_stage',Date.now()),proofHash:await sha256(proof)};
   for(const id of ['artifact_staged','artifact_uploaded','artifact_reserved'])await stage({...ctx,idempotencyKey:'stage_'+id},id,{task_id:'task_b',run_id:'run_b'});
   await uploadArtifactContent({...ctx,idempotencyKey:'upload_incomplete'},'artifact_uploaded',bytes(),'upload_incomplete');
   // Explicit crash-state fixture: reservation committed before any external PUT dispatch.
   const row=storage.sql.exec<Record<string,any>>("SELECT * FROM artifacts WHERE id='artifact_reserved'").one(),id='generation_'+'a'.repeat(48),key=`artifacts/ws_example/artifact_reserved/${id}/${row.sha256}`;
   storage.sql.exec("INSERT INTO artifact_generations (id,workspace_id,artifact_id,object_key,expected_sha256,expected_byte_size,state,admission_epoch,admission_generation,expires_at,created_at,updated_at,effect_operation_id,effect_kind,effect_state,artifact_version,upload_idempotency_sha256,cleanup_next_at) VALUES (?,'ws_example','artifact_reserved',?,?,?,'reserved',1,0,?,?,?,?,'put','reserved',?, ?,?)",id,key,row.sha256,row.byte_size,row.expires_at,row.created_at,row.created_at,'put_'+id,row.artifact_version,'a'.repeat(64),row.expires_at);
   return {artifacts:storage.sql.exec<Record<string,any>>("SELECT * FROM artifacts WHERE status<>'committed' ORDER BY id").toArray(),generations:storage.sql.exec<Record<string,any>>("SELECT * FROM artifact_generations WHERE state<>'committed' ORDER BY id").toArray(),reservedKey:key};
  });
  const capture=await captureCurrentFixture(f);expect(capture.manifest.unfinished_artifact_ids).toEqual(['artifact_reserved','artifact_staged','artifact_uploaded']);
  await restoreCurrentFixture(f,capture,{evict:true});
  await withCurrentRecoveryWorkspace(f,'target',w=>{
   for(const source of before.artifacts){const row=w.storage.sql.exec<Record<string,any>>('SELECT * FROM artifacts WHERE id=?',source.id).one();expect(row).toMatchObject({status:'expired',active_generation_id:null,committed_generation_id:null,committed_at:null,expiry_check_at:null,artifact_version:source.artifact_version+1});}
   for(const source of before.generations){const row=w.storage.sql.exec<Record<string,any>>('SELECT * FROM artifact_generations WHERE id=?',source.id).one();expect(row).toEqual({...source,cleanup_next_at:null,delete_admission_epoch:null,delete_admission_generation:null,cleanup_error_code:'RECOVERY_COVERAGE_UNKNOWN'});}
   const reserved=w.storage.sql.exec("SELECT effect_state,effect_started_at,effect_drained_at,state FROM artifact_generations WHERE id=?",'generation_'+'a'.repeat(48)).one();expect(reserved).toEqual({effect_state:'reserved',effect_started_at:null,effect_drained_at:null,state:'reserved'});
   expect(w.storage.sql.exec('SELECT state FROM maintenance_state').one().state).toBe('restored');
  });
  expect(await targetArtifactBucket().get(before.reservedKey)).toBeNull();
 },90000);
});
