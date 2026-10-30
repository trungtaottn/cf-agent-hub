import {describe,it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {artifactFixture,artifactContext,stage,bytes,chunkStream,claimSetup} from '../helpers/artifacts';
import {uploadArtifactContent,commitArtifact} from '../../src/artifacts/content';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {stageArtifactCommand} from '../../src/artifacts/commands';
import {executeCommand} from '../../src/workspace/commands';
import {claimTaskCommand} from '../../src/tasks/claim';
import {claimContext} from '../helpers/claims';
import {human} from '../helpers/settings';

describe('immutable artifact admission',()=>{
 it('stage upload commit has exact durable bytes and private generation identity',async()=>{
  const f=await artifactFixture('artifact_lifecycle');await runInDurableObject(f.stub,async(_o,s)=>{
   const setup=claimSetup(s.storage),ctx=artifactContext(s.storage,f.name,'upload',setup.now);
   const staged=await stage(ctx);expect(staged).toMatchObject({status:'staged',artifact_version:1,byte_size:5});
   const uploaded=await uploadArtifactContent(ctx,staged.id,bytes(),'upload');expect(uploaded).toMatchObject({status:'uploaded',artifact_version:2});
   const committed=await commitArtifact({...ctx,idempotencyKey:'commit'},staged.id,{expected_artifact_version:2});expect(committed).toMatchObject({status:'committed',artifact_version:3,expires_at:null});
   const generation=s.storage.sql.exec<{object_key:string;state:string;effect_state:string}>('SELECT * FROM artifact_generations').one();
   expect(generation).toMatchObject({state:'committed',effect_state:'drained'});expect(await (await ctx.bucket!.get(generation.object_key))!.text()).toBe('hello');
   expect(JSON.stringify([staged,uploaded,committed])).not.toContain(generation.object_key);
   expect(s.storage.sql.exec('SELECT * FROM events WHERE resource_type=?','artifact').toArray()).toHaveLength(3);
   expect(s.storage.sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
  });
 });
 it.each([10485759,10485760,10485761])('independently enforces streamed size %s',async size=>{
  const f=await artifactFixture('artifact_size_'+size);await runInDurableObject(f.stub,async(_o,s)=>{
   const setup=claimSetup(s.storage),ctx=artifactContext(s.storage,f.name,'upload',setup.now);
   const hashes:Record<number,string>={10485759:'fb800474dda38deba58117ce6cb1efa5a447fc930841915279b00901164200c2',10485760:'448c5a66d3f3df0d61a72afad0e438baef03b03a2981254cd5eb51a5c063ea23'};
   await stage(ctx,'artifact_a',{byte_size:Math.min(size,10485760),sha256:hashes[Math.min(size,10485760)]});
   const upload=uploadArtifactContent(ctx,'artifact_a',chunkStream(size),'upload');
   if(size>10485760)await expect(upload).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});else expect((await upload).byte_size).toBe(size);
  });
 });
 it.each(['hell','helloo','jello'])('rejects actual length or digest mismatch %s',async text=>{
  const f=await artifactFixture('artifact_mismatch_'+text);await runInDurableObject(f.stub,async(_o,s)=>{const setup=claimSetup(s.storage),ctx=artifactContext(s.storage,f.name,'upload',setup.now);await stage(ctx);await expect(uploadArtifactContent(ctx,'artifact_a',bytes(text),'upload')).rejects.toBeDefined();expect(s.storage.sql.exec<{status:string}>('SELECT status FROM artifacts').one().status).toBe('staged');});
 });
 it('same upload key and bytes replays original outcome after commit without writing again',async()=>{
  const f=await artifactFixture('artifact_replay');await runInDurableObject(f.stub,async(_o,s)=>{const setup=claimSetup(s.storage),ctx=artifactContext(s.storage,f.name,'upload',setup.now);await stage(ctx);const uploaded=await uploadArtifactContent(ctx,'artifact_a',bytes(),'upload');await commitArtifact({...ctx,idempotencyKey:'commit'},'artifact_a',{expected_artifact_version:2});expect(await uploadArtifactContent(ctx,'artifact_a',bytes(),'upload')).toEqual(uploaded);expect(s.storage.sql.exec('SELECT * FROM artifact_generations').toArray()).toHaveLength(1);await expect(uploadArtifactContent(ctx,'artifact_a',bytes('jello'),'upload')).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});});
 });
 it('wrong runtime proof and creator credential cannot mutate even an unbound artifact',async()=>{
  const f=await artifactFixture('artifact_proof');await runInDurableObject(f.stub,async(_o,s)=>{const setup=claimSetup(s.storage),ctx=artifactContext(s.storage,f.name,'upload',setup.now);await stage(ctx);for(const bad of [{proofHash:null},{proofHash:'b'.repeat(64)},{runtimeId:'runtime_b',proofHash:'b'.repeat(64)},{identity:{...ctx.identity,credentialId:'credential_research_2',tokenDigest:'2'.repeat(64)}}])await expect(uploadArtifactContent({...ctx,...bad},'artifact_a',bytes(),'upload')).rejects.toBeDefined();expect(s.storage.sql.exec('SELECT * FROM artifact_generations').toArray()).toHaveLength(0);});
 });
 it('humans cannot impersonate a run and stale execution cannot stage',async()=>{
  const f=await artifactFixture('artifact_run_stage');await runInDurableObject(f.stub,async(_o,s)=>{const setup=claimSetup(s.storage),ctx=artifactContext(s.storage,f.name,'upload',setup.now);const run=executeCommand(await claimContext(s.storage,f.name,setup.body,'claim',setup.now),setup.identity,claimTaskCommand('task_a','run_a','a'.repeat(64)),setup.body).data.run!;await expect(stage({...ctx,identity:human(s.storage),runtimeId:null,proofHash:null},'human_artifact',{task_id:'task_a',run_id:run.id})).rejects.toBeDefined();await expect(stage({...ctx,workspace:{...ctx.workspace,clock:{nowMs:()=>setup.now+60000}}},'expired_artifact',{task_id:'task_a',run_id:run.id})).rejects.toMatchObject({code:'STALE_RUN'});});
 });
 it('missing product binding and mismatched explicit upload key fail closed before generation',async()=>{
  const f=await artifactFixture('artifact_binding');await runInDurableObject(f.stub,async(_o,s)=>{const setup=claimSetup(s.storage),ctx=artifactContext(s.storage,f.name,'upload',setup.now);await stage(ctx);await expect(uploadArtifactContent({...ctx,bucket:undefined},'artifact_a',bytes(),'upload')).rejects.toMatchObject({code:'DEPENDENCY_UNAVAILABLE'});await expect(uploadArtifactContent(ctx,'artifact_a',bytes(),'different')).rejects.toMatchObject({code:'INVALID_REQUEST'});expect(s.storage.sql.exec('SELECT * FROM artifact_generations').toArray()).toHaveLength(0);});
 });
});
import {claimIdentity,PROOF_OTHER} from '../helpers/claims';
import {evictDurableObject} from 'cloudflare:test';
it('same upload key on independent targets and principals has independent immutable scope',async()=>{const f=await artifactFixture('artifact_upload_scope');await runInDurableObject(f.stub,async(_o,s)=>{const setup=claimSetup(s.storage),ctx=artifactContext(s.storage,f.name,'shared',setup.now),other={...ctx,identity:claimIdentity(s.storage,'credential_other'),runtimeId:'runtime_other',proofHash:PROOF_OTHER};for(const [id,owner] of [['artifact_a',ctx],['artifact_b',ctx],['artifact_c',other]] as const){await stage(owner,id);expect((await uploadArtifactContent(owner,id,bytes(),'shared')).status).toBe('uploaded');}const rows=s.storage.sql.exec<{upload_idempotency_sha256:string}>('SELECT upload_idempotency_sha256 FROM artifact_generations').toArray();expect(new Set(rows.map(x=>x.upload_idempotency_sha256)).size).toBe(3);await expect(uploadArtifactContent(other,'artifact_a',bytes(),'shared')).rejects.toBeDefined();expect(s.storage.sql.exec('SELECT * FROM artifact_generations').toArray()).toHaveLength(3);});});
it('stage admission and uploaded immutable generation survive genuine Durable Object restarts',async()=>{const f=await artifactFixture('artifact_restart');const now=await runInDurableObject(f.stub,async(_o,s)=>{const setup=claimSetup(s.storage),ctx=artifactContext(s.storage,f.name,'upload',setup.now);await stage(ctx);return setup.now;});await evictDurableObject(f.stub);await runInDurableObject(f.stub,async(_o,s)=>{const ctx=artifactContext(s.storage,f.name,'upload',now);expect((await uploadArtifactContent(ctx,'artifact_a',bytes(),'upload')).artifact_version).toBe(2);});await evictDurableObject(f.stub);await runInDurableObject(f.stub,async(_o,s)=>{const ctx=artifactContext(s.storage,f.name,'commit',now);expect((await commitArtifact(ctx,'artifact_a',{expected_artifact_version:2})).status).toBe('committed');expect(s.storage.sql.exec('SELECT * FROM artifact_generations').toArray()).toHaveLength(1);});});
