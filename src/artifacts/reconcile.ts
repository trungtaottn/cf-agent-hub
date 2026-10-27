import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {HttpError} from '../http/envelopes';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {assertAdmissionOpen,type AdmissionFence} from '../recovery/maintenance';
import {markSchedulerDirty} from '../outbox/scheduler-state';
import {appendArtifactExpiryEvent} from '../audit/events';
import {nextArtifactVersion} from './commands';
import {artifactRecord,generationRecord,type GenerationRow} from './repository';
export interface ArtifactCleanupContext {workspace:AuthWorkspace;bucket:R2Bucket;admission?:AdmissionFence;}
export const ARTIFACT_RETRY_MS=30000;
const MAX_TIME=8640000000000000;
function bounds(now:number,limit:number):void {if(!Number.isSafeInteger(now)||now<0||now>MAX_TIME||!Number.isSafeInteger(limit)||limit<1||limit>200)throw new HttpError('INVALID_REQUEST',400);}
const later=(now:number,delay=ARTIFACT_RETRY_MS)=>Math.min(MAX_TIME,now+delay);
function installedWorkspace(tx:WorkspaceTransaction):string {assertAdmissionOpen(tx);return tx.one<{workspace_id:string}>('SELECT workspace_id FROM workspace_metadata WHERE id=1')!.workspace_id;}
/** Malformed historical references cannot create permission to discard retained evidence. */
function retainedReference(tx:WorkspaceTransaction,workspaceId:string,id:string):boolean {
 return Boolean(tx.one(`SELECT 1 FROM result_artifacts WHERE workspace_id=? AND artifact_id=? LIMIT 1`,[workspaceId,id])||tx.one(`SELECT 1 FROM message_artifacts WHERE workspace_id=? AND artifact_id=? LIMIT 1`,[workspaceId,id])||tx.one(`SELECT 1 FROM artifact_associations WHERE workspace_id=? AND artifact_id=? AND resource_kind IN ('result','message','checkpoint') LIMIT 1`,[workspaceId,id]));
}
export function nextArtifactDue(tx:WorkspaceTransaction):number|null {
 const values=[tx.one<{due:number}>('SELECT expiry_check_at AS due FROM artifacts WHERE workspace_id=(SELECT workspace_id FROM workspace_metadata WHERE id=1) AND expiry_check_at IS NOT NULL ORDER BY expiry_check_at,id LIMIT 1')?.due,
  tx.one<{due:number}>('SELECT cleanup_next_at AS due FROM artifact_generations WHERE workspace_id=(SELECT workspace_id FROM workspace_metadata WHERE id=1) AND cleanup_next_at IS NOT NULL ORDER BY cleanup_next_at,id LIMIT 1')?.due,
  tx.one<{due:number}>('SELECT next_due_at AS due FROM artifact_inventory_state WHERE id=1 AND workspace_id=(SELECT workspace_id FROM workspace_metadata WHERE id=1)')?.due].filter((x):x is number=>x!==undefined);
 return values.length?Math.min(...values):null;
}
/** Permanent SQL exclusion wins before any generation or external byte deletion. */
export function expireArtifactIntents(tx:WorkspaceTransaction,nowMs:number,limit:number):{tombstonedIds:string[];nextDueAt:number|null}{
 bounds(nowMs,limit);const workspaceId=installedWorkspace(tx);
 const rows=tx.all<{id:string;artifact_version:number;status:string;expires_at:number|null}>('SELECT id,artifact_version,status,expires_at FROM artifacts WHERE workspace_id=? AND expiry_check_at IS NOT NULL AND expiry_check_at<=? ORDER BY expiry_check_at,id LIMIT ?',[workspaceId,nowMs,limit]);
 const tombstonedIds:string[]=[];
 for(const row of rows){
  if(row.status!=='staged'&&row.status!=='uploaded'){tx.exec('UPDATE artifacts SET expiry_check_at=NULL WHERE workspace_id=? AND id=?',[workspaceId,row.id]);continue;}
  if(row.expires_at===null||!Number.isSafeInteger(row.expires_at)||row.expires_at<0||row.expires_at>MAX_TIME){tx.exec('UPDATE artifacts SET expiry_check_at=NULL WHERE workspace_id=? AND id=?',[workspaceId,row.id]);continue;}
  if(row.expires_at>nowMs||retainedReference(tx,workspaceId,row.id)){tx.exec('UPDATE artifacts SET expiry_check_at=? WHERE workspace_id=? AND id=?',[Math.max(later(nowMs),row.expires_at),workspaceId,row.id]);continue;}
  tx.exec("UPDATE artifacts SET status='expired',expiry_check_at=NULL,artifact_version=? WHERE workspace_id=? AND id=? AND status IN ('staged','uploaded')",[nextArtifactVersion(row.artifact_version),workspaceId,row.id]);appendArtifactExpiryEvent(tx,row.id,nowMs);tombstonedIds.push(row.id);
 }
 if(rows.length)markSchedulerDirty(tx);
 return {tombstonedIds,nextDueAt:nextArtifactDue(tx)};
}

function canonicalGeneration(g:GenerationRow):boolean {
 return g.artifact_version!==null&&Number.isSafeInteger(g.artifact_version)&&g.artifact_version>=1&&g.upload_idempotency_sha256!==null&&/^[a-f0-9]{64}$/.test(g.upload_idempotency_sha256)&&/^generation_[a-f0-9]{48}$/.test(g.id)&&g.object_key==='artifacts/'+encodeURIComponent(g.workspace_id)+'/'+encodeURIComponent(g.artifact_id)+'/'+g.id+'/'+g.expected_sha256;
}
type Hold='PUT_UNCERTAIN'|'DELETE_UNCERTAIN'|'RETAINED_REFERENCE'|'UNKNOWN_GENERATION'|'RECOVERY_COVERAGE_UNKNOWN';
function hold(tx:WorkspaceTransaction,g:GenerationRow,now:number,reason:Hold):null {tx.exec('UPDATE artifact_generations SET cleanup_next_at=?,cleanup_error_code=? WHERE workspace_id=? AND id=?',[later(now),reason,g.workspace_id,g.id]);markSchedulerDirty(tx);return null;}
interface DeleteReservation {generation:GenerationRow;fence:AdmissionFence;}
/** Re-resolves persisted exclusion, immutable key and effect slot in one synchronous transaction. */
function reserveDelete(tx:WorkspaceTransaction,ctx:ArtifactCleanupContext,id:string,operationId:string,now:number):DeleteReservation|null {
 const {fence}=currentConfiguration(tx,ctx.workspace,ctx.admission);const g=tx.one<GenerationRow>('SELECT * FROM artifact_generations WHERE workspace_id=? AND id=?',[ctx.workspace.workspaceId,id]);if(!g)return null;
 const row=artifactRecord(tx,g.workspace_id,g.artifact_id);
 if(g.state==='committed'||row.committed_generation_id===g.id||row.status==='committed'&&row.active_generation_id===g.id){tx.exec('UPDATE artifact_generations SET cleanup_next_at=NULL,cleanup_error_code=NULL WHERE workspace_id=? AND id=?',[g.workspace_id,g.id]);return null;}
 if(row.status!=='expired'&&row.status!=='committed'){tx.exec('UPDATE artifact_generations SET cleanup_next_at=? WHERE workspace_id=? AND id=?',[Math.max(later(now),row.expires_at??MAX_TIME),g.workspace_id,g.id]);return null;}
 if(retainedReference(tx,g.workspace_id,g.artifact_id)&&row.status!=='committed')return hold(tx,g,now,'RETAINED_REFERENCE');
 // Current-schema capture/restore inventory has no reviewed producer yet. Unknown coverage is protective.
 if(tx.one("SELECT id FROM recovery_jobs WHERE workspace_id=? AND operation IN ('capture','restore') LIMIT 1",[g.workspace_id]))return hold(tx,g,now,'RECOVERY_COVERAGE_UNKNOWN');
 if(!canonicalGeneration(g))return hold(tx,g,now,'UNKNOWN_GENERATION');
 if(g.effect_state==='in_flight'||g.effect_state==='uncertain')return hold(tx,g,now,g.effect_kind==='delete'?'DELETE_UNCERTAIN':'PUT_UNCERTAIN');
 if(g.effect_kind==='delete'&&g.effect_state==='drained'){tx.exec('UPDATE artifact_generations SET cleanup_next_at=NULL,cleanup_error_code=NULL WHERE workspace_id=? AND id=?',[g.workspace_id,g.id]);return null;}
 if(g.effect_kind!=='put'&&g.effect_kind!=='delete'||g.effect_state!=='reserved'&&g.effect_state!=='drained')return hold(tx,g,now,'UNKNOWN_GENERATION');
 // A reserved put has not dispatched: permanent artifact exclusion prevents its continuation from starting.
 tx.exec(`UPDATE artifact_generations SET state='tombstoned',effect_operation_id=?,effect_kind='delete',effect_state='reserved',effect_started_at=NULL,effect_drained_at=NULL,delete_admission_epoch=?,delete_admission_generation=?,cleanup_error_code=NULL,updated_at=? WHERE workspace_id=? AND id=? AND effect_operation_id=? AND effect_kind=? AND effect_state=?`,[operationId,fence.authorityEpoch,fence.maintenanceGeneration,now,g.workspace_id,g.id,g.effect_operation_id,g.effect_kind,g.effect_state]);
 const current=generationRecord(tx,g.workspace_id,g.artifact_id,g.id);if(current.effect_operation_id!==operationId)throw Error('ARTIFACT_EFFECT_CONFLICT');markSchedulerDirty(tx);return {generation:current,fence};
}
/** Terminal evidence only. Never call this from HEAD/LIST absence, timeout or a restart heuristic. */
export function settleArtifactDelete(storage:DurableObjectStorage,g:GenerationRow,now:number,state:'drained'|'uncertain'):void {
 bounds(now,1);withTransaction(storage,tx=>{
  tx.exec(`UPDATE artifact_generations SET effect_state=?,effect_drained_at=?,cleanup_next_at=?,cleanup_error_code=?,updated_at=? WHERE workspace_id=? AND artifact_id=? AND id=? AND state='tombstoned' AND effect_kind='delete' AND effect_operation_id=? AND effect_state IN ('in_flight','uncertain') AND delete_admission_epoch=? AND delete_admission_generation=?`,[state,state==='drained'?now:null,state==='drained'?null:later(now),state==='drained'?null:'DELETE_UNCERTAIN',now,g.workspace_id,g.artifact_id,g.id,g.effect_operation_id,g.delete_admission_epoch,g.delete_admission_generation]);
 });
}
export async function cleanupArtifactGenerations(ctx:ArtifactCleanupContext,limit:number):Promise<{processed:number;deleted:number;held:number}>{
 const now=ctx.workspace.clock.nowMs();bounds(now,limit);
 const ids=withTransaction(ctx.workspace.storage,tx=>{currentConfiguration(tx,ctx.workspace,ctx.admission);return tx.all<{id:string}>('SELECT id FROM artifact_generations WHERE workspace_id=? AND cleanup_next_at IS NOT NULL AND cleanup_next_at<=? ORDER BY cleanup_next_at,id LIMIT ?',[ctx.workspace.workspaceId,now,limit]);});
 let deleted=0,held=0;
 for(const {id} of ids){
  const operationId='delete_'+Array.from(ctx.workspace.entropy.bytes(24),b=>b.toString(16).padStart(2,'0')).join('');
  const reserved=withTransaction(ctx.workspace.storage,tx=>reserveDelete(tx,ctx,id,operationId,ctx.workspace.clock.nowMs()));
  if(!reserved){held++;continue;}
  const g=reserved.generation;
  withTransaction(ctx.workspace.storage,tx=>{currentConfiguration(tx,ctx.workspace,reserved.fence);const row=artifactRecord(tx,g.workspace_id,g.artifact_id);if(row.status!=='expired'&&row.status!=='committed'||row.committed_generation_id===g.id||row.status==='committed'&&row.active_generation_id===g.id)throw Error('ARTIFACT_EXCLUSION_CONFLICT');
   tx.exec(`UPDATE artifact_generations SET effect_state='in_flight',effect_started_at=?,updated_at=? WHERE workspace_id=? AND id=? AND state='tombstoned' AND effect_kind='delete' AND effect_state='reserved' AND effect_operation_id=? AND delete_admission_epoch=? AND delete_admission_generation=?`,[ctx.workspace.clock.nowMs(),ctx.workspace.clock.nowMs(),g.workspace_id,g.id,g.effect_operation_id,reserved.fence.authorityEpoch,reserved.fence.maintenanceGeneration]);
   const current=generationRecord(tx,g.workspace_id,g.artifact_id,g.id);if(current.effect_operation_id!==g.effect_operation_id||current.effect_state!=='in_flight')throw Error('ARTIFACT_EFFECT_CONFLICT');});
  // No await between dispatch CAS and invocation. Maintenance sees this durable in-flight effect.
  try{await ctx.bucket.delete(g.object_key);}catch{settleArtifactDelete(ctx.workspace.storage,g,ctx.workspace.clock.nowMs(),'uncertain');held++;continue;}
  settleArtifactDelete(ctx.workspace.storage,g,ctx.workspace.clock.nowMs(),'drained');deleted++;
 }
 return {processed:ids.length,deleted,held};
}
interface InventoryRow {workspace_id:string;cursor:string|null;generation:number;next_due_at:number;observed_objects:number;orphan_observations:number;}
export function ensureArtifactInventory(tx:WorkspaceTransaction,workspaceId:string,nowMs:number):void {
 bounds(nowMs,1);if(installedWorkspace(tx)!==workspaceId)throw Error('WORKSPACE_IDENTITY_MISMATCH');
 tx.exec('INSERT OR IGNORE INTO artifact_inventory_state(id,workspace_id,next_due_at) VALUES(1,?,?)',[workspaceId,nowMs]);
 if(tx.one<{workspace_id:string}>('SELECT workspace_id FROM artifact_inventory_state WHERE id=1')?.workspace_id!==workspaceId)throw Error('WORKSPACE_IDENTITY_MISMATCH');
}
/** One server-owned prefix page; unknown objects are observations, never deletion authority. */
export async function reconcileArtifactObjects(ctx:ArtifactCleanupContext,limit:number):Promise<{nextCursor:string|null;orphans:number;observed:number}>{
 const now=ctx.workspace.clock.nowMs();bounds(now,limit);
 const reserved=withTransaction(ctx.workspace.storage,tx=>{
  const {fence}=currentConfiguration(tx,ctx.workspace,ctx.admission);ensureArtifactInventory(tx,ctx.workspace.workspaceId,now);
  const row=tx.one<InventoryRow>('SELECT * FROM artifact_inventory_state WHERE id=1')!;
  if(row.generation===Number.MAX_SAFE_INTEGER)throw Error('INVENTORY_GENERATION_EXHAUSTED');
  tx.exec('UPDATE artifact_inventory_state SET generation=generation+1 WHERE id=1');markSchedulerDirty(tx);return {row:{...row,generation:row.generation+1},fence};
 });
 const prefix='artifacts/'+encodeURIComponent(ctx.workspace.workspaceId)+'/';
 let listed:R2Objects;
 try{listed=await ctx.bucket.list({prefix,limit,...(reserved.row.cursor===null?{}:{cursor:reserved.row.cursor})});}
 catch(error){inventoryFailure(ctx,reserved,'INVENTORY_FAILED');throw error;}
 const nextCursor=listed.truncated?listed.cursor:null;
 if(listed.objects.length>limit||listed.objects.some(o=>!o.key.startsWith(prefix))||listed.truncated&&(typeof nextCursor!=='string'||!nextCursor||new TextEncoder().encode(nextCursor).byteLength>4096||nextCursor===reserved.row.cursor)){
  inventoryFailure(ctx,reserved,'INVENTORY_INVALID');throw Error('INVENTORY_INVALID');
 }
 return withTransaction(ctx.workspace.storage,tx=>{
  currentConfiguration(tx,ctx.workspace,reserved.fence);const current=tx.one<InventoryRow>('SELECT * FROM artifact_inventory_state WHERE id=1');
  if(!current||current.workspace_id!==ctx.workspace.workspaceId||current.generation!==reserved.row.generation||current.cursor!==reserved.row.cursor)throw Error('INVENTORY_STALE');
  let orphans=0;
  for(const object of listed.objects){
   const row=tx.one<{state:string;status:string;id:string;committed_generation_id:string|null}>(`SELECT g.id,g.state,a.status,a.committed_generation_id FROM artifact_generations g JOIN artifacts a ON a.workspace_id=g.workspace_id AND a.id=g.artifact_id WHERE g.workspace_id=? AND g.object_key=?`,[ctx.workspace.workspaceId,object.key]);
   if(!row||row.state!=='committed'&&row.committed_generation_id!==row.id&&(row.status==='expired'||row.status==='committed'||row.state==='tombstoned'))orphans++;
  }
  const at=ctx.workspace.clock.nowMs();bounds(at,limit);
  tx.exec('UPDATE artifact_inventory_state SET cursor=?,next_due_at=?,last_scan_at=?,observed_objects=?,orphan_observations=?,last_error_code=NULL WHERE id=1',[nextCursor??null,later(at,listed.truncated?1:300000),at,Math.min(Number.MAX_SAFE_INTEGER,current.observed_objects+listed.objects.length),Math.min(Number.MAX_SAFE_INTEGER,current.orphan_observations+orphans)]);markSchedulerDirty(tx);
  return {nextCursor:nextCursor??null,orphans,observed:listed.objects.length};
 });
}
function inventoryFailure(ctx:ArtifactCleanupContext,reserved:{row:InventoryRow;fence:AdmissionFence},code:'INVENTORY_FAILED'|'INVENTORY_INVALID'):void {
 try{withTransaction(ctx.workspace.storage,tx=>{currentConfiguration(tx,ctx.workspace,reserved.fence);tx.exec('UPDATE artifact_inventory_state SET last_error_code=?,next_due_at=? WHERE id=1 AND workspace_id=? AND generation=? AND cursor IS ?',[code,later(ctx.workspace.clock.nowMs()),ctx.workspace.workspaceId,reserved.row.generation,reserved.row.cursor]);markSchedulerDirty(tx);});}catch{/* A stale read has no authority to modify frozen diagnostics. */}
}
