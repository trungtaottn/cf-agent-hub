import {canonicalJson} from '../config/bootstrap';
import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import type {Task,TaskState} from '../http/dto';
import {refreshActor} from '../auth/authorize';
import {HttpError} from '../http/envelopes';
import {validateTask} from '../http/generated/auth-validators.js';
import {assertStoredScalarBytes,assertTaskItemFits} from './bounds';
import {projectTaskResult} from './results';
export interface TaskRow {id:string;workspace_id:string;title:string;description:string;state:TaskState;task_version:number;proposal_version:number;project_id:string|null;work_role_id:string|null;assigned_agent_id:string|null;active_run_id:string|null;latest_run_id:string|null;approval_id:string|null;current_result_id:string|null;retry_count:number;retry_limit:number;flags_json:string;next_fence:number;next_result_sequence:number;created_at:number;updated_at:number;}
const scalars=['id','workspace_id','title','description','project_id','work_role_id','assigned_agent_id','active_run_id','latest_run_id','approval_id','current_result_id','flags_json'];
const scalarBytes=scalars.map(name=>`coalesce(length(CAST(${name} AS BLOB)),0)`).join('+');
export function taskRecord(tx:WorkspaceTransaction,workspaceId:string,id:string):TaskRow {
 const size=tx.one<{bytes:number}>(`SELECT ${scalarBytes} AS bytes FROM tasks WHERE workspace_id=? AND id=?`,[workspaceId,id]);
 if(!size)throw new HttpError('NOT_FOUND',404);assertStoredScalarBytes(size.bytes);
 return tx.one<TaskRow>('SELECT * FROM tasks WHERE workspace_id=? AND id=?',[workspaceId,id])!;
}
/** Pure relationship predicate: caller must pass one current coherent grant, never a synthetic actor. */
export function taskVisible(actor:ActorContext,row:Pick<TaskRow,'workspace_id'|'project_id'>,scope='tasks:read'):boolean {
 return row.workspace_id===actor.workspaceId&&actor.scopes.has(scope)&&(actor.projectIds===null||row.project_id!==null&&actor.projectIds.includes(row.project_id));
}
export function taskAccess(tx:WorkspaceTransaction,actor:ActorContext,scope:string,id:string|null,nowMs:number):ActorContext {
 const live=refreshActor(tx,actor,nowMs);
 if(!live.scopes.has(scope))throw new HttpError('FORBIDDEN',403);
 if(id!==null&&!taskVisible(live,taskRecord(tx,live.workspaceId,id),scope))throw new HttpError('FORBIDDEN',403);
 return live;
}
export function taskView(tx:WorkspaceTransaction,actor:ActorContext,row:TaskRow,_nowMs:number):Task {
 if(row.workspace_id!==actor.workspaceId||actor.projectIds!==null&&(row.project_id===null||!actor.projectIds.includes(row.project_id)))throw new HttpError('FORBIDDEN',403);
 const result=row.current_result_id===null?null:projectTaskResult(tx,actor,row.id,row.current_result_id);
 if(row.current_result_id!==null&&result===null)throw new HttpError('FORBIDDEN',403);
 const view:Task={id:row.id,workspace_id:row.workspace_id,title:row.title,description:row.description,state:row.state,task_version:row.task_version,proposal_version:row.proposal_version,project_id:row.project_id,work_role_id:row.work_role_id,assigned_agent_id:row.assigned_agent_id,active_run_id:row.active_run_id,latest_run_id:row.latest_run_id,approval_id:row.approval_id,result,retry_count:row.retry_count,retry_limit:row.retry_limit,flags:JSON.parse(row.flags_json) as Task['flags'],created_at:new Date(row.created_at).toISOString(),updated_at:new Date(row.updated_at).toISOString()};
 if(!validateTask(view))throw new HttpError('INTERNAL_ERROR',500);assertTaskItemFits(view);return view;
}
export function getTask(tx:WorkspaceTransaction,ctx:{actor:ActorContext;nowMs:number},id:string):Task {
 const actor=taskAccess(tx,ctx.actor,'tasks:read',id,ctx.nowMs);return taskView(tx,actor,taskRecord(tx,actor.workspaceId,id),ctx.nowMs);
}
/** Replay preserves the original DTO, but never bypasses present returned-reference access. */
export function assertTaskOutcomeVisible(tx:WorkspaceTransaction,actor:ActorContext,task:Task,nowMs:number):void {
 if(!validateTask(task)||task.workspace_id!==actor.workspaceId)throw new HttpError('INTERNAL_ERROR',500);
 const current=taskRecord(tx,actor.workspaceId,task.id);taskView(tx,actor,current,nowMs);
 if(actor.projectIds!==null&&(task.project_id===null||!actor.projectIds.includes(task.project_id)))throw new HttpError('FORBIDDEN',403);
 if(task.assigned_agent_id!==null&&!tx.one('SELECT agent_id FROM static_agents WHERE workspace_id=? AND agent_id=?',[actor.workspaceId,task.assigned_agent_id]))throw new HttpError('FORBIDDEN',403);
 for(const run of [task.active_run_id,task.latest_run_id])if(run!==null&&!tx.one('SELECT id FROM runs WHERE workspace_id=? AND task_id=? AND id=?',[actor.workspaceId,task.id,run]))throw new HttpError('FORBIDDEN',403);
 if(task.result!==null){
  const row=tx.one<{id:string}>('SELECT id FROM task_results WHERE workspace_id=? AND task_id=? AND run_id=?',[actor.workspaceId,task.id,task.result.run_id]);
  const result=row?projectTaskResult(tx,actor,task.id,row.id):null;
  if(!result||canonicalJson(result)!==canonicalJson(task.result))throw new HttpError('FORBIDDEN',403);
 }
 assertTaskItemFits(task);
}
