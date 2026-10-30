import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext,CommandContext} from '../workspace/context';
import type {Task,TaskCreateRequest,TaskPatchRequest,TaskVersionRequest,TaskCommandResult} from '../http/dto';
import type {CommandDescriptor} from '../workspace/commands';
import {validateTask,validateTaskCreateRequest,validateTaskPatchRequest,validateTaskVersionRequest} from '../http/generated/auth-validators.js';
import {HttpError} from '../http/envelopes';
import {assertTaskReferences,assertTaskEligible,installedExecutionPolicy} from '../config/execution-policy';
import {taskAccess,taskRecord,taskView,assertTaskOutcomeVisible} from './repository';
const encoder=new TextEncoder();
function body<B>(value:B,validate:(input:unknown)=>boolean):void{
 if(!validate(value))throw new HttpError('INVALID_REQUEST',400);
 if(encoder.encode(JSON.stringify(value)).byteLength>65536)throw new HttpError('LIMIT_EXCEEDED',413);
}
function nextVersion(version:number):number{
 if(!Number.isSafeInteger(version)||version>=Number.MAX_SAFE_INTEGER)throw new HttpError('LIMIT_EXCEEDED',409);return version+1;
}
function version(task:{task_version:number},expected:number):void{
 if(!Number.isSafeInteger(expected)||expected<1)throw new HttpError('INVALID_REQUEST',400);
 if(task.task_version!==expected)throw new HttpError('VERSION_CONFLICT',409,{current_version:task.task_version});
}
function references(actor:ActorContext,input:TaskCreateRequest){return {workspace_id:actor.workspaceId,project_id:input.project_id??null,work_role_id:input.work_role_id??null,assigned_agent_id:input.assigned_agent_id??null};}
function proposed(task:Task,request:TaskPatchRequest):Task{return {...task,...Object.fromEntries(Object.entries(request).filter(([key])=>key!=='expected_version'))};}
export function createTask(tx:WorkspaceTransaction,ctx:CommandContext&{taskId?:string},request:TaskCreateRequest):Task{
 body(request,validateTaskCreateRequest);const actor=taskAccess(tx,ctx.actor,'tasks:create',null,ctx.nowMs),refs=references(actor,request);
 assertTaskReferences(tx,actor,refs);const policy=installedExecutionPolicy(tx,actor);
 if(!ctx.taskId||!/^[A-Za-z0-9_-]{1,128}$/.test(ctx.taskId))throw new HttpError('INTERNAL_ERROR',500);
 // ID uniqueness is global, even when a corrupt/foreign row would not be visible.
 if(tx.one('SELECT id FROM tasks WHERE id=?',[ctx.taskId]))throw new HttpError('INVALID_STATE',409);
 tx.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,project_id,work_role_id,assigned_agent_id,active_run_id,latest_run_id,approval_id,current_result_id,retry_count,retry_limit,flags_json,next_fence,next_result_sequence,created_at,updated_at) VALUES(?,?,?,?,'backlog',1,0,?,?,?,NULL,NULL,NULL,NULL,0,?,'[]',1,1,?,?)",[ctx.taskId,actor.workspaceId,request.title,request.description,refs.project_id,refs.work_role_id,refs.assigned_agent_id,policy.task_retry_limit,ctx.nowMs,ctx.nowMs]);
 return taskView(tx,actor,taskRecord(tx,actor.workspaceId,ctx.taskId),ctx.nowMs);
}
export function patchTask(tx:WorkspaceTransaction,ctx:CommandContext,id:string,request:TaskPatchRequest):Task{
 body(request,validateTaskPatchRequest);const actor=taskAccess(tx,ctx.actor,'tasks:edit',id,ctx.nowMs),row=taskRecord(tx,actor.workspaceId,id);
 const current=taskView(tx,actor,row,ctx.nowMs);
 version(row,request.expected_version);
 if(!['backlog','ready'].includes(row.state)||row.approval_id!==null)throw new HttpError('INVALID_STATE',409);
 const next=proposed(current,request);assertTaskReferences(tx,actor,next);
 tx.exec('UPDATE tasks SET title=?,description=?,project_id=?,work_role_id=?,assigned_agent_id=?,task_version=?,updated_at=? WHERE workspace_id=? AND id=?',[next.title,next.description,next.project_id,next.work_role_id,next.assigned_agent_id,nextVersion(row.task_version),ctx.nowMs,actor.workspaceId,id]);
 return taskView(tx,actor,taskRecord(tx,actor.workspaceId,id),ctx.nowMs);
}
export function readyTask(tx:WorkspaceTransaction,ctx:CommandContext,id:string,request:TaskVersionRequest):TaskCommandResult{
 body(request,validateTaskVersionRequest);const actor=taskAccess(tx,ctx.actor,'tasks:schedule',id,ctx.nowMs),row=taskRecord(tx,actor.workspaceId,id);
 const task=taskView(tx,actor,row,ctx.nowMs);
 version(row,request.expected_version);
 if(row.state!=='backlog'||row.approval_id!==null)throw new HttpError('INVALID_STATE',409);
 if(task.flags.some(flag=>flag==='outcome_unknown'||flag==='retry_exhausted'))throw new HttpError('INVALID_STATE',409);
 assertTaskEligible(tx,{...ctx,actor},task,task.assigned_agent_id);
 tx.exec("UPDATE tasks SET state='ready',task_version=?,updated_at=? WHERE workspace_id=? AND id=?",[nextVersion(row.task_version),ctx.nowMs,actor.workspaceId,id]);
 return {task:taskView(tx,actor,taskRecord(tx,actor.workspaceId,id),ctx.nowMs),run:null,approval:null};
}
function resultTask(data:Task|TaskCommandResult):Task{return 'task' in data?data.task:data;}
function command<B,T extends Task|TaskCommandResult>(id:string|null,operation:'tasks:create'|'tasks:edit'|'tasks:schedule',type:'task.created'|'task.updated'|'task.ready',validate:(input:unknown)=>boolean,run:(tx:WorkspaceTransaction,ctx:CommandContext,request:B)=>T):CommandDescriptor<B,T>{return {
 operation,target:id===null?'tasks:create':'tasks:'+id+':'+(operation==='tasks:edit'?'patch':'ready'),
 resource(tx,ctx,request){body(request,validate);taskAccess(tx,ctx.actor,operation,null,ctx.nowMs);if(id===null)return {kind:'task',id:'new',projectId:(request as TaskCreateRequest).project_id??null};const row=taskRecord(tx,ctx.actor.workspaceId,id);return {kind:'task',id,projectId:row.project_id};},
 checkAccess(tx,ctx){const actor=taskAccess(tx,ctx.actor,operation,id,ctx.nowMs);if(id!==null)taskView(tx,actor,taskRecord(tx,actor.workspaceId,id),ctx.nowMs);},
 checkReplay(tx,ctx,_request,outcome){
  const actor=taskAccess(tx,ctx.actor,operation,id,ctx.nowMs),task=resultTask(outcome.data);
  if(!validateTask(task)||task.workspace_id!==actor.workspaceId||id!==null&&task.id!==id)throw new HttpError('INTERNAL_ERROR',500);
  // Current resource and original retained references are independently checked;
  // replay deliberately does not reapply stale version/state/eligibility guards.
  taskAccess(tx,actor,operation,task.id,ctx.nowMs);assertTaskOutcomeVisible(tx,actor,task,ctx.nowMs);
 },
 execute(tx,ctx,request){const data=run(tx,ctx,request),task=resultTask(data);return {outcome:{status:id===null?201:200,data},event:{type,resourceType:'task',resourceId:task.id,resourceVersion:null,threadId:null}};}
};}
export const createTaskCommand=(taskId:string)=>command<TaskCreateRequest,Task>(null,'tasks:create','task.created',validateTaskCreateRequest,(tx,ctx,request)=>createTask(tx,{...ctx,taskId},request));
export const patchTaskCommand=(id:string)=>command<TaskPatchRequest,Task>(id,'tasks:edit','task.updated',validateTaskPatchRequest,(tx,ctx,request)=>patchTask(tx,ctx,id,request));
export const readyTaskCommand=(id:string)=>command<TaskVersionRequest,TaskCommandResult>(id,'tasks:schedule','task.ready',validateTaskVersionRequest,(tx,ctx,request)=>readyTask(tx,ctx,id,request));
