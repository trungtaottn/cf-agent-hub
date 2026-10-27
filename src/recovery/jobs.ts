import {UNRESOLVED_EFFECT_IDS_LIMIT} from './generated/recovery-validators.js';
import {canonicalJson} from '../config/bootstrap';
import {withTransaction,type WorkspaceTransaction,type SqlValue} from '../storage/transaction';
import {canonicalBytes,digestBytes,hex,decodeChunk,CHUNK_LIMIT,type SqlCell} from './encoding';
import {TABLE_REGISTRY,type RecoveryTableName} from './table-registry-v1';
import {assertRecoveryContext,boundedData,controlTarget,type RecoveryContext,type RecoveryWorkspace,type RecoveryManifest,type CurrentLedger,type RecoveryReceipt,type RecoveryJobProgress} from './protocol';
import type {AdmissionFence} from './maintenance-v1';
export interface RecoveryBudget {max_rows:number;max_artifacts:number;max_total_bytes:number;}
export interface PendingStep {operationId:string;fingerprint:string;kind:'page'|'hash'|'write'|'verify'|'overlay';endedAt:string;index:number|null;}
export interface JobDetails {
 version:1;fence:AdmissionFence;budget:RecoveryBudget|null;checkpoint:RecoveryManifest['checkpoint'];
 sourceMaintenance:SqlCell[]|null;sourceMetadata:SqlCell[]|null;tableCounts:Record<RecoveryTableName,number>;activeCounts:Record<RecoveryTableName,number>;tableIndex:number;cursor:SqlCell[]|null;
 lastKeys:Partial<Record<RecoveryTableName,SqlCell[]>>;verifyIndex:number;counts:{rows:number;chunks:number;bytes:number};
 phase:RecoveryJobProgress['phase'];step:number;pending:PendingStep|null;receipt:RecoveryReceipt|null;
 manifest:RecoveryManifest|null;ledger:CurrentLedger|null;ledgerDigest:string|null;integrityKeyId:string;
}
export interface RecoveryJob {id:string;workspace_id:string;operation:'capture'|'restore';state:'running'|'complete'|'failed';authority_epoch:number;capture_id:string;manifest_digest:string|null;created_at:number;updated_at:number;details:JobDetails;}
interface StoredJob extends Omit<RecoveryJob,'details'> {details_json:string;}
export interface ChunkRecord {job_id:string;chunk_index:number;table_name:RecoveryTableName;sha256:string;byte_size:number;row_count:number;object_key:string;}
export async function jobIdFor(workspaceId:string,captureId:string,operation:'capture'|'restore'):Promise<string>{return 'job_'+(await digestBytes(canonicalBytes([workspaceId,captureId,operation]))).slice(0,48);}
export function rowJob(row:StoredJob|null):RecoveryJob|null {
 if(!row)return null;const d=JSON.parse(row.details_json) as JobDetails;
 if(d.version!==1||!['capture','restore'].includes(row.operation)||!['running','complete','failed'].includes(row.state)||!d.fence||!d.checkpoint||!d.counts||!Number.isSafeInteger(d.step)||d.step<0||!Array.isArray(d.sourceMaintenance)&&d.sourceMaintenance!==null)throw Error('INVALID_RECOVERY_JOB');
 const {details_json,...job}=row;return {...job,details:d};
}
export function loadJob(tx:WorkspaceTransaction,id:string):RecoveryJob|null{return rowJob(tx.one<StoredJob>('SELECT * FROM recovery_jobs WHERE id=?',[id]));}
export function captureJob(tx:WorkspaceTransaction,captureId:string):RecoveryJob|null{return rowJob(tx.one<StoredJob>("SELECT * FROM recovery_jobs WHERE capture_id=? AND operation IN ('capture','restore') ORDER BY created_at DESC LIMIT 1",[captureId]));}
export function saveJob(tx:WorkspaceTransaction,job:RecoveryJob):void {
 tx.exec('INSERT INTO recovery_jobs (id,workspace_id,operation,state,authority_epoch,capture_id,manifest_digest,created_at,updated_at,details_json) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,manifest_digest=excluded.manifest_digest,updated_at=excluded.updated_at,details_json=excluded.details_json',[job.id,job.workspace_id,job.operation,job.state,job.authority_epoch,job.capture_id,job.manifest_digest,job.created_at,job.updated_at,canonicalJson(job.details)]);
}
export function assertJob(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,id:string):RecoveryJob {
 assertRecoveryContext(tx,w,ctx);const job=loadJob(tx,id);if(!job||job.workspace_id!==w.workspaceId||job.capture_id!==ctx.captureId||job.authority_epoch!==ctx.expectedEpoch)throw Error('RECOVERY_JOB_CONFLICT');
 if(ctx.operation!=='status'&&ctx.operation!=='read-chunk')assertRecoveryContext(tx,w,ctx,job.details.fence);if(job.details.integrityKeyId!==w.integrity.keyId)throw Error('RECOVERY_KEY_MISMATCH');
 if(job.operation==='restore'&&ctx.operation!=='status'&&ctx.operation!=='read-chunk'&&(ctx.ledgerAnchor?.sha256!==job.details.ledgerDigest||ctx.ledgerAnchor?.authorityEpoch!==job.authority_epoch))throw Error('RECOVERY_LEDGER_ANCHOR_CONFLICT');return job;
}
export function reserveStep(job:RecoveryJob,ctx:RecoveryContext,kind:PendingStep['kind'],nowMs:number,index:number|null=null):void {
 if(job.details.pending){const pending=job.details.pending;if(pending.operationId!==ctx.operationId)throw Error('RECOVERY_BUSY');if(pending.fingerprint!==ctx.requestFingerprint||pending.kind!==kind||pending.index!==index)throw Error('RECOVERY_OPERATION_CONFLICT');return;}
 job.details.pending={operationId:ctx.operationId,fingerprint:ctx.requestFingerprint,kind,endedAt:new Date(nowMs).toISOString(),index};job.updated_at=nowMs;
}
export function assertPending(job:RecoveryJob,ctx:RecoveryContext):void {if(job.details.pending?.operationId!==ctx.operationId||job.details.pending.fingerprint!==ctx.requestFingerprint)throw Error('RECOVERY_OPERATION_CONFLICT');}
export function progress(job:RecoveryJob):RecoveryJobProgress {
 const d=job.details,terminal=job.state!=='running';
 const next:RecoveryJobProgress['next_operation']=terminal?null:job.operation==='capture'?'capture':d.phase==='awaiting_chunks'?'write-chunk':'verify';
 return boundedData({job_id:job.id,capture_id:job.capture_id,workspace_id:job.workspace_id,operation:job.operation,authority_epoch:job.authority_epoch,state:job.state,phase:d.phase,step:d.step,counts:d.counts,pending_operation_id:d.pending?.operationId??null,next_operation:next,next_chunk_index:next==='write-chunk'&&d.counts.chunks<(d.manifest?.database.chunks.length??0)?d.counts.chunks:null,receipt:d.receipt,manifest:d.manifest});
}
export function projection(table:string,job:RecoveryJob):{where:string;bindings:SqlValue[]} {
 if(table==='recovery_jobs')return {where:'id<>?',bindings:[job.id]};
 if(table==='recovery_chunks')return {where:'job_id<>?',bindings:[job.id]};
 if(table==='idempotency_outcomes')return {where:"NOT (operation LIKE 'operator.recovery.%' AND target=?)",bindings:[controlTarget(job.capture_id)]};
 return {where:'1=1',bindings:[]};
}
export function objectKey(job:RecoveryJob,index:number,digest:string):string{return 'r1/'+job.workspace_id+'/'+job.id+'/'+index+'/'+digest+'.json';}
export function chunkRecords(tx:WorkspaceTransaction,id:string):readonly ChunkRecord[]{return tx.all<ChunkRecord>('SELECT * FROM recovery_chunks WHERE job_id=? ORDER BY chunk_index',[id]);}
function unresolvedWhere(job:RecoveryJob):string{return "workspace_id=? AND status IN ("+(job.operation==='restore'?"'pending','in_flight'":"'in_flight'")+")";}
/** Admission uses the full current SQL count, independently of any receipt snapshot. */
export function unresolvedEffectCount(tx:WorkspaceTransaction,job:RecoveryJob):number {
 const count=tx.one<{n:number}>('SELECT COUNT(*) AS n FROM outbox WHERE '+unresolvedWhere(job),[job.workspace_id])!.n;
 if(!Number.isSafeInteger(count)||count<0)throw Error('RECOVERY_ROW_COUNT');return count;
}
export function unresolvedSummary(tx:WorkspaceTransaction,job:RecoveryJob):Pick<RecoveryReceipt,'unresolved_effect_ids'|'unresolved_effect_count'|'unresolved_effect_ids_complete'> {
 const count=unresolvedEffectCount(tx,job),ids=tx.all<{id:string}>('SELECT id FROM outbox WHERE '+unresolvedWhere(job)+' ORDER BY id LIMIT ?',[job.workspace_id,UNRESOLVED_EFFECT_IDS_LIMIT]).map(row=>row.id);
 if(ids.length!==Math.min(count,UNRESOLVED_EFFECT_IDS_LIMIT))throw Error('RECOVERY_ROW_COUNT');
 return {unresolved_effect_ids:ids,unresolved_effect_count:count,unresolved_effect_ids_complete:count===ids.length};
}
export function terminalReceipt(tx:WorkspaceTransaction,w:RecoveryWorkspace,job:RecoveryJob,passed:boolean,code:string):RecoveryReceipt {
 return {id:'receipt_'+job.id.slice(4),capture_id:job.capture_id,workspace_id:job.workspace_id,status:passed?'complete':'failed',checks:[{name:job.operation,passed,code}],...unresolvedSummary(tx,job),started_at:new Date(job.created_at).toISOString(),ended_at:job.details.pending?.endedAt??new Date(w.clock.nowMs()).toISOString()};
}
export async function readStoredChunk(w:RecoveryWorkspace,ctx:RecoveryContext,job:RecoveryJob,chunk:ChunkRecord):Promise<Uint8Array<ArrayBuffer>> {
 const fence=withTransaction(w.storage,tx=>assertRecoveryContext(tx,w,ctx));
 const guard=()=>withTransaction(w.storage,tx=>{assertRecoveryContext(tx,w,ctx,fence);return assertJob(tx,w,ctx,job.id);});guard();
 if(chunk.object_key!==objectKey(job,chunk.chunk_index,chunk.sha256)||chunk.byte_size<1||chunk.byte_size>CHUNK_LIMIT)throw Error('RECOVERY_CHUNK_MISMATCH');
 const object=await w.bucket.get(chunk.object_key);guard();if(!object||object.size!==chunk.byte_size)throw Error('RECOVERY_CHUNK_MISMATCH');
 const bytes=new Uint8Array(await object.arrayBuffer());guard();if(bytes.length!==chunk.byte_size||await digestBytes(bytes)!==chunk.sha256)throw Error('RECOVERY_CHUNK_MISMATCH');guard();
 decodeChunk(bytes,{capture_id:job.capture_id,index:chunk.chunk_index,table:chunk.table_name,row_count:chunk.row_count,byte_size:chunk.byte_size});return bytes;
}
/** Raw canonical chunks are fed incrementally; the entire database is never buffered. */
export async function databaseDigest(w:RecoveryWorkspace,ctx:RecoveryContext,job:RecoveryJob):Promise<string>{
 const chunks=withTransaction(w.storage,tx=>{assertJob(tx,w,ctx,job.id);return chunkRecords(tx,job.id);});if(chunks.length>256)throw Error('RECOVERY_CHUNK_LIMIT');
 const Stream=(crypto as Crypto & {DigestStream:typeof DigestStream}).DigestStream;
 if(typeof Stream!=='function')throw Error('RECOVERY_DIGEST_STREAM_UNAVAILABLE');
 const stream=new Stream('SHA-256'),writer=stream.getWriter();
 try{for(const [index,chunk] of chunks.entries()){if(chunk.chunk_index!==index)throw Error('RECOVERY_CHUNK_MISMATCH');const bytes=await readStoredChunk(w,ctx,job,chunk);await writer.write(bytes);withTransaction(w.storage,tx=>assertJob(tx,w,ctx,job.id));}await writer.close();const result=hex(await stream.digest);withTransaction(w.storage,tx=>assertJob(tx,w,ctx,job.id));return result;}
 catch(error){await writer.abort().catch(()=>{});throw error;}
}

/** Future #39/#43 persistence contract; rowJob intentionally still rejects version 2.
 * Serialize the entire details document within RECOVERY_JOB_DETAILS_LIMIT.
 * The immutable manifest is the only inventory; never duplicate it per receipt. */
export interface JobDetailsV2 extends Omit<JobDetails,'version'|'manifest'|'phase'> {
 version:2;manifest:Extract<RecoveryManifest,{format_version:2}>;
 phase:JobDetails['phase']|'capture_artifacts'|'restore_artifacts'|'verify_artifacts';
 artifactTransfer:import('./generated/recovery-validators.js').RecoveryArtifactTransferState;
}
