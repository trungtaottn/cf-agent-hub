import type {DecisionPolicyRequirements,DecisionPolicyResolution,VerifiedProposalInput,NativeDecisionArtifactBinding,DecisionPolicyIdentity} from '../../src/approvals/contracts';
declare const candidate:DecisionPolicyRequirements;
// @ts-expect-error pre-parse requirements are not a final eligible policy resolution
const final:DecisionPolicyResolution=candidate;
// @ts-expect-error a request-shaped verified flag does not establish module provenance
const verified:VerifiedProposalInput={verified:true};
// @ts-expect-error native generation IDs are strings, never artifact or config versions
const generation:NativeDecisionArtifactBinding={artifactId:'a',generationId:3,artifactVersion:3,sha256:'a'.repeat(64),byteLength:0,associations:[]};
// @ts-expect-error structural observations cannot construct the final opaque type
const fake:DecisionPolicyResolution={...candidate,phase:'resolved',input:{} as VerifiedProposalInput,targetBindings:[]};
void [final,verified,generation,fake];

// Standalone verified input must bind the exact policy/workspace, not only its outer result.
type Assert<T extends true>=T;
type PolicyKeys='workspaceId'|'policyVersion'|'policyCanonicalJson'|'configEpoch'|'configDigest'|'installationDigest'|'admissionGeneration';
type VerifiedPolicyBound=Assert<Exclude<PolicyKeys,keyof VerifiedProposalInput['policy']> extends never?true:false>;
declare const genuineOnlyInFuture:VerifiedProposalInput;
const exactPolicy:DecisionPolicyIdentity=genuineOnlyInFuture.policy;
// @ts-expect-error a policy version alone omits workspace/configuration/admission identity
const incompletePolicy:DecisionPolicyIdentity={policyVersion:3};
void [exactPolicy,incompletePolicy];
