import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext,CommandContext} from '../workspace/context';
import type {Artifact} from '../http/dto';
import {validateArtifact} from '../http/generated/auth-validators.js';
import {refreshActor} from '../auth/authorize';
import {HttpError} from '../http/envelopes';
import {taskRecord} from '../tasks/repository';
import {assertMessageVisible} from '../messages/references';
import {assertStoredScalarBytes,assertTaskItemFits} from '../tasks/bounds';
export const ARTIFACT_MAX_BYTES=10485760;
export const ATTACHMENT_MAX_BYTES=26214400;
export interface ArtifactRow {id:string;workspace_id:string;task_id:string|null;run_id:string|null;owner_kind:'human'|'agent'|'system';owner_principal_id:string;owner_agent_id:string|null;creator_credential_id:string|null;creator_runtime_id:string|null;authority_epoch:number;admission_generation:number|null;artifact_version:number;filename:string;media_type:string;byte_size:number;sha256:string;status:Artifact['status'];active_generation_id:string|null;committed_generation_id:string|null;created_at:number;committed_at:number|null;expires_at:number|null;}
export interface GenerationRow {id:string;workspace_id:string;artifact_id:string;object_key:string;expected_sha256:string;expected_byte_size:number;observed_sha256:string|null;observed_byte_size:number|null;state:'reserved'|'uploaded'|'committed'|'tombstoned';admission_epoch:number;admission_generation:number;expires_at:number;created_at:number;updated_at:number;effect_operation_id:string|null;effect_kind:'put'|'delete'|null;effect_state:'none'|'reserved'|'in_flight'|'drained'|'uncertain';effect_started_at:number|null;effect_drained_at:number|null;artifact_version:number|null;upload_idempotency_sha256:string|null;cleanup_next_at:number|null;cleanup_error_code:string|null;delete_admission_epoch:number|null;delete_admission_generation:number|null;}
const inaccessible=():never=>{throw new HttpError('NOT_FOUND',404);};
const scalarNames=['id','workspace_id','task_id','run_id','owner_kind','owner_principal_id','owner_agent_id','creator_credential_id','creator_runtime_id','filename','media_type','sha256','active_generation_id','committed_generation_id'];
export function artifactRecord(tx:WorkspaceTransaction,workspaceId:string,id:string):ArtifactRow{
 const size=tx.one<{bytes:number}>(`SELECT ${scalarNames.map(c=>`coalesce(length(CAST(${c} AS BLOB)),0)`).join('+')} AS bytes FROM artifacts WHERE workspace_id=? AND id=?`,[workspaceId,id]);if(!size)inaccessible();assertStoredScalarBytes(size!.bytes);
 return tx.one<ArtifactRow>('SELECT * FROM artifacts WHERE workspace_id=? AND id=?',[workspaceId,id])!;
}
export function generationRecord(tx:WorkspaceTransaction,workspaceId:string,artifactId:string,id:string):GenerationRow{
 const row=tx.one<GenerationRow>('SELECT * FROM artifact_generations WHERE workspace_id=? AND artifact_id=? AND id=?',[workspaceId,artifactId,id]);if(!row)inaccessible();return row!;
}
export function artifactView(row:ArtifactRow):Artifact{
 const result:Artifact={id:row.id,workspace_id:row.workspace_id,task_id:row.task_id,run_id:row.run_id,owner:{kind:row.owner_kind,principal_id:row.owner_principal_id,agent_id:row.owner_agent_id},artifact_version:row.artifact_version,filename:row.filename,media_type:row.media_type,byte_size:row.byte_size,sha256:row.sha256,status:row.status,created_at:new Date(row.created_at).toISOString(),committed_at:row.committed_at===null?null:new Date(row.committed_at).toISOString(),expires_at:row.expires_at===null?null:new Date(row.expires_at).toISOString()};
 if(!validateArtifact(result))throw new HttpError('INTERNAL_ERROR',500);assertTaskItemFits(result);return result;
}
export function artifactActor(tx:WorkspaceTransaction,ctx:Pick<CommandContext,'actor'|'nowMs'>,scope:string):ActorContext{
 const actor=refreshActor(tx,ctx.actor,ctx.nowMs);if(!actor.scopes.has(scope))throw new HttpError('FORBIDDEN',403);return actor;
}
function taskRelationship(tx:WorkspaceTransaction,actor:ActorContext,id:string):void{
 if(!actor.scopes.has('tasks:read'))inaccessible();const row=taskRecord(tx,actor.workspaceId,id);
 if(actor.projectIds!==null&&(row.project_id===null||!actor.projectIds.includes(row.project_id)))inaccessible();
}
/** Association checks use one current grant, never aggregate multiple credentials or follow cycles. */
export function assertArtifactAssociations(tx:WorkspaceTransaction,actor:ActorContext,row:ArtifactRow,nowMs:number):void{
 if(row.workspace_id!==actor.workspaceId)inaccessible();
 if(row.task_id!==null)taskRelationship(tx,actor,row.task_id);else if(actor.projectIds!==null)inaccessible();
 const associations=tx.all<{resource_kind:string;resource_id:string}>('SELECT resource_kind,resource_id FROM artifact_associations WHERE workspace_id=? AND artifact_id=? LIMIT 2049',[actor.workspaceId,row.id]);
 if(associations.length>2048)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 for(const [kind,id] of [['task',row.task_id],['run',row.run_id]])if(id!==null&&!associations.some(x=>x.resource_kind===kind&&x.resource_id===id))inaccessible();
 for(const a of associations){
  if(a.resource_kind==='task'){taskRelationship(tx,actor,a.resource_id);continue;}
  if(a.resource_kind==='run'){const run=tx.one<{task_id:string}>('SELECT task_id FROM runs WHERE workspace_id=? AND id=?',[actor.workspaceId,a.resource_id]);if(!run||row.run_id===a.resource_id&&run.task_id!==row.task_id)inaccessible();taskRelationship(tx,actor,run!.task_id);continue;}
  if(a.resource_kind==='result'){const result=tx.one<{task_id:string}>('SELECT r.task_id FROM task_results r JOIN result_artifacts ra ON ra.workspace_id=r.workspace_id AND ra.result_id=r.id WHERE r.workspace_id=? AND r.id=? AND ra.artifact_id=?',[actor.workspaceId,a.resource_id,row.id]);if(!result)inaccessible();taskRelationship(tx,actor,result!.task_id);continue;}
  if(a.resource_kind==='message'){if(!tx.one('SELECT message_id FROM message_artifacts WHERE workspace_id=? AND message_id=? AND artifact_id=?',[actor.workspaceId,a.resource_id,row.id]))inaccessible();assertMessageVisible(tx,actor,a.resource_id,nowMs);continue;}
  // Checkpoints have no reviewed runtime in this round.
  inaccessible();
 }
}
export function committedGeneration(tx:WorkspaceTransaction,row:ArtifactRow):GenerationRow{
 if(row.status!=='committed'||row.committed_at===null||row.expires_at!==null||row.committed_generation_id===null||(row.active_generation_id!==null&&row.active_generation_id!==row.committed_generation_id))inaccessible();
 const g=generationRecord(tx,row.workspace_id,row.id,row.committed_generation_id!);
 if(g.state!=='committed'||g.expected_sha256!==row.sha256||g.observed_sha256!==row.sha256||g.expected_byte_size!==row.byte_size||g.observed_byte_size!==row.byte_size)inaccessible();return g;
}
export function authorizeArtifactRead(tx:WorkspaceTransaction,ctx:Pick<CommandContext,'actor'|'nowMs'>,id:string):{artifact:Artifact;objectKey:string}{
 const actor=artifactActor(tx,ctx,'artifacts:read'),row=artifactRecord(tx,actor.workspaceId,id),generation=committedGeneration(tx,row);assertArtifactAssociations(tx,actor,row,ctx.nowMs);return {artifact:artifactView(row),objectKey:generation.object_key};
}
export function getArtifact(tx:WorkspaceTransaction,ctx:Pick<CommandContext,'actor'|'nowMs'>,id:string):Artifact{
 const actor=artifactActor(tx,ctx,'artifacts:read'),row=artifactRecord(tx,actor.workspaceId,id);
 if(row.status==='committed')committedGeneration(tx,row);else if(row.owner_kind!==actor.kind||row.owner_principal_id!==actor.principalId||row.owner_agent_id!==actor.agentId)inaccessible();
 assertArtifactAssociations(tx,actor,row,ctx.nowMs);return artifactView(row);
}
export function assertCommittedArtifacts(tx:WorkspaceTransaction,ctx:Pick<CommandContext,'actor'|'nowMs'>,ids:readonly string[]):Artifact[]{
 if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)throw new HttpError('INVALID_REQUEST',400);
 if(ids.length>5||new TextEncoder().encode(JSON.stringify(ids)).byteLength>8192)throw new HttpError('LIMIT_EXCEEDED',413);
 const result=ids.map(id=>authorizeArtifactRead(tx,ctx,id).artifact);if(result.reduce((n,a)=>n+a.byte_size,0)>ATTACHMENT_MAX_BYTES)throw new HttpError('LIMIT_EXCEEDED',413);return result;
}
