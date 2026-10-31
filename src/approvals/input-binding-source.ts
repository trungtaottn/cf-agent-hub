/** Package-internal source composition, not a public registry or deserializer.
 * No routes consume this inactive unit. Runtime provenance belongs only to this closure. */
import type {ArtifactOperationContext} from '../artifacts/content';
import type {AuthWorkspace} from '../auth/context';
import {currentConfiguration} from '../auth/context';
import {resolveActor} from '../auth/authorize';
import {referenceBudget,type ReferenceBudget} from '../auth/resource-visibility';
import {artifactRecord,committedGeneration,authorizeArtifactRead} from '../artifacts/repository';
import {canonicalJson} from '../config/bootstrap';
import type {Checkpoint,Proposal} from '../http/dto';
import {withTransaction,assertTransactionStorage,type WorkspaceTransaction} from '../storage/transaction';
import type {DecisionActionDescriptor} from './action-registry';
import {createPolicyRequirementsLookup,checkpointSnapshot,proposalSnapshot} from './policy-source';
import {inspectProposalBytes,type DecisionTaskReference,type VerifiedProposalInput,type DecisionPolicyResolution,type DecisionPolicyRequirements,type DecisionTargetBinding,type DecisionArtifactEdge,type ReadonlyDecisionJson} from './contracts';
export type ProposalInputContext=Pick<ArtifactOperationContext,'workspace'|'identity'|'requestId'|'admission'|'bucket'>&{readonly signal?:AbortSignal};
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
function intent(task:DecisionTaskReference,checkpoint:Checkpoint,proposal:Proposal){
 if(!task||Object.keys(task).sort().join(',')!=='taskId,taskVersion'||typeof task.taskId!=='string'||!task.taskId||task.taskId.length>128||new TextEncoder().encode(task.taskId).length>128||!Number.isSafeInteger(task.taskVersion)||task.taskVersion<=0)unavailable();
 const cp=checkpointSnapshot(checkpoint),p=proposalSnapshot(proposal);
 if(new TextEncoder().encode(canonicalJson({checkpoint:cp,proposal:p})).length>65536)unavailable();
 return freeze({task:{taskId:task.taskId,taskVersion:task.taskVersion},checkpoint:cp,proposal:p});
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
type CapturedIntent=ReturnType<typeof intent>;
function artifacts(tx:WorkspaceTransaction,pinned:Pinned,requirements:DecisionPolicyRequirements){
 return requirements.artifacts.map(binding=>{
  const row=artifactRecord(tx,pinned.workspace.workspaceId,binding.artifactId),generation=committedGeneration(tx,row);
  const edges=tx.all('SELECT * FROM artifact_associations WHERE workspace_id=? AND artifact_id=? ORDER BY resource_kind,resource_id LIMIT 2049',[pinned.workspace.workspaceId,row.id]);
  if(edges.length>2048)unavailable();
  return {row,generation,edges};
 });
}
type CapturedArtifacts=ReturnType<typeof artifacts>;
interface Receipt {pinned:Pinned;intent:CapturedIntent;requirements:DecisionPolicyRequirements;artifacts:CapturedArtifacts;targets:readonly Target[];bindings:readonly DecisionTargetBinding[];edges:readonly DecisionArtifactEdge[];}
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
export function createProposalInputVerifier(descriptors:readonly DecisionActionDescriptor[]){
 const source=Object.freeze(descriptors.map(d=>Object.freeze({...d,resourceKinds:Object.freeze([...d.resourceKinds]),actorScopes:Object.freeze([...d.actorScopes]),reviewerScopes:Object.freeze([...d.reviewerScopes])}))),lookup=createPolicyRequirementsLookup(source);
 const inputs=new WeakMap<object,Receipt>(),resolutions=new WeakSet<object>();
 function current(tx:WorkspaceTransaction,receipt:Receipt,budget:ReferenceBudget){
  const {pinned:p,intent:i}=receipt,now=p.now();currentConfiguration(tx,p.workspace,p.admission);const actor=resolveActor(tx,p.identity,now);
  lookup.assertCurrent(tx,actor,i.task,i.proposal,now,receipt.requirements,i.checkpoint,budget);
  if(!equal(artifacts(tx,p,receipt.requirements),receipt.artifacts))unavailable();
  if(receipt.targets.length){const bindings=lookup.assertInputTargetsCurrent(tx,actor,i.proposal,receipt.requirements,receipt.targets,budget);if(!equal(bindings,receipt.bindings))unavailable();}
 }
 async function verifyProposalInput(ctx:ProposalInputContext,task:DecisionTaskReference,checkpoint:Checkpoint,proposal:Proposal):Promise<VerifiedProposalInput>{
  let invocation:Invocation|undefined,reader:(ReadableStreamBYOBReader&{readAtLeast(n:number,view:Uint8Array):Promise<{done:boolean;value?:Uint8Array}>})|undefined,body:ReadableStream<Uint8Array>|undefined;
  try{
   const pinned=pin(ctx),i=intent(task,checkpoint,proposal),budget=referenceBudget();invocation=new Invocation(pinned);const op=invocation;
   const receipt=withTransaction(pinned.storage,tx=>{
    op.check();const now=pinned.now();currentConfiguration(tx,pinned.workspace,pinned.admission);const actor=resolveActor(tx,pinned.identity,now),requirements=lookup(tx,actor,i.task,i.proposal,now,i.checkpoint,budget);
    for(const binding of requirements.artifacts)authorizeArtifactRead(tx,{actor,nowMs:now},binding.artifactId,budget);
    const captured=artifacts(tx,pinned,requirements),edges:DecisionArtifactEdge[]=[];
    for(const [role,ids] of [['checkpoint',i.checkpoint.artifact_ids],['proposal',i.proposal.artifact_ids],['input',[i.proposal.inputs.artifact_id]]] as const)for(const id of ids)edges.push({role,artifact:requirements.artifacts.find(a=>a.artifactId===id)!});
    return {pinned,intent:i,requirements,artifacts:captured,targets:[] as readonly Target[],bindings:[] as readonly DecisionTargetBinding[],edges:freeze(edges)};
   });
   const selected=receipt.artifacts.find(a=>a.row.id===i.proposal.inputs.artifact_id)!;if(!selected)unavailable();
   const expected=selected.row.byte_size,maxReads=Math.ceil(expected/READ_SIZE)+1;let guards=0;
   const guard=()=>{op.check();if(++guards>4*maxReads+16)unavailable();withTransaction(pinned.storage,tx=>current(tx,receipt,budget));op.check();};
   guard();const object=await op.wait(pinned.bucket.get(selected.generation.object_key),late=>{if(late)void late.body.cancel().catch(()=>{});});
   if(!object)unavailable();body=object.body;guard();
   if(object.size!==expected||expected<0||expected>MAX_BYTES||object.httpMetadata?.contentEncoding)unavailable();
   try{reader=body.getReader({mode:'byob'}) as typeof reader;}catch{unavailable();}
   if(!reader||typeof reader.readAtLeast!=='function')unavailable();
   const snapshot=new Uint8Array(expected);let offset=0,reads=0;
   while(true){
    if(++reads>maxReads)unavailable();guard();const minimum=Math.min(READ_SIZE,expected-offset)||1;
    // Native BYOB detaches buffers. Never hand it retained snapshot storage.
    const result=await op.wait(reader.readAtLeast(minimum,new Uint8Array(minimum)));guard();
    if(typeof result.done!=='boolean')unavailable();
    const chunk=result.value;if(chunk!==undefined&&!(chunk instanceof Uint8Array))unavailable();const size=chunk?.byteLength??0;
    if(size>expected-offset||!result.done&&size===0||size<minimum&&!result.done)unavailable();
    if(size){snapshot.set(chunk!,offset);offset+=size;}
    if(result.done){if(offset!==expected)unavailable();break;}
    if(reads%8===0){guard();await op.wait(scheduler.wait(0));guard();}
   }
   guard();const inspected=await op.wait(inspectProposalBytes(snapshot,selected.row.media_type));guard();
   if(inspected.byteLength!==expected||inspected.sha256!==selected.row.sha256||inspected.sha256!==i.proposal.inputs.sha256)unavailable();
   const descriptor=source.find(d=>d.actionId===receipt.requirements.actionId)!;
   if(synchronousOutput(descriptor.validateInput(inspected.value))!==true)unavailable();
   receipt.targets=targetSnapshot(synchronousOutput(descriptor.extractInputTargets(inspected.value as ReadonlyDecisionJson)));
   receipt.bindings=withTransaction(pinned.storage,tx=>{
    op.check();currentConfiguration(tx,pinned.workspace,pinned.admission);const actor=resolveActor(tx,pinned.identity,pinned.now());
    return lookup.assertInputTargetsCurrent(tx,actor,i.proposal,receipt.requirements,receipt.targets,budget);
   });
   guard();await op.wait(scheduler.wait(0));guard();
   const r=receipt.requirements,input=freeze({policy:{workspaceId:r.workspaceId,policyVersion:r.policyVersion,policyCanonicalJson:r.policyCanonicalJson,configEpoch:r.configEpoch,configDigest:r.configDigest,installationDigest:r.installationDigest,admissionGeneration:r.admissionGeneration},artifact:r.artifacts.find(a=>a.artifactId===i.proposal.inputs.artifact_id)!,descriptor:{actionId:r.actionId,schemaVersion:r.schemaVersion,schemaSha256:r.schemaSha256,semanticRevision:r.semanticRevision},byteLength:inspected.byteLength,sha256:inspected.sha256,value:inspected.value as ReadonlyDecisionJson,targetBindings:receipt.bindings}) as VerifiedProposalInput;
   op.check();inputs.set(input,receipt);return input;
  }catch{return unavailable();}finally{
   invocation?.close();if(reader){discard(()=>reader!.cancel());try{reader.releaseLock();}catch{}}else if(body)discard(()=>body!.cancel());
  }
 }
 function recheckProposalInput(tx:WorkspaceTransaction,ctx:ProposalInputContext,task:DecisionTaskReference,checkpoint:Checkpoint,proposal:Proposal,input:VerifiedProposalInput):DecisionPolicyResolution{
  try{
   // Membership BEFORE ANY evidence property access: fake getters/Proxy remain inert.
   const receipt=inputs.get(input);if(!receipt)unavailable();const p=receipt.pinned;assertTransactionStorage(tx,p.storage);
   if(ctx.workspace!==p.workspaceRef||ctx.workspace.storage!==p.storage||ctx.workspace.clock!==p.clockRef||ctx.workspace.workspaceId!==p.workspace.workspaceId||ctx.workspace.objectName!==p.workspace.objectName||ctx.bucket!==p.bucket||!equal(ctx.identity,p.identity)||!equal(ctx.admission,p.admission)||!equal(intent(task,checkpoint,proposal),receipt.intent))unavailable();
   current(tx,receipt,referenceBudget());
   const result=freeze({...receipt.requirements,phase:'resolved',input,artifactEdges:receipt.edges,targetBindings:receipt.bindings}) as DecisionPolicyResolution;resolutions.add(result);return result;
  }catch{return unavailable();}
 }
 return Object.freeze({verifyProposalInput,recheckProposalInput});
}
