import {canonicalJson} from '../config/bootstrap';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {canonicalBytes,closed,digestBytes,isSlug} from './encoding';
import {maintenanceRow} from './maintenance';
import {assertRecoveryContext,controlTarget,priorOperation,storeOperation,recoverySchema,type RecoveryContext,type RecoveryWorkspace,type RecoveryData} from './protocol';
import {loadCurrentCaptureJob,assertCurrentCaptureJob,type CurrentCaptureJob} from './jobs';
import {loadCurrentRestoreJob,assertCurrentRestoreJob,type CurrentRestoreJob} from './restore-job';
import {readTrustedAnchor,type TrustedAnchorSnapshot} from './trusted-anchor';

export interface ControlLocalState {
 epoch:number;installationDigest:string;generation:number;state:string;
 barrierId:string|null;captureId:string|null;admissionState:string;
}
export interface ControlAdmission {
 version:1;status:'pending'|'completed';anchor:TrustedAnchorSnapshot;local:ControlLocalState;
 jobId:string|null;jobDigest:string|null;releaseDigest:string;integrityKeyId:string;outcomeDigest:string|null;
}
export type ControlJob=CurrentCaptureJob|CurrentRestoreJob;
const hash=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const count=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>=0;
const nullableSlug=(x:unknown)=>x===null||isSlug(x);
export function parseControlAdmission(input:unknown):ControlAdmission {
 if(canonicalBytes(input).length>4096||!closed(input,['version','status','anchor','local','jobId','jobDigest','releaseDigest','integrityKeyId','outcomeDigest'])||input.version!==1||!['pending','completed'].includes(String(input.status))||!nullableSlug(input.jobId)||!(input.jobDigest===null||hash(input.jobDigest))||(input.jobId===null)!==(input.jobDigest===null)||!hash(input.releaseDigest)||!isSlug(input.integrityKeyId)||!(input.status==='pending'?input.outcomeDigest===null:hash(input.outcomeDigest)))throw Error('INVALID_RECOVERY_CONTROL_ADMISSION');
 const a=input.anchor,s=input.local;
 if(!closed(a,['bindingId','workspaceId','environmentId','objectName','authorityEpoch','sha256','generation'])||![a.bindingId,a.workspaceId,a.environmentId,a.objectName].every(isSlug)||!count(a.authorityEpoch)||Number(a.authorityEpoch)<1||!hash(a.sha256)||!count(a.generation)||Number(a.generation)<1||!closed(s,['epoch','installationDigest','generation','state','barrierId','captureId','admissionState'])||!count(s.epoch)||Number(s.epoch)<1||!hash(s.installationDigest)||!count(s.generation)||!['open','captured','restored','retired'].includes(String(s.state))||!nullableSlug(s.barrierId)||!nullableSlug(s.captureId)||!['installed','maintenance','retired'].includes(String(s.admissionState))||a.authorityEpoch!==s.epoch)throw Error('INVALID_RECOVERY_CONTROL_ADMISSION');
 return structuredClone(input) as unknown as ControlAdmission;
}
function localState(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext):ControlLocalState {
 const fence=assertRecoveryContext(tx,w,ctx);if(recoverySchema(tx,ctx)!==16)throw Error('RECOVERY_FORMAT_UNAVAILABLE');
 const m=maintenanceRow(tx),meta=tx.one<{installation_digest:string;admission_state:string}>('SELECT installation_digest,admission_state FROM workspace_metadata WHERE id=1');
 if(!meta)throw Error('RECOVERY_CONTROL_CONFLICT');
 return {epoch:fence.authorityEpoch,installationDigest:meta.installation_digest,generation:fence.maintenanceGeneration,state:m?.state??'open',barrierId:m?.barrier_id??null,captureId:m?.capture_id??null,admissionState:meta.admission_state};
}
const bindings=(ctx:RecoveryContext)=>[ctx.principalId,'operator.recovery.admission.'+ctx.operation,controlTarget(ctx.captureId),ctx.operationId,ctx.workspaceId];
function readAdmission(tx:WorkspaceTransaction,ctx:RecoveryContext):ControlAdmission|null {
 const row=tx.one<{fingerprint:string;status:number;outcome_json:string}>('SELECT fingerprint,status,outcome_json FROM idempotency_outcomes WHERE principal_id=? AND operation=? AND target=? AND key=? AND workspace_id=?',bindings(ctx));
 if(!row)return null;
 if(row.status!==202||row.fingerprint!==ctx.requestFingerprint||new TextEncoder().encode(row.outcome_json).length>4096)throw Error('RECOVERY_CONTROL_ADMISSION_CONFLICT');
 return parseControlAdmission(JSON.parse(row.outcome_json));
}
function saveAdmission(tx:WorkspaceTransaction,ctx:RecoveryContext,record:ControlAdmission,now:number,update=false):void {
 parseControlAdmission(record);const text=canonicalJson(record);
 if(update)tx.exec('UPDATE idempotency_outcomes SET outcome_json=? WHERE principal_id=? AND operation=? AND target=? AND key=? AND workspace_id=?',[text,...bindings(ctx)]);
 else tx.exec('INSERT INTO idempotency_outcomes (principal_id,operation,target,key,workspace_id,fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at) VALUES (?,?,?,?,?,?,202,?,?,NULL,?,?)',[...bindings(ctx),ctx.requestFingerprint,text,ctx.requestId,now,Number.MAX_SAFE_INTEGER]);
}
function rawJob(tx:WorkspaceTransaction,id:string|null):string|null {
 if(id===null)return null;
 const row=tx.one<Record<string,unknown>>('SELECT * FROM recovery_jobs WHERE id=?',[id]);if(!row)throw Error('RECOVERY_JOB_CONFLICT');return canonicalJson(row);
}
function pendingJob(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,local:ControlLocalState):ControlJob|null {
 if(ctx.operation==='probe'&&local.state==='open')return null;
 const capture=ctx.captureId??local.captureId;
 if(!capture||!['captured','restored'].includes(local.state)||local.captureId!==capture)throw Error('RECOVERY_CONTROL_CONFLICT');
 const row=tx.one<{id:string;operation:string}>('SELECT id,operation FROM recovery_jobs WHERE capture_id=?',[capture]);if(!row)throw Error('RECOVERY_JOB_CONFLICT');
 const scoped={...ctx,captureId:capture};
 const job=row.operation==='capture'?assertCurrentCaptureJob(tx,w,scoped,row.id):row.operation==='restore'?assertCurrentRestoreJob(tx,w,scoped,row.id):null;
 if(!job||job.state!=='complete'||job.details.receipt?.status!=='complete'||job.details.manifest?.checkpoint.schema_version!==16)throw Error('RECOVERY_CONTROL_CONFLICT');
 return job;
}
export interface ControlSession {
 record:ControlAdmission;job:ControlJob|null;prior:RecoveryData|null;
 guard:()=>Promise<void>;assertPending:(tx:WorkspaceTransaction)=>void;
 complete:(tx:WorkspaceTransaction,data:RecoveryData,outcomeDigest:string)=>void;
}
/** Separate internal evidence leaves both capture manifests and closed job details untouched. */
export async function admitCurrentControl(w:RecoveryWorkspace,ctx:RecoveryContext):Promise<ControlSession> {
 if(!['retire','resume','resolve-delivery','probe'].includes(ctx.operation))throw Error('INVALID_RECOVERY_CONTEXT');
 ctx=structuredClone(ctx);
 const capability=w.trustedAnchor,anchorBinding=capability?.binding,anchorFetch=anchorBinding?.fetch,bucket=w.bucket,artifacts=w.artifactBucket,key=w.integrity.key,keyId=w.integrity.keyId,release=canonicalJson(w.release);
 const initial=withTransaction(w.storage,tx=>{
  const local=localState(tx,w,ctx),record=readAdmission(tx,ctx),prior=priorOperation(tx,ctx);
  if((record?.status==='completed')!==(prior!==null))throw Error('RECOVERY_CONTROL_ADMISSION_CONFLICT');
  if(record&&canonicalJson(record.local)!==canonicalJson(local))throw Error('RECOVERY_CONTROL_ADMISSION_CONFLICT');
  const job=record?.status==='completed'?(record.jobId===null?null:(tx.one<{operation:string}>('SELECT operation FROM recovery_jobs WHERE id=?',[record.jobId])?.operation==='capture'?loadCurrentCaptureJob(tx,record.jobId):loadCurrentRestoreJob(tx,record.jobId))):pendingJob(tx,w,ctx,local);
  if(record&&record.jobId!==(job?.id??null))throw Error('RECOVERY_CONTROL_ADMISSION_CONFLICT');
  return {local,record,prior,job,raw:rawJob(tx,job?.id??null)};
 });
 const localCheck=()=>withTransaction(w.storage,tx=>{
  if(w.trustedAnchor!==capability||w.trustedAnchor?.binding!==anchorBinding||w.trustedAnchor?.binding.fetch!==anchorFetch||w.bucket!==bucket||w.artifactBucket!==artifacts||w.integrity.key!==key||w.integrity.keyId!==keyId||canonicalJson(w.release)!==release||canonicalJson(localState(tx,w,ctx))!==canonicalJson(initial.local)||rawJob(tx,initial.job?.id??null)!==initial.raw)throw Error('RECOVERY_CONTROL_ADMISSION_CONFLICT');
 });
 let anchor=await readTrustedAnchor(w,ctx,initial.record?.anchor??(initial.job?.operation==='restore'?initial.job.details.anchor:undefined),localCheck);localCheck();
 const fresh=async()=>{await readTrustedAnchor(w,ctx,anchor,localCheck);localCheck();};
 const releaseDigest=await digestBytes(canonicalBytes(w.release));await fresh();
 const jobDigest=initial.raw===null?null:await digestBytes(new TextEncoder().encode(initial.raw));if(initial.raw!==null)await fresh();
 if(initial.record&&(initial.record.releaseDigest!==releaseDigest||initial.record.jobDigest!==jobDigest||initial.record.integrityKeyId!==keyId))throw Error('RECOVERY_CONTROL_ADMISSION_CONFLICT');
 let record=initial.record??parseControlAdmission({version:1,status:'pending',anchor,local:initial.local,jobId:initial.job?.id??null,jobDigest,releaseDigest,integrityKeyId:keyId,outcomeDigest:null});
 if(initial.prior){const digest=await digestBytes(canonicalBytes(initial.prior));await fresh();if(digest!==record.outcomeDigest)throw Error('RECOVERY_CONTROL_ADMISSION_CONFLICT');}
 else withTransaction(w.storage,tx=>{localCheck();const current=readAdmission(tx,ctx);if(current&&canonicalJson(current)!==canonicalJson(record)||priorOperation(tx,ctx)!==null)throw Error('RECOVERY_CONTROL_ADMISSION_CONFLICT');if(!current)saveAdmission(tx,ctx,record,w.clock.nowMs());});
 const assertRecord=(tx:WorkspaceTransaction)=>{localCheck();if(canonicalJson(priorOperation(tx,ctx))!==canonicalJson(initial.prior)||canonicalJson(readAdmission(tx,ctx))!==canonicalJson(record))throw Error('RECOVERY_CONTROL_ADMISSION_CONFLICT');};
 withTransaction(w.storage,assertRecord);
 const guard=async()=>{await fresh();withTransaction(w.storage,assertRecord);};
 return {record,job:initial.job,prior:initial.prior,guard,assertPending(tx){assertRecord(tx);if(record.status!=='pending'||priorOperation(tx,ctx)!==null)throw Error('RECOVERY_CONTROL_ADMISSION_CONFLICT');},complete(tx,data,outcomeDigest){
  if(record.status!=='pending'||!hash(outcomeDigest)||canonicalJson(readAdmission(tx,ctx))!==canonicalJson(record)||priorOperation(tx,ctx)!==null)throw Error('RECOVERY_CONTROL_ADMISSION_CONFLICT');
  const completed=parseControlAdmission({...record,status:'completed',local:localState(tx,w,ctx),outcomeDigest});
  storeOperation(tx,ctx,data,w.clock.nowMs());saveAdmission(tx,ctx,completed,w.clock.nowMs(),true);
 }};
}
