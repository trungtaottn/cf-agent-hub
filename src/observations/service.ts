import type {WorkspaceTransaction} from '../storage/transaction';
import type {CommandContext} from '../workspace/context';
import type {AdmissionFence} from '../recovery/maintenance';
import type {DeploymentConfig} from '../config/deployment';
import type {ObservationEstablishRequest,ObservationBatchRequest,ObservationReplaceRequest,ObservationCurrentBinding,ObservationOwnerStatus,ObservationBatchReceipt,ObservationReplacementReceipt} from '../http/dto';
import {taskAccess,taskRecord} from '../tasks/repository';
import {assertActiveRun} from '../tasks/lease';
import {requireRuntimeProof} from '../auth/runtime-proof';
import {HttpError} from '../http/envelopes';
import {canonicalJson} from '../config/bootstrap';
import {observationSlots,observationMetadata,observationRecords,storeObservationSlot,retainObservationBounds,assertObservationCapacity,type ObservationSlotRow,type ObservationMetadata} from './repository';
import {utf8Bytes} from './validation';
export type ObservationPilot=NonNullable<DeploymentConfig['workspace_policies'][number]['observation_pilot']>;
export interface ObservationContext extends CommandContext {pilot:ObservationPilot;fence:AdmissionFence;mappingDigest:string;}
const conflict=():never=>{throw new HttpError('VERSION_CONFLICT',409);};
export function observationOwner(tx:WorkspaceTransaction,ctx:ObservationContext,taskId:string,runId:string,fence:number,proofHash:string){
 if(ctx.actor.kind!=='agent'||!ctx.actor.agentId||!ctx.actor.credentialId)throw new HttpError('FORBIDDEN',403);
 taskAccess(tx,ctx.actor,'tasks:read',taskId,ctx.nowMs);taskAccess(tx,ctx.actor,'events:read',taskId,ctx.nowMs);
 const run=tx.one<{runtime_instance_id:string}>('SELECT runtime_instance_id FROM runs WHERE workspace_id=? AND task_id=? AND id=? AND agent_id=? AND credential_id=?',[ctx.actor.workspaceId,taskId,runId,ctx.actor.agentId,ctx.actor.credentialId]);
 if(!run)throw new HttpError('FORBIDDEN',403);
 const proof=requireRuntimeProof(tx,ctx,run.runtime_instance_id,proofHash),active=assertActiveRun(tx,ctx,taskId,runId,fence,proof);
 const slot=ctx.pilot.slots.findIndex(s=>s.agent_id===ctx.actor.agentId);if(slot<0)throw new HttpError('FORBIDDEN',403);
 return {run:active,slot,task:taskRecord(tx,ctx.actor.workspaceId,taskId)};
}
export function currentOwnerSlot(tx:WorkspaceTransaction,ctx:ObservationContext,taskId:string,sessionId:string,proofHash:string){
 const slot=observationSlots(tx).find(s=>s.session_id===sessionId&&s.workspace_id===ctx.actor.workspaceId&&s.task_id===taskId&&s.agent_id===ctx.actor.agentId&&s.credential_id===ctx.actor.credentialId);
 if(!slot)throw new HttpError('FORBIDDEN',403);
 const run=tx.one<{fence:number}>('SELECT fence FROM runs WHERE workspace_id=? AND id=?',[ctx.actor.workspaceId,slot.run_id]);if(!run)throw new HttpError('FORBIDDEN',403);
 observationOwner(tx,ctx,taskId,slot.run_id,run.fence,proofHash);assertSlotBinding(slot,ctx,taskId,slot.run_id);return slot;
}
function assertSlotBinding(row:ObservationSlotRow,ctx:ObservationContext,taskId:string,runId:string):void{
 if(row.workspace_id!==ctx.actor.workspaceId||row.task_id!==taskId||row.run_id!==runId||row.agent_id!==ctx.actor.agentId||row.credential_id!==ctx.actor.credentialId||row.authority_epoch!==ctx.fence.authorityEpoch||row.maintenance_generation!==ctx.fence.maintenanceGeneration||row.mapping_digest!==ctx.mappingDigest)conflict();
}
function initialMetadata(ctx:ObservationContext,slot:number,reportedLoss=false):ObservationMetadata{return {repository_id:ctx.pilot.repository_id,checkout_slot_id:ctx.pilot.slots[slot].checkout_slot_id,coverage:{configured_events:[...ctx.pilot.supported_events],completeness:'unknown',reported_loss:reportedLoss},latest_batch_receipt:null,latest_replacement_receipt:null,retained_range:null,truncated:false};}
function binding(row:ObservationSlotRow,fence:number):ObservationCurrentBinding{return {kind:'current_binding',session_id:row.session_id,session_epoch:row.session_epoch,run_id:row.run_id,fence,established_at:new Date(row.created_at).toISOString(),coverage:observationMetadata(row).coverage};}
export function establishObservation(tx:WorkspaceTransaction,ctx:ObservationContext,taskId:string,body:ObservationEstablishRequest,newSessionId:string,proofHash:string):ObservationCurrentBinding{
 const owner=observationOwner(tx,ctx,taskId,body.run_id,body.fence,proofHash);
 if(body.adapter_id!==ctx.pilot.adapter_id||body.adapter_version!==ctx.pilot.adapter_version)throw new HttpError('FORBIDDEN',403);
 const prior=observationSlots(tx).find(s=>s.slot===owner.slot);
 if(prior&&prior.run_id===body.run_id){assertSlotBinding(prior,ctx,taskId,body.run_id);if(prior.project_id!==owner.task.project_id)conflict();return binding(prior,body.fence);}
 if(prior){const old=tx.one<{status:string;lease_expires_at:number}>('SELECT status,lease_expires_at FROM runs WHERE workspace_id=? AND id=?',[prior.workspace_id,prior.run_id]);if(old?.status==='active'&&old.lease_expires_at>ctx.nowMs)conflict();}
 const epoch=(prior?.session_epoch??0)+1;if(!Number.isSafeInteger(epoch))throw new HttpError('LIMIT_EXCEEDED',409);
 if(prior)tx.exec('DELETE FROM observation_records WHERE session_id=?',[prior.session_id]);
 const row:ObservationSlotRow={slot:owner.slot,workspace_id:ctx.actor.workspaceId,task_id:taskId,project_id:owner.task.project_id,run_id:body.run_id,agent_id:ctx.actor.agentId!,runtime_instance_id:owner.run.runtime_instance_id,credential_id:ctx.actor.credentialId!,authority_epoch:ctx.fence.authorityEpoch,maintenance_generation:ctx.fence.maintenanceGeneration,mapping_digest:ctx.mappingDigest,session_id:newSessionId,session_epoch:epoch,high_water:0,created_at:ctx.nowMs,metadata_json:'',metadata_bytes:0};
 storeObservationSlot(tx,row,initialMetadata(ctx,owner.slot));assertObservationCapacity(tx);return binding(row,body.fence);
}
export function appendObservation(tx:WorkspaceTransaction,ctx:ObservationContext,taskId:string,sessionId:string,body:ObservationBatchRequest,fingerprint:string,proofHash:string):ObservationBatchReceipt{
 const owner=observationOwner(tx,ctx,taskId,body.run_id,body.fence,proofHash),row=observationSlots(tx).find(s=>s.slot===owner.slot);if(!row||row.session_id!==sessionId)conflict();assertSlotBinding(row!,ctx,taskId,body.run_id);if(row!.project_id!==owner.task.project_id)conflict();
 const m=observationMetadata(row!),prior=m.latest_batch_receipt;
 if(prior?.first_sequence===body.first_sequence){if(prior.request_fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT',409);return prior;}
 if(row!.high_water>=Number.MAX_SAFE_INTEGER)throw new HttpError('LIMIT_EXCEEDED',409);
 if(body.first_sequence!==row!.high_water+1)conflict();
 const offset=body.records.length-1;
 if(body.first_sequence>Number.MAX_SAFE_INTEGER-offset)throw new HttpError('LIMIT_EXCEEDED',409);
 const last=body.first_sequence+offset,rows=observationRecords(tx),priorIngest=rows.at(-1)?.ingest_order??0;
 if(!Number.isSafeInteger(priorIngest)||priorIngest>=Number.MAX_SAFE_INTEGER)throw new HttpError('LIMIT_EXCEEDED',409);
 const start=priorIngest+1;
 if(start>Number.MAX_SAFE_INTEGER-offset)throw new HttpError('LIMIT_EXCEEDED',409);
 if(body.records.some(r=>!ctx.pilot.supported_events.includes(r.activity)))throw new HttpError('INVALID_REQUEST',400);
 const receipt:ObservationBatchReceipt={kind:'batch_receipt',session_id:sessionId,first_sequence:body.first_sequence,last_sequence:last,record_count:body.records.length,accepted_at:new Date(ctx.nowMs).toISOString(),request_fingerprint:fingerprint};
 for(let i=0;i<body.records.length;i++){const text=canonicalJson(body.records[i]);tx.exec('INSERT INTO observation_records(session_id,sequence,ingest_order,received_at,record_json,record_bytes) VALUES (?,?,?,?,?,?)',[sessionId,body.first_sequence+i,start+i,ctx.nowMs,text,utf8Bytes(text)]);}
 row!.high_water=last;m.latest_batch_receipt=receipt;storeObservationSlot(tx,row!,m);retainObservationBounds(tx);return receipt;
}
export function replaceObservation(tx:WorkspaceTransaction,ctx:ObservationContext,taskId:string,body:ObservationReplaceRequest,newSessionId:string,fingerprint:string,proofHash:string):ObservationReplacementReceipt{
 const owner=observationOwner(tx,ctx,taskId,body.run_id,body.fence,proofHash),row=observationSlots(tx).find(s=>s.slot===owner.slot);if(!row)conflict();assertSlotBinding(row!,ctx,taskId,body.run_id);if(row!.project_id!==owner.task.project_id)conflict();
 const m=observationMetadata(row!),prior=m.latest_replacement_receipt;
 // Match retained replacement BEFORE ordinary old-session mismatch, even after successor appends.
 if(prior?.replacement_request_id===body.replacement_request_id){if(prior.request_fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT',409);return prior;}
 if(row!.session_id!==body.expected_session_id||row!.high_water!==body.expected_high_water)conflict();
 const epoch=row!.session_epoch+1;if(!Number.isSafeInteger(epoch))throw new HttpError('LIMIT_EXCEEDED',409);
 const receipt:ObservationReplacementReceipt={kind:'replacement_receipt',old_session_id:row!.session_id,new_session_id:newSessionId,new_epoch:epoch,replacement_request_id:body.replacement_request_id,accepted_at:new Date(ctx.nowMs).toISOString(),request_fingerprint:fingerprint};
 tx.exec('DELETE FROM observation_records WHERE session_id=?',[row!.session_id]);row!.session_id=newSessionId;row!.session_epoch=epoch;row!.high_water=0;row!.created_at=ctx.nowMs;
 const next=initialMetadata(ctx,owner.slot,true);next.latest_replacement_receipt=receipt;storeObservationSlot(tx,row!,next);assertObservationCapacity(tx);return receipt;
}
export function observationOwnerStatus(tx:WorkspaceTransaction,ctx:ObservationContext,taskId:string,sessionId:string,proofHash:string):ObservationOwnerStatus{
 const row=currentOwnerSlot(tx,ctx,taskId,sessionId,proofHash),m=observationMetadata(row);if(row.project_id!==taskRecord(tx,ctx.actor.workspaceId,taskId).project_id)conflict();
 return {kind:'current_owner_status',session_id:row.session_id,session_epoch:row.session_epoch,high_water:row.high_water,latest_batch_receipt:m.latest_batch_receipt,latest_replacement_receipt:m.latest_replacement_receipt};
}
