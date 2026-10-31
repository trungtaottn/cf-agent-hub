import {stageSourceAuditEvidence,validateAndImportSourceAudit} from './restore-audit-history';
import {appendRestoreExpiryAudit} from './restore-audit';
import {canonicalJson,nextAuthorityVersion} from '../config/bootstrap';
import {transformRestoredAuthorityRow,type RestoreAuthorityPlan,type RestoreAuthorityTable} from '../config/restore-authority';
import type {WorkspaceTransaction,SqlValue} from '../storage/transaction';
import {sqlBinding,sqlCell,type SqlCell,type CurrentRecoveryChunk} from './encoding';
import {tableDefinition,type RecoveryTableName} from './table-registry';
import type {CurrentRestoreJob} from './restore-job';
import {validateIntent,type OutboxRow} from '../outbox/repository';
export type SourceRow=Record<string,SqlValue>;
export function sourceRow(chunk:CurrentRecoveryChunk,cells:SqlCell[]):SourceRow{return Object.fromEntries(chunk.columns.map((c,i)=>[c,sqlBinding(cells[i])])) as SourceRow;}
const evidence=(table:string,row:SourceRow)=>tableDefinition(table).mode==='evidence'||table==='idempotency_outcomes'&&String(row.operation).startsWith('operator.');
function validateSource(table:string,row:SourceRow,job:CurrentRestoreJob):void {
 const cp=job.details.manifest.checkpoint;
 if(Object.hasOwn(row,'workspace_id')&&row.workspace_id!==job.workspace_id)throw Error('RECOVERY_WORKSPACE_ROW_MISMATCH');
 if(table==='schema_migrations'&&(!Number.isSafeInteger(row.version)||Number(row.version)<1||Number(row.version)>16))throw Error('RECOVERY_SCHEMA_MISMATCH');
 if(table==='workspace_metadata'&&(row.id!==1||row.object_name!==job.details.manifest.release.catalog_mapping.object_name||row.config_epoch!==cp.authority_epoch||row.admission_state!=='maintenance'))throw Error('RECOVERY_CHECKPOINT_MISMATCH');
 if(table==='maintenance_state'&&(row.id!==1||row.state!=='capturing'||row.authority_epoch!==cp.authority_epoch||row.barrier_id!==cp.barrier_id||row.capture_id!==job.capture_id))throw Error('RECOVERY_CHECKPOINT_MISMATCH');
 if(table==='events'&&(Number(row.sequence)>cp.event_sequence||Number(row.sequence)<1))throw Error('RECOVERY_EVENT_SEQUENCE');
 if(table==='artifact_generations'&&['in_flight','uncertain'].includes(String(row.effect_state)))throw Error('RECOVERY_ARTIFACT_EFFECT_UNRESOLVED');
}
/** Only cyclic FK pointers are staged. No lossy invalidation precedes source validation. */
function staged(table:string,raw:SourceRow):SourceRow {
 const row={...raw};if(table==='tasks'){if(row.state==='doing')row.state='backlog';row.active_run_id=null;row.latest_run_id=null;row.current_result_id=null;}
 if(table==='artifacts'){row.status='expired';row.active_generation_id=null;row.committed_generation_id=null;row.committed_at=null;}return row;
}
export function insertRow(tx:WorkspaceTransaction,tableName:string,row:SourceRow):void {const table=tableDefinition(tableName);tx.exec('INSERT INTO "'+table.name+'" ('+table.columns.map(c=>'"'+c.name+'"').join(',')+') VALUES ('+table.columns.map(()=>'?').join(',')+')',table.columns.map(c=>row[c.name]));}
export function updateRow(tx:WorkspaceTransaction,tableName:string,row:SourceRow):void {const table=tableDefinition(tableName),cols=table.columns.filter(c=>!table.primaryKey.includes(c.name));if(!cols.length)return;tx.exec('UPDATE "'+table.name+'" SET '+cols.map(c=>'"'+c.name+'"=?').join(',')+' WHERE '+table.primaryKey.map(c=>'"'+c+'"=?').join(' AND '),[...cols.map(c=>row[c.name]),...table.primaryKey.map(c=>row[c])]);}
function actualRow(tx:WorkspaceTransaction,tableName:string,row:SourceRow):SourceRow|null {const table=tableDefinition(tableName);return tx.one<SourceRow>('SELECT * FROM "'+table.name+'" WHERE '+table.primaryKey.map(c=>'"'+c+'"=?').join(' AND '),table.primaryKey.map(c=>row[c]));}
export function insertSourceChunk(tx:WorkspaceTransaction,chunk:CurrentRecoveryChunk,job:CurrentRestoreJob):void {
 for(const cells of chunk.rows){const raw=sourceRow(chunk,cells);validateSource(chunk.table,raw,job);
  if(chunk.table==='workspace_metadata')job.details.sourceMetadata=cells;if(chunk.table==='maintenance_state')job.details.sourceMaintenance=cells;
  stageSourceAuditEvidence(tx,chunk.table,raw,job);
  if(evidence(chunk.table,raw))continue;insertRow(tx,chunk.table,staged(chunk.table,raw));job.details.activeCounts[chunk.table]++;
 }
}
export function fixupSourceChunk(tx:WorkspaceTransaction,chunk:CurrentRecoveryChunk,job:CurrentRestoreJob):void {
 for(const cells of chunk.rows){const raw=sourceRow(chunk,cells);validateSource(chunk.table,raw,job);if(!['tasks','artifacts'].includes(chunk.table))continue;
  const actual=actualRow(tx,chunk.table,raw),expected=staged(chunk.table,raw);if(!actual||canonicalJson(actual)!==canonicalJson(expected))throw Error('RECOVERY_RESTORED_ROW_MISMATCH');updateRow(tx,chunk.table,raw);
 }
}
function exists(tx:WorkspaceTransaction,sql:string,bindings:SqlValue[]):void{if(!tx.one(sql,bindings))throw Error('RECOVERY_RELATIONSHIP_MISMATCH');}
function identity(tx:WorkspaceTransaction,kind:SqlValue,principal:SqlValue,agent:SqlValue,workspace:string):void {
 if(kind==='human')exists(tx,'SELECT 1 FROM human_grants WHERE workspace_id=? AND principal_id=?',[workspace,principal]);
 else if(kind==='agent'){if(principal!==agent)throw Error('RECOVERY_RELATIONSHIP_MISMATCH');exists(tx,'SELECT 1 FROM static_agents WHERE workspace_id=? AND agent_id=?',[workspace,agent]);}
 else if(kind!=='system')throw Error('RECOVERY_RELATIONSHIP_MISMATCH');
}
export function verifySourceChunk(tx:WorkspaceTransaction,chunk:CurrentRecoveryChunk,job:CurrentRestoreJob):void {
 const table=tableDefinition(chunk.table);
 for(const cells of chunk.rows){const raw=sourceRow(chunk,cells);validateSource(chunk.table,raw,job);
  if(chunk.table==='recovery_chunks')exists(tx,"SELECT 1 FROM idempotency_outcomes WHERE principal_id='system_recovery' AND operation='operator.recovery.history' AND target=? AND key=?",[job.id,raw.job_id]);
  validateAndImportSourceAudit(tx,chunk.table,raw,job);
  if(evidence(chunk.table,raw))continue;
  const actual=actualRow(tx,chunk.table,raw);if(!actual||canonicalJson(table.columns.map(c=>sqlCell(actual[c.name])))!==canonicalJson(cells))throw Error('RECOVERY_RESTORED_ROW_MISMATCH');
  // Composite references must be checked as a single tuple, never independent columns.
  const groups=new Map<number,(readonly(string|number)[])[]>();for(const fk of table.foreignKeys){const id=Number(fk[0]);groups.set(id,[...(groups.get(id)??[]),fk]);}
  for(const parts of groups.values()){if(parts.some(p=>raw[String(p[3])]===null))continue;exists(tx,'SELECT 1 FROM "'+parts[0][2]+'" WHERE '+parts.map(p=>'"'+p[4]+'"=?').join(' AND '),parts.map(p=>raw[String(p[3])]));}
  if(chunk.table==='thread_participants')identity(tx,raw.participant_kind,raw.participant_id,raw.participant_id,job.workspace_id);
  if(chunk.table==='inbox')exists(tx,'SELECT 1 FROM static_agents WHERE workspace_id=? AND agent_id=?',[job.workspace_id,raw.recipient_agent_id]);
  if(chunk.table==='messages'){
   identity(tx,raw.sender_kind,raw.sender_principal_id,raw.sender_agent_id,job.workspace_id);const refs:unknown=JSON.parse(String(raw.refs_json));if(!Array.isArray(refs)||refs.length>100)throw Error('RECOVERY_RELATIONSHIP_MISMATCH');
   for(const ref of refs){if(!ref||typeof ref!=='object'||!['message','task','artifact'].includes(ref.kind)||typeof ref.id!=='string')throw Error('RECOVERY_RELATIONSHIP_MISMATCH');const name={message:'messages',task:'tasks',artifact:'artifacts'}[ref.kind as 'message'|'task'|'artifact'];exists(tx,`SELECT 1 FROM ${name} WHERE workspace_id=? AND id=?`,[job.workspace_id,ref.id]);}
  }
  if(chunk.table==='tasks'){
   const flags:unknown=JSON.parse(String(raw.flags_json));if(!Array.isArray(flags)||flags.some(f=>typeof f!=='string'))throw Error('RECOVERY_RELATIONSHIP_MISMATCH');
   if(raw.active_run_id!==null){const run=tx.one<SourceRow>('SELECT * FROM runs WHERE workspace_id=? AND task_id=? AND id=?',[job.workspace_id,raw.id,raw.active_run_id]);if(!run||run.status!=='active'||raw.latest_run_id!==run.id||raw.assigned_agent_id!==null&&raw.assigned_agent_id!==run.agent_id||Number(raw.next_fence)<=Number(run.fence))throw Error('RECOVERY_RELATIONSHIP_MISMATCH');}
   if(['review','done'].includes(String(raw.state))&&raw.current_result_id===null)throw Error('RECOVERY_RELATIONSHIP_MISMATCH');
   if(raw.state==='done')exists(tx,'SELECT 1 FROM task_acceptances WHERE workspace_id=? AND task_id=? AND result_id=? AND run_id=?',[job.workspace_id,raw.id,raw.current_result_id,raw.latest_run_id]);
   if(raw.current_result_id!==null){const result=tx.one<SourceRow>('SELECT * FROM task_results WHERE workspace_id=? AND task_id=? AND id=?',[job.workspace_id,raw.id,raw.current_result_id]);if(!result||result.run_id!==raw.latest_run_id||!['review','done'].includes(String(raw.state))||Number(raw.next_result_sequence)<=Number(result.submission_sequence))throw Error('RECOVERY_RELATIONSHIP_MISMATCH');}
  }
  if(chunk.table==='runs'&&raw.status==='active')exists(tx,"SELECT 1 FROM tasks WHERE workspace_id=? AND id=? AND state='doing' AND active_run_id=? AND latest_run_id=? AND next_fence>?",[job.workspace_id,raw.task_id,raw.id,raw.id,raw.fence]);
  if(chunk.table==='task_results'){
   identity(tx,raw.submitted_kind,raw.submitted_principal_id,raw.submitted_agent_id,job.workspace_id);exists(tx,"SELECT 1 FROM runs WHERE workspace_id=? AND task_id=? AND id=? AND status='submitted' AND ended_at IS NOT NULL AND agent_id=?",[job.workspace_id,raw.task_id,raw.run_id,raw.submitted_agent_id]);
  }
  if(chunk.table==='task_acceptances'){
   const result=tx.one<SourceRow>('SELECT * FROM task_results WHERE workspace_id=? AND task_id=? AND run_id=? AND id=?',[job.workspace_id,raw.task_id,raw.run_id,raw.result_id]);if(!result||raw.reviewer_principal_id===result.submitted_principal_id||raw.reviewer_agent_id!==null&&raw.reviewer_agent_id===result.submitted_agent_id)throw Error('RECOVERY_RELATIONSHIP_MISMATCH');identity(tx,raw.reviewer_agent_id===null?'human':'agent',raw.reviewer_principal_id,raw.reviewer_agent_id,job.workspace_id);
  }
  if(chunk.table==='task_history')exists(tx,"SELECT 1 FROM events WHERE workspace_id=? AND id=? AND type=? AND resource_type='task' AND resource_id=? AND task_version=? AND run_id IS ? AND occurred_at=?",[job.workspace_id,raw.event_id,raw.kind,raw.task_id,raw.task_version,raw.run_id,raw.created_at]);
  if(chunk.table==='outbox'&&raw.destination_snapshot_json!==null&&!validateIntent(tx,actual as unknown as OutboxRow))throw Error('RECOVERY_RELATIONSHIP_MISMATCH');
 }
}
export function transformSourceChunk(tx:WorkspaceTransaction,chunk:CurrentRecoveryChunk,job:CurrentRestoreJob,authority:RestoreAuthorityPlan):void {
 for(const [offset,cells] of chunk.rows.entries()){
  const raw=sourceRow(chunk,cells);if(evidence(chunk.table,raw))continue;let row={...raw};
  if(['human_grants','static_agents','native_credentials','runtimes'].includes(chunk.table))row=transformRestoredAuthorityRow(authority,chunk.table as RestoreAuthorityTable,raw);
  if(chunk.table==='sessions')row.revoked_at=raw.revoked_at??job.created_at;
  if(chunk.table==='login_attempts'){row.consumed_at=raw.consumed_at??job.created_at;row.nonce='';row.pkce_verifier='';}
  if(chunk.table==='tasks'&&raw.active_run_id!==null){row.state='backlog';row.active_run_id=null;row.task_version=nextAuthorityVersion(Number(raw.task_version),true);row.updated_at=job.created_at;const flags=JSON.parse(String(raw.flags_json)) as string[];row.flags_json=canonicalJson([...new Set([...flags,'outcome_unknown'])]);}
  if(chunk.table==='runs'&&raw.status==='active'){row.status='expired';row.ended_at=job.created_at;row.run_version=nextAuthorityVersion(Number(raw.run_version),true);}
  if(chunk.table==='artifacts'&&raw.status!=='committed'){row.status='expired';row.active_generation_id=null;row.committed_generation_id=null;row.committed_at=null;row.expiry_check_at=null;row.artifact_version=nextAuthorityVersion(Number(raw.artifact_version),true);}
  if(chunk.table==='artifact_generations'&&raw.state!=='committed'){row.cleanup_next_at=null;row.delete_admission_epoch=null;row.delete_admission_generation=null;row.cleanup_error_code='RECOVERY_COVERAGE_UNKNOWN';}
  if(['catalog_plans','import_plans'].includes(chunk.table)&&raw.status==='previewed')row.status='expired';
  if(canonicalJson(row)!==canonicalJson(raw))updateRow(tx,chunk.table,row);
  if(chunk.table==='tasks'&&raw.active_run_id!==null){const run=tx.one<SourceRow>('SELECT * FROM runs WHERE id=? AND workspace_id=?',[raw.active_run_id,job.workspace_id])!;appendRestoreExpiryAudit(tx,job,chunk.index,offset,raw,row,run);}
 }
}
