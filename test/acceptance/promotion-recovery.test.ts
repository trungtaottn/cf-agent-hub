import {it,expect} from 'vitest';
import {readinessFromResponse,assertCompatibleRollback,assertDeployedBuild} from '../../src/health/promotion';
import {recoveryFixture,captureFixture,restoreFixture,withRecoveryWorkspace,recoveryContext,fixtureIntegrity} from '../helpers/recovery-fixture';
import {withTransaction} from '../../src/storage/transaction';
import {assertAdmissionOpen} from '../../src/recovery/maintenance';
import {recordProbe} from '../../src/recovery/probes';
import {resolveDelivery,retireWorkspace,resumeWorkspace} from '../../src/recovery/controls';
import {signRecord} from '../../src/recovery/manifest';
import type {CutoverRecord} from '../../src/recovery/protocol';
import {origin} from '../helpers/auth';
const now=Date.parse('2026-10-25T05:00:00.000Z');
function ready(){return {request_id:'synthetic_readiness',data:{observed_at:new Date(now).toISOString(),ready:true,checks:[
 ...['schema','configuration','authentication_keys','cursor_key','recovery_binding','admission','storage_probe','scheduler_probe','scheduler','delivery'].map(name=>({name,status:'pass',code:name.endsWith('_probe')?'PROBE_CONFIRMED':'OBSERVED',checked_at:new Date(now-1000).toISOString()})),
 {name:'r2_artifacts',status:'unknown',code:'CAPABILITY_UNAVAILABLE_R1',checked_at:null}
]}};}
it('challenge_is_not_readiness',()=>{for(const status of [302,401,403,503])expect(()=>readinessFromResponse(status,ready(),now)).toThrow();});
it('readiness_false_unknown_or_missing_probe_cannot_promote',()=>{for(const mutate of [(x:any)=>{x.data.ready=false;},(x:any)=>{x.data.checks=x.data.checks.filter((c:any)=>c.name!=='storage_probe');},(x:any)=>{x.data.checks.find((c:any)=>c.name==='storage_probe').status='unknown';},(x:any)=>{x.data.checks.find((c:any)=>c.name==='storage_probe').checked_at=new Date(now-300001).toISOString();}]){const value=ready();mutate(value);expect(()=>readinessFromResponse(200,value,now)).toThrow();}});
it('matching_readiness_keeps_r2_artifacts_explicitly_unavailable',()=>{expect(readinessFromResponse(200,ready(),now).ready).toBe(true);});
it('rollback_rejects_incompatible_schema',()=>{for(const code of [{minimum_schema:1,maximum_schema:6,authority_contract:1},{minimum_schema:7,maximum_schema:7,authority_contract:0}])expect(()=>assertCompatibleRollback(code,{schema_version:7,authority_contract:1,config_epoch:4},4)).toThrow();});
it('rollback_never_reduces_live_authority_epoch',()=>{expect(()=>assertCompatibleRollback({minimum_schema:7,maximum_schema:7,authority_contract:1},{schema_version:7,authority_contract:1,config_epoch:4},3)).toThrow();});
it('compatible_previous_code_preserves_live_schema_and_epoch',()=>{expect(()=>assertCompatibleRollback({minimum_schema:7,maximum_schema:7,authority_contract:1},{schema_version:7,authority_contract:1,config_epoch:4},4)).not.toThrow();});
it('deployed_bytes_match_reviewed_candidate',()=>{expect(()=>assertDeployedBuild('a'.repeat(64),'b'.repeat(64))).toThrow();expect(()=>assertDeployedBuild('claimed','claimed')).toThrow();expect(()=>assertDeployedBuild('a'.repeat(64),'a'.repeat(64))).not.toThrow();});
it('restored_authority_is_not_resurrected_after_actual_retirement_and_resume',async()=>{
 const f=await recoveryFixture('promotion_authority');
 const oldFence=await withRecoveryWorkspace(f,'source',w=>withTransaction(w.storage,tx=>assertAdmissionOpen(tx)));
 const capture=await captureFixture(f,{evict:true}),restored=await restoreFixture(f,capture,{evict:true});
 const retired=await withRecoveryWorkspace(f,'source',async w=>retireWorkspace(w,await recoveryContext(w,'retire',{},f.captureId)));
 const cutover=await signRecord<CutoverRecord>({id:'promotion_cutover',capture_id:f.captureId,workspace_id:'ws_example',source_environment_id:'fixture_source',source_authority_epoch:oldFence.authorityEpoch,target_environment_id:'fixture_target',target_authority_epoch:f.anchor.authorityEpoch,source_retirement_receipt_id:retired.id,target_catalog_mapping:{workspace_id:'ws_example',object_name:f.targetName},cutover_at:new Date().toISOString(),auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 await withRecoveryWorkspace(f,'target',async w=>{
  const resolution={delivery_id:'delivery_fixture',disposition:'failed_without_redrive' as const,evidence_sha256:'e'.repeat(64)};
  await resolveDelivery(w,await recoveryContext(w,'resolve-delivery',resolution,f.captureId,{anchor:f.anchor}),resolution);
  await recordProbe(w,await recoveryContext(w,'probe',{},null,{anchor:f.anchor}));
  const input={receipt_id:restored.receipt!.id,ledger:f.ledger,source_retirement_receipt:retired,cutover_record:cutover};
  await resumeWorkspace(w,await recoveryContext(w,'resume',input,f.captureId,{anchor:f.anchor}),input);
  withTransaction(w.storage,tx=>{
   expect(assertAdmissionOpen(tx).authorityEpoch).toBeGreaterThan(oldFence.authorityEpoch);
   expect(()=>assertAdmissionOpen(tx,oldFence)).toThrow('STALE_ADMISSION_FENCE');
   expect(tx.one<{enabled:number;config_epoch:number}>('SELECT enabled,config_epoch FROM native_credentials')).toEqual({enabled:0,config_epoch:2});
   expect(tx.one<{enabled:number}>('SELECT enabled FROM human_grants')!.enabled).toBe(0);
   expect(tx.one<{revoked_at:number|null}>('SELECT revoked_at FROM sessions WHERE id=?',['session_fixture'])!.revoked_at).not.toBeNull();
  });
 });
 // Admission is now open: these denials prove current authority, rather than
 // merely relying on the temporary maintenance barrier to hide old tokens.
 const base=origin+'/v2/workspaces/ws_example';
 expect((await f.target.fetch(new Request(base,{headers:{authorization:'Bearer '+'A'.repeat(43)}}))).status).toBe(401);
 expect((await f.target.fetch(new Request(base+'/auth/session',{headers:{cookie:'cfhub_session='+'A'.repeat(43)}}))).status).toBe(401);
 await withRecoveryWorkspace(f,'source',w=>withTransaction(w.storage,tx=>expect(()=>assertAdmissionOpen(tx)).toThrow('ADMISSION_CLOSED')));
},60000);
