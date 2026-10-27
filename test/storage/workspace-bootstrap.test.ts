import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FixedClock } from '../helpers/clock';
import { env, exports } from 'cloudflare:workers';
import { runInDurableObject, evictDurableObject } from 'cloudflare:test';
import { withTransaction } from '../../src/storage/transaction';
import { migrate, FOUNDATION_SQL } from '../../src/storage/migrations';
import { prepareBootstrap, sha256, canonicalJson, installConfiguration } from '../../src/config/bootstrap';
import { prepared, fixture, operator, nowMs } from '../helpers/environment';
// Date-only control reaches systemClock in the same Workers isolate; timers and RPC stay real.
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new FixedClock().nowMs());});
afterEach(()=>{vi.useRealTimers();});
const stub=(name:string)=>env.WORKSPACE.getByName(name);
async function denied(name:string,context:Parameters<import('../../src/workspace/workspace-do').WorkspaceDO['reconcileConfiguration']>[0],input:Awaited<ReturnType<typeof prepared>>) {
 return runInDurableObject(stub(name),async object=>{try {await object.reconcileConfiguration(context,input);return 'unexpected success';}catch(error){return (error as Error).message;}});
}
async function snapshot(name:string) {
 return runInDurableObject(stub(name),(_o,state)=>({
  metadata:state.storage.sql.exec('SELECT * FROM workspace_metadata').toArray(),
  grants:state.storage.sql.exec('SELECT * FROM human_grants ORDER BY principal_id').toArray(),
  credentials:state.storage.sql.exec('SELECT * FROM native_credentials ORDER BY credential_id').toArray(),
  migrations:state.storage.sql.exec('SELECT * FROM schema_migrations').toArray(),
  events:state.storage.sql.exec('SELECT * FROM events ORDER BY sequence').toArray(),
  receipts:state.storage.sql.exec('SELECT * FROM idempotency_outcomes ORDER BY key').toArray()
 }));
}
describe('actual workerd SQLite authority',()=>{
 it('transaction_rolls_back_all_rows',async()=>{
  await runInDurableObject(stub('rollback'),(_o,state)=>{
   expect(()=>withTransaction(state.storage,tx=>{
    tx.exec("INSERT INTO threads (id,workspace_id,created_at,subject) VALUES ('thread_1','ws_example',1,'subject')");
    tx.exec("INSERT INTO scheduler_state (id,next_due_at) VALUES (1,99)");
    throw Error('fault_after_rows');
   })).toThrow('fault_after_rows');
   expect(state.storage.sql.exec('SELECT * FROM threads').toArray()).toEqual([]);
   expect(state.storage.sql.exec('SELECT * FROM scheduler_state').toArray()).toEqual([]);
  });
 });
 it('rejects_promise_and_rolls_back',async()=>{
  await runInDurableObject(stub('promise'),(_o,state)=>{
   expect(()=>withTransaction(state.storage,tx=>{tx.exec('INSERT INTO scheduler_state (id,next_due_at) VALUES (1,99)');return Promise.resolve(1);})).toThrow('ASYNC_TRANSACTION');
   expect(state.storage.sql.exec('SELECT * FROM scheduler_state').toArray()).toEqual([]);
  });
 });
 it('migration_failure_rolls_back_schema_and_version',async()=>{
  await runInDurableObject(stub('failed-migration'),(_o,state)=>{
   state.storage.sql.exec('DROP TABLE schema_migrations');
   expect(()=>migrate(state.storage, [{version:1,sql:'CREATE TABLE rollback_probe (id INTEGER); INSERT INTO nonexistent_table VALUES (1);'}])).toThrow();
   expect(state.storage.sql.exec("SELECT name FROM sqlite_master WHERE name IN ('rollback_probe','schema_migrations')").toArray()).toEqual([]);
   expect(state.storage.sql.exec('SELECT * FROM human_grants').toArray()).toEqual([]);
  });
 });
 it('config_epoch_cannot_go_back',async()=>{
  const name='epoch';await stub(name).reconcileConfiguration(operator(),await prepared(name,2));
  const before=await snapshot(name);
  expect(await denied(name,operator(2,before.metadata[0].installation_digest as string),await prepared(name,1))).toContain('STALE_EPOCH');
  expect(await snapshot(name)).toEqual(before);
 });
 it('same_epoch_different_digest_conflicts',async()=>{
  const name='config-conflict',input=await prepared(name);await stub(name).reconcileConfiguration(operator(),input);
  const next=await fixture(name);next.config.static_participants[0].display_name='Changed';next.bundle.config_digest=await sha256(canonicalJson(next.config));
  const before=await snapshot(name);
  expect(await denied(name,operator(1,input.installationDigest),await prepareBootstrap(next.config,next.bundle,'ws_example'))).toContain('EPOCH_CONFLICT');
  expect(await snapshot(name)).toEqual(before);
 });
 it('same_epoch_changed_hash_bundle_conflicts',async()=>{
  const name='hash-conflict',input=await prepared(name);await stub(name).reconcileConfiguration(operator(),input);
  const next=await fixture(name);next.bundle.credentials[0].token_sha256='2'.repeat(64);
  expect(await denied(name,operator(1,input.installationDigest),await prepareBootstrap(next.config,next.bundle,'ws_example'))).toContain('EPOCH_CONFLICT');
 });
 it('higher_epoch_existing_credential_hash_change_denied',async()=>{
  const name='immutable-hash',input=await prepared(name);await stub(name).reconcileConfiguration(operator(),input);
  const next=await fixture(name,2);next.bundle.credentials[0].token_sha256='2'.repeat(64);const before=await snapshot(name);
  expect(await denied(name,operator(1,input.installationDigest),await prepareBootstrap(next.config,next.bundle,'ws_example'))).toContain('CREDENTIAL_IMMUTABLE');
  expect(await snapshot(name)).toEqual(before);
 });
 it('migration_restart_no_duplicate_schema',async()=>{
  const name='restart',input=await prepared(name),receipt=await stub(name).reconcileConfiguration(operator(),input);
  const before=await snapshot(name);expect(before.migrations).toHaveLength(11);expect(before.grants).toHaveLength(1);
  await evictDurableObject(stub(name));
  expect(await stub(name).reconcileConfiguration(operator(1,input.installationDigest),input)).toEqual(receipt);
  expect(await snapshot(name)).toEqual(before);
 });
 it('wrong_workspace_and_stale_CAS_do_not_write',async()=>{
  const name='cas',input=await prepared(name);
  expect(await denied(name,{...operator(),workspaceId:'ws_foreign'},input)).toContain('WORKSPACE_IDENTITY_MISMATCH');
  expect((await snapshot(name)).metadata).toEqual([]);
  expect(await denied(name,operator(9,'f'.repeat(64)),input)).toContain('CAS_CONFLICT');
  expect((await snapshot(name)).metadata).toEqual([]);
 });
 it('public_ingress_cannot_select_install_or_operator_context',async()=>{
  for(const path of ['/reconcileConfiguration','/internal/install','/v2/workspaces/ws_example/operator/install']) {
   const response=await exports.default.fetch(new Request('https://hub.example.invalid'+path,{method:'POST',headers:{'content-type':'application/json','x-operator':'synthetic_operator'},body:JSON.stringify({context:operator(),input:await prepared('public-denied')})}));
   expect(response.status).toBe(404);
  }
  expect((await snapshot('public-denied')).metadata).toEqual([]);
 });
});

describe('transaction and authority hardening',()=>{
 it('direct_install_rejects_orphan_retired_participant_without_authority_or_events',async()=>{
  const name='orphan-direct',input=await prepared(name,3);
  input.bundle.retired_credentials=[{workspace_id:'ws_example',credential_id:'retired_missing',agent_id:'missing_agent',token_sha256:'3'.repeat(64),retired_at_epoch:2}];
  const before=await snapshot(name);
  expect(before.metadata.length+before.credentials.length+before.events.length+before.receipts.length).toBe(0);
  await runInDurableObject(stub(name),(_object,state)=>{
   expect(()=>withTransaction(state.storage,tx=>installConfiguration(tx,input.config,input,nowMs))).toThrow('INVALID_RETIREMENT');
  });
  expect(await snapshot(name)).toEqual(before);
 });
 it('stored_tombstone_prevents_dropping_participant_even_if_bundle_omits_history',async()=>{
  const name='stored-retired-reference',raw=await fixture(name,2),credential=raw.bundle.credentials.pop()!;
  raw.config.static_credential_refs=[];
  raw.bundle.retired_credentials=[{...credential,agent_id:'agent_research',retired_at_epoch:2}];
  raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
  const retired=await prepareBootstrap(raw.config,raw.bundle,'ws_example');
  await stub(name).reconcileConfiguration(operator(),retired);
  const next=structuredClone(raw);next.config.config_epoch=3;next.bundle.config_epoch=3;
  next.config.static_participants=[];next.config.workspace_policies[0].notification_destinations=[];next.bundle.retired_credentials=[];
  next.bundle.config_digest=await sha256(canonicalJson(next.config));
  const input=await prepareBootstrap(next.config,next.bundle,'ws_example'),before=await snapshot(name);
  expect([before.metadata.length,before.credentials.length,before.events.length,before.receipts.length]).toEqual([1,1,1,0]);
  await runInDurableObject(stub(name),(_object,state)=>{
   expect(()=>withTransaction(state.storage,tx=>installConfiguration(tx,input.config,input,nowMs))).toThrow('INVALID_RETIREMENT');
  });
  expect(await snapshot(name)).toEqual(before);
 });
 it('escaped_transaction_cannot_write_after_commit',async()=>{
  await runInDurableObject(stub('escape'),(_object,state)=>{
   let escaped:import('../../src/storage/transaction').WorkspaceTransaction|undefined;
   withTransaction(state.storage,tx=>{escaped=tx;});
   expect(()=>escaped!.exec('INSERT INTO scheduler_state (id,next_due_at) VALUES (1,999)')).toThrow('TRANSACTION_CLOSED');
   expect(state.storage.sql.exec('SELECT * FROM scheduler_state').toArray()).toEqual([]);
  });
 });
 it('failed_bootstrap_rolls_back_every_authority_and_event_row',async()=>{
  const input=await prepared('failed-bootstrap');
  await runInDurableObject(stub('failed-bootstrap'),(_object,state)=>{
   expect(()=>withTransaction(state.storage,tx=>{
    installConfiguration(tx,input.config,input,nowMs);
    tx.exec("INSERT INTO events (id,workspace_id,type,actor_json,resource_type,resource_id,resource_version,request_id,occurred_at,summary) VALUES ('event_probe','ws_example','configuration.installed','{}','configuration','ws_example',1,'req_probe',1,'probe')");
    throw Error('FAULT_AFTER_INSTALL');
   })).toThrow('FAULT_AFTER_INSTALL');
   for(const table of ['workspace_metadata','human_grants','static_agents','native_credentials','events'])expect(state.storage.sql.exec('SELECT * FROM '+table).toArray()).toEqual([]);
  });
 });
 it('all_required_tables_and_ordering_indexes_exist',async()=>{
  await runInDurableObject(stub('schema-complete'),(_object,state)=>{
   const tables=state.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").toArray().map(x=>x.name).sort();
   expect(tables).toEqual(['schema_migrations','workspace_metadata','human_grants','static_agents','native_credentials','login_attempts','sessions','profiles','preferences','threads','thread_participants','messages','inbox','events','idempotency_outcomes','outbox','scheduler_state','maintenance_state','recovery_jobs','recovery_chunks','probe_receipts','runtimes','tasks','runs','task_results','task_acceptances','task_history','artifacts','artifact_generations','result_artifacts','artifact_associations','message_artifacts','catalog_plans','import_plans','import_mappings'].sort());
   for(const [index,columns]of Object.entries({threads_created:['created_at','id'],inbox_recipient_order:['recipient_agent_id','acknowledged_at','created_at','message_id'],events_sequence:['sequence'],outbox_due:['status','next_due_at'],login_attempts_expiry:['expires_at']}))
    expect(state.storage.sql.exec<{name:string}>('PRAGMA index_info('+index+')').toArray().map(x=>x.name)).toEqual(columns);
  });
 });
 it('retired_credentials_cannot_resurrect_or_change_hash',async()=>{
  const name='retirement',input=await prepared(name);await stub(name).reconcileConfiguration(operator(),input);
  const next=await fixture(name,2),credential=next.bundle.credentials.pop()!;next.config.static_credential_refs=[];
  next.bundle.retired_credentials=[{...credential,agent_id:'agent_research',retired_at_epoch:2}];
  next.bundle.config_digest=await sha256(canonicalJson(next.config));
  const retired=await prepareBootstrap(next.config,next.bundle,'ws_example');await stub(name).reconcileConfiguration(operator(1,input.installationDigest),retired);
  const before=await snapshot(name);
  expect(before.credentials[0].enabled).toBe(0);expect(before.credentials[0].retired_at_epoch).toBe(2);
  expect(await denied(name,operator(2,retired.installationDigest),await prepared(name,3))).toContain('CREDENTIAL_IMMUTABLE');
  const omitted=structuredClone(next);omitted.config.config_epoch=3;omitted.bundle.config_epoch=3;omitted.bundle.retired_credentials=[];
  omitted.bundle.config_digest=await sha256(canonicalJson(omitted.config));
  expect(await denied(name,operator(2,retired.installationDigest),await prepareBootstrap(omitted.config,omitted.bundle,'ws_example'))).toContain('RETIREMENT_REQUIRED');
  expect(await snapshot(name)).toEqual(before);
 });
 it('removal_requires_explicit_retirement_and_changed_binding_is_denied',async()=>{
  const name='retirement-required',input=await prepared(name);await stub(name).reconcileConfiguration(operator(),input);
  const next=await fixture(name,2);next.bundle.credentials=[];next.config.static_credential_refs=[];next.bundle.config_digest=await sha256(canonicalJson(next.config));
  expect(await denied(name,operator(1,input.installationDigest),await prepareBootstrap(next.config,next.bundle,'ws_example'))).toContain('RETIREMENT_REQUIRED');
  const wrong=await prepared('wrong-object',2);expect(await denied(name,operator(1,input.installationDigest),wrong)).toContain('WORKSPACE_IDENTITY_MISMATCH');
 });
 it('commands_recheck_installed_identity_and_empty_authority_is_closed',async()=>{
  const name='command-identity';
  expect(await stub(name).command({workspaceId:'ws_example',objectName:name,requestId:'req_empty',operation:'read'})).toEqual({status:503,code:'NOT_INSTALLED'});
  await stub(name).reconcileConfiguration(operator(),await prepared(name));
  await runInDurableObject(stub(name),async object=>{
   await expect(object.command({workspaceId:'ws_foreign',objectName:name,requestId:'req_wrong',operation:'read'})).rejects.toThrow('WORKSPACE_IDENTITY_MISMATCH');
  });
  expect(await stub(name).command({workspaceId:'ws_example',objectName:name,requestId:'req_closed',operation:'read'})).toEqual({status:403,code:'AUTHENTICATION_REQUIRED'});
 });
 it('forged_digest_or_extra_operator_fields_fail_without_domain_writes',async()=>{
  const name='forgery',input=await prepared(name);
  expect(await denied(name,operator(),{...input,installationDigest:'0'.repeat(64)})).toContain('INSTALLATION_DIGEST_MISMATCH');
  expect(await denied(name,{...operator(),unreviewed:true} as ReturnType<typeof operator>,input)).toContain('INVALID_OPERATOR_CONTEXT');
  expect((await snapshot(name)).metadata).toEqual([]);
 });
 it('new_credential_expiry_is_bounded_at_install_time',async()=>{
  const name='expiry',input=await fixture(name);
  input.config.static_credential_refs[0].expires_at=new Date(nowMs+91*86400000).toISOString();
  input.bundle.config_digest=await sha256(canonicalJson(input.config));
  const validated=await prepareBootstrap(input.config,input.bundle,'ws_example');
  await runInDurableObject(stub(name),(_object,state)=>{
   expect(()=>withTransaction(state.storage,tx=>installConfiguration(tx,validated.config,validated,nowMs))).toThrow('CREDENTIAL_EXPIRY');
   expect(state.storage.sql.exec('SELECT * FROM workspace_metadata').toArray()).toEqual([]);
  });
 });
});

describe('controlled reconciliation clock',()=>{
 it('future_calendar_binding_install_reaches_epoch_invariant',async()=>{
  const clock=new FixedClock(Date.parse('2035-06-01T00:00:00Z'));vi.setSystemTime(clock.nowMs());
  const name='future-calendar',input=await prepared(name,2,clock);
  const receipt=await stub(name).reconcileConfiguration(operator(),input);
  expect(receipt.epoch).toBe(2);
  const before=await snapshot(name);
  expect(await runInDurableObject(stub(name),(_object,state)=>state.storage.sql.exec<{occurred_at:number}>('SELECT occurred_at FROM events').one().occurred_at)).toBe(clock.nowMs());
  expect(Date.parse(input.config.static_credential_refs[0].expires_at)).toBe(clock.nowMs()+30*86400000);
  expect(await denied(name,operator(2,receipt.installationDigest),await prepared(name,1,clock))).toBe('STALE_EPOCH');
  expect(await snapshot(name)).toEqual(before);
 });
 it('controlled_clock_rejects_new_credentials_at_expiry',async()=>{
  const clock=new FixedClock(Date.parse('2035-06-01T00:00:00Z'));vi.setSystemTime(clock.nowMs());
  const name='future-expired',input=await prepared(name,1,clock);
  const before=await snapshot(name);expect(before.metadata).toEqual([]);expect(before.credentials).toEqual([]);
  clock.value=Date.parse(input.config.static_credential_refs[0].expires_at);vi.setSystemTime(clock.nowMs());
  expect(await denied(name,operator(),input)).toBe('CREDENTIAL_EXPIRY');
  expect(await snapshot(name)).toEqual(before);
  expect(await runInDurableObject(stub(name),(_object,state)=>state.storage.sql.exec('SELECT * FROM events').toArray())).toEqual([]);
 });
});
