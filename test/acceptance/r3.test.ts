/** J2 actual consumed PRIVATE fixture journeys, not formal R3 acceptance. */
import {it,expect} from 'vitest';
import {productionDecisionDescriptors} from '../../src/approvals/action-registry';

import {produceR3ConsumedJourney} from '../helpers/r3-consumed-journey-fixture';
import {assertR3ConsumedObservation,encodeR3ConsumedObservation} from '../helpers/r3-consumed-journey-observation';
const consumedCases=['fresh_runtime_native_review_done','approved_cancel_before_claim','approved_credential_revoke_before_claim','consumed_failure_held','consumed_lease_expiry_held','consumed_active_restore_resume_held','done_history_restore_resume','two_workspace_decision_claim_denial'] as const;
// Fixed full inventory; each case must execute before any eight-case source claim.
for(const caseId of consumedCases)it('J2 actual consumed source journey: '+caseId,async()=>{
 expect(productionDecisionDescriptors).toEqual([]);
 const observation=await produceR3ConsumedJourney(caseId);assertR3ConsumedObservation(observation);
 expect(observation.case_id).toBe(caseId);expect(observation.acceptance_eligible).toBe(false);expect(observation.origin).toBe('local-workers-synthetic-fixture');
 if(caseId==='fresh_runtime_native_review_done'||caseId==='done_history_restore_resume'){
  if(observation.acceptance===null||observation.result===null)throw Error('J2_DONE_RESULT_REQUIRED');
  expect(observation.acceptance.reviewer_principal_id).toBe('agent_other');expect(observation.acceptance.reviewer_agent_id).toBe('agent_other');
  expect(observation.result.submitted_principal_id).toBe('agent_research');expect(observation.human_decision.principal_id).toBe('human_operator');
 }else expect(observation.acceptance).toBeNull();
 const artifact=await encodeR3ConsumedObservation(observation);expect(artifact.bytes.byteLength).toBeLessThanOrEqual(262144);
 expect(JSON.parse(new TextDecoder().decode(artifact.bytes))).toEqual(observation);expect(productionDecisionDescriptors).toEqual([]);
},180000);
