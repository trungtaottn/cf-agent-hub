import { describe, it, expect } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { runInDurableObject, evictDurableObject } from 'cloudflare:test';
import { withTransaction } from '../../src/storage/transaction';
import { migrate, FOUNDATION_SQL } from '../../src/storage/migrations';
import { prepareBootstrap, sha256, canonicalJson } from '../../src/config/bootstrap';
import { prepared, fixture, operator, nowMs } from '../helpers/environment';
const stub=(name:string)=>env.WORKSPACE.getByName(name);
async function denied(name:string,context:Parameters<import('../../src/workspace/workspace-do').WorkspaceDO['reconcileConfiguration']>[0],input:Awaited<ReturnType<typeof prepared>>) {
 return runInDurableObject(stub(name),async object=>{try {await object.reconcileConfiguration(context,input);return 'unexpected success';}catch(error){return (error as Error).message;}});
}
async function snapshot(name:string) {
 return runInDurableObject(stub(name),(_o,state)=>({
  metadata:state.storage.sql.exec('SELECT * FROM workspace_metadata').toArray(),
  grants:state.storage.sql.exec('SELECT * FROM human_grants ORDER BY principal_id').toArray(),
  credentials:state.storage.sql.exec('SELECT * FROM native_credentials ORDER BY credential_id').toArray(),
  migrations:state.storage.sql.exec('SELECT * FROM schema_migrations').toArray()
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
  const before=await snapshot(name);expect(before.migrations).toHaveLength(1);expect(before.grants).toHaveLength(1);
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
