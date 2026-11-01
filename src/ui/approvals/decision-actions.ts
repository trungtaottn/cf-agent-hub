import type {Approval,Artifact,Task,Workspace,ApprovalDecisionRequest,TaskCommandResult} from '../../http/dto';
import type {ApiResult,BrowserDecisionOperation,BrowserDecisionRequest} from '../../../packages/client/src/types';
import {validateApproval,validateApprovalDecisionRequest,validateTaskCommandResultResponse} from '../../http/generated/decision-validators.js';
import {validateTask,validateWorkspace} from '../../http/generated/auth-validators.js';
import {matchesProposalMetadata,type DisplayInput} from './input-viewer';
import {classifyWriteResult} from '../write-intent';
export interface DecisionBinding {principalId:string;generation:number;renderGeneration:number;online:boolean;}
/** Trusted host observation only. Exact mode must come from InputInspector; this is
 * neither public verifier evidence nor a backend policy/action-availability flag. */
export interface DecisionObservation {approval:Approval;task:Task;artifact:Artifact;access:Workspace;mode:'exact'|'metadata';input:DisplayInput|null;}
export interface DecisionIntent {
 readonly operation:BrowserDecisionOperation;readonly approvalId:string;readonly taskId:string;
 readonly principalId:string;readonly workspaceId:string;readonly serializedBody:string;readonly key:string;
 readonly approval:Readonly<Approval>;readonly artifact:Readonly<Artifact>;readonly reasonRevision:number;
}
export interface DecisionActionState {
 status:'idle'|'preparing'|'review'|'ready'|'confirming'|'pending'|'uncertain'|'conflict'|'rejected'|'succeeded'|'unresolved';
 operation:BrowserDecisionOperation|null;approvalId:string|null;reason:string;reasonRevision:number;
 observation:DecisionObservation|null;currentObservation:DecisionObservation|null;
 intent:DecisionIntent|null;code:string|null;revision:number;
}
export interface DecisionActionsOptions {
 workspaceId:string;currentBinding:()=>DecisionBinding|null;currentObservationRevision:()=>number;
 /** Fixed trusted reads, never public DTO injection. Metadata mode must not read/retain bytes. */
 observe:(id:string,mode:'exact'|'metadata',current:()=>boolean)=>Promise<ApiResult<DecisionObservation>>;
 /** Actual same-client session+workspace refresh, LAST after optional reads; restores current CSRF. */
 readAccess:(current:()=>boolean)=>Promise<ApiResult<Workspace>>;command:BrowserDecisionRequest;
 now?:()=>number;newKey?:()=>string;changed?:()=>void;
}
const clone=<T>(v:T):T=>structuredClone(v);
const freeze=<T>(v:T):T=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
const initial=():DecisionActionState=>({status:'idle',operation:null,approvalId:null,reason:'',reasonRevision:0,observation:null,currentObservation:null,intent:null,code:null,revision:0});
const denied=(r:ApiResult<unknown>)=>!r.ok&&(r.status===401||r.status===403||r.status===404);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const immutable=(a:Readonly<Approval>)=>[a.id,a.workspace_id,a.task_id,a.run_id,a.proposal_version,a.task_version_at_request,a.proposal,a.checkpoint,a.requested_by,a.created_at,a.expires_at];
const metadata=(v:DecisionObservation)=>[v.approval,v.task,v.artifact];
const failure=(code:string):ApiResult<never>=>({ok:false,status:null,requestId:null,error:{code,message:'Decision command unavailable',retryable:false}});
/** Memory-only intent owner. Never schedules retries or resolves UNKNOWN from reads. */
export class DecisionActions {
 #state:Readonly<DecisionActionState>=freeze(initial());#epoch=0;#life=0;#outcomeRead=0;
 #reviewBinding:DecisionBinding|null=null;#reviewRevision=-1;
 #confirmed:{binding:DecisionBinding;observationRevision:number;reasonRevision:number;serializedBody:string}|null=null;
 constructor(private readonly options:DecisionActionsOptions){}
 get state():Readonly<DecisionActionState>{return this.#state;}
 #set(patch:Partial<DecisionActionState>){this.#state=freeze({...this.#state,...patch,revision:this.#state.revision+1});this.options.changed?.();}
 #locked(){return this.#state.status==='pending'||this.#state.status==='uncertain';}
 #same(b:DecisionBinding){const n=this.options.currentBinding();return !!n?.online&&n.principalId===b.principalId&&n.generation===b.generation&&n.renderGeneration===b.renderGeneration;}
 #binding(){const b=this.options.currentBinding();return b?.online?{...b}:null;}
 #access(a:Workspace,b:DecisionBinding){return validateWorkspace(a)&&a.id===this.options.workspaceId&&a.actor.kind==='human'&&a.actor.agent_id===null&&a.actor.principal_id===b.principalId&&['approvals:read','approvals:decide','tasks:read','artifacts:read'].every(s=>a.effective_scopes.includes(s as never));}
 #observation(v:DecisionObservation,b:DecisionBinding,id:string){
  return validateApproval(v.approval)&&validateTask(v.task)&&this.#access(v.access,b)&&v.approval.id===id&&v.approval.workspace_id===this.options.workspaceId&&v.task.id===v.approval.task_id&&v.task.workspace_id===this.options.workspaceId&&v.approval.assigned_human_principal_ids.includes(b.principalId)&&matchesProposalMetadata(v.approval,v.artifact)&&
   (v.mode==='metadata'?v.input===null:v.mode==='exact'&&!!v.input&&v.input.sha256===v.artifact.sha256&&v.input.byteSize===v.artifact.byte_size&&new TextEncoder().encode(v.input.text).length===v.artifact.byte_size);
 }
 #eligible(v:DecisionObservation,b:DecisionBinding,id:string,op:BrowserDecisionOperation){
  return this.#observation(v,b,id)&&v.approval.status==='pending'&&v.task.state==='waiting'&&v.task.approval_id===id&&v.task.active_run_id===null&&v.task.proposal_version===v.approval.proposal_version&&[v.task.task_version,v.approval.approval_version,v.approval.proposal_version].every(n=>Number.isSafeInteger(n)&&n>0&&n<Number.MAX_SAFE_INTEGER)&&(this.options.now??Date.now)()<Date.parse(v.approval.expires_at)&&(op==='rejectApproval'?v.mode==='metadata'&&v.input===null:v.mode==='exact'&&v.input!==null);
 }
 #body():ApprovalDecisionRequest|null{const v=this.#state.observation;if(!v)return null;const body={expected_version:v.task.task_version,expected_proposal_version:v.approval.proposal_version,expected_approval_version:v.approval.approval_version,reason:this.#state.reason};return validateApprovalDecisionRequest(body)&&new TextEncoder().encode(JSON.stringify(body)).length<=65536?body:null;}
 #readFailure(r:ApiResult<unknown>,fallback:DecisionActionState['status']='rejected'){
  if(denied(r)){this.invalidateAuthority();return;}
  this.#confirmed=null;this.#set({status:fallback,code:r.ok?'OBSERVATION_INVALIDATED':r.error.code,observation:null});
 }
 async prepare(id:string,operation:BrowserDecisionOperation){
  if(this.#locked())return;
  const b=this.#binding(),epoch=++this.#epoch;++this.#outcomeRead;this.#confirmed=null;this.#reviewBinding=null;this.#reviewRevision=-1;
  const reason=this.#state.approvalId===id&&this.#state.operation===operation?this.#state.reason:'';
  this.#set({...initial(),status:'preparing',approvalId:id,operation,reason});
  if(!b||!['approveApproval','rejectApproval'].includes(operation)){this.#set({status:'rejected',code:'CURRENT_AUTHORITY_REQUIRED'});return;}
  try{const r=await this.options.observe(id,operation==='approveApproval'?'exact':'metadata',()=>epoch===this.#epoch&&this.#same(b));if(epoch!==this.#epoch)return;if(!this.#same(b)){this.invalidateAuthority();return;}
   if(!r.ok){this.#readFailure(r);return;}
   const v=clone(r.data);if(!this.#eligible(v,b,id,operation)){this.#set({status:'rejected',code:'CURRENT_REVIEW_REQUIRED'});return;}
   this.#reviewBinding=b;this.#reviewRevision=this.options.currentObservationRevision();this.#set({status:'review',observation:v,code:null});
  }catch{if(epoch===this.#epoch)this.#set({status:'rejected',code:'READ_FAILED'});}
 }
 setReason(reason:string){if(this.#locked()||typeof reason!=='string')return;++this.#epoch;this.#confirmed=null;this.#set({reason,reasonRevision:this.#state.reasonRevision+1,status:['review','ready','confirming'].includes(this.#state.status)&&this.#state.observation?'review':this.#state.status==='preparing'?'idle':this.#state.status,code:null});}
 confirmReview(){
  if(this.#locked()||!['review','ready'].includes(this.#state.status))return;
  const b=this.#binding(),v=this.#state.observation,body=this.#body(),id=this.#state.approvalId,op=this.#state.operation;
  if(!b||this.#reviewBinding&&!this.#same(this.#reviewBinding)){this.invalidateAuthority();return;}
  if(!b||!v||!id||!op||!body||!this.#reviewBinding||!this.#same(this.#reviewBinding)||this.#reviewRevision!==this.options.currentObservationRevision()||!this.#eligible(v,b,id,op)){this.#set({status:'review',code:'CURRENT_REVIEW_REQUIRED'});return;}
  this.#confirmed={binding:b,observationRevision:this.options.currentObservationRevision(),reasonRevision:this.#state.reasonRevision,serializedBody:JSON.stringify(body)};this.#set({status:'ready',code:null});
 }
 invalidatePreparation(){++this.#epoch;++this.#outcomeRead;this.#confirmed=null;if(!this.#locked())this.#set({status:'idle',observation:null,currentObservation:null,code:'CURRENT_REVIEW_REQUIRED'});}
 invalidateAuthority(){const unresolved=this.#locked()||this.#state.status==='unresolved';++this.#epoch;++this.#life;++this.#outcomeRead;this.#confirmed=null;this.#reviewBinding=null;this.#reviewRevision=-1;this.#set({...initial(),status:unresolved?'unresolved':'idle',code:unresolved?'OUTCOME_UNRESOLVED':'CURRENT_AUTHORITY_REQUIRED'});}
 async submit(){
  const c=this.#confirmed,v=this.#state.observation,id=this.#state.approvalId,op=this.#state.operation;
  if(this.#state.status!=='ready'||!c||!v||!id||!op)return;
  if(!this.#same(c.binding)){this.invalidateAuthority();return;}
  if(c.observationRevision!==this.options.currentObservationRevision()){this.invalidatePreparation();return;}
  const epoch=++this.#epoch;this.#set({status:'confirming',code:null});
  try{
   const latest=await this.options.observe(id,'metadata',()=>epoch===this.#epoch&&this.#same(c.binding));if(epoch!==this.#epoch)return;if(!this.#same(c.binding)){this.invalidateAuthority();return;}
   if(!latest.ok){this.#readFailure(latest);return;}
   if(!this.#observation(latest.data,c.binding,id)){this.invalidateAuthority();return;}
   if(!same(metadata(latest.data),metadata(v))){this.#confirmed=null;this.#set({status:'review',observation:null,code:'OBSERVATION_CHANGED'});return;}
   const access=await this.options.readAccess(()=>epoch===this.#epoch&&this.#same(c.binding));if(epoch!==this.#epoch)return;if(!this.#same(c.binding)){this.invalidateAuthority();return;}
   if(!access.ok){this.#readFailure(access);return;}
   if(!this.#access(access.data,c.binding)){this.invalidateAuthority();return;}
   if(this.#confirmed!==c||c.reasonRevision!==this.#state.reasonRevision||c.observationRevision!==this.options.currentObservationRevision()||!this.#eligible(v,c.binding,id,op)){this.invalidatePreparation();return;}
   const intent=freeze({operation:op,approvalId:id,taskId:v.task.id,principalId:c.binding.principalId,workspaceId:this.options.workspaceId,serializedBody:c.serializedBody,key:(this.options.newKey??(()=>crypto.randomUUID()))(),approval:clone(v.approval),artifact:clone(v.artifact),reasonRevision:c.reasonRevision});
   this.#set({status:'pending',intent,code:null});await this.#send(intent,c.binding);
  }catch{if(epoch===this.#epoch&&(['confirming'] as string[]).includes(this.#state.status)){this.#confirmed=null;this.#set({status:'review',code:'PREPARATION_FAILED'});}}
 }
 async replay(){
  const intent=this.#state.intent,b=this.#binding();if(this.#state.status!=='uncertain'||!intent||!b)return;
  if(b.principalId!==intent.principalId){this.invalidateAuthority();return;}
  const epoch=++this.#epoch;this.#set({status:'pending',code:null});
  try{
   const r=await this.options.observe(intent.approvalId,'metadata',()=>epoch===this.#epoch&&this.#same(b));if(epoch!==this.#epoch)return;if(!this.#same(b)){this.invalidateAuthority();return;}
   if(!r.ok){this.#readFailure(r,'uncertain');return;}
   if(!this.#observation(r.data,b,intent.approvalId)||!same(immutable(r.data.approval),immutable(intent.approval))){this.invalidateAuthority();return;}
   // Final same-client session refresh is LAST, after optional reference reads.
   const access=await this.options.readAccess(()=>epoch===this.#epoch&&this.#same(b));if(epoch!==this.#epoch)return;if(!this.#same(b)){this.invalidateAuthority();return;}
   if(!access.ok){this.#readFailure(access,'uncertain');return;}
   if(!this.#access(access.data,b)){this.invalidateAuthority();return;}
   await this.#send(intent,b,true);
  }catch{if(epoch===this.#epoch)this.#set({status:'uncertain',code:'REPLAY_UNAVAILABLE'});}
 }
 async #send(intent:DecisionIntent,b:DecisionBinding,replay=false){
  const life=this.#life;if(!this.#same(b)||this.#state.intent!==intent){this.invalidateAuthority();return;}
  let result:ApiResult<TaskCommandResult>;try{result=await this.options.command(intent.operation,{path:{approval_id:intent.approvalId},body:JSON.parse(intent.serializedBody)},{idempotencyKey:intent.key});}catch{result=failure('NETWORK_ERROR');}
  if(life!==this.#life||this.#state.intent!==intent)return;
  if(!this.#same(b)||denied(result)){this.invalidateAuthority();return;}
  if(result.ok){
   const d=result.data,body=JSON.parse(intent.serializedBody) as ApprovalDecisionRequest,a=d.approval;
   if(!validateTaskCommandResultResponse({data:d,request_id:result.requestId})||!a||d.run!==null||d.task.id!==intent.taskId||d.task.workspace_id!==intent.workspaceId||d.task.task_version!==body.expected_version+1||d.task.proposal_version!==body.expected_proposal_version||d.task.approval_id!==intent.approvalId||d.task.active_run_id!==null||d.task.state!==(intent.operation==='approveApproval'?'ready':'backlog')||a.approval_version!==body.expected_approval_version+1||a.status!==(intent.operation==='approveApproval'?'approved':'rejected')||!same(immutable(a),immutable(intent.approval))||a.decided_by?.kind!=='human'||a.decided_by.principal_id!==intent.principalId||a.decided_by.agent_id!==null||a.decision_reason!==body.reason||a.decided_at===null)result=failure('INVALID_RESPONSE');
  }
  let status:DecisionActionState['status']=classifyWriteResult(result);
  if(!result.ok&&result.error.code==='APPROVAL_EXPIRED')status='conflict';
  // A refused replay is not proof that a previously dispatched request never committed.
  if(replay&&!result.ok)status='uncertain';
  this.#confirmed=null;this.#set({status,intent:status==='succeeded'?null:intent,code:result.ok?null:result.error.code});
 }
 async refreshOutcome(){
  const b=this.#binding(),id=this.#state.approvalId,epoch=this.#epoch;if(!b||!id||!['uncertain','conflict','succeeded','rejected'].includes(this.#state.status))return;
  const read=++this.#outcomeRead;
  try{const r=await this.options.observe(id,'metadata',()=>epoch===this.#epoch&&read===this.#outcomeRead&&this.#same(b));if(epoch!==this.#epoch||read!==this.#outcomeRead)return;if(!this.#same(b)){this.invalidateAuthority();return;}
   if(denied(r)){this.invalidateAuthority();return;}
   if(!r.ok){this.#set({currentObservation:null});return;}
   if(!this.#observation(r.data,b,id)){this.invalidateAuthority();return;}
   this.#set({currentObservation:clone(r.data)});
  }catch{if(epoch===this.#epoch&&read===this.#outcomeRead)this.#set({currentObservation:null});}
 }
}
