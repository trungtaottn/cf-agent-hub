import {reserveArtifactCopyEffect} from './restore-artifact-effect';
import {canonicalJson} from '../config/bootstrap';
import {prepareRestoreAuthority,restoreAuthorityAdditions,assertRestoreAddition,type RestoreAuthorityTable} from '../config/restore-authority';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {canonicalBytes,digestBytes,decodeCurrentChunk,hex,type CurrentRecoveryChunk} from './encoding';
import {verifyRecord,verifyCurrentLedger,validateManifestShape} from './manifest';
import {TABLE_REGISTRY,tableDefinition,inspectRegistry} from './table-registry';
import {transitionMaintenance} from './maintenance';
import {priorOperation,type RecoveryWorkspace,type RecoveryContext,type RecoveryManifest,type RecoveryJobProgress,type RecoveryReceipt} from './protocol';
import {validateRecoveryJobProgress,UNRESOLVED_EFFECT_IDS_LIMIT} from './generated/recovery-validators.js';
import {assertCurrentRestoreJob,saveCurrentRestoreJob,restoreGuard,restoreObjectKey,type CurrentRestoreJob} from './restore-job';
import {currentRestoreForContext,reserveRestoreStep,finishRestoreStep} from './restore-current';
import {fixupSourceChunk,verifySourceChunk,transformSourceChunk,sourceRow,insertRow} from './restore-rows';
import {captureArtifactInventory} from './artifacts';
import {copyArtifactFromRecovery} from './restore-artifacts';

export async function readCurrentRestoreChunk(w:RecoveryWorkspace,job:CurrentRestoreJob,index:number,guard:()=>Promise<void>):Promise<Uint8Array<ArrayBuffer>> {
 const entry=job.details.manifest.database.chunks[index];if(!entry)throw Error('RECOVERY_CHUNK_MISMATCH');await guard();const object=await w.bucket.get(restoreObjectKey(job,index,entry.sha256));
 try{await guard();}catch(error){void object?.body.cancel().catch(()=>{});throw error;}if(!object||object.size!==entry.byte_size){void object?.body.cancel().catch(()=>{});throw Error('RECOVERY_CHUNK_MISMATCH');}
 const reader=object.body.getReader(),bytes=new Uint8Array(entry.byte_size);let count=0;
 try{for(;;){const item=await reader.read();await guard();if(item.done)break;if(!item.value.byteLength||count+item.value.byteLength>bytes.length)throw Error('RECOVERY_CHUNK_MISMATCH');bytes.set(item.value,count);count+=item.value.byteLength;}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(count!==entry.byte_size)throw Error('RECOVERY_CHUNK_MISMATCH');const digest=await digestBytes(bytes);await guard();if(digest!==entry.sha256)throw Error('RECOVERY_CHUNK_MISMATCH');return bytes;
}
async function sourceDigest(w:RecoveryWorkspace,job:CurrentRestoreJob,guard:()=>Promise<void>):Promise<string>{
 const stream=new (crypto as Crypto&{DigestStream:typeof DigestStream}).DigestStream('SHA-256'),writer=stream.getWriter(),hash=stream.digest.then(value=>({value}),error=>({error}));
 try{for(const e of job.details.manifest.database.chunks){const bytes=await readCurrentRestoreChunk(w,job,e.index,guard);await guard();await writer.write(bytes);await guard();}await writer.close();await guard();const result=await hash;await guard();if('error'in result)throw result.error;return hex(result.value);}catch(error){await writer.abort().catch(()=>{});throw error;}finally{writer.releaseLock();}
}
function sourceCounts(tx:WorkspaceTransaction,job:CurrentRestoreJob):void {
 const manifest=job.details.manifest,d=job.details;
 if(!d.sourceMetadata||!d.sourceMaintenance||d.counts.rows!==Object.values(manifest.database.table_counts).reduce((a,b)=>a+b,0)||d.counts.chunks!==manifest.database.chunks.length||d.counts.bytes!==manifest.database.byte_size)throw Error('RECOVERY_MANIFEST_COUNTS');
 for(const table of TABLE_REGISTRY){if(table.mode==='evidence')continue;const where=table.name==='idempotency_outcomes'?" WHERE operation NOT LIKE 'operator.%'":'';if(tx.one<{n:number}>('SELECT count(*) AS n FROM "'+table.name+'"'+where)!.n!==d.activeCounts[table.name])throw Error('RECOVERY_RESTORED_COUNT_MISMATCH');}
}
function receipt(tx:WorkspaceTransaction,w:RecoveryWorkspace,job:CurrentRestoreJob):RecoveryReceipt {
 const count=tx.one<{n:number}>("SELECT count(*) AS n FROM outbox WHERE workspace_id=? AND status IN ('pending','in_flight')",[job.workspace_id])!.n;
 const ids=tx.all<{id:string}>("SELECT id FROM outbox WHERE workspace_id=? AND status IN ('pending','in_flight') ORDER BY id LIMIT ?",[job.workspace_id,UNRESOLVED_EFFECT_IDS_LIMIT]).map(x=>x.id);
 return {id:'receipt_'+job.id.slice(4),capture_id:job.capture_id,workspace_id:job.workspace_id,status:'complete',checks:[{name:'restore',passed:true,code:'OK'}],unresolved_effect_ids:ids,unresolved_effect_count:count,unresolved_effect_ids_complete:count===ids.length,started_at:new Date(job.created_at).toISOString(),ended_at:new Date(w.clock.nowMs()).toISOString()};
}
export async function advanceCurrentVerify(w:RecoveryWorkspace,ctx:RecoveryContext,manifestInput:RecoveryManifest):Promise<RecoveryJobProgress>{
 ctx=structuredClone(ctx);validateManifestShape(manifestInput);manifestInput=structuredClone(manifestInput);
 if(ctx.operation!=='verify'||!ctx.captureId)throw Error('INVALID_RECOVERY_CONTEXT');
 let job=withTransaction(w.storage,tx=>currentRestoreForContext(tx,w,ctx));let guard=restoreGuard(w,ctx,job);await guard();
 validateManifestShape(manifestInput);if(canonicalJson(manifestInput)!==canonicalJson(job.details.manifest))throw Error('RECOVERY_MANIFEST_MISMATCH');await verifyRecord(manifestInput,w.integrity,guard);
 const prior=withTransaction(w.storage,tx=>{job=assertCurrentRestoreJob(tx,w,ctx,job.id);const p=priorOperation(tx,ctx);if(p){if(!validateRecoveryJobProgress(p))throw Error('RECOVERY_OPERATION_CONFLICT');return p;}if(job.state==='complete'||job.details.stage==='import')return finishRestoreStep(tx,w,ctx,job);
  reserveRestoreStep(job,ctx,job.details.stage==='artifacts'?'artifact':job.details.stage==='additions'?'overlay':job.details.stage==='hash'?'hash':'verify',job.details.stage==='artifacts'?job.details.artifactIndex:job.details.verifyIndex);saveCurrentRestoreJob(tx,job);return null;});if(prior)return prior;
 guard=restoreGuard(w,ctx,job);await guard();const stage=job.details.stage;
 if(stage==='fixup'||stage==='validate'||stage==='transform'){
  const entry=job.details.manifest.database.chunks[job.details.verifyIndex];let chunk:CurrentRecoveryChunk|null=null;
  if(entry){const bytes=await readCurrentRestoreChunk(w,job,entry.index,guard);chunk=decodeCurrentChunk(bytes,{...entry,capture_id:job.capture_id,schema_version:16});}
  const authority=stage==='transform'?prepareRestoreAuthority((await verifyCurrentLedger(job.details.ledger,ctx.ledgerAnchor,w,job.details.manifest.checkpoint.authority_epoch,guard)).input,job.created_at):null;await guard();
  return withTransaction(w.storage,tx=>{const current=assertCurrentRestoreJob(tx,w,ctx,job.id);
   if(chunk){if(stage==='fixup')fixupSourceChunk(tx,chunk,current);else if(stage==='validate')verifySourceChunk(tx,chunk,current);else transformSourceChunk(tx,chunk,current,authority!);current.details.verifyIndex++;}
   if(current.details.verifyIndex===current.details.manifest.database.chunks.length){current.details.verifyIndex=0;
    if(stage==='fixup')current.details.stage='validate';
    else if(stage==='validate'){
     sourceCounts(tx,current);const inventory=captureArtifactInventory(tx,w,current.capture_id,1000);if(canonicalJson(inventory.artifacts)!==canonicalJson(current.details.manifest.artifacts)||canonicalJson(inventory.unfinished)!==canonicalJson(current.details.manifest.unfinished_artifact_ids))throw Error('RECOVERY_ARTIFACT_IDENTITY_MISMATCH');current.details.stage='hash';current.details.phase='hash_chunks';
    }else{current.details.stage='additions';current.details.phase='overlay_authority';}
   }return finishRestoreStep(tx,w,ctx,current);
  });
 }
 if(stage==='hash'){
  if(await sourceDigest(w,job,guard)!==job.details.manifest.database.sha256)throw Error('RECOVERY_DATABASE_DIGEST_MISMATCH');await guard();
  return withTransaction(w.storage,tx=>{const current=assertCurrentRestoreJob(tx,w,ctx,job.id);sourceCounts(tx,current);current.details.stage='artifacts';current.details.phase='verify_pages';return finishRestoreStep(tx,w,ctx,current);});
 }
 if(stage==='artifacts'){
  const entry=job.details.manifest.artifacts[job.details.artifactIndex],effect=entry?reserveArtifactCopyEffect(w,ctx,job):null;if(entry)await copyArtifactFromRecovery(w,entry,guard,effect!);await guard();
  return withTransaction(w.storage,tx=>{const current=assertCurrentRestoreJob(tx,w,ctx,job.id);if(entry){effect!.assertTerminal(tx);current.details.artifactIndex++;current.details.artifactBytes+=entry.byte_size;}
   if(current.details.artifactIndex===current.details.manifest.artifacts.length){current.details.stage='transform';current.details.phase='overlay_authority';
    // Preserve captured sequence high-water before deterministic new recovery events.
    const high=current.details.manifest.checkpoint.event_sequence;if(!tx.one("SELECT name FROM sqlite_sequence WHERE name='events'"))tx.exec("INSERT INTO sqlite_sequence (name,seq) VALUES ('events',?)",[high]);else tx.exec("UPDATE sqlite_sequence SET seq=? WHERE name='events'",[high]);
   }return finishRestoreStep(tx,w,ctx,current);});
 }
 if(stage!=='additions')throw Error('INVALID_RECOVERY_PHASE');
 const verified=await verifyCurrentLedger(job.details.ledger,ctx.ledgerAnchor,w,job.details.manifest.checkpoint.authority_epoch,guard),authority=prepareRestoreAuthority(verified.input,job.created_at);await guard();
 return withTransaction(w.storage,tx=>{const current=assertCurrentRestoreJob(tx,w,ctx,job.id),names:RestoreAuthorityTable[]=['human_grants','static_agents','native_credentials'];
  if(current.details.additionIndex<names.length){const name=names[current.details.additionIndex],table=tableDefinition(name),page=restoreAuthorityAdditions(authority,name,current.details.additionOffset,200);
   for(const row of page.rows){if(tx.one('SELECT 1 FROM "'+name+'" WHERE '+table.primaryKey.map(k=>'"'+k+'"=?').join(' AND '),table.primaryKey.map(k=>row[k])))continue;assertRestoreAddition(authority,name,row);insertRow(tx,name,row);}
   current.details.additionOffset=page.nextOffset;if(page.done){current.details.additionIndex++;current.details.additionOffset=0;}return finishRestoreStep(tx,w,ctx,current);
  }
  const columns=tableDefinition('workspace_metadata').columns;const source=sourceRow({columns:columns.map(c=>c.name)} as CurrentRecoveryChunk,current.details.sourceMetadata!);
  tx.exec('UPDATE workspace_metadata SET message_retained_after_created_at=?,message_retained_after_id=?,event_retained_after_sequence=? WHERE id=1',[source.message_retained_after_created_at,source.message_retained_after_id,source.event_retained_after_sequence]);inspectRegistry(tx);
  current.details.receipt=receipt(tx,w,current);current.state='complete';current.details.stage='complete';current.details.phase='complete';transitionMaintenance(tx,{state:'restored',epoch:ctx.expectedEpoch,barrierId:'barrier_'+current.id.slice(4),captureId:current.capture_id,nowMs:w.clock.nowMs(),advance:false});return finishRestoreStep(tx,w,ctx,current);
 });
}
