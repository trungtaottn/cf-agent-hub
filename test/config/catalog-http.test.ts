import {it,expect,vi} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {catalogFixture,catalogProfile,catalogSnapshot} from '../helpers/catalog';
import {human,owned} from '../helpers/settings';
import {taskContext,taskInput} from '../helpers/tasks';
import {createTask} from '../../src/tasks/commands';
import {createAgent} from '../../src/agents/commands';
import {sha256} from '../../src/config/bootstrap';
import {csrfToken} from '../../src/auth/csrf';
import {withTransaction} from '../../src/storage/transaction';
import type {SessionRecord} from '../../src/auth/authorize';
import type {CatalogPlan} from '../../src/http/dto';
import entry from '../../src/index';
const token='A'.repeat(43),base='https://hub.example.invalid/v2/workspaces/ws_example/';
const preview={expected_profile_revision:1,kind:'project',id:'project_a',operation:'remap',replacement_id:'project_b',reason:'Synthetic HTTP review'};
async function session(storage:DurableObjectStorage,name:string){
 human(storage);storage.sql.exec('UPDATE sessions SET token_digest=?',await sha256(token));
 const workspace={...owned(storage,name),secrets:env as unknown as Record<string,unknown>};
 const csrf=await csrfToken(workspace,withTransaction(storage,tx=>tx.one<SessionRecord>('SELECT * FROM sessions')!));
 return (path:string,body?:unknown,key='key',method='POST')=>new Request(base+path,{method,headers:{cookie:'cfhub_session='+token,origin:'https://hub.example.invalid','x-csrf-token':csrf,'idempotency-key':key,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
it('actual_worker_DO_catalog_preview_apply_replay_and_foreign_routing_are_closed',async()=>{
 const {stub,name,input}=await catalogFixture('catalog-worker');
 const request=await runInDurableObject(stub,async(_o,state)=>{catalogProfile(state.storage);const ctx=taskContext(state.storage);withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'task_a'},{...taskInput,project_id:'project_a'}));return session(state.storage,name);});
 const seen:string[]=[],bindings={...env,DEPLOYMENT_CONFIG:JSON.stringify(input.config),WORKSPACE:{getByName(id:string){seen.push(id);return stub;}}} as unknown as Env;
 const planned=await entry.fetch(request('catalog:preview',preview,'preview'),bindings);expect(planned.status).toBe(200);expect(planned.headers.get('cache-control')).toBe('no-store');const plan=(await planned.json() as {data:CatalogPlan}).data;expect(plan.affected_task_ids).toEqual(['task_a']);
 const replay=await entry.fetch(request('catalog:preview',preview,'preview'),bindings);expect(replay.status).toBe(200);expect((await replay.json() as {data:CatalogPlan}).data).toEqual(plan);
 const body={preview_id:plan.id,expected_profile_revision:1};const applied=await entry.fetch(request('catalog:apply',body,'apply'),bindings);expect(applied.status).toBe(200);const result=await applied.json() as {data:unknown};
 const repeated=await entry.fetch(request('catalog:apply',body,'apply'),bindings);expect(repeated.status).toBe(200);expect((await repeated.json() as {data:unknown}).data).toEqual(result.data);
 const foreign=request('catalog:preview',preview,'foreign');expect((await entry.fetch(new Request(foreign.url.replace('ws_example','ws_foreign'),foreign),bindings)).status).toBe(401);expect(seen).toEqual([name,name,name,name]);
 expect((await entry.fetch(request('tasks/task_a:claim',{},'claim'),bindings)).status).toBe(404);expect(seen).toHaveLength(4);
 await runInDurableObject(stub,(_o,state)=>{expect(state.storage.sql.exec("SELECT project_id,task_version FROM tasks WHERE id='task_a'").one()).toEqual({project_id:'project_b',task_version:2});expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM catalog_plans').one()).toEqual({n:1});expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM idempotency_outcomes').one()).toEqual({n:2});});
});
it('actual_DO_two_distinct_apply_keys_have_one_winner_and_no_duplicate_commit',async()=>{
 const {stub,name}=await catalogFixture('catalog-http-race');const request=await runInDurableObject(stub,async(_o,state)=>{catalogProfile(state.storage);return session(state.storage,name);});
 const planned=await stub.fetch(request('catalog:preview',preview,'preview'));expect(planned.status).toBe(200);const plan=(await planned.json() as {data:CatalogPlan}).data,body={preview_id:plan.id,expected_profile_revision:1};
 const results=await Promise.all(['a','b'].map(key=>stub.fetch(request('catalog:apply',body,key))));expect(results.map(r=>r.status).sort()).toEqual([200,409]);
 await runInDurableObject(stub,(_o,state)=>{expect(state.storage.sql.exec('SELECT version FROM profiles').one()).toEqual({version:2});expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM idempotency_outcomes').one()).toEqual({n:2});expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM events WHERE type LIKE 'catalog.%'").one()).toEqual({n:2});});
});
it('catalog_HTTP_requires_session_origin_CSRF_idempotency_and_closed_query',async()=>{
 const {stub,name}=await catalogFixture('catalog-http-negative');await runInDurableObject(stub,async(object,state)=>{
  catalogProfile(state.storage);const request=await session(state.storage,name),before=catalogSnapshot(state.storage);
  for(const header of ['x-csrf-token','origin']){const req=request('catalog:preview',preview,header);req.headers.delete(header);expect((await object.fetch(req)).status).toBe(403);}
  const badOrigin=request('catalog:preview',preview,'origin');badOrigin.headers.set('origin','https://foreign.example.invalid');expect((await object.fetch(badOrigin)).status).toBe(403);
  const noKey=request('catalog:preview',preview,'key');noKey.headers.delete('idempotency-key');expect((await object.fetch(noKey)).status).toBe(400);
  const noCookie=request('catalog:preview',preview,'cookie');noCookie.headers.delete('cookie');expect((await object.fetch(noCookie)).status).toBe(401);
  expect((await object.fetch(request('catalog:preview?unknown=1',preview,'query'))).status).toBe(400);
  expect((await object.fetch(request('catalog:preview',{...preview,scope:'all'},'unknown'))).status).toBe(400);
  expect((await object.fetch(request('catalog:preview',undefined,'get','GET'))).status).toBe(404);expect((await object.fetch(request('profile:apply',{},'unsupported'))).status).toBe(404);
  expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
it('catalog_OPTIONS_requires_exact_origin_and_allowed_headers_and_methods',async()=>{
 const {stub}=await catalogFixture('catalog-options');
 const options=(origin:string,method='POST',headers='content-type, idempotency-key, x-csrf-token')=>new Request(base+'catalog:preview',{method:'OPTIONS',headers:{origin,'access-control-request-method':method,'access-control-request-headers':headers}});
 expect((await stub.fetch(options('https://hub.example.invalid'))).status).toBe(204);expect((await stub.fetch(options('https://foreign.example.invalid'))).status).toBe(403);expect((await stub.fetch(options('https://hub.example.invalid','GET'))).status).toBe(403);expect((await stub.fetch(options('https://hub.example.invalid','POST','x-untrusted'))).status).toBe(403);
});
it('catalog_DO_never_awaits_scheduler_repair_after_final_authority_projection',async()=>{
 const {stub,name}=await catalogFixture('catalog-no-scheduler');await runInDurableObject(stub,async(object,state)=>{
  catalogProfile(state.storage);const request=await session(state.storage,name);state.storage.sql.exec('INSERT INTO scheduler_state(id,dirty,generation) VALUES(1,1,1) ON CONFLICT(id) DO UPDATE SET dirty=1');const before=state.storage.sql.exec('SELECT * FROM scheduler_state').toArray();const spy=vi.spyOn(object,'repairSchedule').mockImplementation(async()=>{throw Error('unexpected_catalog_scheduler_await');});
  try{const response=await object.fetch(request('catalog:preview',preview,'preview'));expect(response.status).toBe(200);const plan=(await response.json() as {data:CatalogPlan}).data;expect((await object.fetch(request('catalog:apply',{preview_id:plan.id,expected_profile_revision:1},'apply'))).status).toBe(200);expect(spy).not.toHaveBeenCalled();expect(state.storage.sql.exec('SELECT * FROM scheduler_state').toArray()).toEqual(before);expect(await state.storage.getAlarm()).toBeNull();}finally{spy.mockRestore();}
 });
});
it.each(['revoke','epoch','maintenance'] as const)('catalog_pre_commit_digest_await_rechecks_%s_and_rolls_back',async(mutation)=>{
 const {stub,name}=await catalogFixture('catalog-hash-'+mutation);await runInDurableObject(stub,async(object,state)=>{
  catalogProfile(state.storage);const request=await session(state.storage,name),before=catalogSnapshot(state.storage),digest=crypto.subtle.digest.bind(crypto.subtle);let intercepted=0;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{const result=await digest(algorithm,data);if(new TextDecoder().decode(data).includes('catalog:preview')){intercepted++;if(mutation==='revoke')state.storage.sql.exec('UPDATE sessions SET revoked_at=1');else if(mutation==='epoch')state.storage.sql.exec('UPDATE workspace_metadata SET config_epoch=config_epoch+1');else state.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1');}return result;});
  try{const response=await object.fetch(request('catalog:preview',preview,'race'));expect(intercepted).toBe(1);expect([401,503]).toContain(response.status);expect(await response.json()).not.toHaveProperty('data');expect(catalogSnapshot(state.storage)).toEqual(before);}finally{spy.mockRestore();}
 });
});
it('catalog_CSRF_signing_await_rechecks_session_before_commit',async()=>{
 const {stub,name}=await catalogFixture('catalog-sign-revoke');await runInDurableObject(stub,async(object,state)=>{
  catalogProfile(state.storage);const request=await session(state.storage,name),before=catalogSnapshot(state.storage),sign=crypto.subtle.sign.bind(crypto.subtle);let intercepted=0;
  const spy=vi.spyOn(crypto.subtle,'sign').mockImplementation(async(algorithm,key,data)=>{const result=await sign(algorithm,key,data);intercepted++;state.storage.sql.exec('UPDATE sessions SET revoked_at=1');return result;});
  try{const response=await object.fetch(request('catalog:preview',preview,'sign'));expect(intercepted).toBe(1);expect(response.status).toBe(401);expect(await response.json()).not.toHaveProperty('data');expect(catalogSnapshot(state.storage)).toEqual(before);}finally{spy.mockRestore();}
 });
});
it.each(['revoke','epoch','maintenance'] as const)('catalog_apply_rechecks_%s_after_request_hash_before_any_remap',async(mutation)=>{
 const {stub,name}=await catalogFixture('catalog-apply-hash-'+mutation);await runInDurableObject(stub,async(object,state)=>{
  catalogProfile(state.storage);const request=await session(state.storage,name);const ctx=taskContext(state.storage);withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'task_a'},{...taskInput,project_id:'project_a'}));
  const response=await object.fetch(request('catalog:preview',preview,'preview'));expect(response.status).toBe(200);const plan=(await response.json() as {data:CatalogPlan}).data,before=catalogSnapshot(state.storage),digest=crypto.subtle.digest.bind(crypto.subtle);let intercepted=0;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{const result=await digest(algorithm,data);if(new TextDecoder().decode(data).includes('catalog:apply')){intercepted++;if(mutation==='revoke')state.storage.sql.exec('UPDATE sessions SET revoked_at=1');else if(mutation==='epoch')state.storage.sql.exec('UPDATE workspace_metadata SET config_epoch=config_epoch+1');else state.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1');}return result;});
  try{const applied=await object.fetch(request('catalog:apply',{preview_id:plan.id,expected_profile_revision:1},'race'));expect(intercepted).toBe(1);expect([401,503]).toContain(applied.status);expect(await applied.json()).not.toHaveProperty('data');expect(catalogSnapshot(state.storage)).toEqual(before);}finally{spy.mockRestore();}
 });
});
it('catalog_concurrent_duplicate_preview_returns_one_plan_and_one_outcome',async()=>{
 const {stub,name}=await catalogFixture('catalog-preview-race');const request=await runInDurableObject(stub,async(_o,state)=>{catalogProfile(state.storage);return session(state.storage,name);});
 const responses=await Promise.all([stub.fetch(request('catalog:preview',preview,'same')),stub.fetch(request('catalog:preview',preview,'same'))]);expect(responses.map(x=>x.status)).toEqual([200,200]);const bodies=await Promise.all(responses.map(x=>x.json())) as {data:CatalogPlan}[];expect(bodies[0].data).toEqual(bodies[1].data);
 await runInDurableObject(stub,(_o,state)=>{expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM catalog_plans').one()).toEqual({n:1});expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM idempotency_outcomes').one()).toEqual({n:1});expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM events WHERE type='catalog.previewed'").one()).toEqual({n:1});});
});
it.each(['tasks:edit','agents:manage'] as const)('catalog_apply_replay_still_requires_original_%s_authority',async(scope)=>{
 const {stub,name}=await catalogFixture('catalog-replay-scope-'+scope.replace(':','-'));await runInDurableObject(stub,async(object,state)=>{
  catalogProfile(state.storage);const request=await session(state.storage,name),ctx=taskContext(state.storage);
  const body=scope==='tasks:edit'?preview:{...preview,kind:'work_role',id:'role_a',replacement_id:'role_b'};
  withTransaction(state.storage,tx=>{if(scope==='tasks:edit')createTask(tx,{...ctx,taskId:'task_a'},{...taskInput,project_id:'project_a'});else createAgent(tx,{...ctx,agentId:'agent_a'},{display_name:'Synthetic',description:'',work_role_ids:['role_a']});});
  const planned=await object.fetch(request('catalog:preview',body,'preview'));expect(planned.status).toBe(200);const plan=(await planned.json() as {data:CatalogPlan}).data,apply={preview_id:plan.id,expected_profile_revision:1};
  expect((await object.fetch(request('catalog:apply',apply,'apply'))).status).toBe(200);
  const grants=state.storage.sql.exec<{scopes_json:string}>('SELECT scopes_json FROM human_grants').one();state.storage.sql.exec('UPDATE human_grants SET scopes_json=?',JSON.stringify((JSON.parse(grants.scopes_json) as string[]).filter(x=>x!==scope)));const before=catalogSnapshot(state.storage);
  const replay=await object.fetch(request('catalog:apply',apply,'apply'));expect(replay.status).toBe(403);expect(await replay.json()).not.toHaveProperty('data');expect(catalogSnapshot(state.storage)).toEqual(before);
 });
});
