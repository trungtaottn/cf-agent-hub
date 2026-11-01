import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {claimFixture,claimSetup,claimContext,PROOF_A} from '../helpers/claims';
import {claimTaskCommand} from '../../src/tasks/claim';
import {executeCommand} from '../../src/workspace/commands';
import {expireDueRuns} from '../../src/tasks/failure';
import {withTransaction} from '../../src/storage/transaction';
import {cleanupCompletedOutcomes} from '../../src/workspace/idempotency';
import {lookupTaskClaimOutcome} from '../../src/tasks/claim-outcome';

it('claim_lookup_returns_exact_original_data_without_writes',async()=>{
 const {stub,name}=await claimFixture('lookup-original');
 await runInDurableObject(stub,async(_o,state)=>{
  const setup=claimSetup(state.storage),ctx=await claimContext(state.storage,name,setup.body,'original',setup.now);
  const original=executeCommand(ctx,setup.identity,claimTaskCommand('task_a','run_original',PROOF_A),setup.body);
  const before=claimSnapshot(state.storage);
  expect(lookupTaskClaimOutcome(ctx,setup.identity,'task_a',setup.body,PROOF_A)).toEqual(original);
  expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
it('claim_lookup_missing_never_executes_a_ready_claim',async()=>{
 const {stub,name}=await claimFixture('lookup-missing');
 await runInDurableObject(stub,async(_o,state)=>{
  const setup=claimSetup(state.storage),ctx=await claimContext(state.storage,name,setup.body,'missing',setup.now),before=claimSnapshot(state.storage);
  expect(()=>lookupTaskClaimOutcome(ctx,setup.identity,'task_a',setup.body,PROOF_A)).toThrowError(expect.objectContaining({code:'NOT_FOUND',status:404}));
  expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
it('claim_lookup_changed_fingerprint_is_conflict_not_apply',async()=>{
 const {stub,name}=await claimFixture('lookup-conflict');
 await runInDurableObject(stub,async(_o,state)=>{
  const setup=claimSetup(state.storage),ctx=await claimContext(state.storage,name,setup.body,'same',setup.now);
  executeCommand(ctx,setup.identity,claimTaskCommand('task_a','run_original',PROOF_A),setup.body);
  const changed={...setup.body,expected_version:3},other=await claimContext(state.storage,name,changed,'same',setup.now),before=claimSnapshot(state.storage);
  expect(()=>lookupTaskClaimOutcome(other,setup.identity,'task_a',changed,PROOF_A)).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT',status:409}));
  expect(claimSnapshot(state.storage)).toEqual(before);
 });
});

for(const fault of ['proof','revoked','grant','epoch','generation','runtime_expired'] as const)it('claim_lookup_rechecks_current_'+fault,async()=>{
 const {stub,name}=await claimFixture('lookup-auth-'+fault);
 await runInDurableObject(stub,async(_o,state)=>{
  const setup=claimSetup(state.storage),ctx=await claimContext(state.storage,name,setup.body,'original',setup.now);
  executeCommand(ctx,setup.identity,claimTaskCommand('task_a','run_original',PROOF_A),setup.body);
  if(fault==='revoked')state.storage.sql.exec("UPDATE native_credentials SET revoked_at=? WHERE credential_id='credential_research_1'",setup.now);
  if(fault==='grant')state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"tasks:claim\",\"runtimes:manage\"]' WHERE credential_id='credential_research_1'");
  if(fault==='epoch')ctx.admissionEpoch++;
  if(fault==='generation')ctx.admissionGeneration++;
  if(fault==='runtime_expired')ctx.workspace.clock={nowMs:()=>setup.now+86400000};
  const before=claimSnapshot(state.storage);
  expect(()=>lookupTaskClaimOutcome(ctx,setup.identity,'task_a',setup.body,fault==='proof'?'b'.repeat(64):PROOF_A)).toThrowError(expect.objectContaining({status:fault==='grant'?403:401}));
  expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
for(const fault of ['status','version','run','event','history','oversize'] as const)it('claim_lookup_rejects_corrupt_original_'+fault,async()=>{
 const {stub,name}=await claimFixture('lookup-join-'+fault);
 await runInDurableObject(stub,async(_o,state)=>{
  const setup=claimSetup(state.storage),ctx=await claimContext(state.storage,name,setup.body,'original',setup.now);
  const original=executeCommand(ctx,setup.identity,claimTaskCommand('task_a','run_original',PROOF_A),setup.body);
  if(fault==='status')state.storage.sql.exec('UPDATE idempotency_outcomes SET status=201');
  if(fault==='version')state.storage.sql.exec('UPDATE idempotency_outcomes SET outcome_json=?',JSON.stringify({...original.data,task:{...original.data.task,task_version:4}}));
  if(fault==='run')state.storage.sql.exec("UPDATE runs SET started_at=started_at+1 WHERE id='run_original'");
  if(fault==='event')state.storage.sql.exec("UPDATE events SET fence=fence+1 WHERE type='task.claimed'");
  if(fault==='history')state.storage.sql.exec("UPDATE task_history SET task_version=task_version+1 WHERE kind='task.claimed'");
  if(fault==='oversize')state.storage.sql.exec('UPDATE idempotency_outcomes SET outcome_json=?',JSON.stringify('x'.repeat(1048577)));
  const before=claimSnapshot(state.storage);
  expect(()=>lookupTaskClaimOutcome(ctx,setup.identity,'task_a',setup.body,PROOF_A)).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR',status:500}));
  expect(claimSnapshot(state.storage)).toEqual(before);
 });
});

// All persisted application SQL tables, not merely the tables the old claim touched.
function claimSnapshot(storage:DurableObjectStorage){
 const tables=storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").toArray();
 return Object.fromEntries(tables.map(({name})=>{if(!/^[a-z_][a-z0-9_]*$/.test(name))throw Error('UNEXPECTED_TABLE');return [name,storage.sql.exec('SELECT * FROM '+name+' ORDER BY rowid').toArray()];}));
}
it('claim_lookup_returns_historical_active_dto_after_actual_lease_expiry_without_renewal',async()=>{
 const {stub,name}=await claimFixture('lookup-ended');
 await runInDurableObject(stub,async(_o,state)=>{
  const setup=claimSetup(state.storage),ctx=await claimContext(state.storage,name,setup.body,'original',setup.now);
  const original=executeCommand(ctx,setup.identity,claimTaskCommand('task_a','run_original',PROOF_A),setup.body);
  withTransaction(state.storage,tx=>expireDueRuns(tx,setup.now+60000,1));
  ctx.workspace.clock={nowMs:()=>setup.now+60001};
  const before=claimSnapshot(state.storage);
  expect(lookupTaskClaimOutcome(ctx,setup.identity,'task_a',setup.body,PROOF_A)).toEqual(original);
  expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
for(const delta of [-1,0,1])it('claim_lookup_ledger_expiry_is_exclusive_'+delta,async()=>{
 const {stub,name}=await claimFixture('lookup-retention-'+String(delta).replace('-','minus'));
 await runInDurableObject(stub,async(_o,state)=>{
  const setup=claimSetup(state.storage),ctx=await claimContext(state.storage,name,setup.body,'original',setup.now);
  const original=executeCommand(ctx,setup.identity,claimTaskCommand('task_a','run_original',PROOF_A),setup.body);
  // Explicit valid-current-auth fixture isolates ledger expiry from independent presence expiry.
  state.storage.sql.exec("UPDATE runtimes SET presence_expires_at=? WHERE id='runtime_a'",setup.now+86400000+60000);
  let now=setup.now;ctx.workspace.clock={nowMs:()=>now};
  await Promise.resolve();now=setup.now+86400000+delta;
  const before=claimSnapshot(state.storage);
  if(delta<0)expect(lookupTaskClaimOutcome(ctx,setup.identity,'task_a',setup.body,PROOF_A)).toEqual(original);
  else expect(()=>lookupTaskClaimOutcome(ctx,setup.identity,'task_a',setup.body,PROOF_A)).toThrowError(expect.objectContaining({code:'NOT_FOUND',status:404}));
  expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
it('claim_lookup_server_clock_forward_gc_cannot_reexecute_same_original_version',async()=>{
 const {stub,name}=await claimFixture('lookup-gc-version');
 await runInDurableObject(stub,async(_o,state)=>{
  const setup=claimSetup(state.storage),ctx=await claimContext(state.storage,name,setup.body,'original',setup.now);
  executeCommand(ctx,setup.identity,claimTaskCommand('task_a','run_original',PROOF_A),setup.body);
  withTransaction(state.storage,tx=>expireDueRuns(tx,setup.now+60000,1));
  state.storage.sql.exec("UPDATE runtimes SET presence_expires_at=? WHERE id='runtime_a'",setup.now+86400000+60000);
  ctx.workspace.clock={nowMs:()=>setup.now+86400001};
  withTransaction(state.storage,tx=>cleanupCompletedOutcomes(tx,'ws_example',setup.now+86400001));
  const before=claimSnapshot(state.storage);
  expect(()=>lookupTaskClaimOutcome(ctx,setup.identity,'task_a',setup.body,PROOF_A)).toThrowError(expect.objectContaining({code:'NOT_FOUND',status:404}));
  expect(()=>executeCommand(ctx,setup.identity,claimTaskCommand('task_a','run_never',PROOF_A),setup.body)).toThrowError(expect.objectContaining({code:'VERSION_CONFLICT',status:409}));
  expect(claimSnapshot(state.storage)).toEqual(before);
 });
});

import {heartbeatRunCommand} from '../../src/tasks/lease';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {decisionFixture,descriptor} from '../helpers/decision-policy';
import {admitted} from '../helpers/persisted-decision';
import {createDecisionCommands} from '../../src/approvals/commands-source';
import {createTaskClaimCommands} from '../../src/tasks/claim-source';
it('claim_lookup_rejects_fabricated_historical_lease_without_constraining_current_renewal',async()=>{
 const {stub,name}=await claimFixture('lookup-original-lease');
 await runInDurableObject(stub,async(_o,state)=>{
  const setup=claimSetup(state.storage),ctx=await claimContext(state.storage,name,setup.body,'original',setup.now);
  const original=executeCommand(ctx,setup.identity,claimTaskCommand('task_a','run_original',PROOF_A),setup.body);
  const beat={expected_run_version:1,fence:1},renew={...await claimContext(state.storage,name,beat,'beat',setup.now+1000),fingerprint:await fingerprintRequest('POST','/v2/workspaces/ws_example/runs/run_original:heartbeat',{},beat)};
  executeCommand(renew,setup.identity,heartbeatRunCommand('run_original',PROOF_A),beat);
  ctx.workspace.clock={nowMs:()=>setup.now+1001};
  const before=claimSnapshot(state.storage);expect(lookupTaskClaimOutcome(ctx,setup.identity,'task_a',setup.body,PROOF_A)).toEqual(original);expect(claimSnapshot(state.storage)).toEqual(before);
  state.storage.sql.exec("UPDATE idempotency_outcomes SET outcome_json=? WHERE key='original'",JSON.stringify({...original.data,run:{...original.data.run!,lease_expires_at:new Date(setup.now+86400000).toISOString()}}));
  const corrupted=claimSnapshot(state.storage);
  expect(()=>lookupTaskClaimOutcome(ctx,setup.identity,'task_a',setup.body,PROOF_A)).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR',status:500}));
  expect(claimSnapshot(state.storage)).toEqual(corrupted);
 });
});
for(const fault of ['none','pair','saved_approval','pending','decision_actor','decision_time','decision_reason','approval_version','cancelled','expired_approval'] as const)it('claim_lookup_consumed_approval_'+fault,async()=>{
 const f=await decisionFixture('lookup-approved-'+fault,undefined,2,true);
 await runInDurableObject(f.stub,async(_o,state)=>{
  const x=await admitted(state.storage,f.name),decision={expected_version:4,expected_approval_version:1,expected_proposal_version:1,reason:'Reviewed exact synthetic intent'};
  const approve=await createDecisionCommands([descriptor]).prepareApprovalDecision({...x.humanContext,idempotencyKey:'approve'},'approval_a','approve',decision);
  executeCommand({...x.execution,workspace:x.humanContext.workspace,idempotencyKey:'approve',fingerprint:await fingerprintRequest('POST','/approve',{},decision)},x.humanContext.identity,approve,decision);
  const body={expected_version:5,runtime_instance_id:'runtime_a'},command=await createTaskClaimCommands([descriptor]).prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  const ctx={...await claimContext(state.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},original=executeCommand(ctx,x.identity,command,body);
  if(fault==='pair')state.storage.sql.exec("UPDATE approvals SET consumed_fence=3 WHERE id='approval_a'");
  if(fault==='saved_approval')state.storage.sql.exec("UPDATE idempotency_outcomes SET outcome_json=? WHERE key='approved_claim'",JSON.stringify({...original.data,approval:null}));
  if(['pending','decision_actor','decision_time','decision_reason','approval_version'].includes(fault)){
   const altered=structuredClone(original.data);const approval=altered.approval!;
   if(fault==='pending')Object.assign(approval,{status:'pending',approval_version:1,decided_at:null,decided_by:null,decision_reason:null});
   if(fault==='decision_actor'){approval.decided_by={kind:'human',principal_id:original.data.approval!.decided_by!.principal_id==='human_operator'?'human_reviewer':'human_operator',agent_id:null};expect(approval.decided_by.principal_id).not.toBe(original.data.approval!.decided_by!.principal_id);}
   if(fault==='decision_time')approval.decided_at=new Date(x.now+1).toISOString();
   if(fault==='decision_reason')approval.decision_reason='Substituted historical reason';
   if(fault==='approval_version')approval.approval_version=3;
   state.storage.sql.exec("UPDATE idempotency_outcomes SET outcome_json=? WHERE key='approved_claim'",JSON.stringify(altered));
  }
  if(fault==='cancelled'){
   const {cancelTaskCommand}=await import('../../src/tasks/commands'),cancel={expected_version:6,reason:'Cancel consumed work'};
   executeCommand({...await claimContext(state.storage,f.name,cancel,'cancel',x.now),workspace:x.humanContext.workspace},x.humanContext.identity,cancelTaskCommand('task_a'),cancel);
   expect(state.storage.sql.exec("SELECT status,approval_version FROM approvals WHERE id='approval_a'").one()).toEqual({status:'invalidated',approval_version:3});
  }
  if(fault==='expired_approval'){
   const {heartbeatRuntimeCommand}=await import('../../src/runtimes/commands'),heartbeat={expected_runtime_version:1};
   executeCommand({...await claimContext(state.storage,f.name,heartbeat,'runtime-live',x.now+80000),fingerprint:await fingerprintRequest('POST','/v2/workspaces/ws_example/runtimes/runtime_a:heartbeat',{},heartbeat),workspace:{...x.ctx.workspace,clock:{nowMs:()=>x.now+80000}}},x.identity,heartbeatRuntimeCommand('runtime_a',PROOF_A),heartbeat);
   state.storage.sql.exec('UPDATE human_grants SET enabled=0');
   ctx.workspace={...ctx.workspace,clock:{nowMs:()=>x.now+120001}};
  }
  const before=claimSnapshot(state.storage);
  if(fault==='none'||fault==='cancelled'||fault==='expired_approval')expect(lookupTaskClaimOutcome(ctx,x.identity,'task_a',body,PROOF_A)).toEqual(original);
  else expect(()=>lookupTaskClaimOutcome(ctx,x.identity,'task_a',body,PROOF_A)).toThrowError(expect.objectContaining({status:500}));
  expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
it('claim_lookup_old_body_cannot_alias_a_later_same_key_incarnation_after_real_GC',async()=>{
 const {stub,name}=await claimFixture('lookup-gc-incarnation',{replaySafe:true});
 await runInDurableObject(stub,async(_o,state)=>{
  const setup=claimSetup(state.storage),ctx=await claimContext(state.storage,name,setup.body,'original',setup.now);
  executeCommand(ctx,setup.identity,claimTaskCommand('task_a','run_original',PROOF_A),setup.body);
  withTransaction(state.storage,tx=>expireDueRuns(tx,setup.now+60000,1));
  expect(state.storage.sql.exec("SELECT state,task_version FROM tasks WHERE id='task_a'").one()).toEqual({state:'ready',task_version:4});
  // Isolate ledger clock movement from the independently tested runtime-expiry401 lane.
  state.storage.sql.exec("UPDATE runtimes SET presence_expires_at=? WHERE id='runtime_a'",setup.now+86400000+60000);
  withTransaction(state.storage,tx=>cleanupCompletedOutcomes(tx,'ws_example',setup.now+86400001));
  const later={...setup.body,expected_version:4},next=await claimContext(state.storage,name,later,'original',setup.now+86400001);
  const accepted=executeCommand(next,setup.identity,claimTaskCommand('task_a','run_later',PROOF_A),later);expect(accepted.data.run).toMatchObject({id:'run_later',fence:2});
  ctx.workspace.clock={nowMs:()=>setup.now+86400001};const before=claimSnapshot(state.storage);
  expect(()=>lookupTaskClaimOutcome(ctx,setup.identity,'task_a',setup.body,PROOF_A)).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT',status:409}));
  expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
