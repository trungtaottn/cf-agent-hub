import type {CommandDescriptor} from '../workspace/commands';
import type {CommandContext} from '../workspace/context';
import type {WorkspaceTransaction} from '../storage/transaction';
import type {ArtifactStageRequest,Artifact} from '../http/dto';
import {validateArtifactStageRequest,validateArtifact} from '../http/generated/auth-validators.js';
import {requireRuntimeProof,currentRuntime,type VerifiedRuntime} from '../auth/runtime-proof';
import {deny} from '../auth/context';
import {readAdmissionFence} from '../recovery/maintenance';
import {installedExecutionPolicy} from '../config/execution-policy';
import {taskRecord} from '../tasks/repository';
import {assertActiveRun,runRecord} from '../tasks/lease';
import {markSchedulerDirty} from '../outbox/scheduler-state';
import {HttpError} from '../http/envelopes';
import {artifactActor,artifactRecord,artifactView,assertArtifactAssociations,type ArtifactRow} from './repository';
export function artifactProof(tx:WorkspaceTransaction,ctx:CommandContext,runtimeId:string|null,proofHash:string|null):VerifiedRuntime|null{
 if(ctx.actor.kind==='human'){if(runtimeId!==null||proofHash!==null)deny();return null;}
 if(!runtimeId||!proofHash)deny();return requireRuntimeProof(tx,ctx,runtimeId!,proofHash!);
}
function verifyRuntime(tx:WorkspaceTransaction,ctx:CommandContext,verified:VerifiedRuntime|null):void{
 if(ctx.actor.kind==='human'){if(verified!==null)deny();return;}
 if(!verified)deny();const row=currentRuntime(tx,ctx,verified!.runtime.id);
 if(verified!.credentialId!==ctx.actor.credentialId||verified!.authorityEpoch!==row.authority_epoch||verified!.runtime.agent_id!==ctx.actor.agentId||verified!.runtime.workspace_id!==ctx.actor.workspaceId)deny();
}
export function assertArtifactOwner(tx:WorkspaceTransaction,ctx:CommandContext,row:ArtifactRow,verified:VerifiedRuntime|null):void{
 const actor=artifactActor(tx,ctx,'artifacts:write');
 if(row.workspace_id!==actor.workspaceId||row.owner_kind!==actor.kind||row.owner_principal_id!==actor.principalId||row.owner_agent_id!==actor.agentId)throw new HttpError('NOT_FOUND',404);
 verifyRuntime(tx,{...ctx,actor},verified);
 if(row.creator_credential_id!==actor.credentialId||row.creator_runtime_id!==(verified?.runtime.id??null)||row.authority_epoch!==readAdmissionFence(tx).authorityEpoch)deny();
 assertArtifactAssociations(tx,actor,row,ctx.nowMs);
}
export function assertArtifactWritable(tx:WorkspaceTransaction,ctx:CommandContext,row:ArtifactRow,verified:VerifiedRuntime|null):void{
 assertArtifactOwner(tx,ctx,row,verified);const fence=readAdmissionFence(tx);
 if(row.admission_generation===null||row.admission_generation!==fence.maintenanceGeneration)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 if(!['staged','uploaded'].includes(row.status)||row.expires_at===null||ctx.nowMs>=row.expires_at)throw new HttpError('INVALID_STATE',409);
 if(row.run_id!==null){if(!verified||row.task_id===null)deny();const run=runRecord(tx,row.workspace_id,row.run_id);assertActiveRun(tx,ctx,row.task_id!,row.run_id,run.fence,verified!);}
}
export function nextArtifactVersion(version:number):number{if(!Number.isSafeInteger(version)||version<1||version>=Number.MAX_SAFE_INTEGER)throw new HttpError('LIMIT_EXCEEDED',409);return version+1;}
export function stageArtifact(tx:WorkspaceTransaction,ctx:CommandContext&{artifactId:string},input:ArtifactStageRequest,verified:VerifiedRuntime|null):Artifact{
 if(!validateArtifactStageRequest(input)||input.run_id!==null&&input.task_id===null)throw new HttpError('INVALID_REQUEST',400);
 if(new TextEncoder().encode(JSON.stringify(input)).byteLength>65536)throw new HttpError('LIMIT_EXCEEDED',413);
 const actor=artifactActor(tx,ctx,'artifacts:write');verifyRuntime(tx,{...ctx,actor},verified);
 if(input.task_id===null&&actor.projectIds!==null)throw new HttpError('FORBIDDEN',403);
 if(input.task_id!==null){const task=taskRecord(tx,actor.workspaceId,input.task_id);if(!actor.scopes.has('tasks:read')||actor.projectIds!==null&&(task.project_id===null||!actor.projectIds.includes(task.project_id)))throw new HttpError('FORBIDDEN',403);}
 if(input.run_id!==null){if(!verified||actor.kind!=='agent')deny();const run=runRecord(tx,actor.workspaceId,input.run_id);assertActiveRun(tx,ctx,input.task_id!,input.run_id,run.fence,verified!);}
 const policy=installedExecutionPolicy(tx,actor),fence=readAdmissionFence(tx),expires=ctx.nowMs+policy.artifact_upload_ttl_seconds*1000;
 if(!Number.isSafeInteger(expires)||!ctx.artifactId)throw new HttpError('INVALID_REQUEST',400);
 tx.exec(`INSERT INTO artifacts(id,workspace_id,task_id,run_id,owner_kind,owner_principal_id,owner_agent_id,creator_credential_id,creator_runtime_id,authority_epoch,admission_generation,artifact_version,filename,media_type,byte_size,sha256,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,'staged',?,?)`,[ctx.artifactId,actor.workspaceId,input.task_id,input.run_id,actor.kind,actor.principalId,actor.agentId,actor.credentialId,verified?.runtime.id??null,fence.authorityEpoch,fence.maintenanceGeneration,input.filename,input.media_type,input.byte_size,input.sha256,ctx.nowMs,expires]);
 for(const [kind,id]of [['task',input.task_id],['run',input.run_id]])if(id!==null)tx.exec('INSERT INTO artifact_associations(workspace_id,artifact_id,resource_kind,resource_id) VALUES(?,?,?,?)',[actor.workspaceId,ctx.artifactId,kind,id]);
 markSchedulerDirty(tx);return artifactView(artifactRecord(tx,actor.workspaceId,ctx.artifactId));
}
export function assertArtifactOutcome(tx:WorkspaceTransaction,ctx:CommandContext,data:Artifact,verified:VerifiedRuntime|null):void{
 if(!validateArtifact(data)||data.workspace_id!==ctx.actor.workspaceId)throw new HttpError('INTERNAL_ERROR',500);
 const row=artifactRecord(tx,ctx.actor.workspaceId,data.id);assertArtifactOwner(tx,ctx,row,verified);
 if(data.task_id!==row.task_id||data.run_id!==row.run_id||data.sha256!==row.sha256||data.byte_size!==row.byte_size||data.filename!==row.filename||data.media_type!==row.media_type)throw new HttpError('INTERNAL_ERROR',500);
}
export function stageArtifactCommand(id:string,runtimeId:string|null,proofHash:string|null):CommandDescriptor<ArtifactStageRequest,Artifact>{
 const proof=(tx:WorkspaceTransaction,ctx:CommandContext)=>artifactProof(tx,ctx,runtimeId,proofHash);
 return {operation:'artifacts:write',target:'artifacts:stage',resource(){return undefined;},checkAccess(tx,ctx){artifactActor(tx,ctx,'artifacts:write');proof(tx,ctx);},checkReplay(tx,ctx,_body,outcome){assertArtifactOutcome(tx,ctx,outcome.data,proof(tx,ctx));},execute(tx,ctx,body){const data=stageArtifact(tx,{...ctx,artifactId:id},body,proof(tx,ctx));return {outcome:{status:201,data},event:{type:'artifact.staged',resourceType:'artifact',resourceId:data.id,resourceVersion:null,threadId:null}};}};
}
