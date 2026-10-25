import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {env} from 'cloudflare:workers';
import app from '../../src/index';
import {installed,login,origin} from '../helpers/auth';
import {recoveryFixture,withRecoveryWorkspace,recoveryContext} from '../helpers/recovery-fixture';
import {recordProbe,PROBE_MAX_AGE_MS} from '../../src/recovery/probes';
import {advanceCapture} from '../../src/recovery/capture';
import {projectReadiness} from '../../src/health/readiness';
import {withTransaction} from '../../src/storage/transaction';
import type {ReadinessResponse} from '../../src/http/dto';
import {fixture as configurationFixture,operator} from '../helpers/environment';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';

const root=origin+'/v2/workspaces/ws_example';
async function fixture(name:string){
 const {stub}=await installed('readiness-'+name);
 const signed=await login(stub);expect(signed.response.status).toBe(302);
 return {stub,cookie:signed.cookie};
}
async function configuredAgents(label:string,epoch=1){
 const name='readiness-'+label,material=await configurationFixture(name,epoch);
 material.config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_unused',display_name:'Unused participant'});
 material.bundle.config_digest=await sha256(canonicalJson(material.config));
 const input=await prepareBootstrap(material.config,material.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);
 const receipt=await stub.reconcileConfiguration(operator(),input);
 return {stub,name,receipt};
}
it('configuration_readiness_ignores_removed_static_agent_history',async()=>{
 const {stub,name,receipt}=await configuredAgents('agent-history'),next=await configurationFixture(name,2);
 await stub.reconcileConfiguration(operator(receipt.epoch,receipt.installationDigest),await prepareBootstrap(next.config,next.bundle,'ws_example'));
 const history=()=>runInDurableObject(stub,(_object,state)=>state.storage.sql.exec('SELECT agent_id,config_epoch FROM static_agents ORDER BY agent_id').toArray());
 const before=await history();expect(before).toEqual([{agent_id:'agent_research',config_epoch:2},{agent_id:'agent_unused',config_epoch:1}]);
 const signed=await login(stub);expect(signed.response.status).toBe(302);
 const response=await stub.fetch(new Request(root+'/readiness',{headers:{cookie:signed.cookie}}));expect(response.status).toBe(200);
 const body=await response.json() as ReadinessResponse;
 expect(body.data.checks).toContainEqual(expect.objectContaining({name:'configuration',status:'pass',code:'CONFIGURATION_CURRENT'}));
 expect(await history()).toEqual(before);
});
it.each(['missing','stale'])('configuration_readiness_fails_for_%s_configured_static_agent',async mode=>{
 const {stub}=await configuredAgents('agent-'+mode,2);
 await runInDurableObject(stub,(_object,state)=>{
  if(mode==='missing')state.storage.sql.exec("DELETE FROM static_agents WHERE agent_id='agent_unused'");
  else state.storage.sql.exec("UPDATE static_agents SET config_epoch=1 WHERE agent_id='agent_unused'");
 });
 const signed=await login(stub);expect(signed.response.status).toBe(302);
 const response=await stub.fetch(new Request(root+'/readiness',{headers:{cookie:signed.cookie}}));expect(response.status).toBe(200);
 const body=await response.json() as ReadinessResponse;expect(body.data.ready).toBe(false);
 expect(body.data.checks).toContainEqual(expect.objectContaining({name:'configuration',status:'fail',code:'AUTHORITY_EPOCH_MISMATCH'}));
});
it('live_does_not_claim_dependencies_ready',async()=>{
 const response=await app.fetch(new Request(origin+'/health/live'),{} as Env);
 expect(response.status).toBe(200);
 expect(response.headers.get('content-type')).toContain('application/json');
 expect(await response.json()).toEqual({status:'alive'});
});
it('readiness_unknown_until_actual_probe_and_read_does_not_create_receipt',async()=>{
 const f=await fixture('unknown');
 const response=await f.stub.fetch(new Request(root+'/readiness',{headers:{cookie:f.cookie}}));
 expect(response.status).toBe(200);
 const body=await response.json() as {data:{ready:boolean;checks:Array<{name:string;status:string;code:string}>}};
 expect(body.data.ready).toBe(false);
 expect(body.data.checks).toContainEqual(expect.objectContaining({name:'storage_probe',status:'unknown',code:'PROBE_NOT_RUN'}));
 await runInDurableObject(f.stub,(_object,state)=>{
  expect(state.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM probe_receipts').one().n).toBe(0);
 });
});
it('workspace_projection_uses_current_identity_and_neutral_profile',async()=>{
 const f=await fixture('workspace');
 const response=await f.stub.fetch(new Request(root,{headers:{cookie:f.cookie}}));
 expect(response.status).toBe(200);
 const body=await response.json() as {data:Record<string,unknown>};
 expect(body.data).toMatchObject({id:'ws_example',display_name:'Workspace',contract_revision:'0.1',actor:{kind:'human',principal_id:'human_operator',agent_id:null}});
 expect(Object.keys(body.data).sort()).toEqual(['actor','contract_revision','display_name','effective_scopes','id']);
 expect((body.data.effective_scopes as string[])).toContain('workspace:read');
});
it('protected_health_rejects_conflicting_native_and_expired_authority',async()=>{
 const f=await fixture('lanes');
 for(const path of ['/operations','/readiness']){
  expect((await f.stub.fetch(new Request(root+path))).status).toBe(401);
  expect((await f.stub.fetch(new Request(root+path,{headers:{authorization:'Bearer '+'A'.repeat(43)}}))).status).toBe(403);
  expect((await f.stub.fetch(new Request(root+path,{headers:{authorization:'Bearer '+'A'.repeat(43),cookie:f.cookie}}))).status).toBe(400);
 }
 await runInDurableObject(f.stub,(_object,state)=>{state.storage.sql.exec('UPDATE sessions SET expires_at=created_at+1');});
 expect((await f.stub.fetch(new Request(root+'/readiness',{headers:{cookie:f.cookie}}))).status).toBe(401);
});
it('health_never_discloses_catalog_or_secrets',async()=>{
 const f=await fixture('privacy');
 const response=await f.stub.fetch(new Request(root+'/readiness',{headers:{cookie:f.cookie}}));
 expect(response.status).toBe(200);
 const text=await response.text();
 for(const forbidden of ['workspace_catalog','object_name','token_sha256','issuer','client_secret','config_json','bundle_json','human_grants','native_credentials'])expect(text).not.toContain(forbidden);
});
async function probed(name:string,seed=false){
 const f=await recoveryFixture('health_'+name,{disableCredential:false,seed});
 const signed=await login(f.source);expect(signed.response.status).toBe(302);
 const receipt=await withRecoveryWorkspace(f,'source',async workspace=>recordProbe(workspace,await recoveryContext(workspace,'probe',{},null)));
 expect(receipt.checks.every(check=>check.passed)).toBe(true);
 return {f,cookie:signed.cookie,receipt};
}
async function diagnostics(f:Awaited<ReturnType<typeof probed>>,path='/readiness'){
 const response=await f.f.source.fetch(new Request(root+path,{headers:{cookie:f.cookie}}));
 expect(response.status).toBe(200);return await response.json() as ReadinessResponse;
}
it('actual_probe_allows_readiness_without_an_artifact_roundtrip_claim',async()=>{
 const f=await probed('actual');
 const body=await diagnostics(f);expect(body.data.ready).toBe(true);
 expect(body.data.checks).toContainEqual(expect.objectContaining({name:'storage_probe',status:'pass',code:'PROBE_CONFIRMED',checked_at:f.receipt.checked_at}));
 expect(body.data.checks).toContainEqual({name:'r2_artifacts',status:'unknown',code:'CAPABILITY_UNAVAILABLE_R1',checked_at:null});
});
it('stale_probe_becomes_unknown_without_refreshing_its_timestamp',async()=>{
 const f=await probed('stale');
 const report=await withRecoveryWorkspace(f.f,'source',w=>withTransaction(w.storage,tx=>projectReadiness(tx,{...w,secrets:env as unknown as Record<string,unknown>},Date.parse(f.receipt.checked_at)+PROBE_MAX_AGE_MS+1)));
 expect(report.ready).toBe(false);
 expect(report.checks).toContainEqual(expect.objectContaining({name:'storage_probe',status:'unknown',code:'PROBE_STALE',checked_at:f.receipt.checked_at}));
});
it('diagnostic_reads_do_not_repair_dirty_scheduling_or_publish_new_probe_evidence',async()=>{
 const f=await probed('readonly');
 await withRecoveryWorkspace(f.f,'source',w=>withTransaction(w.storage,tx=>tx.exec('UPDATE scheduler_state SET dirty=1,last_error_code=NULL WHERE id=1')));
 const snapshot=()=>withRecoveryWorkspace(f.f,'source',w=>withTransaction(w.storage,tx=>JSON.stringify(Object.fromEntries(['scheduler_state','probe_receipts','idempotency_outcomes','maintenance_state'].map(table=>[table,tx.all('SELECT * FROM '+table)])))));
 const before=await snapshot(),alarm=await runInDurableObject(f.f.source,(_object,state)=>state.storage.getAlarm());
 const health=await diagnostics(f);expect(health.data.ready).toBe(false);
 expect(health.data.checks).toContainEqual(expect.objectContaining({name:'scheduler',status:'unknown',code:'SCHEDULE_REPAIR_PENDING'}));
 await diagnostics(f,'/operations');expect(await snapshot()).toBe(before);
 expect(await runInDurableObject(f.f.source,(_object,state)=>state.storage.getAlarm())).toBe(alarm);
});
it('maintenance_diagnostics_use_current_human_authority_without_reopening_admission',async()=>{
 const f=await probed('maintenance');
 await withRecoveryWorkspace(f.f,'source',async w=>{
  const budget={max_rows:10000,max_artifacts:0 as const,max_total_bytes:16777216};
  await advanceCapture(w,await recoveryContext(w,'capture',{budget},f.f.captureId),budget);
 });
 const before=await withRecoveryWorkspace(f.f,'source',w=>withTransaction(w.storage,tx=>JSON.stringify(tx.one('SELECT * FROM maintenance_state WHERE id=1'))));
 const health=await diagnostics(f);expect(health.data.ready).toBe(false);
 expect(health.data.checks).toContainEqual(expect.objectContaining({name:'admission',status:'fail',code:'MAINTENANCE_ACTIVE'}));
 expect(health.data.checks).toContainEqual(expect.objectContaining({name:'storage_probe',status:'fail',code:'PROBE_IDENTITY_MISMATCH'}));
 await diagnostics(f,'/operations');
 expect(await withRecoveryWorkspace(f.f,'source',w=>withTransaction(w.storage,tx=>JSON.stringify(tx.one('SELECT * FROM maintenance_state WHERE id=1'))))).toBe(before);
});
it('delivery_failure_degrades_delivery_while_actual_storage_probe_remains_healthy',async()=>{
 const f=await probed('delivery',true);const body=await diagnostics(f);
 expect(body.data.ready).toBe(false);
 expect(body.data.checks).toContainEqual(expect.objectContaining({name:'delivery',status:'fail',code:'DELIVERY_FAILURES'}));
 expect(body.data.checks).toContainEqual(expect.objectContaining({name:'storage_probe',status:'pass',code:'PROBE_CONFIRMED'}));
});
it.each(['unknown','missing'])('diagnostics_report_%s_schema_without_mutating_the_mismatch',async mode=>{
 const f=await fixture('schema-'+mode);
 await runInDurableObject(f.stub,(_object,state)=>{
  if(mode==='unknown')state.storage.sql.exec('INSERT INTO schema_migrations (version,applied_at) VALUES (999,?)',Date.now());
  else state.storage.sql.exec('DELETE FROM schema_migrations WHERE version=4');
 });
 const response=await f.stub.fetch(new Request(root+'/readiness',{headers:{cookie:f.cookie}}));expect(response.status).toBe(200);
 const body=await response.json() as ReadinessResponse;expect(body.data.ready).toBe(false);
 expect(body.data.checks).toContainEqual(expect.objectContaining({name:'schema',status:'fail',code:'SCHEMA_MISMATCH'}));
});
it('missing_scheduler_observation_is_unknown_instead_of_a_manufactured_pass',async()=>{
 const f=await fixture('scheduler-missing');
 await runInDurableObject(f.stub,(_object,state)=>state.storage.sql.exec('DELETE FROM scheduler_state WHERE id=1').toArray());
 const response=await f.stub.fetch(new Request(root+'/readiness',{headers:{cookie:f.cookie}}));expect(response.status).toBe(200);
 const body=await response.json() as ReadinessResponse;
 expect(body.data.checks).toContainEqual(expect.objectContaining({name:'scheduler',status:'unknown',code:'SCHEDULE_NOT_OBSERVED'}));
 expect(body.data.ready).toBe(false);
});
