import {canonicalJson} from '../config/bootstrap';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {canonicalBytes,closed} from './encoding';
import {assertCurrentRestoreJob,type CurrentRestoreJob} from './restore-job';
import type {RecoveryWorkspace,RecoveryContext,CurrentRecoveryArtifactEntry} from './protocol';

export interface ArtifactCopyEffect {
 inspect:()=> 'reserved'|'terminal';
 dispatch:()=>void;
 settled:()=>void;
 existing:()=>void;
}
interface EffectRecord {
 version:1;state:'reserved'|'dispatched'|'terminal';job_id:string;manifest_digest:string;
 principal_id:string;operation_id:string;request_fingerprint:string;index:number;
 authority_epoch:number;maintenance_generation:number;entry:CurrentRecoveryArtifactEntry;
}
const operation='operator.recovery.artifact-copy',principal='system_recovery';
/** Internal evidence has no public replay endpoint and never expires while an effect is unknown. */
export function reserveArtifactCopyEffect(w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentRestoreJob):ArtifactCopyEffect&{assertTerminal:(tx:WorkspaceTransaction)=>void} {
 ctx=structuredClone(ctx);job=structuredClone(job);const index=job.details.artifactIndex,entry=job.details.manifest.artifacts[index];
 if(!entry)throw Error('RECOVERY_ARTIFACT_IDENTITY_MISMATCH');
 const expected:Omit<EffectRecord,'state'>={version:1,job_id:job.id,manifest_digest:job.manifest_digest!,principal_id:ctx.principalId,operation_id:ctx.operationId,request_fingerprint:ctx.requestFingerprint,index,authority_epoch:job.authority_epoch,maintenance_generation:job.details.fence.maintenanceGeneration,entry};
 const key='artifact_'+index,bindings=[principal,operation,job.id,key,job.workspace_id];
 const assertJob=(tx:WorkspaceTransaction)=>{
  const current=assertCurrentRestoreJob(tx,w,ctx,job.id),p=current.details.pending;
  if(current.state!=='running'||current.details.stage!=='artifacts'||current.details.artifactIndex!==index||current.manifest_digest!==job.manifest_digest||current.details.fence.maintenanceGeneration!==expected.maintenance_generation||canonicalJson(current.details.manifest.artifacts[index])!==canonicalJson(entry)||!p||p.kind!=='artifact'||p.index!==index||p.operationId!==ctx.operationId||p.fingerprint!==ctx.requestFingerprint)throw Error('RECOVERY_ARTIFACT_EFFECT_CONFLICT');
 };
 const read=(tx:WorkspaceTransaction):EffectRecord|null=>{
  assertJob(tx);
  const row=tx.one<{fingerprint:string;status:number;outcome_json:string;original_request_id:string;event_id:string|null;created_at:number;expires_at:number}>('SELECT fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at FROM idempotency_outcomes WHERE principal_id=? AND operation=? AND target=? AND key=? AND workspace_id=?',bindings);
  if(!row)return null;
  if(row.fingerprint!==ctx.requestFingerprint||row.status!==202||row.original_request_id!==ctx.operationId||row.event_id!==null||row.created_at!==job.created_at||row.expires_at!==Number.MAX_SAFE_INTEGER||new TextEncoder().encode(row.outcome_json).length>4096)throw Error('RECOVERY_ARTIFACT_EFFECT_CONFLICT');
  const value:unknown=JSON.parse(row.outcome_json);
  if(!closed(value,[...Object.keys(expected),'state'])||!['reserved','dispatched','terminal'].includes(String(value.state)))throw Error('RECOVERY_ARTIFACT_EFFECT_CONFLICT');
  const {state,...identity}=value;if(canonicalJson(identity)!==canonicalJson(expected))throw Error('RECOVERY_ARTIFACT_EFFECT_CONFLICT');
  return value as unknown as EffectRecord;
 };
 const transition=(before:EffectRecord['state'],after:EffectRecord['state'])=>withTransaction(w.storage,tx=>{
  const record=read(tx);if(!record||record.state!==before)throw Error(record?.state==='dispatched'?'RECOVERY_ARTIFACT_EFFECT_UNRESOLVED':'RECOVERY_ARTIFACT_EFFECT_CONFLICT');
  const next={...record,state:after};if(canonicalBytes(next).length>4096)throw Error('RECOVERY_ARTIFACT_EFFECT_CONFLICT');
  tx.exec('UPDATE idempotency_outcomes SET outcome_json=? WHERE principal_id=? AND operation=? AND target=? AND key=? AND workspace_id=?',[canonicalJson(next),...bindings]);
 });
 withTransaction(w.storage,tx=>{
  if(read(tx))return;
  const record={...expected,state:'reserved'};if(canonicalBytes(record).length>4096)throw Error('RECOVERY_ARTIFACT_EFFECT_CONFLICT');
  tx.exec('INSERT INTO idempotency_outcomes (principal_id,operation,target,key,workspace_id,fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at) VALUES (?,?,?,?,?,?,202,?,?,NULL,?,?)',[...bindings,ctx.requestFingerprint,canonicalJson(record),ctx.operationId,job.created_at,Number.MAX_SAFE_INTEGER]);
 });
 return {
  inspect:()=>withTransaction(w.storage,tx=>{const record=read(tx);if(!record)throw Error('RECOVERY_ARTIFACT_EFFECT_CONFLICT');if(record.state==='dispatched')throw Error('RECOVERY_ARTIFACT_EFFECT_UNRESOLVED');return record.state;}),
  dispatch:()=>transition('reserved','dispatched'),settled:()=>transition('dispatched','terminal'),existing:()=>transition('reserved','terminal'),
  assertTerminal:tx=>{const record=read(tx);if(record?.state!=='terminal')throw Error('RECOVERY_ARTIFACT_EFFECT_UNRESOLVED');}
 };
}
