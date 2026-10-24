import type {WorkspaceTransaction} from '../storage/transaction';
import type {Message,MessageNotification} from '../http/dto';
import {validateMessageNotification} from '../http/generated/auth-validators.js';
import {settingsPolicy} from '../config/policy';
import {approvedHttpsUrl} from '../config/deployment';
import {canonicalJson} from '../config/bootstrap';
import {HttpError} from '../http/envelopes';
import {markSchedulerDirty} from './scheduler-state';
import type {ActorContext} from '../workspace/context';
export interface DeliveryReservation{deliveryId:string;retryMultiplier:number;}
export interface OutboxInsert{
 deliveryId:string;workspaceId:string;messageId:string;eventId:string;destinationId:string;
 payloadVersion:1;attemptCount:0;nextDueAt:number;status:'pending';payloadJson:string;
 destinationSnapshotJson:string;retryMultiplier:number;createdAt:number;
}
export interface NotificationMessage extends Message{actor:ActorContext;deliveries:ReadonlyMap<string,DeliveryReservation>;}
/** Canonical payload/routing bytes are constructed once, before any dispatch. No credential value is read. */
export function planNotifications(tx:WorkspaceTransaction,message:NotificationMessage,eventId:string,nowMs:number):readonly OutboxInsert[]{
 const {policy}=settingsPolicy(tx,message.actor),out:OutboxInsert[]=[];
 for(const destination of policy.notification_destinations){
  if(!destination.enabled||!message.recipient_agent_ids.includes(destination.agent_id))continue;
  const reservation=message.deliveries.get(destination.destination_id);if(!reservation)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const url=new URL(destination.url);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const payload:MessageNotification={payload_version:1,type:'message.accepted',delivery_id:reservation.deliveryId,workspace_id:message.workspace_id,recipient_agent_id:destination.agent_id,message_id:message.id,thread_id:message.thread_id,event_id:eventId,occurred_at:new Date(nowMs).toISOString()};
  if(!validateMessageNotification(payload))throw new HttpError('INTERNAL_ERROR',500);
  out.push({deliveryId:reservation.deliveryId,workspaceId:message.workspace_id,messageId:message.id,eventId,destinationId:destination.destination_id,payloadVersion:1,attemptCount:0,nextDueAt:nowMs,status:'pending',payloadJson:canonicalJson(payload),destinationSnapshotJson:canonicalJson({agent_id:destination.agent_id,url:url.href,signing_key_ref:destination.signing_key_ref}),retryMultiplier:reservation.retryMultiplier,createdAt:nowMs});
 }
 return out;
}
export function insertNotifications(tx:WorkspaceTransaction,rows:readonly OutboxInsert[]):void{
 for(const row of rows){
  tx.exec(`INSERT INTO outbox (id,workspace_id,message_id,destination_id,notification_id,payload_json,destination_snapshot_json,status,attempts,next_due_at,retry_multiplier,lease_token,lease_expires_at,last_status,last_error,created_at,updated_at)
   VALUES (?,?,?,?,?,?,?,'pending',0,?,?,NULL,NULL,NULL,NULL,?,?)`,[row.deliveryId,row.workspaceId,row.messageId,row.destinationId,row.deliveryId,row.payloadJson,row.destinationSnapshotJson,row.nextDueAt,row.retryMultiplier,row.createdAt,row.createdAt]);
  markSchedulerDirty(tx);
 }
}

export type DeliveryResult=
 | {kind:'delivered';status:number}
 | {kind:'transient';category:string;status?:number;retryAfterSeconds?:number}
 | {kind:'permanent';category:string;status?:number}
 | {kind:'obsolete'} | {kind:'paused'};
export interface DestinationSnapshot{agent_id:string;url:string;signing_key_ref:string;}
export interface OutboxRow{
 id:string;workspace_id:string;message_id:string;destination_id:string;notification_id:string;
 payload_json:string;destination_snapshot_json:string|null;status:string;attempts:number;next_due_at:number;
 retry_multiplier:number;lease_token:string|null;lease_expires_at:number|null;last_status:number|null;last_error:string|null;
 created_at:number;updated_at:number;
}
export interface DeliveryAttempt{
 deliveryId:string;attemptId:string;attemptNumber:number;leaseExpiresAt:number;payloadJson:string;
 destinationId:string;destination:DestinationSnapshot;notification:MessageNotification;
}
const delays=[5,30,120,600,3600] as const;
export function retryDelayMs(attemptNumber:number,jitter:number,hint?:number,cap=3600):number{
 const nominal=delays[attemptNumber-1];if(nominal===undefined)throw Error('RETRY_BUDGET_EXHAUSTED');
 const bounded=cap>0&&hint!==undefined&&Number.isFinite(hint)&&hint>=0?Math.min(hint,cap):0;
 return Math.ceil(Math.max(nominal*jitter,bounded)*1000);
}
function snapshot(value:unknown):value is DestinationSnapshot{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const r=value as Record<string,unknown>;
 return Object.keys(r).length===3&&['agent_id','url','signing_key_ref'].every(k=>typeof r[k]==='string'&&(r[k] as string).length>0);
}
/** Validation reads relationships only; it never reconstructs or replaces immutable wire bytes. */
export function validateIntent(tx:WorkspaceTransaction,row:OutboxRow):{notification:MessageNotification;destination:DestinationSnapshot}|null{
 try{
  if(!tx.one('SELECT workspace_id FROM workspace_metadata WHERE id=1 AND workspace_id=?',[row.workspace_id]))return null;
  const notification:unknown=JSON.parse(row.payload_json),destination:unknown=row.destination_snapshot_json===null?null:JSON.parse(row.destination_snapshot_json);
  if(!validateMessageNotification(notification)||!snapshot(destination)||!approvedHttpsUrl(destination.url)||canonicalJson(destination)!==row.destination_snapshot_json||row.id!==row.notification_id||row.id!==notification.delivery_id||
   row.workspace_id!==notification.workspace_id||row.message_id!==notification.message_id||destination.agent_id!==notification.recipient_agent_id||
   !Number.isInteger(row.attempts)||row.attempts<0||row.attempts>6||!Number.isFinite(row.retry_multiplier)||row.retry_multiplier<.8||row.retry_multiplier>1)return null;
  const message=tx.one<{thread_id:string;created_at:number;sender_kind:string;sender_principal_id:string;sender_agent_id:string|null}>(`SELECT m.thread_id,m.created_at,m.sender_kind,m.sender_principal_id,m.sender_agent_id FROM messages m
   JOIN threads t ON t.id=m.thread_id AND t.workspace_id=m.workspace_id WHERE m.id=? AND m.workspace_id=?`,[row.message_id,row.workspace_id]);
  const event=tx.one<{occurred_at:number;actor_json:string}>(`SELECT occurred_at,actor_json FROM events WHERE id=? AND workspace_id=? AND type='message.accepted' AND resource_type='message' AND resource_id=? AND thread_id=?`,[notification.event_id,row.workspace_id,row.message_id,notification.thread_id]);
  if(!message||!event||message.thread_id!==notification.thread_id||message.created_at!==row.created_at||event.occurred_at!==row.created_at||
   notification.occurred_at!==new Date(event.occurred_at).toISOString()||
   !tx.one('SELECT message_id FROM inbox WHERE message_id=? AND workspace_id=? AND recipient_agent_id=?',[row.message_id,row.workspace_id,notification.recipient_agent_id]))return null;
  const actor=JSON.parse(event.actor_json) as Record<string,unknown>;
  if(actor.kind!==message.sender_kind||actor.principal_id!==message.sender_principal_id||actor.agent_id!==message.sender_agent_id)return null;
  return {notification,destination};
 }catch{return null;}
}
function acknowledged(tx:WorkspaceTransaction,row:OutboxRow,notification:MessageNotification):boolean{
 return tx.one<{acknowledged_at:number|null}>('SELECT acknowledged_at FROM inbox WHERE message_id=? AND workspace_id=? AND recipient_agent_id=?',[row.message_id,row.workspace_id,notification.recipient_agent_id])?.acknowledged_at!=null;
}
function disposition(tx:WorkspaceTransaction,row:OutboxRow,status:string,category:string|null,nowMs:number,httpStatus:number|null=null,nextDueAt=row.next_due_at):void{
 tx.exec('UPDATE outbox SET status=?,last_status=?,last_error=?,next_due_at=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?',[status,httpStatus,category,nextDueAt,nowMs,row.id]);markSchedulerDirty(tx);
}
function retryCap(tx:WorkspaceTransaction,workspaceId:string):number{
 const raw=tx.one<{config_json:string}>('SELECT config_json FROM workspace_metadata WHERE id=1')?.config_json;
 try{const config=JSON.parse(raw??'null') as {workspace_policies?:{workspace_id:string;retry_after_max_seconds:number}[]};const cap=config?.workspace_policies?.find(p=>p.workspace_id===workspaceId)?.retry_after_max_seconds;return typeof cap==='number'&&Number.isInteger(cap)&&cap>=0&&cap<=3600?cap:0;}catch{return 0;}
}
/** A transaction reserves the spent budget and unique token before any async preparation. */
export function claimDue(tx:WorkspaceTransaction,nowMs:number,limit:25):readonly DeliveryAttempt[]{
 const claimed:DeliveryAttempt[]=[];
 const metadata=tx.one<{admission_state:string}>('SELECT admission_state FROM workspace_metadata WHERE id=1');
 if(metadata?.admission_state!=='installed'||tx.one('SELECT id FROM maintenance_state WHERE id=1'))return claimed;
 const rows=tx.all<OutboxRow>(`SELECT * FROM outbox WHERE (status='pending' AND next_due_at<=?) OR (status='in_flight' AND lease_expires_at<=?) ORDER BY CASE WHEN status='in_flight' THEN lease_expires_at ELSE next_due_at END,id LIMIT ?`,[nowMs,nowMs,Math.min(25,Math.max(0,limit))]);
 for(const row of rows){
  // Legacy NULL routing is non-executable history. Preserve its prior transport and lease evidence.
  if(row.destination_snapshot_json===null){tx.exec("UPDATE outbox SET status='cancelled',updated_at=? WHERE id=?",[nowMs,row.id]);markSchedulerDirty(tx);continue;}
  const intent=validateIntent(tx,row);
  if(!intent){disposition(tx,row,'cancelled','invalid_intent',nowMs);continue;}
  // Expired reservations are unknown, never returned as an unspent attempt.
  if(row.status==='in_flight'){
   if(acknowledged(tx,row,intent.notification))disposition(tx,row,'suppressed','outcome_unknown',nowMs);
   else if(row.attempts>=6)disposition(tx,row,'exhausted','outcome_unknown',nowMs);
   else disposition(tx,row,'pending','outcome_unknown',nowMs,null,nowMs+retryDelayMs(row.attempts,row.retry_multiplier,undefined,retryCap(tx,row.workspace_id)));
   continue;
  }
  if(acknowledged(tx,row,intent.notification)){disposition(tx,row,'suppressed',row.last_error,nowMs,row.last_status);continue;}
  if(row.attempts>=6){disposition(tx,row,'exhausted',row.last_error,nowMs,row.last_status);continue;}
  const attemptNumber=row.attempts+1,attemptId=JSON.stringify([row.id,attemptNumber]),leaseExpiresAt=nowMs+30000;
  tx.exec("UPDATE outbox SET status='in_flight',attempts=?,lease_token=?,lease_expires_at=?,updated_at=? WHERE id=?",[attemptNumber,attemptId,leaseExpiresAt,nowMs,row.id]);markSchedulerDirty(tx);
  claimed.push({deliveryId:row.id,attemptId,attemptNumber,leaseExpiresAt,payloadJson:row.payload_json,destinationId:row.destination_id,...intent});
 }
 return claimed;
}
export function liveAttempt(tx:WorkspaceTransaction,attempt:DeliveryAttempt,nowMs:number):OutboxRow|null{
 const row=tx.one<OutboxRow>("SELECT * FROM outbox WHERE id=? AND status='in_flight' AND lease_token=? AND attempts=? AND lease_expires_at>?",[attempt.deliveryId,attempt.attemptId,attempt.attemptNumber,nowMs]);
 return row&&row.lease_expires_at===attempt.leaseExpiresAt&&row.payload_json===attempt.payloadJson&&row.destination_id===attempt.destinationId&&row.destination_snapshot_json===canonicalJson(attempt.destination)?row:null;
}
/** Late responses cannot overwrite another attempt or reclaim an expired lease. */
export function finishAttempt(tx:WorkspaceTransaction,attemptId:string,result:DeliveryResult,nowMs:number):void{
 if(result.kind==='obsolete'||result.kind==='paused'||tx.one('SELECT id FROM maintenance_state WHERE id=1')||
  tx.one<{admission_state:string}>('SELECT admission_state FROM workspace_metadata WHERE id=1')?.admission_state!=='installed')return;
 const row=tx.one<OutboxRow>("SELECT * FROM outbox WHERE status='in_flight' AND lease_token=? AND lease_expires_at>?",[attemptId,nowMs]);if(!row)return;
 if(result.kind==='delivered'){disposition(tx,row,'succeeded',null,nowMs,result.status);return;}
 if(result.kind==='permanent'){disposition(tx,row,'cancelled',result.category,nowMs,result.status??null);return;}
 const intent=validateIntent(tx,row);
 const status=intent&&acknowledged(tx,row,intent.notification)?'suppressed':row.attempts>=6?'exhausted':'pending';
 disposition(tx,row,status,result.category,nowMs,result.status??null,status==='pending'?nowMs+retryDelayMs(row.attempts,row.retry_multiplier,result.retryAfterSeconds,retryCap(tx,row.workspace_id)):row.next_due_at);
}
