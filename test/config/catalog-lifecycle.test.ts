import {it,expect} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {catalogFixture,catalogProfile,catalogSnapshot} from '../helpers/catalog';
import {taskContext,taskInput} from '../helpers/tasks';
import {human,commandContext} from '../helpers/settings';
import {withTransaction} from '../../src/storage/transaction';
import {createTask} from '../../src/tasks/commands';
import {createAgent} from '../../src/agents/commands';
import {storedProfile,applyProfile,previewProfile} from '../../src/config/profile';
import {executeCommand} from '../../src/workspace/commands';
import {previewCatalogChange,applyCatalogChange,previewCatalogCommand,applyCatalogCommand} from '../../src/config/catalog-commands';
import type {CatalogPreviewRequest,CatalogPlan} from '../../src/http/dto';
const archive:CatalogPreviewRequest={expected_profile_revision:1,kind:'project',id:'project_a',operation:'archive',replacement_id:null,reason:'Synthetic archive review'};
const remap:CatalogPreviewRequest={...archive,operation:'remap',replacement_id:'project_b'};
const role:CatalogPreviewRequest={...remap,kind:'work_role',id:'role_a',replacement_id:'role_b'};
function seed(storage:DurableObjectStorage){catalogProfile(storage);return taskContext(storage);}
function task(storage:DurableObjectStorage,id='task_a',project='project_a',workRole:string|null=null){const ctx=taskContext(storage);return withTransaction(storage,tx=>createTask(tx,{...ctx,taskId:id},{...taskInput,project_id:project,work_role_id:workRole}));}
function preview(storage:DurableObjectStorage,body=remap,id='plan_a'){const ctx=taskContext(storage);return withTransaction(storage,tx=>previewCatalogChange(tx,{...ctx,planId:id},body));}
function apply(storage:DurableObjectStorage,id='plan_a',nowMs?:number){const ctx=taskContext(storage);return withTransaction(storage,tx=>applyCatalogChange(tx,{...ctx,nowMs:nowMs??ctx.nowMs},{preview_id:id,expected_profile_revision:1}));}
function agent(storage:DurableObjectStorage,id='agent_a'){const ctx=taskContext(storage);return withTransaction(storage,tx=>createAgent(tx,{...ctx,agentId:id},{display_name:id,description:'',work_role_ids:['role_a']}));}
it('archive_retains_history_blocks_new_selection_and_does_not_rewrite_tasks',async()=>{
 const {stub}=await catalogFixture('catalog-archive');await runInDurableObject(stub,(_o,state)=>{
  seed(state.storage);task(state.storage);task(state.storage,'task_done');state.storage.sql.exec("UPDATE tasks SET state='done' WHERE id='task_done'");
  const before=state.storage.sql.exec('SELECT * FROM tasks ORDER BY id').toArray(),plan=preview(state.storage,archive);
  expect(plan.affected_task_ids).toEqual(['task_a','task_done']);expect(plan.conflicts).toEqual([]);
  expect(apply(state.storage)).toMatchObject({profile_revision:2,profile:{projects:[{id:'project_a',archived:true},{id:'project_b',archived:false}]}});
  expect(state.storage.sql.exec('SELECT * FROM tasks ORDER BY id').toArray()).toEqual(before);
  expect(()=>task(state.storage,'new_task')).toThrowError(expect.objectContaining({code:'NOT_FOUND'}));
 });
});
it('remap_changes_only_eligible_metadata_increments_versions_and_keeps_terminal_history',async()=>{
 const {stub}=await catalogFixture('catalog-remap');await runInDurableObject(stub,(_o,state)=>{
  seed(state.storage);task(state.storage);task(state.storage,'task_done');state.storage.sql.exec("UPDATE tasks SET state='done' WHERE id='task_done'");
  preview(state.storage);apply(state.storage);
  expect(state.storage.sql.exec('SELECT id,project_id,task_version FROM tasks ORDER BY id').toArray()).toEqual([{id:'task_a',project_id:'project_b',task_version:2},{id:'task_done',project_id:'project_a',task_version:1}]);
  expect(state.storage.sql.exec('SELECT status FROM catalog_plans').one()).toEqual({status:'applied'});
 });
});
it('role_remap_updates_explicit_active_agent_metadata_without_grant_changes',async()=>{
 const {stub}=await catalogFixture('catalog-role');await runInDurableObject(stub,(_o,state)=>{
  seed(state.storage);task(state.storage,'task_a','project_a','role_a');agent(state.storage);agent(state.storage,'agent_history');state.storage.sql.exec("UPDATE static_agents SET status='archived' WHERE agent_id='agent_history'");
  const grants=state.storage.sql.exec('SELECT * FROM native_credentials').toArray();const plan=preview(state.storage,role);expect(plan.affected_agent_ids).toEqual(['agent_a','agent_history']);apply(state.storage);
  expect(state.storage.sql.exec("SELECT work_role_ids_json,agent_version FROM static_agents WHERE agent_id='agent_a'").one()).toEqual({work_role_ids_json:'["role_b"]',agent_version:2});
  expect(state.storage.sql.exec("SELECT work_role_ids_json,agent_version FROM static_agents WHERE agent_id='agent_history'").one()).toEqual({work_role_ids_json:'["role_a"]',agent_version:1});expect(state.storage.sql.exec('SELECT * FROM native_credentials').toArray()).toEqual(grants);
 });
});
it.each(['added','removed','changed'] as const)('complete_reference_set_rejects_%s_reference_with_no_partial_writes',async(change)=>{
 const {stub}=await catalogFixture('catalog-set-'+change);await runInDurableObject(stub,(_o,state)=>{
  seed(state.storage);task(state.storage);preview(state.storage);
  if(change==='added')task(state.storage,'task_new');else state.storage.sql.exec("UPDATE tasks SET project_id=?,task_version=task_version+1 WHERE id='task_a'",change==='removed'?'project_b':'project_a');
  const before=catalogSnapshot(state.storage);expect(()=>apply(state.storage)).toThrowError(expect.objectContaining({code:'VERSION_CONFLICT'}));expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
it.each(['profile','agent'] as const)('stale_%s_rejects_entire_plan',async(kind)=>{
 const {stub}=await catalogFixture('catalog-stale-'+kind);await runInDurableObject(stub,(_o,state)=>{
  seed(state.storage);agent(state.storage);preview(state.storage,role);
  if(kind==='profile')state.storage.sql.exec('UPDATE profiles SET version=version+1');else state.storage.sql.exec("UPDATE static_agents SET agent_version=agent_version+1 WHERE agent_id='agent_a'");
  const before=catalogSnapshot(state.storage);expect(()=>apply(state.storage)).toThrowError(expect.objectContaining({code:'VERSION_CONFLICT'}));expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
it('preview_expires_at_exact_15_minute_boundary_and_cannot_apply',async()=>{
 const {stub}=await catalogFixture('catalog-expiry');await runInDurableObject(stub,(_o,state)=>{
  const ctx=seed(state.storage);const plan=withTransaction(state.storage,tx=>previewCatalogChange(tx,{...ctx,planId:'plan_a'},archive));expect(Date.parse(plan.expires_at)).toBe(ctx.nowMs+900000);
  const before=catalogSnapshot(state.storage);expect(()=>apply(state.storage,'plan_a',Date.parse(plan.expires_at))).toThrowError(expect.objectContaining({status:409}));expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
it.each(['waiting','review','approved'] as const)('remap_conflicts_on_%s_intent_without_changes',async(kind)=>{
 const {stub}=await catalogFixture('catalog-live-'+kind);await runInDurableObject(stub,(_o,state)=>{
  seed(state.storage);task(state.storage);state.storage.sql.exec("UPDATE tasks SET state=?,approval_id=? WHERE id='task_a'",kind==='approved'?'ready':kind,kind==='approved'?'approved_intent':null);
  const plan=preview(state.storage);expect(plan.conflicts.length).toBeGreaterThan(0);const before=catalogSnapshot(state.storage);expect(()=>apply(state.storage)).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
it('remap_refuses_policy_rewrite_while_archive_preserves_operator_rules',async()=>{
 const {stub}=await catalogFixture('catalog-policy');await runInDurableObject(stub,(_o,state)=>{
  seed(state.storage);const row=state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one(),config=JSON.parse(row.config_json);config.workspace_policies[0].execution_policy.eligibility_rules=[{project_id:'project_a',work_role_id:null,eligible_agent_ids:['agent_research']}];state.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',JSON.stringify(config));
  const plan=preview(state.storage);expect(plan.conflicts.length).toBeGreaterThan(0);expect(()=>apply(state.storage)).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
  preview(state.storage,archive,'plan_archive');apply(state.storage,'plan_archive');expect(state.storage.sql.exec('SELECT config_json FROM workspace_metadata').one()).toEqual({config_json:JSON.stringify(config)});
 });
});
it.each([200,201])('combined_affected_limit_%s_is_not_truncated',async(n)=>{
 const {stub}=await catalogFixture('catalog-bound-'+n);await runInDurableObject(stub,(_o,state)=>{
  seed(state.storage);for(let i=0;i<n;i++)task(state.storage,'task_'+String(i).padStart(3,'0'));
  const before=catalogSnapshot(state.storage);
  if(n===200)expect(preview(state.storage,archive).affected_task_ids).toHaveLength(200);
  else{expect(()=>preview(state.storage,archive)).toThrowError(expect.objectContaining({code:'LIMIT_EXCEEDED'}));expect(catalogSnapshot(state.storage)).toEqual(before);}
 });
});
it('hidden_reference_denies_without_returning_ids_or_partial_plan',async()=>{
 const {stub}=await catalogFixture('catalog-hidden');await runInDurableObject(stub,(_o,state)=>{
  seed(state.storage);task(state.storage,'secret','project_b','role_a');state.storage.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_a\"]'");const before=catalogSnapshot(state.storage);
  expect(()=>preview(state.storage,role)).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
it('new_hidden_reference_after_preview_denies_before_version_conflict',async()=>{
 const {stub}=await catalogFixture('catalog-new-hidden');await runInDurableObject(stub,(_o,state)=>{
  seed(state.storage);task(state.storage,'visible','project_a','role_a');preview(state.storage,role);task(state.storage,'secret','project_b','role_a');state.storage.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_a\"]'");const before=catalogSnapshot(state.storage);
  expect(()=>apply(state.storage)).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
it.each(['tasks:edit','agents:manage'] as const)('remap_requires_current_extra_%s_scope',async(scope)=>{
 const {stub}=await catalogFixture('catalog-scope-'+scope.replace(':','-'));await runInDurableObject(stub,(_o,state)=>{
  seed(state.storage);if(scope==='tasks:edit')task(state.storage);else agent(state.storage);preview(state.storage,scope==='tasks:edit'?remap:role);
  const row=state.storage.sql.exec<{scopes_json:string}>('SELECT scopes_json FROM human_grants').one();state.storage.sql.exec('UPDATE human_grants SET scopes_json=?',JSON.stringify((JSON.parse(row.scopes_json) as string[]).filter(x=>x!==scope)));
  const before=catalogSnapshot(state.storage);expect(()=>apply(state.storage)).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
it('wrapper_replay_is_original_after_profile_advances_but_current_authority_is_required',async()=>{
 const {stub,name}=await catalogFixture('catalog-replay');await runInDurableObject(stub,async(_o,state)=>{
  const domain=seed(state.storage),identity=human(state.storage),pc=await commandContext(state.storage,name,remap,'preview');task(state.storage);
  const first=executeCommand(pc,identity,previewCatalogCommand('plan_a'),remap);expect(executeCommand(pc,identity,previewCatalogCommand('ignored_new_plan'),remap)).toEqual(first);
  const body={preview_id:first.data.id,expected_profile_revision:1},ac=await commandContext(state.storage,name,body,'apply');const result=executeCommand(ac,identity,applyCatalogCommand(),body);
  const current=withTransaction(state.storage,tx=>storedProfile(tx,domain.actor));withTransaction(state.storage,tx=>applyProfile(tx,taskContext(state.storage),{expected_profile_revision:2,profile:{...current.profile,display_name:'Later'}}));
  const before=catalogSnapshot(state.storage);expect(executeCommand(ac,identity,applyCatalogCommand(),body)).toEqual(result);expect(catalogSnapshot(state.storage)).toEqual(before);
  state.storage.sql.exec('UPDATE sessions SET revoked_at=1');expect(()=>executeCommand(ac,identity,applyCatalogCommand(),body)).toThrowError(expect.objectContaining({status:401}));
 });
});
it('different_key_second_apply_cannot_commit_and_failure_after_first_remap_rolls_back_everything',async()=>{
 const {stub,name}=await catalogFixture('catalog-rollback');await runInDurableObject(stub,async(_o,state)=>{
  seed(state.storage);task(state.storage,'task_a');task(state.storage,'task_b');preview(state.storage);const identity=human(state.storage),body={preview_id:'plan_a',expected_profile_revision:1},ctx=await commandContext(state.storage,name,body,'apply');
  state.storage.sql.exec("CREATE TRIGGER fail_second_remap BEFORE UPDATE ON tasks WHEN OLD.id='task_b' BEGIN SELECT RAISE(ABORT,'synthetic_second_remap_abort'); END");const before=catalogSnapshot(state.storage);
  expect(()=>executeCommand(ctx,identity,applyCatalogCommand(),body)).toThrow('synthetic_second_remap_abort');expect(catalogSnapshot(state.storage)).toEqual(before);state.storage.sql.exec('DROP TRIGGER fail_second_remap');
  executeCommand(ctx,identity,applyCatalogCommand(),body);const after=catalogSnapshot(state.storage);expect(()=>executeCommand({...ctx,idempotencyKey:'second'},identity,applyCatalogCommand(),body)).toThrowError(expect.objectContaining({status:409}));expect(catalogSnapshot(state.storage)).toEqual(after);
 });
});
it('preview_survives_DO_restart_and_retains_immutable_review_payload',async()=>{
 const {stub}=await catalogFixture('catalog-restart');let plan:CatalogPlan|undefined;let saved:unknown;
 await runInDurableObject(stub,(_o,state)=>{seed(state.storage);task(state.storage);plan=preview(state.storage);saved=state.storage.sql.exec('SELECT plan_json,touched_versions_json,created_at,expires_at FROM catalog_plans').one();});
 await evictDurableObject(stub);
 await runInDurableObject(stub,(_o,state)=>{expect(state.storage.sql.exec('SELECT plan_json,touched_versions_json,created_at,expires_at FROM catalog_plans').one()).toEqual(saved);expect(apply(state.storage,plan!.id).profile_revision).toBe(2);expect(state.storage.sql.exec('SELECT plan_json,touched_versions_json,created_at,expires_at FROM catalog_plans').one()).toEqual(saved);});
});
it('profile_import_cannot_archive_or_unarchive_and_omission_preserves_ids',async()=>{
 const {stub}=await catalogFixture('catalog-import');await runInDurableObject(stub,(_o,state)=>{
  const ctx=seed(state.storage),original=withTransaction(state.storage,tx=>storedProfile(tx,ctx.actor));
  const archiving={expected_profile_revision:1,profile:{...original.profile,projects:original.profile.projects.map(p=>({...p,archived:true}))}};expect(()=>withTransaction(state.storage,tx=>applyProfile(tx,ctx,archiving))).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
  preview(state.storage,archive);const archived=apply(state.storage);expect(()=>withTransaction(state.storage,tx=>applyProfile(tx,ctx,{expected_profile_revision:2,profile:original.profile}))).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
  const saved=withTransaction(state.storage,tx=>applyProfile(tx,ctx,{expected_profile_revision:2,profile:{...archived.profile,projects:[],work_roles:[]}}));expect(saved.profile.projects).toEqual(archived.profile.projects);expect(saved.profile.work_roles).toEqual(archived.profile.work_roles);
 });
});
it('duplicate_ids_reject_but_duplicate_labels_are_advisory_and_can_save',async()=>{
 const {stub}=await catalogFixture('catalog-duplicates');await runInDurableObject(stub,(_o,state)=>{
  const ctx=seed(state.storage),current=withTransaction(state.storage,tx=>storedProfile(tx,ctx.actor));const duplicate={expected_profile_revision:1,profile:{...current.profile,projects:[current.profile.projects[0],current.profile.projects[0]]}};
  expect(()=>withTransaction(state.storage,tx=>applyProfile(tx,ctx,duplicate))).toThrowError(expect.objectContaining({code:'INVALID_REQUEST'}));
  const labels={expected_profile_revision:1,profile:{...current.profile,projects:current.profile.projects.map(p=>({...p,display_name:'Same'}))}};const advisory=withTransaction(state.storage,tx=>previewProfile(tx,ctx,labels));expect(advisory.conflicts.length).toBeGreaterThan(0);expect(withTransaction(state.storage,tx=>applyProfile(tx,ctx,labels)).profile_revision).toBe(2);
 });
});
it('combined_task_and_agent_limit_counts_both_resource_families',async()=>{
 const {stub}=await catalogFixture('catalog-combined');await runInDurableObject(stub,(_o,state)=>{
  seed(state.storage);for(let i=0;i<199;i++)task(state.storage,'task_'+String(i).padStart(3,'0'),'project_a','role_a');agent(state.storage);expect(preview(state.storage,role,'plan_200')).toMatchObject({affected_agent_ids:['agent_a']});agent(state.storage,'agent_b');const before=catalogSnapshot(state.storage);expect(()=>preview(state.storage,role,'plan_201')).toThrowError(expect.objectContaining({code:'LIMIT_EXCEEDED'}));expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
it('doing_reference_conflicts_without_ending_or_rewriting_the_run',async()=>{
 const {stub}=await catalogFixture('catalog-doing');await runInDurableObject(stub,(_o,state)=>{
  seed(state.storage);task(state.storage);
  state.storage.sql.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES('runtime','ws_example','agent_research','credential_research_1',1,?,1,'Synthetic','online',1,1,9999999999999)",'1'.repeat(64));
  state.storage.sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at) VALUES('run','ws_example','task_a','agent_research','runtime','credential_research_1',1,'active',1,1,9999999999999,1)");state.storage.sql.exec("UPDATE tasks SET state='doing',active_run_id='run',latest_run_id='run' WHERE id='task_a'");
  const runs=state.storage.sql.exec('SELECT * FROM runs').toArray();expect(preview(state.storage).conflicts.length).toBeGreaterThan(0);const before=catalogSnapshot(state.storage);expect(()=>apply(state.storage)).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));expect(catalogSnapshot(state.storage)).toEqual(before);expect(state.storage.sql.exec('SELECT * FROM runs').toArray()).toEqual(runs);
 });
});
it.each([
 {...archive,replacement_id:'project_b'},
 {...remap,replacement_id:null},
 {...remap,replacement_id:'project_a'},
 {...remap,replacement_id:'role_b'},
])('invalid_catalog_transition_rejects_atomically %#',async(body)=>{
 const {stub}=await catalogFixture('catalog-invalid-'+body.operation+'-'+String(body.replacement_id));await runInDurableObject(stub,(_o,state)=>{seed(state.storage);const before=catalogSnapshot(state.storage);expect(()=>preview(state.storage,body)).toThrowError(expect.objectContaining({code:expect.stringMatching(/^(INVALID_REQUEST|NOT_FOUND|INVALID_STATE)$/)}));expect(catalogSnapshot(state.storage)).toEqual(before);});
});
