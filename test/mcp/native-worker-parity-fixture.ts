/// <reference path="../../worker-configuration.d.ts" />
/** Fixed, synthetic test composition; all positive grants are signed before install. */
import worker,{WorkspaceDO} from '../../src/index';
import {fixture,operator} from '../helpers/environment';
import {human,commandContext} from '../helpers/settings';
import {canonicalJson,sha256,prepareBootstrap} from '../../src/config/bootstrap';
import {executeCommand} from '../../src/workspace/commands';
import {createTaskCommand,readyTaskCommand} from '../../src/tasks/commands';
import {revokeCredentialCommand} from '../../src/auth/native-credentials';
import {productArtifactBucket} from '../../src/artifacts/binding';
import {TABLE_REGISTRY} from '../../src/recovery/table-registry';
const name='mcp_parity';
const readScopes=['workspace:read','agents:read','tasks:read','runtimes:manage'] as const;
const scopes=['workspace:read','agents:read','tasks:read','runtimes:manage','tasks:create','tasks:claim','tasks:execute'] as const;
const otherScopes=[...readScopes,'messages:read','messages:send','messages:ack','artifacts:read','artifacts:write','search:read'] as const;
const allScopes=[...scopes,...otherScopes] as const;
const q=(s:string)=>'"'+s+'"'; // Only pinned registry identifiers enter SQL.
export class ParityFixtureDO extends WorkspaceDO {
 async seed(removed:typeof allScopes[number],allowedToken:string,deniedToken:string,taskFamily=false,otherFamily=false,setupToken?:string,sharedFamily?:'cursor'|'authority'|'claim-loss'){
  if(!(allScopes as readonly string[]).includes(removed))throw Error('PARITY_SCOPE');
  const raw=await fixture(name);
  raw.config.workspace_policies[0].notification_destinations=[];
  raw.config.human_grants[0].scopes.push('tasks:read','tasks:create');if(taskFamily)raw.config.human_grants[0].scopes.push('tasks:schedule');
  const ref=raw.config.static_credential_refs[0];ref.scopes=otherFamily?[...otherScopes]:taskFamily?[...scopes]:[...readScopes];
  raw.config.static_credential_refs.push({...ref,credential_id:'credential_denied',scopes:ref.scopes.filter(x=>removed==='tasks:execute'||x!==removed)});
  raw.bundle.credentials[0].token_sha256=await sha256(allowedToken);
  raw.bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_denied',token_sha256:await sha256(deniedToken)});
  if(sharedFamily==='authority'){raw.config.human_grants[0].scopes.push('credentials:manage');raw.config.human_grants[0].delegable_native_scopes=[...scopes];}
  if(otherFamily||sharedFamily==='cursor'){
   if(typeof setupToken!=='string'||!/^D{42}A$/.test(setupToken))throw Error('PARITY_SETUP_TOKEN');
   raw.config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_other',display_name:'Parity recipient'});
   raw.config.static_credential_refs.push({...ref,credential_id:'credential_setup',agent_id:'agent_other',scopes:sharedFamily==='cursor'?['runtimes:manage','tasks:read']:['runtimes:manage','messages:send','messages:read']});
   raw.bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_setup',token_sha256:await sha256(setupToken)});
  }
  raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:2,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
  raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
  await this.reconcileConfiguration(operator(),await prepareBootstrap(raw.config,raw.bundle,'ws_example'));
  const identity=human(this.ctx.storage),body={title:'Parity source task',description:'Synthetic fixed read fixture',project_id:null,work_role_id:null,assigned_agent_id:'agent_research'};
  executeCommand(await commandContext(this.ctx.storage,name,body,'parity-seed-task'),identity,createTaskCommand('task_parity'),body);
  return raw.config;
 }
 async prepareLane(lane:'allowed'|'denied'){
  if(lane!=='allowed'&&lane!=='denied')throw Error('PARITY_LANE');
  const id='task_'+lane,identity=human(this.ctx.storage),body={title:'Parity task '+lane,description:'Synthetic task/run branch',project_id:null,work_role_id:null,assigned_agent_id:'agent_research'};
  executeCommand(await commandContext(this.ctx.storage,name,body,'create-'+lane),identity,createTaskCommand(id),body);
  const ready={expected_version:1};executeCommand(await commandContext(this.ctx.storage,name,ready,'ready-'+lane),identity,readyTaskCommand(id),ready);
  return {task_id:id,task_version:2};
 }
 async removeDeniedExecute(){
  const before=this.ctx.storage.sql.exec<Record<string,string|number|null>>("SELECT * FROM native_credentials WHERE credential_id='credential_denied'").one();
  if(typeof before.scopes_json!=='string')throw Error('PARITY_CONTROL');
  const prior=JSON.parse(before.scopes_json) as string[];
  if(JSON.stringify([...prior].sort())!==JSON.stringify([...scopes].sort())||before.revoked_at!==null)throw Error('PARITY_CONTROL');
  const next=prior.filter(s=>s!=='tasks:execute');
  const changed=this.ctx.storage.sql.exec("UPDATE native_credentials SET scopes_json=? WHERE credential_id='credential_denied' AND scopes_json=? RETURNING credential_id",JSON.stringify(next),before.scopes_json).toArray();
  if(changed.length!==1)throw Error('PARITY_CONTROL');
  const after=this.ctx.storage.sql.exec<Record<string,string|number|null>>("SELECT * FROM native_credentials WHERE credential_id='credential_denied'").one();
  if(JSON.stringify({...before,scopes_json:JSON.stringify(next)})!==JSON.stringify(after))throw Error('PARITY_CONTROL');
  return {kind:'test-only-current-scope-removal',credential_id:'credential_denied',removed:['tasks:execute'],other_fields_unchanged:true};
 }
 async revokeNative(){
  const body={expected_credential_version:1,reason:'Synthetic parity revocation'},identity=human(this.ctx.storage);
  return executeCommand(await commandContext(this.ctx.storage,name,body,'revoke-native'),identity,revokeCredentialCommand('credential_research_1'),body);
 }
 async objectSnapshot(){
  const bucket=productArtifactBucket(this.env);if(!bucket)throw Error('PARITY_BUCKET');
  const listed=await bucket.list({limit:17});if(listed.truncated||listed.objects.length>16)throw Error('PARITY_OBJECT_BUDGET');
  let total=0;for(const object of listed.objects){total+=object.size;if(!Number.isSafeInteger(object.size)||object.size<0||object.size>1048576||total>2097152||new TextEncoder().encode(object.key).byteLength>1024)throw Error('PARITY_OBJECT_BUDGET');}
  const result=[];for(const object of listed.objects){const read=await bucket.get(object.key);if(!read||read.size!==object.size||read.etag!==object.etag)throw Error('PARITY_OBJECT_CHANGED');const bytes=await read.arrayBuffer();if(bytes.byteLength!==object.size)throw Error('PARITY_OBJECT_CHANGED');const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');result.push({key_sha256:await sha256(object.key),size:bytes.byteLength,sha256:digest});}
  return result.sort((a,b)=>a.key_sha256.localeCompare(b.key_sha256));
 }
 async snapshot(){
  let total=0;
  const actual=this.ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").toArray().map(x=>x.name);
  if(JSON.stringify(actual)!==JSON.stringify(TABLE_REGISTRY.map(t=>t.name).sort()))throw Error('PARITY_SNAPSHOT_LAYOUT');
  for(const table of TABLE_REGISTRY){
   const columns=this.ctx.storage.sql.exec<{name:string;type:string;pk:number}>('PRAGMA table_info('+q(table.name)+')').toArray();
   if(columns.length!==table.columns.length||columns.some((c,i)=>c.name!==table.columns[i].name||c.type!==table.columns[i].type||c.pk!==table.columns[i].pk))throw Error('PARITY_SNAPSHOT_LAYOUT');
   const size=table.columns.map(c=>'coalesce(length(cast('+q(c.name)+' AS BLOB)),0)').join('+');
   const b=this.ctx.storage.sql.exec<{count:number;max_bytes:number;total_bytes:number}>('SELECT count(*) AS count,coalesce(max(bytes),0) AS max_bytes,coalesce(sum(bytes),0) AS total_bytes FROM (SELECT '+size+' AS bytes FROM '+q(table.name)+' LIMIT 129)').one();
   total+=b.total_bytes;if(b.count>128||b.max_bytes>65536||total>2097152)throw Error('PARITY_SNAPSHOT_BUDGET');
  }
  const captured:Record<string,Record<string,string|number|null>[]>={};
  for(const table of TABLE_REGISTRY){
   const rows=this.ctx.storage.sql.exec<Record<string,string|number|null>>('SELECT '+table.columns.map(c=>q(c.name)).join(',')+' FROM '+q(table.name)+' ORDER BY '+table.primaryKey.map(q).join(',')+' LIMIT 129').toArray();
   if(rows.length>128)throw Error('PARITY_SNAPSHOT_BUDGET');
   captured[table.name]=rows;
  }
  // No await between the complete preflight and complete detached row capture.
  const result:Record<string,{count:number;rows:{key:string;row:string}[]}>={};
  for(const table of TABLE_REGISTRY){
   const rows=captured[table.name];result[table.name]={count:rows.length,rows:[]};
   for(const row of rows)result[table.name].rows.push({key:await sha256(canonicalJson(table.primaryKey.map(k=>row[k]))),row:await sha256(canonicalJson(row))});
  }
  const fields:Record<string,string[]>={
   tasks:['id','state','task_version','next_fence','current_result_id','active_run_id','latest_run_id','retry_count','flags_json','created_at'],
   runs:['id','task_id','credential_id','runtime_instance_id','agent_id','run_version','status','fence','started_at','ended_at','lease_expires_at'],
   events:['id','type','resource_id','resource_version','thread_id','request_id','occurred_at','task_version','run_id','fence'],
   task_history:['id','event_id','task_id','task_version','run_id','kind','created_at'],
   task_results:['id','task_id','run_id','created_at'],
   messages:['id','workspace_id','thread_id','sender_kind','sender_principal_id','sender_agent_id','created_at'],threads:['id','workspace_id','created_at'],thread_participants:['thread_id','participant_kind','participant_id'],inbox:['message_id','recipient_agent_id','workspace_id','created_at','acknowledged_at'],
   artifacts:['id','artifact_version','status','byte_size','sha256','active_generation_id','committed_generation_id','committed_at'],artifact_generations:['id','artifact_id','state','expected_sha256','expected_byte_size','observed_sha256','observed_byte_size'],
   scheduler_state:['id','generation','dirty','next_due_at','armed_at'],artifact_inventory_state:['next_due_at']
  };
  const domain=Object.fromEntries(Object.entries(fields).map(([table,keys])=>[table,captured[table].map(row=>Object.fromEntries(keys.map(k=>[k,row[k]])))]));
  for(const message of domain.messages){const raw=captured.messages.find(row=>row.id===message.id)!;message.body_sha256=await sha256(String(raw.body));message.refs_sha256=await sha256(String(raw.refs_json));}
  for(const generation of domain.artifact_generations){const raw=captured.artifact_generations.find(row=>row.id===generation.id)!;generation.key_sha256=await sha256(String(raw.object_key));}
  return {tables:result,domain};
 }
}
export default {async fetch(request:Request,env:Env):Promise<Response>{
 const path=new URL(request.url).pathname,stub=env.WORKSPACE.getByName(name) as unknown as ParityFixtureDO;
 if(path==='/__fixture/seed'){const input=await request.json() as {scope:typeof allScopes[number];allowedToken:string;deniedToken:string;taskFamily?:boolean;otherFamily?:boolean;setupToken?:string;sharedFamily?:'cursor'|'authority'|'claim-loss'};return Response.json(await stub.seed(input.scope,input.allowedToken,input.deniedToken,input.taskFamily,input.otherFamily,input.setupToken,input.sharedFamily));}
 if(path==='/__fixture/prepare'){const input=await request.json() as {lane:'allowed'|'denied'};return Response.json(await stub.prepareLane(input.lane));}
 if(path==='/__fixture/revoke'){return Response.json(await stub.revokeNative());}
 if(path==='/__fixture/downscope')return Response.json(await stub.removeDeniedExecute());
 if(path==='/__fixture/settle'){await stub.repairSchedule();return new Response(null,{status:204});}
 if(path==='/__fixture/objects')return Response.json(await stub.objectSnapshot());
 if(path==='/__fixture/snapshot')return Response.json(await stub.snapshot());
 return worker.fetch(request,env);
}};
