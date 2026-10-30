import type {WorkspaceTransaction} from '../storage/transaction';
import type {Clock,Entropy} from '../workspace/context';
import type {RecoveryCommand,RecoveryManifest,RecoveryReceipt,RecoveryJobProgress,CurrentLedger,ProbeReceipt,ResumeReceipt,RetirementReceipt,CutoverRecord,ChunkMetadata} from './generated/recovery-validators.js';
import {validateRecoveryJobProgress,validateRecoveryReceipt,validateProbeReceipt,validateResumeReceipt,validateRetirementReceipt} from './generated/recovery-validators.js';
import {canonicalBytes,closed,isSlug,CONTROL_LIMIT} from './encoding';
import {readAdmissionFence,assertFence,type AdmissionFence} from './maintenance-v1';
export type {RecoveryCommand,RecoveryManifest,RecoveryReceipt,RecoveryJobProgress,CurrentLedger,ProbeReceipt,ResumeReceipt,RetirementReceipt,CutoverRecord,ChunkMetadata};
export type RecoveryOperation=Exclude<RecoveryCommand['operation'],'install'>;
export type RecoveryRequest=Exclude<RecoveryCommand,{operation:'install'}>;
export interface LedgerAnchor {authorityEpoch:number;sha256:string;}
export interface RecoveryContext {
 principalId:string;workspaceId:string;objectName:string;environmentId:string;requestId:string;
 operationId:string;operation:RecoveryOperation;captureId:string|null;expectedEpoch:number;
 expectedInstallationDigest:string|null;proofExpiresAt:number;requestFingerprint:string;ledgerAnchor:LedgerAnchor|null;
}
export interface RecoveryIntegrity {keyId:string;key:string;}
export interface RecoveryWorkspace {
 storage:DurableObjectStorage;bucket:R2Bucket;workspaceId:string;objectName:string;environmentId:string;
 clock:Clock;entropy:Entropy;integrity:RecoveryIntegrity;release:RecoveryManifest['release'];
 repairSchedule:()=>Promise<{armed:boolean;nextDueAt:number|null;generation:number;dirty:boolean}>;
}
export type RecoveryData=RecoveryJobProgress|RecoveryReceipt|ProbeReceipt|ResumeReceipt|RetirementReceipt;
export type RecoveryRpcResult={ok:true;data:RecoveryData}|{ok:false;code:'CONFLICT'|'INVALID_RECOVERY'|'RECOVERY_UNAVAILABLE'|'UNAUTHENTICATED'};
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function validateRecoveryContext(ctx:unknown):asserts ctx is RecoveryContext {
 if(!closed(ctx,['principalId','workspaceId','objectName','environmentId','requestId','operationId','operation','captureId','expectedEpoch','expectedInstallationDigest','proofExpiresAt','requestFingerprint','ledgerAnchor'])||![ctx.principalId,ctx.workspaceId,ctx.objectName,ctx.environmentId,ctx.operationId].every(isSlug)||typeof ctx.requestId!=='string'||ctx.requestId.length<1||ctx.requestId.length>128||!['capture','read-chunk','restore','write-chunk','verify','probe','resolve-delivery','retire','resume','status'].includes(String(ctx.operation))||!(ctx.captureId===null||isSlug(ctx.captureId))||!Number.isSafeInteger(ctx.expectedEpoch)||Number(ctx.expectedEpoch)<0||!(ctx.expectedInstallationDigest===null||hash(ctx.expectedInstallationDigest))||!Number.isSafeInteger(ctx.proofExpiresAt)||Number(ctx.proofExpiresAt)<=0||!hash(ctx.requestFingerprint))throw Error('INVALID_RECOVERY_CONTEXT');
 const anchor=ctx.ledgerAnchor;if(anchor!==null&&(!closed(anchor,['authorityEpoch','sha256'])||!Number.isSafeInteger(anchor.authorityEpoch)||Number(anchor.authorityEpoch)<1||!hash(anchor.sha256)))throw Error('INVALID_RECOVERY_CONTEXT');
}
/** The expected installed epoch check always precedes replay for non-install requests. */
export function assertRecoveryContext(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,expected?:AdmissionFence):AdmissionFence {
 validateRecoveryContext(ctx);
 // V1 recovery cannot serialize or restore the schema8 authority/artifact boundary.
 const versions=tx.all<{version:number}>('SELECT version FROM schema_migrations ORDER BY version');
 if(versions.length!==7||versions.some((row,i)=>row.version!==i+1))throw Error('RECOVERY_FORMAT_UNAVAILABLE');
 if(ctx.proofExpiresAt<=w.clock.nowMs())throw Error('OPERATOR_PROOF_EXPIRED');
 if(ctx.workspaceId!==w.workspaceId||ctx.objectName!==w.objectName||ctx.environmentId!==w.environmentId)throw Error('WORKSPACE_IDENTITY_MISMATCH');
 const metadata=tx.one<{workspace_id:string;object_name:string;config_epoch:number;installation_digest:string}>('SELECT workspace_id,object_name,config_epoch,installation_digest FROM workspace_metadata WHERE id=1');
 if(metadata&&(metadata.workspace_id!==w.workspaceId||metadata.object_name!==w.objectName))throw Error('WORKSPACE_IDENTITY_MISMATCH');
 if((metadata?.config_epoch??0)!==ctx.expectedEpoch||(metadata?.installation_digest??null)!==ctx.expectedInstallationDigest)throw Error('RECOVERY_EPOCH_CONFLICT');
 return expected?assertFence(tx,expected):readAdmissionFence(tx);
}
export function boundedData<T extends RecoveryData>(data:T):T {
 if(!(validateRecoveryJobProgress(data)||validateRecoveryReceipt(data)||validateProbeReceipt(data)||validateResumeReceipt(data)||validateRetirementReceipt(data))||canonicalBytes(data).length>CONTROL_LIMIT-256)throw Error('RECOVERY_RESULT_LIMIT');return data;
}
export function controlTarget(captureId:string|null):string{return 'recovery:'+String(captureId??'probe');}
export function priorOperation(tx:WorkspaceTransaction,ctx:RecoveryContext):RecoveryData|null {
 const prior=tx.one<{fingerprint:string;outcome_json:string}>('SELECT fingerprint,outcome_json FROM idempotency_outcomes WHERE principal_id=? AND operation=? AND target=? AND key=? AND workspace_id=?',[ctx.principalId,'operator.recovery.'+ctx.operation,controlTarget(ctx.captureId),ctx.operationId,ctx.workspaceId]);
 if(!prior)return null;if(prior.fingerprint!==ctx.requestFingerprint)throw Error('RECOVERY_OPERATION_CONFLICT');return boundedData(JSON.parse(prior.outcome_json) as RecoveryData);
}
export function storeOperation(tx:WorkspaceTransaction,ctx:RecoveryContext,data:RecoveryData,nowMs:number):void {
 boundedData(data);tx.exec('INSERT INTO idempotency_outcomes (principal_id,operation,target,key,workspace_id,fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at) VALUES (?,?,?,?,?,?,200,?,?,NULL,?,?)',[ctx.principalId,'operator.recovery.'+ctx.operation,controlTarget(ctx.captureId),ctx.operationId,ctx.workspaceId,ctx.requestFingerprint,new TextDecoder().decode(canonicalBytes(data)),ctx.requestId,nowMs,Number.MAX_SAFE_INTEGER]);
}
export function recoveryError(error:unknown):Extract<RecoveryRpcResult,{ok:false}> {
 const code=error instanceof Error?error.message:'';
 return {ok:false,code:code==='OPERATOR_PROOF_EXPIRED'?'UNAUTHENTICATED':/CONFLICT|CLOSED|RETIRED|BUSY|STALE|UNRESOLVED|PROBE_REQUIRED|TARGET_NOT_EMPTY/.test(code)?'CONFLICT':/INVALID|MISMATCH|LIMIT|NONCANONICAL|UNKNOWN|RECOVERY_(INTEGER|REAL|TEXT|BLOB|PRIMARY|NULL|BYTES|EVENT_SEQUENCE)/.test(code)?'INVALID_RECOVERY':'RECOVERY_UNAVAILABLE'};
}

/** Contract-only capability. Existing R1 construction does not provide or activate it. */
export interface RecoveryWorkspaceV2 extends RecoveryWorkspace {artifactBucket:R2Bucket;}
export type RecoveryManifestV1=Extract<RecoveryManifest,{format_version:1}>;
export type RecoveryManifestV2=Extract<RecoveryManifest,{format_version:2}>;
export type RecoveryArtifactEntry=RecoveryManifestV2['artifacts'][number];
