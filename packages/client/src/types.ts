import type * as DTO from '../../../src/http/dto';
export type {Workspace,AuthStartRequest,AuthStartData,AuthSession,AuthLogoutRequest,AuthLogoutData,Configuration,ProfileData,ProfileWriteRequest,ProfilePreview,ProfileExport,PreferencesData,PreferencesWriteRequest,WorkspaceProfile,UserPreferences,Operations,Event,Message} from '../../../src/http/dto';

/** Canonical OpenAPI Page metadata; the generated DTO subset does not export Page. */
export type Page = {next_cursor:string|null;has_more:boolean};
export type ApiResult<T> =
 | {ok:true;status:number;data:T;requestId:string;page?:Page}
 | {ok:false;status:number|null;error:{code:string;message:string;retryable:boolean;details?:Record<string,unknown>};requestId:string|null};

type Empty = Record<string,never>;
type ReadQuery = {cursor?:string;limit?:number};
export interface OperationInputs {
 getWorkspace:Empty;
 startAuth:DTO.AuthStartRequest;
 getAuthSession:Empty;
 logoutAuth:DTO.AuthLogoutRequest;
 getConfiguration:Empty;
 getProfile:Empty;
 previewProfile:DTO.ProfileWriteRequest;
 putProfile:DTO.ProfileWriteRequest;
 exportProfile:Empty;
 getPreferences:Empty;
 putPreferences:DTO.PreferencesWriteRequest;
 getOperations:Empty;
 listEvents:ReadQuery & {after_sequence?:number};
 getThread:ReadQuery & {thread_id:string};
}
export interface OperationData {
 getWorkspace:DTO.Workspace;
 startAuth:DTO.AuthStartData;
 getAuthSession:DTO.AuthSession;
 logoutAuth:DTO.AuthLogoutData;
 getConfiguration:DTO.Configuration;
 getProfile:DTO.ProfileData;
 previewProfile:DTO.ProfilePreview;
 putProfile:DTO.ProfileData;
 exportProfile:DTO.ProfileExport;
 getPreferences:DTO.PreferencesData;
 putPreferences:DTO.PreferencesData;
 getOperations:DTO.Operations;
 listEvents:DTO.Event[];
 getThread:DTO.Message[];
}
export type Operation = keyof OperationInputs;
export type RequestOptions = {idempotencyKey?:string;signal?:AbortSignal};
export type HubClientOptions = {fetch?:typeof globalThis.fetch};
export type ServerErrorCode = DTO.Error['error']['code'];
