import {canonicalJson} from '../config/bootstrap';
import type {WorkspaceTransaction,SqlValue} from '../storage/transaction';
import type {Event} from '../http/dto';
import {closed,canonicalBytes} from './encoding';
import {loadCurrentRestoreJob,type CurrentRestoreJob} from './restore-job';
import {RESTORE_EXPIRY_SUMMARY,type Evidence} from './restore-audit';

type Row=Record<string,SqlValue>;
const principal='system_recovery';
const nativeOperation='operator.recovery.audit';
const importedOperation='operator.recovery.imported-audit';
const stagingOperation='operator.recovery.source-audit';
const historyOperation='operator.recovery.history';
// Domain replay GC only deletes domain.*. Retain these attestations while their event/history is retained.
// Never interpret these namespaces as callback, resume, retirement, or product-operation authority.
const limit=4096;
interface Summary {version:1;job_id:string;manifest_digest:string;created_at:number;task_pages:number[][];}
interface Imported {version:1;original:Evidence;importer_job_id:string;importer_manifest_digest:string;}
interface Candidate {version:1;kind:'native'|'imported';original:Evidence;attesting_job_id:string;attesting_digest:string;attesting_created_at:number;}
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const jobId=(value:unknown):value is string=>typeof value==='string'&&/^job_[a-f0-9]{48}$/.test(value);
const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const timestamp=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=8640000000000000;
const idFor=(e:Evidence)=>`event_${e.job_id.slice(4)}_${e.chunk_index}_${e.row_offset}`;
function fail():never{throw Error('RECOVERY_AUDIT_PROVENANCE_MISMATCH');}
function bounded(value:unknown):void{if(canonicalBytes(value).length>limit)fail();}
function parse(value:string):unknown{if(new TextEncoder().encode(value).length>limit)fail();return JSON.parse(value);}
function evidence(value:unknown):Evidence {
 if(!closed(value,['version','job_id','manifest_digest','chunk_index','row_offset','task_id','run_id','source_task_version','task_version','fence','occurred_at'])||value.version!==1||!jobId(value.job_id)||!hash(value.manifest_digest)||!Number.isInteger(value.chunk_index)||Number(value.chunk_index)<0||Number(value.chunk_index)>255||!Number.isInteger(value.row_offset)||Number(value.row_offset)<0||Number(value.row_offset)>199||typeof value.task_id!=='string'||typeof value.run_id!=='string'||!positive(value.source_task_version)||!positive(value.task_version)||Number(value.source_task_version)+1!==value.task_version||!positive(value.fence)||!timestamp(value.occurred_at))fail();
 bounded(value);return value as unknown as Evidence;
}
function imported(value:unknown):Imported {
 if(!closed(value,['version','original','importer_job_id','importer_manifest_digest'])||value.version!==1||!jobId(value.importer_job_id)||!hash(value.importer_manifest_digest))fail();
 evidence(value.original);bounded(value);return value as unknown as Imported;
}
export function isCompletedRestoreAuditJob(job:CurrentRestoreJob):boolean {
 const d=job.details,r=d.receipt,m=d.manifest;
 return job.state==='complete'&&d.stage==='complete'&&d.phase==='complete'&&d.pending===null&&d.verifyIndex===0&&d.additionIndex===3&&d.additionOffset===0&&d.sourceMetadata!==null&&d.sourceMaintenance!==null
  &&d.counts.chunks===m.database.chunks.length&&d.counts.rows===m.database.chunks.reduce((n,c)=>n+c.row_count,0)&&d.counts.bytes===m.database.byte_size
  &&d.artifactIndex===m.artifacts.length&&d.artifactBytes===m.artifacts.reduce((n,a)=>n+a.byte_size,0)
  &&job.authority_epoch===d.ledger.authority_epoch&&d.fence.authorityEpoch===job.authority_epoch
  &&!!r&&r.status==='complete'&&r.id==='receipt_'+job.id.slice(4)&&r.capture_id===job.capture_id&&r.workspace_id===job.workspace_id&&r.started_at===new Date(job.created_at).toISOString()&&Date.parse(r.ended_at)>=job.created_at&&r.checks.length>0&&r.checks.every(c=>c.passed)&&r.checks.some(c=>c.name==='restore'&&c.passed);
}
function summaryFromRow(raw:Row):Summary|null {
 if(raw.operation!=='restore'||raw.state!=='complete')return null;
 try{
  const job=loadCurrentRestoreJob({one:()=>raw} as unknown as WorkspaceTransaction,String(raw.id));
  if(!job||!isCompletedRestoreAuditJob(job))return null;
  const value:Summary={version:1,job_id:job.id,manifest_digest:job.manifest_digest!,created_at:job.created_at,task_pages:job.details.manifest.database.chunks.filter(c=>c.table==='tasks').map(c=>[c.index,c.row_count])};
  bounded(value);return value;
 }catch{return null;}
}
function summary(value:unknown):Summary {
 if(!closed(value,['version','job_id','manifest_digest','created_at','task_pages'])||value.version!==1||!jobId(value.job_id)||!hash(value.manifest_digest)||!timestamp(value.created_at)||!Array.isArray(value.task_pages)||value.task_pages.length>256)fail();
 let last=-1;for(const page of value.task_pages){if(!Array.isArray(page)||page.length!==2||!Number.isInteger(page[0])||page[0]<=last||page[0]>255||!Number.isInteger(page[1])||page[1]<1||page[1]>200)fail();last=page[0];}bounded(value);return value as unknown as Summary;
}
function insert(tx:WorkspaceTransaction,job:CurrentRestoreJob,operation:string,target:string,key:string,value:unknown,eventId:string|null,createdAt=job.created_at):void {
 bounded(value);tx.exec('INSERT INTO idempotency_outcomes (principal_id,operation,target,key,workspace_id,fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at) VALUES (?,?,?,?,?,?,200,?,?,?,?,?)',[principal,operation,target,key,job.workspace_id,job.manifest_digest!,canonicalJson(value),eventId??'recovery_history',eventId,createdAt,Number.MAX_SAFE_INTEGER]);
}
/** Only authenticated source chunks call this. No source row is copied as executable authority. */
export function stageSourceAuditEvidence(tx:WorkspaceTransaction,table:string,raw:Row,job:CurrentRestoreJob):void {
 if(table==='recovery_jobs'){
  insert(tx,job,historyOperation,job.id,String(raw.id),{kind:'source_recovery_job',id:raw.id,audit:summaryFromRow(raw)},null);return;
 }
 if(table!=='idempotency_outcomes'||raw.operation!==nativeOperation&&raw.operation!==importedOperation)return;
 if(raw.principal_id!==principal||raw.workspace_id!==job.workspace_id||raw.status!==200||raw.expires_at!==Number.MAX_SAFE_INTEGER||typeof raw.outcome_json!=='string'||!timestamp(raw.created_at))fail();
 let candidate:Candidate;
 if(raw.operation===nativeOperation){const original=evidence(parse(raw.outcome_json));candidate={version:1,kind:'native',original,attesting_job_id:original.job_id,attesting_digest:original.manifest_digest,attesting_created_at:original.occurred_at};if(raw.target!==original.job_id)fail();}
 else {const value=imported(parse(raw.outcome_json));candidate={version:1,kind:'imported',original:value.original,attesting_job_id:value.importer_job_id,attesting_digest:value.importer_manifest_digest,attesting_created_at:Number(raw.created_at)};if(raw.target!==idFor(value.original))fail();}
 const id=idFor(candidate.original);
 if(raw.key!==id||raw.event_id!==id||raw.original_request_id!==id||raw.fingerprint!==candidate.attesting_digest||raw.created_at!==candidate.attesting_created_at)fail();
 insert(tx,job,stagingOperation,job.id,id,candidate,id);
}
function exactTuple(tx:WorkspaceTransaction,event:Event,e:Evidence):boolean {
 if(event.id!==idFor(e)||event.type!=='task.expired'||event.actor.kind!=='system'||event.actor.principal_id!=='system:recovery'||event.actor.agent_id!==null||event.resource_type!=='task'||event.resource_version!==null||event.thread_id!==null||event.resource_id!==e.task_id||event.run_id!==e.run_id||event.task_version!==e.task_version||event.fence!==e.fence||event.request_id!==event.id||event.summary!==RESTORE_EXPIRY_SUMMARY||event.occurred_at!==new Date(e.occurred_at).toISOString())return false;
 return !!tx.one("SELECT h.id FROM task_history h JOIN runs r ON r.workspace_id=h.workspace_id AND r.task_id=h.task_id AND r.id=h.run_id JOIN tasks t ON t.workspace_id=h.workspace_id AND t.id=h.task_id WHERE h.id=? AND h.event_id=? AND h.workspace_id=? AND h.task_id=? AND h.task_version=? AND h.run_id=? AND h.kind='task.expired' AND h.created_at=? AND h.reason IS NULL AND r.status='expired' AND r.ended_at=? AND r.fence=? AND t.task_version>=h.task_version",[event.id,event.id,event.workspace_id,e.task_id,e.task_version,e.run_id,e.occurred_at,e.occurred_at,e.fence]);
}
function eventFromRow(row:Row):Event {
 return {id:row.id,workspace_id:row.workspace_id,type:row.type,actor:JSON.parse(String(row.actor_json)),resource_type:row.resource_type,resource_id:row.resource_id,resource_version:row.resource_version,thread_id:row.thread_id,request_id:row.request_id,occurred_at:new Date(Number(row.occurred_at)).toISOString(),summary:row.summary,task_version:row.task_version,run_id:row.run_id,fence:row.fence} as Event;
}
/** Runs after all original rows/FK fixups, before any authority invalidation. */
export function validateAndImportSourceAudit(tx:WorkspaceTransaction,table:string,raw:Row,job:CurrentRestoreJob):void {
 if(table!=='idempotency_outcomes'||raw.operation!==nativeOperation&&raw.operation!==importedOperation)return;
 const id=String(raw.key),record=tx.one<Row>('SELECT * FROM idempotency_outcomes WHERE principal_id=? AND operation=? AND target=? AND key=?',[principal,stagingOperation,job.id,id]);
 if(!record||record.workspace_id!==job.workspace_id||record.fingerprint!==job.manifest_digest||record.status!==200||record.original_request_id!==id||record.event_id!==id||record.created_at!==job.created_at||record.expires_at!==Number.MAX_SAFE_INTEGER)fail();
 const value=parse(String(record.outcome_json));
 if(!closed(value,['version','kind','original','attesting_job_id','attesting_digest','attesting_created_at'])||value.version!==1||!['native','imported'].includes(String(value.kind))||!jobId(value.attesting_job_id)||!hash(value.attesting_digest)||!timestamp(value.attesting_created_at))fail();
 const e=evidence(value.original),sourceJob=tx.one<Row>('SELECT * FROM idempotency_outcomes WHERE principal_id=? AND operation=? AND target=? AND key=?',[principal,historyOperation,job.id,value.attesting_job_id]);
 if(!sourceJob||sourceJob.workspace_id!==job.workspace_id||sourceJob.fingerprint!==job.manifest_digest||sourceJob.status!==200||sourceJob.original_request_id!=='recovery_history'||sourceJob.event_id!==null||sourceJob.created_at!==job.created_at||sourceJob.expires_at!==Number.MAX_SAFE_INTEGER)fail();
 const marker=parse(String(sourceJob.outcome_json));if(!closed(marker,['kind','id','audit'])||marker.kind!=='source_recovery_job'||marker.id!==value.attesting_job_id)fail();
 const s=summary(marker.audit);if(s.job_id!==value.attesting_job_id||s.manifest_digest!==value.attesting_digest||s.created_at!==value.attesting_created_at)fail();
 if(value.kind==='native'&&!s.task_pages.some(p=>p[0]===e.chunk_index&&e.row_offset<p[1]))fail();
 const event=tx.one<Row>('SELECT * FROM events WHERE workspace_id=? AND id=?',[job.workspace_id,id]);if(!event||!exactTuple(tx,eventFromRow(event),e))fail();
 const result:Imported={version:1,original:e,importer_job_id:job.id,importer_manifest_digest:job.manifest_digest!};
 insert(tx,job,importedOperation,id,id,result,id);
}
/** Imported audit cannot authorize commands. Normal event visibility checks remain mandatory. */
export function isImportedRestoreExpiryEvent(tx:WorkspaceTransaction,event:Event):boolean {
 try{
  const record=tx.one<Row>('SELECT * FROM idempotency_outcomes WHERE principal_id=? AND operation=? AND target=? AND key=?',[principal,importedOperation,event.id,event.id]);
  if(!record||record.workspace_id!==event.workspace_id||record.status!==200||record.original_request_id!==event.id||record.event_id!==event.id||record.expires_at!==Number.MAX_SAFE_INTEGER) return false;
  const value=imported(parse(String(record.outcome_json)));
  if(record.fingerprint!==value.importer_manifest_digest||!exactTuple(tx,event,value.original))return false;
  const job=loadCurrentRestoreJob(tx,value.importer_job_id);
  return !!job&&isCompletedRestoreAuditJob(job)&&job.workspace_id===event.workspace_id&&job.manifest_digest===record.fingerprint&&job.created_at===record.created_at;
 }catch{return false;}
}
