import {identityFixture as settingsFixture} from '../helpers/identity';
import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {human,commandContext} from '../helpers/settings';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {createAgent,patchAgent,archiveAgent,getAgent,createAgentCommand,patchAgentCommand} from '../../src/agents/commands';
import {issueCredential,revokeCredential,issueCredentialCommand} from '../../src/auth/native-credentials';
import {neutralProfile} from '../../src/config/profile';
import {executeCommandDetailed} from '../../src/workspace/commands';
import type {CommandContext} from '../../src/workspace/context';
const scopes=['workspace:read','agents:read','agents:manage','credentials:manage','messages:read'];
function context(storage:DurableObjectStorage):CommandContext{const identity=human(storage);storage.sql.exec('UPDATE human_grants SET scopes_json=?',JSON.stringify(scopes));return withTransaction(storage,tx=>({actor:resolveActor(tx,identity,Date.now()),nowMs:Date.now(),requestId:'req_domain',idempotencyKey:'domain'}));}
const agent={display_name:'Synthetic agent',description:'Test metadata',work_role_ids:[]};
const credential=(id:string)=>({agent_id:id,label:'Synthetic credential',scopes:['messages:read'] as ['messages:read'],project_ids:null,expires_at:new Date(Date.now()+3600000).toISOString()});
it('identity_version_and_human_only_management_are_enforced',async()=>{
 const {stub}=await settingsFixture('domain-identity');await runInDurableObject(stub,(_o,state)=>{
  const ctx=context(state.storage);withTransaction(state.storage,tx=>{
   const a=createAgent(tx,{...ctx,agentId:'agent_dynamic'},agent);expect(a).toMatchObject({id:'agent_dynamic',agent_version:1,status:'active'});
   expect(()=>patchAgent(tx,ctx,a.id,{expected_agent_version:2,description:'wrong'})).toThrowError(expect.objectContaining({code:'VERSION_CONFLICT'}));
   const b=patchAgent(tx,ctx,a.id,{expected_agent_version:1,model:'neutral'});expect(b).toMatchObject({agent_version:2,model:'neutral'});
   expect(()=>createAgent(tx,{...ctx,agentId:'another',actor:{...ctx.actor,kind:'agent',sessionId:null}},agent)).toThrow();
   expect(()=>createAgent(tx,{...ctx,agentId:'unknown-role'},{...agent,work_role_ids:['missing']})).toThrowError(expect.objectContaining({code:'NOT_FOUND'}));
   tx.exec('INSERT INTO profiles(workspace_id,version,document_json,updated_at,updated_by) VALUES(?,1,?,?,?)',[ctx.actor.workspaceId,JSON.stringify({...neutralProfile,work_roles:[{id:'retired_role',display_name:'Retired',description:'',archived:true}]}),ctx.nowMs,ctx.actor.principalId]);
   expect(()=>patchAgent(tx,ctx,a.id,{expected_agent_version:2,work_role_ids:['retired_role']})).toThrowError(expect.objectContaining({code:'NOT_FOUND'}));
  });
 });
});
it('credential_scopes_expiry_and_project_ceilings_are_distinct_and_safe',async()=>{
 const {stub}=await settingsFixture('domain-ceiling');await runInDurableObject(stub,(_o,state)=>{
  const ctx=context(state.storage);withTransaction(state.storage,tx=>{
   createAgent(tx,{...ctx,agentId:'agent_dynamic'},agent);const body=credential('agent_dynamic'),prepared={credentialId:'credential_dynamic',tokenSha256:'a'.repeat(64)};
   expect(()=>issueCredential(tx,ctx,{...body,scopes:['agents:manage']},prepared)).toThrowError(expect.objectContaining({status:403}));
   expect(()=>issueCredential(tx,ctx,{...body,scopes:['tasks:claim']},prepared)).toThrowError(expect.objectContaining({status:403}));
   expect(()=>issueCredential(tx,ctx,{...body,expires_at:new Date(ctx.nowMs).toISOString()},prepared)).toThrow();
   tx.exec("UPDATE human_grants SET project_ids_json='[]'");
   expect(()=>issueCredential(tx,ctx,body,prepared)).toThrowError(expect.objectContaining({status:403}));
   const issued=issueCredential(tx,ctx,{...body,project_ids:[]},prepared);expect(issued).toMatchObject({token:null,revealed:false,credential:{id:'credential_dynamic',project_ids:[],status:'active'}});
   expect(JSON.stringify(issued)).not.toContain(prepared.tokenSha256);
   const revoked=revokeCredential(tx,ctx,prepared.credentialId,{expected_credential_version:1,reason:'test'});expect(revoked).toMatchObject({status:'revoked',credential_version:2});
  });
 });
});
it('archive_blocks_every_unresolved_assignment_and_retains_terminal_history',async()=>{
 const {stub}=await settingsFixture('domain-archive');await runInDurableObject(stub,(_o,state)=>{
  const ctx=context(state.storage);withTransaction(state.storage,tx=>{createAgent(tx,{...ctx,agentId:'agent_dynamic'},agent);issueCredential(tx,ctx,credential('agent_dynamic'),{credentialId:'credential_dynamic',tokenSha256:'b'.repeat(64)});});
  for(const status of ['backlog','ready','waiting','review']){
   state.storage.sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,assigned_agent_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES('task_block','ws_example','Test','',?,1,0,'agent_dynamic',0,0,'[]',1,1)",status);
   expect(()=>withTransaction(state.storage,tx=>archiveAgent(tx,ctx,'agent_dynamic',{expected_agent_version:1,reason:'test'}))).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
   state.storage.sql.exec("DELETE FROM tasks WHERE id='task_block'");
  }
  state.storage.sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,assigned_agent_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES('task_done','ws_example','Test','','done',1,0,'agent_dynamic',0,0,'[]',1,1)");
  state.storage.sql.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES('history_runtime','ws_example','agent_dynamic','credential_dynamic',1,?,1,'History','expired',1,1,2)",'f'.repeat(64));
  state.storage.sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at,ended_at) VALUES('history_run','ws_example','task_done','agent_dynamic','history_runtime','credential_dynamic',1,'submitted',1,1,2,1,2)");
  state.storage.sql.exec("INSERT INTO task_results(id,workspace_id,task_id,run_id,submission_sequence,submitted_kind,submitted_principal_id,submitted_agent_id,summary,created_at) VALUES('history_result','ws_example','task_done','history_run',1,'agent','agent_dynamic','agent_dynamic','Retained result',2)");
  withTransaction(state.storage,tx=>{expect(archiveAgent(tx,ctx,'agent_dynamic',{expected_agent_version:1,reason:'test'}).status).toBe('archived');expect(getAgent(tx,ctx.actor,'agent_dynamic',ctx.nowMs).status).toBe('archived');});
  expect(state.storage.sql.exec('SELECT enabled,revoked_at FROM native_credentials WHERE credential_id=?','credential_dynamic').one()).toMatchObject({enabled:0,revoked_at:ctx.nowMs});
  expect(state.storage.sql.exec("SELECT assigned_agent_id FROM tasks WHERE id='task_done'").one()).toEqual({assigned_agent_id:'agent_dynamic'});
  expect(state.storage.sql.exec("SELECT r.summary,a.status FROM task_results r JOIN static_agents a ON a.agent_id=r.submitted_agent_id AND a.workspace_id=r.workspace_id WHERE r.id='history_result'").one()).toEqual({summary:'Retained result',status:'archived'});
 });
});
it('archive_status_and_credential_proof_revocations_rollback_together',async()=>{
 const {stub}=await settingsFixture('domain-archive-rollback');await runInDurableObject(stub,(_o,state)=>{
  const ctx=context(state.storage);withTransaction(state.storage,tx=>{createAgent(tx,{...ctx,agentId:'agent_dynamic'},agent);issueCredential(tx,ctx,credential('agent_dynamic'),{credentialId:'credential_dynamic',tokenSha256:'c'.repeat(64)});tx.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES('runtime','ws_example','agent_dynamic','credential_dynamic',1,?,1,'Test','online',1,1,9999999999999)",['d'.repeat(64)]);});
  state.storage.sql.exec("CREATE TRIGGER reject_proof_revoke BEFORE UPDATE ON runtimes BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END");
  expect(()=>withTransaction(state.storage,tx=>archiveAgent(tx,ctx,'agent_dynamic',{expected_agent_version:1,reason:'test'}))).toThrow();
  expect(state.storage.sql.exec("SELECT status,agent_version FROM static_agents WHERE agent_id='agent_dynamic'").one()).toEqual({status:'active',agent_version:1});
  expect(state.storage.sql.exec("SELECT enabled,revoked_at FROM native_credentials WHERE credential_id='credential_dynamic'").one()).toEqual({enabled:1,revoked_at:null});
  expect(state.storage.sql.exec("SELECT revoked_at FROM runtimes WHERE id='runtime'").one()).toEqual({revoked_at:null});
 });
});
it('active_run_blocks_archive_even_unassigned_then_revoke_invalidates_proof_not_work_history',async()=>{
 const {stub}=await settingsFixture('domain-active-run');await runInDurableObject(stub,(_o,state)=>{
  const ctx=context(state.storage);
  withTransaction(state.storage,tx=>{
   createAgent(tx,{...ctx,agentId:'agent_dynamic'},agent);issueCredential(tx,ctx,credential('agent_dynamic'),{credentialId:'credential_dynamic',tokenSha256:'e'.repeat(64)});
   tx.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES('runtime','ws_example','agent_dynamic','credential_dynamic',1,?,1,'Test','online',1,1,9999999999999)",['f'.repeat(64)]);
   tx.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES('task_active','ws_example','Test','','ready',1,0,0,0,'[]',1,1)");
   tx.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at) VALUES('run_active','ws_example','task_active','agent_dynamic','runtime','credential_dynamic',1,'active',1,1,9999999999999,1)");
   tx.exec("UPDATE tasks SET state='doing',active_run_id='run_active',latest_run_id='run_active' WHERE id='task_active'");
  });
  expect(()=>withTransaction(state.storage,tx=>archiveAgent(tx,ctx,'agent_dynamic',{expected_agent_version:1,reason:'blocked'}))).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
  withTransaction(state.storage,tx=>{expect(revokeCredential(tx,ctx,'credential_dynamic',{expected_credential_version:1,reason:'invalidate'}).status).toBe('revoked');});
  expect(state.storage.sql.exec("SELECT status,revoked_at FROM runtimes WHERE id='runtime'").one()).toEqual({status:'expired',revoked_at:ctx.nowMs});
  expect(state.storage.sql.exec("SELECT status FROM runs WHERE id='run_active'").one()).toEqual({status:'active'});
  expect(state.storage.sql.exec("SELECT state,active_run_id FROM tasks WHERE id='task_active'").one()).toEqual({state:'doing',active_run_id:'run_active'});
 });
});
it('native_scope_forgery_foreign_identity_and_stale_session_fail_closed',async()=>{
 const {stub}=await settingsFixture('domain-boundaries');await runInDurableObject(stub,(_o,state)=>{
  const ctx=context(state.storage);
  withTransaction(state.storage,tx=>{
   tx.exec(`UPDATE native_credentials SET scopes_json='["agents:manage","credentials:manage"]'`);
   const native=resolveActor(tx,{kind:'agent',workspaceId:'ws_example',credentialId:'credential_research_1',tokenDigest:tx.one<{token_sha256:string}>('SELECT token_sha256 FROM native_credentials')!.token_sha256},ctx.nowMs);
   expect(()=>createAgent(tx,{...ctx,actor:native,agentId:'forged'},agent)).toThrowError(expect.objectContaining({status:403}));
   expect(()=>issueCredential(tx,{...ctx,actor:native},credential('agent_research'),{credentialId:'forged',tokenSha256:'1'.repeat(64)})).toThrowError(expect.objectContaining({status:403}));
   expect(()=>patchAgent(tx,ctx,'agent_foreign',{expected_agent_version:1,description:'unknown'})).toThrowError(expect.objectContaining({code:'NOT_FOUND'}));
   tx.exec("UPDATE sessions SET revoked_at=? WHERE id=?",[ctx.nowMs,ctx.actor.sessionId]);
   expect(()=>createAgent(tx,{...ctx,agentId:'revoked_session'},agent)).toThrowError(expect.objectContaining({status:401}));
  });
 });
});
it('static_adoption_never_combines_distinct_credential_grants_or_outlives_ceiling',async()=>{
 const {stub}=await settingsFixture('domain-static-ceiling');await runInDurableObject(stub,(_o,state)=>{
  const ctx=context(state.storage);withTransaction(state.storage,tx=>{
   tx.exec("UPDATE native_credentials SET scopes_json='[\"messages:read\"]'");
   tx.exec("INSERT INTO native_credentials(credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch) VALUES('credential_partial','ws_example','agent_research',?,'[\"workspace:read\"]','null',?,1,1)",['2'.repeat(64),ctx.nowMs+86400000]);
   const body={...credential('agent_research'),scopes:['messages:read','workspace:read'] as ['messages:read','workspace:read']};
   expect(()=>issueCredential(tx,ctx,body,{credentialId:'combined',tokenSha256:'3'.repeat(64)})).toThrowError(expect.objectContaining({status:403}));
   const exact=issueCredential(tx,ctx,credential('agent_research'),{credentialId:'adopted',tokenSha256:'4'.repeat(64)});expect(exact.credential.agent_id).toBe('agent_research');
   tx.exec('UPDATE native_credentials SET expires_at=? WHERE credential_id=?',[ctx.nowMs+1000,'credential_research_1']);
   expect(()=>issueCredential(tx,ctx,credential('agent_research'),{credentialId:'outliving',tokenSha256:'5'.repeat(64)})).toThrowError(expect.objectContaining({status:403}));
  });
 });
});
it('durable_domain_outcomes_replay_without_duplicate_effects_and_abort_all_on_event_failure',async()=>{
 const {stub,name}=await settingsFixture('domain-wrapper');await runInDurableObject(stub,async(_o,state)=>{
  context(state.storage);const identity=human(state.storage),ctx=await commandContext(state.storage,name,agent,'same');
  const created=executeCommandDetailed(ctx,identity,createAgentCommand('agent_dynamic'),agent);
  expect(created).toMatchObject({firstExecution:true,outcome:{status:201,data:{id:'agent_dynamic'}}});
  expect(executeCommandDetailed(ctx,identity,createAgentCommand('unused'),agent)).toEqual({...created,firstExecution:false});
  const patch={expected_agent_version:1,description:'Edited'};
  expect(executeCommandDetailed(await commandContext(state.storage,name,patch,'same'),identity,patchAgentCommand('agent_dynamic'),patch).outcome.data).toMatchObject({description:'Edited',agent_version:2});
  const body=credential('agent_dynamic'),prepared={credentialId:'credential_dynamic',tokenSha256:'6'.repeat(64)},cc=await commandContext(state.storage,name,body,'issue');
  const issued=executeCommandDetailed(cc,identity,issueCredentialCommand(prepared),body);
  expect(issued.outcome.data).toMatchObject({token:null,revealed:false});
  expect(executeCommandDetailed(cc,identity,issueCredentialCommand({credentialId:'unused',tokenSha256:'7'.repeat(64)}),body)).toEqual({...issued,firstExecution:false});
  const before=Object.fromEntries(['static_agents','native_credentials','events','idempotency_outcomes'].map(t=>[t,state.storage.sql.exec('SELECT * FROM '+t).toArray()]));
  state.storage.sql.exec("CREATE TRIGGER reject_identity_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'synthetic_event_failure'); END");
  const fail=await commandContext(state.storage,name,agent,'failed');
  expect(()=>executeCommandDetailed(fail,identity,createAgentCommand('agent_aborted'),agent)).toThrow();
  expect(Object.fromEntries(['static_agents','native_credentials','events','idempotency_outcomes'].map(t=>[t,state.storage.sql.exec('SELECT * FROM '+t).toArray()]))).toEqual(before);
 });
});
