import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {migrate} from '../../src/storage/migrations';
import {CURRENT_SCHEMA_VERSION,assertCurrentSchema} from '../../src/storage/schema-version';
import {withTransaction} from '../../src/storage/transaction';
import m1 from '../../src/storage/migrations/0001-foundation.sql';
import m2 from '../../src/storage/migrations/0002-session-auth-epoch.sql';
import m3 from '../../src/storage/migrations/0003-preference-owner.sql';
import m4 from '../../src/storage/migrations/0004-message-admission.sql';
import m5 from '../../src/storage/migrations/0005-cursor-retention.sql';
import m6 from '../../src/storage/migrations/0006-outbox-scheduler-diagnostics.sql';
import m7 from '../../src/storage/migrations/0007-maintenance-generation.sql';
import m8 from '../../src/storage/migrations/0008-durable-work.sql';
import m9 from '../../src/storage/migrations/0009-catalog-reference-indexes.sql';
import m10 from '../../src/storage/migrations/0010-outbox-due-indexes.sql';
import m11 from '../../src/storage/migrations/0011-task-history-reason.sql';
import m12 from '../../src/storage/migrations/0012-artifact-admission.sql';
import m13 from '../../src/storage/migrations/0013-artifact-cleanup.sql';
import m14 from '../../src/storage/migrations/0014-message-credential-seek.sql';
import m15 from '../../src/storage/migrations/0015-search-order.sql';
import m16 from '../../src/storage/migrations/0016-task-auth-return.sql';
const priorMigrations=[m1,m2,m3,m4,m5,m6,m7,m8,m9,m10,m11,m12,m13,m14,m15].map((sql,index)=>({version:index+1,sql}));
const oldPaths=['/','/overview','/inbox','/activity','/settings'];
function insert(s:DurableObjectStorage,id:string,path:string,epoch:number=1):void{
 s.sql.exec('INSERT INTO login_attempts(id,workspace_id,state_digest,nonce,pkce_verifier,cookie_digest,redirect_uri,created_at,expires_at,auth_epoch,return_path) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,'ws_example','synthetic_state_'+id,'synthetic_nonce','synthetic_verifier','synthetic_cookie','https://hub.example.invalid/v2/workspaces/ws_example/auth/callback',100,200,epoch,path);
}
const attempts=(s:DurableObjectStorage)=>s.sql.exec('SELECT rowid AS retained_rowid,* FROM login_attempts ORDER BY rowid').toArray();
const history=(s:DurableObjectStorage)=>s.sql.exec('SELECT * FROM schema_migrations ORDER BY version').toArray();
const schema=(s:DurableObjectStorage)=>s.sql.exec('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').toArray();
function metadata(s:DurableObjectStorage){
 const indexes=s.sql.exec<{name:string;unique:number;origin:string;partial:number}>('PRAGMA index_list(login_attempts)').toArray().sort((a,b)=>a.name.localeCompare(b.name));
 return {columns:s.sql.exec('PRAGMA table_info(login_attempts)').toArray(),foreign:s.sql.exec('PRAGMA foreign_key_list(login_attempts)').toArray(),indexes:indexes.map(({name,unique,origin,partial})=>({name,unique,origin,partial,columns:s.sql.exec('PRAGMA index_info("'+name+'")').toArray()}))};
}
function snapshot(s:DurableObjectStorage){return {attempts:attempts(s),history:history(s),schema:schema(s),metadata:metadata(s)};}
async function genuine15(name:string){
 const stub=env.WORKSPACE.getByName('task_auth_return_'+name);
 await runInDurableObject(stub,async(_object,state)=>{
  await state.storage.deleteAll();migrate(state.storage,priorMigrations);
  expect(state.storage.sql.exec('SELECT MAX(version) AS version FROM schema_migrations').one().version).toBe(15);
  for(const [index,path]of oldPaths.entries())for(const consumed of [false,true]){
   const id='old_'+index+'_'+Number(consumed);insert(state.storage,id,path,index===0?0:index===4?9007199254740991:1);
   state.storage.sql.exec('UPDATE login_attempts SET rowid=?,consumed_at=?,nonce=?,pkce_verifier=? WHERE id=?',-100+(index*2+Number(consumed))*7,consumed?150:null,consumed?'':'synthetic_nonce_'+id,consumed?'':'synthetic_verifier_'+id,id);
  }
  // Preserve defaults and actual legacy nullable TEXT-PK semantics; this is not
  // permission to issue a real login with an invalid application identity.
  state.storage.sql.exec("INSERT INTO login_attempts(rowid,id,workspace_id,state_digest,nonce,pkce_verifier,cookie_digest,redirect_uri,created_at,expires_at) VALUES(99,NULL,'ws_example','synthetic_nullable_id','n','p','c','https://hub.example.invalid/callback',1,2)");
  state.storage.sql.exec("INSERT INTO sessions(id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,auth_epoch) VALUES('synthetic_retained_session','ws_example','synthetic_human','synthetic_digest','synthetic_csrf','https://identity.example.invalid','synthetic_subject',100,200,1)");
 });return stub;
}
it('schema16 upgrades genuine15 without rewriting any retained attempt, index, default or prior migration row, then restarts',async()=>{
 const stub=await genuine15('preservation');
 const after=await runInDurableObject(stub,(_object,{storage})=>{
  const before=snapshot(storage),sessions=storage.sql.exec('SELECT rowid,* FROM sessions').toArray();
  expect(()=>insert(storage,'pre16_tasks','/tasks')).toThrow();
  migrate(storage);expect(CURRENT_SCHEMA_VERSION).toBe(16);expect(()=>withTransaction(storage,assertCurrentSchema)).not.toThrow();
  expect(attempts(storage)).toEqual(before.attempts);expect(history(storage).slice(0,15)).toEqual(before.history);expect(history(storage).map(row=>row.version)).toEqual(Array.from({length:16},(_,i)=>i+1));
  expect(metadata(storage)).toEqual(before.metadata);expect(schema(storage).filter(row=>row.tbl_name!=='login_attempts')).toEqual(before.schema.filter(row=>row.tbl_name!=='login_attempts'));
  expect(storage.sql.exec('SELECT rowid,* FROM sessions').toArray()).toEqual(sessions);expect(storage.sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
  insert(storage,'exact_tasks','/tasks');expect(storage.sql.exec("SELECT return_path FROM login_attempts WHERE id='exact_tasks'").one().return_path).toBe('/tasks');
  const current=snapshot(storage);migrate(storage);expect(snapshot(storage)).toEqual(current);return current;
 });
 await evictDurableObject(stub);await runInDurableObject(stub,(_object,{storage})=>expect(snapshot(storage)).toEqual(after));
});
it('schema16 fresh schema accepts only exact old paths and exact tasks path',async()=>{
 await runInDurableObject(env.WORKSPACE.getByName('task_auth_return_fresh'),(_object,{storage})=>{
  expect(CURRENT_SCHEMA_VERSION).toBe(16);for(const [i,path]of [...oldPaths,'/tasks'].entries())insert(storage,'allowed_'+i,path);
  const before=attempts(storage);
  for(const [i,path]of ['https://outside.example.invalid/tasks','//outside.example.invalid/tasks','/tasks?workspace=ws_example','/tasks#item','/tasks/','/%74asks','/ta%73ks','%2Ftasks','/tasks%3Fx=1','\\tasks','/\\tasks','/Tasks','/kanban','/tasks\u0000'].entries())expect(()=>insert(storage,'denied_'+i,path)).toThrow();
  expect(attempts(storage)).toEqual(before);
 });
});
it.each(['capturing','captured','restoring','restored','retired'])('schema16 refuses frozen schema15 %s without rewriting original rows or history',async state=>{
 const stub=await genuine15('frozen_'+state);await runInDurableObject(stub,(_object,{storage})=>{
  storage.sql.exec('INSERT INTO maintenance_state(id,state,authority_epoch,updated_at,generation) VALUES(1,?,0,1,4)',state);
  const before=snapshot(storage);expect(()=>migrate(storage)).toThrow('FROZEN_SCHEMA_MIGRATION');expect(snapshot(storage)).toEqual(before);
 });
});

it('schema16 retains legacy constraint semantics, nullable text primary key and defaults',async()=>{
 const stub=await genuine15('constraints');await runInDurableObject(stub,(_object,{storage})=>{
  migrate(storage);insert(storage,'valid','/tasks',0);insert(storage,'max_epoch','/',9007199254740991);
  // INTEGER affinity was not an integer-only check in migration2. Do not silently harden it.
  insert(storage,'legacy_fraction','/',0.5);
  storage.sql.exec("INSERT INTO login_attempts(id,workspace_id,state_digest,nonce,pkce_verifier,cookie_digest,redirect_uri,created_at,expires_at) VALUES(NULL,'ws_example','synthetic_second_null','n','p','c','https://hub.example.invalid/callback',1,2)");
  expect(storage.sql.exec("SELECT auth_epoch,return_path FROM login_attempts WHERE state_digest='synthetic_second_null'").one()).toEqual({auth_epoch:0,return_path:'/'});
  const before=attempts(storage);
  for(const epoch of [-1,9007199254740992])expect(()=>insert(storage,'invalid_epoch_'+epoch,'/',epoch)).toThrow();
  expect(()=>insert(storage,'valid','/')).toThrow();
  expect(()=>storage.sql.exec("UPDATE login_attempts SET state_digest='synthetic_state_valid' WHERE id='max_epoch'")).toThrow();
  for(const column of ['workspace_id','state_digest','nonce','pkce_verifier','cookie_digest','redirect_uri','created_at','expires_at','auth_epoch','return_path'])expect(()=>storage.sql.exec('UPDATE login_attempts SET '+column+"=NULL WHERE id='valid'")).toThrow();
  for(const expiry of [99,100])expect(()=>storage.sql.exec("UPDATE login_attempts SET expires_at=? WHERE id='valid'",expiry)).toThrow();
  expect(attempts(storage)).toEqual(before);
 });
});
it('schema16 rolls back rebuilt table and migration history after SQL or bookkeeping failure',async()=>{
 const stub=await genuine15('rollback');await runInDurableObject(stub,(_object,{storage})=>{
  const before=snapshot(storage);
  expect(()=>migrate(storage,[...priorMigrations,{version:16,sql:m16+' INSERT INTO missing_task_auth_return_fault VALUES(1);'}])).toThrow();
  expect(snapshot(storage)).toEqual(before);
  expect(storage.sql.exec("SELECT name FROM sqlite_schema WHERE name='login_attempts_with_tasks'").toArray()).toEqual([]);
  storage.sql.exec("CREATE TRIGGER reject_task_auth_version BEFORE INSERT ON schema_migrations WHEN NEW.version=16 BEGIN SELECT RAISE(ABORT,'synthetic_migration16_failure'); END");
  const withTrigger=snapshot(storage);expect(()=>migrate(storage)).toThrow('synthetic_migration16_failure');expect(snapshot(storage)).toEqual(withTrigger);
  storage.sql.exec('DROP TRIGGER reject_task_auth_version');expect(snapshot(storage)).toEqual(before);
  migrate(storage);insert(storage,'after_retry','/tasks');expect(()=>withTransaction(storage,assertCurrentSchema)).not.toThrow();
 });
});
it.each(['maintenance','retired'])('schema16 refuses non-installed workspace admission %s without mutation',async admission=>{
 const stub=await genuine15('admission_'+admission);await runInDurableObject(stub,(_object,{storage})=>{
  storage.sql.exec("INSERT INTO workspace_metadata(id,workspace_id,object_name,config_epoch,config_digest,installation_digest,config_json,bundle_json,installed_at,admission_state) VALUES(1,'ws_example','synthetic_object',1,'synthetic_digest','synthetic_install','{}','{}',1,?)",admission);
  const before=snapshot(storage);expect(()=>migrate(storage)).toThrow('FROZEN_SCHEMA_MIGRATION');expect(snapshot(storage)).toEqual(before);
 });
});
