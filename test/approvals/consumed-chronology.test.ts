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
import {createApprovedIntentGuard} from '../../src/approvals/execution-guard-source';
it('independent: future safe-integer started_at must not authorize consumed dispatch',async()=>{
 const f=await decisionFixture('independent_future_start');await runInDurableObject(f.stub,async(_o,s)=>{
 const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
 executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
 s.storage.sql.exec("UPDATE runs SET started_at=? WHERE id='run_approved'",x.now+1000);
 await expect(createApprovedIntentGuard([descriptor]).verifyConsumedIntent(x.ctx,'task_a',{runId:'run_approved',fence:2,runtimeInstanceId:'runtime_a',proofHash:PROOF_A})).rejects.toThrow();
 });
});
import {withTransaction} from '../../src/storage/transaction';
it.each(['before_decision','claim_time_mismatch','zero_lease','ended_before','ended_future'] as const)('consumed chronology rejects %s without changing trusted history',async bad=>{
 const f=await decisionFixture('consumed_time_'+bad,undefined,2,false,true);await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await approved(s.storage,f.name),api=createTaskClaimCommands([descriptor]),command=await api.prepareClaimTaskCommand({...x.ctx,idempotencyKey:'approved_claim'},'task_a','run_approved',PROOF_A,body);
  executeCommand({...await claimContext(s.storage,f.name,body,'approved_claim',x.now),workspace:x.ctx.workspace},x.identity,command,body);
  const snapshot=()=>Object.fromEntries(['tasks','runs','approvals','decision_lifecycle_heads','decision_lifecycle_transitions','events','task_history','task_results','task_acceptances','idempotency_outcomes'].map(t=>[t,s.storage.sql.exec('SELECT * FROM '+t+' ORDER BY rowid').toArray()]));
  if(bad==='zero_lease'){
   s.storage.sql.exec("UPDATE runs SET lease_expires_at=started_at WHERE id='run_approved'");const before=snapshot(),{expireDueRuns}=await import('../../src/tasks/failure');expect(()=>withTransaction(s.storage,tx=>expireDueRuns(tx,x.now,1))).toThrow();expect(snapshot()).toEqual(before);return;
  }
  if(bad==='ended_before'||bad==='ended_future'){
   const {submitTaskResultCommand,acceptTaskResultCommand}=await import('../../src/tasks/results'),input={expected_version:6,run_id:'run_approved',fence:2,result:{summary:'Actual settled run',artifact_ids:[]}};
   executeCommand(await claimContext(s.storage,f.name,input,'submit',x.now),x.identity,submitTaskResultCommand('task_a',PROOF_A),input);
   s.storage.sql.exec("UPDATE runs SET ended_at=? WHERE id='run_approved'",x.now+(bad==='ended_before'?-1:1000));const before=snapshot(),accept={expected_version:7,reason:'Independent review'},execution=await claimContext(s.storage,f.name,accept,'accept',x.now);
   expect(()=>executeCommand(execution,x.humanContext.identity,acceptTaskResultCommand('task_a'),accept)).toThrow();expect(snapshot()).toEqual(before);return;
  }
  s.storage.sql.exec("UPDATE runs SET started_at=? WHERE id='run_approved'",x.now+(bad==='before_decision'?-1:1));const before=snapshot(),ctx={...x.ctx,workspace:{...x.ctx.workspace,clock:{nowMs:()=>x.now+2}}};
  await expect(createApprovedIntentGuard([descriptor]).verifyConsumedIntent(ctx,'task_a',{runId:'run_approved',fence:2,runtimeInstanceId:'runtime_a',proofHash:PROOF_A})).rejects.toThrow();expect(snapshot()).toEqual(before);
 });
});
