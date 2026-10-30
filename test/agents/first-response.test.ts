import {it,expect} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {settingsFixture,human,commandContext} from '../helpers/settings';
import * as commands from '../../src/workspace/commands';
import {preferencesCommand} from '../../src/config/settings-service';
import {preference} from '../helpers/settings';
it('detailed_first_execution_signal_is_post_commit_and_never_replayed_after_restart',async()=>{
 const {stub,name}=await settingsFixture('identity-first-response');
 const body={expected_preferences_revision:0,preferences:preference};
 await runInDurableObject(stub,async(_o,state)=>{
  const identity=human(state.storage),ctx=await commandContext(state.storage,name,body,'detailed');
  const result=commands.executeCommandDetailed(ctx,identity,preferencesCommand('pref_11111111111111111111111111111111'),body);
  expect(result.firstExecution).toBe(true);expect(result.outcome.status).toBe(200);
  const persisted=state.storage.sql.exec<{outcome_json:string}>('SELECT outcome_json FROM idempotency_outcomes').one();
  expect(persisted.outcome_json).not.toContain('firstExecution');
 });
 await evictDurableObject(stub);
 await runInDurableObject(stub,async(_o,state)=>{
  const identity=human(state.storage),ctx=await commandContext(state.storage,name,body,'detailed');
  const result=commands.executeCommandDetailed(ctx,identity,preferencesCommand('must_not_be_created'),body);
  expect(result.firstExecution).toBe(false);
  expect(state.storage.sql.exec('SELECT record_id FROM preferences').toArray()).toEqual([{record_id:'pref_11111111111111111111111111111111'}]);
  expect(commands.executeCommand(ctx,identity,preferencesCommand('another_unused'),body)).toEqual(result.outcome);
  state.storage.sql.exec("UPDATE human_grants SET enabled=0");
  expect(()=>commands.executeCommandDetailed(ctx,identity,preferencesCommand('unused'),body)).toThrowError(expect.objectContaining({status:401}));
 });
});
it('detailed_command_does_not_report_success_when_outcome_commit_fails',async()=>{
 const {stub,name}=await settingsFixture('identity-first-response-rollback');
 await runInDurableObject(stub,async(_o,state)=>{
  const body={expected_preferences_revision:0,preferences:preference},identity=human(state.storage),ctx=await commandContext(state.storage,name,body,'rollback');
  expect(typeof commands.executeCommandDetailed).toBe("function");
  const events=state.storage.sql.exec('SELECT * FROM events').toArray();
  state.storage.sql.exec("CREATE TRIGGER fail_identity_outcome BEFORE INSERT ON idempotency_outcomes BEGIN SELECT RAISE(ABORT,'synthetic_outcome_abort'); END");
  expect(()=>commands.executeCommandDetailed(ctx,identity,preferencesCommand('pref_22222222222222222222222222222222'),body)).toThrow();
  expect(state.storage.sql.exec('SELECT * FROM preferences').toArray()).toEqual([]);
  expect(state.storage.sql.exec('SELECT * FROM events').toArray()).toEqual(events);
  expect(state.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray()).toEqual([]);
 });
});
