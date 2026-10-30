import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {catalogFixture,catalogProfile,catalogSnapshot} from '../helpers/catalog';
import {fixture,operator} from '../helpers/environment';
import {human,commandContext} from '../helpers/settings';
import {taskContext,taskInput} from '../helpers/tasks';
import {prepareBootstrap,sha256,canonicalJson} from '../../src/config/bootstrap';
import {resolveActor} from '../../src/auth/authorize';
import {withTransaction,type WorkspaceTransaction} from '../../src/storage/transaction';
import {createTask} from '../../src/tasks/commands';
import {createAgent} from '../../src/agents/commands';
import {executeCommand} from '../../src/workspace/commands';
import {previewCatalogCommand,applyCatalogCommand,previewCatalogChange,applyCatalogChange} from '../../src/config/catalog-commands';
import type {CatalogPreviewRequest} from '../../src/http/dto';
const role:CatalogPreviewRequest={expected_profile_revision:1,kind:'work_role',id:'role_a',operation:'remap',replacement_id:'role_b',reason:'Synthetic bounds test'};
const project:CatalogPreviewRequest={...role,kind:'project',id:'project_a',replacement_id:'project_b'};
function agents(storage:DurableObjectStorage,total:number){storage.transactionSync(()=>{for(let i=1;i<total;i++)storage.sql.exec("INSERT INTO static_agents(agent_id,workspace_id,display_name,config_epoch,origin,work_role_ids_json) VALUES(?,'ws_example','Synthetic',1,'human_managed','[]')",'agent_bound_'+String(i).padStart(5,'0'));});}
function unrelatedTasks(storage:DurableObjectStorage,n:number){storage.transactionSync(()=>{for(let i=0;i<n;i++)storage.sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,project_id,work_role_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES(?,'ws_example','Synthetic','','backlog',1,0,'project_b','role_b',0,2,'[]',?,1)",'unrelated_'+String(i).padStart(5,'0'),i);});}
it('actual_empty_role_preview_and_apply_ignore_10000_unrelated_tasks',async()=>{
 const {stub,name}=await catalogFixture('catalog-bounds-unrelated');await runInDurableObject(stub,async(_o,state)=>{
  catalogProfile(state.storage);unrelatedTasks(state.storage,10000);const identity=human(state.storage),before=state.storage.sql.exec('SELECT SUM(task_version) AS versions,COUNT(*) AS n FROM tasks').one();
  const planned=executeCommand(await commandContext(state.storage,name,role,'preview'),identity,previewCatalogCommand('plan_empty'),role);expect(planned.data).toMatchObject({affected_task_ids:[],affected_agent_ids:[],conflicts:[]});
  const body={preview_id:planned.data.id,expected_profile_revision:1};expect(executeCommand(await commandContext(state.storage,name,body,'apply'),identity,applyCatalogCommand(),body).data.profile_revision).toBe(2);
  expect(state.storage.sql.exec('SELECT SUM(task_version) AS versions,COUNT(*) AS n FROM tasks').one()).toEqual(before);expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM idempotency_outcomes').one()).toEqual({n:2});
 });
},120000);
it.each([2048,2049])('empty_role_agent_scan_total_%i_is_bounded_and_fail_closed',async(total)=>{
 const {stub,name}=await catalogFixture('catalog-bounds-agents-'+total);await runInDurableObject(stub,async(_o,state)=>{
  catalogProfile(state.storage);agents(state.storage,total);const identity=human(state.storage),ctx=await commandContext(state.storage,name,role,'preview'),before=catalogSnapshot(state.storage);
  if(total===2048){const planned=executeCommand(ctx,identity,previewCatalogCommand('plan_cap'),role);expect(planned.data.affected_agent_ids).toEqual([]);const body={preview_id:planned.data.id,expected_profile_revision:1};expect(executeCommand(await commandContext(state.storage,name,body,'apply'),identity,applyCatalogCommand(),body).data.profile_revision).toBe(2);}
  else{expect(()=>executeCommand(ctx,identity,previewCatalogCommand('plan_cap'),role)).toThrowError(expect.objectContaining({code:'DEPENDENCY_UNAVAILABLE',status:503}));expect(catalogSnapshot(state.storage)).toEqual(before);}
 });
},120000);
it('project_operations_do_not_scan_or_depend_on_unrelated_agent_cap',async()=>{
 const {stub,name}=await catalogFixture('catalog-bounds-project');await runInDurableObject(stub,async(_o,state)=>{
  catalogProfile(state.storage);agents(state.storage,2049);const identity=human(state.storage),planned=executeCommand(await commandContext(state.storage,name,project,'preview'),identity,previewCatalogCommand('plan_project'),project);expect(planned.data.affected_agent_ids).toEqual([]);
  const body={preview_id:planned.data.id,expected_profile_revision:1};expect(executeCommand(await commandContext(state.storage,name,body,'apply'),identity,applyCatalogCommand(),body).data.profile_revision).toBe(2);
 });
},120000);
it('legal_project_restricted_catalog_operation_retains_access_without_widening',async()=>{
 const {stub}=await catalogFixture('catalog-bounds-restricted');await runInDurableObject(stub,(_o,state)=>{
  catalogProfile(state.storage);const ctx=taskContext(state.storage);withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'task_a'},{...taskInput,project_id:'project_a'}));state.storage.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_a\",\"project_b\"]'");
  const current=taskContext(state.storage),plan=withTransaction(state.storage,tx=>previewCatalogChange(tx,{...current,planId:'plan_allowed'},project));expect(plan.affected_task_ids).toEqual(['task_a']);expect(withTransaction(state.storage,tx=>applyCatalogChange(tx,current,{preview_id:plan.id,expected_profile_revision:1})).profile_revision).toBe(2);
  expect(state.storage.sql.exec('SELECT project_ids_json FROM human_grants').one()).toEqual({project_ids_json:'["project_a","project_b"]'});
 });
});
it.each(['profile','task','agent'] as const)('maximum_safe_%s_version_rejects_apply_and_rolls_back_exactly',async(kind)=>{
 const {stub,name}=await catalogFixture('catalog-bounds-overflow-'+kind);await runInDurableObject(stub,async(_o,state)=>{
  catalogProfile(state.storage);const domain=taskContext(state.storage),identity=human(state.storage);let request=project;
  if(kind==='task'){withTransaction(state.storage,tx=>createTask(tx,{...domain,taskId:'task_a'},{...taskInput,project_id:'project_a'}));state.storage.sql.exec('UPDATE tasks SET task_version=?',Number.MAX_SAFE_INTEGER);}
  else if(kind==='agent'){withTransaction(state.storage,tx=>createAgent(tx,{...domain,agentId:'agent_a'},{display_name:'Synthetic',description:'',work_role_ids:['role_a']}));state.storage.sql.exec("UPDATE static_agents SET agent_version=? WHERE agent_id='agent_a'",Number.MAX_SAFE_INTEGER);request=role;}
  else{state.storage.sql.exec('UPDATE profiles SET version=?',Number.MAX_SAFE_INTEGER);request={...project,expected_profile_revision:Number.MAX_SAFE_INTEGER};}
  const plan=executeCommand(await commandContext(state.storage,name,request,'preview'),identity,previewCatalogCommand('plan_max'),request).data;const body={preview_id:plan.id,expected_profile_revision:request.expected_profile_revision},ctx=await commandContext(state.storage,name,body,'apply'),before=catalogSnapshot(state.storage);
  expect(()=>executeCommand(ctx,identity,applyCatalogCommand(),body)).toThrowError(expect.objectContaining({code:'LIMIT_EXCEEDED',status:409}));expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
it('changed_preview_payload_same_key_conflicts_without_mutating_original_plan',async()=>{
 const {stub,name}=await catalogFixture('catalog-bounds-fingerprint');await runInDurableObject(stub,async(_o,state)=>{
  catalogProfile(state.storage);const identity=human(state.storage);executeCommand(await commandContext(state.storage,name,role,'same'),identity,previewCatalogCommand('plan_a'),role);const changed={...role,reason:'Different reviewed intent'},ctx=await commandContext(state.storage,name,changed,'same'),before=catalogSnapshot(state.storage);
  expect(()=>executeCommand(ctx,identity,previewCatalogCommand('plan_b'),changed)).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT',status:409}));expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
it('plan_ID_is_NOT_FOUND_to_another_legitimately_installed_principal',async()=>{
 const name='catalog-bounds-owner',raw=await fixture(name);raw.config.human_grants[0].scopes=[...raw.config.human_grants[0].scopes,'tasks:read','tasks:create','tasks:edit','agents:read','agents:manage'];raw.config.human_grants.push({...structuredClone(raw.config.human_grants[0]),principal_id:'human_second',subject:'second-subject'});
 raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:1,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[],replay_safety_rules:[]};raw.bundle.config_digest=await sha256(canonicalJson(raw.config));const stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration(operator(),await prepareBootstrap(raw.config,raw.bundle,'ws_example'));
 await runInDurableObject(stub,(_o,state)=>{
  catalogProfile(state.storage);const ctx=taskContext(state.storage),plan=withTransaction(state.storage,tx=>previewCatalogChange(tx,{...ctx,planId:'plan_owner'},role)),now=Date.now();
  state.storage.sql.exec("INSERT INTO sessions(id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,auth_epoch) VALUES('session_second','ws_example','human_second','synthetic_second_digest','synthetic_csrf','https://identity.example.invalid','second-subject',?,?,1)",now,now+1000000);
  const second=withTransaction(state.storage,tx=>resolveActor(tx,{kind:'human',workspaceId:'ws_example',sessionId:'session_second',issuer:'https://identity.example.invalid',subject:'second-subject'},now));const before=catalogSnapshot(state.storage);
  expect(()=>withTransaction(state.storage,tx=>applyCatalogChange(tx,{...ctx,actor:second},{preview_id:plan.id,expected_profile_revision:1}))).toThrowError(expect.objectContaining({code:'NOT_FOUND',status:404}));expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
it('implemented_CASE_key_query_uses_reference_index_without_temp_sort_or_unrelated_reads',async()=>{
 const {stub}=await catalogFixture('catalog-bounds-query');await runInDurableObject(stub,(_o,state)=>{
  catalogProfile(state.storage);unrelatedTasks(state.storage,10000);const ctx=taskContext(state.storage),queries:{sql:string;bindings:readonly (string|number|null|ArrayBuffer)[]}[]=[];
  withTransaction(state.storage,tx=>{const instrument:WorkspaceTransaction={...tx,all<T>(sql:string,bindings=[]){if(sql.includes('FROM tasks INDEXED BY'))queries.push({sql,bindings});return tx.all<T>(sql,bindings);}};expect(previewCatalogChange(instrument,{...ctx,planId:'plan_query'},role).affected_task_ids).toEqual([]);});
  expect(queries).toHaveLength(1);const query=queries[0];expect(query.sql).toContain('CASE WHEN');expect(query.sql).toContain('ORDER BY tasks.id LIMIT 201');const plan=state.storage.sql.exec('EXPLAIN QUERY PLAN '+query.sql,...query.bindings).toArray(),cursor=state.storage.sql.exec(query.sql,...query.bindings);expect(cursor.toArray()).toEqual([]);expect(cursor.rowsRead).toBeLessThanOrEqual(1);expect(JSON.stringify(plan)).toContain('tasks_catalog_role');expect(JSON.stringify(plan)).not.toContain('TEMP B-TREE');console.log('CATALOG_IMPLEMENTED_QUERY '+JSON.stringify({rowsRead:cursor.rowsRead,plan}));
 });
},120000);
it('apply_rechecks_agent_scan_cap_after_an_empty_role_preview',async()=>{
 const {stub,name}=await catalogFixture('catalog-bounds-cap-changed');await runInDurableObject(stub,async(_o,state)=>{
  catalogProfile(state.storage);agents(state.storage,2048);const identity=human(state.storage),plan=executeCommand(await commandContext(state.storage,name,role,'preview'),identity,previewCatalogCommand('plan_before_cap'),role).data;
  state.storage.sql.exec("INSERT INTO static_agents(agent_id,workspace_id,display_name,config_epoch,origin,work_role_ids_json) VALUES('agent_new','ws_example','Synthetic',1,'human_managed','[]')");const body={preview_id:plan.id,expected_profile_revision:1},ctx=await commandContext(state.storage,name,body,'apply'),before=catalogSnapshot(state.storage);
  expect(()=>executeCommand(ctx,identity,applyCatalogCommand(),body)).toThrowError(expect.objectContaining({code:'DEPENDENCY_UNAVAILABLE',status:503}));expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
