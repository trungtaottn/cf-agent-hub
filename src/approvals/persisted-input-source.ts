/** Internal composition: stored JSON is provenance, never execution evidence. */
import type {AuthWorkspace} from '../auth/context';
import {currentConfiguration} from '../auth/context';
import {resolveActor} from '../auth/authorize';
import {referenceBudget,assertResourceReferences,actorResourceGrant,type ReferenceBudget} from '../auth/resource-visibility';
import {artifactRecord,committedGeneration,authorizeArtifactRead} from '../artifacts/repository';
import {canonicalJson} from '../config/bootstrap';
import {settingsPolicy} from '../config/policy';
import {withTransaction,assertTransactionStorage,type WorkspaceTransaction} from '../storage/transaction';
import {taskRecord} from '../tasks/repository';
import {runRecord} from '../tasks/lease';
import type {DecisionActionDescriptor} from './action-registry';
import {createPolicyRequirementsLookup,currentReviewer} from './policy-source';
import {inspectProposalBytes,decisionExpiry,type ReadonlyDecisionJson} from './contracts';
import {parsePersistedBinding,parseReviewerIds} from './stored-validation';
import {approvalRecord,assertDecisionHead,type ProposalRow} from './repository';
import type {ProposalInputContext} from './input-binding-source';
function unavailable():never{throw Error('DECISION_UNAVAILABLE');}
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const equal=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
// Cleanup must not become a new await or disclose provider errors.
function discard(action:()=>unknown):void{try{void Promise.resolve(action()).catch(()=>{});}catch{}}
function synchronousOutput(value:unknown):unknown{if(value instanceof Promise)discard(()=>value);return value;}
const MAX_BYTES=10485760,READ_SIZE=65536,OPERATION_MS=30000;
type Target={kind:string;id:string;version:number};
function targetSnapshot(value:unknown):readonly Target[]{
 if(!Array.isArray(value)||value.length>64)unavailable();
 const arrayFields=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(value).length!==value.length+1)unavailable();
 const targets:Target[]=[];
 for(let index=0;index<value.length;index++){
  const entry=arrayFields[String(index)];if(!entry||!('value'in entry))unavailable();const item:unknown=entry.value;
  if(!item||typeof item!=='object'||Array.isArray(item)||Reflect.ownKeys(item).some(key=>typeof key!=='string')||Object.getOwnPropertyNames(item).sort().join(',')!=='id,kind,version')unavailable();
  const fields=Object.getOwnPropertyDescriptors(item);
  if(['kind','id','version'].some(key=>!fields[key]||!('value'in fields[key])))unavailable();
  const {kind,id,version}=item as Target;
  if(typeof kind!=='string'||!kind||kind.length>128||typeof id!=='string'||!id||id.length>128||new TextEncoder().encode(id).length>128||!Number.isSafeInteger(version)||version<=0)unavailable();
  targets.push({kind,id,version});
 }
 return freeze(targets);
}
function pin(ctx:ProposalInputContext){
 const workspaceRef=ctx.workspace,storage=workspaceRef.storage,clockRef=workspaceRef.clock,now=clockRef.nowMs.bind(clockRef),bucket=ctx.bucket;
 if(!bucket)unavailable();
 const workspace:AuthWorkspace={storage,workspaceId:workspaceRef.workspaceId,objectName:workspaceRef.objectName,secrets:workspaceRef.secrets,entropy:workspaceRef.entropy,clock:{nowMs:now}};
 const identity=freeze(structuredClone(ctx.identity)),admission=freeze({...ctx.admission});
 if(identity.workspaceId!==workspace.workspaceId)unavailable();
 return {workspaceRef,storage,clockRef,workspace,now,bucket,identity,admission,requestId:ctx.requestId,signal:ctx.signal};
}
type Pinned=ReturnType<typeof pin>;
/** 30s async wait/cancellation bound, NOT preemptive CPU wall time or approval TTL.
 * Deployed Workers clocks can freeze until I/O. Deterministic read/guard/reference
 * budgets independently bound immediate-resolving work; pending I/O needs timers/cancel. */
class Invocation {
 private stopped=false;private reject!:(reason:Error)=>void;private readonly end:Promise<never>;private readonly timer:ReturnType<typeof setTimeout>;
 private readonly abort=()=>this.stop();private readonly started:number;
 constructor(private readonly pinned:Pinned){
  this.started=pinned.now();this.end=new Promise<never>((_,reject)=>{this.reject=reject;});void this.end.catch(()=>{});
  this.timer=setTimeout(()=>this.stop(),OPERATION_MS);pinned.signal?.addEventListener('abort',this.abort,{once:true});if(pinned.signal?.aborted)this.stop();
 }
 private stop(){if(!this.stopped){this.stopped=true;this.reject(Error('DECISION_UNAVAILABLE'));}}
 check(){const now=this.pinned.now();if(this.stopped||!Number.isSafeInteger(now)||now<this.started||now-this.started>=OPERATION_MS){this.stop();unavailable();}}
 async wait<T>(promise:Promise<T>,late?:(value:T)=>void):Promise<T>{
  // Observe both outcomes immediately. Late get completion can only cancel bytes.
  const observed=promise.then(value=>{if(this.stopped){try{late?.(value);}catch{}unavailable();}return value;});
  void observed.catch(()=>{});this.check();const value=await Promise.race([observed,this.end]);this.check();return value;
 }
 close(){clearTimeout(this.timer);this.pinned.signal?.removeEventListener('abort',this.abort);this.stopped=true;}
}
export type PersistedLane='human'|'claim';
/** This object has no serializable authority; only closure membership admits it. */
export interface PersistedDecisionEvidence {readonly kind:'persisted-decision-evidence';}
export function createPersistedInputVerifier(descriptors:readonly DecisionActionDescriptor[]){
 const source=Object.freeze(descriptors.map(d=>Object.freeze({...d,resourceKinds:Object.freeze([...d.resourceKinds]),actorScopes:Object.freeze([...d.actorScopes]),reviewerScopes:Object.freeze([...d.reviewerScopes])})));
 // Validate source-owned descriptor shapes without resolving any requester actor.
 createPolicyRequirementsLookup(source);
 function read(tx:WorkspaceTransaction,p:Pinned,id:string,lane:PersistedLane,budget:ReferenceBudget){
  const now=p.now();if(!Number.isSafeInteger(now)||now<0)unavailable();
  currentConfiguration(tx,p.workspace,p.admission);const actor=resolveActor(tx,p.identity,now);
  if(lane==='human'?actor.kind!=='human':lane!=='claim'||actor.kind!=='agent'||!actor.credentialId)unavailable();
  const approval=approvalRecord(tx,actor.workspaceId,id),task=taskRecord(tx,actor.workspaceId,approval.task_id),head=assertDecisionHead(tx,task,approval,now);
  if(![approval.approval_version,approval.proposal_version,approval.task_version_at_request,task.task_version,head.transition_count].every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isSafeInteger(approval.created_at)||!Number.isSafeInteger(approval.expires_at)||now<approval.created_at||now>=approval.expires_at||approval.consumed_run_id!==null||approval.consumed_fence!==null)unavailable();
  if(approval.expiry_hold_code!==null)unavailable();
  if(lane==='human'?(approval.status!=='pending'||task.state!=='waiting'):(approval.status!=='approved'||task.state!=='ready'))unavailable();
  if(task.active_run_id!==null)unavailable();
  const paused=runRecord(tx,actor.workspaceId,approval.run_id);
  if(paused.task_id!==task.id||task.latest_run_id!==paused.id||paused.status!=='paused'||paused.ended_at!==approval.created_at||!Number.isSafeInteger(paused.fence)||paused.fence<1||!Number.isSafeInteger(paused.run_version)||paused.run_version<1)unavailable();
  const stored=tx.one<ProposalRow>('SELECT * FROM decision_proposals WHERE workspace_id=? AND id=?',[actor.workspaceId,approval.proposal_id]);if(!stored)unavailable();
  const binding=parsePersistedBinding(stored.binding_json),proposal=JSON.parse(binding.proposalCanonicalJson),checkpoint=tx.one<{run_id:string;task_id:string;checkpoint_json:string}>('SELECT run_id,task_id,checkpoint_json FROM decision_checkpoints WHERE workspace_id=? AND id=?',[actor.workspaceId,approval.checkpoint_id]);
  if(stored.task_id!==task.id||stored.proposal_version!==approval.proposal_version||task.proposal_version!==approval.proposal_version||binding.workspaceId!==actor.workspaceId||binding.taskId!==task.id||binding.taskVersion!==approval.task_version_at_request||binding.taskProposalVersion+1!==approval.proposal_version||stored.proposal_json!==binding.proposalCanonicalJson||!checkpoint||checkpoint.task_id!==task.id||checkpoint.run_id!==approval.run_id||checkpoint.checkpoint_json!==binding.checkpointCanonicalJson||binding.resolvedAt>approval.created_at||approval.created_at>=binding.expiresAt)unavailable();
  const descriptor=source.find(d=>d.actionId===binding.actionId);if(!descriptor||descriptor.schemaVersion!==binding.schemaVersion||descriptor.schemaSha256!==binding.schemaSha256||descriptor.semanticRevision!==binding.semanticRevision||!equal([...descriptor.resourceKinds].sort(),binding.resourceKinds))unavailable();
  const required=lane==='human'?['approvals:read','approvals:decide','tasks:read','artifacts:read',...descriptor.reviewerScopes]:['tasks:claim','tasks:execute','tasks:read','artifacts:read',...descriptor.actorScopes];
  if(!required.every(scope=>actor.scopes.has(scope)))unavailable();
  const assigned=parseReviewerIds(approval.reviewer_ids_json);if(!equal(assigned,binding.reviewerIds)||lane==='human'&&!assigned.includes(actor.principalId))unavailable();
  const {config,policy,epoch}=settingsPolicy(tx,actor),metadata=tx.one<{config_digest:string;installation_digest:string}>('SELECT config_digest,installation_digest FROM workspace_metadata WHERE id=1');
  if(!policy.decision_policy||canonicalJson(policy.decision_policy)!==binding.policyCanonicalJson||epoch!==binding.configEpoch||metadata?.config_digest!==binding.configDigest||metadata?.installation_digest!==binding.installationDigest||p.admission.maintenanceGeneration!==binding.admissionGeneration||decisionExpiry(approval.created_at,policy.decision_policy.expiry_seconds)!==approval.expires_at)unavailable();
  const roots=[{kind:'task' as const,id:task.id},...binding.artifacts.map(a=>({kind:'artifact' as const,id:a.artifactId})),...binding.targetBindings.map(t=>({kind:'task' as const,id:t.id}))];
  assertResourceReferences(tx,actorResourceGrant(actor),roots,budget);
  const reviewers=binding.reviewerIds.map(principalId=>{
   const r=currentReviewer(tx,actor.workspaceId,principalId,epoch,config.human_grants.find(g=>g.workspace_id===actor.workspaceId&&g.principal_id===principalId),['approvals:read','approvals:decide','tasks:read','artifacts:read',...descriptor.reviewerScopes]);
   assertResourceReferences(tx,r.grant,roots,budget);return r.evidence;
  });if(!equal(reviewers,binding.reviewers))unavailable();
  for(const target of binding.targetBindings){const row=taskRecord(tx,actor.workspaceId,target.id);if(row.project_id!==target.projectId||(target.id===task.id?target.version!==binding.taskVersion:row.task_version!==target.version))unavailable();}
  const artifacts=binding.artifacts.map(a=>{
   authorizeArtifactRead(tx,{actor,nowMs:now},a.artifactId,budget);
   const row=artifactRecord(tx,actor.workspaceId,a.artifactId),generation=committedGeneration(tx,row),associations=tx.all<{resource_kind:string;resource_id:string}>('SELECT resource_kind,resource_id FROM artifact_associations WHERE workspace_id=? AND artifact_id=? ORDER BY resource_kind,resource_id LIMIT 2049',[actor.workspaceId,a.artifactId]);
   if(row.artifact_version!==a.artifactVersion||row.sha256!==a.sha256||row.byte_size!==a.byteLength||generation.id!==a.generationId||!equal(associations.map(e=>({kind:e.resource_kind,id:e.resource_id})),a.associations))unavailable();return {row,generation,associations};
  });
  const edges=tx.all<{role:string;artifact_id:string;generation_id:string;artifact_version:number;sha256:string;byte_size:number}>('SELECT role,artifact_id,generation_id,artifact_version,sha256,byte_size FROM decision_artifact_edges WHERE workspace_id=? AND approval_id=? ORDER BY role,artifact_id LIMIT 12',[actor.workspaceId,id]);
  const expected=binding.artifactEdges.map(e=>({role:e.role,artifact_id:e.artifact.artifactId,generation_id:e.artifact.generationId,artifact_version:e.artifact.artifactVersion,sha256:e.artifact.sha256,byte_size:e.artifact.byteLength}));
  if(!equal(edges.map(canonicalJson).sort(),expected.map(canonicalJson).sort()))unavailable();
  return {actor,approval,task,head,binding,stored,checkpoint,paused,artifacts,edges,descriptor};
 }
 type State=ReturnType<typeof read>;
 type Receipt={pinned:Pinned;id:string;lane:PersistedLane;state:State;mode:'bytes'|'metadata'};
 const receipts=new WeakMap<object,Receipt>();
 const snapshot=({actor:_,descriptor:__,...state}:State)=>state;
 function current(tx:WorkspaceTransaction,r:Receipt,budget:ReferenceBudget):State{
  const state=read(tx,r.pinned,r.id,r.lane,budget);if(!equal(snapshot(state),snapshot(r.state)))unavailable();return state;
 }
 async function verifyPersistedDecisionInput(ctx:ProposalInputContext,id:string,lane:PersistedLane):Promise<PersistedDecisionEvidence>{
  let invocation:Invocation|undefined,reader:(ReadableStreamBYOBReader&{readAtLeast(n:number,view:Uint8Array):Promise<{done:boolean;value?:Uint8Array}>})|undefined,body:ReadableStream<Uint8Array>|undefined;
  try{
   const pinned=pin(ctx),budget=referenceBudget();invocation=new Invocation(pinned);const op=invocation;
   const state=withTransaction(pinned.storage,tx=>read(tx,pinned,id,lane,budget)),receipt:Receipt={pinned,id,lane,state,mode:'bytes'};
   const proposal=JSON.parse(state.binding.proposalCanonicalJson),selected=state.artifacts.find(a=>a.row.id===proposal.inputs.artifact_id);if(!selected)unavailable();
   const expected=selected.row.byte_size,maxReads=Math.ceil(expected/READ_SIZE)+1;let guards=0;
   const guard=()=>{op.check();if(++guards>4*maxReads+16)unavailable();withTransaction(pinned.storage,tx=>current(tx,receipt,budget));op.check();};
   guard();const object=await op.wait(pinned.bucket.get(selected.generation.object_key),late=>{if(late)discard(()=>late.body.cancel());});
   if(!object)unavailable();body=object.body;guard();
   if(object.size!==expected||expected<0||expected>MAX_BYTES||object.httpMetadata?.contentEncoding)unavailable();
   try{reader=body.getReader({mode:'byob'}) as typeof reader;}catch{unavailable();}
   if(!reader||typeof reader.readAtLeast!=='function')unavailable();
   const bytes=new Uint8Array(expected);let offset=0,reads=0;
   while(true){
    if(++reads>maxReads)unavailable();guard();const minimum=Math.min(READ_SIZE,expected-offset)||1;
    const result=await op.wait(reader.readAtLeast(minimum,new Uint8Array(minimum)));guard();
    if(typeof result.done!=='boolean')unavailable();const chunk=result.value;if(chunk!==undefined&&!(chunk instanceof Uint8Array))unavailable();const size=chunk?.byteLength??0;
    if(size>expected-offset||!result.done&&size===0||size<minimum&&!result.done)unavailable();
    if(size){bytes.set(chunk!,offset);offset+=size;}if(result.done){if(offset!==expected)unavailable();break;}
    if(reads%8===0){guard();await op.wait(scheduler.wait(0));guard();}
   }
   guard();const inspected=await op.wait(inspectProposalBytes(bytes,selected.row.media_type));guard();
   if(inspected.byteLength!==expected||inspected.sha256!==selected.row.sha256||inspected.sha256!==proposal.inputs.sha256||synchronousOutput(state.descriptor.validateInput(inspected.value))!==true)unavailable();
   const targets=targetSnapshot(synchronousOutput(state.descriptor.extractInputTargets(inspected.value as ReadonlyDecisionJson)));
   if(!equal(targets.map(t=>canonicalJson(t)).sort(),state.binding.targetBindings.map(({projectId:_,...t})=>canonicalJson(t)).sort()))unavailable();
   guard();await op.wait(scheduler.wait(0));guard();const evidence=Object.freeze({kind:'persisted-decision-evidence' as const});receipts.set(evidence,receipt);return evidence;
  }catch{return unavailable();}finally{invocation?.close();if(reader){discard(()=>reader!.cancel());try{reader.releaseLock();}catch{}}else if(body)discard(()=>body!.cancel());}
 }
 function recheck(tx:WorkspaceTransaction,ctx:ProposalInputContext,id:string,evidence:object,mode:'bytes'|'metadata'):State{
  try{
   const r=receipts.get(evidence);if(!r||r.mode!==mode)unavailable();const p=r.pinned;assertTransactionStorage(tx,p.storage);
   if(id!==r.id||ctx.workspace!==p.workspaceRef||ctx.workspace.storage!==p.storage||ctx.workspace.clock!==p.clockRef||ctx.workspace.workspaceId!==p.workspace.workspaceId||ctx.workspace.objectName!==p.workspace.objectName||ctx.bucket!==p.bucket||!equal(ctx.identity,p.identity)||!equal(ctx.admission,p.admission))unavailable();
   return current(tx,r,referenceBudget());
  }catch{return unavailable();}
 }
 function verifyPersistedDecisionMetadata(ctx:ProposalInputContext,id:string):PersistedDecisionEvidence{
  try{const pinned=pin(ctx),state=withTransaction(pinned.storage,tx=>read(tx,pinned,id,'human',referenceBudget())),evidence=Object.freeze({kind:'persisted-decision-evidence' as const});receipts.set(evidence,{pinned,id,lane:'human',state,mode:'metadata'});return evidence;}catch{return unavailable();}
 }
 const recheckPersistedDecisionInput=(tx:WorkspaceTransaction,ctx:ProposalInputContext,id:string,evidence:object)=>recheck(tx,ctx,id,evidence,'bytes');
 const recheckPersistedDecisionMetadata=(tx:WorkspaceTransaction,ctx:ProposalInputContext,id:string,evidence:object)=>recheck(tx,ctx,id,evidence,'metadata');
 return Object.freeze({verifyPersistedDecisionInput,recheckPersistedDecisionInput,verifyPersistedDecisionMetadata,recheckPersistedDecisionMetadata});
}
