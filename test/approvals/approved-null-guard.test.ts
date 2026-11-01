import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {decisionFixture,descriptor} from '../helpers/decision-policy';
import {admitted,admittedAdditional} from '../helpers/persisted-decision';
import {createApprovedIntentGuard} from '../../src/approvals/execution-guard-source';
import {withTransaction} from '../../src/storage/transaction';
import {taskRecord} from '../../src/tasks/repository';
it('a stale approval-null task snapshot cannot bypass the final authoritative SQL read',async()=>{
 const f=await decisionFixture('approved_null_stale');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),guard=createApprovedIntentGuard([descriptor]),stale=withTransaction(s.storage,tx=>taskRecord(tx,'ws_example','task_b'));
  const receipt=await guard.verifyApprovedIntent(x.ctx,'task_b');expect(receipt).toBeNull();
  await admittedAdditional(s.storage,f.name,x.now,'b',false);
  expect(()=>withTransaction(s.storage,tx=>guard.assertApprovedIntentCurrent(tx,x.ctx,stale,receipt))).toThrow('DECISION_UNAVAILABLE');
 });
});
it('null intent does not admit a transaction-shaped observation as same-storage evidence',async()=>{
 const f=await decisionFixture('approved_null_tx_shape');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),guard=createApprovedIntentGuard([descriptor]),receipt=await guard.verifyApprovedIntent(x.ctx,'task_b');
  withTransaction(s.storage,tx=>{const task=taskRecord(tx,'ws_example','task_b'),copy={all:tx.all,one:tx.one,exec:tx.exec};expect(()=>guard.assertApprovedIntentCurrent(copy,x.ctx,task,receipt)).toThrow('DECISION_UNAVAILABLE');});
 });
});
