import {validateRecoveryManifest,validateRecoveryReceipt,UNRESOLVED_EFFECT_IDS_LIMIT} from './generated/recovery-validators.js';
import {canonicalJson} from '../config/bootstrap';
import {withTransaction,type WorkspaceTransaction,type SqlValue} from '../storage/transaction';
import {canonicalBytes,digestBytes,hex,decodeChunk,decodeCurrentChunk,encodeCurrentChunk,closed,RECOVERY_JOB_DETAILS_LIMIT,CHUNK_LIMIT,type SqlCell} from './encoding';
import {TABLE_REGISTRY,type RecoveryTableName} from './table-registry-v1';
import {assertRecoveryContext,boundedData,controlTarget,type RecoveryContext,type RecoveryWorkspace,type RecoveryManifest,type CurrentLedger,type RecoveryReceipt,type RecoveryJobProgress,type CurrentRecoveryManifest,type CurrentRecoveryArtifactEntry} from './protocol';
import {TABLE_REGISTRY as CURRENT_TABLE_REGISTRY,type RecoveryTableName as CurrentTableName} from './table-registry';
import type {AdmissionFence} from './maintenance-v1';
import {maintenanceRow} from './maintenance';
import {validateManifestShape} from './manifest';
export interface RecoveryBudget {max_rows:number;max_artifacts:number;max_total_bytes:number;}
export interface PendingStep {operationId:string;fingerprint:string;kind:'page'|'hash'|'write'|'verify'|'overlay'|'artifact'|'finalize';endedAt:string;index:number|null;}
export interface JobDetails {
 version:1;fence:AdmissionFence;budget:RecoveryBudget|null;checkpoint:Extract<RecoveryManifest,{format_version:1}>['checkpoint'];
 sourceMaintenance:SqlCell[]|null;sourceMetadata:SqlCell[]|null;tableCounts:Record<RecoveryTableName,number>;activeCounts:Record<RecoveryTableName,number>;tableIndex:number;cursor:SqlCell[]|null;
 lastKeys:Partial<Record<RecoveryTableName,SqlCell[]>>;verifyIndex:number;counts:{rows:number;chunks:number;bytes:number};
 phase:RecoveryJobProgress['phase'];step:number;pending:PendingStep|null;receipt:RecoveryReceipt|null;
 manifest:Extract<RecoveryManifest,{format_version:1}>|null;ledger:CurrentLedger|null;ledgerDigest:string|null;integrityKeyId:string;
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
export function saveJob(tx:WorkspaceTransaction,job:AnyRecoveryJob):void {
 if(job.details.version===2&&canonicalBytes(job.details).length>RECOVERY_JOB_DETAILS_LIMIT)throw Error('RECOVERY_JOB_DETAILS_LIMIT');
 tx.exec('INSERT INTO recovery_jobs (id,workspace_id,operation,state,authority_epoch,capture_id,manifest_digest,created_at,updated_at,details_json) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,manifest_digest=excluded.manifest_digest,updated_at=excluded.updated_at,details_json=excluded.details_json',[job.id,job.workspace_id,job.operation,job.state,job.authority_epoch,job.capture_id,job.manifest_digest,job.created_at,job.updated_at,canonicalJson(job.details)]);
}
export function assertJob(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,id:string):RecoveryJob {
 assertRecoveryContext(tx,w,ctx);const job=loadJob(tx,id);if(!job||job.workspace_id!==w.workspaceId||job.capture_id!==ctx.captureId||job.authority_epoch!==ctx.expectedEpoch)throw Error('RECOVERY_JOB_CONFLICT');
 if(ctx.operation!=='status'&&ctx.operation!=='read-chunk')assertRecoveryContext(tx,w,ctx,job.details.fence);if(job.details.integrityKeyId!==w.integrity.keyId)throw Error('RECOVERY_KEY_MISMATCH');
 if(job.operation==='restore'&&ctx.operation!=='status'&&ctx.operation!=='read-chunk'&&(ctx.ledgerAnchor?.sha256!==job.details.ledgerDigest||ctx.ledgerAnchor?.authorityEpoch!==job.authority_epoch))throw Error('RECOVERY_LEDGER_ANCHOR_CONFLICT');return job;
}
export function reserveStep(job:AnyRecoveryJob,ctx:RecoveryContext,kind:PendingStep['kind'],nowMs:number,index:number|null=null):void {
 if(job.details.pending){const pending=job.details.pending;if(pending.operationId!==ctx.operationId)throw Error('RECOVERY_BUSY');if(pending.fingerprint!==ctx.requestFingerprint||pending.kind!==kind||pending.index!==index)throw Error('RECOVERY_OPERATION_CONFLICT');return;}
 job.details.pending={operationId:ctx.operationId,fingerprint:ctx.requestFingerprint,kind,endedAt:new Date(nowMs).toISOString(),index};job.updated_at=nowMs;
}
export function assertPending(job:AnyRecoveryJob,ctx:RecoveryContext):void {if(job.details.pending?.operationId!==ctx.operationId||job.details.pending.fingerprint!==ctx.requestFingerprint)throw Error('RECOVERY_OPERATION_CONFLICT');}
export function progress(job:AnyRecoveryJob):RecoveryJobProgress {
 const d=job.details,terminal=job.state!=='running';
 const next:RecoveryJobProgress['next_operation']=terminal?null:job.operation==='capture'?'capture':d.phase==='awaiting_chunks'?'write-chunk':'verify';
 return boundedData({job_id:job.id,capture_id:job.capture_id,workspace_id:job.workspace_id,operation:job.operation,authority_epoch:job.authority_epoch,state:job.state,phase:d.phase,step:d.step,counts:d.counts,pending_operation_id:d.pending?.operationId??null,next_operation:next,next_chunk_index:next==='write-chunk'&&d.counts.chunks<(d.manifest?.database.chunks.length??0)?d.counts.chunks:null,receipt:d.receipt,manifest:d.manifest});
}
export function projection(table:string,job:AnyRecoveryJob):{where:string;bindings:SqlValue[]} {
 if(table==='recovery_jobs')return {where:'id<>?',bindings:[job.id]};
 if(table==='recovery_chunks')return {where:'job_id<>?',bindings:[job.id]};
 if(table==='idempotency_outcomes')return {where:"NOT (operation LIKE 'operator.recovery.%' AND target=?)",bindings:[controlTarget(job.capture_id)]};
 return {where:'1=1',bindings:[]};
}
export function objectKey(job:AnyRecoveryJob,index:number,digest:string):string{return (job.details.version===2?'r2/':'r1/')+job.workspace_id+'/'+job.id+'/'+index+'/'+digest+'.json';}
export function chunkRecords(tx:WorkspaceTransaction,id:string):readonly ChunkRecord[]{return tx.all<ChunkRecord>('SELECT * FROM recovery_chunks WHERE job_id=? ORDER BY chunk_index',[id]);}
function unresolvedWhere(job:AnyRecoveryJob):string{return "workspace_id=? AND status IN ("+(job.operation==='restore'?"'pending','in_flight'":"'in_flight'")+")";}
/** Admission uses the full current SQL count, independently of any receipt snapshot. */
export function unresolvedEffectCount(tx:WorkspaceTransaction,job:AnyRecoveryJob):number {
 const count=tx.one<{n:number}>('SELECT COUNT(*) AS n FROM outbox WHERE '+unresolvedWhere(job),[job.workspace_id])!.n;
 if(!Number.isSafeInteger(count)||count<0)throw Error('RECOVERY_ROW_COUNT');return count;
}
export function unresolvedSummary(tx:WorkspaceTransaction,job:AnyRecoveryJob):Pick<RecoveryReceipt,'unresolved_effect_ids'|'unresolved_effect_count'|'unresolved_effect_ids_complete'> {
 const count=unresolvedEffectCount(tx,job),ids=tx.all<{id:string}>('SELECT id FROM outbox WHERE '+unresolvedWhere(job)+' ORDER BY id LIMIT ?',[job.workspace_id,UNRESOLVED_EFFECT_IDS_LIMIT]).map(row=>row.id);
 if(ids.length!==Math.min(count,UNRESOLVED_EFFECT_IDS_LIMIT))throw Error('RECOVERY_ROW_COUNT');
 return {unresolved_effect_ids:ids,unresolved_effect_count:count,unresolved_effect_ids_complete:count===ids.length};
}
export function terminalReceipt(tx:WorkspaceTransaction,w:RecoveryWorkspace,job:AnyRecoveryJob,passed:boolean,code:string):RecoveryReceipt {
 return {id:'receipt_'+job.id.slice(4),capture_id:job.capture_id,workspace_id:job.workspace_id,status:passed?'complete':'failed',checks:[{name:job.operation,passed,code}],...unresolvedSummary(tx,job),started_at:new Date(job.created_at).toISOString(),ended_at:job.details.pending?.endedAt??new Date(w.clock.nowMs()).toISOString()};
}
export async function readStoredChunk(w:RecoveryWorkspace,ctx:RecoveryContext,job:AnyRecoveryJob,chunk:Omit<ChunkRecord,'table_name'>&{table_name:string}):Promise<Uint8Array<ArrayBuffer>> {
 const fence=withTransaction(w.storage,tx=>assertRecoveryContext(tx,w,ctx)),bucket=w.bucket,artifactBucket=w.artifactBucket;
 const guard=job.details.version===2?currentCaptureGuard(w,ctx,job as CurrentCaptureJob):()=>withTransaction(w.storage,tx=>{assertRecoveryContext(tx,w,ctx,fence);return assertAnyJob(tx,w,ctx,job);});guard();
 if(chunk.object_key!==objectKey(job,chunk.chunk_index,chunk.sha256)||chunk.byte_size<1||chunk.byte_size>CHUNK_LIMIT)throw Error('RECOVERY_CHUNK_MISMATCH');
 const object=await bucket.get(chunk.object_key);try{guard();}catch(error){void object?.body.cancel().catch(()=>{});throw error;}if(!object||object.size!==chunk.byte_size){void object?.body.cancel().catch(()=>{});throw Error('RECOVERY_CHUNK_MISMATCH');}
 const bytes=job.details.version===2?await boundedChunk(object.body,chunk.byte_size,guard):new Uint8Array(await object.arrayBuffer());guard();if(bytes.length!==chunk.byte_size||await digestBytes(bytes)!==chunk.sha256)throw Error('RECOVERY_CHUNK_MISMATCH');guard();
 const expected={capture_id:job.capture_id,index:chunk.chunk_index,table:chunk.table_name,row_count:chunk.row_count,byte_size:chunk.byte_size};if(job.details.version===2)decodeCurrentChunk(bytes,{...expected,schema_version:job.details.checkpoint!.schema_version});else decodeChunk(bytes,expected);return bytes;
}
async function boundedChunk(body:ReadableStream<Uint8Array>,expected:number,guard:()=>unknown):Promise<Uint8Array<ArrayBuffer>>{
 const reader=body.getReader(),bytes=new Uint8Array(expected);let offset=0;
 try{for(;;){guard();const item=await reader.read();guard();if(item.done)break;if(!(item.value instanceof Uint8Array)||item.value.byteLength===0||offset+item.value.byteLength>expected)throw Error('RECOVERY_CHUNK_MISMATCH');bytes.set(item.value,offset);offset+=item.value.byteLength;}if(offset!==expected)throw Error('RECOVERY_CHUNK_MISMATCH');return bytes;}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
/** Raw canonical chunks are fed incrementally; the entire database is never buffered. */
export async function databaseDigest(w:RecoveryWorkspace,ctx:RecoveryContext,job:AnyRecoveryJob):Promise<string>{
 const guard=job.details.version===2?currentCaptureGuard(w,ctx,job as CurrentCaptureJob):()=>withTransaction(w.storage,tx=>assertAnyJob(tx,w,ctx,job));
 guard();const chunks=withTransaction(w.storage,tx=>chunkRecords(tx,job.id));if(chunks.length>256)throw Error('RECOVERY_CHUNK_LIMIT');
 const Stream=(crypto as Crypto & {DigestStream:typeof DigestStream}).DigestStream;
 if(typeof Stream!=='function')throw Error('RECOVERY_DIGEST_STREAM_UNAVAILABLE');
 const stream=new Stream('SHA-256'),writer=stream.getWriter(),hashed=stream.digest.then(value=>({value}),error=>({error}));
 try{for(const [index,chunk] of chunks.entries()){if(chunk.chunk_index!==index)throw Error('RECOVERY_CHUNK_MISMATCH');guard();const bytes=await readStoredChunk(w,ctx,job,chunk);guard();await writer.write(bytes);guard();}guard();await writer.close();guard();const hash=await hashed;guard();if('error'in hash)throw hash.error;const result=hex(hash.value);guard();return result;}
 catch(error){await writer.abort().catch(()=>{});throw error;}
}

/** Versioned capture state shares the existing job/chunk ledger; no restore capability. */
export interface JobDetailsV2 {
 version:2;fence:AdmissionFence;budget:RecoveryBudget;barrierId:string;
 checkpoint:CurrentRecoveryManifest['checkpoint']|null;sourceMaintenance:SqlCell[]|null;
 draft:CurrentRecoveryManifest|null;manifest:CurrentRecoveryManifest|null;
 tableIndex:number;cursor:SqlCell[]|null;counts:{rows:number;chunks:number;bytes:number};
 sqlBytes:number;artifactIndex:number;artifactBytes:number;pendingArtifact:CurrentRecoveryArtifactEntry|null;
 phase:RecoveryJobProgress['phase'];step:number;pending:PendingStep|null;receipt:RecoveryReceipt|null;
 integrityKeyId:string;diagnostic:{code:string;at:number;attempts:number}|null;
}
export type CurrentCaptureJob=Omit<RecoveryJob,'operation'|'details'>&{operation:'capture';details:JobDetailsV2};
export type AnyRecoveryJob=RecoveryJob|CurrentCaptureJob;
const safeCount=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
/** Validate persisted phase, inventory and exact verified prefix on every use. */
export function loadCurrentCaptureJob(tx:WorkspaceTransaction,id:string):CurrentCaptureJob|null{
 const row=tx.one<StoredJob>('SELECT * FROM recovery_jobs WHERE id=?',[id]);if(!row)return null;
 if(new TextEncoder().encode(row.details_json).byteLength>RECOVERY_JOB_DETAILS_LIMIT)throw Error('INVALID_RECOVERY_JOB');
 const d:unknown=JSON.parse(row.details_json);
 if(canonicalBytes(d).length>RECOVERY_JOB_DETAILS_LIMIT||!closed(d,['version','fence','budget','barrierId','checkpoint','sourceMaintenance','draft','manifest','tableIndex','cursor','counts','sqlBytes','artifactIndex','artifactBytes','pendingArtifact','phase','step','pending','receipt','integrityKeyId','diagnostic'])||d.version!==2||row.operation!=='capture'||!['running','complete','failed'].includes(row.state))throw Error('INVALID_RECOVERY_JOB');
 if(!closed(d.fence,['authorityEpoch','maintenanceGeneration'])||!safeCount(d.fence.authorityEpoch)||!safeCount(d.fence.maintenanceGeneration)||d.fence.authorityEpoch!==row.authority_epoch||!closed(d.budget,['max_rows','max_artifacts','max_total_bytes'])||!safeCount(d.budget.max_rows)||Number(d.budget.max_rows)<1||Number(d.budget.max_rows)>1000000||!safeCount(d.budget.max_artifacts)||Number(d.budget.max_artifacts)>1000||!safeCount(d.budget.max_total_bytes)||Number(d.budget.max_total_bytes)<1||Number(d.budget.max_total_bytes)>268435456)throw Error('INVALID_RECOVERY_JOB');
 if(typeof d.barrierId!=='string'||typeof d.integrityKeyId!=='string'||!closed(d.counts,['rows','chunks','bytes'])||![d.counts.rows,d.counts.chunks,d.counts.bytes,d.sqlBytes,d.artifactIndex,d.artifactBytes,d.tableIndex,d.step].every(safeCount)||Number(d.counts.chunks)>256||Number(d.tableIndex)>CURRENT_TABLE_REGISTRY.length||Number(d.counts.rows)>Number(d.budget.max_rows)||Number(d.counts.bytes)>Number(d.budget.max_total_bytes)||d.counts.bytes!==Number(d.sqlBytes)+Number(d.artifactBytes))throw Error('INVALID_RECOVERY_JOB');
 if(d.cursor!==null&&!Array.isArray(d.cursor)||d.sourceMaintenance!==null&&!Array.isArray(d.sourceMaintenance)||d.pending!==null&&(!closed(d.pending,['operationId','fingerprint','kind','endedAt','index'])||typeof d.pending.operationId!=='string'||typeof d.pending.fingerprint!=='string'||!['page','hash','artifact','finalize'].includes(String(d.pending.kind))||typeof d.pending.endedAt!=='string'||!Number.isFinite(Date.parse(d.pending.endedAt))||d.pending.index!==null&&!safeCount(d.pending.index)))throw Error('INVALID_RECOVERY_JOB');
 if(d.receipt!==null&&!validateRecoveryReceipt(d.receipt)||d.diagnostic!==null&&(!closed(d.diagnostic,['code','at','attempts'])||typeof d.diagnostic.code!=='string'||!/^RECOVERY_[A-Z_]+$/.test(d.diagnostic.code)||!safeCount(d.diagnostic.at)||!safeCount(d.diagnostic.attempts)))throw Error('INVALID_RECOVERY_JOB');
 if(row.state==='running'&&(d.receipt!==null||row.manifest_digest!==null||!['capture_drain','capture_pages','hash_chunks','capture_artifacts','capture_finalize'].includes(String(d.phase)))||row.state==='failed'&&d.phase!=='failed')throw Error('INVALID_RECOVERY_JOB');
 if(d.receipt!==null&&(d.receipt.capture_id!==row.capture_id||d.receipt.workspace_id!==row.workspace_id||d.receipt.id!=='receipt_'+row.id.slice(4)))throw Error('INVALID_RECOVERY_JOB');
 if(d.pending!==null){const kind:unknown=({capture_pages:'page',hash_chunks:'hash',capture_artifacts:'artifact',capture_finalize:'finalize'} as Record<string,string>)[String(d.phase)];if(d.pending.kind!==kind||d.pending.index!==(kind==='artifact'?d.artifactIndex:null)||typeof d.pending.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(d.pending.fingerprint))throw Error('INVALID_RECOVERY_JOB');}
 if(d.cursor!==null){const table=CURRENT_TABLE_REGISTRY[Number(d.tableIndex)];if(!table||d.phase!=='capture_pages'||d.cursor.length!==table.primaryKey.length||d.cursor.some((cell,i)=>{const type=table.columns.find(c=>c.name===table.primaryKey[i])!.type;return type==='INTEGER'?!Number.isSafeInteger(cell):typeof cell!=='string';}))throw Error('INVALID_RECOVERY_JOB');}
 if(d.phase==='capture_drain'){
  if(row.state!=='running'||d.checkpoint!==null||d.draft!==null||d.manifest!==null||d.pending!==null||d.pendingArtifact!==null||d.sourceMaintenance!==null||d.counts.rows!==0||d.counts.bytes!==0||d.counts.chunks!==0||d.artifactIndex!==0||d.artifactBytes!==0||d.tableIndex!==0||d.cursor!==null||d.sqlBytes!==0)throw Error('INVALID_RECOVERY_JOB');
 }else{
  const m=d.draft??d.manifest;
  if(!validateRecoveryManifest(m)||m.format_version!==2||m.checkpoint.contract_revision!=='0.2'||m.checkpoint.schema_version!==15&&m.checkpoint.schema_version!==16||m.capture_id!==row.capture_id||m.workspace_id!==row.workspace_id||m.checkpoint.barrier_id!==d.barrierId||m.checkpoint.authority_epoch!==row.authority_epoch||canonicalJson(m.checkpoint)!==canonicalJson(d.checkpoint)||m.artifacts.length>Number(d.budget.max_artifacts)||Number(d.artifactIndex)>m.artifacts.length||!Array.isArray(d.sourceMaintenance))throw Error('INVALID_RECOVERY_JOB');
  const maintenance=CURRENT_TABLE_REGISTRY.find(t=>t.name==='maintenance_state')!;
  try{encodeCurrentChunk({format_version:2,schema_version:m.checkpoint.schema_version,capture_id:row.capture_id,index:0,table:'maintenance_state',columns:maintenance.columns.map(c=>c.name),rows:[d.sourceMaintenance as SqlCell[]]});}catch{throw Error('INVALID_RECOVERY_JOB');}
  const source=Object.fromEntries(maintenance.columns.map((c,i)=>[c.name,(d.sourceMaintenance as SqlCell[])[i]]));
  if(source.id!==1||source.state!=='capturing'||source.barrier_id!==d.barrierId||source.capture_id!==row.capture_id||source.authority_epoch!==row.authority_epoch||source.generation!==d.fence.maintenanceGeneration)throw Error('INVALID_RECOVERY_JOB');
  if(['hash_chunks','capture_artifacts','capture_finalize','complete'].includes(String(d.phase))&&(d.tableIndex!==CURRENT_TABLE_REGISTRY.length||d.cursor!==null)||['capture_pages','hash_chunks'].includes(String(d.phase))&&(d.artifactIndex!==0||d.artifactBytes!==0)||d.phase==='capture_artifacts'&&(Number(d.artifactIndex)>=m.artifacts.length||(d.pending===null)!==(d.pendingArtifact===null))||['capture_finalize','complete'].includes(String(d.phase))&&(d.artifactIndex!==m.artifacts.length||d.pendingArtifact!==null))throw Error('INVALID_RECOVERY_JOB');
  const entries=m.artifacts as CurrentRecoveryArtifactEntry[],ids=new Set<string>(),generations=new Set<string>();
  for(const e of entries){if(ids.has(e.artifact_id)||generations.has(e.generation_id)||e.object_key!==`artifacts/${m.workspace_id}/${e.artifact_id}/${e.generation_id}/${e.sha256}`||e.recovery_object_key!==`r2/${m.workspace_id}/${m.capture_id}/artifacts/${e.artifact_id}/${e.generation_id}/${e.sha256}`)throw Error('INVALID_RECOVERY_JOB');ids.add(e.artifact_id);generations.add(e.generation_id);}
  if(m.unfinished_artifact_ids.some(x=>ids.has(x))||d.artifactBytes!==entries.slice(0,Number(d.artifactIndex)).reduce((n,e)=>n+e.byte_size,0)||m.database.byte_size!==d.sqlBytes||m.database.chunks.length!==d.counts.chunks||m.database.chunks.reduce((n,c)=>n+c.byte_size,0)!==d.sqlBytes||m.database.chunks.reduce((n,c)=>n+c.row_count,0)!==d.counts.rows)throw Error('INVALID_RECOVERY_JOB');
  if(d.pendingArtifact!==null&&(d.phase!=='capture_artifacts'||d.pending===null||canonicalJson(d.pendingArtifact)!==canonicalJson(entries[Number(d.artifactIndex)])||d.pending.index!==d.artifactIndex||d.pending.kind!=='artifact'))throw Error('INVALID_RECOVERY_JOB');
  if(row.state==='complete'){
   try{validateManifestShape(m);}catch{throw Error('INVALID_RECOVERY_JOB');}
   if(!/^[a-f0-9]{64}$/.test(row.manifest_digest??''))throw Error('INVALID_RECOVERY_JOB');
   if(d.phase!=='complete'||d.draft!==null||d.manifest===null||d.pending!==null||d.pendingArtifact!==null||d.artifactIndex!==entries.length||d.receipt===null||d.receipt.status!=='complete')throw Error('INVALID_RECOVERY_JOB');
  }else if(d.manifest!==null||d.draft===null||!['capture_pages','hash_chunks','capture_artifacts','capture_finalize','failed'].includes(String(d.phase))||row.state==='failed'&&d.phase!=='failed')throw Error('INVALID_RECOVERY_JOB');
 }
 const {details_json,...job}=row;return {...job,operation:'capture',details:d as unknown as JobDetailsV2};
}
export function assertCurrentCaptureJob(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,id:string):CurrentCaptureJob{
 assertRecoveryContext(tx,w,ctx);const job=loadCurrentCaptureJob(tx,id);
 if(!job||job.workspace_id!==w.workspaceId||job.capture_id!==ctx.captureId||job.authority_epoch!==ctx.expectedEpoch)throw Error('RECOVERY_JOB_CONFLICT');
 const maintenance=maintenanceRow(tx);if(!maintenance||maintenance.state!==(job.state==='complete'?'captured':'capturing')||maintenance.capture_id!==job.capture_id||maintenance.barrier_id!==job.details.barrierId||tx.one<{admission_state:string}>('SELECT admission_state FROM workspace_metadata WHERE id=1')?.admission_state!=='maintenance')throw Error('RECOVERY_BARRIER_MISMATCH');
 assertRecoveryContext(tx,w,ctx,job.details.fence);if(job.details.integrityKeyId!==w.integrity.keyId)throw Error('RECOVERY_KEY_MISMATCH');
 const inventory=job.details.draft??job.details.manifest,records=currentChunkRecords(tx,job.id);
 if(inventory&&inventory.checkpoint.schema_version!==tx.one<{v:number}>('SELECT MAX(version) AS v FROM schema_migrations')?.v)throw Error('RECOVERY_SCHEMA_MISMATCH');
 if(inventory&&(inventory.environment_id!==w.environmentId||inventory.release.catalog_mapping.object_name!==w.objectName||(inventory.checkpoint.schema_version===15?canonicalJson(inventory.release.catalog_mapping)!==canonicalJson(w.release.catalog_mapping)||canonicalJson(inventory.release.binding_ids)!==canonicalJson(w.release.binding_ids):canonicalJson(inventory.release)!==canonicalJson(w.release))))throw Error('RECOVERY_SOURCE_IDENTITY_MISMATCH');if(records.length!==job.details.counts.chunks||inventory&&canonicalJson(records.map(c=>({index:c.chunk_index,table:c.table_name,sha256:c.sha256,byte_size:c.byte_size,row_count:c.row_count})))!==canonicalJson(inventory.database.chunks))throw Error('RECOVERY_CHUNK_MISMATCH');return job;
}
/** Full admission checks once; every await still compares the exact immutable reserved row.
 * Chunk coverage is revalidated at each counted completion and before signing/publication.
 * A concurrent diagnostic write also aborts conservatively rather than refreshing the baseline.
 */
export function currentCaptureGuard(w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentCaptureJob):()=>void{
 const bucket=w.bucket,artifactBucket=w.artifactBucket;
 const baseline=withTransaction(w.storage,tx=>{const current=assertCurrentCaptureJob(tx,w,ctx,job.id);if(ctx.operation==='capture')assertPending(current,ctx);return tx.one<StoredJob>('SELECT * FROM recovery_jobs WHERE id=?',[job.id])!;});
 const identity=canonicalJson(w.release),fence=job.details.fence,keys=Object.keys(baseline) as (keyof StoredJob)[];
 return ()=>withTransaction(w.storage,tx=>{
  if(w.bucket!==bucket||w.artifactBucket!==artifactBucket||!artifactBucket||artifactBucket===bucket)throw Error('RECOVERY_ARTIFACT_BINDING_UNAVAILABLE');
  assertRecoveryContext(tx,w,ctx,fence);
  if(canonicalJson(w.release)!==identity||w.integrity.keyId!==job.details.integrityKeyId)throw Error('RECOVERY_SOURCE_IDENTITY_MISMATCH');
  const maintenance=maintenanceRow(tx);if(!maintenance||maintenance.state!==(job.state==='complete'?'captured':'capturing')||maintenance.capture_id!==job.capture_id||maintenance.barrier_id!==job.details.barrierId||tx.one<{admission_state:string}>('SELECT admission_state FROM workspace_metadata WHERE id=1')?.admission_state!=='maintenance')throw Error('RECOVERY_BARRIER_MISMATCH');
  const current=tx.one<StoredJob>('SELECT * FROM recovery_jobs WHERE id=?',[job.id]);if(!current||keys.some(k=>current[k]!==baseline[k]))throw Error('RECOVERY_OPERATION_CONFLICT');
 });
}
function assertAnyJob(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,job:AnyRecoveryJob):AnyRecoveryJob{return job.details.version===2?assertCurrentCaptureJob(tx,w,ctx,job.id):assertJob(tx,w,ctx,job.id);}
export function currentChunkRecords(tx:WorkspaceTransaction,id:string):readonly (Omit<ChunkRecord,'table_name'>&{table_name:CurrentTableName})[]{return tx.all('SELECT * FROM recovery_chunks WHERE job_id=? ORDER BY chunk_index',[id]);}
