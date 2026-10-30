import {it,expect} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {claimFixture,claimSetup,claimContext,claimIdentity,claimSnapshot,PROOF_A,PROOF_B,PROOF_OTHER,PROOF_ROTATED} from '../helpers/claims';
import {taskProfile,taskContext} from '../helpers/tasks';
import {claimTaskCommand} from '../../src/tasks/claim';
import {executeCommand} from '../../src/workspace/commands';
import {withTransaction} from '../../src/storage/transaction';
import {archiveAgent} from '../../src/agents/commands';
const count=(s:DurableObjectStorage,t:string)=>s.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM '+t).one().n;
function attempt(fn:()=>unknown){try{return {ok:true as const,value:fn()};}catch(error){return {ok:false as const,error};}}

it('two_claims_one_run_with_atomic_event_outcome_and_scheduler',async()=>{
 const {stub,name}=await claimFixture('claim-two');await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage),before=claimSnapshot(state.storage);
  const contexts=await Promise.all(['one','two'].map(k=>claimContext(state.storage,name,body,k,now)));
  let release!:()=>void;const barrier=new Promise<void>(r=>release=r);
  const attempts=contexts.map((ctx,i)=>(async()=>{await barrier;return attempt(()=>executeCommand(ctx,identity,claimTaskCommand('task_a','run_'+i,PROOF_A),body));})());release();
  const results=await Promise.all(attempts),won=results.filter(r=>r.ok),lost=results.filter(r=>!r.ok);
  expect(won).toHaveLength(1);expect(lost).toHaveLength(1);expect(lost[0]).toMatchObject({error:{code:'VERSION_CONFLICT'}});
  expect(count(state.storage,'runs')).toBe(1);expect(count(state.storage,'events')).toBe(before.events.length+1);expect(count(state.storage,'task_history')).toBe(1);expect(count(state.storage,'idempotency_outcomes')).toBe(1);
  const run=state.storage.sql.exec('SELECT * FROM runs').one();expect(run).toMatchObject({status:'active',run_version:1,fence:1,lease_expires_at:now+60000,credential_id:'credential_research_1',runtime_instance_id:'runtime_a',replay_policy_version:null,replay_rule_id:null,replay_evidence_ref:null});
  expect(state.storage.sql.exec("SELECT state,task_version,active_run_id,latest_run_id,next_fence FROM tasks WHERE id='task_a'").one()).toEqual({state:'doing',task_version:3,active_run_id:run.id,latest_run_id:run.id,next_fence:2});
  expect(state.storage.sql.exec("SELECT type,task_version,run_id,fence FROM events WHERE type='task.claimed'").one()).toEqual({type:'task.claimed',task_version:3,run_id:run.id,fence:1});
  expect(state.storage.sql.exec('SELECT dirty,generation FROM scheduler_state').one()).toMatchObject({dirty:1});expect(state.storage.sql.exec('SELECT * FROM outbox').toArray()).toEqual(before.outbox);
 });
});
it('two_tasks_last_wip_slot_has_one_winner_across_same_agent_runtimes',async()=>{
 const {stub,name}=await claimFixture('claim-wip');await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage),other={...body,runtime_instance_id:'runtime_b'};
  const contexts=await Promise.all([claimContext(state.storage,name,body,'one',now),claimContext(state.storage,name,other,'two',now,'task_b')]);
  let release!:()=>void;const barrier=new Promise<void>(r=>release=r);const jobs=contexts.map((ctx,i)=>(async()=>{await barrier;return attempt(()=>executeCommand(ctx,identity,claimTaskCommand(i?'task_b':'task_a','run_'+i,i?PROOF_B:PROOF_A),i?other:body));})());release();const results=await Promise.all(jobs);
  expect(results.filter(r=>r.ok)).toHaveLength(1);expect(results.filter(r=>!r.ok)).toHaveLength(1);expect(results.find(r=>!r.ok)).toMatchObject({error:{code:'LIMIT_EXCEEDED'}});
  expect(count(state.storage,'runs')).toBe(1);expect(count(state.storage,'idempotency_outcomes')).toBe(1);expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM tasks WHERE state='ready'").one()).toEqual({n:1});
 });
});
it('lost_response_same_key_replays_original_run_after_restart_without_new_deadline',async()=>{
 const {stub,name}=await claimFixture('claim-restart');let original:unknown,now=0;
 await runInDurableObject(stub,async(_o,state)=>{const setup=claimSetup(state.storage);now=setup.now;const ctx=await claimContext(state.storage,name,setup.body,'lost',now);original=executeCommand(ctx,setup.identity,claimTaskCommand('task_a','run_original',PROOF_A),setup.body);});
 await evictDurableObject(stub);
 await runInDurableObject(stub,async(_o,state)=>{const body={expected_version:2,runtime_instance_id:'runtime_a'},before=claimSnapshot(state.storage),ctx=await claimContext(state.storage,name,body,'lost',now+1000);expect(executeCommand(ctx,claimIdentity(state.storage),claimTaskCommand('task_a','run_unused',PROOF_A),body)).toEqual(original);expect(claimSnapshot(state.storage)).toEqual(before);});
});
it('same_key_changed_body_conflicts_and_another_principal_cannot_replay',async()=>{
 const {stub,name}=await claimFixture('claim-key');await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage),ctx=await claimContext(state.storage,name,body,'same',now);executeCommand(ctx,identity,claimTaskCommand('task_a','run_a',PROOF_A),body);const before=claimSnapshot(state.storage);
  const changed={...body,expected_version:3},changedCtx=await claimContext(state.storage,name,changed,'same',now);
  expect(()=>executeCommand(changedCtx,identity,claimTaskCommand('task_a','run_b',PROOF_A),changed)).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT'}));
  const other={...body,runtime_instance_id:'runtime_other'},otherCtx=await claimContext(state.storage,name,other,'same',now);
  expect(()=>executeCommand(otherCtx,claimIdentity(state.storage,'credential_other'),claimTaskCommand('task_a','run_c',PROOF_OTHER),other)).toThrowError(expect.objectContaining({code:'VERSION_CONFLICT'}));expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
it('same_agent_other_runtime_or_rotated_credential_cannot_replay_original_ownership',async()=>{
 const {stub,name}=await claimFixture('claim-runtime-replay');await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage),ctx=await claimContext(state.storage,name,body,'same',now);executeCommand(ctx,identity,claimTaskCommand('task_a','run_a',PROOF_A),body);const before=claimSnapshot(state.storage);
  expect(()=>executeCommand(ctx,identity,claimTaskCommand('task_a','unused',PROOF_B),body)).toThrowError(expect.objectContaining({status:401}));
  expect(()=>executeCommand(ctx,claimIdentity(state.storage,'credential_research_2'),claimTaskCommand('task_a','unused',PROOF_ROTATED),body)).toThrowError(expect.objectContaining({status:401}));expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
it('unswept_expired_active_runs_retain_wip_and_cannot_be_stolen',async()=>{
 const {stub,name}=await claimFixture('claim-expired-wip');await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage);executeCommand(await claimContext(state.storage,name,body,'first',now),identity,claimTaskCommand('task_a','run_a',PROOF_A),body);
  const before=claimSnapshot(state.storage),ctx=await claimContext(state.storage,name,body,'second',now+60000,'task_b');expect(()=>executeCommand(ctx,identity,claimTaskCommand('task_b','run_b',PROOF_A),body)).toThrowError(expect.objectContaining({code:'LIMIT_EXCEEDED'}));expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
it('claim_captures_exact_preexecution_replay_safety_and_never_returns_private_evidence',async()=>{
 const {stub,name}=await claimFixture('claim-safety',{replaySafe:true});await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage),result=executeCommand(await claimContext(state.storage,name,body,'safe',now),identity,claimTaskCommand('task_a','run_safe',PROOF_A),body);
  expect(state.storage.sql.exec('SELECT replay_policy_version,replay_rule_id,replay_evidence_ref FROM runs').one()).toEqual({replay_policy_version:7,replay_rule_id:'synthetic_safe',replay_evidence_ref:'urn:synthetic:preexecution-evidence'});
  for(const serialized of [JSON.stringify(result),JSON.stringify(state.storage.sql.exec('SELECT * FROM events').toArray()),JSON.stringify(state.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray())])for(const hidden of ['urn:synthetic:preexecution-evidence',PROOF_A,'credential_research_1'])expect(serialized).not.toContain(hidden);
 });
});
it('transaction_abort_after_run_insert_rolls_back_all_ownership_and_scheduler_writes',async()=>{
 const {stub,name}=await claimFixture('claim-abort');await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage),ctx=await claimContext(state.storage,name,body,'abort',now),before=claimSnapshot(state.storage);
  state.storage.sql.exec("CREATE TRIGGER reject_claim_event BEFORE INSERT ON events WHEN NEW.type='task.claimed' BEGIN SELECT RAISE(ABORT,'synthetic_claim_abort'); END");
  expect(()=>executeCommand(ctx,identity,claimTaskCommand('task_a','run_abort',PROOF_A),body)).toThrow('synthetic_claim_abort');expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
it('future_attempt_allocates_new_run_and_larger_fence_never_resuming_ended_run',async()=>{
 const {stub,name}=await claimFixture('claim-fence');await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage);executeCommand(await claimContext(state.storage,name,body,'first',now),identity,claimTaskCommand('task_a','run_first',PROOF_A),body);
  // Simulate the future settlement owner's persisted output, not an implemented retry operation.
  withTransaction(state.storage,tx=>{tx.exec("UPDATE tasks SET state='ready',active_run_id=NULL,task_version=4 WHERE id='task_a'");tx.exec("UPDATE runs SET status='expired',ended_at=?,run_version=2 WHERE id='run_first'",[now+60000]);});
  const next={...body,expected_version:4};const result=executeCommand(await claimContext(state.storage,name,next,'next',now+60001),identity,claimTaskCommand('task_a','run_second',PROOF_A),next);
  expect(result.data).toMatchObject({task:{task_version:5,active_run_id:'run_second',latest_run_id:'run_second'},run:{id:'run_second',fence:2,run_version:1}});expect(state.storage.sql.exec("SELECT status,ended_at,run_version,fence FROM runs WHERE id='run_first'").one()).toEqual({status:'expired',ended_at:now+60000,run_version:2,fence:1});expect(state.storage.sql.exec("SELECT next_fence FROM tasks WHERE id='task_a'").one()).toEqual({next_fence:3});
 });
});
for(const condition of ['outcome_unknown','retry_exhausted','approved','backlog','version','assignment'] as const)it('claim_denies_'+condition+'_without_partial_effects',async()=>{
 const {stub,name}=await claimFixture('claim-deny-'+condition);await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage);
  if(condition==='outcome_unknown'||condition==='retry_exhausted')state.storage.sql.exec("UPDATE tasks SET flags_json=? WHERE id='task_a'",JSON.stringify([condition]));
  if(condition==='approved')state.storage.sql.exec("UPDATE tasks SET approval_id='synthetic_approval' WHERE id='task_a'");
  if(condition==='backlog')state.storage.sql.exec("UPDATE tasks SET state='backlog' WHERE id='task_a'");
  if(condition==='version')state.storage.sql.exec("UPDATE tasks SET task_version=3 WHERE id='task_a'");
  if(condition==='assignment')state.storage.sql.exec("UPDATE tasks SET assigned_agent_id='agent_other' WHERE id='task_a'");
  const before=claimSnapshot(state.storage),ctx=await claimContext(state.storage,name,body,'denied',now);
  const code=condition==='approved'?'DEPENDENCY_UNAVAILABLE':condition==='version'?'VERSION_CONFLICT':condition==='assignment'?'FORBIDDEN':'INVALID_STATE';expect(()=>executeCommand(ctx,identity,claimTaskCommand('task_a','run_denied',PROOF_A),body)).toThrowError(expect.objectContaining({code}));expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
for(const field of ['project','role'] as const)it('archived_'+field+'_denies_claim_in_current_transaction',async()=>{
 const {stub,name}=await claimFixture('claim-archive-'+field);await runInDurableObject(stub,async(_o,state)=>{
  taskProfile(state.storage);const {now,identity,body}=claimSetup(state.storage,Date.now(),{project_id:'project_a',work_role_id:'role_a'});
  const profile=JSON.parse(state.storage.sql.exec<{document_json:string}>('SELECT document_json FROM profiles').one().document_json);profile[field==='project'?'projects':'work_roles'][0].archived=true;state.storage.sql.exec('UPDATE profiles SET document_json=?',JSON.stringify(profile));
  const before=claimSnapshot(state.storage),ctx=await claimContext(state.storage,name,body,'denied',now);expect(()=>executeCommand(ctx,identity,claimTaskCommand('task_a','run_denied',PROOF_A),body)).toThrowError(expect.objectContaining({code:'NOT_FOUND'}));expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
it('native_claim_does_not_require_extra_tasks_read_scope',async()=>{
 const {stub,name}=await claimFixture('claim-no-read',{scopes:['workspace:read','tasks:claim','tasks:execute','runtimes:manage']});await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage);expect(executeCommand(await claimContext(state.storage,name,body,'claim',now),identity,claimTaskCommand('task_a','run_a',PROOF_A),body).data.run).toMatchObject({id:'run_a'});
 });
});
it('missing_execute_scope_does_not_borrow_another_credential_authority',async()=>{
 const {stub,name}=await claimFixture('claim-coherent');await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage);state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"tasks:claim\",\"runtimes:manage\"]' WHERE credential_id='credential_research_1'");const before=claimSnapshot(state.storage),ctx=await claimContext(state.storage,name,body,'denied',now);
  expect(()=>executeCommand(ctx,identity,claimTaskCommand('task_a','run_bad',PROOF_A),body)).toThrowError(expect.objectContaining({status:403}));expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
it('archive_racing_claim_has_one_valid_order_no_half_revoked_owner',async()=>{
 for(const order of ['archive-first','claim-first']){const {stub,name}=await claimFixture('claim-archive-race-'+order);await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage),ctx=await claimContext(state.storage,name,body,'claim',now),human=taskContext(state.storage);
  const claim=()=>executeCommand(ctx,identity,claimTaskCommand('task_a','run_a',PROOF_A),body),archive=()=>withTransaction(state.storage,tx=>archiveAgent(tx,human,'agent_research',{expected_agent_version:1,reason:'Synthetic archive race'}));
  if(order==='archive-first'){archive();expect(claim).toThrowError(expect.objectContaining({status:401}));expect(count(state.storage,'runs')).toBe(0);expect(state.storage.sql.exec("SELECT enabled,revoked_at FROM native_credentials WHERE agent_id='agent_research'").toArray().every(r=>r.enabled===0&&r.revoked_at!==null)).toBe(true);}
  else {claim();expect(archive).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));expect(count(state.storage,'runs')).toBe(1);expect(state.storage.sql.exec("SELECT status FROM static_agents WHERE agent_id='agent_research'").one()).toEqual({status:'active'});expect(state.storage.sql.exec("SELECT revoked_at FROM runtimes WHERE id='runtime_a'").one()).toEqual({revoked_at:null});}
 });}
});
