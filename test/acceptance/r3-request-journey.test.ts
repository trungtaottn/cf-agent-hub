/** J1 actual command-generated PRIVATE fixture observations, not R3 acceptance. */
import {it,expect} from 'vitest';
import {productionDecisionDescriptors} from '../../src/approvals/action-registry';
import {produceR3JourneyCase} from '../helpers/r3-journey-fixture';
import {assertR3LocalObservation,encodeR3LocalObservation} from '../helpers/r3-journey-observation';
import {encodeR3SourcePacket} from '../helpers/r3-source-export-packet';
const cases=['request_pause_replay','human_approve_replay_revoked','human_reject_replay','pending_command_history_restore','rejected_command_history_restore','changed_chunk_continuation_denied'] as const;
for(const caseId of cases)it('produces actual command-source facts for '+caseId,async({task})=>{
 expect(productionDecisionDescriptors).toEqual([]);
 const observation=await produceR3JourneyCase(caseId);
 assertR3LocalObservation(observation);
 expect(observation.case_id).toBe(caseId);expect(observation.acceptance_eligible).toBe(false);
 if(caseId==='changed_chunk_continuation_denied')expect(observation.steps.find(s=>s.operation==='changed-chunk-denial')!.response).toEqual({status:null,code:'RECOVERY_CHUNK_MISMATCH'});
 const artifact=await encodeR3LocalObservation(observation);
 expect(artifact.bytes.byteLength).toBeLessThanOrEqual(262144);
 expect(JSON.parse(new TextDecoder().decode(artifact.bytes))).toEqual(observation);
 expect(productionDecisionDescriptors).toEqual([]);
 task.meta.r3SourceObservation=await encodeR3SourcePacket(caseId,artifact);
},180000);

import {runInDurableObject} from 'cloudflare:test';
import {decisionFixture} from '../helpers/decision-policy';
import {captureR3PrivateSnapshot,assertR3PrivateUnchanged} from '../helpers/r3-journey-fixture';
it('detects same-count authority mutation without putting private values into diagnostics',async()=>{
 const f=await decisionFixture('journey_private_diff');await runInDurableObject(f.stub,(_o,s)=>{
  const before=captureR3PrivateSnapshot(s.storage);
  s.storage.sql.exec("UPDATE native_credentials SET token_sha256=? WHERE credential_id='credential_research_1'",'private_synthetic_do_not_log');
  const after=captureR3PrivateSnapshot(s.storage);
  expect(()=>assertR3PrivateUnchanged(before,after)).toThrow(/^R3_PRIVATE_STATE_CHANGED$/);
 });
});
it('rejects oversized raw SQL fields before full private row materialization',async()=>{
 const f=await decisionFixture('journey_private_budget');await runInDurableObject(f.stub,(_o,s)=>{
  s.storage.sql.exec("UPDATE human_grants SET subject=? WHERE principal_id='human_operator'",'x'.repeat(65537));
  expect(()=>captureR3PrivateSnapshot(s.storage)).toThrow(/^R3_PRIVATE_SNAPSHOT_BUDGET$/);
 });
});
