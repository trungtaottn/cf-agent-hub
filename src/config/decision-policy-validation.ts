import {validateDecisionPolicyShape,type DecisionPolicy} from './generated/validators.js';
/** Pure canonical structural validation shared by Workers and raw Node provisioning CLI.
 * Installation never registers an action, callback, input schema or permission. */
export function parseDecisionPolicy(input:unknown):DecisionPolicy {
 if(!validateDecisionPolicyShape(input)||new TextEncoder().encode(JSON.stringify(input)).length>65536)throw Error('INVALID_DECISION_POLICY');
 const seen=new Set<string>();for(const action of input.actions){if(seen.has(action.action_id))throw Error('INVALID_DECISION_POLICY');seen.add(action.action_id);}
 return structuredClone(input);
}
