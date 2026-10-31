/** Package-internal trusted composition. Only policy.ts is the runtime entrypoint.
 * Isolated tests compose source-owned synthetic descriptors here; deployment parsing
 * never imports them and public policy data cannot provide functions or registries. */
import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import type {Proposal,Checkpoint,MessageReference} from '../http/dto';
import {refreshActor} from '../auth/authorize';
import {assertResourceReferences,actorResourceGrant,referenceBudget,type ReferenceBudget,type ResourceGrant} from '../auth/resource-visibility';
import {settingsPolicy} from '../config/policy';
import {canonicalJson} from '../config/bootstrap';
import {assertAdmissionOpen} from '../recovery/maintenance';
import {taskRecord,taskVisible} from '../tasks/repository';
import {artifactRecord,committedGeneration} from '../artifacts/repository';
import type {DecisionActionDescriptor} from './action-registry';
import {decisionExpiry,type DecisionPolicyRequirements,type DecisionTaskReference,type DecisionReviewerRequirements,type NativeDecisionArtifactBinding,type DecisionTargetBinding} from './contracts';
function unavailable():never {throw Error('DECISION_UNAVAILABLE');}
const positive=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>0;
const identifier=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=128&&new TextEncoder().encode(s).length<=128;
const digest=(s:unknown):s is string=>typeof s==='string'&&s.length===64&&/^[a-f0-9]{64}$/.test(s);
const strings=(x:unknown):x is string[]=>Array.isArray(x)&&x.every(identifier)&&new Set(x).size===x.length;
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const keys=(x:Record<string,unknown>,expected:string)=>Object.keys(x).sort().join(',')===expected;
function freeze<T>(value:T):T {
 if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;
}
export function proposalSnapshot(value:Proposal):Proposal {
 if(!record(value)||!keys(value,'action,artifact_ids,inputs,scope,summary')||typeof value.summary!=='string'||!value.summary||value.summary.length>65536||!identifier(value.action)||!Array.isArray(value.artifact_ids)||value.artifact_ids.length>5||!strings(value.artifact_ids)||!record(value.scope)||!keys(value.scope,'project_id,resource_ids')||value.scope.project_id!==null&&!identifier(value.scope.project_id)||!Array.isArray(value.scope.resource_ids)||value.scope.resource_ids.length>64||!strings(value.scope.resource_ids)||!record(value.inputs)||!keys(value.inputs,'artifact_id,sha256')||!identifier(value.inputs.artifact_id)||!digest(value.inputs.sha256)||new TextEncoder().encode(canonicalJson(value)).length>65536)unavailable();
 return structuredClone(value);
}
export function checkpointSnapshot(value:Checkpoint):Checkpoint {
 if(!record(value)||!keys(value,'artifact_ids,summary')||typeof value.summary!=='string'||!value.summary||value.summary.length>65536||!Array.isArray(value.artifact_ids)||value.artifact_ids.length>5||!strings(value.artifact_ids)||new TextEncoder().encode(canonicalJson(value.artifact_ids)).length>8192)unavailable();
 return structuredClone(value);
}
interface HumanRow {workspace_id:string;principal_id:string;issuer:string;subject:string;enabled:number;config_epoch:number;scopes_json:string;project_ids_json:string;}
function currentReviewer(tx:WorkspaceTransaction,workspaceId:string,principalId:string,epoch:number,configured:{issuer:string;subject:string;enabled:boolean;scopes:readonly string[];project_ids:readonly string[]|null}|undefined,required:readonly string[]):{grant:ResourceGrant;evidence:DecisionReviewerRequirements} {
 const row=tx.one<HumanRow>('SELECT * FROM human_grants WHERE workspace_id=? AND principal_id=?',[workspaceId,principalId]);
 if(!configured||!configured.enabled||!row||row.enabled!==1||row.workspace_id!==workspaceId||row.principal_id!==principalId||row.config_epoch!==epoch||row.issuer!==configured.issuer||row.subject!==configured.subject)unavailable();
 const scopes:unknown=JSON.parse(row.scopes_json),projects:unknown=JSON.parse(row.project_ids_json);
 if(!strings(scopes)||projects!==null&&!strings(projects))unavailable();
 // A relational row can narrow but never broaden exact installed human authority.
 const effectiveScopes=scopes.filter(scope=>configured.scopes.includes(scope)).sort();
 if(!required.every(scope=>effectiveScopes.includes(scope)))unavailable();
 const configuredProjects=configured.project_ids;
 const effectiveProjects=configuredProjects===null?projects as string[]|null:projects===null?[...configuredProjects]:(projects as string[]).filter(project=>configuredProjects.includes(project));
 const projectIds=effectiveProjects===null?null:[...effectiveProjects].sort();
 return {grant:{workspaceId,kind:'human',id:principalId,scopes:new Set(effectiveScopes),projectIds},evidence:{principalId,configEpoch:epoch,scopes:effectiveScopes,projectIds}};
}
export interface PolicyRequirementsLookup {
 (tx:WorkspaceTransaction,actor:ActorContext,task:DecisionTaskReference,proposal:Proposal,nowMs:number,checkpoint?:Checkpoint,budget?:ReferenceBudget):DecisionPolicyRequirements;
 /** Candidate freshness only, NOT a final-resolution or VerifiedProposalInput predicate. */
 readonly assertCurrent:(tx:WorkspaceTransaction,actor:ActorContext,task:DecisionTaskReference,proposal:Proposal,nowMs:number,expected:DecisionPolicyRequirements,checkpoint?:Checkpoint,budget?:ReferenceBudget)=>void;
 readonly assertInputTargetsCurrent:(tx:WorkspaceTransaction,actor:ActorContext,proposal:Proposal,requirements:DecisionPolicyRequirements,targets:readonly {kind:string;id:string;version:number}[],budget?:ReferenceBudget)=>readonly DecisionTargetBinding[];
}
export function createPolicyRequirementsLookup(descriptors:readonly DecisionActionDescriptor[]):PolicyRequirementsLookup {
 // Capture source identities/arrays once. A mutable caller object cannot change an installed interpretation.
 const registry=new Map<string,DecisionActionDescriptor>();
 for(const descriptor of descriptors){
  if(!identifier(descriptor.actionId)||!positive(descriptor.schemaVersion)||!digest(descriptor.schemaSha256)||!identifier(descriptor.semanticRevision)||!strings(descriptor.resourceKinds)||descriptor.resourceKinds.length===0||descriptor.resourceKinds.length>64||!strings(descriptor.actorScopes)||!strings(descriptor.reviewerScopes)||typeof descriptor.validateInput!=='function'||typeof descriptor.extractInputTargets!=='function'||registry.has(descriptor.actionId))unavailable();
  registry.set(descriptor.actionId,Object.freeze({...descriptor,resourceKinds:Object.freeze([...descriptor.resourceKinds].sort()),actorScopes:Object.freeze([...descriptor.actorScopes]),reviewerScopes:Object.freeze([...descriptor.reviewerScopes])}));
 }
 const lookup=(tx:WorkspaceTransaction,actor:ActorContext,task:DecisionTaskReference,proposal:Proposal,nowMs:number,checkpoint?:Checkpoint,budget=referenceBudget()):DecisionPolicyRequirements=>{
  try {
   if(!Number.isSafeInteger(nowMs)||nowMs<0||!task||!identifier(task.taskId)||!positive(task.taskVersion))unavailable();
   const fence=assertAdmissionOpen(tx),live=refreshActor(tx,actor,nowMs);
   if(live.kind!=='agent'||!live.credentialId)unavailable();
   const {config,policy,epoch}=settingsPolicy(tx,live),selection=policy.decision_policy,p=proposalSnapshot(proposal),descriptor=registry.get(p.action);
   const configuredAction=selection?.actions.find(action=>action.action_id===p.action);
   if(!selection||!descriptor||!configuredAction||configuredAction.schema_version!==descriptor.schemaVersion||configuredAction.schema_sha256!==descriptor.schemaSha256||canonicalJson([...configuredAction.resource_kinds].sort())!==canonicalJson(descriptor.resourceKinds))unavailable();
   const metadata=tx.one<{config_digest:string;installation_digest:string}>('SELECT config_digest,installation_digest FROM workspace_metadata WHERE id=1');
   if(!metadata||!digest(metadata.config_digest)||!digest(metadata.installation_digest)||epoch!==fence.authorityEpoch)unavailable();
   const taskRow=taskRecord(tx,live.workspaceId,task.taskId);
   if(taskRow.task_version!==task.taskVersion||!taskVisible(live,taskRow)||taskRow.project_id!==p.scope.project_id||!['tasks:execute','tasks:read','artifacts:read',...descriptor.actorScopes].every(scope=>live.scopes.has(scope)))unavailable();
   const cp=checkpoint===undefined?null:checkpointSnapshot(checkpoint);
   for(const role of [p.artifact_ids,[p.inputs.artifact_id],cp?.artifact_ids??[]])if(new TextEncoder().encode(canonicalJson(role)).length>8192)unavailable();
   if(cp&&new TextEncoder().encode(canonicalJson({checkpoint:cp,proposal:p})).length>65536)unavailable();
   const ids=[...new Set([...(cp?.artifact_ids??[]),...p.artifact_ids,p.inputs.artifact_id])];if(ids.length>5)unavailable();
   const roots:MessageReference[]=[{kind:'task',id:task.taskId},...ids.map(id=>({kind:'artifact' as const,id}))];
   assertResourceReferences(tx,actorResourceGrant(live),roots,budget);
   const reviewers:DecisionReviewerRequirements[]=[],reviewerIds=[...configuredAction.reviewer_ids].sort();
   if(reviewerIds.length===0)unavailable();
   for(const principalId of reviewerIds){
    const configured=config.human_grants.find(grant=>grant.workspace_id===live.workspaceId&&grant.principal_id===principalId);
    const current=currentReviewer(tx,live.workspaceId,principalId,epoch,configured,['approvals:read','approvals:decide','tasks:read','artifacts:read',...descriptor.reviewerScopes]);
    assertResourceReferences(tx,current.grant,roots,budget);reviewers.push(current.evidence);
   }
   let total=0;
   const artifacts:NativeDecisionArtifactBinding[]=ids.sort().map(id=>{
    const row=artifactRecord(tx,live.workspaceId,id),generation=committedGeneration(tx,row);
    if(!positive(row.artifact_version)||!identifier(generation.id)||!digest(row.sha256)||!Number.isSafeInteger(row.byte_size)||row.byte_size<0||row.byte_size>10485760)unavailable();
    if(id===p.inputs.artifact_id&&(row.sha256!==p.inputs.sha256||row.media_type!=='application/json'))unavailable();
    const edges=tx.all<{resource_kind:string;resource_id:string}>('SELECT resource_kind,resource_id FROM artifact_associations WHERE workspace_id=? AND artifact_id=? ORDER BY resource_kind,resource_id LIMIT 2049',[live.workspaceId,id]);
    if(edges.length>2048)unavailable();total+=row.byte_size;
    return {artifactId:id,generationId:generation.id,artifactVersion:row.artifact_version,sha256:row.sha256,byteLength:row.byte_size,associations:edges.map(edge=>({kind:edge.resource_kind,id:edge.resource_id}))};
   });
   if(total>26214400)unavailable();
   return freeze({phase:'requirements-only',requestedBy:{kind:'agent',principalId:live.principalId,credentialId:live.credentialId},workspaceId:live.workspaceId,taskId:taskRow.id,taskVersion:taskRow.task_version,taskProposalVersion:taskRow.proposal_version,projectId:taskRow.project_id,proposalCanonicalJson:canonicalJson(p),checkpointCanonicalJson:cp===null?null:canonicalJson(cp),actionId:descriptor.actionId,schemaVersion:descriptor.schemaVersion,schemaSha256:descriptor.schemaSha256,semanticRevision:descriptor.semanticRevision,resourceKinds:[...descriptor.resourceKinds],configEpoch:epoch,configDigest:metadata.config_digest,installationDigest:metadata.installation_digest,admissionGeneration:fence.maintenanceGeneration,policyVersion:selection.policy_version,policyCanonicalJson:canonicalJson(selection),resolvedAt:nowMs,expiresAt:decisionExpiry(nowMs,selection.expiry_seconds),reviewerIds,reviewers,artifacts});
  }catch{ return unavailable(); }
 };
 const assertCurrent=(tx:WorkspaceTransaction,actor:ActorContext,task:DecisionTaskReference,proposal:Proposal,nowMs:number,expected:DecisionPolicyRequirements,checkpoint?:Checkpoint,budget=referenceBudget()):void=>{
  try {
   if(expected.phase!=='requirements-only'||!Number.isSafeInteger(expected.resolvedAt)||nowMs<expected.resolvedAt||nowMs>=expected.expiresAt)unavailable();
   const current=lookup(tx,actor,task,proposal,nowMs,checkpoint,budget);
   if(expected.expiresAt!==decisionExpiry(expected.resolvedAt,(current.expiresAt-current.resolvedAt)/1000))unavailable();
   // Do not renew the original candidate deadline when rereading current SQL.
   const binding=({resolvedAt:_,expiresAt:__,...identity}:DecisionPolicyRequirements)=>identity;
   if(canonicalJson(binding(current))!==canonicalJson(binding(expected)))unavailable();
  }catch{unavailable();}
 };
 const assertInputTargetsCurrent:PolicyRequirementsLookup['assertInputTargetsCurrent']=(tx,actor,proposal,requirements,targets,budget=referenceBudget())=>{
  try{
   const descriptor=registry.get(requirements.actionId);if(!descriptor||targets.length>64)unavailable();
   const ids=new Set<string>(),bindings:DecisionTargetBinding[]=[];
   for(const target of targets){
    if(!record(target)||!keys(target,'id,kind,version')||target.kind!=='task'||!descriptor.resourceKinds.includes(target.kind)||!identifier(target.id)||!positive(target.version)||ids.has(target.id))unavailable();
    ids.add(target.id);const row=taskRecord(tx,actor.workspaceId,target.id);
    if(row.task_version!==target.version||row.project_id!==proposal.scope.project_id)unavailable();
    bindings.push({kind:target.kind,id:target.id,version:row.task_version,projectId:row.project_id});
   }
   if(canonicalJson([...ids].sort())!==canonicalJson([...proposal.scope.resource_ids].sort()))unavailable();
   const roots=bindings.map(target=>({kind:'task' as const,id:target.id}));
   assertResourceReferences(tx,actorResourceGrant(actor),roots,budget);
   const {config,epoch}=settingsPolicy(tx,actor);
   for(const principalId of requirements.reviewerIds){
    const configured=config.human_grants.find(grant=>grant.workspace_id===actor.workspaceId&&grant.principal_id===principalId);
    const current=currentReviewer(tx,actor.workspaceId,principalId,epoch,configured,['approvals:read','approvals:decide','tasks:read','artifacts:read',...descriptor.reviewerScopes]);
    assertResourceReferences(tx,current.grant,roots,budget);
   }
   return freeze(bindings);
  }catch{return unavailable();}
 };
 return Object.freeze(Object.assign(lookup,{assertCurrent,assertInputTargetsCurrent}));
}
