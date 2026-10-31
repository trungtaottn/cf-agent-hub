import {describe,it,expect,vi} from 'vitest';
import {env} from 'cloudflare:workers';
import {evictDurableObject,runInDurableObject} from 'cloudflare:test';
import operatorWorker from '../../workers/operator/src/index';
import type {OperatorBindings,OperatorPolicy} from '../../src/recovery/operator';
import {canonicalBytes,digestBytes,encodeHeader,decodeCurrentChunk,hex} from '../../src/recovery/encoding';
import {signRecord,verifyRecord} from '../../src/recovery/manifest';
import {systemClock,systemEntropy} from '../../src/workspace/context';
import {advanceVerify} from '../../src/recovery/restore';
import type {RecoveryWorkspace} from '../../src/recovery/protocol';
import {fixtureIntegrity,recoveryContext} from '../helpers/recovery-fixture';
import {operator} from '../helpers/environment';
import {seedNearSqlChunkBudget} from '../helpers/capture-sql-budget';
import {artifactContext,stage,chunkStream} from '../helpers/artifacts';
import {proof,token,sessionToken} from '../helpers/results';
import {owned} from '../helpers/settings';
import {csrfToken} from '../../src/auth/csrf';
import {r2Routes} from '../../src/http/r2-routes';
import {withTransaction} from '../../src/storage/transaction';
import type {SessionRecord} from '../../src/auth/authorize';
import type {CredentialIssue,RuntimeIssue} from '../../src/http/dto';
import {sha256} from '../../src/config/bootstrap';
import {uploadArtifactContent,commitArtifact} from '../../src/artifacts/content';
import {currentRestoreFixture} from './current-restore-fixture';
import type {CurrentLedger,CutoverRecord,RecoveryJobProgress} from '../../src/recovery/protocol';
import type {WorkspaceDO} from '../../src/workspace/workspace-do';
declare global {interface OperatorEnv extends OperatorBindings {}}
type Identity={workspace_id:string;environment_id:string;object_name:string};
type Anchor=Identity&{authority_epoch:number;ledger_sha256:string;generation:number};
type Input=Identity&{operation_id:string;expected:null|{authority_epoch:number;ledger_sha256:string;generation:number};next:{authority_epoch:number;ledger_sha256:string}};
type Writer={publish(input:Input):Promise<{anchor:Anchor}>};
type Bootstrap={create(input:Input):Promise<{anchor:Anchor}>};
const bindings=env as unknown as {TARGET_WORKSPACE:DurableObjectNamespace<WorkspaceDO>;NO_ANCHOR_WORKSPACE:DurableObjectNamespace<WorkspaceDO>;SOURCE_BOOTSTRAP:Bootstrap;TARGET_BOOTSTRAP:Bootstrap;SOURCE_WRITER:Writer;TARGET_WRITER:Writer;RECOVERY_ANCHOR:Fetcher;TARGET_ANCHOR:Fetcher;TARGET_ARTIFACT_BUCKET:R2Bucket};
const url='https://operator.example.invalid/operator/recovery';
async function metric(kind:string,value:unknown){const response=await fetch('https://provider-benchmark.invalid/metric',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,value})});expect(response.status).toBe(204);}
async function setup(name:string,seed=false,observedAssertions?:string[]){
 const f=await currentRestoreFixture(name,{seed}),target=bindings.TARGET_WORKSPACE.getByName(f.targetName);
 const sourceLedger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_source',authority_epoch:1,config:f.sourceInput.config,verification_bundle:f.sourceInput.bundle,installation_digest:f.sourceInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 const sourceHash=await digestBytes(canonicalBytes(sourceLedger));
 const identity=(lane:'source'|'target'):Identity=>({workspace_id:'ws_example',environment_id:'current_'+lane,object_name:lane==='source'?f.sourceName:f.targetName});
 const bootstrap=async(lane:'source'|'target')=>(lane==='source'?bindings.SOURCE_BOOTSTRAP:bindings.TARGET_BOOTSTRAP).create({...identity(lane),operation_id:'bootstrap_'+name+'_'+lane,expected:null,next:{authority_epoch:lane==='source'?1:2,ledger_sha256:lane==='source'?sourceHash:f.anchor.sha256}});
 const policy=(lane:'source'|'target'):OperatorPolicy=>({environment_id:'current_'+lane,origin:'https://operator.example.invalid',access_issuer:'https://access.example.invalid',access_audience:'fixture-operator-audience',bundle_key_id:'fixture_key',workspace_catalog:[{workspace_id:'ws_example',object_name:lane==='source'?f.sourceName:f.targetName}],services:[{client_id:'fixture-client.access',principal_id:'operator_fixture',environment_id:'current_'+lane,workspace_ids:['ws_example'],operations:['capture','read-chunk','restore','write-chunk','verify','status','probe','retire','resume','resolve-delivery']}],recovery:{integrity_key_id:'recovery_fixture',current_ledgers:[{workspace_id:'ws_example',authority_epoch:lane==='source'?1:2,sha256:lane==='source'?sourceHash:f.anchor.sha256}]}});
 const gateway=(lane:'source'|'target',namespace?:DurableObjectNamespace<WorkspaceDO>)=>({...env,WORKSPACE:namespace??(lane==='source'?env.WORKSPACE:bindings.TARGET_WORKSPACE),OPERATOR_POLICY:JSON.stringify(policy(lane))}) as unknown as OperatorBindings;
 const body=(lane:'source'|'target',operation:string,payload:unknown,id:string,epoch=lane==='source'?1:2)=>({operation,workspace_id:'ws_example',capture_id:operation==='probe'?null:f.captureId,expected_authority_epoch:epoch,operation_id:id,reason:'Local real-provider integration',payload});
 const jwt=async()=>{const assertion=await (await fetch('https://operator-fixture.example.invalid/assertion',{method:'POST',body:'{}'})).text();observedAssertions?.push(assertion);return assertion;};
 const call=async(lane:'source'|'target',command:unknown,binary?:ArrayBuffer,namespace?:DurableObjectNamespace<WorkspaceDO>)=>operatorWorker.fetch(new Request(url,{method:'POST',headers:{'content-type':binary?'application/octet-stream':'application/json','cf-access-jwt-assertion':await jwt(),...(binary?{'X-CFHub-Recovery-Control':encodeHeader(command)}:{})},body:binary??JSON.stringify(command)}),gateway(lane,namespace));
 const progress=async(lane:'source'|'target',command:unknown,binary?:ArrayBuffer)=>{const response=await call(lane,command,binary);expect(response.status,await response.clone().text()).toBe(200);return (await response.json() as {data:RecoveryJobProgress}).data;};
 const capture=async()=>{let result:RecoveryJobProgress|undefined;for(let step=0;step<300;step++){result=await progress('source',body('source','capture',{budget:{max_rows:1000000,max_artifacts:1000,max_total_bytes:268435456}},'capture_'+step));if(result.state==='complete')break;}expect(result?.state).toBe('complete');expect(result?.manifest?.checkpoint.schema_version).toBe(17);return result!;};
 return {...f,target,sourceLedger,sourceHash,identity,bootstrap,body,call,progress,capture};
}
async function observe(lane:'source'|'target',identity:Identity){const read=lane==='source'?bindings.RECOVERY_ANCHOR:bindings.TARGET_ANCHOR;return read.fetch(new Request('https://recovery-anchor.invalid/current',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(identity)}));}

describe('actual private provider Worker/SQLite/service-binding composition',()=>{
 it('does not bootstrap on read; separates writer scope, reads durable state independently, and CAS races have one winner',async()=>{
  const f=await setup('provider_persist');expect((await observe('source',f.identity('source'))).status).not.toBe(200);
  const created=await f.bootstrap('source');expect(created.anchor.generation).toBe(1);
  expect(await (await observe('source',f.identity('source'))).json()).toEqual(created.anchor);
  let rejected=false;try{await bindings.TARGET_WRITER.publish({...f.identity('source'),operation_id:'foreign',expected:{authority_epoch:1,ledger_sha256:f.sourceHash,generation:1},next:{authority_epoch:2,ledger_sha256:'a'.repeat(64)}});}catch{rejected=true;}expect(rejected).toBe(true);
  const input={...f.identity('source'),expected:{authority_epoch:1,ledger_sha256:f.sourceHash,generation:1},next:{authority_epoch:2,ledger_sha256:'b'.repeat(64)}};
  const race=await Promise.allSettled(['race_a','race_b'].map(async operation_id=>await bindings.SOURCE_WRITER.publish({...input,operation_id})));
  expect(race.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(race.filter(x=>x.status==='rejected')).toHaveLength(1);
  expect((await (await observe('source',f.identity('source'))).json() as Anchor).generation).toBe(2);
  let defaultRpcDenied=false;try{await (bindings.RECOVERY_ANCHOR as unknown as Writer).publish({...input,operation_id:'read_binding_cannot_write'});}catch{defaultRpcDenied=true;}expect(defaultRpcDenied).toBe(true);
  const mutation=await bindings.RECOVERY_ANCHOR.fetch(new Request('https://recovery-anchor.invalid/publish',{method:'POST',body:JSON.stringify(input)}));expect(mutation.status).not.toBe(200);
 });
 it('captures through HTTP and restores SQL plus artifact bytes through actual provider bindings into a distinct target bucket',async()=>{
  const f=await setup('provider_flow',true);await f.bootstrap('source');await f.bootstrap('target');
  const capture=await f.capture(),manifest=capture.manifest!;
  const admit=f.body('target','restore',{manifest,ledger:f.ledger},'restore_admit',0);
  let restored=await f.progress('target',admit);expect(restored.manifest).toBeNull();
  expect(await f.progress('target',admit)).toEqual(restored);
  for(const ref of manifest.database.chunks){
   const read=await f.call('source',f.body('source','read-chunk',{index:ref.index},'read_'+ref.index));expect(read.status,read.ok?'binary chunk':await read.clone().text()).toBe(200);
   const bytes=await read.arrayBuffer();expect(await digestBytes(new Uint8Array(bytes))).toBe(ref.sha256);
   restored=await f.progress('target',f.body('target','write-chunk',{index:ref.index,sha256:ref.sha256,byte_size:ref.byte_size},'write_'+ref.index),bytes);
  }
  await evictDurableObject(f.target);
  for(let step=0;step<500&&restored.state!=='complete';step++)restored=await f.progress('target',f.body('target','verify',{manifest},'verify_'+step));
  expect(restored.state).toBe('complete');expect(restored.receipt?.status).toBe('complete');
  expect((await bindings.TARGET_ARTIFACT_BUCKET.list()).objects.length).toBeGreaterThan(0);
  await runInDurableObject(f.target,(_instance,{storage})=>{
   expect(storage.sql.exec("SELECT state FROM tasks WHERE id='task_a'").one().state).toBe('done');
   expect(storage.sql.exec("SELECT state FROM tasks WHERE id='task_b'").one().state).toBe('backlog');
   expect(JSON.parse(String(storage.sql.exec("SELECT flags_json FROM tasks WHERE id='task_b'").one().flags_json))).toContain('outcome_unknown');
   expect(storage.sql.exec("SELECT count(*) AS n FROM sqlite_master WHERE name='anchor_receipts'").one().n).toBe(0);
  });
  const retired=await f.call('source',f.body('source','retire',{},'retire_source'));expect(retired.status,await retired.clone().text()).toBe(200);const retirement=(await retired.json() as {data:{id:string}}).data;
  const probe=await f.call('target',f.body('target','probe',{},'probe_target'));expect(probe.status,await probe.clone().text()).toBe(200);
  const cutover=await signRecord<CutoverRecord>({id:'cutover_real_provider',capture_id:f.captureId,workspace_id:'ws_example',source_environment_id:'current_source',source_authority_epoch:1,target_environment_id:'current_target',target_authority_epoch:2,source_retirement_receipt_id:retirement.id,target_catalog_mapping:{workspace_id:'ws_example',object_name:f.targetName},cutover_at:new Date().toISOString(),auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
  const resumed=await f.call('target',f.body('target','resume',{receipt_id:restored.receipt!.id,ledger:f.ledger,source_retirement_receipt:retirement,cutover_record:cutover},'resume_target'));expect(resumed.status,await resumed.clone().text()).toBe(200);
 });
 it('holds a dispatched artifact PUT after a real provider rotation at the external effect boundary',async()=>{
  const f=await setup('provider_copy',true);await f.bootstrap('source');await f.bootstrap('target');const captured=await f.capture(),manifest=captured.manifest!;
  await f.progress('target',f.body('target','restore',{manifest,ledger:f.ledger},'copy_admit',0));
  for(const ref of manifest.database.chunks){const read=await f.call('source',f.body('source','read-chunk',{index:ref.index},'copy_read_'+ref.index));expect(read.status).toBe(200);await f.progress('target',f.body('target','write-chunk',{index:ref.index,sha256:ref.sha256,byte_size:ref.byte_size},'copy_write_'+ref.index),await read.arrayBuffer());}
  for(let step=0;step<500;step++){
   const stage=await runInDurableObject(f.target,(_instance,{storage})=>JSON.parse(String(storage.sql.exec("SELECT details_json FROM recovery_jobs WHERE operation='restore'").one().details_json)).stage);
   if(stage==='artifacts')break;
   await f.progress('target',f.body('target','verify',{manifest},'copy_prepare_'+step));
  }
  await runInDurableObject(f.target,async(_instance,{storage})=>{
   const detail=JSON.parse(String(storage.sql.exec("SELECT details_json FROM recovery_jobs WHERE operation='restore'").one().details_json));expect(detail.stage).toBe('artifacts');
   let puts=0;const target=bindings.TARGET_ARTIFACT_BUCKET;
   const wrapped=new Proxy(target,{get(bucket,key){if(key==='put')return async(...args:Parameters<R2Bucket['put']>)=>{const result=await bucket.put(...args);puts++;await bindings.TARGET_WRITER.publish({...f.identity('target'),operation_id:'rotate_after_put',expected:{authority_epoch:2,ledger_sha256:f.anchor.sha256,generation:1},next:{authority_epoch:3,ledger_sha256:'d'.repeat(64)}});return result;};const value=Reflect.get(bucket,key,bucket);return typeof value==='function'?value.bind(bucket):value;}});
   const w:RecoveryWorkspace={storage,bucket:env.RECOVERY_BUCKET,artifactBucket:wrapped,workspaceId:'ws_example',objectName:f.targetName,environmentId:'current_target',clock:systemClock,entropy:systemEntropy,integrity:fixtureIntegrity,release:JSON.parse(detail.releaseIdentity),trustedAnchor:{bindingId:'real_provider_fixture',binding:bindings.TARGET_ANCHOR},repairSchedule:async()=>({armed:false,nextDueAt:null,generation:0,dirty:false})};
   const context=await recoveryContext(w,'verify',{manifest},f.captureId,{anchor:f.anchor,operationId:'copy_with_rotation'});
   await expect(advanceVerify(w,context,manifest)).rejects.toThrow('RECOVERY_ANCHOR_MISMATCH');expect(puts).toBe(1);
   const effect=JSON.parse(String(storage.sql.exec("SELECT outcome_json FROM idempotency_outcomes WHERE operation='operator.recovery.artifact-copy'").one().outcome_json));expect(effect.state).toBe('dispatched');
  });
  await evictDurableObject(f.target);
  const denied=await f.call('target',f.body('target','verify',{manifest},'after_copy_rotation'));expect(denied.status).not.toBe(200);
  await runInDurableObject(f.target,(_instance,{storage})=>{const effect=JSON.parse(String(storage.sql.exec("SELECT outcome_json FROM idempotency_outcomes WHERE operation='operator.recovery.artifact-copy'").one().outcome_json));expect(effect.state).toBe('dispatched');expect(JSON.parse(String(storage.sql.exec("SELECT details_json FROM recovery_jobs WHERE operation='restore'").one().details_json)).artifactIndex).toBe(0);});
 });
 it('refuses an existing schema17 capture without its retained anchor instead of silently reanchoring',async()=>{
  const f=await setup('provider_legacy');await f.bootstrap('source');
  const budget={max_rows:1000000,max_artifacts:1000,max_total_bytes:268435456};
  const first=await f.progress('source',f.body('source','capture',{budget},'legacy_first'));
  await runInDurableObject(f.source,(_instance,{storage})=>{storage.sql.exec("DELETE FROM idempotency_outcomes WHERE operation='operator.recovery.capture-anchor'");});
  const denied=await f.call('source',f.body('source','capture',{budget},'legacy_next'));expect(denied.status).not.toBe(200);
  const status=await f.call('source',f.body('source','status',{job_id:first.job_id},'legacy_status'));expect(status.status,await status.clone().text()).toBe(200);
  await runInDurableObject(f.source,(_instance,{storage})=>{expect(storage.sql.exec("SELECT count(*) AS n FROM idempotency_outcomes WHERE operation='operator.recovery.capture-anchor'").one().n).toBe(0);});
 });
 it('retains the exact capture generation after actual eviction and rejects malformed generation or rotated exact replay',async()=>{
  const f=await setup('provider_replay');await f.bootstrap('source');const budget={max_rows:1000000,max_artifacts:1000,max_total_bytes:268435456};const command=f.body('source','capture',{budget},'retained_first');
  const first=await f.progress('source',command);
  const record=await runInDurableObject(f.source,(_instance,{storage})=>String(storage.sql.exec("SELECT outcome_json FROM idempotency_outcomes WHERE operation='operator.recovery.capture-anchor'").one().outcome_json));
  await evictDurableObject(f.source);expect(await f.progress('source',command)).toEqual(first);
  await runInDurableObject(f.source,(_instance,{storage})=>{const parsed=JSON.parse(record);parsed.generation=1.5;storage.sql.exec("UPDATE idempotency_outcomes SET outcome_json=? WHERE operation='operator.recovery.capture-anchor'",JSON.stringify(parsed));});
  expect((await f.call('source',command)).status).not.toBe(200);
  await runInDurableObject(f.source,(_instance,{storage})=>{storage.sql.exec("UPDATE idempotency_outcomes SET outcome_json=? WHERE operation='operator.recovery.capture-anchor'",record);});
  await bindings.SOURCE_WRITER.publish({...f.identity('source'),operation_id:'rotate_retained',expected:{authority_epoch:1,ledger_sha256:f.sourceHash,generation:1},next:{authority_epoch:2,ledger_sha256:'e'.repeat(64)}});
  expect((await f.call('source',command)).status).not.toBe(200);
  await runInDurableObject(f.source,(_instance,{storage})=>{expect(String(storage.sql.exec("SELECT outcome_json FROM idempotency_outcomes WHERE operation='operator.recovery.capture-anchor'").one().outcome_json)).toBe(record);});
 });
 it('advances one durable finalization artifact per continuation, survives eviction, and rejects corrupt cursor identity',async()=>{
  const f=await setup('provider_final',true);await f.bootstrap('source');
  await runInDurableObject(f.source,async(_instance,{storage})=>{const ctx={...artifactContext(storage,f.sourceName,'second_artifact',Date.now()),proofHash:await sha256(proof)};await stage(ctx,'artifact_second',{task_id:null,run_id:null,byte_size:5,sha256:await digestBytes(new Uint8Array(5).fill(7))});await uploadArtifactContent({...ctx,idempotencyKey:'upload_second'},'artifact_second',chunkStream(5),'upload_second');await commitArtifact({...ctx,idempotencyKey:'commit_second'},'artifact_second',{expected_artifact_version:2});});
  const budget={max_rows:1000000,max_artifacts:1000,max_total_bytes:268435456};
  for(let step=0;step<300;step++){await f.progress('source',f.body('source','capture',{budget},'final_prepare_'+step));const phase=await runInDurableObject(f.source,(_instance,{storage})=>JSON.parse(String(storage.sql.exec("SELECT details_json FROM recovery_jobs WHERE operation='capture'").one().details_json)).phase);if(phase==='capture_finalize')break;}
  const read=()=>runInDurableObject(f.source,(_instance,{storage})=>({record:String(storage.sql.exec("SELECT outcome_json FROM idempotency_outcomes WHERE operation='operator.recovery.capture-finalization'").one().outcome_json),job:JSON.parse(String(storage.sql.exec("SELECT details_json FROM recovery_jobs WHERE operation='capture'").one().details_json))}));
  const start=await read();expect(JSON.parse(start.record)).toMatchObject({index:0,total:2});expect(start.job.manifest).toBeNull();
  const first=await f.progress('source',f.body('source','capture',{budget},'final_first'));expect(first.state).toBe('running');expect(first.manifest).toBeNull();
  const saved=await read();expect(JSON.parse(saved.record).index).toBe(1);await evictDurableObject(f.source);expect((await read()).record).toBe(saved.record);
  const next=f.body('source','capture',{budget},'final_second');
  for(const change of [(r:any)=>{r.index=-1;},(r:any)=>{r.index=r.total+1;},(r:any)=>{r.draftSha256='f'.repeat(64);},(r:any)=>{r.anchor.generation++;}]){
   const altered=JSON.parse(saved.record);change(altered);await runInDurableObject(f.source,(_instance,{storage})=>{storage.sql.exec("UPDATE idempotency_outcomes SET outcome_json=? WHERE operation='operator.recovery.capture-finalization'",JSON.stringify(altered));});
   // This is the immutable old no-effect running receipt, not a claim that
   // the now-corrupted cursor is valid or that finalization has completed.
   expect(await f.progress('source',f.body('source','capture',{budget},'final_first'))).toEqual(first);
   expect((await f.call('source',next)).status).not.toBe(200);
   expect((await read()).job.manifest).toBeNull();
  }
  await runInDurableObject(f.source,(_instance,{storage})=>{storage.sql.exec("UPDATE idempotency_outcomes SET outcome_json=? WHERE operation='operator.recovery.capture-finalization'",saved.record);});
  const second=await f.progress('source',next);expect(second.state).toBe('running');expect(second.manifest).toBeNull();expect(JSON.parse((await read()).record).index).toBe(2);
  await evictDurableObject(f.source);const complete=await f.progress('source',f.body('source','capture',{budget},'final_publish'));expect(complete.state).toBe('complete');expect(complete.manifest?.artifacts).toHaveLength(2);
 });
 it('probes actual R2 BYOB readAtLeast coalescing, final short read and buffer detachment',async()=>{
  const bucket=bindings.TARGET_ARTIFACT_BUCKET,size=2*65536+513,key='byob_runtime_probe';
  const input=new Uint8Array(size);for(let i=0;i<size;i++)input[i]=i%251;
  await bucket.put(key,input);const object=await bucket.get(key);expect(object?.size).toBe(size);
  const reader=object!.body.getReader({mode:'byob'}) as ReadableStreamBYOBReader&{readAtLeast(minimum:number,view:Uint8Array):Promise<ReadableStreamReadResult<Uint8Array>>};
  expect(typeof reader.readAtLeast).toBe('function');
  let total=0;const lengths:number[]=[];
  try{for(;;){const buffer=new Uint8Array(65536);const part=await reader.readAtLeast(65536,buffer);expect(buffer.byteLength).toBe(0);
   const value=part.value;if(value){lengths.push(value.byteLength);for(let i=0;i<value.byteLength;i++)expect(value[i]).toBe((total+i)%251);total+=value.byteLength;}
   if(part.done)break;
  }}finally{reader.releaseLock();}
  expect(total).toBe(size);expect(lengths.filter(x=>x>0)).toEqual([65536,65536,513]);
  // A caller expecting more bytes must reject the final short EOF; no silent
  // padding or plain-reader fallback is part of this runtime proof.
  const short=await bucket.get(key);const shortReader=short!.body.getReader({mode:'byob'}) as typeof reader;
  let received=0;try{for(;;){const part=await shortReader.readAtLeast(65536,new Uint8Array(65536));received+=part.value?.byteLength??0;if(part.done)break;}}finally{shortReader.releaseLock();}
  expect(received).not.toBe(size+1);
  await metric('ACTUAL_R2_BYOB_PROBE',{bytes:size,minimum:65536,nonempty_read_lengths:lengths.filter(x=>x>0),detached_input_buffers:true,expected_extra_byte_rejected:received!==size+1});
 });
 it('benchmarks near-limit SQL chunks through real provider capture and full typed byte validation',async()=>{
  const f=await setup('provider_sql');await f.bootstrap('source');
  const seeded=await runInDurableObject(f.source,(_instance,{storage})=>seedNearSqlChunkBudget(storage,f.sourceName,246));await metric('REAL_PROVIDER_SQL_SEED',seeded);
  const counter=f.source as unknown as {anchorReadCount():Promise<number>},observations:{step:number;anchor_reads:number;elapsed_ms:number;phase:string}[]=[];
  let capture:RecoveryJobProgress|undefined;
  for(let step=0;step<600;step++){
   const before=await counter.anchorReadCount(),started=Date.now();capture=await f.progress('source',f.body('source','capture',{budget:{max_rows:1000000,max_artifacts:1000,max_total_bytes:268435456}},'sql_capture_'+step));
   const observation={step,anchor_reads:(await counter.anchorReadCount())-before,elapsed_ms:Date.now()-started,phase:capture.phase};observations.push(observation);await metric('REAL_PROVIDER_SQL_CONTINUATION',observation);if(capture.state==='complete')break;
  }
  expect(capture?.state).toBe('complete');const manifest=capture!.manifest!;expect(manifest.format_version).toBe(2);if(manifest.format_version!==2)throw Error('Expected current manifest');
  await verifyRecord(manifest,fixtureIntegrity);expect(manifest.checkpoint.schema_version).toBe(17);expect(manifest.database.chunks.length).toBeGreaterThanOrEqual(240);expect(manifest.database.chunks.length).toBeLessThanOrEqual(256);
  const manifestBytes=canonicalBytes(manifest).length;expect(manifestBytes).toBeLessThanOrEqual(65536);
  const digest=new (crypto as Crypto & {DigestStream:typeof DigestStream}).DigestStream('SHA-256'),writer=digest.getWriter(),hashed=digest.digest.then(value=>({value}),error=>({error}));
  let bytes=0,rows=0;const counts=Object.fromEntries(Object.keys(manifest.database.table_counts).map(name=>[name,0]));
  try{for(const ref of manifest.database.chunks){const read=await f.call('source',f.body('source','read-chunk',{index:ref.index},'sql_read_'+ref.index));expect(read.status).toBe(200);const chunk=new Uint8Array(await read.arrayBuffer());expect(chunk.length).toBe(ref.byte_size);expect(await digestBytes(chunk)).toBe(ref.sha256);const decoded=decodeCurrentChunk(chunk,{...ref,capture_id:f.captureId,schema_version:17});bytes+=chunk.length;rows+=decoded.rows.length;counts[decoded.table]+=decoded.rows.length;await writer.write(chunk);}await writer.close();const result=await hashed;if('error'in result)throw result.error;expect(hex(result.value)).toBe(manifest.database.sha256);}catch(error){await writer.abort().catch(()=>{});throw error;}finally{writer.releaseLock();}
  expect(bytes).toBe(manifest.database.byte_size);expect(counts).toEqual(manifest.database.table_counts);expect(rows).toBe(capture!.counts.rows);
  await metric('REAL_PROVIDER_SQL_BENCHMARK',{messages:seeded.messages,predicted_chunks:seeded.estimate.totalChunks,actual_chunks:manifest.database.chunks.length,sql_bytes:bytes,sql_rows:rows,canonical_manifest_bytes:manifestBytes,continuations:observations.length,total_anchor_reads:observations.reduce((n,x)=>n+x.anchor_reads,0),maximum_reads_per_continuation:Math.max(...observations.map(x=>x.anchor_reads)),observations,memory:'not exposed by Workers test API',cpu_ms:'not exposed by Workers test API',timing:'per gateway continuation wall milliseconds'});
 },180000);
 it('benchmarks a full 10MiB artifact with real provider read accounting per continuation',async()=>{
  const f=await setup('provider_benchmark',true);await f.bootstrap('source');await f.bootstrap('target');
  const size=10485760,digest=await digestBytes(new Uint8Array(size).fill(7));
  await runInDurableObject(f.source,async(_instance,{storage})=>{
   const ctx={...artifactContext(storage,f.sourceName,'large_benchmark',Date.now()),proofHash:await sha256(proof)};
   await stage(ctx,'artifact_maximum',{task_id:null,run_id:null,byte_size:size,sha256:digest});
   await uploadArtifactContent({...ctx,idempotencyKey:'upload_maximum'},'artifact_maximum',chunkStream(size),'upload_maximum');
   await commitArtifact({...ctx,idempotencyKey:'commit_maximum'},'artifact_maximum',{expected_artifact_version:2});
  });
  const observations:{lane:string;operation:string;step:number;anchor_reads:number;elapsed_ms:number}[]=[];
  const count=(lane:'source'|'target')=>(lane==='source'?f.source:f.target) as unknown as {anchorReadCount():Promise<number>};
  const measured=async(lane:'source'|'target',operation:string,payload:unknown,step:number,epoch?:number,binary?:ArrayBuffer)=>{
   const before=await count(lane).anchorReadCount(),started=Date.now();const result=await f.progress(lane,f.body(lane,operation,payload,'bench_'+lane+'_'+operation+'_'+step,epoch),binary);const observation={lane,operation,step,anchor_reads:(await count(lane).anchorReadCount())-before,elapsed_ms:Date.now()-started};observations.push(observation);await metric('REAL_PROVIDER_CONTINUATION',observation);return result;
  };
  let captured:RecoveryJobProgress|undefined;
  for(let step=0;step<300;step++){captured=await measured('source','capture',{budget:{max_rows:1000000,max_artifacts:1000,max_total_bytes:268435456}},step);if(captured.state==='complete')break;}
  expect(captured?.state).toBe('complete');const manifest=captured!.manifest!;expect(manifest.artifacts.some(x=>x.byte_size===size)).toBe(true);
  let restored=await measured('target','restore',{manifest,ledger:f.ledger},0,0);
  for(const ref of manifest.database.chunks){const read=await f.call('source',f.body('source','read-chunk',{index:ref.index},'bench_read_'+ref.index));expect(read.status).toBe(200);restored=await measured('target','write-chunk',{index:ref.index,sha256:ref.sha256,byte_size:ref.byte_size},ref.index,2,await read.arrayBuffer());}
  for(let step=0;step<500&&restored.state!=='complete';step++)restored=await measured('target','verify',{manifest},step);
  expect(restored.state).toBe('complete');
  const entry=manifest.artifacts.find(x=>x.byte_size===size)!,object=await bindings.TARGET_ARTIFACT_BUCKET.get(entry.object_key);expect(object?.size).toBe(size);expect(await digestBytes(new Uint8Array(await object!.arrayBuffer()))).toBe(digest);
  await metric('REAL_PROVIDER_MAX_ARTIFACT_BENCHMARK',{artifact_bytes:size,total_anchor_reads:observations.reduce((n,x)=>n+x.anchor_reads,0),maximum_reads_per_continuation:Math.max(...observations.map(x=>x.anchor_reads)),observations,memory:'not measurable through this Workers test API',cpu_ms:'not measurable through this Workers test API',timing:'Date.now wall milliseconds around one gateway continuation'});
 },120000);
 it('fails closed when the actual WorkspaceDO is constructed without its reader binding',async()=>{
  const f=await setup('provider_missing');await f.bootstrap('source');
  const missing=bindings.NO_ANCHOR_WORKSPACE.getByName(f.sourceName);await missing.reconcileConfiguration(operator(),f.sourceInput);
  const response=await f.call('source',f.body('source','capture',{budget:{max_rows:1000000,max_artifacts:1000,max_total_bytes:268435456}},'missing_anchor'),undefined,bindings.NO_ANCHOR_WORKSPACE);
  expect(response.status).not.toBe(200);
 });
 it('rejects stale expected policy after authoritative provider rotation without falling back to its snapshot',async()=>{
  const f=await setup('provider_rotate');await f.bootstrap('source');
  const first=await f.progress('source',f.body('source','capture',{budget:{max_rows:1000000,max_artifacts:1000,max_total_bytes:268435456}},'first_step'));
  expect(first.state).toBe('running');
  await bindings.SOURCE_WRITER.publish({...f.identity('source'),operation_id:'rotate_source',expected:{authority_epoch:1,ledger_sha256:f.sourceHash,generation:1},next:{authority_epoch:2,ledger_sha256:'c'.repeat(64)}});
  const response=await f.call('source',f.body('source','capture',{budget:{max_rows:1000000,max_artifacts:1000,max_total_bytes:268435456}},'after_rotation'));
  expect(response.status).not.toBe(200);
 });
});

// Source-fixture regression only: Access client-secret exchange is outside this
// application. The signed assertion below actually authenticates operator calls.
it('capture excludes issued native and runtime secrets and accepted service assertions while retaining verification hashes',async()=>{
 const assertions:string[]=[],ordinary:string[]=[];
 const logs=[vi.spyOn(console,'info'),vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')];
 try{
  const f=await setup('provider_secrets',true,assertions);
  const csrf=await runInDurableObject(f.source,async(_instance,{storage})=>csrfToken(owned(storage,f.sourceName),withTransaction(storage,tx=>tx.one<SessionRecord>("SELECT * FROM sessions WHERE id='session_settings'")!)));
  const credentialBody={agent_id:'agent_research',label:'Capture boundary fixture',scopes:['messages:read'],project_ids:null,expires_at:new Date(Date.now()+3600000).toISOString()};
  const issueRequest=()=>new Request('https://hub.example.invalid/v2/workspaces/ws_example/credentials',{method:'POST',headers:{'content-type':'application/json',origin:'https://hub.example.invalid',cookie:'cfhub_session='+sessionToken,'x-csrf-token':csrf,'idempotency-key':'capture-secret-issue'},body:JSON.stringify(credentialBody)});
  // Real credential HTTP route/auth/transaction, using the existing synthetic
  // session and CSRF fixture; this does not claim a live OIDC login.
  const issue=()=>runInDurableObject(f.source,(_instance,{storage})=>r2Routes(issueRequest(),owned(storage,f.sourceName)));
  const issued=await issue();expect(issued.status).toBe(201);
  const credential=(await issued.json() as {data:CredentialIssue}).data;
  expect(credential.revealed).toBe(true);expect(credential.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const nativeSecret=credential.token!;
  const enrollRequest=()=>new Request('https://hub.example.invalid/v2/workspaces/ws_example/runtimes',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','idempotency-key':'capture-secret-enroll'},body:JSON.stringify({label:'Capture boundary runtime'})});
  const enrolled=await f.source.fetch(enrollRequest());expect(enrolled.status).toBe(201);
  const runtime=(await enrolled.json() as {data:RuntimeIssue}).data;
  expect(runtime.revealed).toBe(true);expect(runtime.runtime_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const runtimeSecret=runtime.runtime_token!;
  // The first one-time responses intentionally contain their secrets and are
  // not misclassified as sanitized ordinary responses.
  const issueReplay=await issue();expect(issueReplay.status).toBe(201);
  ordinary.push(await issueReplay.text());expect(JSON.parse(ordinary.at(-1)!).data).toMatchObject({token:null,revealed:false});
  const enrollReplay=await f.source.fetch(enrollRequest());expect(enrollReplay.status).toBe(201);
  ordinary.push(await enrollReplay.text());expect(JSON.parse(ordinary.at(-1)!).data).toMatchObject({runtime_token:null,revealed:false});
  await f.bootstrap('source');
  let progress:RecoveryJobProgress|undefined;
  for(let step=0;step<300;step++){
   const response=await f.call('source',f.body('source','capture',{budget:{max_rows:1000000,max_artifacts:1000,max_total_bytes:268435456}},'secret_capture_'+step));
   expect(response.status).toBe(200);ordinary.push(await response.text());
   progress=(JSON.parse(ordinary.at(-1)!) as {data:RecoveryJobProgress}).data;
   if(progress.state==='complete')break;
  }
  expect(progress?.state).toBe('complete');expect(progress?.manifest).not.toBeNull();
  const manifest=progress!.manifest!;
  const rows:Record<string,unknown>[]=[],chunks:string[]=[];
  for(const ref of manifest.database.chunks){
   const response=await f.call('source',f.body('source','read-chunk',{index:ref.index},'secret_read_'+ref.index));
   expect(response.status).toBe(200);const bytes=new Uint8Array(await response.arrayBuffer());
   expect(await digestBytes(bytes)).toBe(ref.sha256);
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);chunks.push(text);
   const chunk=decodeCurrentChunk(bytes);
   if(chunk.table==='native_credentials'||chunk.table==='runtimes')rows.push(...chunk.rows.map(row=>Object.fromEntries(chunk.columns.map((column,index)=>[column,row[index]]))));
  }
  expect(chunks).toHaveLength(manifest.database.chunks.length);expect(chunks.length).toBeGreaterThan(0);
  // Positive controls prevent an empty/redacted-away export from passing.
  expect(rows.find(row=>row.credential_id===credential.credential.id)).toMatchObject({token_sha256:await sha256(nativeSecret)});
  expect(rows.find(row=>row.id===runtime.runtime.id)).toMatchObject({proof_sha256:await sha256(runtimeSecret)});
  expect(assertions.length).toBeGreaterThan(0);
  for(const assertion of assertions)expect(assertion.split('.')).toHaveLength(3);
  const exported=JSON.stringify({chunks,manifest,ordinary,logs:logs.map(log=>log.mock.calls)});
  for(const secret of [nativeSecret,runtimeSecret,...assertions])expect(exported).not.toContain(secret);
 }finally{for(const log of logs)log.mockRestore();}
});
