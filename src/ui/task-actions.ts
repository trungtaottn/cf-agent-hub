import type {Task,TaskResult,Run,Workspace,TaskCommandResult,TaskVersionRequest,TaskReasonRequest,Scope} from '../http/dto';
import type {ApiResult,BrowserTaskCommandOperation,BrowserTaskCommandRequest} from '../../packages/client/src/types';
import {validateTaskReasonRequest,validateTaskVersionRequest,validateTaskCommandResult} from '../http/generated/auth-validators.js';

export interface TaskActionBinding {principalId:string;agentId:string|null;generation:number;online:boolean;}
export interface TaskActionIntent {
 readonly workspaceId:string;readonly principalId:string;readonly agentId:string|null;readonly generation:number;
 readonly taskId:string;readonly operation:BrowserTaskCommandOperation;readonly expectedVersion:number;
 readonly key:string;readonly serializedBody:string;
 readonly reviewedResult:Readonly<TaskResult>|null;readonly reviewedRunId:string|null;
}
export interface TaskActionState {
 status:'idle'|'preparing'|'ready'|'pending'|'uncertain'|'conflict'|'rejected'|'succeeded'|'unresolved';
 taskId:string|null;operation:BrowserTaskCommandOperation|null;task:Task|null;reason:string;disabledReason:string|null;
 intent:TaskActionIntent|null;result:ApiResult<TaskCommandResult>|null;revision:number;
}
export interface TaskActionsOptions {
 workspaceId:string;currentBinding:()=>TaskActionBinding|null;
 readAccess:()=>Promise<ApiResult<Workspace>>;readTask:(id:string)=>Promise<ApiResult<Task>>;readRun:(id:string)=>Promise<ApiResult<Run>>;
 command:BrowserTaskCommandRequest;changed?:()=>void;settled?:(state:Readonly<TaskActionState>)=>void;
}
const scopes:Record<BrowserTaskCommandOperation,Scope>={readyTask:'tasks:schedule',requeueTask:'tasks:schedule',cancelTask:'tasks:cancel',acceptTaskResult:'tasks:review'};
/** A display explanation, not authorization. Undefined run is an observational card check;
 * explicit null means a required current run read failed. prepare always corroborates it. */
export function taskActionEligibility(operation:BrowserTaskCommandOperation,task:Task,grants:readonly string[],principalId:string,agentId:string|null,run?:Run|null):string|null {
 if(!Object.hasOwn(scopes,operation))return 'Operation unavailable';
 if(!grants.includes(scopes[operation]))return 'Permission missing: '+scopes[operation];
 if(!Number.isSafeInteger(task.task_version)||task.task_version<1||task.task_version>=Number.MAX_SAFE_INTEGER)return 'Task version unavailable';
 if(operation==='cancelTask')return ['backlog','ready','doing','waiting','review'].includes(task.state)?null:'Task cannot be cancelled in this state';
 if(operation==='requeueTask')return ['backlog','review'].includes(task.state)&&task.active_run_id===null?null:'Requeue requires backlog or review without an active run';
 if(task.approval_id!==null)return 'R3 approval authority unavailable';
 if(task.flags.some(flag=>flag==='outcome_unknown'||flag==='retry_exhausted'))return 'External outcome or retry hold requires reconciliation';
 if(operation==='readyTask')return task.state==='backlog'?null:'Ready requires backlog state';
 if(task.state!=='review'||!task.result||task.active_run_id!==null||task.result.run_id!==task.latest_run_id)return 'Accept requires a current submitted result in review';
 const actor=task.result.submitted_by;
 if(actor.principal_id===principalId||agentId!==null&&actor.agent_id===agentId)return 'Cannot accept your own result';
 if(actor.kind!=='agent'||actor.agent_id===null)return 'Current submitter evidence unavailable';
 if(run===null)return 'Current submitted run evidence unavailable';
 if(run!==undefined&&(run.id!==task.latest_run_id||run.task_id!==task.id||run.workspace_id!==task.workspace_id||run.status!=='submitted'||run.ended_at===null||run.agent_id!==actor.agent_id))return 'Current submitted run evidence does not match';
 return null;
}
const failure=(code:string):ApiResult<never>=>({ok:false,status:null,requestId:null,error:{code,message:code,retryable:false}});
const resultIdentity=(result:Readonly<TaskResult>|null):string|null=>result===null?null:JSON.stringify([result.run_id,result.summary,result.artifact_ids,result.submitted_by.kind,result.submitted_by.principal_id,result.submitted_by.agent_id,result.submitted_at]);
const frozen=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const item of Object.values(value))frozen(item);Object.freeze(value);}return value;};
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const initial=():TaskActionState=>({status:'idle',taskId:null,operation:null,task:null,reason:'',disabledReason:'Choose an action and refresh current authority',intent:null,result:null,revision:0});
/** Separate current preparation from retained mutation evidence. No browser persistence or implicit replay. */
export class TaskActions {
 #state:Readonly<TaskActionState>=frozen(initial());#preparation=0;#lifecycle=0;#preparedBinding:TaskActionBinding|null=null;#eligibility:string|null=null;
 constructor(private readonly options:TaskActionsOptions){}
 get state():Readonly<TaskActionState>{return this.#state;}
 #set(patch:Partial<TaskActionState>):void{this.#state=frozen({...this.#state,...patch,revision:this.#state.revision+1});this.options.changed?.();}
 #same(binding:TaskActionBinding,includeGeneration=true):boolean{const now=this.options.currentBinding();return Boolean(now?.online&&now.principalId===binding.principalId&&now.agentId===binding.agentId&&(!includeGeneration||now.generation===binding.generation));}
 #locked():boolean{return this.#state.status==='pending'||this.#state.status==='uncertain';}
 #accessMatches(access:Workspace,binding:TaskActionBinding):boolean{return access.id===this.options.workspaceId&&access.actor.principal_id===binding.principalId&&access.actor.agent_id===binding.agentId;}
 #rejectRead(result:ApiResult<unknown>):void {
  if(!result.ok&&(result.status===401||result.status===403)){this.invalidateAuthority();return;}
  this.#set({status:'rejected',disabledReason:result.ok?'Current response binding does not match':'Current read failed: '+result.error.code});
 }
 async prepare(taskId:string,operation:BrowserTaskCommandOperation):Promise<void>{
  if(this.#locked())return;
  const binding=this.options.currentBinding(),generation=++this.#preparation;
  this.#preparedBinding=null;
  const reason=this.#state.taskId===taskId&&this.#state.operation===operation?this.#state.reason:'';
  this.#set({status:'preparing',taskId,operation,task:null,reason,intent:null,result:null,disabledReason:'Refreshing current authority and task'});
  if(!binding?.online||!Object.hasOwn(scopes,operation)){this.#set({status:'rejected',disabledReason:'Current online authority required'});return;}
  const stable={...binding};
  try{
   const access=await this.options.readAccess();if(generation!==this.#preparation||!this.#same(stable))return;
   if(!access.ok||!this.#accessMatches(access.data,stable)){this.#rejectRead(access);return;}
   const task=await this.options.readTask(taskId);if(generation!==this.#preparation||!this.#same(stable))return;
   if(!task.ok||task.data.id!==taskId||task.data.workspace_id!==this.options.workspaceId){this.#rejectRead(task);return;}
   let run:Run|null|undefined;
   if(operation==='acceptTaskResult'){
    run=null;
    if(task.data.latest_run_id){const response=await this.options.readRun(task.data.latest_run_id);if(generation!==this.#preparation||!this.#same(stable))return;if(!response.ok&&(response.status===401||response.status===403)){this.invalidateAuthority();return;}if(response.ok)run=response.data;}
   }
   this.#eligibility=taskActionEligibility(operation,task.data,access.data.effective_scopes,stable.principalId,stable.agentId,run);
   this.#preparedBinding=stable;this.#set({status:'ready',task:clone(task.data),disabledReason:this.#eligibility});this.#reasonState();
  }catch{if(generation===this.#preparation)this.#set({status:'rejected',disabledReason:'Current read failed'});}
 }
 #body():TaskVersionRequest|TaskReasonRequest|null{const {task,operation,reason}=this.#state;if(!task||!operation)return null;return operation==='readyTask'?{expected_version:task.task_version}:{expected_version:task.task_version,reason};}
 #reasonState():void{if(this.#state.status!=='ready')return;const body=this.#body(),valid=this.#state.operation==='readyTask'?validateTaskVersionRequest(body):validateTaskReasonRequest(body);this.#set({disabledReason:this.#eligibility??(valid?null:'Enter a reason within the supported length')});}
 setReason(reason:string):void{if(this.#locked()||typeof reason!=='string')return;this.#set({reason});this.#reasonState();}
 invalidatePreparation():void{++this.#preparation;this.#preparedBinding=null;if(this.#locked()||['succeeded','unresolved','conflict','rejected'].includes(this.#state.status))return;this.#set({status:'idle',disabledReason:'Refresh current authority and task before submitting'});}
 invalidateAuthority():void{const unresolved=this.#locked()||this.#state.status==='unresolved';++this.#preparation;++this.#lifecycle;this.#preparedBinding=null;this.#set({...initial(),status:unresolved?'unresolved':'idle',disabledReason:unresolved?'Access cleared; the original command outcome remains unresolved':'Current authority required'});}
 /** Observe a conflict's current target without rebasing or authorizing a new intent. */
 async refreshConflict():Promise<void>{
  if(this.#state.status!=='conflict'||!this.#state.taskId)return;
  const taskId=this.#state.taskId,binding=this.options.currentBinding(),generation=++this.#preparation;
  if(!binding?.online)return;
  const stable={...binding};this.#preparedBinding=null;
  try{
   const access=await this.options.readAccess();if(generation!==this.#preparation||!this.#same(stable)||this.#state.status!=='conflict')return;
   if(!access.ok||!this.#accessMatches(access.data,stable)){if(!access.ok&&(access.status===401||access.status===403))this.invalidateAuthority();else this.#set({task:null,disabledReason:'Conflict retained; current access unavailable'});return;}
   const result=await this.options.readTask(taskId);if(generation!==this.#preparation||!this.#same(stable)||this.#state.status!=='conflict')return;
   if(!result.ok&&(result.status===401||result.status===403)){this.invalidateAuthority();return;}
   if(!result.ok||result.data.id!==taskId||result.data.workspace_id!==this.options.workspaceId){this.#set({task:null,disabledReason:'Conflict retained; current task unavailable'});return;}
   this.#set({task:clone(result.data),disabledReason:'Current version observed. Review current task explicitly before a new confirmation'});
  }catch{if(generation===this.#preparation&&this.#state.status==='conflict')this.#set({task:null,disabledReason:'Conflict retained; current task refresh failed'});}
 }
 async submit():Promise<void>{
  if(this.#state.status!=='ready'||this.#state.disabledReason!==null||!this.#preparedBinding||!this.#same(this.#preparedBinding))return;
  const body=this.#body();if(!body||!this.#state.taskId||!this.#state.operation)return;
  const intent:TaskActionIntent=frozen({workspaceId:this.options.workspaceId,principalId:this.#preparedBinding.principalId,agentId:this.#preparedBinding.agentId,generation:this.#preparedBinding.generation,taskId:this.#state.taskId,operation:this.#state.operation,expectedVersion:body.expected_version,key:crypto.randomUUID(),serializedBody:JSON.stringify(body),reviewedResult:this.#state.operation==='acceptTaskResult'?clone(this.#state.task!.result):null,reviewedRunId:this.#state.operation==='acceptTaskResult'?this.#state.task!.latest_run_id:null});
  const dispatchBinding={...this.#preparedBinding};
  this.#set({status:'pending',intent,result:null,disabledReason:'Command pending — do not submit another intent'});await this.#send(intent,false,dispatchBinding);
 }
 async replay():Promise<void>{
  if(this.#state.status!=='uncertain'||!this.#state.intent)return;
  const intent=this.#state.intent,binding=this.options.currentBinding(),lifecycle=this.#lifecycle;
  if(!binding?.online||binding.principalId!==intent.principalId||binding.agentId!==intent.agentId){this.#set({disabledReason:'Original identity and current online access required for replay'});return;}
  const stable={...binding};this.#set({status:'pending',disabledReason:'Checking current access for exact replay'});
  try{
   const access=await this.options.readAccess();if(lifecycle!==this.#lifecycle)return;
   if(!access.ok&&(access.status===401||access.status===403)){this.invalidateAuthority();return;}
   if(!access.ok||!this.#same(stable)||!this.#accessMatches(access.data,stable)||!access.data.effective_scopes.includes(scopes[intent.operation])){this.#set({status:'uncertain',disabledReason:'Replay access unavailable; original outcome remains unknown'});return;}
   // Never rebase against a new task version or gate on its possibly already-completed state.
   await this.#send(intent,true,stable);
  }catch{if(lifecycle===this.#lifecycle)this.#set({status:'uncertain',disabledReason:'Replay access failed; original outcome remains unknown'});}
 }
 async #send(intent:TaskActionIntent,replay:boolean,verifiedBinding:TaskActionBinding):Promise<void>{
  if(this.#state.status!=='pending'||this.#state.intent!==intent)return;
  if(!replay&&this.#preparedBinding===null){this.#set({status:'rejected',disabledReason:'Preparation changed before dispatch; refresh and review again'});return;}
  const lifecycle=this.#lifecycle,binding=this.options.currentBinding();
  if(!binding?.online||!this.#same(verifiedBinding)||binding.principalId!==intent.principalId||binding.agentId!==intent.agentId){this.#set({status:replay?'uncertain':'rejected',disabledReason:'Original identity and current online access required'});return;}
  let result:ApiResult<TaskCommandResult>;
  try{result=await this.options.command(intent.operation,{path:{task_id:intent.taskId},body:JSON.parse(intent.serializedBody)},{idempotencyKey:intent.key});}catch{result=failure('NETWORK_ERROR');}
  if(lifecycle!==this.#lifecycle||this.#state.intent!==intent)return;
  const current=this.options.currentBinding();
  // Ordinary offline/read generation changes do not erase mutation knowledge. A new
  // identity cannot receive the former actor's sensitive retained outcome.
  if(!current||current.principalId!==intent.principalId||current.agentId!==intent.agentId){this.invalidateAuthority();return;}
  if(!result.ok&&(result.status===401||result.status===403)){this.invalidateAuthority();return;}
  if(result.ok){const data=result.data,expectedState=intent.operation==='cancelTask'?'cancelled':intent.operation==='acceptTaskResult'?'done':'ready';
   if(!validateTaskCommandResult(data)||data.task.id!==intent.taskId||data.task.workspace_id!==intent.workspaceId||!Number.isSafeInteger(intent.expectedVersion+1)||data.task.task_version!==intent.expectedVersion+1||data.task.state!==expectedState||data.task.active_run_id!==null||data.task.approval_id!==null||data.run!==null||data.approval!==null||intent.operation==='acceptTaskResult'&&(intent.reviewedResult===null||data.task.result===null||data.task.latest_run_id!==intent.reviewedRunId||resultIdentity(data.task.result)!==resultIdentity(intent.reviewedResult)))result=failure('INVALID_RESPONSE');
  }
  const preflight=!result.ok&&result.status===null&&['INVALID_REQUEST','CSRF_REQUIRED','OPERATION_UNAVAILABLE'].includes(result.error.code);
  const status=result.ok?'succeeded':preflight?(replay?'uncertain':'rejected'):result.status===null||result.error.code==='INVALID_RESPONSE'||result.status>=500?'uncertain':result.status===409&&result.error.code==='VERSION_CONFLICT'?'conflict':'rejected';
  this.#preparedBinding=null;
  this.#set({status,result:clone(result),intent:result.ok?null:intent,disabledReason:status==='uncertain'?'Original outcome unknown; only exact replay is available':status==='conflict'?'Version conflict; refresh and explicitly review a new action':status==='succeeded'?'Server confirmed command; refresh reads for current state':'Command rejected; review before a new action'});
  this.options.settled?.(this.#state);
 }
}
