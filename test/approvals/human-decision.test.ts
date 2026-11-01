import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {decisionFixture,descriptor} from '../helpers/decision-policy';
import {admitted} from '../helpers/persisted-decision';
import {createDecisionCommands} from '../../src/approvals/commands-source';
import {executeCommand} from '../../src/workspace/commands';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {wrapBucket} from '../helpers/artifacts';
import type {ApprovalDecisionRequest} from '../../src/http/dto';
const body:ApprovalDecisionRequest={expected_version:4,expected_approval_version:1,expected_proposal_version:1,reason:'Reviewed immutable intent'};
const snapshot=(s:DurableObjectStorage)=>Object.fromEntries(['tasks','runs','approvals','decision_lifecycle_heads','decision_lifecycle_transitions','events','task_history','idempotency_outcomes'].map(t=>[t,s.sql.exec('SELECT * FROM '+t+' ORDER BY rowid').toArray()]));
async function api(){const value=createDecisionCommands([descriptor]);expect(typeof value.prepareApprovalDecision).toBe('function');return value;}
async function execution(x:Awaited<ReturnType<typeof admitted>>,action:string,key='human_decision',input=body){return {...x.execution,workspace:x.humanContext.workspace,idempotencyKey:key,fingerprint:await fingerprintRequest('POST','/approvals/approval_a/'+action,{},input)};}
it('human approval moves Waiting to Ready atomically without minting a run or renewing expiry',async()=>{
 const f=await decisionFixture('human_approve');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),a=await api(),command=await a.prepareApprovalDecision({...x.humanContext,idempotencyKey:'human_decision'},'approval_a','approve',body);
  const result=executeCommand(await execution(x,'approve'),x.humanContext.identity,command,body).data;
  expect(result.task).toMatchObject({state:'ready',task_version:5,approval_id:'approval_a',active_run_id:null});
  expect(result.approval).toMatchObject({status:'approved',approval_version:2,proposal_version:1,decision_reason:body.reason,decided_by:{kind:'human',principal_id:'human_operator',agent_id:null},expires_at:new Date(x.now+120000).toISOString()});
  expect(result.run).toBeNull();expect(s.storage.sql.exec('SELECT status FROM runs').toArray()).toEqual([{status:'paused'}]);
  expect(s.storage.sql.exec('SELECT transition_count,task_version,task_state FROM decision_lifecycle_heads').one()).toEqual({transition_count:2,task_version:5,task_state:'ready'});
 });
});
it('human rejection needs current bound metadata but not unavailable R2 bytes and cannot escape through requeue',async()=>{
 const f=await decisionFixture('human_reject');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),a=await api();let gets=0;
  const ctx={...x.humanContext,idempotencyKey:'human_decision',bucket:wrapBucket(x.ctx.bucket!,{get:async()=>{gets++;throw Error('missing bytes');}})};
  const command=await a.prepareApprovalDecision(ctx,'approval_a','reject',body),result=executeCommand(await execution(x,'reject'),ctx.identity,command,body).data;
  expect(result.task).toMatchObject({state:'backlog',task_version:5,approval_id:'approval_a'});expect(result.approval).toMatchObject({status:'rejected',approval_version:2});expect(gets).toBe(0);
  const {withTransaction}=await import('../../src/storage/transaction'),{resolveActor}=await import('../../src/auth/authorize'),{requeueTask,readyTask,patchTask}=await import('../../src/tasks/commands');
  withTransaction(s.storage,tx=>{const c={actor:resolveActor(tx,ctx.identity,x.now),nowMs:x.now,requestId:'blocked',idempotencyKey:'blocked'};
   expect(()=>readyTask(tx,c,'task_a',{expected_version:5})).toThrow('INVALID_STATE');
   expect(()=>patchTask(tx,c,'task_a',{expected_version:5,title:'changed'})).toThrow('INVALID_STATE');
   expect(()=>requeueTask(tx,c,'task_a',{expected_version:5,reason:'bypass'})).toThrow('INVALID_STATE');
  });
 });
});
it('retained human replay is canonical, changed payload conflicts, and current revoked session is denied',async()=>{
 const f=await decisionFixture('human_replay');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),a=await api(),ctx={...x.humanContext,idempotencyKey:'human_decision'},prepare=(input=body)=>a.prepareApprovalDecision(ctx,'approval_a','approve',input),e=await execution(x,'approve');
  const first=executeCommand(e,ctx.identity,await prepare(),body),before=snapshot(s.storage);
  expect(executeCommand(e,ctx.identity,await prepare(),body)).toEqual(first);expect(snapshot(s.storage)).toEqual(before);
  const changed={...body,reason:'different'};
  const command=await prepare(changed);expect(()=>executeCommand({...e,fingerprint:'f'.repeat(64)},ctx.identity,command,changed)).toThrow('IDEMPOTENCY_CONFLICT');
  s.storage.sql.exec("UPDATE sessions SET revoked_at=? WHERE id='session_settings'",x.now);await expect(prepare()).rejects.toThrow();
 });
});
it('two currently assigned humans racing approve versus reject have one atomic winner',async()=>{
 const f=await decisionFixture('human_race');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),a=await api();
  s.storage.sql.exec("INSERT INTO sessions(id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,revoked_at,auth_epoch) VALUES('session_reviewer','ws_example','human_reviewer','reviewer_digest','reviewer_csrf','https://identity.example.invalid','synthetic-reviewer-subject',?,?,NULL,1)",x.now,x.now+1000000);
  const reviewer={...x.humanContext,identity:{kind:'human' as const,workspaceId:'ws_example',issuer:'https://identity.example.invalid',subject:'synthetic-reviewer-subject',sessionId:'session_reviewer'},idempotencyKey:'human_reviewer'};
  const [approve,reject]=await Promise.all([a.prepareApprovalDecision({...x.humanContext,idempotencyKey:'human_decision'},'approval_a','approve',body),a.prepareApprovalDecision(reviewer,'approval_a','reject',body)]);
  executeCommand(await execution(x,'approve'),x.humanContext.identity,approve,body);const before=snapshot(s.storage);
  const rejected=await execution(x,'reject','human_reviewer');expect(()=>executeCommand(rejected,reviewer.identity,reject,body)).toThrow('VERSION_CONFLICT');expect(snapshot(s.storage)).toEqual(before);
 });
});
it('all three decision versions and exact deadline deny before writes, including after R2 awaits',async()=>{
 const f=await decisionFixture('human_versions_deadline');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),a=await api(),ctx={...x.humanContext,idempotencyKey:'human_decision'},before=snapshot(s.storage);
  for(const field of ['expected_version','expected_approval_version','expected_proposal_version'] as const){await expect(a.prepareApprovalDecision(ctx,'approval_a','approve',{...body,[field]:body[field]+1})).rejects.toThrow('VERSION_CONFLICT');expect(snapshot(s.storage)).toEqual(before);}
  for(const value of [1.5,9007199254740992])await expect(a.prepareApprovalDecision(ctx,'approval_a','reject',{...body,expected_version:value})).rejects.toThrow('INVALID_REQUEST');
  let now=x.now;const bucket=x.ctx.bucket!,cross={...ctx,workspace:{...ctx.workspace,clock:{nowMs:()=>now}},bucket:wrapBucket(bucket,{get:async(...args:Parameters<R2Bucket['get']>)=>{const object=await bucket.get(...args);now=x.now+120000;return object;}})};
  await expect(a.prepareApprovalDecision(cross,'approval_a','approve',body)).rejects.toThrow('APPROVAL_EXPIRED');expect(snapshot(s.storage)).toEqual(before);
  now=x.now;const timed={...ctx,workspace:{...ctx.workspace,clock:{nowMs:()=>now}}},command=await a.prepareApprovalDecision(timed,'approval_a','approve',body),e={...await execution(x,'approve'),workspace:timed.workspace};now=x.now+120000;
  expect(()=>executeCommand(e,timed.identity,command,body)).toThrow('APPROVAL_EXPIRED');expect(snapshot(s.storage)).toEqual(before);
 });
});
it('human decision transaction faults and ledger-evidence race never partially apply',async()=>{
 const f=await decisionFixture('human_rollback');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),a=await api(),ctx={...x.humanContext,idempotencyKey:'human_decision'},command=await a.prepareApprovalDecision(ctx,'approval_a','approve',body),e=await execution(x,'approve'),before=snapshot(s.storage);
  for(const [table,verb] of [['tasks','UPDATE'],['approvals','UPDATE'],['decision_lifecycle_heads','UPDATE'],['decision_lifecycle_transitions','INSERT'],['events','INSERT'],['task_history','INSERT'],['idempotency_outcomes','INSERT']]){
   s.storage.sql.exec(`CREATE TRIGGER fail_decision BEFORE ${verb} ON ${table} BEGIN SELECT RAISE(ABORT,'fault'); END`);
   expect(()=>executeCommand(e,ctx.identity,command,body)).toThrow();s.storage.sql.exec('DROP TRIGGER fail_decision');expect(snapshot(s.storage)).toEqual(before);
  }
  executeCommand(e,ctx.identity,command,body);const replay=await a.prepareApprovalDecision(ctx,'approval_a','approve',body);s.storage.sql.exec("DELETE FROM idempotency_outcomes WHERE key='human_decision'");const retained=snapshot(s.storage);
  expect(()=>executeCommand(e,ctx.identity,replay,body)).toThrow('DEPENDENCY_UNAVAILABLE');expect(snapshot(s.storage)).toEqual(retained);
 });
});
it('metadata-only rejection evidence can never pass exact-byte approval recheck',async()=>{
 const f=await decisionFixture('metadata_not_bytes');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),{createPersistedInputVerifier}=await import('../../src/approvals/persisted-input-source'),{withTransaction}=await import('../../src/storage/transaction'),v=createPersistedInputVerifier([descriptor]);
  const metadata=v.verifyPersistedDecisionMetadata(x.humanContext,'approval_a');
  expect(()=>withTransaction(s.storage,tx=>v.recheckPersistedDecisionInput(tx,x.humanContext,'approval_a',metadata))).toThrow('DECISION_UNAVAILABLE');
 });
});
it('cancellation invalidates pending or approved authority atomically while preserving original decision',async()=>{
 for(const approved of [false,true]){
  const f=await decisionFixture('human_cancel_'+approved,undefined,2,true);await runInDurableObject(f.stub,async(_o,s)=>{
   const x=await admitted(s.storage,f.name),a=await api(),ctx={...x.humanContext,idempotencyKey:'human_decision'};
   if(approved)executeCommand(await execution(x,'approve'),ctx.identity,await a.prepareApprovalDecision(ctx,'approval_a','approve',body),body);
   const original=s.storage.sql.exec('SELECT decided_at,decided_by_json,decision_reason,expires_at FROM approvals').one(),{cancelTaskCommand}=await import('../../src/tasks/commands');
   const input={expected_version:approved?5:4,reason:'Stop local authority'},e={...await execution(x,'cancel','cancel'),fingerprint:await fingerprintRequest('POST','/tasks/task_a/cancel',{},input)};
   const result=executeCommand(e,ctx.identity,cancelTaskCommand('task_a'),input).data;
   expect(result.task).toMatchObject({state:'cancelled',approval_id:null,task_version:approved?6:5});
   expect(s.storage.sql.exec('SELECT status,approval_version FROM approvals').one()).toEqual({status:'invalidated',approval_version:approved?3:2});
   expect(s.storage.sql.exec('SELECT decided_at,decided_by_json,decision_reason,expires_at FROM approvals').one()).toEqual(original);
   expect(s.storage.sql.exec('SELECT task_version,task_state,transition_count FROM decision_lifecycle_heads').one()).toEqual({task_version:approved?6:5,task_state:'cancelled',transition_count:approved?3:2});
   const before=snapshot(s.storage);expect(executeCommand(e,ctx.identity,cancelTaskCommand('task_a'),input).data).toEqual(result);expect(snapshot(s.storage)).toEqual(before);
  });
 }
});
it('native and unassigned configured human identities cannot decide even with otherwise valid versions',async()=>{
 const f=await decisionFixture('human_assigned_only',undefined,3);await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),a=await api(),before=snapshot(s.storage);
  await expect(a.prepareApprovalDecision({...x.ctx,idempotencyKey:'native'},'approval_a','reject',body)).rejects.toThrow('FORBIDDEN');
  s.storage.sql.exec("INSERT INTO sessions(id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,revoked_at,auth_epoch) VALUES('unassigned_session','ws_example','human_reviewer_2','unassigned_digest','unassigned_csrf','https://identity.example.invalid','synthetic-reviewer-2',?,?,NULL,1)",x.now,x.now+1000000);
  const identity={kind:'human' as const,workspaceId:'ws_example',issuer:'https://identity.example.invalid',subject:'synthetic-reviewer-2',sessionId:'unassigned_session'};
  await expect(a.prepareApprovalDecision({...x.humanContext,identity,idempotencyKey:'unassigned'},'approval_a','reject',body)).rejects.toThrow('FORBIDDEN');expect(snapshot(s.storage)).toEqual(before);
 });
});
