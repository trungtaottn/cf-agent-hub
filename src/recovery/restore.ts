import {beginCurrentRestore,writeCurrentRestoreChunk} from './restore-current';
import {advanceCurrentVerify} from './restore-verify';
import {withTransaction,type WorkspaceTransaction,type SqlValue} from '../storage/transaction';
import {canonicalJson,prepareBootstrap,restoreAuthorityOverlay} from '../config/bootstrap';
import {TABLE_REGISTRY,tableDefinition,inspectRegistry,type RecoveryTableName} from './table-registry-v1';
import {transitionMaintenance,maintenanceRow} from './maintenance-v1';
import {canonicalBytes,digestBytes,decodeChunk,sqlBinding,sqlCell,primaryKey,compareKeys,type RecoveryChunk,type SqlCell} from './encoding';
import {verifyManifest,verifyCurrentLedger} from './manifest';
import {assertRecoveryContext,priorOperation,storeOperation,type RecoveryContext,type RecoveryWorkspace,type RecoveryJobProgress,type RecoveryManifest,type CurrentLedger} from './protocol';
import {validateRecoveryJobProgress} from './generated/recovery-validators.js';
import {jobIdFor,saveJob,assertJob,reserveStep,assertPending,progress,objectKey,chunkRecords,terminalReceipt,readStoredChunk,databaseDigest,type RecoveryJob,type ChunkRecord} from './jobs';
import {validateIntent,type OutboxRow} from '../outbox/repository';
function emptyTarget(tx:WorkspaceTransaction):void {
 if(tx.one('SELECT id FROM workspace_metadata WHERE id=1'))throw Error('RECOVERY_TARGET_NOT_EMPTY');
 for(const table of TABLE_REGISTRY){if(['schema_migrations','maintenance_state','recovery_jobs','recovery_chunks','probe_receipts','scheduler_state','workspace_metadata'].includes(table.name))continue;
  const where=table.name==='idempotency_outcomes'?" WHERE operation NOT LIKE 'operator.%'":'';if(tx.one('SELECT 1 AS present FROM "'+table.name+'"'+where+' LIMIT 1'))throw Error('RECOVERY_TARGET_NOT_EMPTY');}
 if(maintenanceRow(tx)?.state==='retired')throw Error('AUTHORITY_RETIRED');
}
export async function beginRestore(w:RecoveryWorkspace,ctx:RecoveryContext,manifestInput:RecoveryManifest,ledgerInput:CurrentLedger):Promise<RecoveryJobProgress>{
 if(manifestInput.format_version===2)return beginCurrentRestore(w,ctx,manifestInput,ledgerInput);
 if(ctx.operation!=='restore'||!ctx.captureId)throw Error('INVALID_RECOVERY_CONTEXT');
 const fence=withTransaction(w.storage,tx=>{const f=assertRecoveryContext(tx,w,ctx);emptyTarget(tx);inspectRegistry(tx);return f;});
 const manifest=await verifyManifest(manifestInput,w.integrity),verified=await verifyCurrentLedger(ledgerInput,ctx.ledgerAnchor,w,manifest.checkpoint.authority_epoch);
 if(manifest.capture_id!==ctx.captureId||manifest.workspace_id!==w.workspaceId||manifest.environment_id===w.environmentId)throw Error('RECOVERY_MANIFEST_MISMATCH');
 const id=await jobIdFor(w.workspaceId,ctx.captureId,'restore'),manifestDigest=await digestBytes(canonicalBytes(manifest));
 return withTransaction(w.storage,tx=>{assertRecoveryContext(tx,w,ctx,fence);emptyTarget(tx);inspectRegistry(tx);const now=w.clock.nowMs(),ledger=verified.ledger;
  tx.exec("INSERT INTO workspace_metadata (id,workspace_id,object_name,config_epoch,config_digest,installation_digest,config_json,bundle_json,installed_at,admission_state) VALUES (1,?,?,?,?,?,?,?,?,'maintenance')",[w.workspaceId,w.objectName,ledger.authority_epoch,ledger.verification_bundle.config_digest,ledger.installation_digest,canonicalJson(ledger.config),canonicalJson(ledger.verification_bundle),now]);
  const targetFence=transitionMaintenance(tx,{state:'restoring',epoch:ledger.authority_epoch,barrierId:'barrier_'+id.slice(4),captureId:ctx.captureId!,nowMs:now,advance:true});
  const job:RecoveryJob={id,workspace_id:w.workspaceId,operation:'restore',state:'running',authority_epoch:ledger.authority_epoch,capture_id:ctx.captureId!,manifest_digest:manifestDigest,created_at:now,updated_at:now,details:{version:1,fence:targetFence,budget:null,checkpoint:manifest.checkpoint,sourceMaintenance:null,sourceMetadata:null,tableCounts:manifest.database.table_counts,activeCounts:Object.fromEntries(TABLE_REGISTRY.map(t=>[t.name,0])) as Record<RecoveryTableName,number>,tableIndex:0,cursor:null,lastKeys:{},verifyIndex:0,counts:{rows:0,chunks:0,bytes:0},phase:manifest.database.chunks.length?'awaiting_chunks':'verify_pages',step:0,pending:null,receipt:null,manifest,ledger,ledgerDigest:verified.digest,integrityKeyId:w.integrity.keyId}};
  saveJob(tx,job);const result=progress(job);storeOperation(tx,ctx,result,now);return result;});
}
function transformed(table:string,row:Record<string,SqlValue>,job:RecoveryJob):Record<string,SqlValue>{
 const result={...row};if(table==='sessions')result.revoked_at=row.revoked_at??job.created_at;
 if(table==='login_attempts'){result.consumed_at=row.consumed_at??job.created_at;result.nonce='';result.pkce_verifier='';}return result;
}
function rowObject(chunk:RecoveryChunk,row:SqlCell[]):Record<string,SqlValue>{return Object.fromEntries(chunk.columns.map((column,i)=>[column,sqlBinding(row[i])])) as Record<string,SqlValue>;}
function validateSourceRow(table:string,row:Record<string,SqlValue>,job:RecoveryJob):void {
 if(Object.hasOwn(row,'workspace_id')&&row.workspace_id!==job.workspace_id)throw Error('RECOVERY_WORKSPACE_ROW_MISMATCH');
 if(table==='schema_migrations'&&(!Number.isInteger(row.version)||Number(row.version)<1||Number(row.version)>7))throw Error('RECOVERY_SCHEMA_MISMATCH');
 if(table==='maintenance_state'&&(row.id!==1||row.state!=='capturing'||row.authority_epoch!==job.details.checkpoint.authority_epoch||row.barrier_id!==job.details.checkpoint.barrier_id||row.capture_id!==job.capture_id))throw Error('RECOVERY_CHECKPOINT_MISMATCH');
 if(table==='workspace_metadata'&&(row.id!==1||row.config_epoch!==job.details.checkpoint.authority_epoch||row.object_name!==job.details.manifest!.release.catalog_mapping.object_name||row.admission_state!=='maintenance'))throw Error('RECOVERY_SOURCE_AUTHORITY_MISMATCH');
}
function historyIndex(tx:WorkspaceTransaction,job:RecoveryJob,id:SqlValue,nowMs:number):void {
 if(typeof id!=='string'||!id)throw Error('INVALID_RECOVERY_HISTORY');
 tx.exec("INSERT INTO idempotency_outcomes (principal_id,operation,target,key,workspace_id,fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at) VALUES ('system_recovery','operator.recovery.history',?,?,?, ?,200,?,'recovery_history',NULL,?,?)",[job.id,id,job.workspace_id,job.manifest_digest!,canonicalJson({kind:'source_recovery_job',id}),nowMs,Number.MAX_SAFE_INTEGER]);
}
function insertChunkRows(tx:WorkspaceTransaction,chunk:RecoveryChunk,job:RecoveryJob,nowMs:number):void {
 const table=tableDefinition(chunk.table);
 const prior=job.details.lastKeys[chunk.table];if(prior&&compareKeys(prior,primaryKey(table,chunk.rows[0]))>=0)throw Error('RECOVERY_PRIMARY_KEY_ORDER');
 for(const cells of chunk.rows){const raw=rowObject(chunk,cells);validateSourceRow(chunk.table,raw,job);
  if(chunk.table==='workspace_metadata')job.details.sourceMetadata=cells;
  if(chunk.table==='maintenance_state')job.details.sourceMaintenance=cells;
  if(chunk.table==='recovery_jobs')historyIndex(tx,job,raw.id,nowMs);
  if(table.mode==='evidence'||chunk.table==='idempotency_outcomes'&&typeof raw.operation==='string'&&raw.operation.startsWith('operator.'))continue;
  const row=transformed(chunk.table,raw,job);job.details.activeCounts[chunk.table]++;tx.exec('INSERT INTO "'+table.name+'" ('+table.columns.map(c=>'"'+c.name+'"').join(',')+') VALUES ('+table.columns.map(()=>'?').join(',')+')',table.columns.map(c=>row[c.name]));
 }
 job.details.lastKeys[chunk.table]=primaryKey(table,chunk.rows.at(-1)!);
}
export async function writeRestoreChunk(w:RecoveryWorkspace,ctx:RecoveryContext,metadata:{index:number;sha256:string;byte_size:number},bytes:Uint8Array):Promise<RecoveryJobProgress>{
 if(withTransaction(w.storage,tx=>tx.one<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations')?.version??0)>=16)return writeCurrentRestoreChunk(w,ctx,metadata,bytes);
 if(ctx.operation!=='write-chunk'||!ctx.captureId)throw Error('INVALID_RECOVERY_CONTEXT');withTransaction(w.storage,tx=>assertRecoveryContext(tx,w,ctx));const id=await jobIdFor(w.workspaceId,ctx.captureId,'restore');
 let job=withTransaction(w.storage,tx=>assertJob(tx,w,ctx,id));const entry=job.details.manifest!.database.chunks[metadata.index];
 if(!entry||entry.sha256!==metadata.sha256||entry.byte_size!==metadata.byte_size||bytes.length!==metadata.byte_size||await digestBytes(bytes)!==metadata.sha256)throw Error('RECOVERY_CHUNK_MISMATCH');
 const chunk=decodeChunk(bytes,{...entry,capture_id:ctx.captureId});
 if(chunk.table==='workspace_metadata'){const source=rowObject(chunk,chunk.rows[0]);const input=await prepareBootstrap(JSON.parse(String(source.config_json)),JSON.parse(String(source.bundle_json)),w.workspaceId);if(input.installationDigest!==source.installation_digest||input.config.config_epoch!==job.details.checkpoint.authority_epoch)throw Error('RECOVERY_SOURCE_AUTHORITY_MISMATCH');}
 const existing=withTransaction(w.storage,tx=>{job=assertJob(tx,w,ctx,id);const prior=priorOperation(tx,ctx);if(prior){if(!validateRecoveryJobProgress(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return prior;}
  const previous=tx.one<ChunkRecord>('SELECT * FROM recovery_chunks WHERE job_id=? AND chunk_index=?',[id,metadata.index]);if(previous){if(previous.sha256!==metadata.sha256||previous.byte_size!==metadata.byte_size)throw Error('RECOVERY_CHUNK_CONFLICT');const result=progress(job);storeOperation(tx,ctx,result,w.clock.nowMs());return result;}
  if(job.state!=='running'||job.details.phase!=='awaiting_chunks'||metadata.index!==job.details.counts.chunks)throw Error('RECOVERY_CHUNK_ORDER_CONFLICT');reserveStep(job,ctx,'write',w.clock.nowMs(),metadata.index);saveJob(tx,job);return null;});if(existing)return existing;
 const key=objectKey(job,metadata.index,metadata.sha256);await w.bucket.put(key,bytes.slice().buffer,{httpMetadata:{contentType:'application/json'}});
 return withTransaction(w.storage,tx=>{const current=assertJob(tx,w,ctx,id);const prior=priorOperation(tx,ctx);if(prior){if(!validateRecoveryJobProgress(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return prior;}assertPending(current,ctx);insertChunkRows(tx,chunk,current,w.clock.nowMs());
  tx.exec('INSERT INTO recovery_chunks (job_id,chunk_index,table_name,sha256,byte_size,row_count,object_key) VALUES (?,?,?,?,?,?,?)',[id,metadata.index,chunk.table,metadata.sha256,metadata.byte_size,chunk.rows.length,key]);
  current.details.counts={rows:current.details.counts.rows+chunk.rows.length,chunks:metadata.index+1,bytes:current.details.counts.bytes+metadata.byte_size};current.details.phase=current.details.counts.chunks===current.details.manifest!.database.chunks.length?'verify_pages':'awaiting_chunks';current.details.pending=null;current.details.step++;current.updated_at=w.clock.nowMs();saveJob(tx,current);const result=progress(current);storeOperation(tx,ctx,result,w.clock.nowMs());return result;});
}
function verifyRow(tx:WorkspaceTransaction,chunk:RecoveryChunk,cells:SqlCell[],job:RecoveryJob):void {
 const table=tableDefinition(chunk.table),raw=rowObject(chunk,cells);validateSourceRow(table.name,raw,job);
 if(table.name==='recovery_chunks'&&!tx.one("SELECT key FROM idempotency_outcomes WHERE principal_id='system_recovery' AND operation='operator.recovery.history' AND target=? AND key=?",[job.id,raw.job_id]))throw Error('RECOVERY_RELATIONSHIP_MISMATCH');
 if(table.mode==='evidence'||table.name==='idempotency_outcomes'&&typeof raw.operation==='string'&&raw.operation.startsWith('operator.'))return;
 const expected=transformed(table.name,raw,job),actual=tx.one<Record<string,SqlValue>>('SELECT '+table.columns.map(c=>'"'+c.name+'"').join(',')+' FROM "'+table.name+'" WHERE '+table.primaryKey.map(c=>'"'+c+'"=?').join(' AND '),table.primaryKey.map(c=>raw[c]));
 if(!actual||canonicalJson(table.columns.map(c=>sqlCell(actual[c.name])))!==canonicalJson(table.columns.map(c=>sqlCell(expected[c.name]))))throw Error('RECOVERY_RESTORED_ROW_MISMATCH');
 for(const foreign of table.foreignKeys){const referenced=String(foreign[2]),from=String(foreign[3]),to=String(foreign[4]);if(!tx.one('SELECT 1 AS present FROM "'+referenced+'" WHERE "'+to+'"=?',[raw[from]]))throw Error('RECOVERY_RELATIONSHIP_MISMATCH');}
 if(table.name==='thread_participants'){const kind=raw.participant_kind,id=raw.participant_id;if(!tx.one(kind==='human'?'SELECT principal_id FROM human_grants WHERE principal_id=?':'SELECT agent_id FROM static_agents WHERE agent_id=?',[id]))throw Error('RECOVERY_RELATIONSHIP_MISMATCH');}
 if(table.name==='inbox'&&!tx.one('SELECT agent_id FROM static_agents WHERE agent_id=?',[raw.recipient_agent_id]))throw Error('RECOVERY_RELATIONSHIP_MISMATCH');
 if(table.name==='messages'){
  if(!tx.one(raw.sender_kind==='human'?'SELECT principal_id FROM human_grants WHERE principal_id=?':'SELECT agent_id FROM static_agents WHERE agent_id=?',[raw.sender_kind==='human'?raw.sender_principal_id:raw.sender_agent_id]))throw Error('RECOVERY_RELATIONSHIP_MISMATCH');
  const refs:unknown=JSON.parse(String(raw.refs_json));if(!Array.isArray(refs)||refs.length>100)throw Error('RECOVERY_RELATIONSHIP_MISMATCH');for(const ref of refs){if(!ref||ref.kind!=='message'||typeof ref.id!=='string'||!tx.one('SELECT id FROM messages WHERE id=? AND workspace_id=?',[ref.id,job.workspace_id]))throw Error('RECOVERY_RELATIONSHIP_MISMATCH');}
 }
 if(table.name==='outbox'&&raw.destination_snapshot_json!==null&&!validateIntent(tx,actual as unknown as OutboxRow))throw Error('RECOVERY_RELATIONSHIP_MISMATCH');
}
export async function advanceVerify(w:RecoveryWorkspace,ctx:RecoveryContext,manifestInput:RecoveryManifest):Promise<RecoveryJobProgress>{
 if(manifestInput.format_version===2)return advanceCurrentVerify(w,ctx,manifestInput);
 if(ctx.operation!=='verify'||!ctx.captureId)throw Error('INVALID_RECOVERY_CONTEXT');withTransaction(w.storage,tx=>assertRecoveryContext(tx,w,ctx));const id=await jobIdFor(w.workspaceId,ctx.captureId,'restore'),manifest=await verifyManifest(manifestInput,w.integrity),digest=await digestBytes(canonicalBytes(manifest));
 const admitted=withTransaction(w.storage,tx=>{let job=assertJob(tx,w,ctx,id);if(job.manifest_digest!==digest)throw Error('RECOVERY_MANIFEST_MISMATCH');const prior=priorOperation(tx,ctx);if(prior){if(!validateRecoveryJobProgress(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return {job,prior};}
  if(job.state!=='running'||job.details.phase==='awaiting_chunks'){const result=progress(job);storeOperation(tx,ctx,result,w.clock.nowMs());return {job,prior:result};}
  reserveStep(job,ctx,job.details.phase==='hash_chunks'?'hash':job.details.phase==='overlay_authority'?'overlay':'verify',w.clock.nowMs(),job.details.phase==='verify_pages'?job.details.verifyIndex:null);saveJob(tx,job);return {job,prior:null};});if(admitted.prior)return admitted.prior;const job=admitted.job;
 if(job.details.phase==='verify_pages'){
  const record=withTransaction(w.storage,tx=>{assertJob(tx,w,ctx,id);return chunkRecords(tx,id)[job.details.verifyIndex];});
  if(record){const bytes=await readStoredChunk(w,ctx,job,record),chunk=decodeChunk(bytes,{capture_id:job.capture_id,index:record.chunk_index,table:record.table_name,row_count:record.row_count,byte_size:record.byte_size});return withTransaction(w.storage,tx=>{const current=assertJob(tx,w,ctx,id);assertPending(current,ctx);for(const row of chunk.rows)verifyRow(tx,chunk,row,current);current.details.verifyIndex++;if(current.details.verifyIndex===manifest.database.chunks.length)current.details.phase='hash_chunks';return completeStep(tx,w,ctx,current);});}
  return withTransaction(w.storage,tx=>{const current=assertJob(tx,w,ctx,id);assertPending(current,ctx);current.details.phase='hash_chunks';return completeStep(tx,w,ctx,current);});
 }
 if(job.details.phase==='hash_chunks'){
  const hash=await databaseDigest(w,ctx,job);if(hash!==manifest.database.sha256)throw Error('RECOVERY_DATABASE_DIGEST_MISMATCH');
  return withTransaction(w.storage,tx=>{const current=assertJob(tx,w,ctx,id);assertPending(current,ctx);const rows=Object.values(current.details.tableCounts).reduce((a,b)=>a+b,0);if(current.details.counts.rows!==rows||current.details.counts.bytes!==manifest.database.byte_size||current.details.counts.chunks!==manifest.database.chunks.length)throw Error('RECOVERY_MANIFEST_COUNTS');current.details.phase='overlay_authority';return completeStep(tx,w,ctx,current);});
 }
 if(job.details.phase!=='overlay_authority')throw Error('INVALID_RECOVERY_PHASE');
 const ledger=await verifyCurrentLedger(job.details.ledger,ctx.ledgerAnchor,w,manifest.checkpoint.authority_epoch);
 return withTransaction(w.storage,tx=>{const current=assertJob(tx,w,ctx,id);assertPending(current,ctx);if(!current.details.sourceMetadata||!current.details.sourceMaintenance)throw Error('RECOVERY_CHECKPOINT_MISMATCH');
  for(const table of TABLE_REGISTRY){if(table.mode==='evidence')continue;const where=table.name==='idempotency_outcomes'?" WHERE operation NOT LIKE 'operator.%'":'';if(tx.one<{n:number}>('SELECT count(*) AS n FROM "'+table.name+'"'+where)!.n!==current.details.activeCounts[table.name])throw Error('RECOVERY_RESTORED_COUNT_MISMATCH');}
  restoreAuthorityOverlay(tx,ledger.input,w.clock.nowMs());const columns=tableDefinition('workspace_metadata').columns,source=Object.fromEntries(columns.map((c,i)=>[c.name,sqlBinding(current.details.sourceMetadata![i])]));
  tx.exec('UPDATE workspace_metadata SET message_retained_after_created_at=?,message_retained_after_id=?,event_retained_after_sequence=? WHERE id=1',[source.message_retained_after_created_at,source.message_retained_after_id,source.event_retained_after_sequence]);
  if(!tx.one("SELECT name FROM sqlite_sequence WHERE name='events'"))tx.exec("INSERT INTO sqlite_sequence (name,seq) VALUES ('events',?)",[manifest.checkpoint.event_sequence]);else tx.exec("UPDATE sqlite_sequence SET seq=? WHERE name='events'",[manifest.checkpoint.event_sequence]);inspectRegistry(tx);
  current.details.receipt=terminalReceipt(tx,w,current,true,'OK');current.state='complete';current.details.phase='complete';transitionMaintenance(tx,{state:'restored',epoch:ctx.expectedEpoch,barrierId:maintenanceRow(tx)!.barrier_id!,captureId:current.capture_id,nowMs:w.clock.nowMs(),advance:false});return completeStep(tx,w,ctx,current);});
}
function completeStep(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,job:RecoveryJob):RecoveryJobProgress {
 job.details.pending=null;job.details.step++;job.updated_at=w.clock.nowMs();saveJob(tx,job);const result=progress(job);storeOperation(tx,ctx,result,w.clock.nowMs());return result;
}
