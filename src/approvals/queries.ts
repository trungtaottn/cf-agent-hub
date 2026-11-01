import type {WorkspaceTransaction} from '../storage/transaction';
import type {CommandContext} from '../workspace/context';
import type {Approval} from '../http/dto';
import type {PageData} from '../contracts/r2';
import {HttpError} from '../http/envelopes';
import type {MessagePosition} from '../http/cursors';
import {taskAccess} from '../tasks/repository';
import {validateTaskPage,TASK_SCAN_LIMIT,TASK_SCAN_CHUNK,type TaskPageQuery} from '../tasks/history';
import {MAX_TASK_ITEM_BYTES,jsonBytes} from '../tasks/bounds';
import {approvalRecord,approvalView} from './repository';
export function getApproval(tx:WorkspaceTransaction,ctx:Pick<CommandContext,'actor'|'nowMs'>,id:string):Approval {
 const actor=taskAccess(tx,ctx.actor,'approvals:read',null,ctx.nowMs);
 taskAccess(tx,actor,'tasks:read',null,ctx.nowMs);
 const row=approvalRecord(tx,actor.workspaceId,id);
 // Assignment restricts decisions, not current-scope reads. Bytes retain artifacts:read.
 // Only relationship denial is normalized; current auth/global scopes were checked before lookup.
 try{taskAccess(tx,actor,'approvals:read',row.task_id,ctx.nowMs);return approvalView(tx,actor,row,ctx.nowMs);}
 catch(error){if(error instanceof HttpError&&error.code==='FORBIDDEN')throw new HttpError('NOT_FOUND',404);throw error;}
}
export function listApprovals(tx:WorkspaceTransaction,ctx:Pick<CommandContext,'actor'|'nowMs'>,query:TaskPageQuery):PageData<Approval>{
 const actor=taskAccess(tx,ctx.actor,'approvals:read',null,ctx.nowMs);taskAccess(tx,actor,'tasks:read',null,ctx.nowMs);validateTaskPage(query,ctx.nowMs,actor);
 if(query.binding.operation!=='approvals')throw new HttpError('INVALID_REQUEST',400);
 const high=query.cursor?.highWater??tx.one<MessagePosition>('SELECT created_at AS createdAt,id FROM approvals WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 1',[actor.workspaceId]);
 if(!high)return {items:[],hasMore:false,next:null};
 if(typeof high==='number'||typeof query.cursor?.lastScanned==='number')throw new HttpError('INVALID_REQUEST',400);
 let position=query.cursor?.lastScanned as MessagePosition|undefined,lastReturned=position,scanned=0,bytes=0;
 const items:Approval[]=[];
 const page=(more:boolean):PageData<Approval>=>({items,hasMore:more,next:more&&lastReturned?{version:1,binding:query.binding,highWater:high,lastScanned:lastReturned,expiresAt:query.cursor?.expiresAt??ctx.nowMs+3600000}:null});
 for(;;){
  const cap=Math.min(TASK_SCAN_CHUNK,TASK_SCAN_LIMIT-scanned);if(cap===0)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const rows=tx.all<MessagePosition>(`SELECT created_at AS createdAt,id FROM approvals WHERE workspace_id=? AND (created_at,id)<=(?,?)${position?' AND (created_at,id)>(?,?)':''} ORDER BY created_at,id LIMIT ?`,[actor.workspaceId,high.createdAt,high.id,...(position?[position.createdAt,position.id]:[]),cap]);
  for(const candidate of rows){
   scanned++;position=candidate;let item:Approval;
   try{item=getApproval(tx,{actor,nowMs:ctx.nowMs},candidate.id);}catch(error){if(error instanceof HttpError&&(error.code==='FORBIDDEN'||error.code==='NOT_FOUND'))continue;throw error;}
   const size=jsonBytes(item)+(items.length?1:0);if(items.length===query.limit||bytes+size>MAX_TASK_ITEM_BYTES)return page(true);
   items.push(item);bytes+=size;lastReturned=candidate;
  }
  if(rows.length<cap)return page(false);
 }
}
