import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext,CommandContext} from '../workspace/context';
import type {CatalogPreviewRequest,CatalogApplyRequest,CatalogPlan,ProfileData} from '../http/dto';
import type {CommandDescriptor} from '../workspace/commands';
import {validateCatalogPreviewRequest,validateCatalogApplyRequest,validateCatalogPlan,validateProfileData} from '../http/generated/auth-validators.js';
import {refreshActor,authorize} from '../auth/authorize';
import {settingsPolicy} from './policy';
import {storedProfile} from './profile';
import {canonicalJson} from './bootstrap';
import {HttpError} from '../http/envelopes';
import {taskRecord,taskView} from '../tasks/repository';
export const CATALOG_AGENT_SCAN_LIMIT=2048;
const TTL=900000,MAX_AFFECTED=200,MAX_BYTES=65536;
interface TaskRef{id:string;version:number;projectId:string|null;state:string;approvalId:string|null;}
interface AgentRef{id:string;version:number;status:string;}
interface Evidence{request:CatalogPreviewRequest;tasks:TaskRef[];agents:AgentRef[];taskWrite:boolean;agentWrite:boolean;}
interface PlanRow{id:string;workspace_id:string;actor_principal_id:string;profile_revision:number;expires_at:number;plan_json:string;touched_versions_json:string;status:string;created_at:number;}
const fail=(code:'INVALID_REQUEST'|'INVALID_STATE'|'VERSION_CONFLICT'|'FORBIDDEN'|'NOT_FOUND'|'INTERNAL_ERROR'|'DEPENDENCY_UNAVAILABLE'|'LIMIT_EXCEEDED',status:number):never=>{throw new HttpError(code,status);};
function validId(value:unknown):value is string{return typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);}
function next(version:number):number{if(!Number.isSafeInteger(version)||version>=Number.MAX_SAFE_INTEGER)fail('LIMIT_EXCEEDED',409);return version+1;}
function validate<B>(body:B,predicate:(x:unknown)=>boolean):void{if(!predicate(body))fail('INVALID_REQUEST',400);if(new TextEncoder().encode(JSON.stringify(body)).byteLength>MAX_BYTES)fail('LIMIT_EXCEEDED',413);}
function human(tx:WorkspaceTransaction,ctx:CommandContext):ActorContext{
 const actor=refreshActor(tx,ctx.actor,ctx.nowMs);authorize(tx,actor,'profile:edit',undefined,ctx.nowMs);settingsPolicy(tx,actor);
 if(actor.kind!=='human'||!actor.sessionId)fail('FORBIDDEN',403);return actor;
}
function project(actor:ActorContext,id:string|null):void{if(actor.projectIds!==null&&(id===null||!actor.projectIds.includes(id)))fail('FORBIDDEN',403);}
function selectionAccess(actor:ActorContext,request:CatalogPreviewRequest):void{
 if(request.kind==='project'){project(actor,request.id);if(request.replacement_id!==null)project(actor,request.replacement_id);}
}
function taskRef(tx:WorkspaceTransaction,actor:ActorContext,id:string,nowMs:number):TaskRef{
 const row=taskRecord(tx,actor.workspaceId,id);taskView(tx,actor,row,nowMs);
 return {id:row.id,version:row.task_version,projectId:row.project_id,state:row.state,approvalId:row.approval_id};
}
function visibleEvidence(tx:WorkspaceTransaction,ctx:CommandContext,actor:ActorContext,evidence:Evidence):void{
 selectionAccess(actor,evidence.request);
 for(const ref of evidence.tasks){project(actor,ref.projectId);const current=taskRef(tx,actor,ref.id,ctx.nowMs);project(actor,current.projectId);}
 if(evidence.agents.length){if(actor.projectIds!==null)fail('FORBIDDEN',403);for(const ref of evidence.agents)if(!tx.one('SELECT agent_id FROM static_agents WHERE workspace_id=? AND agent_id=?',[actor.workspaceId,ref.id]))fail('FORBIDDEN',403);}
 if(evidence.taskWrite)authorize(tx,actor,'tasks:edit',undefined,ctx.nowMs);
 if(evidence.agentWrite)authorize(tx,actor,'agents:manage',undefined,ctx.nowMs);
}
function parseRoles(value:unknown):string[]{
 if(typeof value!=='string')fail('INTERNAL_ERROR',500);
 let roles:unknown;try{roles=JSON.parse(value as string);}catch{fail('INTERNAL_ERROR',500);}
 if(!Array.isArray(roles)||roles.some(x=>!validId(x))||new Set(roles).size!==roles.length)fail('INTERNAL_ERROR',500);
 return roles as string[];
}
function editableTask(ref:TaskRef):boolean{return ['backlog','ready'].includes(ref.state)&&ref.approvalId===null;}
function collect(tx:WorkspaceTransaction,actor:ActorContext,request:CatalogPreviewRequest,nowMs:number):Evidence{
 selectionAccess(actor,request);
 const column=request.kind==='project'?'project_id':'work_role_id',index=request.kind==='project'?'tasks_catalog_project':'tasks_catalog_role';
 // The equality prefix and LIMIT bound physical candidates, not just matching output.
 const keys=tx.all<{id:string|null}>(`SELECT CASE WHEN length(CAST(id AS BLOB))<=128 THEN id ELSE NULL END AS id FROM tasks INDEXED BY ${index} WHERE workspace_id=? AND ${column}=? ORDER BY tasks.id LIMIT 201`,[actor.workspaceId,request.id]);
 const tasks=keys.map(row=>{if(row.id===null)fail('INTERNAL_ERROR',500);return taskRef(tx,actor,row.id!,nowMs);});
 for(const ref of tasks)project(actor,ref.projectId);
 if(tasks.length>MAX_AFFECTED)fail(actor.projectIds===null?'LIMIT_EXCEEDED':'FORBIDDEN',actor.projectIds===null?413:403);
 const agents:AgentRef[]=[];
 if(request.kind==='work_role'){
  // JSON-array membership has no scalar index. Never confuse filtered LIMIT with bounded work.
  let position='',scanned=0;
  while(true){
   const cap=Math.min(32,CATALOG_AGENT_SCAN_LIMIT-scanned+1);
   const rows=tx.all<{id:string|null;version:number;status:string;roles:string|null}>('SELECT CASE WHEN length(CAST(agent_id AS BLOB))<=128 THEN agent_id ELSE NULL END AS id,agent_version AS version,status,CASE WHEN length(CAST(work_role_ids_json AS BLOB))<=65536 THEN work_role_ids_json ELSE NULL END AS roles FROM static_agents INDEXED BY agents_workspace_identity WHERE workspace_id=? AND agent_id>? ORDER BY agent_id LIMIT ?',[actor.workspaceId,position,cap]);
   if(scanned+rows.length>CATALOG_AGENT_SCAN_LIMIT)fail('DEPENDENCY_UNAVAILABLE',503);
   for(const row of rows){
    if(!validId(row.id))fail('INTERNAL_ERROR',500);position=row.id!;scanned++;
    if(parseRoles(row.roles).includes(request.id)){if(actor.projectIds!==null)fail('FORBIDDEN',403);agents.push({id:row.id!,version:row.version,status:row.status});}
   }
   if(rows.length<cap)break;
  }
 }
 if(tasks.length+agents.length>MAX_AFFECTED)fail('LIMIT_EXCEEDED',413);
 for(const row of [...tasks,...agents])if(!validId(row.id)||!Number.isSafeInteger(row.version)||row.version<1)fail('INTERNAL_ERROR',500);
 const remap=request.operation==='remap';
 return {request,tasks,agents,taskWrite:remap&&tasks.some(editableTask),agentWrite:remap&&agents.some(row=>row.status==='active')};
}
function conflicts(tx:WorkspaceTransaction,actor:ActorContext,evidence:Evidence):CatalogPlan['conflicts']{
 if(evidence.request.operation==='archive')return [];
 const result:CatalogPlan['conflicts']=[];
 const policy=settingsPolicy(tx,actor).policy.execution_policy;
 if(!policy)fail('DEPENDENCY_UNAVAILABLE',503);
 const field=evidence.request.kind==='project'?'project_id':'work_role_id';
 if([...policy!.eligibility_rules,...policy!.replay_safety_rules].some(rule=>rule[field]===evidence.request.id))result.push({resource_kind:evidence.request.kind,resource_id:evidence.request.id,code:'POLICY_REWRITE_REQUIRED'});
 for(const row of evidence.tasks)if(['doing','waiting','review'].includes(row.state)||['backlog','ready'].includes(row.state)&&row.approvalId!==null)result.push({resource_kind:'task',resource_id:row.id,code:'LIVE_OR_APPROVED_INTENT'});
 // The public schema bounds conflicts too. A whole operation rejects rather than truncates.
 if(result.length>MAX_AFFECTED)fail('LIMIT_EXCEEDED',413);return result;
}
function profileChange(tx:WorkspaceTransaction,actor:ActorContext,request:CatalogPreviewRequest){
 const current=storedProfile(tx,actor),key:'projects'|'work_roles'=request.kind==='project'?'projects':'work_roles';
 const source=current.profile[key].find(x=>x.id===request.id);
 if(!source)fail('NOT_FOUND',404);
 if(source!.archived)fail('INVALID_STATE',409);
 if(request.operation==='archive'&&request.replacement_id!==null||request.operation==='remap'&&(request.replacement_id===null||request.replacement_id===request.id))fail('INVALID_REQUEST',400);
 const destination=request.operation==='remap'?current.profile[key].find(x=>x.id===request.replacement_id&&!x.archived):null;
 if(request.operation==='remap'&&!destination)fail('NOT_FOUND',404);
 return {current,key,source:source!,destination};
}
function readPlan(tx:WorkspaceTransaction,actor:ActorContext,id:string):{row:PlanRow;plan:CatalogPlan;evidence:Evidence}{
 const row=tx.one<PlanRow>('SELECT id,workspace_id,actor_principal_id,profile_revision,expires_at,CASE WHEN length(CAST(plan_json AS BLOB))<=65536 THEN plan_json ELSE NULL END AS plan_json,CASE WHEN length(CAST(touched_versions_json AS BLOB))<=65536 THEN touched_versions_json ELSE NULL END AS touched_versions_json,status,created_at FROM catalog_plans WHERE workspace_id=? AND id=? AND actor_principal_id=?',[actor.workspaceId,id,actor.principalId]);
 if(!row)fail('NOT_FOUND',404);
 if(typeof row!.plan_json!=='string'||typeof row!.touched_versions_json!=='string')fail('INTERNAL_ERROR',500);
 if(new TextEncoder().encode(row!.plan_json).byteLength>MAX_BYTES||new TextEncoder().encode(row!.touched_versions_json).byteLength>MAX_BYTES)fail('INTERNAL_ERROR',500);
 let plan:CatalogPlan,evidence:Evidence;
 try{plan=JSON.parse(row!.plan_json) as CatalogPlan;evidence=JSON.parse(row!.touched_versions_json) as Evidence;}catch{fail('INTERNAL_ERROR',500);}
 if(!validateCatalogPlan(plan!)||plan!.id!==row!.id||plan!.profile_revision!==row!.profile_revision||Date.parse(plan!.expires_at)!==row!.expires_at||row!.expires_at-row!.created_at!==TTL||!evidence!||!validateCatalogPreviewRequest(evidence!.request)||evidence!.request.expected_profile_revision!==row!.profile_revision||!Array.isArray(evidence!.tasks)||!Array.isArray(evidence!.agents)||evidence!.tasks.length+evidence!.agents.length>MAX_AFFECTED||typeof evidence!.taskWrite!=='boolean'||typeof evidence!.agentWrite!=='boolean')fail('INTERNAL_ERROR',500);
 for(const ref of evidence!.tasks)if(!ref||!validId(ref.id)||!Number.isSafeInteger(ref.version)||ref.version<1||!(ref.projectId===null||validId(ref.projectId))||!['backlog','ready','doing','waiting','review','done','cancelled'].includes(ref.state)||!(ref.approvalId===null||validId(ref.approvalId)))fail('INTERNAL_ERROR',500);
 for(const ref of evidence!.agents)if(!ref||!validId(ref.id)||!Number.isSafeInteger(ref.version)||ref.version<1||!['active','archived'].includes(ref.status))fail('INTERNAL_ERROR',500);
 if(canonicalJson(plan!.affected_task_ids)!==canonicalJson(evidence!.tasks.map(x=>x.id))||canonicalJson(plan!.affected_agent_ids)!==canonicalJson(evidence!.agents.map(x=>x.id)))fail('INTERNAL_ERROR',500);
 const request=evidence!.request,first=plan!.changes[0],second=plan!.changes[1];
 if(!first||first.kind!==request.kind||first.id!==request.id||first.operation!=='archive'||!first.before||first.before.id!==request.id||first.before.archived||canonicalJson(first.after)!==canonicalJson({...first.before,archived:true}))fail('INTERNAL_ERROR',500);
 if(request.operation==='archive'?(request.replacement_id!==null||plan!.changes.length!==1):(request.replacement_id===null||request.replacement_id===request.id||plan!.changes.length!==2||!second||second.kind!==request.kind||second.id!==request.id||second.operation!=='remap'||canonicalJson(second.before)!==canonicalJson(first.before)||!second.after||second.after.id!==request.replacement_id||second.after.archived))fail('INTERNAL_ERROR',500);
 const taskWrite=request.operation==='remap'&&evidence!.tasks.some(editableTask),agentWrite=request.operation==='remap'&&evidence!.agents.some(x=>x.status==='active');
 if(evidence!.taskWrite!==taskWrite||evidence!.agentWrite!==agentWrite||!['previewed','applied','expired'].includes(row!.status)||new Set(evidence!.tasks.map(x=>x.id)).size!==evidence!.tasks.length||new Set(evidence!.agents.map(x=>x.id)).size!==evidence!.agents.length)fail('INTERNAL_ERROR',500);
 return {row:row!,plan:plan!,evidence:evidence!};
}
export function previewCatalogChange(tx:WorkspaceTransaction,ctx:CommandContext&{planId?:string},request:CatalogPreviewRequest):CatalogPlan{
 validate(request,validateCatalogPreviewRequest);const actor=human(tx,ctx),evidence=collect(tx,actor,request,ctx.nowMs);visibleEvidence(tx,ctx,actor,evidence);
 const {current,source,destination}=profileChange(tx,actor,request);
 if(current.profile_revision!==request.expected_profile_revision)fail('VERSION_CONFLICT',409);
 if(!validId(ctx.planId))fail('INTERNAL_ERROR',500);
 const changes:CatalogPlan['changes']=[{kind:request.kind,id:request.id,operation:'archive',before:source,after:{...source,archived:true}}];
 if(destination)changes.push({kind:request.kind,id:request.id,operation:'remap',before:source,after:destination});
 const plan:CatalogPlan={id:ctx.planId!,profile_revision:current.profile_revision,expires_at:new Date(ctx.nowMs+TTL).toISOString(),changes,affected_task_ids:evidence.tasks.map(x=>x.id),affected_agent_ids:evidence.agents.map(x=>x.id),conflicts:conflicts(tx,actor,evidence)};
 validate(plan,validateCatalogPlan);if(new TextEncoder().encode(JSON.stringify({data:plan,request_id:ctx.requestId})).byteLength>MAX_BYTES||new TextEncoder().encode(canonicalJson(evidence)).byteLength>MAX_BYTES)fail('LIMIT_EXCEEDED',413);
 tx.exec("INSERT INTO catalog_plans(id,workspace_id,actor_principal_id,profile_revision,expires_at,plan_json,touched_versions_json,status,created_at) VALUES(?,?,?,?,?,?,?,'previewed',?)",[plan.id,actor.workspaceId,actor.principalId,current.profile_revision,ctx.nowMs+TTL,canonicalJson(plan),canonicalJson(evidence),ctx.nowMs]);
 return plan;
}
export function applyCatalogChange(tx:WorkspaceTransaction,ctx:CommandContext,request:CatalogApplyRequest):ProfileData{
 validate(request,validateCatalogApplyRequest);const actor=human(tx,ctx),stored=readPlan(tx,actor,request.preview_id),{row,plan,evidence}=stored;
 visibleEvidence(tx,ctx,actor,evidence);const live=collect(tx,actor,evidence.request,ctx.nowMs);visibleEvidence(tx,ctx,actor,live);
 const current=storedProfile(tx,actor);
 if(request.expected_profile_revision!==row.profile_revision||current.profile_revision!==row.profile_revision||canonicalJson(live)!==canonicalJson(evidence))fail('VERSION_CONFLICT',409);
 if(row.status!=='previewed'||ctx.nowMs>=row.expires_at)fail('INVALID_STATE',409);
 if(plan.conflicts.length||conflicts(tx,actor,live).length)fail('INVALID_STATE',409);
 const change=profileChange(tx,actor,evidence.request),revision=next(current.profile_revision),profile=structuredClone(current.profile);
 if(evidence.request.operation==='remap'){
  const column=evidence.request.kind==='project'?'project_id':'work_role_id';
  for(const ref of evidence.tasks)if(editableTask(ref))tx.exec(`UPDATE tasks SET ${column}=?,task_version=?,updated_at=? WHERE workspace_id=? AND id=? AND task_version=? AND ${column}=? AND state IN ('backlog','ready') AND approval_id IS NULL`,[evidence.request.replacement_id,next(ref.version),ctx.nowMs,actor.workspaceId,ref.id,ref.version,evidence.request.id]);
  for(const ref of evidence.agents)if(ref.status==='active'){
   // Roles are current, bounded metadata, read after complete ID/version validation in this same transaction.
   const currentRoles=parseRoles(tx.one<{roles:string|null}>('SELECT CASE WHEN length(CAST(work_role_ids_json AS BLOB))<=65536 THEN work_role_ids_json ELSE NULL END AS roles FROM static_agents WHERE workspace_id=? AND agent_id=? AND agent_version=?',[actor.workspaceId,ref.id,ref.version])?.roles);
   tx.exec("UPDATE static_agents SET work_role_ids_json=?,agent_version=?,updated_at=? WHERE workspace_id=? AND agent_id=? AND agent_version=? AND status='active'",[canonicalJson([...new Set(currentRoles.map(x=>x===evidence.request.id?evidence.request.replacement_id!:x))]),next(ref.version),ctx.nowMs,actor.workspaceId,ref.id,ref.version]);
  }
 }
 profile[change.key]=profile[change.key].map(x=>x.id===evidence.request.id?{...x,archived:true}:x);
 tx.exec('UPDATE profiles SET version=?,document_json=?,updated_at=?,updated_by=? WHERE workspace_id=? AND version=?',[revision,canonicalJson(profile),ctx.nowMs,actor.principalId,actor.workspaceId,row.profile_revision]);
 tx.exec("UPDATE catalog_plans SET status='applied' WHERE workspace_id=? AND id=? AND status='previewed'",[actor.workspaceId,row.id]);
 return {profile_revision:revision,profile};
}
export function previewCatalogCommand(planId:string):CommandDescriptor<CatalogPreviewRequest,CatalogPlan>{return {
 operation:'profile:edit',target:'catalog:preview',resource(_tx,_ctx,body){validate(body,validateCatalogPreviewRequest);return undefined;},checkAccess(tx,ctx){human(tx,ctx);},
 checkReplay(tx,ctx,_body,outcome){const actor=human(tx,ctx),stored=readPlan(tx,actor,outcome.data.id);visibleEvidence(tx,ctx,actor,stored.evidence);if(canonicalJson(stored.plan)!==canonicalJson(outcome.data))fail('INTERNAL_ERROR',500);},
 execute(tx,ctx,body){const data=previewCatalogChange(tx,{...ctx,planId},body);return {outcome:{status:200,data},event:{type:'catalog.previewed',resourceType:'profile',resourceId:ctx.actor.workspaceId,resourceVersion:data.profile_revision,threadId:null}};}
};}
export function applyCatalogCommand():CommandDescriptor<CatalogApplyRequest,ProfileData>{return {
 operation:'profile:edit',target:'catalog:apply',resource(_tx,_ctx,body){validate(body,validateCatalogApplyRequest);return undefined;},checkAccess(tx,ctx,body){const actor=human(tx,ctx);visibleEvidence(tx,ctx,actor,readPlan(tx,actor,body.preview_id).evidence);},
 checkReplay(tx,ctx,body,outcome){const actor=human(tx,ctx);visibleEvidence(tx,ctx,actor,readPlan(tx,actor,body.preview_id).evidence);if(!validateProfileData(outcome.data))fail('INTERNAL_ERROR',500);},
 execute(tx,ctx,body){const data=applyCatalogChange(tx,ctx,body);return {outcome:{status:200,data},event:{type:'catalog.applied',resourceType:'profile',resourceId:ctx.actor.workspaceId,resourceVersion:data.profile_revision,threadId:null}};}
};}
