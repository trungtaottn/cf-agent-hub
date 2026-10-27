import type {WorkspaceTransaction} from '../storage/transaction';
import type {CommandContext} from '../workspace/context';
import type {Task,TaskState} from '../http/dto';
import type {PageData} from '../contracts/r2';
import {comparePosition,type MessagePosition} from '../http/cursors';
import {HttpError} from '../http/envelopes';
import {taskAccess,taskRecord,taskVisible,taskView} from './repository';
import {validateTaskPage,TASK_SCAN_LIMIT,type TaskPageQuery} from './history';
import {MAX_TASK_ITEM_BYTES,jsonBytes} from './bounds';
export const TASK_STATES:readonly TaskState[]=['backlog','ready','doing','waiting','review','done','cancelled'];
export interface TaskListQuery extends TaskPageQuery {state?:TaskState;project_id?:string;}
export function listTasks(tx:WorkspaceTransaction,ctx:Pick<CommandContext,'actor'|'nowMs'>,query:TaskListQuery):PageData<Task>{
 const actor=taskAccess(tx,ctx.actor,'tasks:read',null,ctx.nowMs);validateTaskPage(query,ctx.nowMs,actor);
 if(query.binding.operation!=='tasks'||query.state!==undefined&&!TASK_STATES.includes(query.state))throw new HttpError('INVALID_REQUEST',400);
 if(query.project_id!==undefined&&actor.projectIds!==null&&!actor.projectIds.includes(query.project_id))throw new HttpError('FORBIDDEN',403);
 const states=query.state?[query.state]:TASK_STATES;
 let high=query.cursor?.highWater;
 if(high===undefined){
  // Seven fixed indexed equality streams, not global workspace sort/scan.
  const peaks=states.flatMap(state=>{const p=tx.one<MessagePosition>(`SELECT created_at AS createdAt,CASE WHEN length(CAST(id AS BLOB))<=? THEN id ELSE NULL END AS id FROM tasks WHERE workspace_id=? AND state=? ORDER BY tasks.created_at DESC,tasks.id DESC LIMIT 1`,[MAX_TASK_ITEM_BYTES,actor.workspaceId,state]);return p?[p]:[];});
  if(peaks.some(p=>p.id===null))throw new HttpError('INTERNAL_ERROR',500);
  high=peaks.sort(comparePosition).at(-1);
 }
 if(high===undefined)return {items:[],next:null,hasMore:false};
 if(typeof high==='number'||typeof query.cursor?.lastScanned==='number')throw new HttpError('INVALID_REQUEST',400);
 const ceiling=high,last=query.cursor?.lastScanned as MessagePosition|undefined;
 type Candidate=MessagePosition&{projectId:string|null;oversize:number};
 type Stream={state:TaskState;rows:Candidate[];after:MessagePosition|undefined;ended:boolean;};
 const streams:Stream[]=states.map(state=>({state,rows:[],after:last,ended:false}));
 let fetched=0;
 function fill(stream:Stream):void{
  if(stream.ended||stream.rows.length)return;
  const remaining=TASK_SCAN_LIMIT-fetched,cap=1; // One head, including a bounded terminal probe.
  const after=stream.after;
  const rows=tx.all<Candidate>(`SELECT created_at AS createdAt,CASE WHEN length(CAST(id AS BLOB))<=? THEN id ELSE NULL END AS id,CASE WHEN coalesce(length(CAST(project_id AS BLOB)),0)<=? THEN project_id ELSE NULL END AS projectId,coalesce(length(CAST(project_id AS BLOB)),0)>? AS oversize FROM tasks WHERE workspace_id=? AND state=? AND (created_at,id)<=(?,?)${after?' AND (created_at,id)>(?,?)':''} ORDER BY tasks.created_at,tasks.id LIMIT ?`,[MAX_TASK_ITEM_BYTES,MAX_TASK_ITEM_BYTES,MAX_TASK_ITEM_BYTES,actor.workspaceId,stream.state,ceiling.createdAt,ceiling.id,...(after?[after.createdAt,after.id]:[]),cap]);
  if(rows.length>remaining)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  fetched+=rows.length;stream.rows=[...rows];stream.ended=rows.length<cap;
 }
 const items:Task[]=[];let bytes=0,lastReturned=last;
 const page=(more:boolean):PageData<Task>=>({items,hasMore:more,next:more&&lastReturned?{version:1,binding:query.binding,highWater:ceiling,lastScanned:lastReturned,expiresAt:query.cursor?.expiresAt??ctx.nowMs+3600000}:null});
 for(;;){
  for(const stream of streams)fill(stream);
  const available=streams.filter(s=>s.rows.length);if(!available.length)return page(false);
  available.sort((a,b)=>comparePosition(a.rows[0],b.rows[0]));const stream=available[0],row=stream.rows.shift()!;
  if(row.id===null||row.oversize)throw new HttpError('INTERNAL_ERROR',500);stream.after={createdAt:row.createdAt,id:row.id};
  if(query.project_id!==undefined&&row.projectId!==query.project_id||!taskVisible(actor,{workspace_id:actor.workspaceId,project_id:row.projectId}))continue;
  let view:Task;try{view=taskView(tx,actor,taskRecord(tx,actor.workspaceId,row.id),ctx.nowMs);}catch(error){if(error instanceof HttpError&&error.code==='FORBIDDEN')continue;throw error;}
  const size=jsonBytes(view)+(items.length?1:0);
  if(items.length===query.limit||bytes+size>MAX_TASK_ITEM_BYTES)return page(true);
  items.push(view);bytes+=size;lastReturned={createdAt:row.createdAt,id:row.id};
 }
}
