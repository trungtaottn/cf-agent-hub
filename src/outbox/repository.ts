import type {WorkspaceTransaction} from '../storage/transaction';
import type {Message,MessageNotification} from '../http/dto';
import {validateMessageNotification} from '../http/generated/auth-validators.js';
import {settingsPolicy} from '../config/policy';
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
