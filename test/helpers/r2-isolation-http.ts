import {expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import entry from '../../src/index';
import {r2IsolationFixture,isolationTokens} from './r2-isolation';
import {oidcCallbackRequest} from './r1-acceptance';
import {cookie} from './auth';
import {neutralProfile} from '../../src/config/profile';
import {sha256,canonicalJson} from '../../src/config/bootstrap';
import {clientOperations,type EnabledOperationId} from '../../src/http/generated/client-operations';
import type {Scope} from '../../src/http/dto';
import type {IsolationLane} from './r2-isolation-matrix';
export const nativeIsolationScopes=['workspace:read','tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:claim','tasks:execute','tasks:review','tasks:cancel','agents:read','runtimes:manage','messages:read','messages:send','messages:ack','artifacts:read','artifacts:write','events:read','search:read'] as const satisfies readonly Scope[];
export const humanIsolationScopes=['workspace:read','tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:review','tasks:cancel','agents:read','agents:manage','messages:read','messages:send','messages:review','artifacts:read','artifacts:write','events:read','credentials:manage','search:read','profile:edit','operations:read','imports:manage'] as const satisfies readonly Scope[];
export const visibleText='Visible isolation marker';
export const foreignText='PRIVATE foreign workspace marker';
export async function isolationHttpFixture(name:string,options:Parameters<typeof r2IsolationFixture>[1]={}){
 const base=await r2IsolationFixture(name,{nativeScopes:options.nativeScopes??nativeIsolationScopes,configure:raw=>{
  raw.config.human_grants[0].scopes=[...humanIsolationScopes];raw.config.human_grants[0].delegable_native_scopes=[...nativeIsolationScopes];
  raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:10,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research','agent_other']},{project_id:'project_a',work_role_id:'role_a',eligible_agent_ids:['agent_research','agent_other']}],replay_safety_rules:[]};
  options.configure?.(raw);
 }});
 const http=(request:Request)=>entry.fetch(request,base.bindings);
 const sessions:{a:{cookie:string;csrf:string};b?:{cookie:string;csrf:string}}={a:{cookie:base.sessionCookie,csrf:base.csrf}};
 const ensureB=async()=>{if(sessions.b)return;const response=await http(await oidcCallbackRequest({http},base.b));expect(response.status).toBe(302);const value=cookie(response,'cfhub_session');await response.arrayBuffer();const session=await http(new Request(base.b.origin+'/v2/workspaces/'+base.b.id+'/auth/session',{headers:{cookie:value}}));expect(session.status).toBe(200);sessions.b={cookie:value,csrf:(await session.json() as {data:{csrf_token:string}}).data.csrf_token};};
 const make=(operation:EnabledOperationId,lane:IsolationLane,input:Input={},target:'a'|'b'='a',authority:'a'|'b'=target)=>{
  const descriptor=clientOperations[operation],dest=base[target],session=sessions[authority];
  if(lane==='human'&&!session)throw Error('Human B session not established');
  let path=descriptor.path.replace('{workspace_id}',dest.id);for(const [key,value]of Object.entries(input.path??{}))path=path.replace('{'+key+'}',encodeURIComponent(value));
  if(path.includes('{'))throw Error('Missing matrix path '+path);
  const url=new URL(dest.origin+path);for(const [key,value]of Object.entries(input.query??{}))url.searchParams.set(key,String(value));
  const headers:Record<string,string>={...(lane==='human'?{cookie:session!.cookie,origin:dest.origin,'x-csrf-token':session!.csrf}:lane==='native'?{authorization:'Bearer '+(input.token??base[authority].token)}:{origin:dest.origin}),...(descriptor.idempotency?{'idempotency-key':input.key??'isolation-cell'}:{}),...(input.proof?{'x-runtime-token':input.proof}:{}),...input.headers};
  if(input.body!==undefined)headers['content-type']='application/json';if(input.bytes!==undefined)headers['content-type']='application/octet-stream';
  return new Request(url,{method:descriptor.method,redirect:'manual',headers,...(input.bytes!==undefined?{body:input.bytes}:input.body!==undefined?{body:JSON.stringify(input.body)}:{})});
 };
 const send=(...args:Parameters<typeof make>)=>http(make(...args));
 const data=async(operation:EnabledOperationId,lane:IsolationLane,input:Input={},target:'a'|'b'='a')=>{
  const response=await send(operation,lane,{key:crypto.randomUUID(),...input},target),text=await response.text();expect(response.status,text).toBe(clientOperations[operation].status);const value=JSON.parse(text);expect(clientOperations[operation].validateResponse?.(value),text).toBe(true);return value.data as Record<string,any>;
 };
 return {...base,http,make,send,data,ensureB,sessions,snapshot:(target:'a'|'b'='a')=>isolationSnapshot(base[target])};
}
export type IsolationHttpFixture=Awaited<ReturnType<typeof isolationHttpFixture>>;
export interface Input {path?:Record<string,string>;query?:Record<string,string|number>;body?:unknown;bytes?:Uint8Array<ArrayBuffer>;proof?:string;token?:string;key?:string;headers?:Record<string,string>;}
export interface PreparedIsolation {input:Input;assertData:(data:any)=>void;effectTables:readonly string[];readOnly?:boolean;foreignIds:string[];}
export async function putIsolationProfile(f:IsolationHttpFixture,target:'a'|'b'='a'){
 if(target==='b')await f.ensureB();
 const projects=(target==='a'?['project_a','project_b']:['foreign_project']).map(id=>({id,display_name:id,description:'',archived:false}));
 const profile={...structuredClone(neutralProfile),display_name:target==='a'?visibleText:foreignText,projects,work_roles:[{id:'role_a',display_name:'Role A',description:'',archived:false}]};
 return f.data('putProfile','human',{body:{expected_profile_revision:1,profile}},target);
}
export async function createIsolationTask(f:IsolationHttpFixture,target:'a'|'b'='a',project:string|null=null){if(target==='b')await f.ensureB();return f.data('createTask','human',{body:{title:target==='a'?visibleText:foreignText,description:'Evidence description',project_id:project}},target);}
export async function prepareIsolationOperation(f:IsolationHttpFixture,operation:EnabledOperationId,lane:IsolationLane):Promise<PreparedIsolation>{
 const input:Input={},effectTables:string[]=[],foreignIds:string[]=[];let assertData:(data:any)=>void=data=>expect(data).toBeDefined(),readOnly=clientOperations[operation].method==='GET';
 const readIncludes=(field:string,value:unknown)=>{assertData=data=>expect(data).toMatchObject({[field]:value});};
 const includesRow=(id:string)=>{assertData=data=>expect(data).toEqual(expect.arrayContaining([expect.objectContaining({id})]));};
 const taskOps=['listTasks','getTask','patchTask','readyTask','claimTask','submitTaskResult','acceptTaskResult','failTask','cancelTask','requeueTask','getRun','heartbeatRun','listTaskResults'];
 if(taskOps.includes(operation)){
  const task=await createIsolationTask(f);input.path={task_id:task.id};includesRow(task.id);
  if(['claimTask','submitTaskResult','acceptTaskResult','failTask','getRun','heartbeatRun','listTaskResults'].includes(operation)){
   await f.data('readyTask','human',{path:{task_id:task.id},body:{expected_version:1}});
   if(operation==='claimTask'){input.body={expected_version:2,runtime_instance_id:f.runtimes.reader.runtime.id};input.proof=f.runtimes.reader.runtime_token;assertData=data=>expect(data.task).toMatchObject({id:task.id,state:'doing'});effectTables.push('tasks','runs','events','task_history','idempotency_outcomes');}
   else{
    const claim=await f.data('claimTask','native',{path:{task_id:task.id},body:{expected_version:2,runtime_instance_id:f.runtimes.reader.runtime.id},proof:f.runtimes.reader.runtime_token});
    if(operation==='getRun'||operation==='heartbeatRun')input.path={run_id:claim.run.id};
    if(operation==='getRun')readIncludes('id',claim.run.id);
    if(operation==='heartbeatRun'){input.body={expected_run_version:1,fence:claim.run.fence};input.proof=f.runtimes.reader.runtime_token;assertData=data=>expect(data).toMatchObject({id:claim.run.id,run_version:2});effectTables.push('runs','events','idempotency_outcomes');}
    if(operation==='submitTaskResult'||operation==='failTask'){input.body=operation==='submitTaskResult'?{expected_version:3,run_id:claim.run.id,fence:claim.run.fence,result:{summary:visibleText,artifact_ids:[]}}:{expected_version:3,run_id:claim.run.id,fence:claim.run.fence,reason:'Explicit safe failure',outcome_unknown:false};input.proof=f.runtimes.reader.runtime_token;assertData=data=>expect(data.task).toMatchObject({id:task.id,state:operation==='submitTaskResult'?'review':'backlog'});effectTables.push('tasks','runs','events','task_history','idempotency_outcomes');if(operation==='submitTaskResult')effectTables.push('task_results');}
    if(operation==='acceptTaskResult'||operation==='listTaskResults'){
     await f.data('submitTaskResult','native',{path:{task_id:task.id},body:{expected_version:3,run_id:claim.run.id,fence:claim.run.fence,result:{summary:visibleText,artifact_ids:[]}},proof:f.runtimes.reader.runtime_token});
     if(operation==='acceptTaskResult'){input.body={expected_version:4,reason:'Independent evidence review'};if(lane==='native')input.token=isolationTokens.other;assertData=data=>expect(data.task).toMatchObject({id:task.id,state:'done'});effectTables.push('task_acceptances','tasks','events','task_history','idempotency_outcomes');}else assertData=data=>expect(data).toEqual([expect.objectContaining({run_id:claim.run.id,summary:visibleText})]);
    }
   }
  }else if(operation==='getTask')readIncludes('id',task.id);
  else if(operation==='patchTask'){input.body={expected_version:1,title:'Changed visible title'};readIncludes('title','Changed visible title');effectTables.push('tasks','events','task_history','idempotency_outcomes');}
  else if(operation==='readyTask'){input.body={expected_version:1};assertData=data=>expect(data.task).toMatchObject({id:task.id,state:'ready'});effectTables.push('tasks','events','task_history','idempotency_outcomes');}
  else if(operation==='cancelTask'||operation==='requeueTask'){
   const version=1;
   input.body={expected_version:version,reason:'Explicit intent'};assertData=data=>expect(data.task).toMatchObject({id:task.id,state:operation==='cancelTask'?'cancelled':'ready'});effectTables.push('tasks','events','task_history','idempotency_outcomes');
  }
 }
 if(operation==='createTask'){input.body={title:visibleText,description:'Created through real HTTP'};assertData=data=>expect(data).toMatchObject({title:visibleText,state:'backlog',task_version:1});effectTables.push('tasks','events','task_history','idempotency_outcomes');}
 if(['createAgent','getAgent','patchAgent','archiveAgent','listAgents','createCredential','listCredentials','revokeCredential'].includes(operation)){
  if(operation==='createAgent'){input.body={display_name:visibleText,description:'Synthetic managed identity',work_role_ids:[]};readIncludes('display_name',visibleText);effectTables.push('static_agents','events','idempotency_outcomes');}
  else if(operation==='getAgent'){input.path={agent_id:'agent_research'};readIncludes('id','agent_research');}
  else if(operation==='listAgents'){includesRow('agent_research');}
  else if(operation==='patchAgent'||operation==='archiveAgent'){
   const agent=await f.data('createAgent','human',{body:{display_name:'Managed target',description:'',work_role_ids:[]}});input.path={agent_id:agent.id};input.body=operation==='patchAgent'?{expected_agent_version:1,description:visibleText}:{expected_agent_version:1,reason:'Explicit archive'};readIncludes(operation==='patchAgent'?'description':'status',operation==='patchAgent'?visibleText:'archived');effectTables.push('static_agents','events','idempotency_outcomes');
  }else if(operation==='listCredentials'){assertData=data=>expect(data).toEqual(expect.arrayContaining([expect.objectContaining({id:'credential_research_1'})]));}
  else{
   const body={agent_id:'agent_research',label:visibleText,scopes:['tasks:read'],project_ids:null,expires_at:new Date(Date.now()+600000).toISOString()};
   if(operation==='createCredential'){input.body=body;assertData=data=>expect(data).toMatchObject({credential:{label:visibleText},revealed:true});}
   else{const issue=await f.data('createCredential','human',{body});input.path={credential_id:issue.credential.id};input.body={expected_credential_version:1,reason:'Explicit revoke'};assertData=data=>expect(data).toMatchObject({id:issue.credential.id,status:'revoked'});}
   effectTables.push('native_credentials','events','idempotency_outcomes');
  }
 }
 if(operation==='createRuntime'){input.body={label:visibleText};assertData=data=>expect(data).toMatchObject({runtime:{label:visibleText,agent_id:'agent_research'},revealed:true});effectTables.push('runtimes','events','idempotency_outcomes');}
 if(operation==='heartbeatRuntime'){input.path={runtime_instance_id:f.runtimes.reader.runtime.id};input.body={expected_runtime_version:1};input.proof=f.runtimes.reader.runtime_token;assertData=data=>expect(data).toMatchObject({id:f.runtimes.reader.runtime.id,runtime_version:2});effectTables.push('runtimes','events','idempotency_outcomes');}
 if(['createMessage','getInbox','getThread','ackMessages'].includes(operation)){
  if(operation==='createMessage'){input.body={recipient_agent_ids:['agent_other'],body:visibleText,refs:[],artifact_ids:[]};readIncludes('body',visibleText);effectTables.push('messages','threads','inbox','events','idempotency_outcomes');}
  else{const message=await f.data('createMessage','human',{body:{recipient_agent_ids:['agent_research'],body:visibleText,refs:[],artifact_ids:[]}});if(operation==='getThread')input.path={thread_id:message.thread_id};if(operation==='ackMessages'){input.body={message_ids:[message.id]};assertData=data=>expect(data.acknowledged_ids).toEqual([message.id]);effectTables.push('inbox','events','idempotency_outcomes');}else includesRow(message.id);}
 }
 if(['listArtifacts','stageArtifact','getArtifact','uploadArtifactContent','downloadArtifactContent','commitArtifact'].includes(operation)){
  const bytes=new TextEncoder().encode(visibleText),body={task_id:null,run_id:null,filename:'visible.txt',media_type:'text/plain',byte_size:bytes.length,sha256:await sha256(visibleText)},proof=lane==='native'?f.runtimes.reader.runtime_token:undefined;
  if(operation==='stageArtifact'){input.body=body;input.proof=proof;assertData=data=>expect(data).toMatchObject({filename:'visible.txt',status:'staged'});effectTables.push('artifacts','events','idempotency_outcomes');}
  else{const staged=await f.data('stageArtifact',lane,{body,proof});input.path={artifact_id:staged.id};
   if(operation==='uploadArtifactContent'){input.bytes=bytes;input.proof=proof;assertData=data=>expect(data).toMatchObject({id:staged.id,status:'uploaded'});effectTables.push('artifacts','artifact_generations','events','idempotency_outcomes');}
   else{const uploaded=await f.data('uploadArtifactContent',lane,{path:{artifact_id:staged.id},bytes,proof});
    if(operation==='commitArtifact'){input.body={expected_artifact_version:uploaded.artifact_version};input.proof=proof;assertData=data=>expect(data).toMatchObject({id:staged.id,status:'committed'});effectTables.push('artifacts','artifact_generations','events','idempotency_outcomes');}
    else{await f.data('commitArtifact',lane,{path:{artifact_id:staged.id},body:{expected_artifact_version:uploaded.artifact_version},proof});if(operation==='listArtifacts')includesRow(staged.id);else if(operation==='getArtifact')readIncludes('id',staged.id);else assertData=data=>expect(new TextDecoder().decode(data)).toBe(visibleText);}
   }
  }
 }
 if(operation==='searchWorkspace'){const task=await createIsolationTask(f);input.query={q:'Visible'};includesRow(task.id);}
 if(operation==='listEvents'){const task=await createIsolationTask(f);assertData=data=>expect(data).toEqual(expect.arrayContaining([expect.objectContaining({type:'task.created',resource_id:task.id})]));}
 if(['getWorkspace','getConfiguration','getProfile','putProfile','previewProfile','exportProfile','previewCatalogChange','applyCatalogChange'].includes(operation)){
  if(operation==='getWorkspace')readIncludes('id','ws_example');
  if(operation==='getConfiguration')assertData=data=>expect(data).toHaveProperty('enabled_features');
  if(operation==='getProfile'||operation==='exportProfile')assertData=data=>expect(data.profile).toMatchObject({profile_id:'profile_neutral'});
  if(operation==='putProfile'||operation==='previewProfile'){input.body={expected_profile_revision:1,profile:{...structuredClone(neutralProfile),display_name:visibleText}};assertData=data=>expect(data.profile).toMatchObject({display_name:visibleText});if(operation==='putProfile')effectTables.push('events','idempotency_outcomes','profiles');else readOnly=true;}
  if(operation==='previewCatalogChange'||operation==='applyCatalogChange'){
   await putIsolationProfile(f);const body={expected_profile_revision:2,kind:'project',id:'project_b',operation:'archive',replacement_id:null,reason:'Explicit archive'};
   if(operation==='previewCatalogChange'){input.body=body;assertData=data=>expect(data).toMatchObject({changes:[expect.objectContaining({id:'project_b',operation:'archive'})]});effectTables.push('catalog_plans','events','idempotency_outcomes');}
   else{const plan=await f.data('previewCatalogChange','human',{body});input.body={preview_id:plan.id,expected_profile_revision:2};assertData=data=>expect(data.profile.projects).toEqual(expect.arrayContaining([expect.objectContaining({id:'project_b',archived:true})]));effectTables.push('catalog_plans','profiles','events','idempotency_outcomes');}
  }
 }
 if(operation==='getPreferences')assertData=data=>expect(data).toHaveProperty('preferences_revision');
 if(operation==='putPreferences'){input.body={expected_preferences_revision:0,preferences:{contract_revision:'0.1',theme:'dark',density:'compact',default_view:'overview'}};assertData=data=>expect(data).toMatchObject({preferences_revision:1,preferences:{theme:'dark'}});effectTables.push('preferences','events','idempotency_outcomes');}
 if(operation==='getOperations')assertData=data=>expect(data).toHaveProperty('outbox');
 if(operation==='getReadiness')assertData=data=>expect(data).toHaveProperty('ready');
 if(operation==='getAuthSession')assertData=data=>expect(data).toMatchObject({actor:{kind:'human',principal_id:'human_operator'}});
 if(operation==='logoutAuth'){input.body={};assertData=data=>expect(data).toEqual({logged_out:true});effectTables.push('sessions');}
 if(operation==='startAuth'){input.body={return_path:'/overview'};assertData=data=>expect(new URL(data.authorization_url).origin).toBe('https://identity.example.invalid');effectTables.push('login_attempts');}
 if(['previewImport','applyImport','getImport'].includes(operation)){
  const body={source_namespace:'synthetic_source',source_revision:'revision1',rows:[{external_id:'external_row',title:visibleText,description:'Imported inert text',project_id:null,work_role_id:null,source_updated_at:null,source_state:'done',source_ref:'https://source.example.invalid/item'}]};
  if(operation==='previewImport'){input.body=body;assertData=data=>expect(data).toMatchObject({counts:{received:1,create:1}});effectTables.push('import_plans','events','idempotency_outcomes');}
  else{const plan=await f.data('previewImport','human',{body});input.path={import_id:plan.id};if(operation==='getImport')readIncludes('id',plan.id);else{input.body={expected_import_version:1,preview_sha256:plan.preview_sha256,accept_rejected_rows:false};assertData=data=>expect(data).toMatchObject({counts:{created:1}});effectTables.push('import_plans','import_mappings','tasks','events','task_history','idempotency_outcomes');}}
 }
 if(operation==='listTasks'||operation==='listArtifacts')delete input.path;
 return {input,assertData,effectTables,readOnly,foreignIds};
}
export function changedTables(before:Awaited<ReturnType<typeof isolationSnapshot>>,after:Awaited<ReturnType<typeof isolationSnapshot>>):string[]{return Object.keys(before.tables).filter(table=>canonicalJson(before.tables[table])!==canonicalJson(after.tables[table]));}
export async function narrowAuthority(f:IsolationHttpFixture,lane:'human'|'native',kind:'revoke'|'expire'){
 await runInDurableObject(f.a.stub,(_o,{storage})=>{if(lane==='human')storage.sql.exec(kind==='revoke'?'UPDATE sessions SET revoked_at=?':'UPDATE sessions SET expires_at=?',Date.now()-1);else storage.sql.exec(kind==='revoke'?"UPDATE native_credentials SET enabled=0 WHERE credential_id='credential_research_1'":"UPDATE native_credentials SET expires_at=? WHERE credential_id='credential_research_1'",...(kind==='revoke'?[]:[Date.now()-1]));});
}

/** Snapshot every application SQL table, excluding workerd's access-protected private metadata. */
export async function isolationSnapshot(target:{stub:DurableObjectStub<import('../../src/index').WorkspaceDO>}){
 const tables=await runInDurableObject(target.stub,(_o,{storage})=>{
  const names=storage.sql.exec<{name:string}>("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,4)!='_cf_' ORDER BY name").toArray().map(x=>x.name);
  return Object.fromEntries(names.map(name=>[name,storage.sql.exec<Record<string,SqlStorageValue>>('SELECT * FROM "'+name.replaceAll('"','""')+'"').toArray().sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)))]));
 });return {tables,digest:await sha256(canonicalJson(tables))};
}
