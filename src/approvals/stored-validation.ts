/** Closed bounded stored-data validators. Passing these proves SHAPE, never authority. */
import {parseExactJson} from './exact-json';
import {parseDecisionPolicy} from './contracts';
import {checkpointSnapshot,proposalSnapshot} from './policy-source';
import {canonicalJson} from '../config/bootstrap';
import type {DecisionPolicyResolution} from './contracts';
import type {Actor} from '../http/dto';
export type PersistedDecisionBinding=Omit<DecisionPolicyResolution,'input'>;
export const DECISION_BINDING_BYTES=1048576,DECISION_ANCHOR_BYTES=1048576,DECISION_REVIEWERS_BYTES=16384,DECISION_ACTOR_BYTES=1024;
const encoder=new TextEncoder();
function bad():never{throw Error('DECISION_UNAVAILABLE');}
function obj(v:unknown,keys:string):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.split(',').sort().join(','))bad();return v as Record<string,unknown>;}
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&encoder.encode(v).length<=128;
const integer=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const nullableId=(v:unknown)=>v===null||id(v);
function array(v:unknown,max:number):unknown[]{if(!Array.isArray(v)||v.length>max)bad();return v;}
function ids(v:unknown,max=64):string[]{const a=array(v,max);if(!a.every(id)||new Set(a).size!==a.length)bad();return a as string[];}
function parse(text:string,max:number):unknown{if(typeof text!=='string'||encoder.encode(text).length>max)bad();try{return parseExactJson(encoder.encode(text),{maxBytes:max,maxDepth:16,maxNodes:100000});}catch{return bad();}}
function artifact(value:unknown):void{
 const a=obj(value,'artifactId,generationId,artifactVersion,sha256,byteLength,associations');
 if(!id(a.artifactId)||!id(a.generationId)||!integer(a.artifactVersion,1)||!hash(a.sha256)||!integer(a.byteLength)||a.byteLength>10485760)bad();
 const edges=array(a.associations,2048);for(const edge of edges){const e=obj(edge,'kind,id');if(!['task','run','message','result','checkpoint'].includes(String(e.kind))||!id(e.id))bad();}
 if(new Set(edges.map(canonicalJson)).size!==edges.length)bad();
}
export function parseReviewerIds(text:string):readonly string[]{const result=ids(parse(text,DECISION_REVIEWERS_BYTES));if(!result.length)bad();return result;}
export function parseDecisionActor(text:string):Actor{
 const a=obj(parse(text,DECISION_ACTOR_BYTES),'kind,principal_id,agent_id');
 if(!['human','agent'].includes(String(a.kind))||!id(a.principal_id)||!nullableId(a.agent_id)||(a.kind==='human')!==(a.agent_id===null))bad();return a as Actor;
}
export function parseSemanticAnchor(text:string):Readonly<{id:string;workspace_id:string;title:string;description:string;project_id:string|null;work_role_id:string|null;assigned_agent_id:string|null;retry_limit:number;created_at:number}>{
 const a=obj(parse(text,DECISION_ANCHOR_BYTES),'id,workspace_id,title,description,project_id,work_role_id,assigned_agent_id,retry_limit,created_at');
 if(!id(a.id)||!id(a.workspace_id)||typeof a.title!=='string'||typeof a.description!=='string'||!nullableId(a.project_id)||!nullableId(a.work_role_id)||!nullableId(a.assigned_agent_id)||!integer(a.retry_limit)||!integer(a.created_at))bad();
 return a as ReturnType<typeof parseSemanticAnchor>;
}
export function parsePersistedBinding(text:string):PersistedDecisionBinding{
 const r=obj(parse(text,DECISION_BINDING_BYTES),'phase,requestedBy,workspaceId,taskId,taskVersion,taskProposalVersion,projectId,proposalCanonicalJson,checkpointCanonicalJson,actionId,schemaVersion,schemaSha256,semanticRevision,resourceKinds,configEpoch,configDigest,installationDigest,admissionGeneration,policyVersion,policyCanonicalJson,resolvedAt,expiresAt,reviewerIds,reviewers,artifacts,artifactEdges,targetBindings');
 if(r.phase!=='resolved'||!id(r.workspaceId)||!id(r.taskId)||!integer(r.taskVersion,1)||!integer(r.taskProposalVersion)||!nullableId(r.projectId)||!id(r.actionId)||!integer(r.schemaVersion,1)||!hash(r.schemaSha256)||!id(r.semanticRevision)||!integer(r.configEpoch,1)||!hash(r.configDigest)||!hash(r.installationDigest)||!integer(r.admissionGeneration)||!integer(r.policyVersion,1)||!integer(r.resolvedAt)||!integer(r.expiresAt)||r.expiresAt<=r.resolvedAt)bad();
 const requester=obj(r.requestedBy,'kind,principalId,credentialId');if(requester.kind!=='agent'||!id(requester.principalId)||!id(requester.credentialId))bad();
 if(typeof r.proposalCanonicalJson!=='string'||typeof r.checkpointCanonicalJson!=='string'||typeof r.policyCanonicalJson!=='string')bad();
 const proposal=proposalSnapshot(parse(r.proposalCanonicalJson,65536) as never),checkpoint=checkpointSnapshot(parse(r.checkpointCanonicalJson,65536) as never),policy=parseDecisionPolicy(parse(r.policyCanonicalJson,65536));
 if(canonicalJson(proposal)!==r.proposalCanonicalJson||canonicalJson(checkpoint)!==r.checkpointCanonicalJson||canonicalJson(policy)!==r.policyCanonicalJson||proposal.action!==r.actionId||proposal.scope.project_id!==r.projectId||policy.policy_version!==r.policyVersion)bad();
 const kinds=ids(r.resourceKinds),reviewerIds=ids(r.reviewerIds);if(!kinds.length||!reviewerIds.length)bad();
 const reviewers=array(r.reviewers,64);for(const reviewer of reviewers){const v=obj(reviewer,'principalId,configEpoch,scopes,projectIds');if(!id(v.principalId)||!integer(v.configEpoch,1)||v.configEpoch!==r.configEpoch)bad();ids(v.scopes,128);if(v.projectIds!==null)ids(v.projectIds,10000);}
 if(canonicalJson(reviewers.map(v=>(v as {principalId:string}).principalId))!==canonicalJson(reviewerIds))bad();
 const artifacts=array(r.artifacts,5);artifacts.forEach(artifact);if(new Set(artifacts.map(v=>(v as {artifactId:string}).artifactId)).size!==artifacts.length||artifacts.reduce<number>((n,a)=>n+(a as {byteLength:number}).byteLength,0)>26214400)bad();
 const edges=array(r.artifactEdges,11);for(const edge of edges){const e=obj(edge,'role,artifact');if(!['checkpoint','proposal','input'].includes(String(e.role)))bad();artifact(e.artifact);if(!artifacts.some(a=>canonicalJson(a)===canonicalJson(e.artifact)))bad();}
 const expected=[...checkpoint.artifact_ids.map(id=>['checkpoint',id]),...proposal.artifact_ids.map(id=>['proposal',id]),['input',proposal.inputs.artifact_id]].map(canonicalJson).sort();
 const actual=edges.map(e=>{const x=e as {role:string;artifact:{artifactId:string}};return canonicalJson([x.role,x.artifact.artifactId]);}).sort();if(canonicalJson(actual)!==canonicalJson(expected))bad();
 if(canonicalJson(artifacts.map(a=>(a as {artifactId:string}).artifactId).sort())!==canonicalJson([...new Set(edges.map(e=>(e as {artifact:{artifactId:string}}).artifact.artifactId))].sort()))bad();
 const selected=artifacts.find(a=>(a as {artifactId:string}).artifactId===proposal.inputs.artifact_id) as {sha256:string}|undefined;if(!selected||selected.sha256!==proposal.inputs.sha256)bad();
 const targets=array(r.targetBindings,64);for(const target of targets){const t=obj(target,'kind,id,version,projectId');if(t.kind!=='task'||!kinds.includes('task')||!id(t.id)||!integer(t.version,1)||!nullableId(t.projectId)||t.projectId!==r.projectId)bad();}
 const targetIds=targets.map(t=>(t as {id:string}).id);if(new Set(targetIds).size!==targets.length||canonicalJson([...targetIds].sort())!==canonicalJson([...proposal.scope.resource_ids].sort()))bad();
 return r as unknown as PersistedDecisionBinding;
}
/** Closed lifecycle shape only; current approval/run/actor/expiry remain separate guards. */
export function validDecisionTransition(kind:string,before:string,after:string):boolean {
 if(kind==='cancel')return ['backlog','ready','doing','waiting','review'].includes(before)&&after==='cancelled';
 const transitions:Readonly<Record<string,readonly string[]>>={request:['doing>waiting'],approve:['waiting>ready'],reject:['waiting>backlog'],claim:['ready>doing'],failure:['doing>waiting'],lease_expiry:['doing>waiting'],submit:['doing>review'],accept:['review>done'],expiry:['waiting>waiting','ready>waiting']};
 return Object.hasOwn(transitions,kind)&&transitions[kind].includes(before+'>'+after);
}
