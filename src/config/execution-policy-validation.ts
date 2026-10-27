import {validateExecutionPolicyShape,type ExecutionPolicy} from './generated/validators.js';
/** Pure canonical validation shared with the raw Node provisioning CLI; no Worker imports. */
/** Structural and exact-tuple checks. This is policy validation, never an actor grant. */
export function parseExecutionPolicy(input:unknown):ExecutionPolicy{
 if(!validateExecutionPolicyShape(input))throw Error('INVALID_EXECUTION_POLICY');
 const tuples=new Set<string>(),replayTuples=new Set<string>(),ruleIds=new Set<string>();
 for(const rule of input.eligibility_rules){const key=JSON.stringify([rule.project_id,rule.work_role_id]);if(tuples.has(key))throw Error('INVALID_EXECUTION_POLICY');tuples.add(key);}
 for(const rule of input.replay_safety_rules){const key=JSON.stringify([rule.project_id,rule.work_role_id]);if(replayTuples.has(key)||ruleIds.has(rule.id))throw Error('INVALID_EXECUTION_POLICY');replayTuples.add(key);ruleIds.add(rule.id);}
 if(!Number.isSafeInteger(input.policy_version))throw Error('INVALID_EXECUTION_POLICY');
 return structuredClone(input);
}
