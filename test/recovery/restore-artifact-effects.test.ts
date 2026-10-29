import {describe,it,expect} from 'vitest';
import {evictDurableObject} from 'cloudflare:test';
import {beginRestore,writeRestoreChunk,advanceVerify} from '../../src/recovery/restore';
import {recoveryContext} from '../helpers/recovery-fixture';
import {currentRestoreFixture,captureCurrentFixture,withCurrentRecoveryWorkspace} from './current-restore-fixture';
async function atArtifacts(name:string){
 const f=await currentRestoreFixture(name),capture=await captureCurrentFixture(f);
 await withCurrentRecoveryWorkspace(f,'target',async w=>{
  await beginRestore(w,await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'begin'}),capture.manifest,f.ledger);
  for(const chunk of capture.chunks){const m={index:chunk.metadata.index,sha256:chunk.metadata.sha256,byte_size:chunk.metadata.byte_size};await writeRestoreChunk(w,await recoveryContext(w,'write-chunk',m,f.captureId,{anchor:f.anchor,operationId:'write_'+m.index}),m,new Uint8Array(chunk.bytes));}
  for(let i=0;i<500;i++){const d=JSON.parse(w.storage.sql.exec<{details_json:string}>('SELECT details_json FROM recovery_jobs WHERE operation=\'restore\'').one().details_json);if(d.stage==='artifacts')return;await advanceVerify(w,await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'prepare_'+i}),capture.manifest);}
  throw Error('Artifact stage not reached');
 });return {f,capture};
}
const detail=(w:any)=>JSON.parse(w.storage.sql.exec('SELECT details_json FROM recovery_jobs WHERE operation=\'restore\'').one().details_json);
describe('durable restore artifact effects',()=>{
 it('does not clear a lost PUT response after eviction even when exact target bytes exist',async()=>{
  const {f,capture}=await atArtifacts('artifact_effect_lost');
  await withCurrentRecoveryWorkspace(f,'target',async w=>{
   const target=w.artifactBucket!;w.artifactBucket=new Proxy(target,{get(bucket,key){if(key==='put')return async(...args:Parameters<R2Bucket['put']>)=>{await bucket.put(...args);throw Error('SYNTHETIC_LOST_PUT_RESPONSE');};const v=Reflect.get(bucket,key,bucket);return typeof v==='function'?v.bind(bucket):v;}});
   const ctx=await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'artifact_copy'});
   await expect(advanceVerify(w,ctx,capture.manifest)).rejects.toThrow('SYNTHETIC_LOST_PUT_RESPONSE');expect(detail(w).artifactIndex).toBe(0);expect(detail(w).pending.operationId).toBe('artifact_copy');
  });
  await evictDurableObject(f.target);
  await withCurrentRecoveryWorkspace(f,'target',async w=>{
   const object=await w.artifactBucket!.get(capture.manifest.artifacts[0].object_key);expect(object?.size).toBe(capture.manifest.artifacts[0].byte_size);await object?.body.cancel();
   const ctx=await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'artifact_copy'});
   await expect(advanceVerify(w,ctx,capture.manifest)).rejects.toThrow('RECOVERY_ARTIFACT_EFFECT_UNRESOLVED');expect(detail(w).artifactIndex).toBe(0);expect(detail(w).pending.operationId).toBe('artifact_copy');
  });
 },90000);
 it('serializes exact concurrent retries while the dispatched conditional PUT is still pending',async()=>{
  const {f,capture}=await atArtifacts('artifact_effect_concurrent');
  await withCurrentRecoveryWorkspace(f,'target',async w=>{
   let released!:()=>void,landed!:()=>void,writes=0;
   const gate=new Promise<void>(r=>released=r),ready=new Promise<void>(r=>landed=r),target=w.artifactBucket!;
   w.artifactBucket=new Proxy(target,{get(bucket,key){if(key==='put')return async(...args:Parameters<R2Bucket['put']>)=>{writes++;const result=await bucket.put(...args);landed();await gate;return result;};const v=Reflect.get(bucket,key,bucket);return typeof v==='function'?v.bind(bucket):v;}});
   const ctx=await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'artifact_concurrent'});
   const first=advanceVerify(w,ctx,capture.manifest);await ready;
   await expect(advanceVerify(w,ctx,capture.manifest)).rejects.toThrow('RECOVERY_ARTIFACT_EFFECT_UNRESOLVED');expect(detail(w).artifactIndex).toBe(0);expect(writes).toBe(1);
   released();await first;expect(detail(w).artifactIndex).toBe(1);expect(writes).toBe(1);
  });
 },90000);
 it('retries a reserved never-dispatched copy after eviction without treating it as unknown',async()=>{
  const {f,capture}=await atArtifacts('artifact_effect_reserved');
  await withCurrentRecoveryWorkspace(f,'target',async w=>{
   const source=w.bucket;w.bucket=new Proxy(source,{get(bucket,key){if(key==='get')return async()=>{throw Error('SYNTHETIC_SOURCE_UNAVAILABLE');};const v=Reflect.get(bucket,key,bucket);return typeof v==='function'?v.bind(bucket):v;}});
   const ctx=await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'artifact_reserved'});
   await expect(advanceVerify(w,ctx,capture.manifest)).rejects.toThrow('SYNTHETIC_SOURCE_UNAVAILABLE');expect(detail(w).artifactIndex).toBe(0);
  });await evictDurableObject(f.target);
  await withCurrentRecoveryWorkspace(f,'target',async w=>{const ctx=await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'artifact_reserved'});await advanceVerify(w,ctx,capture.manifest);expect(detail(w).artifactIndex).toBe(1);});
 },90000);
 it('does not mark a fulfilled old callback terminal after resolver rotation',async()=>{
  const {f,capture}=await atArtifacts('artifact_effect_rotated');
  await withCurrentRecoveryWorkspace(f,'target',async w=>{
   const target=w.artifactBucket!;w.artifactBucket=new Proxy(target,{get(bucket,key){if(key==='put')return async(...args:Parameters<R2Bucket['put']>)=>{const result=await bucket.put(...args);f.resolver.generation++;return result;};const v=Reflect.get(bucket,key,bucket);return typeof v==='function'?v.bind(bucket):v;}});
   const ctx=await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'artifact_rotated'});
   await expect(advanceVerify(w,ctx,capture.manifest)).rejects.toThrow('RECOVERY_ANCHOR_MISMATCH');expect(detail(w).artifactIndex).toBe(0);
   const record=JSON.parse(w.storage.sql.exec<{outcome_json:string}>("SELECT outcome_json FROM idempotency_outcomes WHERE operation='operator.recovery.artifact-copy'").one().outcome_json);expect(record.state).toBe('dispatched');
  });
 },90000);
});
