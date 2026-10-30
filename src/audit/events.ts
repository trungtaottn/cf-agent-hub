import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext,ResourceAccess} from '../workspace/context';
import type {EventDraft} from '../workspace/commands';
import type {Event} from '../http/dto';
import {validateEvent} from '../http/generated/auth-validators.js';
import {canonicalJson} from '../config/bootstrap';
import {authorize,refreshActor} from '../auth/authorize';
import {grantsCover} from '../auth/credential-authority';
import {HttpError} from '../http/envelopes';
import {assertMessageVisible} from '../messages/references';
export interface RedactedEventInput extends EventDraft{id:string;workspaceId:string;actor:ActorContext;requestId:string;nowMs:number;}
const definitions={
 'message.accepted':{resource:'message',summary:'Message accepted.'},
 'message.acknowledged':{resource:'message',summary:'Message acknowledged.'},
 'profile.updated':{resource:'profile',summary:'Workspace profile updated.'},
 'preferences.updated':{resource:'preferences',summary:'User preferences updated.'},
 'agent.created':{resource:'agent',summary:'Agent created.'},
 'agent.updated':{resource:'agent',summary:'Agent updated.'},
 'agent.archived':{resource:'agent',summary:'Agent archived.'},
 'credential.issued':{resource:'credential',summary:'Credential issued.'},
 'credential.revoked':{resource:'credential',summary:'Credential revoked.'}
} as const;
interface EventRow{id:string;workspace_id:string;sequence:number;type:string;actor_json:string;resource_type:Event['resource_type'];resource_id:string;resource_version:number|null;thread_id:string|null;request_id:string;occurred_at:number;summary:string;}
function projection(row:EventRow):Event{
 return {id:row.id,workspace_id:row.workspace_id,sequence:row.sequence,type:row.type,actor:JSON.parse(row.actor_json) as Event['actor'],resource_type:row.resource_type,resource_id:row.resource_id,resource_version:row.resource_version,thread_id:row.thread_id,request_id:row.request_id,occurred_at:new Date(row.occurred_at).toISOString(),summary:row.summary,task_version:null,run_id:null,fence:null};
}
/** Handler supplies stable resource fields only. The wrapper supplies actor, ID, time and request correlation. */
export function appendEvent(tx:WorkspaceTransaction,event:RedactedEventInput):{id:string;sequence:number}{
 const definition=definitions[event.type];
 if(!definition||event.resourceType!==definition.resource||event.workspaceId!==event.actor.workspaceId||
  (event.resourceType==='profile'||event.resourceType==='preferences'||event.resourceType==='agent'||event.resourceType==='credential')&&event.actor.kind!=='human'||
  event.resourceType==='profile'&&event.resourceId!==event.workspaceId)throw new HttpError('INTERNAL_ERROR',500);
 const row:EventRow={id:event.id,workspace_id:event.workspaceId,sequence:1,type:event.type,actor_json:canonicalJson({kind:event.actor.kind,principal_id:event.actor.principalId,agent_id:event.actor.agentId}),resource_type:event.resourceType,resource_id:event.resourceId,resource_version:event.resourceVersion,thread_id:event.threadId,request_id:event.requestId,occurred_at:event.nowMs,summary:definition.summary};
 if(!validateEvent(projection(row)))throw new HttpError('INTERNAL_ERROR',500);
 tx.exec('INSERT INTO events (id,workspace_id,type,actor_json,resource_type,resource_id,resource_version,thread_id,request_id,occurred_at,summary) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[row.id,row.workspace_id,row.type,row.actor_json,row.resource_type,row.resource_id,row.resource_version,row.thread_id,row.request_id,row.occurred_at,row.summary]);
 const stored=tx.one<{sequence:number}>('SELECT sequence FROM events WHERE id=?',[row.id])!;
 return {id:row.id,sequence:stored.sequence};
}
export type EventVisibility=(tx:WorkspaceTransaction,actor:ActorContext,resource:ResourceAccess,event:Event,nowMs:number)=>boolean;
/** Resource predicate must join current persisted resources/owners; false yields no event ID or summary.
 * Task6 supplies the preferences stable owner predicate. No permissive default exists. */
export function projectEvent(tx:WorkspaceTransaction,actor:ActorContext,id:string,nowMs:number,visibility:EventVisibility):Event|null{
 const live=refreshActor(tx,actor,nowMs);
 authorize(tx,live,'events:read',undefined,nowMs);
 const row=tx.one<EventRow>('SELECT * FROM events WHERE id=? AND workspace_id=?',[id,actor.workspaceId]);
 if(!row)return null;
 // A caller-supplied visibility hook cannot enable an unknown producer/resource pair.
 const resource=row.type==='configuration.installed'?'configuration':Object.hasOwn(definitions,row.type)?definitions[row.type as keyof typeof definitions].resource:null;
 if(resource===null||resource!==row.resource_type)return null;
 const event=projection(row);
 const visible:unknown=visibility(tx,live,{kind:row.resource_type,id:row.resource_id,projectId:null},event,nowMs);
 if(visible!==null&&(typeof visible==='object'||typeof visible==='function')&&typeof (visible as {then?:unknown}).then==='function'){
  void Promise.resolve(visible).catch(()=>{});throw new HttpError('INTERNAL_ERROR',500);
 }
 if(visible!==true)return null;
 if(event.type==='message.accepted'){
  const message=tx.one<{thread_id:string}>('SELECT m.thread_id FROM messages m JOIN threads t ON t.id=m.thread_id AND t.workspace_id=m.workspace_id WHERE m.id=? AND m.workspace_id=?',[event.resource_id,live.workspaceId]);
  if(!message)return null;event.thread_id=message.thread_id;
 }
 if(!validateEvent(event))throw new HttpError('INTERNAL_ERROR',500);
 return event;
}

/** Current resource policy composes the accepted settings predicate without duplicating ownership. */
export const resourceEventVisibility:EventVisibility=(tx,actor,resource,event,nowMs)=>{
 if(!validateEvent(event)||event.workspace_id!==actor.workspaceId||resource.id!==event.resource_id||resource.kind!==event.resource_type)return false;
 try{
  authorize(tx,actor,'events:read',resource.kind==='credential'?undefined:resource,nowMs);
  if(event.type==='message.accepted'||event.type==='message.acknowledged'){
   assertMessageVisible(tx,actor,event.resource_id,nowMs);return true;
  }
  if(resource.kind==='agent'){
   authorize(tx,actor,'agents:read',resource,nowMs);
   return actor.projectIds===null&&!!tx.one('SELECT agent_id FROM static_agents WHERE agent_id=? AND workspace_id=?',[resource.id,actor.workspaceId]);
  }
  if(resource.kind==='credential'){
   authorize(tx,actor,'credentials:manage',undefined,nowMs);
   if(actor.kind!=='human')return false;
   const row=tx.one<{scopes_json:string;project_ids_json:string}>('SELECT scopes_json,project_ids_json FROM native_credentials WHERE credential_id=? AND workspace_id=?',[resource.id,actor.workspaceId]);
   if(!row)return false;
   const scopes=JSON.parse(row.scopes_json) as string[],projects=JSON.parse(row.project_ids_json) as string[]|null;
   return grantsCover([...actor.scopes],actor.projectIds,scopes,projects);
  }
  return settingsEventVisibility(tx,actor,resource,event,nowMs)===true;
 }catch(error){if(error instanceof HttpError&&error.code==='NOT_FOUND'||error instanceof Error&&'code' in error&&error.code==='FORBIDDEN')return false;throw error;}
};
/** Typed settings predicate. Ownership comes from the immutable persisted record association. */
export const settingsEventVisibility:EventVisibility=(tx,actor,resource,event,nowMs)=>{
 if(event.workspace_id!==actor.workspaceId||resource.id!==event.resource_id||resource.kind!==event.resource_type||!validateEvent(event))return false;
 const live=refreshActor(tx,actor,nowMs);
 if(!live.scopes.has('events:read'))return false;
 if(event.type==='configuration.installed')return live.kind==='human'&&live.scopes.has('operations:read')&&resource.kind==='configuration'&&resource.id===live.workspaceId&&event.actor.kind==='system';
 if(event.type==='profile.updated')return live.scopes.has('workspace:read')&&resource.kind==='profile'&&resource.id===live.workspaceId&&event.actor.kind==='human';
 if(event.type==='preferences.updated'){
  if(live.kind!=='human'||!live.scopes.has('workspace:read')||resource.kind!=='preferences'||event.actor.kind!=='human'||event.actor.principal_id!==live.principalId)return false;
  return !!tx.one('SELECT record_id FROM preferences WHERE record_id=? AND workspace_id=? AND principal_id=?',[resource.id,live.workspaceId,live.principalId]);
 }
 return false;
};
