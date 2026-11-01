import type {WorkspaceTransaction,SqlValue} from '../storage/transaction';
import {canonicalJson} from '../config/bootstrap';
import type {ObservationCoverage,ObservationBatchReceipt,ObservationReplacementReceipt,ObservationRecord} from '../http/dto';
import {validateObservationCoverage,validateObservationBatchReceipt,validateObservationReplacementReceipt} from '../http/generated/auth-validators.js';
import {assertReportedRecord,utf8Bytes,OBSERVATION_METADATA_BYTES,OBSERVATION_STORED_BYTES} from './validation';
import {HttpError} from '../http/envelopes';
export interface ObservationSlotRow {slot:number;workspace_id:string;task_id:string;project_id:string|null;run_id:string;agent_id:string;runtime_instance_id:string;credential_id:string;authority_epoch:number;maintenance_generation:number;mapping_digest:string;session_id:string;session_epoch:number;high_water:number;created_at:number;metadata_json:string;metadata_bytes:number;}
export interface ObservationRecordRow {session_id:string;sequence:number;ingest_order:number;received_at:number;record_json:string;record_bytes:number;}
export interface ObservationMetadata {repository_id:string;checkout_slot_id:string;coverage:ObservationCoverage;latest_batch_receipt:ObservationBatchReceipt|null;latest_replacement_receipt:ObservationReplacementReceipt|null;retained_range:{first_sequence:number;last_sequence:number}|null;truncated:boolean;}
export const observationSlotBytes=(row:ObservationSlotRow)=>utf8Bytes(canonicalJson(row));
export const observationRecordBytes=(row:ObservationRecordRow)=>utf8Bytes(canonicalJson(row));
const corrupt=():never=>{throw new HttpError('DEPENDENCY_UNAVAILABLE',503);};
const keys=(v:unknown,k:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...k].sort().join(',');
const integer=(n:unknown,min=0):n is number=>Number.isSafeInteger(n)&&(n as number)>=min;
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
const sid=(v:unknown):v is string=>typeof v==='string'&&/^obs_[a-f0-9]{48}$/.test(v);
function preflightSlots(tx:WorkspaceTransaction):void{
 const size=tx.one<{n:number;bytes:number}>("SELECT COUNT(*) AS n,coalesce(SUM(length(CAST(workspace_id AS BLOB))+length(CAST(task_id AS BLOB))+coalesce(length(CAST(project_id AS BLOB)),0)+length(CAST(run_id AS BLOB))+length(CAST(agent_id AS BLOB))+length(CAST(runtime_instance_id AS BLOB))+length(CAST(credential_id AS BLOB))+length(CAST(mapping_digest AS BLOB))+length(CAST(session_id AS BLOB))+length(CAST(metadata_json AS BLOB))),0) AS bytes FROM observation_slots")!;
 if(size.n>2||size.bytes>OBSERVATION_METADATA_BYTES)throw new HttpError('LIMIT_EXCEEDED',409);
}
function preflightRecords(tx:WorkspaceTransaction,final=false):void{
 const size=tx.one<{n:number;bytes:number}>('SELECT COUNT(*) AS n,coalesce(SUM(length(CAST(session_id AS BLOB))+length(CAST(record_json AS BLOB))),0) AS bytes FROM observation_records')!;
 // A single bounded append may temporarily add32 rows before atomic prefix eviction.
 if(size.n>(final?512:544)||size.bytes>OBSERVATION_STORED_BYTES+(final?0:65536))throw new HttpError('LIMIT_EXCEEDED',409);
}
export function observationSlots(tx:WorkspaceTransaction):readonly ObservationSlotRow[]{preflightSlots(tx);return tx.all<ObservationSlotRow>('SELECT * FROM observation_slots ORDER BY slot LIMIT 3');}
export function observationRecords(tx:WorkspaceTransaction,sessionId?:string):readonly ObservationRecordRow[]{preflightRecords(tx);return sessionId===undefined?tx.all<ObservationRecordRow>('SELECT * FROM observation_records ORDER BY ingest_order LIMIT 545'):tx.all<ObservationRecordRow>('SELECT * FROM observation_records WHERE session_id=? ORDER BY sequence LIMIT 545',[sessionId]);}
export function observationMetadata(row:ObservationSlotRow):ObservationMetadata{
 let m:any;try{m=JSON.parse(row.metadata_json);}catch{return corrupt();}
 if(utf8Bytes(row.metadata_json)!==row.metadata_bytes||canonicalJson(m)!==row.metadata_json||!keys(m,['repository_id','checkout_slot_id','coverage','latest_batch_receipt','latest_replacement_receipt','retained_range','truncated'])||(typeof m.repository_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(m.repository_id))||(typeof m.checkout_slot_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(m.checkout_slot_id))||!validateObservationCoverage(m.coverage)||typeof m.truncated!=='boolean'||m.latest_batch_receipt!==null&&!validateObservationBatchReceipt(m.latest_batch_receipt)||m.latest_replacement_receipt!==null&&!validateObservationReplacementReceipt(m.latest_replacement_receipt)||m.retained_range!==null&&(!keys(m.retained_range,['first_sequence','last_sequence'])||!integer(m.retained_range.first_sequence,1)||!integer(m.retained_range.last_sequence,1)||m.retained_range.first_sequence>m.retained_range.last_sequence))return corrupt();
 return m as unknown as ObservationMetadata;
}
export function reportedRecord(row:ObservationRecordRow):ObservationRecord{
 let record:unknown;try{record=JSON.parse(row.record_json);assertReportedRecord(record);}catch{return corrupt();}
 if(utf8Bytes(row.record_json)!==row.record_bytes||canonicalJson(record)!==row.record_json)return corrupt();return record;
}
export function storeObservationSlot(tx:WorkspaceTransaction,row:ObservationSlotRow,metadata:ObservationMetadata):void{
 row.metadata_json=canonicalJson(metadata);row.metadata_bytes=utf8Bytes(row.metadata_json);if(observationSlotBytes(row)>OBSERVATION_METADATA_BYTES)throw new HttpError('LIMIT_EXCEEDED',409);
 const columns=Object.keys(row);tx.exec('INSERT OR REPLACE INTO observation_slots ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')',columns.map(k=>row[k as keyof ObservationSlotRow]) as SqlValue[]);
}
export function clearObservations(tx:WorkspaceTransaction):void{tx.exec('DELETE FROM observation_records');tx.exec('DELETE FROM observation_slots');}
/** Complete stored projection accounting, never caller-supplied byte totals. */
export function assertObservationCapacity(tx:WorkspaceTransaction):void{
 const slots=observationSlots(tx),records=observationRecords(tx),metadata=slots.reduce((n,row)=>n+observationSlotBytes(row),0);
 if(slots.length>2||records.length>512||slots.some(s=>records.filter(r=>r.session_id===s.session_id).length>256)||metadata>OBSERVATION_METADATA_BYTES||metadata+records.reduce((n,row)=>n+observationRecordBytes(row),0)>OBSERVATION_STORED_BYTES)throw new HttpError('LIMIT_EXCEEDED',409);
}
/** Restore/capture integrity only. Historical rows confer no current execution authority. */
export function assertObservationGraph(tx:WorkspaceTransaction):void{
 preflightSlots(tx);preflightRecords(tx,true);
 const slots=observationSlots(tx),records=observationRecords(tx),sessions=new Set<string>(),orders=new Set<number>();
 assertObservationCapacity(tx);
 for(const s of slots){
  if(![0,1].includes(s.slot)||![s.workspace_id,s.task_id,s.run_id,s.agent_id,s.runtime_instance_id,s.credential_id].every(id)||s.project_id!==null&&!id(s.project_id)||!integer(s.authority_epoch,1)||!integer(s.maintenance_generation)||!/^[a-f0-9]{64}$/.test(s.mapping_digest)||!sid(s.session_id)||sessions.has(s.session_id)||!integer(s.session_epoch,1)||!integer(s.high_water)||!integer(s.created_at)||!integer(s.metadata_bytes))corrupt();sessions.add(s.session_id);
  const m=observationMetadata(s),r=records.filter(r=>r.session_id===s.session_id).sort((a,b)=>a.sequence-b.sequence);
  const run=tx.one<{fence:number}>('SELECT fence FROM runs WHERE workspace_id=? AND task_id=? AND id=? AND agent_id=? AND runtime_instance_id=? AND credential_id=? AND authority_epoch=?',[s.workspace_id,s.task_id,s.run_id,s.agent_id,s.runtime_instance_id,s.credential_id,s.authority_epoch]);
  if(!run||!integer(run.fence,1)||!tx.one('SELECT id FROM tasks WHERE workspace_id=? AND id=?',[s.workspace_id,s.task_id])||!tx.one('SELECT id FROM runtimes WHERE workspace_id=? AND id=? AND agent_id=? AND credential_id=? AND authority_epoch=?',[s.workspace_id,s.runtime_instance_id,s.agent_id,s.credential_id,s.authority_epoch])||!tx.one('SELECT credential_id FROM native_credentials WHERE workspace_id=? AND credential_id=? AND agent_id=?',[s.workspace_id,s.credential_id,s.agent_id]))corrupt();
  if(r.length){if(m.retained_range===null||m.retained_range.first_sequence!==r[0].sequence||m.retained_range.last_sequence!==s.high_water||r.at(-1)!.sequence!==s.high_water||r.length!==s.high_water-r[0].sequence+1||r.some((x,i)=>i>0&&x.ingest_order<=r[i-1].ingest_order)||r[0].sequence>1&&!m.truncated)corrupt();}else if(m.retained_range!==null||s.high_water>0&&!m.truncated)corrupt();
  const b=m.latest_batch_receipt;if(b&&(b.session_id!==s.session_id||b.last_sequence!==s.high_water||b.last_sequence-b.first_sequence+1!==b.record_count)||s.high_water>0&&!b)corrupt();
  const rep=m.latest_replacement_receipt;if(rep&&(rep.new_session_id!==s.session_id||rep.new_epoch!==s.session_epoch||rep.old_session_id===s.session_id))corrupt();
 }
 for(const r of records){if(!sessions.has(r.session_id)||!integer(r.sequence,1)||!integer(r.ingest_order,1)||!integer(r.received_at)||!integer(r.record_bytes)||orders.has(r.ingest_order))corrupt();orders.add(r.ingest_order);reportedRecord(r);}
}
/** Prefix eviction uses private monotonic ingest order, never reported/server wallclock. */
export function retainObservationBounds(tx:WorkspaceTransaction):void{
 for(const slot of observationSlots(tx)){const rows=observationRecords(tx,slot.session_id);for(const row of rows.slice(0,Math.max(0,rows.length-256)))tx.exec('DELETE FROM observation_records WHERE session_id=? AND sequence=?',[row.session_id,row.sequence]);}
 const refresh=()=>{for(const slot of observationSlots(tx)){const m=observationMetadata(slot),rows=observationRecords(tx,slot.session_id);m.retained_range=rows.length?{first_sequence:rows[0].sequence,last_sequence:rows.at(-1)!.sequence}:null;m.truncated=m.truncated||slot.high_water>0&&(!rows.length||rows[0].sequence>1);storeObservationSlot(tx,slot,m);}};
 refresh();for(;;){try{assertObservationCapacity(tx);return;}catch(error){if(!(error instanceof HttpError)||error.code!=='LIMIT_EXCEEDED')throw error;const oldest=observationRecords(tx)[0];if(!oldest)throw error;tx.exec('DELETE FROM observation_records WHERE session_id=? AND sequence=?',[oldest.session_id,oldest.sequence]);refresh();}}
}
