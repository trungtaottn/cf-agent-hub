import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {catalogFixture,catalogProfile,catalogSnapshot} from '../helpers/catalog';
import {taskContext,taskInput} from '../helpers/tasks';
import {human,commandContext} from '../helpers/settings';
import {withTransaction} from '../../src/storage/transaction';
import {createTask} from '../../src/tasks/commands';
import {createAgent} from '../../src/agents/commands';
import {applyProfile,storedProfile} from '../../src/config/profile';
import {previewCatalogChange,applyCatalogChange,previewCatalogCommand,applyCatalogCommand} from '../../src/config/catalog-commands';
import {executeCommand} from '../../src/workspace/commands';
import type {CatalogPreviewRequest} from '../../src/http/dto';
const request:CatalogPreviewRequest={expected_profile_revision:1,kind:'project',id:'project_a',operation:'remap',replacement_id:'project_b',reason:'Reviewed synthetic change'};
function seed(s:DurableObjectStorage){catalogProfile(s);const ctx=taskContext(s);withTransaction(s,tx=>createTask(tx,{...ctx,taskId:'task_a'},{...taskInput,project_id:'project_a'}));}
function preview(s:DurableObjectStorage){return withTransaction(s,tx=>previewCatalogChange(tx,{...taskContext(s),planId:'plan_security'},request));}
function apply(s:DurableObjectStorage){return withTransaction(s,tx=>applyCatalogChange(tx,taskContext(s),{preview_id:'plan_security',expected_profile_revision:1}));}
/** Schema-valid retained result, not a fabricated human grant or a mocked transaction. */
function result(s:DurableObjectStorage){
 s.sql.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES('sec_runtime','ws_example','agent_research','credential_research_1',1,?,1,'Test','expired',1,1,2)",'a'.repeat(64));
 s.sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at,ended_at) VALUES('sec_run','ws_example','task_a','agent_research','sec_runtime','credential_research_1',1,'submitted',1,1,2,1,2)");
 s.sql.exec("INSERT INTO task_results(id,workspace_id,task_id,run_id,submission_sequence,submitted_kind,submitted_principal_id,submitted_agent_id,summary,created_at) VALUES('sec_result','ws_example','task_a','sec_run',1,'agent','agent_research','agent_research','Retained result',2)");
 s.sql.exec("UPDATE tasks SET current_result_id='sec_result',latest_run_id='sec_run' WHERE id='task_a'");
}
function hiddenArtifact(s:DurableObjectStorage){
 s.sql.exec("INSERT INTO artifacts(id,workspace_id,task_id,run_id,owner_kind,owner_principal_id,owner_agent_id,authority_epoch,artifact_version,filename,media_type,byte_size,sha256,status,created_at,expires_at) VALUES('sec_artifact','ws_example','task_a','sec_run','agent','agent_research','agent_research',1,1,'file','text/plain',0,?,'staged',1,3)",'b'.repeat(64));
 s.sql.exec("INSERT INTO artifact_generations(id,workspace_id,artifact_id,object_key,expected_sha256,expected_byte_size,observed_sha256,observed_byte_size,state,admission_epoch,admission_generation,expires_at,created_at,updated_at) VALUES('sec_gen','ws_example','sec_artifact','synthetic-key',?,0,?,0,'committed',1,0,3,1,2)",'b'.repeat(64),'b'.repeat(64));
 s.sql.exec("UPDATE artifacts SET status='committed',committed_at=2,expires_at=NULL,committed_generation_id='sec_gen' WHERE id='sec_artifact'");
 s.sql.exec("INSERT INTO result_artifacts VALUES('ws_example','sec_result','sec_artifact',0)");
 for(const [kind,id]of [['task','task_a'],['run','sec_run'],['result','sec_result']])s.sql.exec("INSERT INTO artifact_associations VALUES('ws_example','sec_artifact',?,?)",kind,id);
}
it('catalog_preview_hides_whole_task_when_current_result_artifact_is_unreadable',async()=>{
 const {stub}=await catalogFixture('catalog-security-hidden-preview');await runInDurableObject(stub,(_o,state)=>{const s=state.storage;seed(s);result(s);hiddenArtifact(s);const before=catalogSnapshot(s);expect(()=>preview(s)).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));expect(catalogSnapshot(s)).toEqual(before);});
});
it('catalog_apply_rechecks_complete_result_visibility_before_stale_version_details',async()=>{
 const {stub}=await catalogFixture('catalog-security-hidden-apply');await runInDurableObject(stub,(_o,state)=>{const s=state.storage;seed(s);result(s);preview(s);hiddenArtifact(s);s.sql.exec("UPDATE tasks SET task_version=2 WHERE id='task_a'");const before=catalogSnapshot(s);expect(()=>apply(s)).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));expect(catalogSnapshot(s)).toEqual(before);});
});
it.each(['preview','apply'] as const)('catalog_%s_replay_rechecks_new_hidden_current_result',async(stage)=>{
 const {stub,name}=await catalogFixture('catalog-security-hidden-replay-'+stage);await runInDurableObject(stub,async(_o,state)=>{const s=state.storage;seed(s);const identity=human(s),pc=await commandContext(s,name,request,'preview');executeCommand(pc,identity,previewCatalogCommand('plan_security'),request);
  const body={preview_id:'plan_security',expected_profile_revision:1},ac=await commandContext(s,name,body,'apply');if(stage==='apply')executeCommand(ac,identity,applyCatalogCommand(),body);
  result(s);hiddenArtifact(s);const before=catalogSnapshot(s);
  expect(()=>stage==='preview'?executeCommand(pc,identity,previewCatalogCommand('different_generated_id'),request):executeCommand(ac,identity,applyCatalogCommand(),body)).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));expect(catalogSnapshot(s)).toEqual(before);
 });
});
it('catalog_private_destination_corruption_cannot_change_publicly_reviewed_remap',async()=>{
 const {stub}=await catalogFixture('catalog-security-destination');await runInDurableObject(stub,(_o,state)=>{const s=state.storage;seed(s);
  const row=s.sql.exec<{document_json:string}>('SELECT document_json FROM profiles').one(),profile=JSON.parse(row.document_json);profile.projects.push({id:'project_c',display_name:'C',description:'',archived:false});s.sql.exec('UPDATE profiles SET document_json=?',JSON.stringify(profile));
  const plan=preview(s);expect(plan.changes[1].after?.id).toBe('project_b');s.sql.exec("UPDATE catalog_plans SET touched_versions_json=json_set(touched_versions_json,'$.request.replacement_id','project_c')");const before=catalogSnapshot(s);expect(()=>apply(s)).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR'}));expect(catalogSnapshot(s)).toEqual(before);
 });
});
it.each(['tasks','agents'] as const)('catalog_replay_rejects_corrupted_original_%s_scope_obligation',async(kind)=>{
 const {stub,name}=await catalogFixture('catalog-security-flags-'+kind);await runInDurableObject(stub,async(_o,state)=>{const s=state.storage;seed(s);const bodyRequest=kind==='tasks'?request:{...request,kind:'work_role' as const,id:'role_a',replacement_id:'role_b'};
  if(kind==='agents')withTransaction(s,tx=>createAgent(tx,{...taskContext(s),agentId:'sec_agent'},{display_name:'Agent',description:'',work_role_ids:['role_a']}));
  const identity=human(s),pc=await commandContext(s,name,bodyRequest,'preview');executeCommand(pc,identity,previewCatalogCommand('plan_security'),bodyRequest);const body={preview_id:'plan_security',expected_profile_revision:1},ac=await commandContext(s,name,body,'apply');executeCommand(ac,identity,applyCatalogCommand(),body);
  const field=kind==='tasks'?'taskWrite':'agentWrite',scope=kind==='tasks'?'tasks:edit':'agents:manage';s.sql.exec("UPDATE catalog_plans SET touched_versions_json=json_set(touched_versions_json,?,json('false'))",'$.'+field);
  const grant=s.sql.exec<{scopes_json:string}>("SELECT scopes_json FROM human_grants WHERE principal_id='human_operator'").one();s.sql.exec("UPDATE human_grants SET scopes_json=? WHERE principal_id='human_operator'",JSON.stringify((JSON.parse(grant.scopes_json) as string[]).filter(x=>x!==scope)));
  const before=catalogSnapshot(s);expect(()=>executeCommand(ac,identity,applyCatalogCommand(),body)).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR'}));expect(catalogSnapshot(s)).toEqual(before);
 });
});
it.each([false,true])('catalog_supports_valid_long_role_arrays_above_8KiB_affected_%s',async(affected)=>{
 const {stub}=await catalogFixture('catalog-security-long-roles-'+affected);await runInDurableObject(stub,(_o,state)=>{const s=state.storage;catalogProfile(s);const ctx=taskContext(s),roles=Array.from({length:64},(_,i)=>'r'+String(i).padStart(3,'0')+'x'.repeat(124));
  const current=withTransaction(s,tx=>storedProfile(tx,ctx.actor)),profile={...current.profile,work_roles:[...current.profile.work_roles,...roles.map((id,i)=>({id,display_name:'Role '+i,description:'',archived:false}))]};
  withTransaction(s,tx=>applyProfile(tx,ctx,{expected_profile_revision:1,profile}));const ids=affected?['role_a',...roles]:roles;expect(new TextEncoder().encode(JSON.stringify(ids)).byteLength).toBeGreaterThan(8192);
  withTransaction(s,tx=>createAgent(tx,{...ctx,agentId:'long_roles'},{display_name:'Long roles',description:'',work_role_ids:ids}));
  const body:CatalogPreviewRequest={...request,expected_profile_revision:2,kind:'work_role',id:'role_a',replacement_id:'role_b'};
  const plan=withTransaction(s,tx=>previewCatalogChange(tx,{...ctx,planId:'long_plan'},body));expect(plan.affected_agent_ids).toEqual(affected?['long_roles']:[]);
  withTransaction(s,tx=>applyCatalogChange(tx,ctx,{preview_id:'long_plan',expected_profile_revision:2}));const stored=JSON.parse(s.sql.exec<{work_role_ids_json:string}>("SELECT work_role_ids_json FROM static_agents WHERE agent_id='long_roles'").one().work_role_ids_json) as string[];expect(stored).toEqual(affected?['role_b',...roles]:roles);
 });
});
