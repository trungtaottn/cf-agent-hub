import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {assertSchemaVersion} from '../storage/schema-version';
import {inspectRegistry} from './table-registry';
import {loadCurrentCaptureJob,currentChunkRecords,type CurrentCaptureJob} from './jobs';
import {maintenanceRow} from './maintenance';
import {loadCurrentRestoreJob} from './restore-job';
import {canonicalJson} from '../config/bootstrap';
/** Compatibility admission is only for a retained capture, never a new capture or an upgrade. */
export function frozenSchema15Capture(tx:WorkspaceTransaction):CurrentCaptureJob|null {
 const version=tx.one<{v:number}>('SELECT MAX(version) AS v FROM schema_migrations')?.v;if(version!==15&&version!==16)return null;assertSchemaVersion(tx,version);
 const m=maintenanceRow(tx),metadata=tx.one<{workspace_id:string;object_name:string;admission_state:string;config_epoch:number}>('SELECT workspace_id,object_name,admission_state,config_epoch FROM workspace_metadata WHERE id=1');
 if(!m||!metadata||metadata.admission_state!=='maintenance'||!['capturing','captured'].includes(m.state)||m.authority_epoch!==metadata.config_epoch||!m.capture_id||!m.barrier_id)return null;
 const rows=tx.all<{id:string}>("SELECT id FROM recovery_jobs WHERE capture_id=? AND operation='capture' LIMIT 2",[m.capture_id]);if(rows.length!==1)return null;
 const job=loadCurrentCaptureJob(tx,rows[0].id);if(!job||job.workspace_id!==metadata.workspace_id||job.authority_epoch!==metadata.config_epoch||job.details.barrierId!==m.barrier_id||job.details.fence.authorityEpoch!==m.authority_epoch||job.details.fence.maintenanceGeneration!==m.generation||m.state!==(job.state==='complete'?'captured':'capturing')||!['running','complete'].includes(job.state))return null;
 if(tx.one("SELECT id FROM recovery_jobs WHERE state='running' AND id<>? LIMIT 1",[job.id]))return null;
 const manifest=job.details.draft??job.details.manifest,records=currentChunkRecords(tx,job.id);
 if(manifest&&(manifest.checkpoint.schema_version!==version||manifest.release.catalog_mapping.workspace_id!==metadata.workspace_id||manifest.release.catalog_mapping.object_name!==metadata.object_name))return null;
 if(records.length!==job.details.counts.chunks||manifest&&canonicalJson(records.map(c=>({index:c.chunk_index,table:c.table_name,sha256:c.sha256,byte_size:c.byte_size,row_count:c.row_count})))!==canonicalJson(manifest.database.chunks))return null;
 return job;
}
/** Constructor keeps a coherent frozen15/16 capture on its original schema. All other paths use normal migration rules. */
export function retainFrozenSchema15(storage:DurableObjectStorage):boolean {
 return withTransaction(storage,tx=>{
  if(!tx.one("SELECT name FROM sqlite_schema WHERE type='table' AND name='schema_migrations'"))return false;
  const version=tx.one<{v:number}>('SELECT MAX(version) AS v FROM schema_migrations')?.v;if(version!==15&&version!==16)return false;
  if(version===16?!retainedSchema16Recovery(tx):!frozenSchema15Capture(tx))return false;inspectRegistry(tx,version);return true;
 });
}

/** Exact physical16 lifecycle retained across binary upgrade; never admits an empty target. */
export function retainedSchema16Recovery(tx:WorkspaceTransaction):boolean {
 assertSchemaVersion(tx,16);
 if(frozenSchema15Capture(tx))return true;
 const m=maintenanceRow(tx),meta=tx.one<{workspace_id:string;config_epoch:number;admission_state:string}>('SELECT workspace_id,config_epoch,admission_state FROM workspace_metadata WHERE id=1');
 if(!m||!meta||m.authority_epoch!==meta.config_epoch||!m.capture_id||!m.barrier_id)return false;
 const rows=tx.all<{id:string;operation:string}>('SELECT id,operation FROM recovery_jobs WHERE capture_id=? LIMIT 2',[m.capture_id]);if(rows.length!==1)return false;
 if(m.state==='retired'&&meta.admission_state==='retired'&&rows[0].operation==='capture'){
  const job=loadCurrentCaptureJob(tx,rows[0].id);
  return !!job&&job.state==='complete'&&job.workspace_id===meta.workspace_id&&job.authority_epoch===m.authority_epoch&&job.details.manifest?.checkpoint.schema_version===16&&job.details.barrierId===m.barrier_id&&job.details.fence.maintenanceGeneration+1===m.generation;
 }
 if(!['restoring','restored'].includes(m.state)||meta.admission_state!=='maintenance'||rows[0].operation!=='restore')return false;
 const job=loadCurrentRestoreJob(tx,rows[0].id);
 if(!job||job.workspace_id!==meta.workspace_id||job.authority_epoch!==m.authority_epoch||job.details.manifest.checkpoint.schema_version!==16||job.details.fence.authorityEpoch!==m.authority_epoch||job.details.fence.maintenanceGeneration!==m.generation||m.barrier_id!=='barrier_'+job.id.slice(4)||m.state!==(job.state==='complete'?'restored':'restoring'))return false;
 const chunks=currentChunkRecords(tx,job.id),prefix=job.details.manifest.database.chunks.slice(0,job.details.counts.chunks);
 return chunks.length===prefix.length&&canonicalJson(chunks.map(c=>({index:c.chunk_index,table:c.table_name,sha256:c.sha256,byte_size:c.byte_size,row_count:c.row_count})))===canonicalJson(prefix);
}
