import {productionDecisionDescriptors} from './action-registry';
import {createPolicyRequirementsLookup} from './policy-source';
/** Fixed source registry. No caller-supplied registry/config callback is accepted. */
export const lookupPolicyRequirements=createPolicyRequirementsLookup(productionDecisionDescriptors);
