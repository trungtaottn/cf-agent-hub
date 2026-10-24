import type {MessageAckRequest,AckResult} from '../http/dto';
import {validateMessageAckRequest} from '../http/generated/auth-validators.js';
import type {CommandContext} from '../workspace/context';
import type {CommandDescriptor} from '../workspace/commands';
import type {WorkspaceTransaction} from '../storage/transaction';
import {authorize} from '../auth/authorize';
import {settingsPolicy} from '../config/policy';
import {HttpError} from '../http/envelopes';
import {inaccessible} from './references';
import {markSchedulerDirty} from '../outbox/scheduler-state';
function recipients(tx:WorkspaceTransaction,ctx:CommandContext,input:MessageAckRequest):readonly {id:string;acknowledged_at:number|null}[]{
 if(!validateMessageAckRequest(input))throw new HttpError('INVALID_REQUEST',400);
 // Opaque IDs need Set uniqueness independent of generated object-key handling.
 if(new Set(input.message_ids).size!==input.message_ids.length)throw new HttpError('INVALID_REQUEST',400);
 if(ctx.actor.kind!=='agent'||!ctx.actor.agentId)throw new HttpError('FORBIDDEN',403);
 authorize(tx,ctx.actor,'messages:ack',{kind:'message',id:input.message_ids[0],projectId:null},ctx.nowMs);settingsPolicy(tx,ctx.actor);
 return input.message_ids.map(id=>{
  const row=tx.one<{id:string;acknowledged_at:number|null}>(`SELECT m.id,i.acknowledged_at FROM inbox i JOIN messages m ON m.id=i.message_id AND m.workspace_id=i.workspace_id JOIN threads t ON t.id=m.thread_id AND t.workspace_id=m.workspace_id
   JOIN thread_participants p ON p.thread_id=t.id AND p.participant_kind='agent' AND p.participant_id=i.recipient_agent_id
   WHERE i.message_id=? AND i.recipient_agent_id=? AND i.workspace_id=?`,[id,ctx.actor.agentId!,ctx.actor.workspaceId]);
  return row??inaccessible();
 });
}
/** Validate the entire recipient batch before changing any row; wrapper owns event/outcome. */
export function ackMessages(tx:WorkspaceTransaction,ctx:CommandContext,input:MessageAckRequest):AckResult{
 const rows=recipients(tx,ctx,input),result:AckResult={acknowledged_ids:[],already_acknowledged_ids:[]};let relevant=false;
 for(const row of rows){
  if(row.acknowledged_at!==null){result.already_acknowledged_ids.push(row.id);continue;}
  tx.exec('UPDATE inbox SET acknowledged_at=? WHERE message_id=? AND recipient_agent_id=? AND workspace_id=? AND acknowledged_at IS NULL',[ctx.nowMs,row.id,ctx.actor.agentId!,ctx.actor.workspaceId]);
  result.acknowledged_ids.push(row.id);
  if(tx.one("SELECT id FROM outbox WHERE workspace_id=? AND message_id=? AND status IN ('pending','in_flight')",[ctx.actor.workspaceId,row.id]))relevant=true;
 }
 if(relevant)markSchedulerDirty(tx);return result;
}
export function ackCommand():CommandDescriptor<MessageAckRequest,AckResult>{
 return {operation:'messages:ack',target:'inbox',resource:(_tx,_ctx,input)=>({kind:'message',id:input.message_ids[0],projectId:null}),
  checkAccess(tx,ctx,input){recipients(tx,ctx,input);},
  checkReplay(tx,ctx,input){recipients(tx,ctx,input);},
  execute(tx,ctx,input){return {outcome:{status:200,data:ackMessages(tx,ctx,input)},event:{type:'message.acknowledged',resourceType:'message',resourceId:input.message_ids[0],resourceVersion:null,threadId:null}};}
 };
}
