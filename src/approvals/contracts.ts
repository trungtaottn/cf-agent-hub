import {parseExactJson} from './exact-json';
import {parseDecisionPolicy} from '../config/decision-policy-validation.ts';
export {parseDecisionPolicy};
export type {DecisionPolicy} from '../config/generated/validators.js';
/** No operator-reviewed product action schemas exist in this source slice. */
export function availableDecisionActions():readonly string[]{return Object.freeze([]);}
export function resolveConfiguredAction(policy:unknown,actionId:string):never{parseDecisionPolicy(policy);void actionId;throw Error('DECISION_UNAVAILABLE');}
export interface IntentBinding {
 workspaceId:string;taskId:string;approvalId:string;proposalVersion:number;approvalVersion:number;taskVersionAtApproval:number;retryCountAtApproval:number;originalExpiresAt:number;
 actionId:string;schemaVersion:number;schemaSha256:string;inputArtifactId:string;
 /** Historical synthetic diagnostic counter, NOT native generation.id provenance. */
 inputGeneration:number;inputSha256:string;
 policyVersion:number;policyEpoch:number;targetVersions:ReadonlyArray<{kind:string;id:string;version:number}>;
}
export interface NoEffectObservation {kind:'authoritative-no-dispatch'|'authoritative-provider-no-effect';reference:string;binding:IntentBinding;runId:string;fence:number;complete:true;}
export interface AttemptObservation {runId:string;fence:number;taskVersionBeforeClaim:number;taskVersionAfterClaim:number;taskVersionAfterEnd:number;status:'failed'|'expired'|'active'|'submitted';effect:'no-effect'|'effected'|'unknown';evidence:NoEffectObservation|null;}
export interface ReuseObservation {
 approved:IntentBinding;current:IntentBinding;approvalStatus:'approved'|'pending'|'rejected'|'expired';expiresAt:number;nowMs:number;
 expectedTaskVersion:number;currentTaskVersion:number;currentApprovalVersion:number;currentProposalVersion:number;
 retryCount:number;retryLimit:number;activeRunId:string|null;nextRunId:string;nextFence:number;priorAttempts:ReadonlyArray<AttemptObservation>;
}
const positive=(x:unknown):x is number=>Number.isSafeInteger(x)&&Number(x)>0;
const id=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&new TextEncoder().encode(x).length<=128;
const hash=(x:unknown):x is string=>typeof x==='string'&&x.length===64&&/^[a-f0-9]+$/.test(x);
function bindingKey(x:IntentBinding):string|null {
 if(!x||!Number.isSafeInteger(x.retryCountAtApproval)||x.retryCountAtApproval<0||x.retryCountAtApproval>10||![x.workspaceId,x.taskId,x.approvalId,x.actionId,x.inputArtifactId].every(id)||![x.proposalVersion,x.approvalVersion,x.taskVersionAtApproval,x.schemaVersion,x.inputGeneration,x.policyVersion,x.policyEpoch,x.originalExpiresAt].every(positive)||!hash(x.schemaSha256)||!hash(x.inputSha256)||!Array.isArray(x.targetVersions)||x.targetVersions.length>64)return null;
 const targets=x.targetVersions.map(t=>t&&id(t.kind)&&id(t.id)&&positive(t.version)?[t.kind,t.id,t.version]:null);if(targets.some(t=>t===null))return null;
 const keys=targets.map(t=>JSON.stringify(t!.slice(0,2)));if(new Set(keys).size!==keys.length)return null;
 return JSON.stringify([x.workspaceId,x.taskId,x.approvalId,x.proposalVersion,x.approvalVersion,x.taskVersionAtApproval,x.retryCountAtApproval,x.originalExpiresAt,x.actionId,x.schemaVersion,x.schemaSha256,x.inputArtifactId,x.inputGeneration,x.inputSha256,x.policyVersion,x.policyEpoch,targets.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}
/** Pure diagnostic model over synthetic/repository observations, NOT authentication or a permit.
 * Empty diagnostics does not verify provenance, current grants, or external no-effect evidence.
 * There is deliberately no runtime consumer or observation-to-authority factory. */
export function reuseDenials(o:ReuseObservation):string[] {
 const failures=new Set<string>(),deny=(s:string)=>failures.add(s),approved=bindingKey(o.approved);
 if(!approved||approved!==bindingKey(o.current))deny('BINDING_CHANGED');
 if(o.expiresAt!==o.approved.originalExpiresAt)deny('EXPIRY_RENEWED');
 if(o.approvalStatus!=='approved')deny('NOT_APPROVED');
 if(!Number.isSafeInteger(o.nowMs)||o.nowMs<0||!positive(o.expiresAt)||o.expiresAt>8640000000000000||o.nowMs>=o.expiresAt)deny('EXPIRED');
 if(!positive(o.expectedTaskVersion)||o.expectedTaskVersion!==o.currentTaskVersion||o.currentApprovalVersion!==o.approved.approvalVersion||o.currentProposalVersion!==o.approved.proposalVersion)deny('VERSION_MISMATCH');
 if(o.activeRunId!==null||!id(o.nextRunId)||!positive(o.nextFence))deny('FRESH_ATTEMPT_REQUIRED');
 if(!Array.isArray(o.priorAttempts)||o.priorAttempts.length===0||o.priorAttempts.length>10)return [...failures,'MISSING_OR_EXCESS_HISTORY'];
 if(!Number.isSafeInteger(o.retryLimit)||o.retryLimit<1||o.retryLimit>10||o.retryCount!==o.approved.retryCountAtApproval+o.priorAttempts.length||o.retryCount>o.retryLimit)deny('RETRY_BUDGET');
 let version=o.approved.taskVersionAtApproval,fence=0;const runs=new Set<string>();
 for(const a of o.priorAttempts){
  if(!id(a.runId)||runs.has(a.runId)||a.runId===o.nextRunId||!positive(a.fence)||a.fence<=fence)deny('FRESH_ATTEMPT_REQUIRED');runs.add(a.runId);fence=a.fence;
  if(a.taskVersionBeforeClaim!==version||a.taskVersionAfterClaim!==version+1||a.taskVersionAfterEnd!==version+2||!positive(a.taskVersionAfterEnd))deny('LIFECYCLE_DRIFT');version=a.taskVersionAfterEnd;
  const e=a.evidence;
  if(!['failed','expired'].includes(a.status)||a.effect!=='no-effect'||!e||!['authoritative-no-dispatch','authoritative-provider-no-effect'].includes(e.kind)||!id(e.reference)||e.complete!==true||e.runId!==a.runId||e.fence!==a.fence||bindingKey(e.binding)!==approved)deny('NO_EFFECT_UNPROVEN');
 }
 if(version!==o.currentTaskVersion)deny('LIFECYCLE_DRIFT');if(o.nextFence<=fence)deny('FRESH_ATTEMPT_REQUIRED');
 return [...failures];
}
export interface DecisionArtifact {id:string;bytes:number;sha256:string;generation:number;}
/** Structural accounting only; actual committed bytes/access/retention are later verifier obligations. */
export function accountDecisionArtifacts(checkpoint:readonly DecisionArtifact[],proposal:readonly DecisionArtifact[],input:DecisionArtifact):{distinctCount:number;totalBytes:number}{
 const all=new Map<string,DecisionArtifact>();
 for(const list of [checkpoint,proposal,[input]]){
  if(!Array.isArray(list)||list.length>5||new TextEncoder().encode(JSON.stringify(list.map(a=>a.id))).length>8192)throw Error('INVALID_ASSOCIATIONS');
  const seen=new Set<string>();for(const a of list){if(!a||!id(a.id)||!hash(a.sha256)||!positive(a.generation)||!Number.isSafeInteger(a.bytes)||a.bytes<0||a.bytes>10485760||seen.has(a.id))throw Error('INVALID_ASSOCIATIONS');seen.add(a.id);const prior=all.get(a.id);if(prior&&(prior.bytes!==a.bytes||prior.sha256!==a.sha256||prior.generation!==a.generation))throw Error('INVALID_ASSOCIATIONS');all.set(a.id,a);}
 }
 const totalBytes=[...all.values()].reduce((n,a)=>n+a.bytes,0);if(all.size>5||totalBytes>26214400)throw Error('INVALID_ASSOCIATIONS');return {distinctCount:all.size,totalBytes};
}

/** Finite policy arithmetic only; never renew an existing approval with this helper. */
export function decisionExpiry(nowMs:number,seconds:number):number{
 const expires=nowMs+seconds*1000;if(!Number.isSafeInteger(nowMs)||nowMs<0||!positive(seconds)||!Number.isSafeInteger(expires)||expires>8640000000000000||expires<=nowMs)throw Error('INVALID_DECISION_EXPIRY');return expires;
}
/** Exact-byte content inspection only, NOT VerifiedProposalInput or artifact authority. */
export async function inspectProposalBytes(bytes:Uint8Array,mime:string):Promise<Readonly<{sha256:string;byteLength:number;value:unknown}>>{
 if(mime!=='application/json')throw Error('INVALID_PROPOSAL_MIME');
 if(!(bytes instanceof Uint8Array)||bytes.byteLength>10485760)throw Error('INVALID_PROPOSAL_BYTES');
 const snapshot=new Uint8Array(bytes),value=parseExactJson(snapshot,{maxBytes:10485760,maxDepth:64,maxNodes:100000});
 const stack:unknown[]=[value];while(stack.length){const x=stack.pop();if(x&&typeof x==='object'){for(const v of Object.values(x))if(v&&typeof v==='object')stack.push(v);Object.freeze(x);}}
 const digest=await crypto.subtle.digest('SHA-256',snapshot),sha256=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
 return Object.freeze({sha256,byteLength:snapshot.byteLength,value});
}

/** Native metadata identity, not the historical numeric inputGeneration diagnostic. */
export interface NativeDecisionArtifactBinding {
 readonly artifactId:string;readonly generationId:string;readonly artifactVersion:number;
 readonly sha256:string;readonly byteLength:number;
 readonly associations:ReadonlyArray<Readonly<{kind:string;id:string}>>;
}
/** Pure equality diagnostic only. Neither operand proves committed bytes or access. */
export function sameNativeArtifactBinding(a:NativeDecisionArtifactBinding,b:NativeDecisionArtifactBinding):boolean {
 const key=(x:NativeDecisionArtifactBinding):string|null=>{
  if(!x||!id(x.artifactId)||!id(x.generationId)||!positive(x.artifactVersion)||!hash(x.sha256)||!Number.isSafeInteger(x.byteLength)||x.byteLength<0||x.byteLength>10485760||!Array.isArray(x.associations)||x.associations.length>2048)return null;
  const edges=x.associations.map(e=>e&&id(e.kind)&&id(e.id)?JSON.stringify([e.kind,e.id]):null);
  if(edges.some(e=>e===null)||new Set(edges).size!==edges.length)return null;
  return JSON.stringify([x.artifactId,x.generationId,x.artifactVersion,x.sha256,x.byteLength,edges.sort()]);
 };
 const left=key(a);return left!==null&&left===key(b);
}
export interface DecisionTaskReference {readonly taskId:string;readonly taskVersion:number;}
export interface DecisionDescriptorIdentity {
 readonly actionId:string;readonly schemaVersion:number;readonly schemaSha256:string;
 /** Changes whenever extraction, scope, target/version interpretation or effect boundary changes. */
 readonly semanticRevision:string;
}
export interface DecisionReviewerRequirements {
 readonly principalId:string;readonly configEpoch:number;
 readonly scopes:readonly string[];readonly projectIds:readonly string[]|null;
}
/** Current SQL requirements only. Input resource IDs have NOT been interpreted or authorized.
 * These candidates are not an assignment, a final eligible resolution, or mutation authority. */
export interface DecisionPolicyRequirements extends DecisionDescriptorIdentity {
 readonly phase:'requirements-only';readonly requestedBy:Readonly<{kind:'agent';principalId:string;credentialId:string}>;readonly workspaceId:string;readonly taskId:string;readonly taskVersion:number;readonly taskProposalVersion:number;
 readonly projectId:string|null;readonly proposalCanonicalJson:string;readonly checkpointCanonicalJson:string|null;
 readonly configEpoch:number;readonly configDigest:string;readonly installationDigest:string;readonly admissionGeneration:number;
 readonly policyVersion:number;readonly policyCanonicalJson:string;
 /** Provisional candidate freshness only, NEVER admitted approval timestamps. */
 readonly resolvedAt:number;readonly expiresAt:number;
 readonly resourceKinds:readonly string[];readonly reviewerIds:readonly string[];readonly reviewers:readonly DecisionReviewerRequirements[];
 readonly artifacts:readonly NativeDecisionArtifactBinding[];
}
export interface DecisionTargetBinding {readonly kind:string;readonly id:string;readonly version:number;readonly projectId:string|null;}
// Compile-time brands remain private. input-binding-source owns runtime WeakMap
// provenance; structural casts/deserialization never establish membership.
declare const verifiedProposalInput:unique symbol;
declare const finalDecisionPolicy:unique symbol;
export type ReadonlyDecisionJson=null|boolean|number|string|readonly ReadonlyDecisionJson[]|{readonly [key:string]:ReadonlyDecisionJson};
export interface DecisionArtifactEdge {readonly role:'checkpoint'|'proposal'|'input';readonly artifact:NativeDecisionArtifactBinding;}
/** Exact installed policy/workspace identity; also required on standalone verified input.
 * Later private minting/rechecks must enforce equality with the final resolution. */
export interface DecisionPolicyIdentity {
 readonly workspaceId:string;readonly policyVersion:number;readonly policyCanonicalJson:string;
 readonly configEpoch:number;readonly configDigest:string;readonly installationDigest:string;readonly admissionGeneration:number;
}
export interface VerifiedProposalInput {
 readonly [verifiedProposalInput]:true;readonly policy:DecisionPolicyIdentity;readonly artifact:NativeDecisionArtifactBinding;
 readonly descriptor:DecisionDescriptorIdentity;readonly byteLength:number;readonly sha256:string;
 readonly value:ReadonlyDecisionJson;readonly targetBindings:readonly DecisionTargetBinding[];
}
/** Inherited resolvedAt/expiresAt remain candidate freshness, not admitted approval time.
 * Current evidence only: never a reusable run, fence or external-effect permit. */
export interface DecisionPolicyResolution extends Omit<DecisionPolicyRequirements,'phase'> {
 readonly [finalDecisionPolicy]:true;readonly phase:'resolved';readonly input:VerifiedProposalInput;
 readonly artifactEdges:readonly DecisionArtifactEdge[];
 readonly targetBindings:readonly DecisionTargetBinding[];
}
