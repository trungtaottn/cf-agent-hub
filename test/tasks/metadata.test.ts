import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {taskFixture,taskContext,taskInput,taskProfile,taskCounts} from '../helpers/tasks';
import {human,commandContext} from '../helpers/settings';
import {withTransaction} from '../../src/storage/transaction';
import {createTask,patchTask,readyTask,createTaskCommand,patchTaskCommand,readyTaskCommand} from '../../src/tasks/commands';
import {resolveActor} from '../../src/auth/authorize';
import {applyProfile,storedProfile} from '../../src/config/profile';
import {executeCommand} from '../../src/workspace/commands';
import type {TaskCreateRequest,TaskPatchRequest} from '../../src/http/dto';
it('create_is_server_owned_backlog',async()=>{
 const {stub}=await taskFixture('metadata-create');await runInDurableObject(stub,(_o,state)=>{
  const ctx=taskContext(state.storage);const task=withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'task_a'},taskInput));
  expect(task).toMatchObject({id:'task_a',state:'backlog',task_version:1,proposal_version:0,retry_count:0,retry_limit:2,active_run_id:null,latest_run_id:null,approval_id:null,result:null,flags:[],project_id:null,work_role_id:null,assigned_agent_id:null});
  expect(state.storage.sql.exec("SELECT next_fence,next_result_sequence FROM tasks WHERE id='task_a'").one()).toEqual({next_fence:1,next_result_sequence:1});
 });
});
it('creation_rejects_unknown_authority_fields_and_missing_policy_atomically',async()=>{
 const {stub}=await taskFixture('metadata-authority');await runInDurableObject(stub,(_o,state)=>{
  const ctx=taskContext(state.storage),before=taskCounts(state.storage);
  for(const field of ['state','task_version','proposal_version','retry_limit','retry_count','active_run_id','result','owner','fence','flags'])expect(()=>withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'bad'}, {...taskInput,[field]:1} as TaskCreateRequest))).toThrowError(expect.objectContaining({code:'INVALID_REQUEST'}));
  expect(taskCounts(state.storage)).toEqual(before);
 });
 const absent=await taskFixture('metadata-policy-absent',false);await runInDurableObject(absent.stub,(_o,state)=>{const ctx=taskContext(state.storage),before=taskCounts(state.storage);expect(()=>withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'bad'},taskInput))).toThrowError(expect.objectContaining({code:'DEPENDENCY_UNAVAILABLE'}));expect(taskCounts(state.storage)).toEqual(before);});
});
it('metadata_patch_rejects_authority_fields_empty_and_stale_versions',async()=>{
 const {stub}=await taskFixture('metadata-patch');await runInDurableObject(stub,(_o,state)=>{
  const ctx=taskContext(state.storage);withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'task_a'},taskInput));const before=taskCounts(state.storage);
  for(const body of [{expected_version:1},{expected_version:1,title:'Changed',state:'ready'},{expected_version:1,retry_count:0}])expect(()=>withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',body as TaskPatchRequest))).toThrowError(expect.objectContaining({code:'INVALID_REQUEST'}));
  expect(()=>withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',{expected_version:2,title:'Stale'}))).toThrowError(expect.objectContaining({code:'VERSION_CONFLICT'}));
  expect(taskCounts(state.storage)).toEqual(before);expect(withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',{expected_version:1,title:'Changed'}))).toMatchObject({title:'Changed',task_version:2,proposal_version:0,retry_limit:2});
 });
});
it('every_metadata_edit_rejects_live_or_approved_intent',async()=>{
 const {stub}=await taskFixture('metadata-state');await runInDurableObject(stub,(_o,state)=>{
  const ctx=taskContext(state.storage);withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'task_a'},taskInput));
  for(const status of ['waiting','review','done','cancelled']){state.storage.sql.exec("UPDATE tasks SET state=? WHERE id='task_a'",status);for(const field of ['title','description','project_id','work_role_id','assigned_agent_id'])expect(()=>withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',{expected_version:1,[field]:field==='title'?'changed':null} as TaskPatchRequest))).toThrow();}
  state.storage.sql.exec("UPDATE tasks SET state='ready',approval_id='synthetic_approved',proposal_version=4 WHERE id='task_a'");expect(()=>withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',{expected_version:1,description:'changed'}))).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
  expect(state.storage.sql.exec("SELECT task_version,proposal_version,approval_id FROM tasks WHERE id='task_a'").one()).toEqual({task_version:1,proposal_version:4,approval_id:'synthetic_approved'});
 });
});
it('references_are_current_same_workspace_active_and_project_restricted',async()=>{
 const {stub}=await taskFixture('metadata-references');await runInDurableObject(stub,(_o,state)=>{
  const ctx=taskContext(state.storage);taskProfile(state.storage);
  withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'task_a'},{...taskInput,project_id:'project_a',work_role_id:'role_a',assigned_agent_id:'agent_research'}));
  for(const field of ['project_id','work_role_id','assigned_agent_id'])expect(()=>withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',{expected_version:1,[field]:'foreign'}))).toThrowError(expect.objectContaining({code:'NOT_FOUND'}));
  state.storage.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_a\"]'");
  expect(()=>withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',{expected_version:1,project_id:'project_b'}))).toThrowError(expect.objectContaining({status:403}));
  expect(()=>withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',{expected_version:1,project_id:null}))).toThrowError(expect.objectContaining({status:403}));
  state.storage.sql.exec("UPDATE static_agents SET status='archived' WHERE agent_id='agent_research'");expect(()=>withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',{expected_version:1,title:'Changed'}))).toThrowError(expect.objectContaining({code:'NOT_FOUND'}));
  state.storage.sql.exec("UPDATE human_grants SET project_ids_json='[]'");expect(()=>withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'none'},taskInput))).toThrowError(expect.objectContaining({status:403}));
 });
});
it('ready_has_exact_eligibility_no_run_and_holds_cannot_be_cleared',async()=>{
 const {stub}=await taskFixture('metadata-ready');await runInDurableObject(stub,(_o,state)=>{
  const ctx=taskContext(state.storage);withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'task_a'},taskInput));
  for(const flag of ['outcome_unknown','retry_exhausted']){state.storage.sql.exec("UPDATE tasks SET flags_json=? WHERE id='task_a'",JSON.stringify([flag]));expect(()=>withTransaction(state.storage,tx=>readyTask(tx,ctx,'task_a',{expected_version:1}))).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));}
  state.storage.sql.exec("UPDATE tasks SET flags_json='[]' WHERE id='task_a'");expect(withTransaction(state.storage,tx=>readyTask(tx,ctx,'task_a',{expected_version:1}))).toMatchObject({task:{state:'ready',task_version:2,retry_count:0,retry_limit:2,active_run_id:null},run:null,approval:null});
  expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM runs').one()).toEqual({n:0});expect(()=>withTransaction(state.storage,tx=>readyTask(tx,ctx,'task_a',{expected_version:2}))).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
 });
});
it('command_event_outcome_are_atomic_and_replay_does_not_reapply_old_versions',async()=>{
 const {stub,name}=await taskFixture('metadata-wrapper');await runInDurableObject(stub,async(_o,state)=>{
  const identity=human(state.storage),command=createTaskCommand('task_a'),ctx=await commandContext(state.storage,name,taskInput,'create');
  expect(executeCommand(ctx,identity,command,taskInput)).toMatchObject({status:201,data:{id:'task_a',task_version:1}});
  const body={expected_version:1,title:'New'},patch=await commandContext(state.storage,name,body,'patch');executeCommand(patch,identity,patchTaskCommand('task_a'),body);const count=taskCounts(state.storage);
  expect(executeCommand(ctx,identity,command,taskInput)).toMatchObject({data:{task_version:1,title:taskInput.title}});expect(taskCounts(state.storage)).toEqual(count);
  state.storage.sql.exec("UPDATE sessions SET revoked_at=1");expect(()=>executeCommand(ctx,identity,command,taskInput)).toThrowError(expect.objectContaining({status:401}));
 });
});
it('execute_abort_rolls_back_task_event_and_outcome',async()=>{
 const {stub,name}=await taskFixture('metadata-abort');await runInDurableObject(stub,async(_o,state)=>{
  const identity=human(state.storage),ctx=await commandContext(state.storage,name,taskInput,'abort'),before=taskCounts(state.storage);
  state.storage.sql.exec("CREATE TRIGGER reject_task_event BEFORE INSERT ON events WHEN NEW.resource_type='task' BEGIN SELECT RAISE(ABORT,'synthetic_task_abort'); END");expect(()=>executeCommand(ctx,identity,createTaskCommand('task_a'),taskInput)).toThrow('synthetic_task_abort');expect(taskCounts(state.storage)).toEqual(before);
 });
});
it('create_and_ready_replay_preserve_original_outcome_after_state_advances',async()=>{
 const {stub,name}=await taskFixture('metadata-replay-state');await runInDurableObject(stub,async(_o,state)=>{
  const identity=human(state.storage),create=await commandContext(state.storage,name,taskInput,'create'),body={expected_version:1},ready=await commandContext(state.storage,name,body,'ready');
  executeCommand(create,identity,createTaskCommand('task_a'),taskInput);const original=executeCommand(ready,identity,readyTaskCommand('task_a'),body);
  state.storage.sql.exec("UPDATE tasks SET state='review',task_version=3 WHERE id='task_a'");const before=taskCounts(state.storage);expect(executeCommand(ready,identity,readyTaskCommand('task_a'),body)).toEqual(original);expect(taskCounts(state.storage)).toEqual(before);
  state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"tasks:read\"]'");expect(()=>executeCommand(ready,identity,readyTaskCommand('task_a'),body)).toThrowError(expect.objectContaining({status:403}));
 });
});
it('replay_rechecks_original_project_without_reapplying_active_catalog_preconditions',async()=>{
 const {stub,name}=await taskFixture('metadata-replay-project');await runInDurableObject(stub,async(_o,state)=>{
  const identity=human(state.storage);taskProfile(state.storage);const body={...taskInput,project_id:'project_a',assigned_agent_id:'agent_research'},ctx=await commandContext(state.storage,name,body,'create');
  const original=executeCommand(ctx,identity,createTaskCommand('task_a'),body);
  state.storage.sql.exec("UPDATE static_agents SET status='archived' WHERE agent_id='agent_research'");expect(executeCommand(ctx,identity,createTaskCommand('task_a'),body)).toEqual(original);
  state.storage.sql.exec("UPDATE tasks SET project_id='project_b' WHERE id='task_a'");state.storage.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_b\"]'");expect(()=>executeCommand(ctx,identity,createTaskCommand('task_a'),body)).toThrowError(expect.objectContaining({status:403}));
 });
});
it('doing_task_metadata_rejects_and_fixed_retry_and_holds_survive_patch',async()=>{
 const {stub}=await taskFixture('metadata-doing');await runInDurableObject(stub,(_o,state)=>{
  const ctx=taskContext(state.storage);withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'task_a'},taskInput));
  state.storage.sql.exec("UPDATE tasks SET retry_count=2,flags_json='[\"retry_exhausted\"]' WHERE id='task_a'");expect(withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',{expected_version:1,title:'A'}))).toMatchObject({retry_count:2,retry_limit:2,flags:['retry_exhausted']});
  state.storage.sql.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES('runtime','ws_example','agent_research','credential_research_1',1,?,1,'Test','online',1,1,9999999999999)",'1'.repeat(64));
  state.storage.sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at) VALUES('run','ws_example','task_a','agent_research','runtime','credential_research_1',1,'active',1,1,9999999999999,1)");state.storage.sql.exec("UPDATE tasks SET state='doing',active_run_id='run',latest_run_id='run' WHERE id='task_a'");
  for(const request of [{expected_version:2,title:'x'},{expected_version:2,description:'x'},{expected_version:2,assigned_agent_id:null}])expect(()=>withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',request))).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
  expect(state.storage.sql.exec("SELECT task_version,active_run_id,retry_count FROM tasks WHERE id='task_a'").one()).toEqual({task_version:2,active_run_id:'run',retry_count:2});
 });
});
it('native_mutation_does_not_require_human_lane_or_extra_read_scope',async()=>{
 const {stub}=await taskFixture('metadata-native');await runInDurableObject(stub,(_o,state)=>{
  // Installed configuration grants are immutable; narrow only to prove operation scope independence.
  const humanCtx=taskContext(state.storage);state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"tasks:create\"]'");expect(withTransaction(state.storage,tx=>createTask(tx,{...humanCtx,taskId:'no_read'},taskInput))).toMatchObject({id:'no_read'});
  const native=withTransaction(state.storage,tx=>resolveActor(tx,{kind:'agent',workspaceId:'ws_example',credentialId:'credential_research_1',tokenDigest:tx.one<{token_sha256:string}>('SELECT token_sha256 FROM native_credentials WHERE credential_id=?',['credential_research_1'])!.token_sha256},humanCtx.nowMs));
  expect(withTransaction(state.storage,tx=>createTask(tx,{...humanCtx,actor:native,taskId:'native_task'},taskInput))).toMatchObject({id:'native_task'});
 });
});
it('bounds_duplicate_id_and_version_exhaustion_fail_without_partial_effects',async()=>{
 const {stub}=await taskFixture('metadata-bounds');await runInDurableObject(stub,(_o,state)=>{
  const ctx=taskContext(state.storage);withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'task_a'},taskInput));const before=taskCounts(state.storage);
  expect(()=>withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'task_a'},taskInput))).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
  expect(()=>withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'large'},{...taskInput,description:'💡'.repeat(17000)}))).toThrowError(expect.objectContaining({status:413}));
  state.storage.sql.exec("UPDATE tasks SET task_version=? WHERE id='task_a'",Number.MAX_SAFE_INTEGER);expect(()=>withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',{expected_version:Number.MAX_SAFE_INTEGER,title:'overflow'}))).toThrowError(expect.objectContaining({code:'LIMIT_EXCEEDED'}));expect(taskCounts(state.storage)).toEqual(before);
 });
});
it('profile_stable_id_rename_does_not_rewrite_task_references',async()=>{
 const {stub}=await taskFixture('metadata-profile');await runInDurableObject(stub,(_o,state)=>{
  const ctx=taskContext(state.storage);taskProfile(state.storage);withTransaction(state.storage,tx=>{
   createTask(tx,{...ctx,taskId:'task_a'},{...taskInput,project_id:'project_a',work_role_id:'role_a'});const current=storedProfile(tx,ctx.actor);current.profile.projects[0].display_name='Renamed project';current.profile.work_roles[0].display_name='Renamed role';applyProfile(tx,ctx,{expected_profile_revision:current.profile_revision,profile:current.profile});
  });expect(state.storage.sql.exec("SELECT id,project_id,work_role_id,task_version FROM tasks WHERE id='task_a'").one()).toEqual({id:'task_a',project_id:'project_a',work_role_id:'role_a',task_version:1});
 });
});
it('hidden_current_result_denies_metadata_and_original_replay_without_partial_writes',async()=>{
 const {stub,name}=await taskFixture('metadata-result-privacy');await runInDurableObject(stub,async(_o,state)=>{
  const identity=human(state.storage),create=await commandContext(state.storage,name,taskInput,'create');executeCommand(create,identity,createTaskCommand('task_a'),taskInput);
  state.storage.sql.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES('runtime','ws_example','agent_research','credential_research_1',1,?,1,'Test','expired',1,1,2)",'2'.repeat(64));
  state.storage.sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at,ended_at) VALUES('run','ws_example','task_a','agent_research','runtime','credential_research_1',1,'submitted',1,1,2,1,2)");
  state.storage.sql.exec("INSERT INTO task_results(id,workspace_id,task_id,run_id,submission_sequence,submitted_kind,submitted_principal_id,submitted_agent_id,summary,created_at) VALUES('result','ws_example','task_a','run',1,'agent','agent_research','agent_research','Private result',2)");state.storage.sql.exec("UPDATE tasks SET current_result_id='result' WHERE id='task_a'");
  const body={expected_version:1,title:'Visible result edit'},patch=await commandContext(state.storage,name,body,'patch');expect(executeCommand(patch,identity,patchTaskCommand('task_a'),body).data.result?.summary).toBe('Private result');
  state.storage.sql.exec("INSERT INTO artifacts(id,workspace_id,task_id,run_id,owner_kind,owner_principal_id,authority_epoch,artifact_version,filename,media_type,byte_size,sha256,status,created_at,expires_at) VALUES('artifact','ws_example','task_a','run','agent','agent_research',1,1,'x','text/plain',1,?,'staged',1,9999999999999)",'3'.repeat(64));state.storage.sql.exec("INSERT INTO result_artifacts(workspace_id,result_id,artifact_id,ordinal) VALUES('ws_example','result','artifact',0)");const before=taskCounts(state.storage),ctx=taskContext(state.storage);
  expect(()=>withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',{expected_version:2,title:'must not change'}))).toThrowError(expect.objectContaining({status:403}));
  expect(()=>withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',{expected_version:999,title:'must not disclose version'}))).toThrowError(expect.objectContaining({status:403}));expect(()=>withTransaction(state.storage,tx=>readyTask(tx,ctx,'task_a',{expected_version:999}))).toThrowError(expect.objectContaining({status:403}));
  state.storage.sql.exec("UPDATE tasks SET state='review' WHERE id='task_a'");expect(()=>withTransaction(state.storage,tx=>patchTask(tx,ctx,'task_a',{expected_version:2,title:'must not disclose state'}))).toThrowError(expect.objectContaining({status:403}));state.storage.sql.exec("UPDATE tasks SET state='backlog' WHERE id='task_a'");expect(()=>executeCommand(create,identity,createTaskCommand('task_a'),taskInput)).toThrowError(expect.objectContaining({status:403}));
  state.storage.sql.exec("UPDATE tasks SET current_result_id=NULL WHERE id='task_a'");expect(()=>executeCommand(patch,identity,patchTaskCommand('task_a'),body)).toThrowError(expect.objectContaining({status:403}));expect(taskCounts(state.storage)).toEqual(before);expect(state.storage.sql.exec("SELECT title,task_version FROM tasks WHERE id='task_a'").one()).toEqual({title:'Visible result edit',task_version:2});
 });
});
it('missing_mutation_scope_does_not_reveal_task_existence',async()=>{
 const {stub,name}=await taskFixture('metadata-existence-scope');await runInDurableObject(stub,async(_o,state)=>{
  const identity=human(state.storage),create=await commandContext(state.storage,name,taskInput,'create');executeCommand(create,identity,createTaskCommand('task_a'),taskInput);
  state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"tasks:read\"]'");const before=taskCounts(state.storage);
  for(const id of ['task_a','missing_task']){
   const editBody={expected_version:1,title:'Denied'},edit=await commandContext(state.storage,name,editBody,'edit_'+id);
   expect(()=>executeCommand(edit,identity,patchTaskCommand(id),editBody)).toThrowError(expect.objectContaining({code:'FORBIDDEN',status:403}));
   const readyBody={expected_version:1},ready=await commandContext(state.storage,name,readyBody,'ready_'+id);
   expect(()=>executeCommand(ready,identity,readyTaskCommand(id),readyBody)).toThrowError(expect.objectContaining({code:'FORBIDDEN',status:403}));
  }
  expect(taskCounts(state.storage)).toEqual(before);expect(state.storage.sql.exec("SELECT title,task_version,state FROM tasks WHERE id='task_a'").one()).toEqual({title:taskInput.title,task_version:1,state:'backlog'});
 });
});
