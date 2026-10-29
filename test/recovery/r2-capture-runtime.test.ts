import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {it,expect} from 'vitest';
import {artifactFixture,artifactContext,artifactBucket,stage,chunkStream,claimSetup} from '../helpers/artifacts';
import {uploadArtifactContent,commitArtifact} from '../../src/artifacts/content';
import {advanceCapture} from '../../src/recovery/capture';
import {fixtureIntegrity} from '../helpers/recovery-fixture';
import {withSyntheticCaptureAnchor,syntheticCaptureContext as recoveryContext} from '../helpers/synthetic-capture-anchor';
import {hex,canonicalBytes} from '../../src/recovery/encoding';
import {systemClock,systemEntropy} from '../../src/workspace/context';
import type {RecoveryWorkspace,RecoveryJobProgress} from '../../src/recovery/protocol';

/** Synthetic local observation, not platform CPU/latency or deployed acceptance evidence. */
it('captures 31 immutable 8MiB objects within combined bounds without whole-object capture buffering',async()=>{
 const f=await artifactFixture('capture_runtime_248mib'),size=8*1024*1024;
 const measured=await runInDurableObject(f.stub,async(_instance,state)=>{
  claimSetup(state.storage);const stream=new (crypto as Crypto&{DigestStream:typeof DigestStream}).DigestStream('SHA-256'),hashed=stream.digest;
  await chunkStream(size).pipeTo(stream);const sha256=hex(await hashed),ctx=artifactContext(state.storage,f.name,'large_upload');
  await stage(ctx,'artifact_0',{byte_size:size,sha256});const uploaded=await uploadArtifactContent(ctx,'artifact_0',chunkStream(size),'large_upload');await commitArtifact({...ctx,idempotencyKey:'large_commit'},'artifact_0',{expected_artifact_version:uploaded.artifact_version});
  const a=state.storage.sql.exec<Record<string,string|number|null>>('SELECT * FROM artifacts').one(),g=state.storage.sql.exec<Record<string,string|number|null>>('SELECT * FROM artifact_generations').one();
  // Other immutable rows use the same real-produced shape; no product scalability claim.
  for(let i=1;i<31;i++){const id='artifact_'+i,generation='generation_'+i.toString(16).padStart(48,'0'),key=`artifacts/ws_example/${id}/${generation}/${sha256}`;
   const artifact={...a,id,active_generation_id:generation,committed_generation_id:generation},generationRow={...g,id:generation,artifact_id:id,object_key:key,effect_operation_id:'put_'+generation,upload_idempotency_sha256:i.toString(16).padStart(64,'0')};
   state.storage.transactionSync(()=>{for(const [table,row] of [['artifacts',{...artifact,status:'staged',committed_at:null,expires_at:g.expires_at,active_generation_id:null,committed_generation_id:null}],['artifact_generations',generationRow]] as const)state.storage.sql.exec('INSERT INTO '+table+'('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')',...Object.values(row));state.storage.sql.exec("UPDATE artifacts SET status='committed',committed_at=?,expires_at=NULL,active_generation_id=?,committed_generation_id=? WHERE id=?",a.committed_at,generation,generation,id);});
   const fixed=new FixedLengthStream(size);await Promise.all([chunkStream(size).pipeTo(fixed.writable),artifactBucket().put(key,fixed.readable)]);
  }
  const w:RecoveryWorkspace=withSyntheticCaptureAnchor({storage:state.storage,bucket:env.RECOVERY_BUCKET,artifactBucket:artifactBucket(),workspaceId:'ws_example',objectName:f.name,environmentId:'capture_runtime',clock:systemClock,entropy:systemEntropy,integrity:fixtureIntegrity,release:{revision:'synthetic_runtime',worker_version:'synthetic_runtime',binding_ids:['recovery_fixture','artifact_fixture'],catalog_mapping:{workspace_id:'ws_example',object_name:f.name}},repairSchedule:async()=>({armed:false,nextDueAt:null,generation:0,dirty:false})}),budget={max_rows:1000000,max_artifacts:1000,max_total_bytes:268435456};
  let r:RecoveryJobProgress|undefined,finalMs=0,copyMs=0,maxDetails=0,steps=0;const start=performance.now();
  for(;steps<300;steps++){const before=performance.now(),phase=r?.phase;r=await advanceCapture(w,await recoveryContext(w,'capture',{budget},'capture_runtime',{operationId:'step_'+steps}),budget);const elapsed=performance.now()-before;if(phase==='capture_finalize')finalMs+=elapsed;if(phase==='capture_artifacts')copyMs+=elapsed;maxDetails=Math.max(maxDetails,state.storage.sql.exec<{n:number}>('SELECT length(CAST(details_json AS BLOB)) AS n FROM recovery_jobs').one().n);if(r.state!=='running')break;}
  expect(r?.state).toBe('complete');expect(r!.manifest!.artifacts).toHaveLength(31);expect(r!.counts.bytes).toBeLessThanOrEqual(budget.max_total_bytes);expect(maxDetails).toBeLessThanOrEqual(262144);
  return {artifactCount:31,artifactBytes:31*size,sqlBytes:r!.manifest!.database.byte_size,sqlChunks:r!.counts.chunks,manifestBytes:canonicalBytes(r!.manifest!).length,maxJobBytes:maxDetails,steps:steps+1,totalMs:performance.now()-start,copyMs,finalMs};
 });console.log('CURRENT_CAPTURE_RUNTIME_OBSERVATION',JSON.stringify(measured));
},180000);
