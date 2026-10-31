import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import type {ImportEnvelope,ImportRow,ImportPreview,ImportPreviewRow,ImportReport,ImportProvenance} from '../http/dto';
import {validateImportEnvelope,validateImportRow,validateImportPreview,validateImportReport,validateImportProvenance} from '../http/generated/auth-validators.js';
import {refreshActor,authorize} from '../auth/authorize';
import {storedProfile} from '../config/profile';
import {canonicalJson} from '../config/bootstrap';
import {assertTaskReferences} from '../config/execution-policy';
import {getTask,taskRecord} from '../tasks/repository';
import {HttpError} from '../http/envelopes';
export const IMPORT_TTL_MS=900000,IMPORT_STORED_BYTES=1048576;
const encoder=new TextEncoder();
export const bytes=(value:unknown)=>encoder.encode(canonicalJson(value)).byteLength;
export function fail(code:'INVALID_REQUEST'|'INVALID_STATE'|'VERSION_CONFLICT'|'NOT_FOUND'|'FORBIDDEN'|'INTERNAL_ERROR'|'LIMIT_EXCEEDED'|'DEPENDENCY_UNAVAILABLE',status:number):never{throw new HttpError(code,status);}
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const positive=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;
const keys=(value:unknown,names:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===names.sort().join(',');
export interface ImportContext{actor:ActorContext;nowMs:number;}
export interface Mapping{task_id:string;source_sha256:string;mapping_version:number;source_version:string;import_id:string;provenance_json:string;created_at:number;updated_at:number;}
export interface MappingTask{id:string;version:number;project_id:string|null;}
export interface RowSnapshot{mapping:Mapping|null;task:MappingTask|null;valid_reference:boolean;}
export interface Evidence{version:1;source_hashes:(string|null)[];rows:(RowSnapshot|null)[];}
export interface ImportPlanRow{id:string;workspace_id:string;actor_principal_id:string;namespace:string;profile_revision:number;preview_json:string;source_rows_json:string;touched_versions_json:string;source_digest:string;report_json:string|null;status:'previewed'|'applied'|'expired';expires_at:number;created_at:number;}
export interface StoredImport{row:ImportPlanRow;preview:ImportPreview;batch:ImportEnvelope;evidence:Evidence;report:ImportReport|null;}
export function importHuman(tx:WorkspaceTransaction,ctx:ImportContext,apply=false):ActorContext{
 const actor=refreshActor(tx,ctx.actor,ctx.nowMs);
 if(actor.kind!=='human'||!actor.sessionId)fail('FORBIDDEN',403);
 for(const scope of ['imports:manage','tasks:read',...(apply?['tasks:create']:[])])authorize(tx,actor,scope,undefined,ctx.nowMs);
 return actor;
}
export function validateEnvelope(batch:unknown):asserts batch is ImportEnvelope{
 if(!validateImportEnvelope(batch))fail('INVALID_REQUEST',400);
 if(bytes(sanitizedBatch(batch))>65536)fail('LIMIT_EXCEEDED',413);
}
export function sanitizedBatch(batch:ImportEnvelope):ImportEnvelope{return {...batch,rows:batch.rows.map(row=>validateImportRow(row)?structuredClone(row):null)};}
function mappingValid(value:unknown):value is Mapping{
 if(!keys(value,['task_id','source_sha256','mapping_version','source_version','import_id','provenance_json','created_at','updated_at']))return false;
 if(typeof value.task_id!=='string'||!value.task_id||!hash(value.source_sha256)||!positive(value.mapping_version)||typeof value.source_version!=='string'||typeof value.import_id!=='string'||!value.import_id||typeof value.provenance_json!=='string'||!Number.isSafeInteger(value.created_at)||!Number.isSafeInteger(value.updated_at))return false;
 let provenance:unknown;try{provenance=JSON.parse(value.provenance_json);}catch{return false;}
 return validateImportProvenance(provenance)&&provenance.task_id===value.task_id&&provenance.import_id===value.import_id&&provenance.source_sha256===value.source_sha256;
}
export function mapping(tx:WorkspaceTransaction,actor:ActorContext,namespace:string,externalId:string):Mapping|null{
 const size=tx.one<{n:number}>('SELECT length(CAST(task_id AS BLOB))+length(CAST(source_version AS BLOB))+length(CAST(import_id AS BLOB))+length(CAST(provenance_json AS BLOB)) AS n FROM import_mappings WHERE workspace_id=? AND namespace=? AND external_id=?',[actor.workspaceId,namespace,externalId]);
 if(!size)return null;if(size.n>IMPORT_STORED_BYTES)fail('INTERNAL_ERROR',500);
 const row=tx.one<Mapping>('SELECT task_id,source_sha256,mapping_version,source_version,import_id,provenance_json,created_at,updated_at FROM import_mappings WHERE workspace_id=? AND namespace=? AND external_id=?',[actor.workspaceId,namespace,externalId]);
 if(!mappingValid(row))fail('INTERNAL_ERROR',500);
 const provenance=JSON.parse(row!.provenance_json) as ImportProvenance;
 if(provenance.source_namespace!==namespace||provenance.external_id!==externalId)fail('INTERNAL_ERROR',500);
 return row;
}
function hidden(error:unknown):boolean{return error instanceof Error&&'code' in error&&['FORBIDDEN','NOT_FOUND'].includes(String(error.code));}
function assertSourceVisible(tx:WorkspaceTransaction,ctx:ImportContext,row:ImportRow):void{
 assertTaskReferences(tx,ctx.actor,{workspace_id:ctx.actor.workspaceId,project_id:row.project_id,work_role_id:row.work_role_id,assigned_agent_id:null});
}
/** Every valid row snapshots presence OR absence; hidden rows never disclose those snapshots. */
export function collectImport(tx:WorkspaceTransaction,ctx:ImportContext,batch:ImportEnvelope,sourceHashes:(string|null)[]){
 const profile=storedProfile(tx,ctx.actor),evidence:Evidence={version:1,source_hashes:sourceHashes,rows:[]},rows:ImportPreviewRow[]=[];
 for(const [index,input] of batch.rows.entries()){
  if(!validateImportRow(input)){evidence.rows.push(null);rows.push({index,external_id:null,disposition:'rejected',task_id:null,code:'INVALID_ROW'});continue;}
  const row=input as ImportRow,found=mapping(tx,ctx.actor,batch.source_namespace,row.external_id);let task:MappingTask|null=null,visible=true;
  try{assertSourceVisible(tx,ctx,row);}catch(error){if(!hidden(error))throw error;visible=false;}
  if(found){try{const record=taskRecord(tx,ctx.actor.workspaceId,found.task_id);task={id:record.id,version:record.task_version,project_id:record.project_id};getTask(tx,ctx,record.id);}catch(error){if(!hidden(error))throw error;visible=false;}}
  evidence.rows.push({mapping:found,task,valid_reference:visible});
  rows.push(!visible?{index,external_id:null,disposition:'rejected',task_id:null,code:'INVALID_REFERENCE'}:!found?{index,external_id:row.external_id,disposition:'create',task_id:null,code:null}:found.source_sha256===sourceHashes[index]?{index,external_id:row.external_id,disposition:'unchanged',task_id:found.task_id,code:null}:{index,external_id:row.external_id,disposition:'conflict',task_id:null,code:'SOURCE_CHANGED'});
 }
 const groups=new Map<string,number>();for(const row of rows)if(row.external_id!==null)groups.set(row.external_id,(groups.get(row.external_id)??0)+1);
 for(const row of rows)if(row.external_id!==null&&groups.get(row.external_id)!>1){row.disposition='conflict';row.task_id=null;row.code='DUPLICATE_EXTERNAL_ID';}
 const counts={received:rows.length,create:0,unchanged:0,conflict:0,rejected:0};for(const row of rows)counts[row.disposition]++;
 if(bytes(evidence)>IMPORT_STORED_BYTES)fail('LIMIT_EXCEEDED',413);
 return {profileRevision:profile.profile_revision,evidence,rows,counts};
}
function validateEvidence(evidence:unknown,batch:ImportEnvelope):evidence is Evidence{
 if(!keys(evidence,['version','source_hashes','rows'])||evidence.version!==1||!Array.isArray(evidence.source_hashes)||!Array.isArray(evidence.rows)||evidence.rows.length!==batch.rows.length||evidence.source_hashes.length!==batch.rows.length)return false;
 return evidence.rows.every((value,index)=>{
  const row=batch.rows[index],digest=(evidence.source_hashes as unknown[])[index];
  if(row===null)return value===null&&digest===null;
  if(!validateImportRow(row)||!hash(digest)||!keys(value,['mapping','task','valid_reference'])||typeof value.valid_reference!=='boolean'||value.mapping!==null&&!mappingValid(value.mapping))return false;
  if(value.task!==null&&(!keys(value.task,['id','version','project_id'])||typeof value.task.id!=='string'||!value.task.id||!positive(value.task.version)||value.task.project_id!==null&&typeof value.task.project_id!=='string'))return false;
  return value.mapping===null?value.task===null:value.task===null?!value.valid_reference:value.task.id===(value.mapping as Mapping).task_id;
 });
}
export function readImport(tx:WorkspaceTransaction,actor:ActorContext,id:string):StoredImport{
 const bounded=(name:string)=>`CASE WHEN length(CAST(${name} AS BLOB))<=${IMPORT_STORED_BYTES} THEN ${name} ELSE NULL END AS ${name}`;
 const row=tx.one<ImportPlanRow>(`SELECT id,workspace_id,actor_principal_id,namespace,profile_revision,${bounded('preview_json')},${bounded('source_rows_json')},${bounded('touched_versions_json')},source_digest,${bounded('report_json')},status,expires_at,created_at FROM import_plans WHERE workspace_id=? AND id=? AND actor_principal_id=?`,[actor.workspaceId,id,actor.principalId]);
 if(!row)fail('NOT_FOUND',404);
 let preview:ImportPreview,batch:ImportEnvelope,evidence:Evidence,report:ImportReport|null;
 try{preview=JSON.parse(row!.preview_json);batch=JSON.parse(row!.source_rows_json);evidence=JSON.parse(row!.touched_versions_json);report=row!.report_json===null?null:JSON.parse(row!.report_json);}catch{fail('INTERNAL_ERROR',500);}
 if(!validateImportPreview(preview!)||!validateImportEnvelope(batch!)||!validateEvidence(evidence!,batch!)||!hash(row!.source_digest)||!positive(row!.profile_revision)||!Number.isSafeInteger(row!.created_at)||row!.created_at<0||row!.expires_at-row!.created_at!==IMPORT_TTL_MS||Date.parse(preview!.expires_at)!==row!.expires_at||preview!.id!==row!.id||preview!.source_namespace!==row!.namespace||batch!.source_namespace!==row!.namespace||preview!.source_revision!==batch!.source_revision||preview!.rows.length!==batch!.rows.length||!['previewed','applied','expired'].includes(row!.status)||(row!.status==='applied')!==(report!==null))fail('INTERNAL_ERROR',500);
 const counts={received:preview!.rows.length,create:0,unchanged:0,conflict:0,rejected:0};
 for(const [index,item] of preview!.rows.entries()){
  counts[item.disposition]++;const source=batch!.rows[index] as ImportRow|null,ref=evidence!.rows[index];
  if(item.index!==index||source===null&&(item.code!=='INVALID_ROW'||item.disposition!=='rejected')||source!==null&&item.disposition!=='rejected'&&(item.external_id!==source.external_id||!ref?.valid_reference)||item.disposition==='unchanged'&&item.task_id!==ref?.mapping?.task_id)fail('INTERNAL_ERROR',500);
 }
 if(canonicalJson(counts)!==canonicalJson(preview!.counts))fail('INTERNAL_ERROR',500);
 if(report!==null){
  if(!validateImportReport(report)||report.id!==id||report.rows.length!==preview!.rows.length||Date.parse(report.applied_at)<row!.created_at||Date.parse(report.applied_at)>=row!.expires_at)fail('INTERNAL_ERROR',500);
  const expected={received:counts.received,created:counts.create,unchanged:counts.unchanged,conflict:counts.conflict,rejected:counts.rejected};
  if(canonicalJson(expected)!==canonicalJson(report.counts))fail('INTERNAL_ERROR',500);
  for(const [index,item] of report.rows.entries()){
   const before=preview!.rows[index];if(item.index!==index||item.disposition!==(before.disposition==='create'?'created':before.disposition)||item.code!==before.code||item.external_id!==before.external_id||before.disposition==='unchanged'&&item.task_id!==before.task_id)fail('INTERNAL_ERROR',500);
   if(item.provenance!==null){
    const source=batch!.rows[index] as ImportRow;
    if(canonicalJson(item.provenance)!==canonicalJson(provenance(batch!,source,evidence!.source_hashes[index]!,id,item.task_id!)))fail('INTERNAL_ERROR',500);
    // Reports cannot attribute a task to a different immutable mapping origin.
    const current=mapping(tx,actor,batch!.source_namespace,source.external_id);
    const origin=item.disposition==='created'?{task_id:item.task_id,source_sha256:item.provenance.source_sha256,mapping_version:1,source_version:batch!.source_revision,import_id:id,provenance_json:canonicalJson(item.provenance),created_at:Date.parse(report.applied_at),updated_at:Date.parse(report.applied_at)}:evidence!.rows[index]?.mapping;
    if(!current||!origin||canonicalJson(current)!==canonicalJson(origin))fail('INTERNAL_ERROR',500);
   }
  }
 }
 return {row:row!,preview:preview!,batch:batch!,evidence:evidence!,report:report!};
}
export function provenance(batch:ImportEnvelope,row:ImportRow,digest:string,importId:string,taskId:string):ImportProvenance{return {source_namespace:batch.source_namespace,external_id:row.external_id,source_revision:batch.source_revision,source_updated_at:row.source_updated_at,source_state:row.source_state,source_ref:row.source_ref,source_sha256:digest,import_id:importId,task_id:taskId};}
/** Deny, never rewrite an immutable plan when any formerly disclosed edge is hidden. */
export function assertImportVisible(tx:WorkspaceTransaction,ctx:ImportContext,stored:StoredImport):void{
 try{
  for(const [index,item] of stored.preview.rows.entries()){
   if(item.disposition==='rejected')continue;
   const row=stored.batch.rows[index] as ImportRow,ref=stored.evidence.rows[index]!;assertSourceVisible(tx,ctx,row);
   if(ref.task){if(ctx.actor.projectIds!==null&&(ref.task.project_id===null||!ctx.actor.projectIds.includes(ref.task.project_id)))fail('NOT_FOUND',404);getTask(tx,ctx,ref.task.id);}
   const current=mapping(tx,ctx.actor,stored.batch.source_namespace,row.external_id);if(current)getTask(tx,ctx,current.task_id);
   const reportTask=stored.report?.rows[index].task_id;if(reportTask)getTask(tx,ctx,reportTask);
  }
 }catch(error){if(hidden(error))fail('NOT_FOUND',404);throw error;}
}
export function getImport(tx:WorkspaceTransaction,ctx:ImportContext,id:string):ImportPreview|ImportReport{
 const actor=importHuman(tx,ctx),stored=readImport(tx,actor,id);assertImportVisible(tx,{...ctx,actor},stored);return stored.report??stored.preview;
}
