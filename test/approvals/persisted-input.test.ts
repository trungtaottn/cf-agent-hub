import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {decisionFixture,descriptor} from '../helpers/decision-policy';
import {setup} from '../helpers/persisted-decision';
import {human} from '../helpers/settings';
import {createDecisionCommands} from '../../src/approvals/commands-source';
import {executeCommand} from '../../src/workspace/commands';
import {PROOF_A} from '../helpers/claims';
import {withTransaction} from '../../src/storage/transaction';
import {createPersistedInputVerifier} from '../../src/approvals/persisted-input-source';
import {admitted} from '../helpers/persisted-decision';
it('persisted verifier uses actual human session without borrowing requester native scopes',async()=>{
 const f=await decisionFixture('persisted_human');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),v=createPersistedInputVerifier([descriptor]);
  const evidence=await v.verifyPersistedDecisionInput(x.humanContext,'approval_a','human');
  const checked=withTransaction(s.storage,tx=>v.recheckPersistedDecisionInput(tx,x.humanContext,'approval_a',evidence));
  expect(checked.approval.id).toBe('approval_a');expect(checked.actor.kind).toBe('human');expect(checked.binding.taskVersion).toBe(3);expect(checked.task.task_version).toBe(4);
  expect(s.storage.sql.exec('SELECT status FROM runs').one()).toEqual({status:'paused'});
  for(const fake of [{},structuredClone(evidence)])expect(()=>withTransaction(s.storage,tx=>v.recheckPersistedDecisionInput(tx,x.humanContext,'approval_a',fake))).toThrow('DECISION_UNAVAILABLE');
  const other=createPersistedInputVerifier([descriptor]);expect(()=>withTransaction(s.storage,tx=>other.recheckPersistedDecisionInput(tx,x.humanContext,'approval_a',evidence))).toThrow('DECISION_UNAVAILABLE');
 });
});
it('persisted human receipt rechecks current session, original deadline, and semantic anchor',async()=>{
 const f=await decisionFixture('persisted_current');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),v=createPersistedInputVerifier([descriptor]);
  const evidence=await v.verifyPersistedDecisionInput(x.humanContext,'approval_a','human');
  const check=()=>withTransaction(s.storage,tx=>v.recheckPersistedDecisionInput(tx,x.humanContext,'approval_a',evidence));
  s.storage.sql.exec("UPDATE tasks SET title='changed' WHERE id='task_a'");expect(check).toThrow('DECISION_UNAVAILABLE');
  s.storage.sql.exec("UPDATE sessions SET revoked_at=? WHERE id='session_settings'",x.now);await expect(v.verifyPersistedDecisionInput(x.humanContext,'approval_a','human')).rejects.toThrow('DECISION_UNAVAILABLE');
 });
});
it('persisted verifier rejects native actor in human lane and the production empty registry',async()=>{
 const f=await decisionFixture('persisted_lane');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),v=createPersistedInputVerifier([descriptor]);
  await expect(v.verifyPersistedDecisionInput(x.ctx,'approval_a','human')).rejects.toThrow('DECISION_UNAVAILABLE');
  await expect(createPersistedInputVerifier([]).verifyPersistedDecisionInput(x.humanContext,'approval_a','human')).rejects.toThrow('DECISION_UNAVAILABLE');
 });
});
import {wrapBucket} from '../helpers/artifacts';
it('persisted exact-byte verification closes generation, grant and deadline races across R2 await',async()=>{
 for(const race of ['deadline','reviewer','generation','session'] as const){
  const f=await decisionFixture('persisted_race_'+race);await runInDurableObject(f.stub,async(_o,s)=>{
   const x=await admitted(s.storage,f.name),v=createPersistedInputVerifier([descriptor]);let now=x.now;
   const bucket=x.ctx.bucket!,ctx={...x.humanContext,workspace:{...x.ctx.workspace,clock:{nowMs:()=>now}},bucket:wrapBucket(bucket,{get:async(...args:Parameters<R2Bucket['get']>)=>{
    const object=await bucket.get(...args);
    if(race==='deadline')now=x.now+120000;
    if(race==='reviewer')s.storage.sql.exec("UPDATE human_grants SET enabled=0 WHERE principal_id='human_reviewer'");
    if(race==='generation')s.storage.sql.exec("UPDATE artifacts SET artifact_version=artifact_version+1 WHERE id='input_a'");
    if(race==='session')s.storage.sql.exec("UPDATE sessions SET revoked_at=? WHERE id='session_settings'",now);
    return object;
   }})};
   await expect(v.verifyPersistedDecisionInput(ctx,'approval_a','human')).rejects.toThrow('DECISION_UNAVAILABLE');
   expect(s.storage.sql.exec('SELECT status,approval_version FROM approvals').one()).toEqual({status:'pending',approval_version:1});
  });
 }
});
it('persisted receipt membership is checked before fake getters and live storage context is mandatory',async()=>{
 const f=await decisionFixture('persisted_fake');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),v=createPersistedInputVerifier([descriptor]);const evidence=await v.verifyPersistedDecisionInput(x.humanContext,'approval_a','human');
  let touches=0;const fake=new Proxy({}, {get(){touches++;throw Error('getter');}});
  expect(()=>withTransaction(s.storage,tx=>v.recheckPersistedDecisionInput(tx,x.humanContext,'approval_a',fake))).toThrow('DECISION_UNAVAILABLE');expect(touches).toBe(0);
  expect(()=>v.recheckPersistedDecisionInput({all:()=>[],one:()=>null,exec:()=>{}},x.humanContext,'approval_a',evidence)).toThrow('DECISION_UNAVAILABLE');
  const otherStorage=new Proxy(s.storage,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  expect(()=>withTransaction(otherStorage,tx=>v.recheckPersistedDecisionInput(tx,x.humanContext,'approval_a',evidence))).toThrow('DECISION_UNAVAILABLE');
  let escaped!:import('../../src/storage/transaction').WorkspaceTransaction;withTransaction(s.storage,tx=>{escaped=tx;});
  expect(()=>v.recheckPersistedDecisionInput(escaped,x.humanContext,'approval_a',evidence)).toThrow('DECISION_UNAVAILABLE');
  expect(()=>withTransaction(s.storage,tx=>v.recheckPersistedDecisionInput(tx,{...x.humanContext,workspace:{...x.humanContext.workspace}},'approval_a',evidence))).toThrow('DECISION_UNAVAILABLE');
 });
});
it('persisted verifier rejects corrupted paused request run rather than treating a head alone as provenance',async()=>{
 const f=await decisionFixture('persisted_run_tuple');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),v=createPersistedInputVerifier([descriptor]);
  s.storage.sql.exec("UPDATE runs SET status='failed' WHERE id='run_initial'");
  await expect(v.verifyPersistedDecisionInput(x.humanContext,'approval_a','human')).rejects.toThrow('DECISION_UNAVAILABLE');
 });
});
it('persisted verifier rejects unmaterialized later transitions rather than replaying an old head',async()=>{
 const f=await decisionFixture('persisted_extra_transition');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await admitted(s.storage,f.name),v=createPersistedInputVerifier([descriptor]);
  s.storage.sql.exec("INSERT INTO decision_lifecycle_transitions(id,workspace_id,approval_id,task_id,sequence,kind,before_version,after_version,before_state,after_state,run_id,created_at) VALUES('orphan_transition','ws_example','approval_a','task_a',2,'approve',4,5,'waiting','ready',NULL,?)",x.now);
  await expect(v.verifyPersistedDecisionInput(x.humanContext,'approval_a','human')).rejects.toThrow('DECISION_UNAVAILABLE');
 });
});
