import {canonicalJson,prepareBootstrap} from '../config/bootstrap';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {canonicalBytes,digestBytes,decodeCurrentChunk,compareKeys,primaryKey,type CurrentRecoveryChunk} from './encoding';
import {validateManifestShape,verifyRecord,verifyCurrentLedger} from './manifest';
import {TABLE_REGISTRY,inspectRegistry,tableDefinition} from './table-registry';
import {transitionMaintenance,maintenanceRow} from './maintenance';
import {assertRecoveryContext,validateRecoveryContext,priorOperation,storeOperation,type RecoveryWorkspace,type RecoveryContext,type RecoveryManifest,type CurrentLedger,type RecoveryJobProgress,type CurrentRecoveryManifest} from './protocol';
import {readTrustedAnchor} from './trusted-anchor';
import {jobIdFor} from './jobs';
import {validateRecoveryJobProgress} from './generated/recovery-validators.js';
import {loadCurrentRestoreJob,assertCurrentRestoreJob,saveCurrentRestoreJob,restoreProgress,restoreGuard,restoreObjectKey,type CurrentRestoreJob} from './restore-job';
import {insertSourceChunk,sourceRow} from './restore-rows';

function emptyTarget(tx:WorkspaceTransaction):void {
 if(tx.one('SELECT id FROM workspace_metadata WHERE id=1'))throw Error('RECOVERY_TARGET_NOT_EMPTY');
 for(const table of TABLE_REGISTRY){if(table.mode==='evidence')continue;const where=table.name==='idempotency_outcomes'?" WHERE operation NOT LIKE 'operator.%'":'';if(tx.one('SELECT 1 AS present FROM "'+table.name+'"'+where+' LIMIT 1'))throw Error('RECOVERY_TARGET_NOT_EMPTY');}
 if(maintenanceRow(tx)?.state==='retired')throw Error('AUTHORITY_RETIRED');
}
export function currentRestoreForContext(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext):CurrentRestoreJob {
 assertRecoveryContext(tx,w,ctx);const rows=tx.all<{id:string}>("SELECT id FROM recovery_jobs WHERE workspace_id=? AND capture_id=? AND operation='restore' LIMIT 2",[w.workspaceId,ctx.captureId]);
 if(rows.length!==1)throw Error('RECOVERY_JOB_CONFLICT');return assertCurrentRestoreJob(tx,w,ctx,rows[0].id);
}
/** The sole epoch mismatch exception is a fresh, exact replay of this restore admission. */
export async function replayCurrentRestoreAdmission(w:RecoveryWorkspace,ctx:RecoveryContext,manifest:RecoveryManifest):Promise<RecoveryJobProgress|null>{
 ctx=structuredClone(ctx);manifest=structuredClone(manifest);validateRecoveryContext(ctx);if(ctx.operation!=='restore'||ctx.expectedEpoch!==0)return null;
 const loaded=withTransaction(w.storage,tx=>{const rows=tx.all<{id:string}>("SELECT id FROM recovery_jobs WHERE workspace_id=? AND capture_id=? AND operation='restore' LIMIT 2",[w.workspaceId,ctx.captureId]);if(!rows.length)return null;if(rows.length!==1)throw Error('RECOVERY_OPERATION_CONFLICT');return loadCurrentRestoreJob(tx,rows[0].id);});if(!loaded)return null;
 const original=loaded.details.original;if(original.principalId!==ctx.principalId||original.operationId!==ctx.operationId||original.fingerprint!==ctx.requestFingerprint||original.expectedEpoch!==ctx.expectedEpoch||canonicalJson(loaded.details.manifest)!==canonicalJson(manifest)||ctx.expectedInstallationDigest!==loaded.details.ledger.installation_digest)throw Error('RECOVERY_OPERATION_CONFLICT');
 const effective={...ctx,expectedEpoch:loaded.authority_epoch};const guard=restoreGuard(w,effective,loaded);await guard();
 return withTransaction(w.storage,tx=>{assertCurrentRestoreJob(tx,w,effective,loaded.id);const result=priorOperation(tx,ctx);if(!result||!validateRecoveryJobProgress(result))throw Error('RECOVERY_OPERATION_CONFLICT');return result;});
}
export async function beginCurrentRestore(w:RecoveryWorkspace,ctx:RecoveryContext,manifestInput:RecoveryManifest,ledgerInput:CurrentLedger):Promise<RecoveryJobProgress>{
 ctx=structuredClone(ctx);
 if(ctx.operation!=='restore'||!ctx.captureId)throw Error('INVALID_RECOVERY_CONTEXT');
 validateManifestShape(manifestInput);if(manifestInput.format_version!==2||manifestInput.checkpoint.contract_revision!=='0.2'||manifestInput.checkpoint.schema_version!==16)throw Error('RECOVERY_FORMAT_UNAVAILABLE');
 manifestInput=structuredClone(manifestInput);if(canonicalBytes(ledgerInput).length>65536)throw Error('RECOVERY_BYTES_LIMIT');ledgerInput=structuredClone(ledgerInput);
 const replay=await replayCurrentRestoreAdmission(w,ctx,manifestInput);if(replay)return replay;
 const fence=withTransaction(w.storage,tx=>{const f=assertRecoveryContext(tx,w,ctx);emptyTarget(tx);inspectRegistry(tx);return f;});
 if(ctx.expectedEpoch!==0||manifestInput.capture_id!==ctx.captureId||manifestInput.workspace_id!==w.workspaceId||manifestInput.environment_id===w.environmentId)throw Error('RECOVERY_MANIFEST_MISMATCH');
 const bucket=w.bucket,artifact=w.artifactBucket,capability=w.trustedAnchor,release=canonicalJson(w.release),key=w.integrity.keyId,secret=w.integrity.key;
 const local=()=>withTransaction(w.storage,tx=>{assertRecoveryContext(tx,w,ctx,fence);emptyTarget(tx);if(w.bucket!==bucket||!artifact||artifact===bucket||w.artifactBucket!==artifact)throw Error('RECOVERY_ARTIFACT_BINDING_UNAVAILABLE');if(w.trustedAnchor!==capability||w.integrity.keyId!==key||w.integrity.key!==secret||canonicalJson(w.release)!==release)throw Error('RECOVERY_SOURCE_IDENTITY_MISMATCH');});
 const anchor=await readTrustedAnchor(w,ctx,undefined,local);const guard=async()=>{await readTrustedAnchor(w,ctx,anchor,local);local();};
 await verifyRecord(manifestInput,w.integrity,guard);const manifest=structuredClone(manifestInput) as CurrentRecoveryManifest;
 const verified=await verifyCurrentLedger(ledgerInput,ctx.ledgerAnchor,w,manifest.checkpoint.authority_epoch,guard);
 const id=await jobIdFor(w.workspaceId,ctx.captureId,'restore');await guard();const manifestDigest=await digestBytes(canonicalBytes(manifest));await guard();
 return withTransaction(w.storage,tx=>{local();inspectRegistry(tx);const now=w.clock.nowMs(),ledger=verified.ledger;
  tx.exec("INSERT INTO workspace_metadata (id,workspace_id,object_name,config_epoch,config_digest,installation_digest,config_json,bundle_json,installed_at,admission_state) VALUES (1,?,?,?,?,?,?,?,?,'maintenance')",[w.workspaceId,w.objectName,ledger.authority_epoch,ledger.verification_bundle.config_digest,ledger.installation_digest,canonicalJson(ledger.config),canonicalJson(ledger.verification_bundle),now]);
  const targetFence=transitionMaintenance(tx,{state:'restoring',epoch:ledger.authority_epoch,barrierId:'barrier_'+id.slice(4),captureId:ctx.captureId!,nowMs:now,advance:true});
  const job:CurrentRestoreJob={id,workspace_id:w.workspaceId,operation:'restore',state:'running',authority_epoch:ledger.authority_epoch,capture_id:ctx.captureId!,manifest_digest:manifestDigest,created_at:now,updated_at:now,details:{version:2,kind:'restore',fence:targetFence,manifest,ledger,ledgerDigest:verified.digest,anchor,releaseIdentity:release,integrityKeyId:key,original:{principalId:ctx.principalId,operationId:ctx.operationId,fingerprint:ctx.requestFingerprint,expectedEpoch:0},sourceMetadata:null,sourceMaintenance:null,counts:{rows:0,chunks:0,bytes:0},activeCounts:Object.fromEntries(TABLE_REGISTRY.map(t=>[t.name,0])) as CurrentRestoreJob['details']['activeCounts'],lastKeys:{},phase:'awaiting_chunks',stage:'import',verifyIndex:0,artifactIndex:0,artifactBytes:0,additionIndex:0,additionOffset:0,step:0,pending:null,receipt:null}};
  saveCurrentRestoreJob(tx,job);const result=restoreProgress(job);storeOperation(tx,ctx,result,now);return result;
 });
}
export function reserveRestoreStep(job:CurrentRestoreJob,ctx:RecoveryContext,kind:'write'|'verify'|'artifact'|'overlay'|'hash',index:number|null):void {
 const p=job.details.pending;if(p){if(p.operationId!==ctx.operationId||p.fingerprint!==ctx.requestFingerprint||p.kind!==kind||p.index!==index)throw Error('RECOVERY_OPERATION_CONFLICT');return;}
 job.details.pending={operationId:ctx.operationId,fingerprint:ctx.requestFingerprint,kind,index,endedAt:new Date(job.updated_at).toISOString()};
}
export function finishRestoreStep(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentRestoreJob):RecoveryJobProgress {
 job.details.pending=null;job.details.step++;job.updated_at=w.clock.nowMs();saveCurrentRestoreJob(tx,job);const result=restoreProgress(job);storeOperation(tx,ctx,result,w.clock.nowMs());return result;
}
export async function writeCurrentRestoreChunk(w:RecoveryWorkspace,ctx:RecoveryContext,metadata:{index:number;sha256:string;byte_size:number},bytes:Uint8Array):Promise<RecoveryJobProgress>{
 ctx=structuredClone(ctx);metadata=structuredClone(metadata);if(bytes.byteLength>1048576)throw Error('RECOVERY_BYTES_LIMIT');bytes=bytes.slice();
 if(ctx.operation!=='write-chunk'||!ctx.captureId)throw Error('INVALID_RECOVERY_CONTEXT');
 let job=withTransaction(w.storage,tx=>currentRestoreForContext(tx,w,ctx));let guard=restoreGuard(w,ctx,job);await guard();
 const entry=job.details.manifest.database.chunks[metadata.index];if(!entry||entry.sha256!==metadata.sha256||entry.byte_size!==metadata.byte_size||bytes.length!==metadata.byte_size)throw Error('RECOVERY_CHUNK_MISMATCH');
 const hash=await digestBytes(bytes);await guard();if(hash!==entry.sha256)throw Error('RECOVERY_CHUNK_MISMATCH');
 const chunk=decodeCurrentChunk(bytes,{...entry,capture_id:ctx.captureId,schema_version:16});
 if(chunk.table==='workspace_metadata'){const source=sourceRow(chunk,chunk.rows[0]);const input=await prepareBootstrap(JSON.parse(String(source.config_json)),JSON.parse(String(source.bundle_json)),w.workspaceId,guard);if(input.installationDigest!==source.installation_digest||input.bundle.config_digest!==source.config_digest||input.config.config_epoch!==job.details.manifest.checkpoint.authority_epoch)throw Error('RECOVERY_SOURCE_AUTHORITY_MISMATCH');}
 const replay=withTransaction(w.storage,tx=>{job=assertCurrentRestoreJob(tx,w,ctx,job.id);const prior=priorOperation(tx,ctx);if(prior){if(!validateRecoveryJobProgress(prior))throw Error('RECOVERY_OPERATION_CONFLICT');return prior;}
  if(metadata.index<job.details.counts.chunks){const result=restoreProgress(job);storeOperation(tx,ctx,result,w.clock.nowMs());return result;}
  if(job.state!=='running'||job.details.stage!=='import'||metadata.index!==job.details.counts.chunks)throw Error('RECOVERY_CHUNK_ORDER_CONFLICT');
  const last=job.details.lastKeys[chunk.table];if(last&&compareKeys(last,primaryKey(tableDefinition(chunk.table),chunk.rows[0]))>=0)throw Error('RECOVERY_PRIMARY_KEY_ORDER');
  reserveRestoreStep(job,ctx,'write',metadata.index);saveCurrentRestoreJob(tx,job);return null;});if(replay)return replay;
 guard=restoreGuard(w,ctx,job);await guard();const key=restoreObjectKey(job,metadata.index,metadata.sha256);await w.bucket.put(key,bytes.slice().buffer,{httpMetadata:{contentType:'application/json'}});await guard();
 return withTransaction(w.storage,tx=>{const current=assertCurrentRestoreJob(tx,w,ctx,job.id);insertSourceChunk(tx,chunk,current);
  tx.exec('INSERT INTO recovery_chunks (job_id,chunk_index,table_name,sha256,byte_size,row_count,object_key) VALUES (?,?,?,?,?,?,?)',[job.id,metadata.index,chunk.table,metadata.sha256,metadata.byte_size,chunk.rows.length,key]);
  current.details.counts={rows:current.details.counts.rows+chunk.rows.length,chunks:metadata.index+1,bytes:current.details.counts.bytes+metadata.byte_size};
  current.details.lastKeys[chunk.table]=primaryKey(tableDefinition(chunk.table),chunk.rows.at(-1)!);
  if(current.details.counts.chunks===current.details.manifest.database.chunks.length){current.details.stage='fixup';current.details.phase='verify_pages';}
  return finishRestoreStep(tx,w,ctx,current);
 });
}
