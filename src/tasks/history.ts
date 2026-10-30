import type {WorkspaceTransaction} from '../storage/transaction';
import type {CommandContext,ActorContext} from '../workspace/context';
import type {TaskResult} from '../http/dto';
import {validCursorPayload,type CursorBinding,type CursorPayload} from '../http/cursors';
import type {PageData} from '../contracts/r2';
import {HttpError} from '../http/envelopes';
import {taskAccess} from './repository';
import {projectTaskResult} from './results';
import {MAX_TASK_ITEM_BYTES,jsonBytes} from './bounds';
/** Private physical candidate work cap, independently measured in Workers; never a progress cursor. */
export const TASK_SCAN_LIMIT=2048;
export const TASK_SCAN_CHUNK=32;
export interface TaskPageQuery {limit:number;binding:CursorBinding;cursor?:CursorPayload;}
export function validateTaskPage(query:TaskPageQuery,nowMs:number,actor:ActorContext):void {
 if(!Number.isSafeInteger(query.limit)||query.limit<1||query.limit>200)throw new HttpError('INVALID_REQUEST',400);
 const b=query.binding;
 if(b.workspaceId!==actor.workspaceId||b.principalId!==actor.principalId||b.lane!==actor.kind||b.credentialId!==actor.credentialId||b.sessionId!==actor.sessionId||query.cursor&&!validCursorPayload(query.cursor,b))throw new HttpError('INVALID_REQUEST',400);
 if(query.cursor&&query.cursor.expiresAt<=nowMs)throw new HttpError('CURSOR_EXPIRED',410);
}
export function listTaskResults(tx:WorkspaceTransaction,ctx:Pick<CommandContext,'actor'|'nowMs'>,taskId:string,query:TaskPageQuery):PageData<TaskResult>{
 const actor=taskAccess(tx,ctx.actor,'tasks:read',taskId,ctx.nowMs);validateTaskPage(query,ctx.nowMs,actor);
 if(query.binding.operation!=='task-results')throw new HttpError('INVALID_REQUEST',400);
 const high=query.cursor?.highWater??tx.one<{sequence:number}>('SELECT submission_sequence AS sequence FROM task_results WHERE workspace_id=? AND task_id=? ORDER BY submission_sequence DESC LIMIT 1',[actor.workspaceId,taskId])?.sequence??0;
 const initialPosition=query.cursor?.lastScanned??0;
 if(typeof high!=='number'||typeof initialPosition!=='number'||!Number.isSafeInteger(high)||high<0||initialPosition>high)throw new HttpError('INVALID_REQUEST',400);
 let position:number=initialPosition;
 const items:TaskResult[]=[];let lastReturned=position,scanned=0,bytes=0;
 const page=(more:boolean):PageData<TaskResult>=>({items,hasMore:more,next:more?{version:1,binding:query.binding,highWater:high,lastScanned:lastReturned,expiresAt:query.cursor?.expiresAt??ctx.nowMs+3600000}:null});
 while(position<high){
  // Unfiltered indexed candidates: authorization is deliberately outside this physical LIMIT.
  const cap=Math.min(TASK_SCAN_CHUNK,TASK_SCAN_LIMIT-scanned);
  if(cap===0)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const rows=tx.all<{sequence:number}>(`SELECT submission_sequence AS sequence FROM task_results WHERE workspace_id=? AND task_id=? AND submission_sequence>? AND submission_sequence<=? ORDER BY submission_sequence LIMIT ?`,[actor.workspaceId,taskId,position,high,cap]);
  for(const row of rows){
   scanned++;position=row.sequence;
   const key=tx.one<{id:string|null}>('SELECT CASE WHEN length(CAST(id AS BLOB))<=? THEN id ELSE NULL END AS id FROM task_results WHERE workspace_id=? AND task_id=? AND submission_sequence=?',[MAX_TASK_ITEM_BYTES,actor.workspaceId,taskId,row.sequence]);
   if(!key||key.id===null)throw new HttpError('INTERNAL_ERROR',500);
   const result=projectTaskResult(tx,actor,taskId,key.id);if(!result)continue;
   const size=jsonBytes(result)+(items.length?1:0);
   if(items.length===query.limit||bytes+size>MAX_TASK_ITEM_BYTES)return page(true);
   items.push(result);bytes+=size;lastReturned=row.sequence;
  }
  if(rows.length<cap||position===high)return page(false);
 }
 return page(false);
}
