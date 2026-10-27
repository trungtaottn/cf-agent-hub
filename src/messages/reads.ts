import {messageArtifactIds} from '../auth/resource-visibility';
import {assertAdmissionOpen} from '../recovery/maintenance';
import type {WorkspaceTransaction,SqlValue} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import type {Message,Event} from '../http/dto';
import {validateMessage} from '../http/generated/auth-validators.js';
import {authorize,refreshActor} from '../auth/authorize';
import {settingsPolicy} from '../config/policy';
import {HttpError} from '../http/envelopes';
import {assertMessageVisible,threadParticipants,isParticipant,inaccessible} from './references';
import {projectEvent,resourceEventVisibility} from '../audit/events';
import {comparePosition,type CursorBinding,type CursorPayload,type CursorPosition,type MessagePosition} from '../http/cursors';
export interface PageQuery{limit:number;nowMs:number;binding:CursorBinding;cursor?:CursorPayload;}
export interface InboxQuery extends PageQuery{acknowledged:boolean;}
export interface EventQuery extends PageQuery{afterSequence:number;}
export interface Page<T>{data:readonly T[];cursor:CursorPayload|null;scannedIds:readonly string[];}
interface MessageRow{id:string;workspace_id:string;thread_id:string;sender_kind:Message['sender']['kind'];sender_principal_id:string;sender_agent_id:string|null;body:string;refs_json:string;created_at:number;}
interface RetentionRow{message_retained_after_created_at:number|null;message_retained_after_id:string|null;event_retained_after_sequence:number|null;}
function limit(value:number,max:number){if(!Number.isSafeInteger(value)||value<1||value>max)throw new HttpError('INVALID_REQUEST',400);}
export function assertReadAccess(tx:WorkspaceTransaction,actor:ActorContext,operation:CursorBinding['operation'],threadId:string|null,nowMs:number):ActorContext{
 const live=refreshActor(tx,actor,nowMs);settingsPolicy(tx,live);
 authorize(tx,live,operation==='events'?'events:read':'messages:read',undefined,nowMs);
 if(operation!=='events'&&live.projectIds!==null)throw new HttpError('FORBIDDEN',403);
 if(operation==='inbox'&&live.kind!=='agent')throw new HttpError('FORBIDDEN',403);
 if(operation==='thread'&&!(live.kind==='human'&&live.scopes.has('messages:review'))&&!isParticipant(threadParticipants(tx,live.workspaceId,threadId!),live))inaccessible();
 if(operation==='thread')threadParticipants(tx,live.workspaceId,threadId!);
 return live;
}
/** Only a committed retention prefix is proof. Missing scanned rows can be ordinary deletion. */
export function assertCursorRetained(tx:WorkspaceTransaction,cursor:CursorPayload|undefined):void{
 if(!cursor)return;
 const row=tx.one<RetentionRow>('SELECT message_retained_after_created_at,message_retained_after_id,event_retained_after_sequence FROM workspace_metadata WHERE id=1');
 if(!row)throw new HttpError('INTERNAL_ERROR',500);
 const floor=cursor.binding.operation==='events'?row.event_retained_after_sequence:
 row.message_retained_after_created_at!==null&&row.message_retained_after_id!==null?{createdAt:row.message_retained_after_created_at,id:row.message_retained_after_id}:null;
 if(floor!==null&&comparePosition(floor,cursor.lastScanned)>0)throw new HttpError('CURSOR_EXPIRED',410);
}
/** Internal retention integration: call in the SAME transaction as proven prefix truncation.
 * Never use for individual deletion or ACK; there is no public retention mutation route. */
export function recordRetentionFloor(tx:WorkspaceTransaction,workspaceId:string,floor:CursorPosition):void{
 assertAdmissionOpen(tx);
 const row=tx.one<RetentionRow>('SELECT message_retained_after_created_at,message_retained_after_id,event_retained_after_sequence FROM workspace_metadata WHERE id=1 AND workspace_id=?',[workspaceId]);
 if(!row)return inaccessible();
 if(typeof floor==='number'){
  if(!Number.isSafeInteger(floor)||floor<0)throw new HttpError('INVALID_REQUEST',400);
  if(row.event_retained_after_sequence===null||floor>row.event_retained_after_sequence)tx.exec('UPDATE workspace_metadata SET event_retained_after_sequence=? WHERE id=1 AND workspace_id=?',[floor,workspaceId]);
 }else{
  if(!Number.isSafeInteger(floor.createdAt)||floor.createdAt<0||!floor.id)throw new HttpError('INVALID_REQUEST',400);
  const prior=row.message_retained_after_created_at===null||row.message_retained_after_id===null?null:{createdAt:row.message_retained_after_created_at,id:row.message_retained_after_id};
  if(prior===null||comparePosition(floor,prior)>0)tx.exec('UPDATE workspace_metadata SET message_retained_after_created_at=?,message_retained_after_id=? WHERE id=1 AND workspace_id=?',[floor.createdAt,floor.id,workspaceId]);
 }
}
export function projectMessage(tx:WorkspaceTransaction,actor:ActorContext,id:string,nowMs:number):Message|null{
 try{assertMessageVisible(tx,actor,id,nowMs);}catch(error){if(error instanceof HttpError&&error.code==='NOT_FOUND')return null;throw error;}
 const row=tx.one<MessageRow>('SELECT * FROM messages WHERE id=? AND workspace_id=?',[id,actor.workspaceId]);if(!row)return null;
 const recipients=tx.all<{recipient_agent_id:string;acknowledged_at:number|null}>('SELECT recipient_agent_id,acknowledged_at FROM inbox WHERE message_id=? AND workspace_id=? ORDER BY recipient_agent_id',[id,actor.workspaceId]);
 const ack=actor.kind==='agent'?recipients.find(x=>x.recipient_agent_id===actor.agentId)?.acknowledged_at:null;
 const message:Message={id:row.id,workspace_id:row.workspace_id,thread_id:row.thread_id,sender:{kind:row.sender_kind,principal_id:row.sender_principal_id,agent_id:row.sender_agent_id},recipient_agent_ids:recipients.map(x=>x.recipient_agent_id),body:row.body,refs:JSON.parse(row.refs_json) as Message['refs'],artifact_ids:messageArtifactIds(tx,actor.workspaceId,id),created_at:new Date(row.created_at).toISOString(),acknowledged_at:ack==null?null:new Date(ack).toISOString()};
 if(!validateMessage(message))throw new HttpError('INTERNAL_ERROR',500);return message;
}
function continuation(query:PageQuery,highWater:CursorPosition,lastScanned:CursorPosition,more:boolean):CursorPayload|null{
 return more?{version:1,binding:query.binding,highWater,lastScanned,expiresAt:query.cursor?.expiresAt??query.nowMs+3600000}:null;
}
function messages(tx:WorkspaceTransaction,actor:ActorContext,query:PageQuery,where:string,bindings:SqlValue[]):Page<Message>{
 assertCursorRetained(tx,query.cursor);
 const high=query.cursor?.highWater??tx.one<{createdAt:number;id:string}>('SELECT m.created_at AS createdAt,m.id FROM messages m '+where+' ORDER BY m.created_at DESC,m.id DESC LIMIT 1',bindings);
 if(high==null)return {data:[],cursor:null,scannedIds:[]};if(typeof high==='number')throw new HttpError('INVALID_REQUEST',400);
 const last=query.cursor?.lastScanned;if(typeof last==='number')throw new HttpError('INVALID_REQUEST',400);
 const bound=where+' AND (m.created_at,m.id)<=(?,?)'+(last?' AND (m.created_at,m.id)>(?,?)':'');
 const args:SqlValue[]=[...bindings,high.createdAt,high.id,...(last?[last.createdAt,last.id]:[])];
 const rows=tx.all<{id:string;createdAt:number}>('SELECT m.id,m.created_at AS createdAt FROM messages m '+bound+' ORDER BY m.created_at,m.id LIMIT ?',[...args,query.limit]);
 const end=rows.at(-1),more=!!end&&!!tx.one('SELECT m.id FROM messages m '+where+' AND (m.created_at,m.id)>(?,?) AND (m.created_at,m.id)<=(?,?) LIMIT 1',[...bindings,end.createdAt,end.id,high.createdAt,high.id]);
 return {data:rows.flatMap(row=>{const m=projectMessage(tx,actor,row.id,query.nowMs);return m?[m]:[];}),cursor:end?continuation(query,high,end,more):null,scannedIds:rows.map(r=>r.id)};
}
export function readInbox(tx:WorkspaceTransaction,actor:ActorContext,query:InboxQuery):Page<Message>{
 limit(query.limit,200);const live=assertReadAccess(tx,actor,'inbox',null,query.nowMs);
 return messages(tx,live,query,'JOIN inbox i ON i.message_id=m.id AND i.workspace_id=m.workspace_id WHERE m.workspace_id=? AND i.recipient_agent_id=? AND i.acknowledged_at IS '+(query.acknowledged?'NOT NULL':'NULL'),[live.workspaceId,live.agentId!]);
}
export function readThread(tx:WorkspaceTransaction,actor:ActorContext,threadId:string,query:PageQuery):Page<Message>{
 limit(query.limit,500);const live=assertReadAccess(tx,actor,'thread',threadId,query.nowMs);
 return messages(tx,live,query,'WHERE m.workspace_id=? AND m.thread_id=?',[live.workspaceId,threadId]);
}
export function readEvents(tx:WorkspaceTransaction,actor:ActorContext,query:EventQuery):Page<Event>{
 limit(query.limit,200);const live=assertReadAccess(tx,actor,'events',null,query.nowMs);assertCursorRetained(tx,query.cursor);
 if(!Number.isSafeInteger(query.afterSequence)||query.afterSequence<0)throw new HttpError('INVALID_REQUEST',400);
 const high=query.cursor?.highWater??tx.one<{n:number|null}>('SELECT MAX(sequence) AS n FROM events WHERE workspace_id=?',[live.workspaceId])?.n??0;
 const last=query.cursor?.lastScanned??query.afterSequence;if(typeof high!=='number'||typeof last!=='number')throw new HttpError('INVALID_REQUEST',400);
 const rows=tx.all<{id:string;sequence:number}>('SELECT id,sequence FROM events WHERE workspace_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?',[live.workspaceId,last,high,query.limit]);
 const end=rows.at(-1),more=!!end&&!!tx.one('SELECT id FROM events WHERE workspace_id=? AND sequence>? AND sequence<=? LIMIT 1',[live.workspaceId,end.sequence,high]);
 return {data:rows.flatMap(row=>{const e=projectEvent(tx,live,row.id,query.nowMs,resourceEventVisibility);return e?[e]:[];}),cursor:end?continuation(query,high,end.sequence,more):null,scannedIds:rows.map(r=>r.id)};
}
