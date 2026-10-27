import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext,CommandContext} from '../workspace/context';
import type {Agent,AgentCreateRequest,AgentPatchRequest,AgentArchiveRequest} from '../http/dto';
import type {CommandDescriptor} from '../workspace/commands';
import {refreshActor,authorize} from '../auth/authorize';
import {settingsPolicy} from '../config/policy';
import {storedProfile} from '../config/profile';
import {canonicalJson} from '../config/bootstrap';
import {HttpError} from '../http/envelopes';
import {validateAgent,validateAgentCreateRequest,validateAgentPatchRequest,validateAgentArchiveRequest} from '../http/generated/auth-validators.js';
export interface AgentRow {agent_id:string;workspace_id:string;display_name:string;config_epoch:number;origin:'operator_static'|'human_managed';agent_version:number;description:string;work_role_ids_json:string;framework:string|null;model:string|null;status:'active'|'archived';created_at:number;updated_at:number;}
export function agentView(row:AgentRow):Agent{
 const result:Agent={id:row.agent_id,workspace_id:row.workspace_id,agent_version:row.agent_version,display_name:row.display_name,description:row.description,work_role_ids:JSON.parse(row.work_role_ids_json) as string[],framework:row.framework,model:row.model,status:row.status,created_at:new Date(row.created_at).toISOString(),updated_at:new Date(row.updated_at).toISOString()};
 if(!validateAgent(result))throw new HttpError('INTERNAL_ERROR',500);return result;
}
export function agentRecord(tx:WorkspaceTransaction,workspaceId:string,id:string):AgentRow{
 const row=tx.one<AgentRow>('SELECT * FROM static_agents WHERE workspace_id=? AND agent_id=?',[workspaceId,id]);
 if(!row)throw new HttpError('NOT_FOUND',404);return row;
}
/** Agent identities have no project association. Work roles are never grants. */
export function agentAccess(tx:WorkspaceTransaction,actor:ActorContext,operation:'agents:read'|'agents:manage',nowMs:number):ActorContext{
 const live=refreshActor(tx,actor,nowMs);authorize(tx,live,operation,undefined,nowMs);settingsPolicy(tx,live);
 if(live.projectIds!==null||operation==='agents:manage'&&(live.kind!=='human'||!live.sessionId))throw new HttpError('FORBIDDEN',403);return live;
}
function roles(tx:WorkspaceTransaction,actor:ActorContext,ids:readonly string[]):void{
 const known=storedProfile(tx,actor).profile.work_roles;
 if(new Set(ids).size!==ids.length)throw new HttpError('INVALID_REQUEST',400);
 if(ids.some(id=>!known.some(role=>role.id===id&&!role.archived)))throw new HttpError('NOT_FOUND',404);
}
function nextVersion(version:number):number{if(!Number.isSafeInteger(version)||version>=Number.MAX_SAFE_INTEGER)throw new HttpError('LIMIT_EXCEEDED',409);return version+1;}
function mutable(row:AgentRow,expected:number):void{
 if(row.agent_version!==expected)throw new HttpError('VERSION_CONFLICT',409,{current_version:row.agent_version});
 if(row.status!=='active')throw new HttpError('INVALID_STATE',409);
}
export function getAgent(tx:WorkspaceTransaction,actor:ActorContext,id:string,nowMs:number):Agent{const live=agentAccess(tx,actor,'agents:read',nowMs);return agentView(agentRecord(tx,live.workspaceId,id));}
export function createAgent(tx:WorkspaceTransaction,ctx:CommandContext&{agentId?:string},request:AgentCreateRequest):Agent{
 const actor=agentAccess(tx,ctx.actor,'agents:manage',ctx.nowMs);
 if(!validateAgentCreateRequest(request))throw new HttpError('INVALID_REQUEST',400);
 if(!ctx.agentId||!/^[a-zA-Z0-9_-]{1,128}$/.test(ctx.agentId))throw new HttpError('INTERNAL_ERROR',500);
 roles(tx,actor,request.work_role_ids);const {epoch}=settingsPolicy(tx,actor);
 if(tx.one('SELECT agent_id FROM static_agents WHERE agent_id=?',[ctx.agentId]))throw new HttpError('INVALID_STATE',409);
 tx.exec("INSERT INTO static_agents(agent_id,workspace_id,display_name,config_epoch,origin,agent_version,description,work_role_ids_json,framework,model,status,created_at,updated_at) VALUES(?,?,?,?,'human_managed',1,?,?,?,?,'active',?,?)",[ctx.agentId,actor.workspaceId,request.display_name,epoch,request.description,canonicalJson(request.work_role_ids),request.framework??null,request.model??null,ctx.nowMs,ctx.nowMs]);
 return agentView(agentRecord(tx,actor.workspaceId,ctx.agentId));
}
export function patchAgent(tx:WorkspaceTransaction,ctx:CommandContext,id:string,request:AgentPatchRequest):Agent{
 const actor=agentAccess(tx,ctx.actor,'agents:manage',ctx.nowMs);
 if(!validateAgentPatchRequest(request))throw new HttpError('INVALID_REQUEST',400);
 const row=agentRecord(tx,actor.workspaceId,id);mutable(row,request.expected_agent_version);if(request.work_role_ids)roles(tx,actor,request.work_role_ids);
 tx.exec('UPDATE static_agents SET display_name=?,description=?,work_role_ids_json=?,framework=?,model=?,agent_version=?,updated_at=? WHERE workspace_id=? AND agent_id=?',[request.display_name??row.display_name,request.description??row.description,request.work_role_ids?canonicalJson(request.work_role_ids):row.work_role_ids_json,request.framework===undefined?row.framework:request.framework,request.model===undefined?row.model:request.model,nextVersion(row.agent_version),ctx.nowMs,actor.workspaceId,id]);
 return agentView(agentRecord(tx,actor.workspaceId,id));
}
export function archiveAgent(tx:WorkspaceTransaction,ctx:CommandContext,id:string,request:AgentArchiveRequest):Agent{
 const actor=agentAccess(tx,ctx.actor,'agents:manage',ctx.nowMs);
 if(!validateAgentArchiveRequest(request))throw new HttpError('INVALID_REQUEST',400);
 const row=agentRecord(tx,actor.workspaceId,id);mutable(row,request.expected_agent_version);
 if(tx.one("SELECT id FROM runs WHERE workspace_id=? AND agent_id=? AND status='active' LIMIT 1",[actor.workspaceId,id])||tx.one("SELECT id FROM tasks WHERE workspace_id=? AND assigned_agent_id=? AND state NOT IN ('done','cancelled') LIMIT 1",[actor.workspaceId,id]))throw new HttpError('INVALID_STATE',409);
 if(tx.one('SELECT credential_id FROM native_credentials WHERE workspace_id=? AND agent_id=? AND revoked_at IS NULL AND credential_version>=? LIMIT 1',[actor.workspaceId,id,Number.MAX_SAFE_INTEGER])||tx.one('SELECT id FROM runtimes WHERE workspace_id=? AND agent_id=? AND revoked_at IS NULL AND runtime_version>=? LIMIT 1',[actor.workspaceId,id,Number.MAX_SAFE_INTEGER]))throw new HttpError('LIMIT_EXCEEDED',409);
 tx.exec("UPDATE static_agents SET status='archived',agent_version=?,updated_at=? WHERE workspace_id=? AND agent_id=?",[nextVersion(row.agent_version),ctx.nowMs,actor.workspaceId,id]);
 tx.exec('UPDATE native_credentials SET enabled=0,revoked_at=?,credential_version=credential_version+1 WHERE workspace_id=? AND agent_id=? AND revoked_at IS NULL',[ctx.nowMs,actor.workspaceId,id]);
 tx.exec("UPDATE runtimes SET revoked_at=?,status='expired',runtime_version=runtime_version+1 WHERE workspace_id=? AND agent_id=? AND revoked_at IS NULL",[ctx.nowMs,actor.workspaceId,id]);
 return agentView(agentRecord(tx,actor.workspaceId,id));
}
function command<B>(target:string,type:'agent.created'|'agent.updated'|'agent.archived',run:(tx:WorkspaceTransaction,ctx:CommandContext,body:B)=>Agent):CommandDescriptor<B,Agent>{return {
 operation:'agents:manage',target,resource:()=>undefined,
 checkAccess(tx,ctx){agentAccess(tx,ctx.actor,'agents:manage',ctx.nowMs);},
 checkReplay(tx,ctx,_body,outcome){const actor=agentAccess(tx,ctx.actor,'agents:manage',ctx.nowMs);agentRecord(tx,actor.workspaceId,outcome.data.id);if(!validateAgent(outcome.data)||outcome.data.workspace_id!==actor.workspaceId)throw new HttpError('INTERNAL_ERROR',500);},
 execute(tx,ctx,body){const data=run(tx,ctx,body);return {outcome:{status:type==='agent.created'?201:200,data},event:{type,resourceType:'agent',resourceId:data.id,resourceVersion:null,threadId:null}};}
};}
export const createAgentCommand=(agentId:string)=>command<AgentCreateRequest>('agents:create','agent.created',(tx,ctx,body)=>createAgent(tx,{...ctx,agentId},body));
export const patchAgentCommand=(id:string)=>command<AgentPatchRequest>('agents:'+id+':patch','agent.updated',(tx,ctx,body)=>patchAgent(tx,ctx,id,body));
export const archiveAgentCommand=(id:string)=>command<AgentArchiveRequest>('agents:'+id+':archive','agent.archived',(tx,ctx,body)=>archiveAgent(tx,ctx,id,body));
