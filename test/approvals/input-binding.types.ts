import type {VerifiedProposalInput,DecisionPolicyRequirements,DecisionPolicyResolution,NativeDecisionArtifactBinding,DecisionPolicyIdentity} from '../../src/approvals/contracts';
import type {ProposalInputContext} from '../../src/approvals/input-binding';
declare const requirements:DecisionPolicyRequirements;
// @ts-expect-error requirements-only is never final resolution
const resolution:DecisionPolicyResolution=requirements;
// @ts-expect-error a public verified flag cannot mint private provenance
const input:VerifiedProposalInput={verified:true};
// @ts-expect-error native generation identity remains string, never numeric artifact/version counters
const artifact:NativeDecisionArtifactBinding={artifactId:'input',generationId:1,artifactVersion:3,sha256:'a'.repeat(64),byteLength:0,associations:[]};
// @ts-expect-error incomplete installed policy cannot bind a verified input
const policy:DecisionPolicyIdentity={workspaceId:'ws_example',policyVersion:3};
// @ts-expect-error JSON observations cannot supply verified native identity or SQL workspace
const context:ProposalInputContext={identity:{principalId:'agent'},workspace:'ws_example',bucketKey:'caller-key'};
void [resolution,input,artifact,policy,context];
