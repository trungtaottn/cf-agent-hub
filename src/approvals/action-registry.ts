import type {DecisionDescriptorIdentity,ReadonlyDecisionJson} from './contracts';
/** Source-owned interpretation, NEVER supplied by config, HTTP, headers or environment.
 * Future activation must additionally supply reviewed product schemas and effects.
 * validateInput is a closed shape predicate, not final provenance or permission. */
export interface DecisionActionDescriptor extends DecisionDescriptorIdentity {
 readonly resourceKinds:readonly string[];
 readonly actorScopes:readonly string[];readonly reviewerScopes:readonly string[];
 readonly validateInput:(value:unknown)=>boolean;
 readonly extractInputTargets:(value:ReadonlyDecisionJson)=>readonly {kind:string;id:string;version:number}[];
}
/** Deliberately empty. ExampleApprovalInputs and native command names are not actions. */
export const productionDecisionDescriptors:readonly DecisionActionDescriptor[]=Object.freeze([]);
