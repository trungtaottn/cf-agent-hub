import type {Message,MessageCreateRequest} from '../http/dto';
import {validateMessage,validateMessageCreateRequest} from '../http/generated/auth-validators.js';
import type {CommandContext} from '../workspace/context';
import type {CommandDescriptor} from '../workspace/commands';
import type {WorkspaceTransaction} from '../storage/transaction';
import {withTransaction} from '../storage/transaction';
import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {settingsPolicy} from '../config/policy';
import {canonicalJson} from '../config/bootstrap';
import {HttpError} from '../http/envelopes';
import {threadParticipants,isParticipant,validateMessageReferences,assertMessageVisible,assertAcceptedMessageVisible,inaccessible,type Participant} from './references';
import {referenceArtifacts} from '../auth/resource-visibility';
import {planNotifications,insertNotifications,type DeliveryReservation} from '../outbox/repository';
interface PreparedMessage{messageId:string;threadId:string;deliveries:ReadonlyMap<string,DeliveryReservation>;}
interface MessageContext extends CommandContext{prepared:PreparedMessage;}
function validateInput(body:MessageCreateRequest):void{
 if(Array.isArray(body?.artifact_ids)&&body.artifact_ids.length>5)throw new HttpError('LIMIT_EXCEEDED',413);
 if(!validateMessageCreateRequest(body))throw new HttpError('INVALID_REQUEST',400);
 const bytes=(s:string)=>new TextEncoder().encode(s).byteLength;
 if(bytes(body.body)>32768||bytes(canonicalJson(body.refs))>8192)throw new HttpError('LIMIT_EXCEEDED',413);
 referenceArtifacts(body.refs,body.artifact_ids);
}
function participantsFor(tx:WorkspaceTransaction,ctx:CommandContext,input:MessageCreateRequest):readonly Participant[]{
 const participants=input.thread_id?threadParticipants(tx,ctx.actor.workspaceId,input.thread_id):[
  {kind:ctx.actor.kind,id:ctx.actor.kind==='agent'?ctx.actor.agentId!:ctx.actor.principalId},
  ...input.recipient_agent_ids.map(id=>({kind:'agent' as const,id}))
 ];
 if(input.thread_id&&(!isParticipant(participants,ctx.actor)||input.recipient_agent_ids.some(id=>!participants.some(p=>p.kind==='agent'&&p.id===id))))inaccessible();
 return participants.filter((p,i)=>participants.findIndex(q=>p.kind===q.kind&&p.id===q.id)===i);
}
export function createMessage(tx:WorkspaceTransaction,ctx:MessageContext,input:MessageCreateRequest):Message{
 validateInput(input);settingsPolicy(tx,ctx.actor);const participants=participantsFor(tx,ctx,input);
 validateMessageReferences(tx,ctx.actor,participants,input.refs,input.artifact_ids,ctx.nowMs);
 const threadId=input.thread_id??ctx.prepared.threadId;
 if(!input.thread_id){
  tx.exec('INSERT INTO threads (id,workspace_id,subject,created_at) VALUES (?,?,?,?)',[threadId,ctx.actor.workspaceId,'',ctx.nowMs]);
  for(const p of participants)tx.exec('INSERT INTO thread_participants (thread_id,participant_kind,participant_id) VALUES (?,?,?)',[threadId,p.kind,p.id]);
 }
 const message:Message={id:ctx.prepared.messageId,workspace_id:ctx.actor.workspaceId,thread_id:threadId,sender:{kind:ctx.actor.kind,principal_id:ctx.actor.principalId,agent_id:ctx.actor.agentId},recipient_agent_ids:[...input.recipient_agent_ids],body:input.body,refs:input.refs,artifact_ids:[...input.artifact_ids],created_at:new Date(ctx.nowMs).toISOString(),acknowledged_at:null};
 if(!validateMessage(message))throw new HttpError('INTERNAL_ERROR',500);
 tx.exec('INSERT INTO messages (id,workspace_id,thread_id,sender_kind,sender_principal_id,sender_agent_id,body,refs_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[message.id,message.workspace_id,threadId,ctx.actor.kind,ctx.actor.principalId,ctx.actor.agentId,message.body,canonicalJson(message.refs),ctx.nowMs]);
 for(const [ordinal,artifactId] of input.artifact_ids.entries()){
  tx.exec('INSERT INTO message_artifacts(workspace_id,message_id,artifact_id,ordinal) VALUES(?,?,?,?)',[message.workspace_id,message.id,artifactId,ordinal]);
  tx.exec("INSERT INTO artifact_associations(workspace_id,artifact_id,resource_kind,resource_id) VALUES(?,?,'message',?)",[message.workspace_id,artifactId,message.id]);
 }
 assertAcceptedMessageVisible(tx,ctx.actor,participants,message.id,ctx.nowMs);
 for(const recipient of input.recipient_agent_ids)tx.exec('INSERT INTO inbox (message_id,recipient_agent_id,workspace_id,created_at,acknowledged_at) VALUES (?,?,?,?,NULL)',[message.id,recipient,message.workspace_id,ctx.nowMs]);
 return message;
}
/** All server IDs and jitter entropy are reserved outside transactionSync, including unused replay reservations. */
export function messageCommand(workspace:AuthWorkspace):CommandDescriptor<MessageCreateRequest,Message>{
 const id=(prefix:string)=>prefix+Array.from(workspace.entropy.bytes(24),b=>b.toString(16).padStart(2,'0')).join('');
 const config=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace)).config,policy=config.workspace_policies.find(x=>x.workspace_id===workspace.workspaceId);
 if(!policy)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 const prepared:PreparedMessage={messageId:id('message_'),threadId:id('thread_'),deliveries:new Map(policy.notification_destinations.map(d=>[d.destination_id,{deliveryId:id('delivery_'),retryMultiplier:.8+.2*workspace.entropy.bytes(1)[0]/255}]))};
 return {operation:'messages:send',target:'messages',resource:(_tx,_ctx,input)=>({kind:'message',id:input.thread_id??'messages',projectId:null}),
  checkAccess(tx,ctx,input){validateInput(input);settingsPolicy(tx,ctx.actor);const participants=participantsFor(tx,ctx,input);validateMessageReferences(tx,ctx.actor,participants,input.refs,input.artifact_ids,ctx.nowMs);},
  checkReplay(tx,ctx,_input,outcome){if(!validateMessage(outcome.data)||outcome.data.workspace_id!==ctx.actor.workspaceId)throw new HttpError('INTERNAL_ERROR',500);assertMessageVisible(tx,ctx.actor,outcome.data.id,ctx.nowMs);},
  execute(tx,ctx,input,acceptedEventId){const data=createMessage(tx,{...ctx,prepared},input);insertNotifications(tx,planNotifications(tx,{...data,actor:ctx.actor,deliveries:prepared.deliveries},acceptedEventId,ctx.nowMs));return {outcome:{status:201,data},event:{type:'message.accepted',resourceType:'message',resourceId:data.id,resourceVersion:null,threadId:data.thread_id}};}
 };
}
