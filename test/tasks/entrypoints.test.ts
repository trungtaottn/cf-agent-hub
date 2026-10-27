import {it,expect,vi} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import entry from '../../src/index';
const token='A'.repeat(43),base='https://hub.example.invalid/v2/workspaces/ws_example/';
async function setup(name:string){
 const raw=await fixture(name);raw.bundle.credentials[0].token_sha256=await sha256(token);
 raw.config.static_credential_refs[0].scopes=[...raw.config.static_credential_refs[0].scopes,'tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:claim','tasks:execute'];
 raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:1,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));const stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration(operator(),await prepareBootstrap(raw.config,raw.bundle,'ws_example'));return {stub,config:raw.config};
}
function request(path:string,method='GET',body?:unknown,key='key'){return new Request(base+path,{method,headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json','idempotency-key':key})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
it('actual_worker_maps_task_routes_to_operator_owned_DO_and_rejects_foreign_catalog',async()=>{
 const {stub,config}=await setup('task-entry-worker'),seen:string[]=[];
 const bindings={...env,DEPLOYMENT_CONFIG:JSON.stringify(config),WORKSPACE:{getByName(name:string){seen.push(name);return stub;}}} as unknown as Env;
 const response=await entry.fetch(request('tasks','POST',{title:'Worker task',description:''},'worker-create'),bindings);expect(response.status).toBe(201);const created=await response.json() as {data:{id:string}};expect(seen).toEqual(['task-entry-worker']);
  const listed=await entry.fetch(request('tasks'),bindings);expect(listed.status).toBe(200);expect(await listed.json()).toMatchObject({data:[{id:created.data.id}]});
  const foreign=await entry.fetch(new Request(base.replace('ws_example','ws_foreign')+'tasks',{headers:{authorization:'Bearer '+token}}),bindings);expect(foreign.status).toBe(401);expect(seen).toHaveLength(2);
  expect((await entry.fetch(request('tasks/'+created.data.id+':claim','POST',{}),bindings)).status).toBe(400);expect(seen).toHaveLength(3);
});
it('actual_DO_task_commands_reads_and_history_leave_scheduler_dirty_and_unarmed',async()=>{
 const {stub}=await setup('task-entry-do');await runInDurableObject(stub,(_o,state)=>{state.storage.sql.exec('INSERT INTO scheduler_state(id,dirty,generation) VALUES(1,1,1) ON CONFLICT(id) DO UPDATE SET dirty=1');});
 const before=await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT * FROM scheduler_state').toArray());expect(before[0]).toMatchObject({dirty:1});
 const response=await stub.fetch(request('tasks','POST',{title:'DO task',description:''},'do-create'));expect(response.status).toBe(201);const created=await response.json() as {data:{id:string}};
 expect((await stub.fetch(request('tasks/'+created.data.id,'PATCH',{expected_version:1,title:'Patched'},'patch'))).status).toBe(200);
 expect((await stub.fetch(request('tasks/'+created.data.id+':ready','POST',{expected_version:2},'ready'))).status).toBe(200);
 const list=await stub.fetch(request('tasks'));expect(list.status).toBe(200);expect(await list.json()).toMatchObject({data:[{id:created.data.id,state:'ready'}]});
 expect((await stub.fetch(request('tasks/'+created.data.id))).status).toBe(200);const results=await stub.fetch(request('tasks/'+created.data.id+'/results'));expect(results.status).toBe(200);expect(await results.json()).toMatchObject({data:[],page:{next_cursor:null,has_more:false}});
 for(const suffix of [':submit-result',':accept-result',':request-decision'])expect((await stub.fetch(request('tasks/'+created.data.id+suffix,'POST',{}))).status).toBe(404);
 const after=await runInDurableObject(stub,async(_o,state)=>({scheduler:state.storage.sql.exec('SELECT * FROM scheduler_state').toArray(),alarm:await state.storage.getAlarm(),outbox:state.storage.sql.exec('SELECT * FROM outbox').toArray()}));expect(after).toEqual({scheduler:before,alarm:null,outbox:[]});
 // Proves the retained dirty marker was actionable, not an inert assertion.
 await stub.repairSchedule();expect(await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT dirty FROM scheduler_state WHERE id=1').one())).toEqual({dirty:0});
});
it('actual_DO_task_response_path_never_calls_async_schedule_repair',async()=>{
 const {stub}=await setup('task-entry-no-await');await runInDurableObject(stub,async(object,state)=>{
  state.storage.sql.exec('INSERT INTO scheduler_state(id,dirty,generation) VALUES(1,1,1) ON CONFLICT(id) DO UPDATE SET dirty=1');const spy=vi.spyOn(object,'repairSchedule').mockImplementation(async()=>{throw Error('unexpected_post_projection_await');});
  try{expect((await object.fetch(request('tasks','POST',{title:'No repair',description:''},'norepair'))).status).toBe(201);expect((await object.fetch(request('tasks'))).status).toBe(200);expect(spy).not.toHaveBeenCalled();expect(state.storage.sql.exec('SELECT dirty FROM scheduler_state WHERE id=1').one()).toEqual({dirty:1});}finally{spy.mockRestore();}
 });
});
