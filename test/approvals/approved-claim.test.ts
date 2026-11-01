import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {decisionFixture,descriptor} from '../helpers/decision-policy';
import {admitted} from '../helpers/persisted-decision';
import {createDecisionCommands} from '../../src/approvals/commands-source';
import {executeCommand} from '../../src/workspace/commands';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {PROOF_A,claimContext} from '../helpers/claims';
import {createTaskClaimCommands} from '../../src/tasks/claim-source';
async function approved(storage:DurableObjectStorage,name:string){
 const x=await admitted(storage,name),body={expected_version:4,expected_approval_version:1,expected_proposal_version:1,reason:'Reviewed exact synthetic intent'},command=await createDecisionCommands([descriptor]).prepareApprovalDecision({...x.humanContext,idempotencyKey:'approve'},'approval_a','approve',body);
 executeCommand({...x.execution,workspace:x.humanContext.workspace,idempotencyKey:'approve',fingerprint:await fingerprintRequest('POST','/approve',{},body)},x.humanContext.identity,command,body);return x;
}
const body={expected_version:5,runtime_instance_id:'runtime_a'};
it('first approved claim creates a fresh run and irreversible pair with original approval unchanged',async()=>{
 const f=await decisionFixture('approved_first_claim');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),before=s.storage.sql.exec('SELECT approval_version,proposal_version,expires_at,decided_at,decided_by_json,decision_reason FROM approvals').one();
  const command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body),e=await claimContext(s.storage,f.name,body,'approved_claim',x.now);
  const out=executeCommand({...e,workspace:x.ctx.workspace},x.identity,command,body).data;
  expect(out.task).toMatchObject({state:'doing',task_version:6,active_run_id:'run_approved',latest_run_id:'run_approved',approval_id:'approval_a',retry_count:0});
  expect(out.run).toMatchObject({id:'run_approved',status:'active',fence:2,run_version:1});expect(out.approval).toMatchObject({id:'approval_a',status:'approved',approval_version:2});
  expect(s.storage.sql.exec('SELECT approval_version,proposal_version,expires_at,decided_at,decided_by_json,decision_reason FROM approvals').one()).toEqual(before);
  expect(s.storage.sql.exec('SELECT consumed_run_id,consumed_fence FROM approvals').one()).toEqual({consumed_run_id:'run_approved',consumed_fence:2});
  expect(s.storage.sql.exec("SELECT status,ended_at FROM runs WHERE id='run_initial'").one()).toEqual({status:'paused',ended_at:x.now});
  expect(s.storage.sql.exec('SELECT task_version,task_state,transition_count FROM decision_lifecycle_heads').one()).toEqual({task_version:6,task_state:'doing',transition_count:3});
 });
});
import {wrapBucket} from '../helpers/artifacts';
const snapshot=(s:DurableObjectStorage)=>Object.fromEntries(['tasks','runs','task_results','task_acceptances','artifact_associations','approvals','decision_checkpoints','decision_proposals','decision_artifact_edges','decision_notice_intents','decision_lifecycle_heads','decision_lifecycle_transitions','events','task_history','idempotency_outcomes','scheduler_state'].map(t=>[t,s.sql.exec('SELECT * FROM '+t+' ORDER BY rowid').toArray()]));
it('competing prepared approved claims have one winner and the paused owner cannot heartbeat',async()=>{
 const f=await decisionFixture('approved_claim_race');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),commands=await Promise.all(['one','two'].map(key=>api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:key},'task_a','run_'+key,PROOF_A,body))),contexts=await Promise.all(['one','two'].map(key=>claimContext(s.storage,f.name,body,key,x.now)));
  const outcomes=await Promise.allSettled(commands.map((c,i)=>Promise.resolve().then(()=>executeCommand({...contexts[i],workspace:x.ctx.workspace},x.identity,c,body))));
  expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(o=>o.status==='rejected')).toMatchObject([{reason:{code:'VERSION_CONFLICT'}}]);
  expect(s.storage.sql.exec("SELECT id FROM runs WHERE status='active'").toArray()).toHaveLength(1);
  const {heartbeatRunCommand}=await import('../../src/tasks/lease'),heartbeat={expected_run_version:2,fence:1},e=await claimContext(s.storage,f.name,heartbeat,'paused_heartbeat',x.now);
  const before=snapshot(s.storage);expect(()=>executeCommand({...e,workspace:x.ctx.workspace},x.identity,heartbeatRunCommand('run_initial',PROOF_A),heartbeat)).toThrow('STALE_RUN');expect(snapshot(s.storage)).toEqual(before);
 });
});
it('approved claim replay stays historical, changed payload conflicts, and ledger loss cannot remint consumption',async()=>{
 const f=await decisionFixture('approved_claim_replay');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),ctx={...x.ctx,idempotencyKey:'approved_claim'},prepare=(input=body)=>api.prepareClaimTaskCommand(ctx,'task_a','run_approved',PROOF_A,input),e={...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace};
  const out=executeCommand(e,x.identity,await prepare(),body),before=snapshot(s.storage);expect(executeCommand(e,x.identity,await prepare(),body)).toEqual(out);expect(snapshot(s.storage)).toEqual(before);
  const changed={...body,runtime_instance_id:'missing_runtime'},different=await prepare(changed);expect(()=>executeCommand({...e,fingerprint:'f'.repeat(64)},x.identity,different,changed)).toThrow('IDEMPOTENCY_CONFLICT');expect(snapshot(s.storage)).toEqual(before);
  const retained=await prepare();s.storage.sql.exec("DELETE FROM idempotency_outcomes WHERE key='approved_claim'");const afterGC=snapshot(s.storage);
  expect(()=>executeCommand(e,x.identity,retained,body)).toThrow('DEPENDENCY_UNAVAILABLE');
  await expect(api.prepareClaimTaskCommand({...ctx,idempotencyKey:'new_key'},'task_a','run_approved',PROOF_A,{...body,expected_version:6})).rejects.toThrow();expect(snapshot(s.storage)).toEqual(afterGC);
 });
});
it('claim permission revoked during exact byte await denies without any command writes',async()=>{
 const f=await decisionFixture('approved_claim_revoke');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),bucket=x.ctx.bucket!,before=snapshot(s.storage);
  const ctx={...x.ctx,idempotencyKey:'approved_claim',bucket:wrapBucket(bucket,{get:async(...args:Parameters<R2Bucket['get']>)=>{const object=await bucket.get(...args);s.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"tasks:read\",\"tasks:execute\",\"artifacts:read\",\"runtimes:manage\"]' WHERE credential_id='credential_research_1'");return object;}})};
  await expect(api.prepareClaimTaskCommand(ctx,'task_a','run_approved',PROOF_A,body)).rejects.toThrow();expect(snapshot(s.storage)).toEqual(before);
 });
});
it('approved claim SQL failure rolls back run fence consumption lineage event and outcome together',async()=>{
 const f=await decisionFixture('approved_claim_rollback');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body),e={...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},before=snapshot(s.storage);
  for(const [table,verb] of [['runs','INSERT'],['tasks','UPDATE'],['approvals','UPDATE'],['decision_lifecycle_heads','UPDATE'],['decision_lifecycle_transitions','INSERT'],['events','INSERT'],['idempotency_outcomes','INSERT']]){
   s.storage.sql.exec(`CREATE TRIGGER claim_fault BEFORE ${verb} ON ${table} BEGIN SELECT RAISE(ABORT,'claim_fault'); END`);expect(()=>executeCommand(e,x.identity,command,body)).toThrow();s.storage.sql.exec('DROP TRIGGER claim_fault');expect(snapshot(s.storage)).toEqual(before);
  }
 });
});
it('fixed production claim composition cannot activate the private fixture action',async()=>{
 const f=await decisionFixture('approved_claim_empty');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),{prepareClaimTaskCommand}=await import('../../src/tasks/claim'),before=snapshot(s.storage);
  await expect(prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');expect(snapshot(s.storage)).toEqual(before);
 });
});
it('consumed failure holds Waiting and cannot manufacture no-effect reuse',async()=>{
 const f=await decisionFixture('approved_claim_fail');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
  const {failTaskCommand}=await import('../../src/tasks/failure'),input={expected_version:6,run_id:'run_approved',fence:2,outcome_unknown:false,reason:'Synthetic failure'};
  const out=executeCommand({...await claimContext(s.storage,f.name,input,'fail',x.now),workspace:x.ctx.workspace},x.identity,failTaskCommand('task_a',PROOF_A),input).data;
  expect(out.task).toMatchObject({state:'waiting',task_version:7,active_run_id:null,retry_count:0,approval_id:'approval_a'});expect(out.task.flags).toContain('outcome_unknown');
  expect(s.storage.sql.exec('SELECT status,approval_version,consumed_run_id,consumed_fence FROM approvals').one()).toEqual({status:'approved',approval_version:2,consumed_run_id:'run_approved',consumed_fence:2});
  expect(s.storage.sql.exec('SELECT task_version,task_state,transition_count FROM decision_lifecycle_heads').one()).toEqual({task_version:7,task_state:'waiting',transition_count:4});
 });
});

import {withTransaction} from '../../src/storage/transaction';
it('actual consumed execution lease expiry appends Waiting lineage without retry or approval expiry',async()=>{
 const f=await decisionFixture('approved_claim_lease');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
  const {expireDueRuns}=await import('../../src/tasks/failure');expect(withTransaction(s.storage,tx=>expireDueRuns(tx,x.now+60000,1)).processed).toBe(1);
  expect(s.storage.sql.exec('SELECT state,task_version,retry_count,flags_json FROM tasks WHERE id=?','task_a').one()).toMatchObject({state:'waiting',task_version:7,retry_count:0,flags_json:'["outcome_unknown"]'});
  expect(s.storage.sql.exec('SELECT kind,after_state FROM decision_lifecycle_transitions WHERE sequence=4').one()).toEqual({kind:'lease_expiry',after_state:'waiting'});
  expect(s.storage.sql.exec('SELECT consumed_run_id,status FROM approvals').one()).toEqual({consumed_run_id:'run_approved',status:'approved'});
 });
});
it('consumed submission and independent acceptance advance exact lineage without changing approval',async()=>{
 const f=await decisionFixture('approved_claim_result',undefined,2,false,true);await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
  const {submitTaskResultCommand,acceptTaskResultCommand}=await import('../../src/tasks/results'),input={expected_version:6,run_id:'run_approved',fence:2,result:{summary:'Synthetic completed result',artifact_ids:[]}};
  const out=executeCommand({...await claimContext(s.storage,f.name,input,'submit',x.now),workspace:x.ctx.workspace},x.identity,submitTaskResultCommand('task_a',PROOF_A),input).data;
  expect(out.task).toMatchObject({state:'review',task_version:7,approval_id:'approval_a'});
  expect(s.storage.sql.exec('SELECT task_version,task_state,transition_count FROM decision_lifecycle_heads').one()).toEqual({task_version:7,task_state:'review',transition_count:4});
  const accept={expected_version:7,reason:'Independent synthetic result review'},result=executeCommand({...await claimContext(s.storage,f.name,accept,'accept',x.now),workspace:x.humanContext.workspace},x.humanContext.identity,acceptTaskResultCommand('task_a'),accept).data;
  expect(result.task).toMatchObject({state:'done',task_version:8,approval_id:'approval_a'});expect(result.approval).toBeNull();
  expect(s.storage.sql.exec('SELECT task_version,task_state,transition_count FROM decision_lifecycle_heads').one()).toEqual({task_version:8,task_state:'done',transition_count:5});
  expect(s.storage.sql.exec('SELECT consumed_run_id,status,approval_version FROM approvals').one()).toEqual({consumed_run_id:'run_approved',status:'approved',approval_version:2});
 });
});
import {createApprovedIntentGuard} from '../../src/approvals/execution-guard-source';
import {syntheticPolicy} from '../helpers/decision-policy';
it('consumed dispatch uses its distinct exact-run lane and never renews the original lifetime',async()=>{
 const f=await decisionFixture('approved_dispatch',{...syntheticPolicy,expiry_seconds:1});await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
  const guard=createApprovedIntentGuard([descriptor]),run={runId:'run_approved',fence:2,runtimeInstanceId:'runtime_a',proofHash:PROOF_A},receipt=await guard.verifyConsumedIntent(x.ctx,'task_a',run);
  const exact=withTransaction(s.storage,tx=>guard.assertConsumedIntentCurrent(tx,x.ctx,'task_a',receipt));
  expect(exact).toEqual({actionId:descriptor.actionId,input:{task_id:'task_a',task_version:3}});expect(Object.isFrozen(exact.input)).toBe(true);
  await expect(guard.verifyApprovedIntent(x.ctx,'task_a')).rejects.toThrow();
  expect(()=>withTransaction(s.storage,tx=>createApprovedIntentGuard([descriptor]).assertConsumedIntentCurrent(tx,x.ctx,'task_a',receipt))).toThrow();
  expect(()=>withTransaction(s.storage,tx=>guard.assertConsumedIntentCurrent(tx,x.ctx,'task_a',{...receipt}))).toThrow();
  const expired={...x.ctx,workspace:{...x.ctx.workspace,clock:{nowMs:()=>x.now+1000}}};
  await expect(guard.verifyConsumedIntent(expired,'task_a',run)).rejects.toThrow();
  // Settling already-admitted work is not a new dispatch and remains permitted after TTL.
  const {submitTaskResultCommand}=await import('../../src/tasks/results'),input={expected_version:6,run_id:run.runId,fence:2,result:{summary:'Completed before expiry; reported afterward',artifact_ids:[]}};
  const out=executeCommand(await claimContext(s.storage,f.name,input,'submit_after_ttl',x.now+1000),x.identity,submitTaskResultCommand('task_a',PROOF_A),input).data;expect(out.task.state).toBe('review');
  expect(()=>withTransaction(s.storage,tx=>guard.assertConsumedIntentCurrent(tx,x.ctx,'task_a',receipt))).toThrow();
 });
});
it('claim deadline crossing byte await reports expiry without any command writes',async()=>{
 const f=await decisionFixture('approved_claim_deadline',{...syntheticPolicy,expiry_seconds:1});await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]);let now=x.now;const bucket=x.ctx.bucket!,before=snapshot(s.storage),ctx={...x.ctx,idempotencyKey:'expired_claim',workspace:{...x.ctx.workspace,clock:{nowMs:()=>now}},bucket:wrapBucket(bucket,{get:async(...args:Parameters<R2Bucket['get']>)=>{const o=await bucket.get(...args);now=x.now+1000;return o;}})};
  await expect(api.prepareClaimTaskCommand(ctx,'task_a','run_expired',PROOF_A,body)).rejects.toThrow('APPROVAL_EXPIRED');expect(snapshot(s.storage)).toEqual(before);
 });
});
it('claim final transaction rejects exact deadline after successful byte preparation',async()=>{
 const f=await decisionFixture('approved_claim_final_deadline',{...syntheticPolicy,expiry_seconds:1});await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'late_claim'},'task_a','run_late',PROOF_A,body),before=snapshot(s.storage);
  const execution=await claimContext(s.storage,f.name,body,'late_claim',x.now+1000);expect(()=>executeCommand(execution,x.identity,command,body)).toThrow('APPROVAL_EXPIRED');expect(snapshot(s.storage)).toEqual(before);
 });
});
it.each(['runtime','fence','proof','task','revoked','expired'] as const)('consumed dispatch denies %s without granting a fresh effect',async bad=>{
 const f=await decisionFixture('approved_dispatch_bad_'+bad,{...syntheticPolicy,expiry_seconds:1});await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
  const guard=createApprovedIntentGuard([descriptor]),bucket=x.ctx.bucket!;let now=x.now;
  const ctx={...x.ctx,workspace:{...x.ctx.workspace,clock:{nowMs:()=>now}},bucket:wrapBucket(bucket,{get:async(...args:Parameters<R2Bucket['get']>)=>{const object=await bucket.get(...args);if(bad==='revoked')s.storage.sql.exec("UPDATE native_credentials SET revoked_at=? WHERE credential_id='credential_research_1'",x.now);if(bad==='expired')now=x.now+1000;return object;}})},binding={runId:'run_approved',fence:bad==='fence'?1:2,runtimeInstanceId:bad==='runtime'?'runtime_b':'runtime_a',proofHash:bad==='proof'?'e'.repeat(64):PROOF_A},before=snapshot(s.storage);
  await expect(guard.verifyConsumedIntent(ctx,bad==='task'?'task_b':'task_a',binding)).rejects.toThrow();expect(snapshot(s.storage)).toEqual(before);
 });
});
it('consumed work is never swept as approval expiry and heartbeat is only liveness',async()=>{
 const f=await decisionFixture('approved_heartbeat',{...syntheticPolicy,expiry_seconds:1});await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
  const before=snapshot(s.storage),{expireDueApprovals}=await import('../../src/approvals/expiry');expect(withTransaction(s.storage,tx=>expireDueApprovals(tx,x.now+1000,2))).toEqual({processed:0,held:0,nextDueAt:null});expect(snapshot(s.storage)).toEqual(before);
  const {heartbeatRunCommand}=await import('../../src/tasks/lease'),heartbeat={expected_run_version:1,fence:2},out=executeCommand(await claimContext(s.storage,f.name,heartbeat,'heartbeat',x.now+1000),x.identity,heartbeatRunCommand('run_approved',PROOF_A),heartbeat).data;
  expect(out.run_version).toBe(2);expect(s.storage.sql.exec('SELECT task_version,transition_count FROM decision_lifecycle_heads').one()).toEqual({task_version:6,transition_count:3});
  await expect(createApprovedIntentGuard([descriptor]).verifyConsumedIntent({...x.ctx,workspace:{...x.ctx.workspace,clock:{nowMs:()=>x.now+1000}}},'task_a',{runId:'run_approved',fence:2,runtimeInstanceId:'runtime_a',proofHash:PROOF_A})).rejects.toThrow();
 });
});
it('approval-null observation cannot authorize a task bound by an intervening actual request',async()=>{
 const f=await decisionFixture('approved_null_race');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),guard=createApprovedIntentGuard([descriptor]),receipt=await guard.verifyApprovedIntent(x.ctx,'task_b');expect(receipt).toBeNull();
  const {admittedAdditional}=await import('../helpers/persisted-decision');await admittedAdditional(s.storage,f.name,x.now,'b',false);
  const {taskRecord}=await import('../../src/tasks/repository'),before=snapshot(s.storage);
  expect(()=>withTransaction(s.storage,tx=>guard.assertApprovedIntentCurrent(tx,x.ctx,taskRecord(tx,'ws_example','task_b'),receipt))).toThrow('DECISION_UNAVAILABLE');expect(snapshot(s.storage)).toEqual(before);
 });
});
it.each(['head','consumed_fence','consumed_run','paused','proposal','unsafe_next_fence'] as const)('bound settlement rejects corrupted %s tuples without partial writes',async bad=>{
 const f=await decisionFixture('approved_settlement_bad_'+bad);await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
  // Deliberate corruption, never positive authority or no-effect evidence.
  if(bad==='head')s.storage.sql.exec('UPDATE decision_lifecycle_heads SET task_version=7');
  if(bad==='consumed_fence')s.storage.sql.exec('UPDATE approvals SET consumed_fence=3');
  if(bad==='consumed_run')s.storage.sql.exec("UPDATE approvals SET consumed_run_id='run_initial',consumed_fence=1");
  if(bad==='paused')s.storage.sql.exec("UPDATE runs SET ended_at=ended_at+1 WHERE id='run_initial'");
  if(bad==='proposal')s.storage.sql.exec("UPDATE tasks SET proposal_version=2 WHERE id='task_a'");
  if(bad==='unsafe_next_fence'){s.storage.sql.exec("UPDATE runs SET fence=? WHERE id='run_approved'",Number.MAX_SAFE_INTEGER);s.storage.sql.exec('UPDATE approvals SET consumed_fence=?',Number.MAX_SAFE_INTEGER);s.storage.sql.exec("UPDATE tasks SET next_fence=? WHERE id='task_a'",Number.MAX_SAFE_INTEGER+1);}
  const {failTaskCommand}=await import('../../src/tasks/failure'),input={expected_version:6,run_id:'run_approved',fence:bad==='unsafe_next_fence'?Number.MAX_SAFE_INTEGER:2,outcome_unknown:false,reason:'Cannot settle corruption'},e=await claimContext(s.storage,f.name,input,'fail_corrupt',x.now),before=snapshot(s.storage);
  expect(()=>executeCommand(e,x.identity,failTaskCommand('task_a',PROOF_A),input)).toThrow();expect(snapshot(s.storage)).toEqual(before);
 });
});
it.each(['active','failed','expired','submitted'] as const)('cancellation of actual consumed %s work preserves irreversible provenance',async state=>{
 const f=await decisionFixture('approved_cancel_'+state,undefined,2,true);await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
  let version=6,now=x.now;
  if(state==='failed'){const {failTaskCommand}=await import('../../src/tasks/failure'),input={expected_version:6,run_id:'run_approved',fence:2,outcome_unknown:false,reason:'Failed consumed attempt'};executeCommand(await claimContext(s.storage,f.name,input,'fail',now),x.identity,failTaskCommand('task_a',PROOF_A),input);version++;}
  if(state==='expired'){const {expireDueRuns}=await import('../../src/tasks/failure');now+=60000;withTransaction(s.storage,tx=>expireDueRuns(tx,now,1));version++;}
  if(state==='submitted'){const {submitTaskResultCommand}=await import('../../src/tasks/results'),input={expected_version:6,run_id:'run_approved',fence:2,result:{summary:'Completed consumed attempt',artifact_ids:[]}};executeCommand(await claimContext(s.storage,f.name,input,'submit',now),x.identity,submitTaskResultCommand('task_a',PROOF_A),input);version++;}
  const {cancelTaskCommand}=await import('../../src/tasks/commands'),input={expected_version:version,reason:'Cancel exact consumed work'},before=s.storage.sql.exec('SELECT decided_at,decided_by_json,decision_reason,consumed_run_id,consumed_fence FROM approvals').one();
  const out=executeCommand(await claimContext(s.storage,f.name,input,'cancel',now),x.humanContext.identity,cancelTaskCommand('task_a'),input).data;expect(out.task).toMatchObject({state:'cancelled',task_version:version+1,approval_id:null});
  expect(s.storage.sql.exec('SELECT decided_at,decided_by_json,decision_reason,consumed_run_id,consumed_fence FROM approvals').one()).toEqual(before);expect(s.storage.sql.exec('SELECT status,approval_version FROM approvals').one()).toEqual({status:'invalidated',approval_version:3});
 });
});
it.each(['reviewer','policy','generation','missing_bytes','substituted_bytes'] as const)('approved claim denies %s drift across exact byte await with no claim writes',async bad=>{
 const f=await decisionFixture('approved_drift_'+bad);await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),bucket=x.ctx.bucket!,before=snapshot(s.storage),ctx={...x.ctx,idempotencyKey:'drift_claim',bucket:wrapBucket(bucket,{get:async(...args:Parameters<R2Bucket['get']>)=>{
   if(bad==='missing_bytes')return null;
   const o=await bucket.get(...args);
   if(bad==='reviewer')s.storage.sql.exec("UPDATE human_grants SET scopes_json='[]' WHERE principal_id='human_reviewer'");
   if(bad==='policy'){const c=JSON.parse(s.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one().config_json);c.workspace_policies[0].decision_policy.policy_version++;s.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',JSON.stringify(c));}
   if(bad==='generation')s.storage.sql.exec("UPDATE artifact_generations SET object_key=object_key||'_changed' WHERE artifact_id='input_a'");
   if(bad==='substituted_bytes'&&o)return new Proxy(o,{get(target,key){if(key==='body')return new Blob(['{"task_id":"task_b","task_version":3}']).stream();const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
   return o;
  }})};
  await expect(api.prepareClaimTaskCommand(ctx,'task_a','run_drift',PROOF_A,body)).rejects.toThrow();expect(snapshot(s.storage)).toEqual(before);
 });
});
it('broad replay-safety metadata and false uncertainty cannot upgrade consumed work into reusable authority',async()=>{
 const f=await decisionFixture('approved_no_effect_spoof');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
  // Adversarial stored metadata only: NOT a real no-effect producer or positive reuse fixture.
  s.storage.sql.exec("UPDATE runs SET replay_policy_version=1,replay_rule_id='broad_unsafe_upgrade',replay_evidence_ref='urn:synthetic:not-action-specific' WHERE id='run_approved'");
  const {failTaskCommand}=await import('../../src/tasks/failure'),input={expected_version:6,run_id:'run_approved',fence:2,outcome_unknown:false,reason:'Caller asserts no effect'};
  const out=executeCommand(await claimContext(s.storage,f.name,input,'fail',x.now),x.identity,failTaskCommand('task_a',PROOF_A),input).data;expect(out.task).toMatchObject({state:'waiting',retry_count:0});expect(out.task.flags).toContain('outcome_unknown');
  const before=snapshot(s.storage);await expect(api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'reuse'},'task_a','run_reused',PROOF_A,{...body,expected_version:7})).rejects.toThrow();expect(snapshot(s.storage)).toEqual(before);
 });
});
it.each(['fail','expire','submit','accept'] as const)('consumed %s rolls back lineage run result event and outcome atomically',async action=>{
 const f=await decisionFixture('approved_settle_fault_'+action,undefined,2,false,true);await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
  const {failTaskCommand,expireDueRuns}=await import('../../src/tasks/failure'),{submitTaskResultCommand,acceptTaskResultCommand}=await import('../../src/tasks/results'),submit={expected_version:6,run_id:'run_approved',fence:2,result:{summary:'Fault-tested result',artifact_ids:[]}},failed={expected_version:6,run_id:'run_approved',fence:2,outcome_unknown:false,reason:'Fault-tested failure'},accept={expected_version:7,reason:'Fault-tested independent review'};
  if(action==='accept')executeCommand(await claimContext(s.storage,f.name,submit,'submit',x.now),x.identity,submitTaskResultCommand('task_a',PROOF_A),submit);
  const input=action==='accept'?accept:action==='fail'?failed:submit,execution=await claimContext(s.storage,f.name,input,'fault',x.now),before=snapshot(s.storage);
  for(const [table,verb] of [['decision_lifecycle_heads','UPDATE'],['decision_lifecycle_transitions','INSERT'],['events','INSERT'],...(action==='expire'?[]:[['idempotency_outcomes','INSERT']])]){
   s.storage.sql.exec(`CREATE TRIGGER settle_fault BEFORE ${verb} ON ${table} BEGIN SELECT RAISE(ABORT,'settle_fault'); END`);
   expect(()=>{
    if(action==='expire')return withTransaction(s.storage,tx=>expireDueRuns(tx,x.now+60000,1));
    if(action==='accept')return executeCommand(execution,x.humanContext.identity,acceptTaskResultCommand('task_a'),accept);
    if(action==='fail')return executeCommand(execution,x.identity,failTaskCommand('task_a',PROOF_A),failed);
    return executeCommand(execution,x.identity,submitTaskResultCommand('task_a',PROOF_A),submit);
   }).toThrow();s.storage.sql.exec('DROP TRIGGER settle_fault');expect(snapshot(s.storage)).toEqual(before);
  }
 });
});
it('approved claim keeps the existing final WIP guard after exact input verification',async()=>{
 const f=await decisionFixture('approved_wip');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  const {resolveActor}=await import('../../src/auth/authorize'),{createTask,readyTask}=await import('../../src/tasks/commands'),{claimTaskCommand}=await import('../../src/tasks/claim');
  withTransaction(s.storage,tx=>{const ctx={actor:resolveActor(tx,x.humanContext.identity,x.now),nowMs:x.now,requestId:'wip_fixture',idempotencyKey:'wip_fixture'};createTask(tx,{...ctx,taskId:'task_extra'},{title:'Real competing WIP task',description:''});readyTask(tx,ctx,'task_extra',{expected_version:1});});
  const input={expected_version:2,runtime_instance_id:'runtime_a'};for(const id of ['task_b','task_extra'])executeCommand(await claimContext(s.storage,f.name,input,id,x.now,id),x.identity,claimTaskCommand(id,'run_'+id,PROOF_A),input);
  const execution=await claimContext(s.storage,f.name,body,'approved_claim',x.now),before=snapshot(s.storage);expect(()=>executeCommand(execution,x.identity,command,body)).toThrow('LIMIT_EXCEEDED');expect(snapshot(s.storage)).toEqual(before);
 });
});
it('prepared approved claim rejects parameter substitution and current revoked replay authority',async()=>{
 const f=await decisionFixture('approved_payload_replay');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),ctx={...x.ctx,idempotencyKey:'approved_claim'},command=await api.prepareClaimTaskCommand(ctx,'task_a','run_approved',PROOF_A,body),changed={...body,runtime_instance_id:'runtime_b'},before=snapshot(s.storage);
  const changedExecution=await claimContext(s.storage,f.name,changed,'approved_claim',x.now);expect(()=>executeCommand(changedExecution,x.identity,command,changed)).toThrow('INVALID_REQUEST');expect(snapshot(s.storage)).toEqual(before);
  executeCommand(await claimContext(s.storage,f.name,body,'approved_claim',x.now),x.identity,command,body);
  s.storage.sql.exec("UPDATE runtimes SET revoked_at=? WHERE id='runtime_a'",x.now);const after=snapshot(s.storage);await expect(api.prepareClaimTaskCommand(ctx,'task_a','run_approved',PROOF_A,body)).rejects.toThrow();expect(snapshot(s.storage)).toEqual(after);
 });
});
it.each(['missing','agent','unassigned','outside_lifetime','paused_owner'] as const)('approved claim rejects malformed stored human decision provenance %s',async bad=>{
 const f=await decisionFixture('approved_decider_'+bad);await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]);
  // Deliberate malformed history, not an alternate positive approval producer.
  if(bad==='missing')s.storage.sql.exec('UPDATE approvals SET decided_by_json=NULL');
  if(bad==='agent')s.storage.sql.exec('UPDATE approvals SET decided_by_json=?',JSON.stringify({kind:'agent',principal_id:'agent_research',agent_id:'agent_research'}));
  if(bad==='unassigned')s.storage.sql.exec('UPDATE approvals SET decided_by_json=?',JSON.stringify({kind:'human',principal_id:'unassigned_human',agent_id:null}));
  if(bad==='outside_lifetime')s.storage.sql.exec('UPDATE approvals SET decided_at=expires_at');
  if(bad==='paused_owner')s.storage.sql.exec("UPDATE runs SET agent_id='agent_other',credential_id='credential_other',runtime_instance_id='runtime_other' WHERE id='run_initial'");
  const before=snapshot(s.storage);await expect(api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'corrupt_decider'},'task_a','run_corrupt',PROOF_A,body)).rejects.toThrow();expect(snapshot(s.storage)).toEqual(before);
 });
});
it.each(['run_version','lease_expires_at','started_at'] as const)('consumed dispatch rejects unsafe persisted %s rather than relying on old SQLite affinity',async field=>{
 const f=await decisionFixture('approved_unsafe_'+field);await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
  s.storage.sql.exec(`UPDATE runs SET ${field}=? WHERE id='run_approved'`,Number.MAX_SAFE_INTEGER+1);const before=snapshot(s.storage);
  await expect(createApprovedIntentGuard([descriptor]).verifyConsumedIntent(x.ctx,'task_a',{runId:'run_approved',fence:2,runtimeInstanceId:'runtime_a',proofHash:PROOF_A})).rejects.toThrow();expect(snapshot(s.storage)).toEqual(before);
 });
});
it.each(['lease_expires_at','started_at'] as const)('consumed dispatch rejects REAL persisted %s even when Date can round it',async field=>{
 const f=await decisionFixture('approved_real_'+field);await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
  s.storage.sql.exec(`UPDATE runs SET ${field}=? WHERE id='run_approved'`,x.now+(field==='lease_expires_at'?60000:0)+0.5);const before=snapshot(s.storage);
  await expect(createApprovedIntentGuard([descriptor]).verifyConsumedIntent(x.ctx,'task_a',{runId:'run_approved',fence:2,runtimeInstanceId:'runtime_a',proofHash:PROOF_A})).rejects.toThrow();expect(snapshot(s.storage)).toEqual(before);
 });
});
