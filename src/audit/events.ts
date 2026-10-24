import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext,ResourceAccess} from '../workspace/context';
import type {EventDraft} from '../workspace/commands';
import type {Event} from '../http/dto';
import {validateEvent} from '../http/generated/auth-validators.js';
import {canonicalJson} from '../config/bootstrap';
import {authorize,refreshActor} from '../auth/authorize';
import {HttpError} from '../http/envelopes';
export interface RedactedEventInput extends EventDraft{id:string;workspaceId:string;actor:ActorContext;requestId:string;nowMs:number;}
const definitions={
 'message.accepted':{resource:'message',summary:'Message accepted.'},
 'message.acknowledged':{resource:'message',summary:'Message acknowledged.'},
 'profile.updated':{resource:'profile',summary:'Workspace profile updated.'},
 'preferences.updated':{resource:'preferences',summary:'User preferences updated.'}
} as const;
interface EventRow{id:string;workspace_id:string;sequence:number;type:string;actor_json:string;resource_type:Event['resource_type'];resource_id:string;resource_version:number|null;thread_id:string|null;request_id:string;occurred_at:number;summary:string;}
function projection(row:EventRow):Event{
 return {id:row.id,workspace_id:row.workspace_id,sequence:row.sequence,type:row.type,actor:JSON.parse(row.actor_json) as Event['actor'],resource_type:row.resource_type,resource_id:row.resource_id,resource_version:row.resource_version,thread_id:row.thread_id,request_id:row.request_id,occurred_at:new Date(row.occurred_at).toISOString(),summary:row.summary,task_version:null,run_id:null,fence:null};
}
/** Handler supplies stable resource fields only. The wrapper supplies actor, ID, time and request correlation. */
export function appendEvent(tx:WorkspaceTransaction,event:RedactedEventInput):{id:string;sequence:number}{
 const definition=definitions[event.type];
 if(!definition||event.resourceType!==definition.resource||event.workspaceId!==event.actor.workspaceId||
  (event.resourceType==='profile'||event.resourceType==='preferences')&&event.actor.kind!=='human'||
  event.resourceType==='profile'&&event.resourceId!==event.workspaceId)throw new HttpError('INTERNAL_ERROR',500);
 const row:EventRow={id:event.id,workspace_id:event.workspaceId,sequence:1,type:event.type,actor_json:canonicalJson({kind:event.actor.kind,principal_id:event.actor.principalId,agent_id:event.actor.agentId}),resource_type:event.resourceType,resource_id:event.resourceId,resource_version:event.resourceVersion,thread_id:event.threadId,request_id:event.requestId,occurred_at:event.nowMs,summary:definition.summary};
 if(!validateEvent(projection(row)))throw new HttpError('INTERNAL_ERROR',500);
 tx.exec('INSERT INTO events (id,workspace_id,type,actor_json,resource_type,resource_id,resource_version,thread_id,request_id,occurred_at,summary) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[row.id,row.workspace_id,row.type,row.actor_json,row.resource_type,row.resource_id,row.resource_version,row.thread_id,row.request_id,row.occurred_at,row.summary]);
 const stored=tx.one<{sequence:number}>('SELECT sequence FROM events WHERE id=?',[row.id])!;
 return {id:row.id,sequence:stored.sequence};
}
export type EventVisibility=(tx:WorkspaceTransaction,actor:ActorContext,resource:ResourceAccess)=>boolean;
/** Resource predicate must join current persisted resources/owners; false yields no event ID or summary.
 * Task6 supplies the preferences stable owner predicate. No permissive default exists. */
export function projectEvent(tx:WorkspaceTransaction,actor:ActorContext,id:string,nowMs:number,visibility:EventVisibility):Event|null{
 const live=refreshActor(tx,actor,nowMs);
 authorize(tx,live,'events:read',undefined,nowMs);
 const row=tx.one<EventRow>('SELECT * FROM events WHERE id=? AND workspace_id=?',[id,actor.workspaceId]);
 if(!row||!visibility(tx,live,{kind:row.resource_type,id:row.resource_id,projectId:null}))return null;
 const event=projection(row);
 if(!validateEvent(event))throw new HttpError('INTERNAL_ERROR',500);
 return event;
}
