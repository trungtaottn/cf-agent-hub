import type {ExecutionPolicy} from './generated/validators.js';
import {parseExecutionPolicy} from './execution-policy-validation.ts';
import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext,CommandContext} from '../workspace/context';
import type {Task} from '../http/dto';
import {settingsPolicy} from './policy';
import {storedProfile} from './profile';
import {credentialGrantAllowed,type CredentialAuthorityRow} from '../auth/credential-authority';
import {HttpError} from '../http/envelopes';
export type {ExecutionPolicy} from './generated/validators.js';
export interface EligibilityEvidence {policyVersion:number;replaySafetyRuleId:string|null;}
/** Domain adapter preserves typed HTTP failures without coupling Node policy validation to Workers. */
export function validateExecutionPolicy(input:unknown):ExecutionPolicy {
 try{return parseExecutionPolicy(input);}catch{throw new HttpError('INVALID_REQUEST',400);}
}
/** The already-current actor is supplied by the existing command/read transaction. */
export function installedExecutionPolicy(tx:WorkspaceTransaction,actor:ActorContext):ExecutionPolicy{
 const value=settingsPolicy(tx,actor).policy.execution_policy;
 try{return validateExecutionPolicy(value);}catch{throw new HttpError('DEPENDENCY_UNAVAILABLE',503);}
}
export type TaskReferences=Pick<Task,'workspace_id'|'project_id'|'work_role_id'|'assigned_agent_id'>;
/** Reference existence/activity and caller project visibility, not a separate operation authorizer. */
export function assertTaskReferences(tx:WorkspaceTransaction,actor:ActorContext,task:TaskReferences):void{
 if(task.workspace_id!==actor.workspaceId)throw new HttpError('NOT_FOUND',404);
 if(actor.projectIds!==null&&(task.project_id===null||!actor.projectIds.includes(task.project_id)))throw new HttpError('FORBIDDEN',403);
 const profile=storedProfile(tx,actor).profile;
 if(task.project_id!==null&&!profile.projects.some(p=>p.id===task.project_id&&!p.archived)||task.work_role_id!==null&&!profile.work_roles.some(r=>r.id===task.work_role_id&&!r.archived))throw new HttpError('NOT_FOUND',404);
 if(task.assigned_agent_id!==null&&!tx.one("SELECT agent_id FROM static_agents WHERE workspace_id=? AND agent_id=? AND status='active' AND config_epoch=(SELECT config_epoch FROM workspace_metadata WHERE id=1)",[actor.workspaceId,task.assigned_agent_id]))throw new HttpError('NOT_FOUND',404);
}
/** Eligibility uses a single coherent live credential; work-role labels never grant access. */
export function assertTaskEligible(tx:WorkspaceTransaction,ctx:CommandContext,task:Task,agentId:string|null):EligibilityEvidence{
 assertTaskReferences(tx,ctx.actor,task);
 if(task.flags.includes('outcome_unknown')||task.flags.includes('retry_exhausted'))throw new HttpError('INVALID_STATE',409);
 const policy=installedExecutionPolicy(tx,ctx.actor),rule=policy.eligibility_rules.find(r=>r.project_id===task.project_id&&r.work_role_id===task.work_role_id);
 if(!rule)throw new HttpError('FORBIDDEN',403);
 if(agentId!==null&&task.assigned_agent_id!==null&&agentId!==task.assigned_agent_id)throw new HttpError('FORBIDDEN',403);
 const assigned=agentId??task.assigned_agent_id,candidates=assigned===null?rule.eligible_agent_ids:[assigned];
 const eligible=candidates.some(id=>{
  if(!rule.eligible_agent_ids.includes(id))return false;
  const credentials=tx.all<CredentialAuthorityRow>('SELECT * FROM native_credentials WHERE workspace_id=? AND agent_id=?',[ctx.actor.workspaceId,id]);
  return credentials.some(credential=>{
   if(!credentialGrantAllowed(tx,credential,ctx.nowMs))return false;
   let scopes:unknown,projects:unknown;try{scopes=JSON.parse(credential.scopes_json);projects=JSON.parse(credential.project_ids_json);}catch{return false;}
   return Array.isArray(scopes)&&scopes.includes('tasks:claim')&&scopes.includes('tasks:execute')&&(projects===null||Array.isArray(projects)&&task.project_id!==null&&projects.includes(task.project_id));
  });
 });
 if(!eligible)throw new HttpError('FORBIDDEN',403);
 const replay=policy.replay_safety_rules.find(r=>r.project_id===task.project_id&&r.work_role_id===task.work_role_id);
 return {policyVersion:policy.policy_version,replaySafetyRuleId:replay?.id??null};
}
