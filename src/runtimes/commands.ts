import type {WorkspaceTransaction} from '../storage/transaction';
import type {CommandContext} from '../workspace/context';
import type {CommandDescriptor} from '../workspace/commands';
import type {Runtime,RuntimeIssue,RuntimeCreateRequest,RuntimeHeartbeatRequest} from '../http/dto';
import {refreshActor,authorize} from '../auth/authorize';
import {deny} from '../auth/context';
import {currentRuntime,requireRuntimeProof,runtimeView,type RuntimeRow} from '../auth/runtime-proof';
import {validateRuntimeIssue,validateRuntime,validateRuntimeCreateRequest,validateRuntimeHeartbeatRequest} from '../http/generated/auth-validators.js';
import {HttpError} from '../http/envelopes';
export interface PreparedRuntime {runtimeId:string;proofSha256:string;}
function runtimeActor(tx:WorkspaceTransaction,ctx:CommandContext){
 const actor=refreshActor(tx,ctx.actor,ctx.nowMs);if(actor.kind!=='agent'||!actor.credentialId)deny();
 authorize(tx,actor,'runtimes:manage',undefined,ctx.nowMs);return actor;
}
export function enrollRuntime(tx:WorkspaceTransaction,ctx:CommandContext,request:RuntimeCreateRequest,prepared:PreparedRuntime):RuntimeIssue{
 const actor=runtimeActor(tx,ctx);if(!validateRuntimeCreateRequest(request))throw new HttpError('INVALID_REQUEST',400);
 if(!prepared||!/^[a-zA-Z0-9_-]{1,128}$/.test(prepared.runtimeId)||!/^[a-f0-9]{64}$/.test(prepared.proofSha256))throw new HttpError('INTERNAL_ERROR',500);
 const epoch=tx.one<{config_epoch:number}>('SELECT config_epoch FROM workspace_metadata WHERE workspace_id=?',[actor.workspaceId])!.config_epoch;
 if(tx.one('SELECT id FROM runtimes WHERE id=? OR proof_sha256=?',[prepared.runtimeId,prepared.proofSha256]))throw new HttpError('INVALID_STATE',409);
 const row:RuntimeRow={id:prepared.runtimeId,workspace_id:actor.workspaceId,agent_id:actor.agentId!,credential_id:actor.credentialId!,authority_epoch:epoch,proof_sha256:prepared.proofSha256,runtime_version:1,label:request.label,status:'online',created_at:ctx.nowMs,last_seen_at:ctx.nowMs,presence_expires_at:ctx.nowMs+90000,revoked_at:null};
 tx.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at,revoked_at) VALUES(?,?,?,?,?,?,1,?,'online',?,?,?,NULL)",[row.id,row.workspace_id,row.agent_id,row.credential_id,row.authority_epoch,row.proof_sha256,row.label,row.created_at,row.last_seen_at,row.presence_expires_at]);
 return {runtime:runtimeView(row),runtime_token:null,revealed:false};
}
export function heartbeatRuntime(tx:WorkspaceTransaction,ctx:CommandContext,id:string,request:RuntimeHeartbeatRequest,proofHash:string):Runtime{
 runtimeActor(tx,ctx);if(!validateRuntimeHeartbeatRequest(request))throw new HttpError('INVALID_REQUEST',400);
 const verified=requireRuntimeProof(tx,ctx,id,proofHash),version=verified.runtime.runtime_version;
 if(version!==request.expected_runtime_version)throw new HttpError('VERSION_CONFLICT',409,{current_version:version});
 if(!Number.isSafeInteger(version)||version>=Number.MAX_SAFE_INTEGER)throw new HttpError('LIMIT_EXCEEDED',409);
 tx.exec('UPDATE runtimes SET runtime_version=?,last_seen_at=?,presence_expires_at=? WHERE workspace_id=? AND id=?',[version+1,ctx.nowMs,ctx.nowMs+90000,ctx.actor.workspaceId,id]);
 return runtimeView(currentRuntime(tx,ctx,id));
}
export function createRuntimeCommand(prepared:PreparedRuntime):CommandDescriptor<RuntimeCreateRequest,RuntimeIssue>{return {
 operation:'runtimes:manage',target:'runtimes:create',resource:()=>undefined,
 checkAccess(tx,ctx){runtimeActor(tx,ctx);},
 checkReplay(tx,ctx,_body,outcome){
  if(!validateRuntimeIssue(outcome.data)||outcome.data.runtime_token!==null||outcome.data.revealed)throw new HttpError('INTERNAL_ERROR',500);
  const row=currentRuntime(tx,ctx,outcome.data.runtime.id);
  if(outcome.data.runtime.workspace_id!==row.workspace_id||outcome.data.runtime.agent_id!==row.agent_id)throw new HttpError('INTERNAL_ERROR',500);
 },
 execute(tx,ctx,body){const data=enrollRuntime(tx,ctx,body,prepared);return {outcome:{status:201,data},event:{type:'runtime.enrolled',resourceType:'runtime',resourceId:data.runtime.id,resourceVersion:null,threadId:null}};}
};}
export function heartbeatRuntimeCommand(id:string,proofHash:string):CommandDescriptor<RuntimeHeartbeatRequest,Runtime>{return {
 operation:'runtimes:manage',target:'runtimes:'+id+':heartbeat',resource:()=>undefined,
 checkAccess(tx,ctx){runtimeActor(tx,ctx);requireRuntimeProof(tx,ctx,id,proofHash);},
 checkReplay(_tx,ctx,_body,outcome){if(!validateRuntime(outcome.data)||outcome.data.id!==id||outcome.data.workspace_id!==ctx.actor.workspaceId||outcome.data.agent_id!==ctx.actor.agentId)throw new HttpError('INTERNAL_ERROR',500);},
 execute(tx,ctx,body){const data=heartbeatRuntime(tx,ctx,id,body,proofHash);return {outcome:{status:200,data},event:{type:'runtime.heartbeat',resourceType:'runtime',resourceId:id,resourceVersion:null,threadId:null}};}
};}
