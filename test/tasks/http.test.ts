import {it,expect} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {taskFixture,taskContext,taskInput} from '../helpers/tasks';
import {human,owned} from '../helpers/settings';
import {sha256} from '../../src/config/bootstrap';
import {csrfToken} from '../../src/auth/csrf';
import type {SessionRecord} from '../../src/auth/authorize';
import {taskRoutes,taskPath} from '../../src/http/task-routes';
import {createTask} from '../../src/tasks/commands';
import {withTransaction} from '../../src/storage/transaction';
const base='https://hub.example.invalid/v2/workspaces/ws_example/';
async function session(storage:DurableObjectStorage,name:string){
 human(storage);const token='A'.repeat(43);storage.sql.exec('UPDATE sessions SET token_digest=?',await sha256(token));
 const workspace={...owned(storage,name),secrets:{CSRF_SECRET:'synthetic-csrf-fixture-secret-value-long-enough',CURSOR_ENCRYPTION_KEY:'f'.repeat(64)}};
 const csrf=await csrfToken(workspace,withTransaction(storage,tx=>tx.one<SessionRecord>('SELECT * FROM sessions')!));
 const req=(path:string,method='GET',body?:unknown,key='key')=>new Request(base+path,{method,headers:{cookie:'cfhub_session='+token,origin:'https://hub.example.invalid',...(body===undefined?{}:{'content-type':'application/json','idempotency-key':key,'x-csrf-token':csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {workspace,req};
}
it('task_http_create_get_patch_ready_are_closed_versioned_and_replayable',async()=>{
 const {stub,name}=await taskFixture('task-http-command');await runInDurableObject(stub,async(_o,state)=>{
  const {workspace,req}=await session(state.storage,name);const create=await taskRoutes(req('tasks','POST',taskInput,'create'),workspace);expect(create.status).toBe(201);const created=await create.json() as {data:{id:string;task_version:number}};const path='tasks/'+created.data.id;
  expect((await taskRoutes(req(path),workspace)).status).toBe(200);
  expect((await taskRoutes(req(path,'PATCH',{expected_version:1,title:'Changed'},'patch'),workspace)).status).toBe(200);
  expect((await taskRoutes(req(path+':ready','POST',{expected_version:2},'ready'),workspace)).status).toBe(200);
  expect((await taskRoutes(req(path+':ready','POST',{expected_version:2},'ready'),workspace)).status).toBe(200);
  expect((await taskRoutes(req('tasks','POST',{...taskInput,state:'ready'},'invalid'),workspace)).status).toBe(400);
  const noCsrf=req('tasks','POST',taskInput,'nocsrf');noCsrf.headers.delete('x-csrf-token');expect((await taskRoutes(noCsrf,workspace)).status).toBe(403);
  expect((await taskRoutes(req(path+'/results'),workspace)).status).toBe(200);
 });
});
it('task_http_query_validation_is_closed_duplicate_safe_and_scope_bound',async()=>{
 const {stub,name}=await taskFixture('task-http-query');await runInDurableObject(stub,async(_o,state)=>{
  const {workspace,req}=await session(state.storage,name);const ctx=taskContext(state.storage);withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'task_a'},taskInput));
  expect((await taskRoutes(req('tasks'),workspace)).status).toBe(200);
  for(const query of ['?limit=0','?limit=201','?limit=1&limit=2','?state=unknown','?state=ready&state=backlog','?project_id=','?unknown=true','?cursor=','?cursor='+'a'.repeat(2049)])expect((await taskRoutes(req('tasks'+query),workspace)).status).toBe(400);
  expect((await taskRoutes(req('tasks/task_a?limit=1'),workspace)).status).toBe(400);expect((await taskRoutes(req('tasks/task_a/results?state=ready'),workspace)).status).toBe(400);
  state.storage.sql.exec("UPDATE human_grants SET scopes_json='[]'");expect((await taskRoutes(req('tasks/task_a'),workspace)).status).toBe(403);
 });
});
it('task_http_cursor_is_fixed_width_bound_to_query_and_reauthorized_after_crypto',async()=>{
 const {stub,name}=await taskFixture('task-http-cursor');await runInDurableObject(stub,async(_o,state)=>{
  const {workspace,req}=await session(state.storage,name),ctx=taskContext(state.storage);withTransaction(state.storage,tx=>{for(const id of ['task_a','task_b','task_c'])createTask(tx,{...ctx,taskId:id},taskInput);});
  const response=await taskRoutes(req('tasks?limit=1'),workspace);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');const first=await response.json() as {data:{id:string}[];page:{has_more:boolean;next_cursor:string}};
  expect(first.data.map(x=>x.id)).toEqual(['task_a']);expect(first.page.has_more).toBe(true);expect(first.page.next_cursor).toHaveLength(2048);
  expect((await taskRoutes(req('tasks?limit=1&cursor='+first.page.next_cursor),workspace)).status).toBe(200);
  expect((await taskRoutes(req('tasks?limit=2&cursor='+first.page.next_cursor),workspace)).status).toBe(400);
  expect((await taskRoutes(req('tasks?limit=1&state=backlog&cursor='+first.page.next_cursor),workspace)).status).toBe(400);
  const race={...workspace,entropy:{bytes:(n:number)=>{state.storage.sql.exec('UPDATE sessions SET revoked_at=1');return crypto.getRandomValues(new Uint8Array(n));}}};const denied=await taskRoutes(req('tasks?limit=1'),race);expect(denied.status).toBe(401);expect(await denied.json()).not.toHaveProperty('data');
 });
});
it('task_http_visibility_change_during_cursor_encoding_fails_whole_page',async()=>{
 const {stub,name}=await taskFixture('task-http-visible-race');await runInDurableObject(stub,async(_o,state)=>{
  const {workspace,req}=await session(state.storage,name),ctx=taskContext(state.storage);withTransaction(state.storage,tx=>{for(const id of ['task_a','task_b'])createTask(tx,{...ctx,taskId:id},taskInput);});
  const race={...workspace,entropy:{bytes:(n:number)=>{state.storage.sql.exec("UPDATE tasks SET title='changed' WHERE id='task_a'");return crypto.getRandomValues(new Uint8Array(n));}}};const denied=await taskRoutes(req('tasks?limit=1'),race);expect(denied.status).toBe(503);const data=await denied.json();expect(data).not.toHaveProperty('data');expect(data).not.toHaveProperty('page');
 });
});
it('task_http_options_checks_exact_origin_and_successors_stay_unavailable',async()=>{
 const {stub,name}=await taskFixture('task-http-options');await runInDurableObject(stub,async(_o,state)=>{
  const {workspace,req}=await session(state.storage,name);
  const options=(origin:string)=>new Request(base+'tasks',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type, idempotency-key, x-csrf-token'}});
  expect((await taskRoutes(options('https://hub.example.invalid'),workspace)).status).toBe(204);expect((await taskRoutes(options('https://foreign.example.invalid'),workspace)).status).toBe(403);
  for(const operation of ['request-decision']){const path='tasks/task_a:'+operation;expect(taskPath.test(new URL(req(path).url).pathname)).toBe(false);expect((await taskRoutes(req(path,'POST',{}),workspace)).status).toBe(404);}
 });
});
it('task_http_continuation_survives_restart_and_preserves_initial_highwater',async()=>{
 const {stub,name}=await taskFixture('task-http-restart');const token=await runInDurableObject(stub,async(_o,state)=>{
  const {workspace,req}=await session(state.storage,name),ctx=taskContext(state.storage);withTransaction(state.storage,tx=>{for(const id of ['task_a','task_b'])createTask(tx,{...ctx,taskId:id},taskInput);});
  const response=await taskRoutes(req('tasks?limit=1'),workspace),page=await response.json() as {page:{next_cursor:string}};
  withTransaction(state.storage,tx=>createTask(tx,{...ctx,nowMs:ctx.nowMs+1,taskId:'task_later'},taskInput));return page.page.next_cursor;
 });await evictDurableObject(stub);
 await runInDurableObject(stub,async(_o,state)=>{
  const workspace={...owned(state.storage,name),secrets:{CURSOR_ENCRYPTION_KEY:'f'.repeat(64)}};const response=await taskRoutes(new Request(base+'tasks?limit=1&cursor='+token,{headers:{cookie:'cfhub_session='+'A'.repeat(43)}}),workspace);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({data:[{id:'task_b'}],page:{next_cursor:null,has_more:false}});
 });
});
it('task_http_cursor_absolute_expiry_and_incarnation_are_not_refreshable',async()=>{
 for(const change of ['expiry','incarnation']){
  const {stub,name}=await taskFixture('task-http-'+change);await runInDurableObject(stub,async(_o,state)=>{
   const {workspace,req}=await session(state.storage,name),ctx=taskContext(state.storage);state.storage.sql.exec('UPDATE sessions SET expires_at=?',ctx.nowMs+7200000);let nowMs=ctx.nowMs;workspace.clock={nowMs:()=>nowMs};
   withTransaction(state.storage,tx=>{for(const id of ['task_a','task_b','task_c'])createTask(tx,{...ctx,taskId:id},taskInput);});
   const response=await taskRoutes(req('tasks?limit=1'),workspace),first=await response.json() as {page:{next_cursor:string}};
   if(change==='expiry')nowMs+=3600000;else state.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1');
   const denied=await taskRoutes(req('tasks?limit=1&cursor='+first.page.next_cursor),workspace);expect(denied.status).toBe(change==='expiry'?410:400);expect(await denied.json()).not.toHaveProperty('data');
  });
 }
});
it('task_http_tampering_mixed_identity_and_foreign_workspace_do_not_disclose',async()=>{
 const {stub,name}=await taskFixture('task-http-denials');await runInDurableObject(stub,async(_o,state)=>{
  const {workspace,req}=await session(state.storage,name),ctx=taskContext(state.storage);withTransaction(state.storage,tx=>{for(const id of ['task_a','task_b'])createTask(tx,{...ctx,taskId:id},taskInput);});
  const response=await taskRoutes(req('tasks?limit=1'),workspace),first=await response.json() as {page:{next_cursor:string}};const token=first.page.next_cursor,corrupt=(token[0]==='A'?'B':'A')+token.slice(1);
  expect((await taskRoutes(req('tasks?limit=1&cursor='+corrupt),workspace)).status).toBe(400);
  const mixed=req('tasks');mixed.headers.set('authorization','Bearer '+'B'.repeat(43));expect((await taskRoutes(mixed,workspace)).status).toBe(400);
  expect((await taskRoutes(new Request(base.replace('ws_example','ws_foreign')+'tasks'),workspace)).status).toBe(404);
  expect((await taskRoutes(req('tasks/%FF'),workspace)).status).toBe(400);expect((await taskRoutes(req('tasks/task_a','DELETE'),workspace)).status).toBe(404);
 });
});
it('opaque_task_id_results_is_not_confused_with_nested_history_route',async()=>{
 const {stub,name}=await taskFixture('task-http-results-id');await runInDurableObject(stub,async(_o,state)=>{
  const {workspace,req}=await session(state.storage,name),ctx=taskContext(state.storage);withTransaction(state.storage,tx=>createTask(tx,{...ctx,taskId:'results'},taskInput));
  const get=await taskRoutes(req('tasks/results'),workspace);expect(get.status).toBe(200);expect(await get.json()).toMatchObject({data:{id:'results',title:taskInput.title}});
  const patched=await taskRoutes(req('tasks/results','PATCH',{expected_version:1,title:'Opaque identifier'},'patch'),workspace);expect(patched.status).toBe(200);expect(await patched.json()).toMatchObject({data:{id:'results',title:'Opaque identifier',task_version:2}});
  const history=await taskRoutes(req('tasks/results/results'),workspace);expect(history.status).toBe(200);expect(await history.json()).toMatchObject({data:[],page:{next_cursor:null,has_more:false}});
 });
});
