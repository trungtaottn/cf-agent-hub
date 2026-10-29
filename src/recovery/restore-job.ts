import {canonicalJson} from '../config/bootstrap';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {canonicalBytes,closed,isSlug,RECOVERY_JOB_DETAILS_LIMIT,type SqlCell} from './encoding';
import {validateRecoveryReceipt,validateCurrentLedger} from './generated/recovery-validators.js';
import {validateManifestShape} from './manifest';
import {maintenanceRow,type AdmissionFence} from './maintenance';
import {assertRecoveryContext,boundedData,type RecoveryWorkspace,type RecoveryContext,type CurrentRecoveryManifest,type CurrentLedger,type RecoveryJobProgress,type RecoveryReceipt} from './protocol';
import {TABLE_REGISTRY,type RecoveryTableName} from './table-registry';
import {readTrustedAnchor,type TrustedAnchorSnapshot} from './trusted-anchor';
import type {PendingStep,RecoveryJob} from './jobs';
export interface RestoreDetails {
 version:2;kind:'restore';fence:AdmissionFence;manifest:CurrentRecoveryManifest;ledger:CurrentLedger;ledgerDigest:string;
 anchor:TrustedAnchorSnapshot;releaseIdentity:string;integrityKeyId:string;
 original:{principalId:string;operationId:string;fingerprint:string;expectedEpoch:number};
 sourceMetadata:SqlCell[]|null;sourceMaintenance:SqlCell[]|null;
 counts:{rows:number;chunks:number;bytes:number};activeCounts:Record<RecoveryTableName,number>;lastKeys:Partial<Record<RecoveryTableName,SqlCell[]>>;
 phase:RecoveryJobProgress['phase'];stage:'import'|'fixup'|'validate'|'artifacts'|'transform'|'additions'|'hash'|'complete';
 verifyIndex:number;artifactIndex:number;artifactBytes:number;additionIndex:number;additionOffset:number;
 step:number;pending:PendingStep|null;receipt:RecoveryReceipt|null;
}
export type CurrentRestoreJob=Omit<RecoveryJob,'details'|'operation'>&{operation:'restore';details:RestoreDetails};
interface Stored extends Omit<CurrentRestoreJob,'details'>{details_json:string;}
const count=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>=0;
const hash=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function loadCurrentRestoreJob(tx:WorkspaceTransaction,id:string):CurrentRestoreJob|null {
 const row=tx.one<Stored>('SELECT * FROM recovery_jobs WHERE id=?',[id]);if(!row)return null;
 if(new TextEncoder().encode(row.details_json).length>RECOVERY_JOB_DETAILS_LIMIT)throw Error('INVALID_RECOVERY_JOB');
 const d:unknown=JSON.parse(row.details_json);
 if(!closed(d,['version','kind','fence','manifest','ledger','ledgerDigest','anchor','releaseIdentity','integrityKeyId','original','sourceMetadata','sourceMaintenance','counts','activeCounts','lastKeys','phase','stage','verifyIndex','artifactIndex','artifactBytes','additionIndex','additionOffset','step','pending','receipt'])||d.version!==2||d.kind!=='restore'||row.operation!=='restore'||!['running','complete'].includes(row.state)||!hash(row.manifest_digest)||!hash(d.ledgerDigest))throw Error('INVALID_RECOVERY_JOB');
 validateManifestShape(d.manifest);const m=d.manifest;
 if(m.format_version!==2||m.checkpoint.contract_revision!=='0.2'||m.checkpoint.schema_version!==16||m.capture_id!==row.capture_id||m.workspace_id!==row.workspace_id)throw Error('INVALID_RECOVERY_JOB');
 if(!closed(d.fence,['authorityEpoch','maintenanceGeneration'])||!count(d.fence.authorityEpoch)||!count(d.fence.maintenanceGeneration)||d.fence.authorityEpoch!==row.authority_epoch||!closed(d.original,['principalId','operationId','fingerprint','expectedEpoch'])||!isSlug(d.original.principalId)||!isSlug(d.original.operationId)||!hash(d.original.fingerprint)||d.original.expectedEpoch!==0)throw Error('INVALID_RECOVERY_JOB');
 if(!closed(d.counts,['rows','chunks','bytes'])||![d.counts.rows,d.counts.chunks,d.counts.bytes,d.verifyIndex,d.artifactIndex,d.artifactBytes,d.additionIndex,d.additionOffset,d.step].every(count)||Number(d.counts.rows)>1000000||Number(d.counts.chunks)>m.database.chunks.length||Number(d.counts.bytes)>268435456||Number(d.verifyIndex)>m.database.chunks.length||Number(d.artifactIndex)>m.artifacts.length||Number(d.additionIndex)>3||Number(d.additionOffset)>1000000)throw Error('INVALID_RECOVERY_JOB');
 if(!validateCurrentLedger(d.ledger)||canonicalBytes(d.ledger).length>65536||d.ledger.authority_epoch!==row.authority_epoch||d.ledger.workspace_id!==row.workspace_id)throw Error('INVALID_RECOVERY_JOB');
 const prefix=m.database.chunks.slice(0,Number(d.counts.chunks));if(prefix.reduce((n,c)=>n+c.row_count,0)!==d.counts.rows||prefix.reduce((n,c)=>n+c.byte_size,0)!==d.counts.bytes||Number(d.artifactBytes)>268435456)throw Error('INVALID_RECOVERY_JOB');
 const names=TABLE_REGISTRY.map(t=>t.name);if(!closed(d.activeCounts,names)||Object.values(d.activeCounts).some(v=>!count(v))||d.lastKeys===null||typeof d.lastKeys!=='object'||Array.isArray(d.lastKeys)||Object.keys(d.lastKeys).some(k=>!names.includes(k as RecoveryTableName)))throw Error('INVALID_RECOVERY_JOB');
 for(const table of TABLE_REGISTRY){if(Number(d.activeCounts[table.name])> (m.database.table_counts as Record<RecoveryTableName,number>)[table.name])throw Error('INVALID_RECOVERY_JOB');const key=(d.lastKeys as Record<string,unknown>)[table.name];if(key!==undefined&&(!Array.isArray(key)||key.length!==table.primaryKey.length||key.some(x=>typeof x!=='string'&&!Number.isSafeInteger(x))))throw Error('INVALID_RECOVERY_JOB');}
 if(d.sourceMetadata!==null&&(!Array.isArray(d.sourceMetadata)||d.sourceMetadata.length!==TABLE_REGISTRY.find(t=>t.name==='workspace_metadata')!.columns.length)||d.sourceMaintenance!==null&&(!Array.isArray(d.sourceMaintenance)||d.sourceMaintenance.length!==TABLE_REGISTRY.find(t=>t.name==='maintenance_state')!.columns.length))throw Error('INVALID_RECOVERY_JOB');
 if(!['import','fixup','validate','artifacts','transform','additions','hash','complete'].includes(String(d.stage))||!['awaiting_chunks','verify_pages','overlay_authority','hash_chunks','complete'].includes(String(d.phase))||d.stage==='import'&&d.phase!=='awaiting_chunks'||d.stage==='complete'&&(row.state!=='complete'||d.phase!=='complete')||row.state==='complete'&&d.stage!=='complete')throw Error('INVALID_RECOVERY_JOB');
 if(d.pending!==null&&(!closed(d.pending,['operationId','fingerprint','kind','endedAt','index'])||typeof d.pending.operationId!=='string'||!hash(d.pending.fingerprint)||!['write','verify','artifact','overlay','hash'].includes(String(d.pending.kind))||typeof d.pending.endedAt!=='string'||!Number.isFinite(Date.parse(d.pending.endedAt))||d.pending.index!==null&&!count(d.pending.index)))throw Error('INVALID_RECOVERY_JOB');
 if(d.receipt!==null&&!validateRecoveryReceipt(d.receipt)||row.state==='complete'&&(d.receipt===null||d.pending!==null)||d.sourceMetadata!==null&&!Array.isArray(d.sourceMetadata)||d.sourceMaintenance!==null&&!Array.isArray(d.sourceMaintenance)||typeof d.releaseIdentity!=='string'||typeof d.integrityKeyId!=='string')throw Error('INVALID_RECOVERY_JOB');
 const {details_json,...rest}=row;return {...rest,details:d as unknown as RestoreDetails};
}
export function saveCurrentRestoreJob(tx:WorkspaceTransaction,job:CurrentRestoreJob):void {
 if(canonicalBytes(job.details).length>RECOVERY_JOB_DETAILS_LIMIT)throw Error('RECOVERY_JOB_DETAILS_LIMIT');
 tx.exec('INSERT INTO recovery_jobs (id,workspace_id,operation,state,authority_epoch,capture_id,manifest_digest,created_at,updated_at,details_json) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,manifest_digest=excluded.manifest_digest,updated_at=excluded.updated_at,details_json=excluded.details_json',[job.id,job.workspace_id,job.operation,job.state,job.authority_epoch,job.capture_id,job.manifest_digest,job.created_at,job.updated_at,canonicalJson(job.details)]);
}
export function assertCurrentRestoreJob(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,id:string):CurrentRestoreJob {
 assertRecoveryContext(tx,w,ctx);const job=loadCurrentRestoreJob(tx,id);if(!job||job.workspace_id!==w.workspaceId||job.capture_id!==ctx.captureId||job.authority_epoch!==ctx.expectedEpoch)throw Error('RECOVERY_JOB_CONFLICT');
 assertRecoveryContext(tx,w,ctx,job.details.fence);const m=maintenanceRow(tx);
 if(!m||m.state!==(job.state==='complete'?'restored':'restoring')||m.capture_id!==job.capture_id||m.barrier_id!=='barrier_'+job.id.slice(4)||tx.one<{admission_state:string}>('SELECT admission_state FROM workspace_metadata WHERE id=1')?.admission_state!=='maintenance')throw Error('RECOVERY_BARRIER_MISMATCH');
 if(job.details.integrityKeyId!==w.integrity.keyId||job.details.releaseIdentity!==canonicalJson(w.release))throw Error('RECOVERY_SOURCE_IDENTITY_MISMATCH');
 if(ctx.ledgerAnchor?.authorityEpoch!==job.authority_epoch||ctx.ledgerAnchor.sha256!==job.details.ledgerDigest)throw Error('RECOVERY_LEDGER_ANCHOR_CONFLICT');
 const rows=tx.all<{chunk_index:number;table_name:string;sha256:string;byte_size:number;row_count:number;object_key:string}>('SELECT * FROM recovery_chunks WHERE job_id=? ORDER BY chunk_index LIMIT 257',[id]);
 if(rows.length!==job.details.counts.chunks||rows.some((r,i)=>{const e=job.details.manifest.database.chunks[i];return r.chunk_index!==i||r.table_name!==e.table||r.sha256!==e.sha256||r.byte_size!==e.byte_size||r.row_count!==e.row_count||r.object_key!==restoreObjectKey(job,i,r.sha256);}))throw Error('RECOVERY_CHUNK_MISMATCH');
 return job;
}
export function restoreObjectKey(job:CurrentRestoreJob,index:number,digest:string):string{return `r2/${job.workspace_id}/${job.id}/${index}/${digest}.json`;}
export function restoreProgress(job:CurrentRestoreJob):RecoveryJobProgress {
 const d=job.details,next=job.state==='complete'?null:d.stage==='import'?'write-chunk':'verify';
 // The authenticated manifest is already held by the restore caller. Avoid doubling the response budget.
 return boundedData({job_id:job.id,capture_id:job.capture_id,workspace_id:job.workspace_id,operation:'restore',authority_epoch:job.authority_epoch,state:job.state,phase:d.phase,step:d.step,counts:d.counts,pending_operation_id:d.pending?.operationId??null,next_operation:next,next_chunk_index:next==='write-chunk'?d.counts.chunks:null,receipt:d.receipt,manifest:null});
}
export function restoreGuard(w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentRestoreJob):()=>Promise<void>{
 const bucket=w.bucket,artifact=w.artifactBucket,capability=w.trustedAnchor,secret=w.integrity.key;
 const baseline=withTransaction(w.storage,tx=>{assertCurrentRestoreJob(tx,w,ctx,job.id);return tx.one<Stored>('SELECT * FROM recovery_jobs WHERE id=?',[job.id])!;});
 const local=()=>withTransaction(w.storage,tx=>{
  if(w.bucket!==bucket||w.artifactBucket!==artifact||!artifact||artifact===bucket||w.trustedAnchor!==capability)throw Error('RECOVERY_ARTIFACT_BINDING_UNAVAILABLE');
  assertRecoveryContext(tx,w,ctx,job.details.fence);if(canonicalJson(w.release)!==job.details.releaseIdentity||w.integrity.keyId!==job.details.integrityKeyId||w.integrity.key!==secret)throw Error('RECOVERY_SOURCE_IDENTITY_MISMATCH');
  const m=maintenanceRow(tx);if(!m||m.state!==(job.state==='complete'?'restored':'restoring')||m.capture_id!==job.capture_id||m.barrier_id!=='barrier_'+job.id.slice(4)||tx.one<{admission_state:string}>('SELECT admission_state FROM workspace_metadata WHERE id=1')?.admission_state!=='maintenance')throw Error('RECOVERY_BARRIER_MISMATCH');
  const actual=tx.one<Stored>('SELECT * FROM recovery_jobs WHERE id=?',[job.id]);if(!actual||Object.keys(baseline).some(k=>actual[k as keyof Stored]!==baseline[k as keyof Stored]))throw Error('RECOVERY_OPERATION_CONFLICT');
 });
 return async()=>{await readTrustedAnchor(w,ctx,job.details.anchor,local);local();};
}
