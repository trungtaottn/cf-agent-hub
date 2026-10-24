import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import type {Configuration,ProfileData,ProfileExport,ProfileWriteRequest,PreferencesData,PreferencesWriteRequest} from '../http/dto';
import type {CommandDescriptor} from '../workspace/commands';
import {authorize,refreshActor} from '../auth/authorize';
import {HttpError} from '../http/envelopes';
import {settingsPolicy} from './policy';
import {storedProfile,applyProfile} from './profile';
import {validatePreferencesData,validateProfileData} from '../http/generated/auth-validators.js';
import {canonicalJson} from './bootstrap';
import {readPreferences,applyPreferences,preferenceView} from './preferences';
export {readProfile,previewProfile,applyProfile} from './profile';
export {readPreferences,applyPreferences} from './preferences';
export type ConfigurationView=Configuration;
export type ProfileView=ProfileData;
export type PreferenceView=PreferencesData;
export function readConfiguration(tx:WorkspaceTransaction,actor:ActorContext):Configuration{
 const live=refreshActor(tx,actor,Date.now());authorize(tx,live,'workspace:read');const {epoch,policy}=settingsPolicy(tx,live);
 const enabled:Configuration['enabled_features']=['workspace','profile'];
 if(live.scopes.has('messages:read')||live.scopes.has('messages:send'))enabled.push('messages');
 if(live.scopes.has('events:read'))enabled.push('events');
 if(live.kind==='human')enabled.push('preferences');
 if(live.kind==='human'&&live.scopes.has('operations:read'))enabled.push('operations');
 return {config_epoch:epoch,profile_revision:storedProfile(tx,live).profile_revision,preferences_revision:live.kind==='human'?readPreferences(tx,live).preferences_revision:null,allowed_user_overrides:live.kind==='human'?[...policy.allowed_user_overrides]:[],enabled_features:enabled};
}
export function exportProfile(tx:WorkspaceTransaction,actor:ActorContext):ProfileExport{
 authorize(tx,actor,'profile:edit');if(actor.kind!=='human')throw new HttpError('FORBIDDEN',403);settingsPolicy(tx,actor);
 return {...storedProfile(tx,actor),included_categories:['presentation','projects','work_roles']};
}
function humanAccess(tx:WorkspaceTransaction,actor:ActorContext,operation:string,nowMs:number):void{
 authorize(tx,actor,operation,undefined,nowMs);if(actor.kind!=='human')throw new HttpError('FORBIDDEN',403);settingsPolicy(tx,actor);
}
export function profileCommand():CommandDescriptor<ProfileWriteRequest,ProfileData>{return {
 operation:'profile:edit',target:'profile',resource:()=>undefined,
 checkAccess(tx,ctx){humanAccess(tx,ctx.actor,'profile:edit',ctx.nowMs);},
 checkReplay(tx,ctx,_body,outcome){humanAccess(tx,ctx.actor,'profile:edit',ctx.nowMs);if(!validateProfileData(outcome.data))throw new HttpError('INTERNAL_ERROR',500);},
 execute(tx,ctx,body){const data=applyProfile(tx,ctx,body);return {outcome:{status:200,data},event:{type:'profile.updated',resourceType:'profile',resourceId:ctx.actor.workspaceId,resourceVersion:data.profile_revision,threadId:null}};}
};}
export function preferencesCommand(preferenceRecordId:string):CommandDescriptor<PreferencesWriteRequest,PreferencesData>{return {
 operation:'workspace:read',target:'preferences',resource:()=>undefined,
 checkAccess(tx,ctx){humanAccess(tx,ctx.actor,'workspace:read',ctx.nowMs);},
 checkReplay(tx,ctx,_body,outcome){
  humanAccess(tx,ctx.actor,'workspace:read',ctx.nowMs);
  if(!tx.one('SELECT record_id FROM preferences WHERE workspace_id=? AND principal_id=?',[ctx.actor.workspaceId,ctx.actor.principalId]))throw new HttpError('NOT_FOUND',404);
  if(!validatePreferencesData(outcome.data))throw new HttpError('INTERNAL_ERROR',500);
  const current=preferenceView(tx,ctx.actor,outcome.data.preferences,outcome.data.preferences_revision,ctx.nowMs);
  // Retained outcomes stay immutable. Refresh reads when a former effective projection is no longer allowed.
  const comparable=(view:PreferencesData)=>({...view,allowed_user_overrides:[...view.allowed_user_overrides].sort()});
  if(canonicalJson(comparable(current))!==canonicalJson(comparable(outcome.data)))throw new HttpError('FORBIDDEN',403);
 },
 execute(tx,ctx,body){const data=applyPreferences(tx,{...ctx,preferenceRecordId},body),row=tx.one<{record_id:string}>('SELECT record_id FROM preferences WHERE workspace_id=? AND principal_id=?',[ctx.actor.workspaceId,ctx.actor.principalId])!;return {outcome:{status:200,data},event:{type:'preferences.updated',resourceType:'preferences',resourceId:row.record_id,resourceVersion:data.preferences_revision,threadId:null}};}
};}
