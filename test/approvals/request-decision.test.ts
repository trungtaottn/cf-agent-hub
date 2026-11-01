import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {decisionFixture} from '../helpers/decision-policy';
it('schema19 adds closed generic decision storage without registering product actions',async()=>{
 const f=await decisionFixture('decision_schema19');await runInDurableObject(f.stub,async(_o,s)=>{
  expect(s.storage.sql.exec<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations').one().version).toBe(19);
  const tables=s.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_schema WHERE type='table'").toArray().map(r=>r.name);
  for(const name of ['decision_checkpoints','decision_proposals','approvals','decision_artifact_edges','decision_lifecycle_heads','decision_lifecycle_transitions','decision_notice_intents'])expect(tables).toContain(name);
  const {productionDecisionDescriptors}=await import('../../src/approvals/action-registry');expect(productionDecisionDescriptors).toEqual([]);
 });
});
import {claimSetup,descriptor,proposal} from '../helpers/decision-policy';
import {artifactContext,stage,bytes} from '../helpers/artifacts';
import {claimContext,PROOF_A} from '../helpers/claims';
import {uploadArtifactContent,commitArtifact} from '../../src/artifacts/content';
import {sha256} from '../../src/config/bootstrap';
import {executeCommand} from '../../src/workspace/commands';
import {claimTaskCommand} from '../../src/tasks/claim';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import type {TaskRequestDecisionRequest} from '../../src/http/dto';
async function setup(storage:DurableObjectStorage,name:string,inputTaskId='task_a'){
 const c=claimSetup(storage),claim=await claimContext(storage,name,c.body,'initial_claim',c.now);
 executeCommand(claim,c.identity,claimTaskCommand('task_a','run_initial',PROOF_A),c.body);
 const ctx=artifactContext(storage,name,'decision_input',c.now),content='{"task_id":"task_a","task_version":3}',hash=await sha256(content);
 await stage(ctx,'input_a',{task_id:inputTaskId,media_type:'application/json',byte_size:37,sha256:hash});
 await uploadArtifactContent({...ctx,idempotencyKey:'upload'},'input_a',bytes(content),'upload');await commitArtifact({...ctx,idempotencyKey:'commit'},'input_a',{expected_artifact_version:2});
 const body:TaskRequestDecisionRequest={expected_version:3,run_id:'run_initial',fence:1,checkpoint:{summary:'Checkpoint',artifact_ids:['input_a']},proposal:proposal(hash)};
 const execution={...claim,workspace:ctx.workspace,idempotencyKey:'decision',fingerprint:await fingerprintRequest('POST','/request-decision',{},body)};
 return {ctx,body,execution,identity:c.identity,now:c.now};
}
async function api(){const {createDecisionCommands}=await import('../../src/approvals/commands-source');return createDecisionCommands([descriptor]);}
function snapshot(storage:DurableObjectStorage){return Object.fromEntries(['tasks','runs','decision_checkpoints','decision_proposals','approvals','decision_artifact_edges','decision_lifecycle_heads','decision_lifecycle_transitions','decision_notice_intents','events','task_history','idempotency_outcomes','outbox','scheduler_state'].map(t=>[t,storage.sql.exec('SELECT * FROM '+t+' ORDER BY rowid').toArray()]));}
it('request_releases_run_and_freezes_inputs_atomically_without_new_authority',async()=>{
 const f=await decisionFixture('request_atomic');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name),a=await api(),cmd=await a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'});
  const result=executeCommand(x.execution,x.identity,cmd,x.body).data;
  expect(result.task).toMatchObject({state:'waiting',task_version:4,proposal_version:1,active_run_id:null,latest_run_id:'run_initial',approval_id:'approval_a'});
  expect(result.run).toMatchObject({id:'run_initial',status:'paused',run_version:2,ended_at:new Date(x.now).toISOString()});
  expect(result.approval).toMatchObject({id:'approval_a',status:'pending',approval_version:1,proposal_version:1,task_version_at_request:3,checkpoint:x.body.checkpoint,proposal:x.body.proposal,expires_at:new Date(x.now+120000).toISOString()});
  expect(s.storage.sql.exec('SELECT * FROM runs').toArray()).toHaveLength(1);
  expect(s.storage.sql.exec('SELECT role FROM decision_artifact_edges ORDER BY role').toArray()).toEqual([{role:'checkpoint'},{role:'input'}]);
  expect(s.storage.sql.exec('SELECT task_version,task_state,transition_count FROM decision_lifecycle_heads').one()).toEqual({task_version:4,task_state:'waiting',transition_count:1});
  expect(s.storage.sql.exec("SELECT * FROM events WHERE type='task.decision_requested'").toArray()).toHaveLength(1);
  expect(s.storage.sql.exec("SELECT task_version,run_id,fence FROM events WHERE type='task.decision_requested'").one()).toEqual({task_version:4,run_id:'run_initial',fence:1});
  expect(s.storage.sql.exec('SELECT reviewer_principal_id FROM decision_notice_intents ORDER BY reviewer_principal_id').toArray()).toEqual([{reviewer_principal_id:'human_operator'},{reviewer_principal_id:'human_reviewer'}]);
 });
});
it('request_retained_replay_and_changed_payload_use_authoritative_ledger_after_advancement',async()=>{
 const f=await decisionFixture('request_replay');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name),a=await api(),prepare=(body=x.body)=>a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'});
  const result=executeCommand(x.execution,x.identity,await prepare(),x.body),before=snapshot(s.storage);
  expect(executeCommand(x.execution,x.identity,await prepare(),x.body)).toEqual(result);expect(snapshot(s.storage)).toEqual(before);
  const changed={...x.body,checkpoint:{...x.body.checkpoint,summary:'changed'}},cmd=await prepare(changed);
  expect(()=>executeCommand({...x.execution,fingerprint:'f'.repeat(64)},x.identity,cmd,changed)).toThrow('IDEMPOTENCY_CONFLICT');expect(snapshot(s.storage)).toEqual(before);
  const changedRun={...x.body,run_id:'missing_run'},changedRunCommand=await prepare(changedRun);expect(()=>executeCommand({...x.execution,fingerprint:'e'.repeat(64)},x.identity,changedRunCommand,changedRun)).toThrow('IDEMPOTENCY_CONFLICT');expect(snapshot(s.storage)).toEqual(before);
  s.storage.sql.exec("UPDATE native_credentials SET enabled=0 WHERE credential_id='credential_research_1'");
  await expect(prepare()).rejects.toThrow();
 });
});
it('request_replay_preparation_missing_ledger_race_fails_closed',async()=>{
 const f=await decisionFixture('request_missing_ledger');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name),a=await api(),prepare=()=>a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'});
  executeCommand(x.execution,x.identity,await prepare(),x.body);const cmd=await prepare();s.storage.sql.exec("DELETE FROM idempotency_outcomes WHERE key='decision'");const before=snapshot(s.storage);
  expect(()=>executeCommand(x.execution,x.identity,cmd,x.body)).toThrow('DEPENDENCY_UNAVAILABLE');expect(snapshot(s.storage)).toEqual(before);
 });
});
it('request_final_transaction_rechecks_native_owner_version_fence_and_rolls_back_every_mutation',async()=>{
 const f=await decisionFixture('request_rollback');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name),a=await api(),cmd=await a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'}),before=snapshot(s.storage);
  for(const table of ['decision_checkpoints','decision_proposals','approvals','decision_artifact_edges','decision_lifecycle_transitions','decision_lifecycle_heads','decision_notice_intents','events','idempotency_outcomes']){
   s.storage.sql.exec(`CREATE TRIGGER injected_abort BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected'); END`);
   expect(()=>executeCommand(x.execution,x.identity,cmd,x.body)).toThrow();s.storage.sql.exec('DROP TRIGGER injected_abort');expect(snapshot(s.storage)).toEqual(before);
  }
  for(const table of ['runs','tasks']){s.storage.sql.exec(`CREATE TRIGGER injected_abort BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'injected'); END`);expect(()=>executeCommand(x.execution,x.identity,cmd,x.body)).toThrow();s.storage.sql.exec('DROP TRIGGER injected_abort');expect(snapshot(s.storage)).toEqual(before);}
  for(const body of [{...x.body,fence:2},{...x.body,expected_version:2}]){expect(()=>executeCommand(x.execution,x.identity,cmd,body)).toThrow();expect(snapshot(s.storage)).toEqual(before);}
 });
});
it('stored_decision_identity_validators_are_closed_bounded_and_never_private_receipts',async()=>{
 const {parsePersistedBinding,parseSemanticAnchor}=await import('../../src/approvals/stored-validation');
 expect(()=>parsePersistedBinding('{}')).toThrow('DECISION_UNAVAILABLE');expect(()=>parsePersistedBinding(' '.repeat(1048577))).toThrow('DECISION_UNAVAILABLE');
 expect(()=>parseSemanticAnchor('{"id":"task_a"}')).toThrow('DECISION_UNAVAILABLE');
});
it('schema19 rejects SQLite REAL authority counters and out-of-range safe integers',async()=>{
 const f=await decisionFixture('decision_sql_integer');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name);
  for(const value of [1.5,9007199254740992])expect(()=>s.storage.sql.exec('INSERT INTO decision_proposals(id,workspace_id,task_id,proposal_version,proposal_json,binding_json,semantic_anchor_json,created_at) VALUES(?,?,?,?,?,?,?,?)','bad','ws_example','task_a',value,'{}','{}','{}',x.now)).toThrow();
  expect(()=>s.storage.sql.exec('INSERT INTO decision_proposals(id,workspace_id,task_id,proposal_version,proposal_json,binding_json,semantic_anchor_json,created_at) VALUES(?,?,?,?,?,?,?,?)','bad','ws_example','task_a',1,'{}','{}','{}',1.5)).toThrow();
 });
});
it('generic_lifecycle_transition_shape_is_closed_and_does_not_authorize_reuse',async()=>{
 const {validDecisionTransition}=await import('../../src/approvals/stored-validation');
 for(const [kind,before,after] of [['request','doing','waiting'],['approve','waiting','ready'],['reject','waiting','backlog'],['claim','ready','doing'],['failure','doing','waiting'],['lease_expiry','doing','waiting'],['submit','doing','review'],['accept','review','done'],['expiry','waiting','waiting'],['expiry','ready','waiting'],['cancel','doing','cancelled']])expect(validDecisionTransition(kind,before,after)).toBe(true);
 for(const [kind,before,after] of [['failure','doing','ready'],['lease_expiry','doing','ready'],['reuse','waiting','ready'],['expiry','doing','waiting'],['approve','waiting','done'],['cancel','done','cancelled']])expect(validDecisionTransition(kind,before,after)).toBe(false);
});
it('request_denies_revocation_after_R2_await_and_expired_lease_without_partial_writes',async()=>{
 const f=await decisionFixture('request_current_authority');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name),a=await api(),{wrapBucket}=await import('../helpers/artifacts');const original=x.ctx.bucket!;
  const context={...x.ctx,idempotencyKey:'decision',bucket:wrapBucket(original,{get:async(...args:Parameters<R2Bucket['get']>)=>{const object=await original.get(...args);s.storage.sql.exec("UPDATE human_grants SET enabled=0 WHERE principal_id='human_reviewer'");return object;}})};
  const before=snapshot(s.storage);await expect(a.prepareRequestTaskDecision(context,'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');expect(snapshot(s.storage)).toEqual(before);
  s.storage.sql.exec("UPDATE human_grants SET enabled=1 WHERE principal_id='human_reviewer'");
  const cmd=await a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'});
  const expired={...x.execution,workspace:{...x.execution.workspace,clock:{nowMs:()=>x.now+60000}}};expect(()=>executeCommand(expired,x.identity,cmd,x.body)).toThrow('STALE_RUN');expect(snapshot(s.storage)).toEqual(before);
 });
});
it('approval_reads_require_current_read_scope_without_native_execution_or_artifact_byte_authority',async()=>{
 const {getApproval}=await import('../../src/approvals/queries'),{human}=await import('../helpers/settings'),{resolveActor}=await import('../../src/auth/authorize'),{withTransaction}=await import('../../src/storage/transaction');
 const f=await decisionFixture('approval_read_scope');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name),a=await api(),cmd=await a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'});executeCommand(x.execution,x.identity,cmd,x.body);
  const identity=human(s.storage);
  const read=()=>withTransaction(s.storage,tx=>getApproval(tx,{actor:resolveActor(tx,identity,x.now),nowMs:x.now},'approval_a'));
  expect(read().id).toBe('approval_a');s.storage.sql.exec("UPDATE human_grants SET scopes_json=? WHERE principal_id='human_operator'",JSON.stringify(['approvals:read','tasks:read']));expect(read().id).toBe('approval_a');
  expect(()=>withTransaction(s.storage,tx=>getApproval(tx,{actor:resolveActor(tx,x.identity,x.now),nowMs:x.now},'approval_a'))).toThrow('FORBIDDEN');
  s.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"tasks:read\"]' WHERE principal_id='human_operator'");expect(read).toThrow('FORBIDDEN');
 });
});
it('paused_request_run_cannot_renew_submit_fail_or_claim_and_never_transfers_a_lease',async()=>{
 const f=await decisionFixture('request_no_authority_escape');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name),a=await api(),cmd=await a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'});executeCommand(x.execution,x.identity,cmd,x.body);const before=snapshot(s.storage);
  const {heartbeatRunCommand}=await import('../../src/tasks/lease'),{submitTaskResultCommand}=await import('../../src/tasks/results'),{failTaskCommand}=await import('../../src/tasks/failure');
  const attempts=[
   ()=>executeCommand({...x.execution,idempotencyKey:'forbidden_heartbeat'},x.identity,heartbeatRunCommand('run_initial',PROOF_A),{expected_run_version:2,fence:1}),
   ()=>executeCommand({...x.execution,idempotencyKey:'forbidden_submit'},x.identity,submitTaskResultCommand('task_a',PROOF_A),{expected_version:4,run_id:'run_initial',fence:1,result:{summary:'not accepted',artifact_ids:[]}}),
   ()=>executeCommand({...x.execution,idempotencyKey:'forbidden_fail'},x.identity,failTaskCommand('task_a',PROOF_A),{expected_version:4,run_id:'run_initial',fence:1,reason:'not authority',outcome_unknown:false}),
   ()=>executeCommand({...x.execution,idempotencyKey:'forbidden_claim'},x.identity,claimTaskCommand('task_a','run_forbidden',PROOF_A),{expected_version:4,runtime_instance_id:'runtime_a'})
  ];
  for(const attempt of attempts){expect(attempt).toThrow();expect(snapshot(s.storage)).toEqual(before);}
 });
});
it('approval_pages_are_actor_bound_and_reread_current_scope_on_each_page',async()=>{
 const {listApprovals}=await import('../../src/approvals/queries'),{human}=await import('../helpers/settings'),{resolveActor}=await import('../../src/auth/authorize'),{withTransaction}=await import('../../src/storage/transaction');
 const f=await decisionFixture('approval_page_scope');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name),a=await api();executeCommand(x.execution,x.identity,await a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'}),x.body);
  const claimBody={expected_version:2,runtime_instance_id:'runtime_a'};executeCommand(await claimContext(s.storage,f.name,claimBody,'claim_second',x.now,'task_b'),x.identity,claimTaskCommand('task_b','run_second',PROOF_A),claimBody);
  const content='{"task_id":"task_b","task_version":3}',hash=await sha256(content);await stage(x.ctx,'input_b',{task_id:'task_b',media_type:'application/json',byte_size:37,sha256:hash});await uploadArtifactContent({...x.ctx,idempotencyKey:'upload_second'},'input_b',bytes(content),'upload_second');await commitArtifact({...x.ctx,idempotencyKey:'commit_second'},'input_b',{expected_artifact_version:2});
  const body={...x.body,run_id:'run_second',checkpoint:{summary:'Second',artifact_ids:['input_b']},proposal:{...proposal(hash),scope:{project_id:null,resource_ids:['task_b']},inputs:{artifact_id:'input_b',sha256:hash}}};
  const execution={...x.execution,idempotencyKey:'decision_second',fingerprint:await fingerprintRequest('POST','/second',{},body)};executeCommand(execution,x.identity,await a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision_second'},'task_b',body,PROOF_A,{approvalId:'approval_b',checkpointId:'checkpoint_b',proposalId:'proposal_b'}),body);
  const identity=human(s.storage),actor=withTransaction(s.storage,tx=>resolveActor(tx,identity,x.now));const binding={workspaceId:actor.workspaceId,principalId:actor.principalId,lane:actor.kind,credentialId:actor.credentialId,sessionId:actor.sessionId,operation:'approvals' as const,queryHash:'a'.repeat(64)};
  const read=(cursor?:import('../../src/http/cursors').CursorPayload)=>withTransaction(s.storage,tx=>listApprovals(tx,{actor,nowMs:x.now},{limit:1,binding,cursor}));
  const first=read();expect(first.items.map(i=>i.id)).toEqual(['approval_a']);expect(first.hasMore).toBe(true);const second=read(first.next!);expect(second.items.map(i=>i.id)).toEqual(['approval_b']);expect(second.hasMore).toBe(false);
  expect(()=>withTransaction(s.storage,tx=>listApprovals(tx,{actor,nowMs:x.now},{limit:1,binding:{...binding,principalId:'different'},cursor:first.next!}))).toThrow('INVALID_REQUEST');
  s.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"tasks:read\"]' WHERE principal_id='human_operator'");expect(()=>read(first.next!)).toThrow('FORBIDDEN');
 });
});
it('fixed_production_request_composition_stays_unavailable_even_with_fixture_policy_installed',async()=>{
 const f=await decisionFixture('request_production_empty');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name),before=snapshot(s.storage),{prepareRequestTaskDecision}=await import('../../src/approvals/commands');
  await expect(prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');expect(snapshot(s.storage)).toEqual(before);
 });
});
it('decision_role_edges_pin_generation_against_cleanup_even_after_metadata_corruption',async()=>{
 const f=await decisionFixture('decision_retention');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name),a=await api();executeCommand(x.execution,x.identity,await a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'}),x.body);
  const g=s.storage.sql.exec<{id:string;object_key:string}>('SELECT id,object_key FROM artifact_generations WHERE artifact_id=\'input_a\'').one();
  s.storage.sql.exec("UPDATE artifacts SET status='expired',committed_at=NULL,committed_generation_id=NULL,active_generation_id=NULL,expires_at=?,expiry_check_at=NULL WHERE id='input_a'",x.now);
  s.storage.sql.exec("UPDATE artifact_generations SET state='tombstoned',cleanup_next_at=? WHERE id=?",x.now,g.id);
  const {cleanupArtifactGenerations}=await import('../../src/artifacts/reconcile');const result=await cleanupArtifactGenerations({workspace:x.ctx.workspace,bucket:x.ctx.bucket!,admission:x.ctx.admission},2);
  expect(result.deleted).toBe(0);expect(result.held).toBe(1);expect((await x.ctx.bucket!.get(g.object_key))?.size).toBe(37);
 });
});
it('artifact_visibility_conjoins_decision_owner_task_with_original_associations',async()=>{
 const f=await decisionFixture('decision_artifact_access');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name,'task_b'),a=await api();executeCommand(x.execution,x.identity,await a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'}),x.body);
  const {human}=await import('../helpers/settings'),{resolveActor}=await import('../../src/auth/authorize'),{withTransaction}=await import('../../src/storage/transaction'),{authorizeArtifactRead}=await import('../../src/artifacts/repository');const identity=human(s.storage);
  s.storage.sql.exec("UPDATE tasks SET project_id='project_a' WHERE id='task_b'");s.storage.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_a\"]' WHERE principal_id='human_operator'");
  expect(()=>withTransaction(s.storage,tx=>authorizeArtifactRead(tx,{actor:resolveActor(tx,identity,x.now),nowMs:x.now},'input_a'))).toThrow('NOT_FOUND');
 });
});
it('stored_binding_rejects_orphan_artifact_identity_outside_exact_role_union',async()=>{
 const f=await decisionFixture('decision_binding_union');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name),a=await api();executeCommand(x.execution,x.identity,await a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'}),x.body);
  const {parsePersistedBinding}=await import('../../src/approvals/stored-validation'),stored=s.storage.sql.exec<{binding_json:string}>('SELECT binding_json FROM decision_proposals').one().binding_json,binding=JSON.parse(stored);
  expect(parsePersistedBinding(stored).taskId).toBe('task_a');binding.artifacts.push({...binding.artifacts[0],artifactId:'orphan'});expect(()=>parsePersistedBinding(JSON.stringify(binding))).toThrow('DECISION_UNAVAILABLE');
 });
});
it('admission_capacity_preflight_uses_exact_recovery_encoder_and_typed_limit',async()=>{
 const {assertDecisionProposalCapacity}=await import('../../src/approvals/capacity');
 const row={id:'proposal_a',workspace_id:'ws_example',task_id:'task_a',proposal_version:1,proposal_json:'{}',binding_json:'{}',semantic_anchor_json:'{}',created_at:1};
 expect(()=>assertDecisionProposalCapacity(row)).not.toThrow();
 expect(()=>assertDecisionProposalCapacity({...row,binding_json:JSON.stringify({x:'"'.repeat(300000)})})).toThrow('LIMIT_EXCEEDED');
});
it('notice_deferred_event_FK_commits_atomically_and_retains_request_event_not_outcomes',async()=>{
 const f=await decisionFixture('decision_notice_fk');
 const committed=await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name),a=await api();executeCommand(x.execution,x.identity,await a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'}),x.body);
  const {withTransaction}=await import('../../src/storage/transaction'),{cleanupCompletedOutcomes}=await import('../../src/workspace/idempotency');
  const row=s.storage.sql.exec<{event_id:string}>('SELECT event_id FROM decision_notice_intents LIMIT 1').one();expect(s.storage.sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
  withTransaction(s.storage,tx=>cleanupCompletedOutcomes(tx,'ws_example',x.now+86400001));expect(s.storage.sql.exec("SELECT * FROM idempotency_outcomes WHERE key='decision'").toArray()).toHaveLength(0);expect(s.storage.sql.exec('SELECT * FROM decision_notice_intents').toArray()).toHaveLength(2);
  await s.storage.sync();return {eventId:row.event_id,before:snapshot(s.storage)};
 });
 // Deferred foreign keys are checked by workerd's outer flush, not transactionSync's savepoint.
 await expect(runInDurableObject(f.stub,async(_o,s)=>{
  const {withTransaction}=await import('../../src/storage/transaction');
  withTransaction(s.storage,tx=>{tx.exec('DELETE FROM task_history WHERE event_id=?',[committed.eventId]);tx.exec('DELETE FROM events WHERE id=?',[committed.eventId]);});
  await s.storage.sync();
 })).rejects.toThrow('FOREIGN KEY');
 const {env}=await import('cloudflare:workers');
 await runInDurableObject(env.WORKSPACE.getByName(f.name),(_o,s)=>expect(snapshot(s.storage)).toEqual(committed.before));
});
it('approval_read_privacy_hides_foreign_scope_like_absent_but_preserves_global_scope_denial',async()=>{
 const f=await decisionFixture('approval_privacy');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await setup(s.storage,f.name),a=await api();executeCommand(x.execution,x.identity,await a.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'}),x.body);
  const {getApproval}=await import('../../src/approvals/queries'),{human}=await import('../helpers/settings'),{resolveActor}=await import('../../src/auth/authorize'),{withTransaction}=await import('../../src/storage/transaction'),identity=human(s.storage);
  const read=(id:string)=>withTransaction(s.storage,tx=>getApproval(tx,{actor:resolveActor(tx,identity,x.now),nowMs:x.now},id));
  s.storage.sql.exec("UPDATE human_grants SET project_ids_json='[]' WHERE principal_id='human_operator'");
  expect(()=>read('approval_a')).toThrow('NOT_FOUND');expect(()=>read('missing')).toThrow('NOT_FOUND');
  s.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"approvals:read\"]' WHERE principal_id='human_operator'");expect(()=>read('approval_a')).toThrow('FORBIDDEN');expect(()=>read('missing')).toThrow('FORBIDDEN');
  s.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"tasks:read\"]' WHERE principal_id='human_operator'");
  expect(()=>read('approval_a')).toThrow('FORBIDDEN');expect(()=>read('missing')).toThrow('FORBIDDEN');
 });
});
