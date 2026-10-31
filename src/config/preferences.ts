import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext,CommandContext} from '../workspace/context';
import type {PreferencesData,PreferencesWriteRequest,UserPreferences} from '../http/dto';
import {validateUserPreferences,validatePreferencesWriteRequest} from '../http/generated/auth-validators.js';
import {authorize,refreshActor} from '../auth/authorize';
import {HttpError} from '../http/envelopes';
import {canonicalJson} from './bootstrap';
import {settingsPolicy} from './policy';
import {storedProfile} from './profile';
export const neutralPreferences:UserPreferences={contract_revision:'0.1',theme:'system',density:'comfortable',default_view:'overview'};
export interface SettingsCommandContext extends CommandContext{preferenceRecordId?:string;}
export interface PreferenceRecord{version:number;document_json:string;record_id:string;}
function stored(tx:WorkspaceTransaction,actor:ActorContext):{row:PreferenceRecord|null;preferences:UserPreferences}{
 const row=tx.one<PreferenceRecord>('SELECT version,document_json,record_id FROM preferences WHERE workspace_id=? AND principal_id=?',[actor.workspaceId,actor.principalId]);
 if(row){try{const value:unknown=JSON.parse(row.document_json);if(validateUserPreferences(value))return {row,preferences:value};}catch{}
  // A fixed category only: neither persisted bytes nor owner identity is diagnostic payload.
  console.warn(JSON.stringify({category:'MALFORMED_PREFERENCES'}));
 }
 return {row,preferences:structuredClone(neutralPreferences)};
}
export function preferenceView(tx:WorkspaceTransaction,actor:ActorContext,preferences:UserPreferences,revision:number,nowMs:number):PreferencesData{
 const live=refreshActor(tx,actor,nowMs);authorize(tx,live,'workspace:read',undefined,nowMs);if(live.kind!=='human')throw new HttpError('FORBIDDEN',403);
 const {policy}=settingsPolicy(tx,live),effective=structuredClone(neutralPreferences);
 for(const field of policy.allowed_user_overrides)effective[field]=preferences[field] as never;
 // Profile navigation is presentation only, but an invisible default must not be selected.
 // Human inbox and later-round views remain unavailable; Overview is the safe fallback.
 const visibleViews=new Set(storedProfile(tx,live).profile.navigation.visible_views);
 const requested=effective.default_view;
 const board=(requested==='tasks'||requested==='kanban')&&live.scopes.has('tasks:read')&&(visibleViews.has('tasks')||visibleViews.has('kanban'));
 const available=requested==='overview'||requested==='activity'&&live.scopes.has('events:read')&&visibleViews.has('activity')||board;
 if(!available)effective.default_view='overview';else if(board)effective.default_view='tasks';
 const acceptedAlias=board&&requested===preferences.default_view;
 const reason=effective.default_view===preferences.default_view||acceptedAlias?null:!policy.allowed_user_overrides.includes('default_view')?'PREFERENCE_NOT_ALLOWED':'VIEW_UNAVAILABLE';
 return {preferences_revision:revision,preferences,effective,allowed_user_overrides:[...policy.allowed_user_overrides],default_view_fallback_reason:reason};
}
export function readPreferences(tx:WorkspaceTransaction,actor:ActorContext,nowMs=Date.now()):PreferencesData{
 const live=refreshActor(tx,actor,nowMs);authorize(tx,live,'workspace:read',undefined,nowMs);if(live.kind!=='human')throw new HttpError('FORBIDDEN',403);
 settingsPolicy(tx,live);const {row,preferences}=stored(tx,live);
 return preferenceView(tx,live,preferences,row?.version??0,nowMs);
}
export function applyPreferences(tx:WorkspaceTransaction,ctx:SettingsCommandContext,request:PreferencesWriteRequest):PreferencesData{
 const live=refreshActor(tx,ctx.actor,ctx.nowMs);authorize(tx,live,'workspace:read',undefined,ctx.nowMs);if(live.kind!=='human')throw new HttpError('FORBIDDEN',403);
 const {policy}=settingsPolicy(tx,live);if(!validatePreferencesWriteRequest(request))throw new HttpError('INVALID_REQUEST',400,{field:'/preferences'});
 const {row,preferences}=stored(tx,live),revision=row?.version??0;
 if(request.expected_preferences_revision!==revision)throw new HttpError('VERSION_CONFLICT',409,{current_revision:revision});
 for(const field of ['theme','density','default_view'] as const)if(request.preferences[field]!==preferences[field]&&!policy.allowed_user_overrides.includes(field))throw new HttpError('FORBIDDEN',403,{field:'/preferences/'+field});
 if(revision===Number.MAX_SAFE_INTEGER)throw new HttpError('LIMIT_EXCEEDED',409);
 const recordId=row?.record_id??ctx.preferenceRecordId;
 if(!recordId||!/^pref_[a-f0-9]{32}$/.test(recordId))throw new HttpError('INTERNAL_ERROR',500);
 tx.exec('INSERT INTO preferences (principal_id,workspace_id,version,document_json,updated_at,record_id) VALUES (?,?,?,?,?,?) ON CONFLICT(principal_id) DO UPDATE SET version=excluded.version,document_json=excluded.document_json,updated_at=excluded.updated_at',[live.principalId,live.workspaceId,revision+1,canonicalJson(request.preferences),ctx.nowMs,recordId]);
 return readPreferences(tx,live,ctx.nowMs);
}
