import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {assertSchemaVersion} from '../storage/schema-version';
import {inspectRegistry} from './table-registry';
import {loadCurrentCaptureJob,currentChunkRecords,type CurrentCaptureJob} from './jobs';
import {maintenanceRow} from './maintenance';
import {canonicalJson} from '../config/bootstrap';
/** Compatibility admission is only for a retained capture, never a new capture or an upgrade. */
export function frozenSchema15Capture(tx:WorkspaceTransaction):CurrentCaptureJob|null {
 assertSchemaVersion(tx,15);
 const m=maintenanceRow(tx),metadata=tx.one<{workspace_id:string;object_name:string;admission_state:string;config_epoch:number}>('SELECT workspace_id,object_name,admission_state,config_epoch FROM workspace_metadata WHERE id=1');
 if(!m||!metadata||metadata.admission_state!=='maintenance'||!['capturing','captured'].includes(m.state)||m.authority_epoch!==metadata.config_epoch||!m.capture_id||!m.barrier_id)return null;
 const rows=tx.all<{id:string}>("SELECT id FROM recovery_jobs WHERE capture_id=? AND operation='capture' LIMIT 2",[m.capture_id]);if(rows.length!==1)return null;
 const job=loadCurrentCaptureJob(tx,rows[0].id);if(!job||job.workspace_id!==metadata.workspace_id||job.authority_epoch!==metadata.config_epoch||job.details.barrierId!==m.barrier_id||job.details.fence.authorityEpoch!==m.authority_epoch||job.details.fence.maintenanceGeneration!==m.generation||m.state!==(job.state==='complete'?'captured':'capturing')||!['running','complete'].includes(job.state))return null;
 if(tx.one("SELECT id FROM recovery_jobs WHERE state='running' AND id<>? LIMIT 1",[job.id]))return null;
 const manifest=job.details.draft??job.details.manifest,records=currentChunkRecords(tx,job.id);
 if(manifest&&(manifest.checkpoint.schema_version!==15||manifest.release.catalog_mapping.workspace_id!==metadata.workspace_id||manifest.release.catalog_mapping.object_name!==metadata.object_name))return null;
 if(records.length!==job.details.counts.chunks||manifest&&canonicalJson(records.map(c=>({index:c.chunk_index,table:c.table_name,sha256:c.sha256,byte_size:c.byte_size,row_count:c.row_count})))!==canonicalJson(manifest.database.chunks))return null;
 return job;
}
/** Constructor keeps a coherent frozen15 ledger on15. All other paths use normal migration rules. */
export function retainFrozenSchema15(storage:DurableObjectStorage):boolean {
 return withTransaction(storage,tx=>{
  if(!tx.one("SELECT name FROM sqlite_schema WHERE type='table' AND name='schema_migrations'"))return false;
  if(tx.one<{v:number}>('SELECT MAX(version) AS v FROM schema_migrations')?.v!==15)return false;
  const job=frozenSchema15Capture(tx);if(!job)return false;inspectRegistry(tx,15);return true;
 });
}
