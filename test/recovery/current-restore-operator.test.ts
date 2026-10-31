import {describe,it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import operatorWorker from '../../workers/operator/src/index';
import type {OperatorBindings,OperatorPolicy} from '../../src/recovery/operator';
import {RESTORE_ENVELOPE_LIMIT,VERIFY_ENVELOPE_LIMIT,RESUME_ENVELOPE_LIMIT} from '../../src/recovery/operator-envelope';
import {signRecord} from '../../src/recovery/manifest';
import {retireWorkspace} from '../../src/recovery/controls';
import {recoveryContext,fixtureIntegrity} from '../helpers/recovery-fixture';
import type {CurrentLedger,CutoverRecord,RecoveryJobProgress} from '../../src/recovery/protocol';
import {encodeHeader,canonicalBytes,digestBytes} from '../../src/recovery/encoding';
import {currentRestoreFixture,captureCurrentFixture,withCurrentRecoveryWorkspace} from './current-restore-fixture';
// The operator deployment has its own generated ambient interface; avoid merging its
// unrelated Cloudflare.TestEnv into the application integration test environment.
declare global {interface OperatorEnv extends OperatorBindings {}}
const enabled=(env as unknown as {CURRENT_RESTORE_OPERATOR_TEST?:string}).CURRENT_RESTORE_OPERATOR_TEST==='enabled';
const url='https://operator.example.invalid/operator/recovery';
async function setup(name:string,unbound=false){
 const f=await currentRestoreFixture(name,{seed:false}),capture=await captureCurrentFixture(f);
 const policy:OperatorPolicy={environment_id:'current_target',origin:'https://operator.example.invalid',access_issuer:'https://access.example.invalid',access_audience:'fixture-operator-audience',bundle_key_id:'fixture_key',workspace_catalog:[{workspace_id:'ws_example',object_name:f.targetName}],services:['fixture-client.access','second-client.access'].map((client_id,index)=>({client_id,principal_id:index?'operator_second':'operator_fixture',environment_id:'current_target',workspace_ids:['ws_example'],operations:['restore','write-chunk','verify','status','resume','probe']})),recovery:{integrity_key_id:'recovery_fixture',current_ledgers:[{workspace_id:'ws_example',authority_epoch:2,sha256:f.anchor.sha256}]}};
 const namespace=unbound?(env as unknown as {NO_ANCHOR_WORKSPACE:DurableObjectNamespace}).NO_ANCHOR_WORKSPACE:env.WORKSPACE;
 const target=namespace.getByName(f.targetName);
 const bindings={...env,WORKSPACE:namespace,OPERATOR_POLICY:JSON.stringify(policy)} as unknown as OperatorBindings;
 const jwt=async(second=false)=>(await fetch('https://operator-fixture.example.invalid/assertion',{method:'POST',body:JSON.stringify({claims:second?{common_name:'second-client.access'}:{}})})).text();
 const body=(operation:string,payload:unknown,operationId:string,epoch=2)=>({operation,workspace_id:'ws_example',capture_id:f.captureId,expected_authority_epoch:epoch,operation_id:operationId,reason:'Synthetic operator current restore',payload});
 const call=async(value:unknown,second=false,padding=0)=>operatorWorker.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/json','cf-access-jwt-assertion':await jwt(second)},body:JSON.stringify(value)+' '.repeat(padding)}),bindings);
 const admit=body('restore',{manifest:capture.manifest,ledger:f.ledger},'original_restore',0);
 const publishAnchor=()=>fetch('https://operator-restore-control.invalid/anchor',{method:'POST',body:JSON.stringify({workspace_id:'ws_example',environment_id:'current_target',object_name:f.targetName,authority_epoch:2,ledger_sha256:f.anchor.sha256,generation:1})});
 return {...f,target:target as typeof f.target,capture,bindings,jwt,body,call,admit,publishAnchor};
}
describe.runIf(enabled)('authenticated operator HTTP to current WorkspaceDO restore',()=>{
 it('admits initial epoch0 and replays only the exact original lost-response body after epoch2',async()=>{
  const f=await setup('operator_current_restore');await f.publishAnchor();
  const padding=RESTORE_ENVELOPE_LIMIT-new TextEncoder().encode(JSON.stringify(f.admit)).length;
  expect((await f.call(f.admit,false,padding+1)).status).toBe(413);
  const first=await f.call(f.admit,false,padding);const text=await first.text();expect(first.status,text).toBe(200);const receipt=JSON.parse(text).data;
  expect((await f.target.authoritySnapshot({workspaceId:'ws_example',objectName:f.targetName})).epoch).toBe(2);
  // Fresh HTTP authentication snapshots epoch2, while original request still expects epoch0.
  const retry=await f.call(f.admit);expect(retry.status,await retry.clone().text()).toBe(200);expect((await retry.json() as {data:unknown}).data).toEqual(receipt);
  for(const changed of [{...f.admit,operation_id:'different_admission'},{...f.admit,reason:'Different fingerprint'},{...f.admit,expected_authority_epoch:2}])expect((await f.call(changed)).status).toBe(409);
  expect((await f.call(f.admit,true)).status).toBe(409);
  expect((await f.call(f.body('verify',{manifest:f.capture.manifest},'stale_verify',0))).status).toBe(409);
  expect((await f.call(f.body('status',{job_id:receipt.job_id},'stale_status',0))).status).toBe(409);
  await runInDurableObject(f.target,(_instance,{storage})=>expect(storage.sql.exec("SELECT count(*) AS n FROM recovery_jobs WHERE operation='restore'").one().n).toBe(1));
  for(const chunk of f.capture.chunks){
   const command=f.body('write-chunk',{index:chunk.metadata.index,sha256:chunk.metadata.sha256,byte_size:chunk.metadata.byte_size},'upload_'+chunk.metadata.index);
   const response=await operatorWorker.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/octet-stream','cf-access-jwt-assertion':await f.jwt(),'X-CFHub-Recovery-Control':encodeHeader(command)},body:chunk.bytes}),f.bindings);
   expect(response.status,await response.clone().text()).toBe(200);
  }
  let completed:RecoveryJobProgress|undefined;
  for(let step=0;step<300;step++){
   const command=f.body('verify',{manifest:f.capture.manifest},'verify_http_'+step);
   const padding=VERIFY_ENVELOPE_LIMIT-new TextEncoder().encode(JSON.stringify(command)).length;
   if(step===0)expect((await f.call(command,false,padding+1)).status).toBe(413);
   const response=await f.call(command,false,padding);expect(response.status,await response.clone().text()).toBe(200);
   const data=(await response.json() as {data:RecoveryJobProgress}).data;if(data.state==='complete'){completed=data;break;}
  }
  expect(completed?.state).toBe('complete');
  const unknown={...f.body('verify',{manifest:f.capture.manifest},'unknown_large_verify'),capture_id:'capture_not_the_server_job'};
  expect((await f.call(unknown,false,VERIFY_ENVELOPE_LIMIT-new TextEncoder().encode(JSON.stringify(unknown)).length)).status).toBe(400);
  // Source retirement is genuine controller output; target probe and resume use authenticated HTTP.
  const sourceLedger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_source',authority_epoch:1,config:f.sourceInput.config,verification_bundle:f.sourceInput.bundle,installation_digest:f.sourceInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
  f.resolver.anchor={authorityEpoch:1,sha256:await digestBytes(canonicalBytes(sourceLedger))};
  const retirement=await withCurrentRecoveryWorkspace(f,'source',async w=>retireWorkspace(w,await recoveryContext(w,'retire',{},f.captureId,{anchor:f.resolver.anchor,operationId:'http_source_retirement'})));
  const probe=await f.call({...f.body('probe',{},'http_target_probe'),capture_id:null});expect(probe.status,await probe.clone().text()).toBe(200);
  const cutover=await signRecord<CutoverRecord>({id:'cutover_http_current',capture_id:f.captureId,workspace_id:'ws_example',source_environment_id:'current_source',source_authority_epoch:1,target_environment_id:'current_target',target_authority_epoch:2,source_retirement_receipt_id:retirement.id,target_catalog_mapping:{workspace_id:'ws_example',object_name:f.targetName},cutover_at:new Date().toISOString(),auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
  const resume=f.body('resume',{receipt_id:completed!.receipt!.id,ledger:f.ledger,source_retirement_receipt:retirement,cutover_record:cutover},'http_target_resume');
  const resumePadding=RESUME_ENVELOPE_LIMIT-new TextEncoder().encode(JSON.stringify(resume)).length;
  const unknownResume={...resume,capture_id:'capture_not_the_server_job'};
  expect((await f.call(unknownResume,false,RESUME_ENVELOPE_LIMIT-new TextEncoder().encode(JSON.stringify(unknownResume)).length)).status).toBe(400);
  expect((await f.call(resume,false,resumePadding+1)).status).toBe(413);
  const resumed=await f.call(resume,false,resumePadding);expect(resumed.status,await resumed.clone().text()).toBe(200);
  const replay=await f.call(resume,false,resumePadding);expect(replay.status,await replay.clone().text()).toBe(200);
  expect((await replay.json() as {data:unknown}).data).toEqual((await resumed.json() as {data:unknown}).data);


 },90000);
 it('resumes a genuine captured schema17 source through authenticated HTTP at the source resume byte limit',async()=>{
  const f=await currentRestoreFixture('operator_source_resume',{seed:false});
  // This installed source runs in the actual test deployment current_target.
  // Capture, probe and resume all cross the same authenticated operator→DO edge.
  const ledger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_target',authority_epoch:1,config:f.sourceInput.config,verification_bundle:f.sourceInput.bundle,installation_digest:f.sourceInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
  const ledgerHash=await digestBytes(canonicalBytes(ledger));
  const policy:OperatorPolicy={environment_id:'current_target',origin:'https://operator.example.invalid',access_issuer:'https://access.example.invalid',access_audience:'fixture-operator-audience',bundle_key_id:'fixture_key',workspace_catalog:[{workspace_id:'ws_example',object_name:f.sourceName}],services:[{client_id:'fixture-client.access',principal_id:'operator_fixture',environment_id:'current_target',workspace_ids:['ws_example'],operations:['capture','probe','resume']}],recovery:{integrity_key_id:'recovery_fixture',current_ledgers:[{workspace_id:'ws_example',authority_epoch:1,sha256:ledgerHash}]}};
  const bindings={...env,OPERATOR_POLICY:JSON.stringify(policy)} as unknown as OperatorBindings;
  await fetch('https://operator-restore-control.invalid/anchor',{method:'POST',body:JSON.stringify({workspace_id:'ws_example',environment_id:'current_target',object_name:f.sourceName,authority_epoch:1,ledger_sha256:ledgerHash,generation:1})});
  const body=(operation:string,payload:unknown,id:string,captureId:string|null=f.captureId)=>({operation,workspace_id:'ws_example',capture_id:captureId,expected_authority_epoch:1,operation_id:id,reason:'Synthetic captured source resume',payload});
  const call=async(command:unknown,padding=0)=>operatorWorker.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/json','cf-access-jwt-assertion':await(await fetch('https://operator-fixture.example.invalid/assertion',{method:'POST',body:'{}'})).text()},body:JSON.stringify(command)+' '.repeat(padding)}),bindings);
  let capture:RecoveryJobProgress|undefined;
  for(let step=0;step<200;step++){
   const response=await call(body('capture',{budget:{max_rows:1000000,max_artifacts:1000,max_total_bytes:268435456}},'source_capture_'+step));
   expect(response.status,await response.clone().text()).toBe(200);capture=(await response.json() as {data:RecoveryJobProgress}).data;
   if(step===0&&capture.state==='running'){
    const incomplete=body('resume',{receipt_id:'receipt_incomplete',ledger,source_retirement_receipt:null,cutover_record:null},'incomplete_source_resume');
    expect((await call(incomplete,RESUME_ENVELOPE_LIMIT-new TextEncoder().encode(JSON.stringify(incomplete)).length)).status).toBe(400);
   }
   if(capture.state==='complete')break;
  }
  expect(capture?.manifest?.format_version).toBe(2);expect(capture?.manifest?.checkpoint.schema_version).toBe(17);expect(capture?.receipt?.status).toBe('complete');
  const probe=await call(body('probe',{},'source_probe',null));expect(probe.status,await probe.clone().text()).toBe(200);
  const resume=body('resume',{receipt_id:capture!.receipt!.id,ledger,source_retirement_receipt:null,cutover_record:null},'source_resume');
  const padding=RESUME_ENVELOPE_LIMIT-new TextEncoder().encode(JSON.stringify(resume)).length;
  expect((await call(resume,padding+1)).status).toBe(413);
  const unknown={...resume,capture_id:'not_the_captured_source'};
  expect((await call(unknown,RESUME_ENVELOPE_LIMIT-new TextEncoder().encode(JSON.stringify(unknown)).length)).status).toBe(400);
  // Adversarial persisted-version regression, not a claim of a genuine schema15
  // capture. A server record with a noncurrent manifest must not inherit16's cap.
  const original=await runInDurableObject(f.source,(_instance,{storage})=>storage.sql.exec<{id:string;details_json:string}>("SELECT id,details_json FROM recovery_jobs WHERE operation='capture' AND capture_id=?",f.captureId).one());
  try{
   const historical=JSON.parse(original.details_json);historical.checkpoint.schema_version=15;historical.manifest.checkpoint.schema_version=15;
   await runInDurableObject(f.source,(_instance,{storage})=>storage.sql.exec('UPDATE recovery_jobs SET details_json=? WHERE id=?',JSON.stringify(historical),original.id));
   expect((await call(resume,padding)).status).toBe(400);
  }finally{await runInDurableObject(f.source,(_instance,{storage})=>storage.sql.exec('UPDATE recovery_jobs SET details_json=? WHERE id=?',original.details_json,original.id));}
  const resumed=await call(resume,padding);expect(resumed.status,await resumed.clone().text()).toBe(200);
  const replay=await call(resume,padding);expect(replay.status,await replay.clone().text()).toBe(200);expect((await replay.json() as {data:unknown}).data).toEqual((await resumed.json() as {data:unknown}).data);
 },90000);
 it('fails closed with actual DO capability absent even with valid caller anchor',async()=>{
  const f=await setup('operator_current_absent',true);await f.publishAnchor();
  const response=await f.call(f.admit);expect(response.status,await response.clone().text()).toBe(503);
  expect((await f.target.authoritySnapshot({workspaceId:'ws_example',objectName:f.targetName})).epoch).toBe(0);
 },90000);
 it('fails closed when the bound trusted provider has no current authoritative record',async()=>{
  const f=await setup('operator_current_no_record');const response=await f.call(f.admit);
  expect(response.status,await response.clone().text()).toBe(503);
  expect((await f.target.authoritySnapshot({workspaceId:'ws_example',objectName:f.targetName})).epoch).toBe(0);
 },90000);
});
