import {projectEvent,resourceEventVisibility} from '../audit/events';
import {canonicalJson,sha256} from '../config/bootstrap';
import {currentConfiguration} from '../auth/context';
import {authorize,resolveActor} from '../auth/authorize';
import {maintenanceClosed} from '../recovery/maintenance';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {HttpError} from '../http/envelopes';
import {findOutcome,OUTCOME_RETENTION_MS} from './idempotency';
import {synchronousGuard,synchronousResult,type CommandAccessDescriptor,type CommandExecutionContext} from './commands';
import type {VerifiedIdentity,CommandContext} from './context';
export const ADMISSION_PRINCIPAL_LIMIT=64,ADMISSION_WORKSPACE_LIMIT=1024,ADMISSION_CLEANUP_LIMIT=200;
export interface CreationAdmission {admission_id:string;expires_at:string;}
export interface AdmissionRow {id:string;workspace_id:string;principal_id:string;operation:string;target:string;key_hash:string;fingerprint:string;created_at:number;expires_at:number;}
export function creationAccess<B,T>(tx:WorkspaceTransaction,ctx:CommandExecutionContext,identity:VerifiedIdentity,access:CommandAccessDescriptor<B,T>,body:B):CommandContext{
 if(identity.kind!=='human'||identity.workspaceId!==ctx.workspace.workspaceId||!['messages:send','tasks:create'].includes(access.operation)||access.target!==(access.operation==='messages:send'?'messages':'tasks:create'))throw new HttpError('INVALID_REQUEST',400);
 if(maintenanceClosed(tx))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 currentConfiguration(tx,ctx.workspace,{authorityEpoch:ctx.admissionEpoch,maintenanceGeneration:ctx.admissionGeneration});
 const nowMs=ctx.workspace.clock.nowMs(),actor=resolveActor(tx,identity,nowMs),context={actor,requestId:ctx.requestId,idempotencyKey:ctx.idempotencyKey,nowMs};
 authorize(tx,actor,access.operation,synchronousResult(access.resource(tx,context,body)),nowMs);synchronousGuard(access.checkAccess(tx,context,body));return context;
}
/** Opaque reference only: never a bearer credential or authorization grant. */
export async function prepareCreation<B,T>(ctx:CommandExecutionContext,identity:VerifiedIdentity,access:CommandAccessDescriptor<B,T>,body:B):Promise<CreationAdmission>{
 const keyHash=await sha256(ctx.idempotencyKey),id='event_'+Array.from(ctx.workspace.entropy.bytes(24),b=>b.toString(16).padStart(2,'0')).join('');
 const result=withTransaction<CreationAdmission|null>(ctx.workspace.storage,tx=>{
  const {actor,nowMs}=creationAccess(tx,ctx,identity,access,body);
  if(!Number.isSafeInteger(nowMs)||nowMs<0||!Number.isSafeInteger(nowMs+OUTCOME_RETENTION_MS)||nowMs+OUTCOME_RETENTION_MS>8640000000000000)throw new HttpError('INVALID_REQUEST',400);
  const prior=tx.one<AdmissionRow>('SELECT * FROM creation_admissions WHERE workspace_id=? AND principal_id=? AND operation=? AND target=? AND key_hash=?',[actor.workspaceId,actor.principalId,access.operation,access.target,keyHash]);
  if(prior&&prior.expires_at>nowMs){if(prior.fingerprint!==ctx.fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT',409);return {admission_id:prior.id,expires_at:new Date(prior.expires_at).toISOString()};}
  // A retained domain admission cannot be relabeled with a fresh handle.
  if(findOutcome(tx,actor.principalId,access.operation,access.target,ctx.idempotencyKey,actor.workspaceId))throw new HttpError('IDEMPOTENCY_CONFLICT',409);
  tx.exec('DELETE FROM creation_admissions WHERE id IN (SELECT id FROM creation_admissions WHERE workspace_id=? AND expires_at<=? ORDER BY expires_at,id LIMIT ?)',[actor.workspaceId,nowMs,ADMISSION_CLEANUP_LIMIT]);
  const counts=tx.one<{total:number;principal:number}>('SELECT count(*) AS total,coalesce(sum(CASE WHEN principal_id=? THEN 1 ELSE 0 END),0) AS principal FROM creation_admissions WHERE workspace_id=?',[actor.principalId,actor.workspaceId])!;
  if(counts.total>=ADMISSION_WORKSPACE_LIMIT||counts.principal>=ADMISSION_PRINCIPAL_LIMIT)return null;
  // An expired matching row beyond the bounded cleanup page remains closed, not renewed.
  if(tx.one('SELECT id FROM creation_admissions WHERE workspace_id=? AND principal_id=? AND operation=? AND target=? AND key_hash=?',[actor.workspaceId,actor.principalId,access.operation,access.target,keyHash]))return null;
  if(tx.one('SELECT id FROM events WHERE id=?',[id]))throw new HttpError('INTERNAL_ERROR',500);
  tx.exec('INSERT INTO creation_admissions(id,workspace_id,principal_id,operation,target,key_hash,fingerprint,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',[id,actor.workspaceId,actor.principalId,access.operation,access.target,keyHash,ctx.fingerprint,nowMs,nowMs+OUTCOME_RETENTION_MS]);
  return {admission_id:id,expires_at:new Date(nowMs+OUTCOME_RETENTION_MS).toISOString()};
 });
 // Capacity refusal must not roll back bounded expired cleanup and permanently
 // strand the next page. No domain admission occurred on this branch.
 if(result===null)throw new HttpError('LIMIT_EXCEEDED',429);return result;
}
export async function creationBindingDigest(input:{id:string;workspaceId:string;principalId:string;operation:string;target:string;keyHash:string;fingerprint:string}):Promise<string>{return sha256(canonicalJson({version:1,domain:'cfhub.browser-creation-admission',...input}));}
export type AdmissionEvidence={status:'unknown'}|{status:'admitted';admission:{event_id:string;entity_id:string}};
/** Exact original event identity, never a search by reused idempotency key. */
export async function reconcilePreparedCreation<B,T>(ctx:CommandExecutionContext,identity:VerifiedIdentity,access:CommandAccessDescriptor<B,T>,body:B,id:string):Promise<AdmissionEvidence>{
 if(!/^event_[a-f0-9]{48}$/.test(id))throw new HttpError('INVALID_REQUEST',400);
 const principalId=withTransaction(ctx.workspace.storage,tx=>creationAccess(tx,ctx,identity,access,body).actor.principalId),keyHash=await sha256(ctx.idempotencyKey);
 const digest=await creationBindingDigest({id,workspaceId:ctx.workspace.workspaceId,principalId,operation:access.operation,target:access.target,keyHash,fingerprint:ctx.fingerprint});
 return withTransaction(ctx.workspace.storage,tx=>{
  const {actor,nowMs}=creationAccess(tx,ctx,identity,access,body);if(actor.principalId!==principalId)throw new HttpError('UNAUTHENTICATED',401);
  // Preserve event disclosure authority even when no matching event exists.
  authorize(tx,actor,'events:read',undefined,nowMs);
  const row=tx.one<{id:string;type:string;resource_id:string;actor_json:string;creation_binding:string}>('SELECT id,type,resource_id,actor_json,creation_binding FROM events WHERE id=? AND workspace_id=? AND creation_binding=?',[id,actor.workspaceId,digest]);
  if(!row||row.type!==(access.operation==='messages:send'?'message.accepted':'task.created'))return {status:'unknown'};
  let owner:{kind?:unknown;principal_id?:unknown};try{owner=JSON.parse(row.actor_json);}catch{throw new HttpError('INTERNAL_ERROR',500);}
  if(owner.kind!=='human'||owner.principal_id!==principalId)return {status:'unknown'};
  const event=projectEvent(tx,actor,id,nowMs,resourceEventVisibility);if(!event)return {status:'unknown'};
  return {status:'admitted',admission:{event_id:id,entity_id:event.resource_id}};
 });
}
