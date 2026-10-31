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

export type {EnabledOperationId} from '../../../src/http/generated/client-operations';
import type {EnabledOperationId} from '../../../src/http/generated/client-operations';
export type RequestFor<K extends EnabledOperationId> = DTO.HttpOperationRequests[K];
export type ResponseFor<K extends EnabledOperationId> = K extends 'downloadArtifactContent' ? ArtifactDownloadResult : ApiResult<DTO.HttpOperationData[K]>;

/** A caller comparison constraint, never authentication evidence. */
export interface VerifiedPrincipalBinding {
 readonly origin:string;readonly workspaceId:string;readonly principalId:string;
 readonly slotId:string;readonly slotGeneration:number;readonly provenanceId:string;
}
declare const provenanceBrand:unique symbol;
/** Runtime identity is checked by the transport, not by the TypeScript brand. Not serializable authority. */
export interface CredentialProvenance {
 readonly binding:Readonly<VerifiedPrincipalBinding>;
 readonly [provenanceBrand]:true;
}
/** Trusted protected-store adapter. use/release/currentness are synchronous, never async refresh.
 * Protected local currentness checks may perform bounded blocking storage I/O;
 * the transport checks its deadline and trusted replay clock afterward, before fetch.
 * use pins this exact slot and invokes its callback exactly once before returning its result.
 * An arbitrary imported token has provenance:null until explicit enrollment captures proof.
 * Generic providers retain process-local receipts. Only the internal concrete
 * protected-provider bridge can restore durable associations; no public JSON import. */
export interface CredentialDispatchLease {
 readonly slotId:string;readonly slotGeneration:number;readonly provenance:CredentialProvenance|null;
 isCurrent():boolean;
 use<T>(dispatch:(credential:string)=>T):T;
 release():void;
}
export interface CredentialProvider {
 acquire(expected:Readonly<VerifiedPrincipalBinding>|null,signal?:AbortSignal):Promise<CredentialDispatchLease>;
}
export interface NativeClientOptions {
 origin:string;workspaceId:string;credentialProvider:CredentialProvider;fetch:typeof globalThis.fetch;
 /** Total per-call deadline, including acquisition, response bytes and capture. Default 30s; max 120s. */
 timeoutMs?:number;
}
export interface SemanticRequest {
 readonly operation:EnabledOperationId;readonly method:string;readonly path:string;readonly queryCanonical:string;readonly canonicalBody:string;readonly origin:string;readonly workspaceId:string;
}
export interface NativeDispatchContext {readonly request:Readonly<SemanticRequest>;readonly binding:Readonly<VerifiedPrincipalBinding>|null;readonly lease:CredentialDispatchLease;readonly key:string|undefined;}
/** Durability hook, not authentication. Final check runs synchronously in the actual pinned dispatch. */
export type NativeDispatchGuard=(context:NativeDispatchContext)=>(()=>void)|Promise<()=>void>;
export type NativeProofDispatch=<T>(context:{binding:Readonly<VerifiedPrincipalBinding>;runtimeId:string;lease:CredentialDispatchLease},dispatch:(proof:string)=>T)=>T;
export interface NativeRequestOptions extends RequestOptions {
 runtimeProofDispatch?:NativeProofDispatch;
 dispatchGuard?:NativeDispatchGuard;
 runtimeProof?:string;expectedBinding?:Readonly<VerifiedPrincipalBinding>;
 /** Explicit stream hooks only; no hidden metadata lookup or all-pages buffering. */
 artifact?:DTO.Artifact;upload?:ReadableStream<Uint8Array>;
}
export interface RuntimeCapture {
 readonly runtime:Readonly<DTO.Runtime>;readonly runtimeProof:string;
 readonly provenance:CredentialProvenance;readonly signal:AbortSignal;
 readonly lease:CredentialDispatchLease;
}
export interface RuntimeCaptureFinalizer {commit():void;abort():void;}
export interface EnrollmentOptions extends RequestOptions {
 dispatchGuard?:NativeDispatchGuard;
 idempotencyKey:string;expectedBinding?:Readonly<VerifiedPrincipalBinding>;
 captureRuntime:(capture:RuntimeCapture)=>void|RuntimeCaptureFinalizer|Promise<void|RuntimeCaptureFinalizer>;
}
export type StreamCompletion = {ok:true;byteSize:number}|{ok:false;error:{code:string;message:string}};
export interface ArtifactDownload {
 body:ReadableStream<Uint8Array>;
 /** Byte count and clean EOF, not an incremental digest or file-write acknowledgment. */
 completion:Promise<StreamCompletion>;
 artifact:Readonly<DTO.Artifact>;
}
/** Binary contract has no server request-ID header. Never fabricate correlation. */
export type ArtifactDownloadResult =
 | {ok:true;status:number;data:ArtifactDownload;requestId:null}
 | Extract<ApiResult<never>,{ok:false}>;
export interface NativeClient {
 call<K extends EnabledOperationId>(operation:K,request:RequestFor<K>,options?:NativeRequestOptions):Promise<ResponseFor<K>>;
 /** createRuntime is supported only through this explicit one-time-secret mode. */
 enrollRuntime(request:RequestFor<'createRuntime'>,options:EnrollmentOptions):Promise<ApiResult<DTO.Runtime>>;
}

/** Deliberately read-only browser board surface; canonical DTOs remain server-owned. */
export type BrowserReadOperation='listTasks'|'getTask'|'getRun'|'listTaskResults'|'getArtifact'|'listEvents'|'listAgents'|'getAgent';
export type BrowserReadRequest=<K extends BrowserReadOperation>(operation:K,input:RequestFor<K>,options?:Pick<RequestOptions,'signal'>)=>Promise<ApiResult<DTO.HttpOperationData[K]>>;

/** Cookie/CSRF-only task commands. Current authorization remains server-owned. */
export type BrowserTaskCommandOperation='readyTask'|'cancelTask'|'requeueTask'|'acceptTaskResult';
export type BrowserTaskCommandOptions={idempotencyKey:string;signal?:AbortSignal};
export type BrowserTaskCommandRequest=<K extends BrowserTaskCommandOperation>(operation:K,input:RequestFor<K>,options:BrowserTaskCommandOptions)=>Promise<ApiResult<DTO.HttpOperationData[K]>>;

/** Browser composition uses only the session cookie/CSRF lane. */
export type BrowserComposeOperation='createMessage'|'createTask';
export type BrowserComposeOptions={idempotencyKey:string;admissionId?:string;signal?:AbortSignal};
export type BrowserComposeRequest=<K extends BrowserComposeOperation>(operation:K,input:RequestFor<K>,options:BrowserComposeOptions)=>Promise<ApiResult<DTO.HttpOperationData[K]>>;

/** Read-only retained creation admission; never a command retry or absence proof. */
export type BrowserComposeReconciliation<K extends BrowserComposeOperation> = K extends 'createMessage' ? DTO.MessageCreationReconciliation : DTO.TaskCreationReconciliation;
export type BrowserComposeReconcileRequest=<K extends BrowserComposeOperation>(operation:K,input:RequestFor<K>,options:BrowserComposeOptions)=>Promise<ApiResult<BrowserComposeReconciliation<K>>>;

export type BrowserComposePreparation=DTO.CreationPreparation;
export type BrowserComposePrepareRequest=<K extends BrowserComposeOperation>(operation:K,input:RequestFor<K>,options:Pick<BrowserComposeOptions,'idempotencyKey'|'signal'>)=>Promise<ApiResult<BrowserComposePreparation>>;
