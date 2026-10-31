import type {DecisionDescriptorIdentity} from './contracts';
/** Source-owned interpretation, NEVER supplied by config, HTTP, headers or environment.
 * Future activation must additionally supply reviewed exact-input target extraction and effects.
 * validateInput is a closed shape predicate, not final provenance or permission. */
export interface DecisionActionDescriptor extends DecisionDescriptorIdentity {
 readonly resourceKinds:readonly string[];
 readonly actorScopes:readonly string[];readonly reviewerScopes:readonly string[];
 readonly validateInput:(value:unknown)=>boolean;
}
/** Deliberately empty. ExampleApprovalInputs and native command names are not actions. */
export const productionDecisionDescriptors:readonly DecisionActionDescriptor[]=Object.freeze([]);
