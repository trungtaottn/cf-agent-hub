import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {decisionFixture} from '../helpers/decision-policy';
import {admitted} from '../helpers/persisted-decision';
import {withTransaction} from '../../src/storage/transaction';
import {createDecisionCommands} from '../../src/approvals/commands-source';
import {descriptor} from '../helpers/decision-policy';
import {executeCommand} from '../../src/workspace/commands';
import {fingerprintRequest} from '../../src/workspace/idempotency';
it('shared expiry closes pending and approved unconsumed decisions exactly once without extending authority',async()=>{
 for(const approve of [false,true]){
  const f=await decisionFixture('expiry_state_'+approve);await runInDurableObject(f.stub,async(_o,s)=>{
   const x=await admitted(s.storage,f.name),api=await import('../../src/approvals/expiry');expect(typeof api.expireDueApprovals).toBe('function');
   if(approve){const body={expected_version:4,expected_proposal_version:1,expected_approval_version:1,reason:'approve'},c=await createDecisionCommands([descriptor]).prepareApprovalDecision({...x.humanContext,idempotencyKey:'approve'},'approval_a','approve',body);executeCommand({...x.execution,workspace:x.humanContext.workspace,idempotencyKey:'approve',fingerprint:await fingerprintRequest('POST','/approve',{},body)},x.humanContext.identity,c,body);}
   const decided=s.storage.sql.exec('SELECT decided_at,decided_by_json,decision_reason FROM approvals').one();
   expect(withTransaction(s.storage,tx=>api.expireDueApprovals(tx,x.now+119999,2)).processed).toBe(0);
   expect(withTransaction(s.storage,tx=>api.expireDueApprovals(tx,x.now+120000,2))).toMatchObject({processed:1,held:0,nextDueAt:null});
   expect(s.storage.sql.exec('SELECT status,approval_version,expires_at FROM approvals').one()).toEqual({status:'expired',approval_version:approve?3:2,expires_at:x.now+120000});
   expect(s.storage.sql.exec('SELECT state,task_version,active_run_id FROM tasks WHERE id=\'task_a\'').one()).toEqual({state:'waiting',task_version:approve?6:5,active_run_id:null});
   expect(s.storage.sql.exec('SELECT decided_at,decided_by_json,decision_reason FROM approvals').one()).toEqual(decided);
   expect(s.storage.sql.exec('SELECT status FROM runs').one()).toEqual({status:'paused'});
   expect(withTransaction(s.storage,tx=>api.expireDueApprovals(tx,x.now+120000,2)).processed).toBe(0);
   expect(s.storage.sql.exec("SELECT type FROM events WHERE type='task.decision_expired'").toArray()).toHaveLength(1);
  });
 }
});
import {admittedAdditional} from '../helpers/persisted-decision';
it('poisoned due rows are held without starving valid neighbors, renewing, or spinning next due',async()=>{
 const f=await decisionFixture('expiry_poison');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name);await admittedAdditional(s.storage,f.name,x.now,'c');await admittedAdditional(s.storage,f.name,x.now,'d');
  const api=await import('../../src/approvals/expiry');
  expect(s.storage.sql.exec('SELECT expiry_hold_code FROM approvals ORDER BY id').toArray()).toEqual([{expiry_hold_code:null},{expiry_hold_code:null},{expiry_hold_code:null}]);
  s.storage.sql.exec("UPDATE decision_lifecycle_transitions SET kind='approve' WHERE approval_id='approval_c'");
  expect(withTransaction(s.storage,tx=>api.expireDueApprovals(tx,x.now+120000,2))).toMatchObject({processed:1,held:1,nextDueAt:x.now+120000});
  expect(s.storage.sql.exec("SELECT status,approval_version,expiry_hold_code FROM approvals WHERE id='approval_c'").one()).toEqual({status:'pending',approval_version:1,expiry_hold_code:'DECISION_STATE_INVALID'});
  expect(withTransaction(s.storage,tx=>api.expireDueApprovals(tx,x.now+120000,2))).toEqual({processed:1,held:0,nextDueAt:null});
  expect(withTransaction(s.storage,tx=>api.expireDueApprovals(tx,x.now+120000,2))).toEqual({processed:0,held:0,nextDueAt:null});
  expect(s.storage.sql.exec("SELECT task_version,task_state,transition_count FROM decision_lifecycle_heads WHERE approval_id='approval_c'").one()).toEqual({task_version:4,task_state:'waiting',transition_count:1});
 });
});
it('single existing scheduler uses configured decision batch and re-arms remaining work',async()=>{
 const f=await decisionFixture('expiry_scheduler');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name);await admittedAdditional(s.storage,f.name,x.now,'c');await admittedAdditional(s.storage,f.name,x.now,'d');
  const {OutboxScheduler}=await import('../../src/outbox/scheduler'),{DeliveryDispatcher}=await import('../../src/outbox/dispatcher');let now=x.now,armed:number|null=null;
  const workspace={...x.ctx.workspace,clock:{nowMs:()=>now}},scheduler=new OutboxScheduler(workspace,new DeliveryDispatcher(workspace),{setAlarm:async time=>{armed=time;},deleteAlarm:async()=>{armed=null;}});
  expect((await scheduler.repairSchedule()).nextDueAt).toBe(x.now+120000);expect(armed).toBe(x.now+120000);
  now=x.now+120000;await scheduler.runDueWork(now);
  expect(s.storage.sql.exec("SELECT id FROM approvals WHERE status='expired'").toArray()).toHaveLength(2);expect(armed).toBe(now+1);
  await scheduler.runDueWork(now);expect(s.storage.sql.exec("SELECT id FROM approvals WHERE status='expired'").toArray()).toHaveLength(3);expect(armed).toBeNull();
  expect(s.storage.sql.exec('SELECT dirty FROM scheduler_state').one()).toEqual({dirty:0});
 });
});
it('future-dated lifecycle heads fail closed into a non-authorizing expiry hold',async()=>{
 const f=await decisionFixture('expiry_future_head');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),api=await import('../../src/approvals/expiry');
  s.storage.sql.exec('UPDATE decision_lifecycle_transitions SET created_at=?',x.now+200000);
  expect(withTransaction(s.storage,tx=>api.expireDueApprovals(tx,x.now+120000,1))).toEqual({processed:0,held:1,nextDueAt:null});
  expect(s.storage.sql.exec('SELECT status,approval_version FROM approvals').one()).toEqual({status:'pending',approval_version:1});
 });
});
it('expiry versus cancellation at the same clock preserves one transition per current version',async()=>{
 for(const first of ['expiry','cancel'] as const){
  const f=await decisionFixture('expiry_cancel_'+first,undefined,2,true);await runInDurableObject(f.stub,async(_o,s)=>{
   const x=await admitted(s.storage,f.name),api=await import('../../src/approvals/expiry'),{cancelTaskCommand}=await import('../../src/tasks/commands');
   const now=x.now+120000,workspace={...x.humanContext.workspace,clock:{nowMs:()=>now}};
   if(first==='expiry')expect(withTransaction(s.storage,tx=>api.expireDueApprovals(tx,now,1)).processed).toBe(1);
   const body={expected_version:first==='expiry'?5:4,reason:'Cancel'},ctx={...x.execution,workspace,idempotencyKey:'cancel',fingerprint:await fingerprintRequest('POST','/tasks/task_a/cancel',{},body)};
   executeCommand(ctx,x.humanContext.identity,cancelTaskCommand('task_a'),body);
   expect(withTransaction(s.storage,tx=>api.expireDueApprovals(tx,now,1)).processed).toBe(0);
   expect(s.storage.sql.exec('SELECT status,approval_version FROM approvals').one()).toEqual({status:first==='expiry'?'expired':'invalidated',approval_version:2});
   expect(s.storage.sql.exec('SELECT task_version,transition_count,task_state FROM decision_lifecycle_heads').one()).toEqual({task_version:first==='expiry'?6:5,transition_count:first==='expiry'?3:2,task_state:'cancelled'});
  });
 }
});
it('maintenance closure and finite expiry limits deny without writes',async()=>{
 const f=await decisionFixture('expiry_closed');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),api=await import('../../src/approvals/expiry');
  for(const limit of [0,201,1.5,Number.MAX_SAFE_INTEGER])expect(()=>withTransaction(s.storage,tx=>api.expireDueApprovals(tx,x.now+120000,limit))).toThrow('INVALID_REQUEST');
  s.storage.sql.exec("UPDATE maintenance_state SET state='capturing'");
  expect(()=>withTransaction(s.storage,tx=>api.expireDueApprovals(tx,x.now+120000,1))).toThrow();expect(s.storage.sql.exec('SELECT status,approval_version FROM approvals').one()).toEqual({status:'pending',approval_version:1});
 });
});
it('operational read failures propagate without misclassifying healthy decisions as permanent poison',async()=>{
 const f=await decisionFixture('expiry_read_failure');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),api=await import('../../src/approvals/expiry'),{HttpError}=await import('../../src/http/envelopes');
  const snapshot=()=>Object.fromEntries(['approvals','tasks','decision_lifecycle_heads','decision_lifecycle_transitions','events','task_history','scheduler_state'].map(t=>[t,s.storage.sql.exec('SELECT * FROM '+t+' ORDER BY rowid').toArray()])),before=snapshot();
  for(const failure of [Error('synthetic read outage'),new HttpError('DEPENDENCY_UNAVAILABLE',503),new HttpError('INTERNAL_ERROR',500)]){
   expect(()=>withTransaction(s.storage,tx=>api.expireDueApprovals({...tx,one<T>(sql:string,bindings?:readonly import('../../src/storage/transaction').SqlValue[]):T|null{if(sql.includes('length(CAST(reviewer_ids_json'))throw failure;return tx.one<T>(sql,bindings);}},x.now+120000,1))).toThrow(failure);
   expect(snapshot()).toEqual(before);expect(s.storage.sql.exec('SELECT expiry_hold_code FROM approvals').one()).toEqual({expiry_hold_code:null});
  }
 });
});
