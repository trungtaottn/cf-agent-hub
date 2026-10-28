import {findOutcome,readOutcome} from '../workspace/idempotency';
import {verifyImportIntegrity,prepareStoredImport,assertImportIntegrity,type ImportIntegrity,type ImportBinding} from './integrity';
import type {WorkspaceTransaction} from '../storage/transaction';
import {withTransaction} from '../storage/transaction';
import type {CommandContext} from '../workspace/context';
import type {CommandDescriptor} from '../workspace/commands';
import type {CommandPreparationContext} from '../http/router';
import type {ImportEnvelope,ImportPreview,ImportReport,ImportRow,ImportApplyRequest} from '../http/dto';
import {validateImportApplyRequest,validateImportPreview,validateImportReport,validateImportRow} from '../http/generated/auth-validators.js';
import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {resolveActor} from '../auth/authorize';
import {sha256,canonicalJson} from '../config/bootstrap';
import {createTask} from '../tasks/commands';
import {appendEvent} from '../audit/events';
import {IMPORT_TTL_MS,IMPORT_STORED_BYTES,bytes,fail,importHuman,validateEnvelope,sanitizedBatch,collectImport,readImport,assertImportVisible,provenance,type Evidence} from './repository';
interface PreparedPreview{preview:ImportPreview;batch:ImportEnvelope;evidence:Evidence;profileRevision:number;createdAt:number;sourceDigest:string;}
/** Validation-only copy. The original numeric version is fingerprinted and checked after authorization. */
export function importApplyValidationValue(value:unknown):unknown{
 if(value!==null&&typeof value==='object'&&!Array.isArray(value)&&'expected_import_version' in value&&Number.isSafeInteger(value.expected_import_version)&&Number(value.expected_import_version)>0)return {...value,expected_import_version:1};
 return value;
}
function validateApply(value:ImportApplyRequest):void{
 if(!validateImportApplyRequest(importApplyValidationValue(value)))fail('INVALID_REQUEST',400);
 if(bytes(value)>65536)fail('LIMIT_EXCEEDED',413);
}
/** All crypto is outside SQL; the wrapper uses the same original proof again on final entry. */
export async function prepareImportPreview(workspace:AuthWorkspace,proof:CommandPreparationContext,batch:ImportEnvelope,id:string):Promise<CommandDescriptor<ImportEnvelope,ImportPreview>>{
 validateEnvelope(batch);const safe=sanitizedBatch(batch);
 const prior=withTransaction(workspace.storage,tx=>{
  currentConfiguration(tx,workspace,proof.fence);const nowMs=workspace.clock.nowMs(),actor=importHuman(tx,{actor:resolveActor(tx,proof.identity,nowMs),nowMs});
  const outcome=findOutcome(tx,actor.principalId,'imports:manage','imports:preview',proof.idempotencyKey,actor.workspaceId);
  if(!outcome)return null;
  const value=readOutcome<ImportPreview>(outcome,proof.fingerprint),saved=readImport(tx,actor,value.data.id);assertImportVisible(tx,{actor,nowMs},saved);return saved;
 });
 if(prior)return previewImportCommand(null,await verifyImportIntegrity(prior));
 const sourceHashes=await Promise.all(safe.rows.map(row=>row===null?Promise.resolve(null):sha256(canonicalJson(row))));
 const candidate=withTransaction(workspace.storage,tx=>{
  currentConfiguration(tx,workspace,proof.fence);const createdAt=workspace.clock.nowMs(),actor=resolveActor(tx,proof.identity,createdAt);importHuman(tx,{actor,nowMs:createdAt});
  if(!Number.isSafeInteger(createdAt)||createdAt<0||createdAt>8640000000000000-IMPORT_TTL_MS)fail('INTERNAL_ERROR',500);
  const collected=collectImport(tx,{actor,nowMs:createdAt},safe,sourceHashes);
  const publicPlan:Omit<ImportPreview,'preview_sha256'>={id,import_version:1,expires_at:new Date(createdAt+IMPORT_TTL_MS).toISOString(),source_namespace:batch.source_namespace,source_revision:batch.source_revision,counts:collected.counts,rows:collected.rows};
  return {...collected,createdAt,publicPlan,principalId:actor.principalId};
 });
 const preview:ImportPreview={...candidate.publicPlan,preview_sha256:await sha256(canonicalJson(candidate.publicPlan))};
 const binding:ImportBinding={workspace_id:workspace.workspaceId,actor_principal_id:candidate.principalId,profile_revision:candidate.profileRevision,created_at:candidate.createdAt,preview,batch:safe,evidence:candidate.evidence};
 return previewImportCommand({preview,batch:safe,evidence:candidate.evidence,profileRevision:candidate.profileRevision,createdAt:candidate.createdAt,sourceDigest:await sha256(canonicalJson(binding))});
}
export function previewImport(tx:WorkspaceTransaction,ctx:CommandContext,batch:ImportEnvelope,prepared:PreparedPreview):ImportPreview{
 validateEnvelope(batch);const actor=importHuman(tx,ctx),current=collectImport(tx,{...ctx,actor},prepared.batch,prepared.evidence.source_hashes);
 if(canonicalJson(sanitizedBatch(batch))!==canonicalJson(prepared.batch)||current.profileRevision!==prepared.profileRevision||canonicalJson(current.evidence)!==canonicalJson(prepared.evidence)||canonicalJson(current.rows)!==canonicalJson(prepared.preview.rows))fail('VERSION_CONFLICT',409);
 if(ctx.nowMs<prepared.createdAt||ctx.nowMs>=prepared.createdAt+IMPORT_TTL_MS)fail('INVALID_STATE',409);
 if(!validateImportPreview(prepared.preview)||bytes(prepared.preview)>IMPORT_STORED_BYTES||bytes(prepared.batch)>65536)fail('INTERNAL_ERROR',500);
 tx.exec("INSERT INTO import_plans(id,workspace_id,actor_principal_id,namespace,profile_revision,preview_json,source_rows_json,touched_versions_json,source_digest,report_json,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,NULL,'previewed',?,?)",[prepared.preview.id,actor.workspaceId,actor.principalId,prepared.batch.source_namespace,prepared.profileRevision,canonicalJson(prepared.preview),canonicalJson(prepared.batch),canonicalJson(prepared.evidence),prepared.sourceDigest,prepared.createdAt+IMPORT_TTL_MS,prepared.createdAt]);
 return prepared.preview;
}
export function applyImport(tx:WorkspaceTransaction,ctx:CommandContext,id:string,request:ImportApplyRequest,taskIds:readonly string[],eventId:string,verified:ImportIntegrity):ImportReport{
 validateApply(request);const actor=importHuman(tx,ctx,true),stored=readImport(tx,actor,id);assertImportVisible(tx,{...ctx,actor},stored);assertImportIntegrity(stored,verified);
 if(request.expected_import_version!==1||request.preview_sha256!==stored.preview.preview_sha256)fail('VERSION_CONFLICT',409);
 if(stored.row.status!=='previewed'||ctx.nowMs<stored.row.created_at||ctx.nowMs>=stored.row.expires_at)fail('INVALID_STATE',409);
 const current=collectImport(tx,{...ctx,actor},stored.batch,stored.evidence.source_hashes);
 if(current.profileRevision!==stored.row.profile_revision||canonicalJson(current.evidence)!==canonicalJson(stored.evidence)||canonicalJson(current.rows)!==canonicalJson(stored.preview.rows))fail('VERSION_CONFLICT',409);
 if(!request.accept_rejected_rows&&(stored.preview.counts.conflict||stored.preview.counts.rejected))fail('INVALID_STATE',409);
 const rows:ImportReport['rows']=[];
 for(const item of stored.preview.rows){
  const source=stored.batch.rows[item.index] as ImportRow|null;
  if(item.disposition==='conflict'||item.disposition==='rejected'){rows.push({...item,disposition:item.disposition,provenance:null});continue;}
  if(!source||!validateImportRow(source))fail('INTERNAL_ERROR',500);
  const taskId=item.disposition==='create'?taskIds[item.index]:item.task_id;
  if(!taskId)fail('INTERNAL_ERROR',500);
  const record=provenance(stored.batch,source!,stored.evidence.source_hashes[item.index]!,id,taskId!);
  if(item.disposition==='create'){
   createTask(tx,{...ctx,actor,taskId:taskId!},{title:source!.title,description:source!.description,project_id:source!.project_id,work_role_id:source!.work_role_id,assigned_agent_id:null});
   tx.exec('INSERT INTO import_mappings(workspace_id,namespace,external_id,task_id,source_sha256,mapping_version,source_version,import_id,provenance_json,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?,?,?)',[actor.workspaceId,stored.batch.source_namespace,source!.external_id,taskId!,record.source_sha256,stored.batch.source_revision,id,canonicalJson(record),ctx.nowMs,ctx.nowMs]);
   appendEvent(tx,{id:eventId+'_'+item.index,workspaceId:actor.workspaceId,actor,requestId:ctx.requestId,nowMs:ctx.nowMs,type:'task.created',resourceType:'task',resourceId:taskId!,resourceVersion:null,threadId:null});
  }
  rows.push({...item,disposition:item.disposition==='create'?'created':'unchanged',task_id:taskId!,provenance:record});
 }
 const before=stored.preview.counts,report:ImportReport={id,import_version:2,status:'applied',counts:{received:before.received,created:before.create,unchanged:before.unchanged,conflict:before.conflict,rejected:before.rejected},rows,applied_at:new Date(ctx.nowMs).toISOString()};
 if(!validateImportReport(report)||bytes(report)>IMPORT_STORED_BYTES)fail('INTERNAL_ERROR',500);
 tx.exec("UPDATE import_plans SET report_json=?,status='applied' WHERE workspace_id=? AND id=? AND status='previewed'",[canonicalJson(report),actor.workspaceId,id]);return report;
}
function previewImportCommand(prepared:PreparedPreview|null,verified?:ImportIntegrity):CommandDescriptor<ImportEnvelope,ImportPreview>{return {
 operation:'imports:manage',target:'imports:preview',resource(_tx,_ctx,batch){validateEnvelope(batch);return undefined;},checkAccess(tx,ctx){importHuman(tx,ctx);},
 checkReplay(tx,ctx,_body,outcome){const actor=importHuman(tx,ctx),stored=readImport(tx,actor,outcome.data.id);assertImportVisible(tx,{...ctx,actor},stored);if(verified)assertImportIntegrity(stored,verified);if(canonicalJson(stored.preview)!==canonicalJson(outcome.data))fail('INTERNAL_ERROR',500);},
 execute(tx,ctx,batch){if(!prepared)fail('DEPENDENCY_UNAVAILABLE',503);const data=previewImport(tx,ctx,batch,prepared);return {outcome:{status:200,data},event:{type:'import.previewed',resourceType:'import',resourceId:data.id,resourceVersion:1,threadId:null}};}
};}
function applyImportCommand(id:string,taskIds:readonly string[],verified:ImportIntegrity):CommandDescriptor<ImportApplyRequest,ImportReport>{return {
 operation:'imports:manage',target:'imports:'+id+':apply',resource(_tx,_ctx,request){validateApply(request);return undefined;},
 checkAccess(tx,ctx){const actor=importHuman(tx,ctx,true),stored=readImport(tx,actor,id);assertImportVisible(tx,{...ctx,actor},stored);assertImportIntegrity(stored,verified);},
 checkReplay(tx,ctx,_body,outcome){const actor=importHuman(tx,ctx,true),stored=readImport(tx,actor,id);assertImportVisible(tx,{...ctx,actor},stored);if(stored.report===null||canonicalJson(stored.report)!==canonicalJson(outcome.data))fail('INTERNAL_ERROR',500);},
 execute(tx,ctx,request,eventId){const data=applyImport(tx,ctx,id,request,taskIds,eventId,verified);return {outcome:{status:200,data},event:{type:'import.applied',resourceType:'import',resourceId:id,resourceVersion:2,threadId:null}};}
};}

export async function prepareImportApply(workspace:AuthWorkspace,proof:CommandPreparationContext,id:string,taskIds:readonly string[]):Promise<CommandDescriptor<ImportApplyRequest,ImportReport>>{return applyImportCommand(id,taskIds,await prepareStoredImport(workspace,proof,id,true));}
