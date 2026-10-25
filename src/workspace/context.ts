export interface ActorContext {
 workspaceId:string; principalId:string; kind:'human'|'agent'; agentId:string|null;
 scopes:ReadonlySet<string>; projectIds:readonly string[]|null; credentialId:string|null;
 runtimeId:string|null; sessionId:string|null;
}
export interface CommandContext { actor:ActorContext; requestId:string; idempotencyKey:string; nowMs:number; }
export interface Clock { nowMs():number; }
export interface Entropy { bytes(length:number):Uint8Array; }
export const systemClock:Clock={nowMs:()=>Date.now()};
export const systemEntropy:Entropy={bytes:length=>crypto.getRandomValues(new Uint8Array(length))};
export type VerifiedIdentity =
 | {kind:'human';issuer:string;subject:string;sessionId:string;workspaceId:string}
 | {kind:'agent';workspaceId:string;credentialId:string;tokenDigest:string};
export interface ResourceAccess {kind:string;id:string;projectId:string|null;}
/** Accepted only from the trusted authenticated operator Worker binding. Not a public DTO. */
export interface RecoveryOperatorContext {
 principalId:string; workspaceId:string; requestId:string; operation:'install';
 expectedEpoch:number; expectedInstallationDigest:string|null;
}
export interface InstallOperationContext extends RecoveryOperatorContext {
 operationId:string;requestFingerprint:string;proofExpiresAt:number;
}
export interface OperatorInstallReceipt extends InstallReceipt {
 operatorPrincipalId:string;operationId:string;originalRequestId:string;
}
export type InstallOperationResult={ok:true;receipt:OperatorInstallReceipt}|{ok:false;code:'CONFLICT'|'INVALID_INSTALL'|'INSTALL_UNAVAILABLE'|'UNAUTHENTICATED'};
export interface WorkspaceEnvironment {
 WORKSPACE:DurableObjectNamespace<import('./workspace-do').WorkspaceDO>;
 RECOVERY_BUCKET:R2Bucket;
 RECOVERY_ENVIRONMENT_ID?:string;RECOVERY_INTEGRITY_KEY_ID?:string;RECOVERY_INTEGRITY_KEY?:string;RECOVERY_RELEASE?:string;
 CF_VERSION_METADATA?:{id:string;tag?:string;timestamp?:string};
}
export interface InstallReceipt {workspaceId:string;objectName:string;epoch:number;installationDigest:string;}
export interface InternalRequest {workspaceId:string;objectName:string;requestId:string;operation:string;}
export interface InternalResponse {status:number;code:string;}
