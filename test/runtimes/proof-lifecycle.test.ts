import {it,expect,vi,afterEach} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {settingsFixture,owned} from '../helpers/settings';
import {sha256} from '../../src/config/bootstrap';
import {r2Routes} from '../../src/http/r2-routes';
import type {RuntimeIssue,Runtime} from '../../src/http/dto';
afterEach(()=>vi.restoreAllMocks());
const token=btoa('a'.repeat(32)).replace(/=+$/,'');
const base='https://hub.example.invalid/v2/workspaces/ws_example/';
const req=(path:string,body:unknown,key:string,proof?:string,bearer=token)=>new Request(base+path,{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json','idempotency-key':key,...(proof?{'x-runtime-token':proof}:{})},body:JSON.stringify(body)});
async function setup(name:string){
 const fixture=await settingsFixture(name),digest=await sha256(token);
 await runInDurableObject(fixture.stub,(_o,state)=>{
  state.storage.sql.exec("UPDATE native_credentials SET token_sha256=?,scopes_json='[\"runtimes:manage\"]'",digest);
 });return fixture;
}
it('enrollment_duplicate_and_restart_replay_reveal_proof_once_and_never_persist_it',async()=>{
 const {stub}=await setup('runtime-duplicate');const logs=[vi.spyOn(console,'info'),vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')];
 const responses=await Promise.all([stub.fetch(req('runtimes',{label:'Synthetic'},'enroll')),stub.fetch(req('runtimes',{label:'Synthetic'},'enroll'))]);
 expect(responses.map(r=>r.status)).toEqual([201,201]);
 const results=await Promise.all(responses.map(r=>r.json())) as {data:RuntimeIssue}[];
 expect(results.filter(r=>r.data.revealed)).toHaveLength(1);expect(results.filter(r=>r.data.runtime_token===null)).toHaveLength(1);
 const first=results.find(r=>r.data.revealed)!.data;expect(first.runtime_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
 expect(new Set(results.map(r=>r.data.runtime.id)).size).toBe(1);
 expect(Object.keys(first.runtime).sort()).toEqual(['id','workspace_id','agent_id','runtime_version','label','status','last_seen_at','presence_expires_at','created_at'].sort());
 expect(Date.parse(first.runtime.presence_expires_at)-Date.parse(first.runtime.last_seen_at)).toBe(90000);
 expect(JSON.stringify(logs.map(l=>l.mock.calls))).not.toContain(first.runtime_token);
 await runInDurableObject(stub,(_o,state)=>{const tables=state.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").toArray();expect(JSON.stringify(tables.map(t=>state.storage.sql.exec('SELECT * FROM '+t.name).toArray()))).not.toContain(first.runtime_token);});
 await evictDurableObject(stub);
 const replay=await stub.fetch(req('runtimes',{label:'Synthetic'},'enroll'));expect(replay.status).toBe(201);expect(await replay.json()).toMatchObject({data:{runtime:first.runtime,runtime_token:null,revealed:false}});
 const heartbeat=await stub.fetch(req('runtimes/'+first.runtime.id+':heartbeat',{expected_runtime_version:1},'heartbeat',first.runtime_token!));expect(heartbeat.status).toBe(200);expect(await heartbeat.json()).toMatchObject({data:{runtime_version:2}});
 const snapshot=await runInDurableObject(stub,(_o,state)=>['runtimes','events','idempotency_outcomes'].map(t=>state.storage.sql.exec('SELECT * FROM '+t).toArray()));
 expect((await stub.fetch(req('runtimes/'+first.runtime.id+':heartbeat',{expected_runtime_version:1},'heartbeat',token))).status).toBe(401);
 expect((await stub.fetch(req('runtimes/'+first.runtime.id+':heartbeat',{expected_runtime_version:1},'heartbeat'))).status).toBe(401);
 expect(await runInDurableObject(stub,(_o,state)=>['runtimes','events','idempotency_outcomes'].map(t=>state.storage.sql.exec('SELECT * FROM '+t).toArray()))).toEqual(snapshot);
 expect((await stub.fetch(req('runtimes/'+first.runtime.id+':heartbeat',{expected_runtime_version:2},'without-proof'))).status).toBe(401);
});
it('exact_credential_workspace_and_proof_are_required_even_for_same_agent_replay',async()=>{
 const {stub}=await setup('runtime-bindings');const second=btoa('b'.repeat(32)).replace(/=+$/,''),secondDigest=await sha256(second);
 await runInDurableObject(stub,(_o,state)=>{
  state.storage.sql.exec("INSERT INTO native_credentials SELECT 'second',workspace_id,agent_id,?,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch,origin,credential_version,label,created_at,revoked_at,issued_by_principal_id FROM native_credentials LIMIT 1",secondDigest);
 });
 const response=await stub.fetch(req('runtimes',{label:'Bindings'},'enroll'));expect(response.status).toBe(201);const {data}=await response.json() as {data:RuntimeIssue};
 const path='runtimes/'+data.runtime.id+':heartbeat',body={expected_runtime_version:1};
 expect((await stub.fetch(req('runtimes',{label:'Bindings'},'enroll',undefined,second))).status).toBe(401);
 expect((await stub.fetch(req(path,body,'wrong-credential',data.runtime_token!,second))).status).toBe(401);
 expect((await stub.fetch(req(path,body,'wrong-proof',second))).status).toBe(401);
 expect((await stub.fetch(req('runtimes/unknown:heartbeat',body,'wrong-id',data.runtime_token!))).status).toBe(401);
 const wrongWorkspace=req(path,body,'wrong-workspace',data.runtime_token!);expect((await stub.fetch(new Request(wrongWorkspace.url.replace('ws_example','ws_foreign'),wrongWorkspace))).status).toBe(401);
 expect((await stub.fetch(req(path,{...body,now_ms:0},'client-clock',data.runtime_token!))).status).toBe(400);
 expect((await stub.fetch(req('runtimes',{label:'Bindings',agent_id:data.runtime.agent_id},'spoof-agent'))).status).toBe(400);
 expect((await stub.fetch(new Request(base+'runtimes',{headers:{authorization:'Bearer '+token}}))).status).toBe(404);
 const changed=await stub.fetch(req('runtimes',{label:'Different'},'enroll'));expect(changed.status).toBe(409);
 await runInDurableObject(stub,(_o,state)=>{state.storage.sql.exec('UPDATE runtimes SET authority_epoch=2 WHERE id=?',data.runtime.id);});
 expect((await stub.fetch(req(path,body,'wrong-epoch',data.runtime_token!))).status).toBe(401);
});
it('presence_boundary_and_replay_use_trusted_transaction_time_without_cleanup',async()=>{
 for(const delta of [-1,0,1]){
  const {stub,name}=await setup('runtime-boundary-'+(delta+1)),created=await stub.fetch(req('runtimes',{label:'Boundary'},'enroll'));expect(created.status).toBe(201);
  const {data}=await created.json() as {data:RuntimeIssue},deadline=Date.parse(data.runtime.presence_expires_at);
  await runInDurableObject(stub,async(_o,state)=>{
   const ws={...owned(state.storage,name),clock:{nowMs:()=>deadline+delta}};
   const result=await r2Routes(req('runtimes/'+data.runtime.id+':heartbeat',{expected_runtime_version:1},'beat',data.runtime_token!),ws);
   expect(result.status).toBe(delta===-1?200:401);
   if(delta===-1){const updated=await result.json() as {data:Runtime};expect(updated.data.runtime_version).toBe(2);expect(Date.parse(updated.data.presence_expires_at)).toBe(deadline-1+90000);
    const replay=await r2Routes(req('runtimes/'+data.runtime.id+':heartbeat',{expected_runtime_version:1},'beat',data.runtime_token!),ws);expect(replay.status).toBe(200);expect((await replay.json() as {data:Runtime}).data).toEqual(updated.data);
    const stale=await r2Routes(req('runtimes/'+data.runtime.id+':heartbeat',{expected_runtime_version:1},'new-stale',data.runtime_token!),ws);expect(stale.status).toBe(409);
    const expired={...ws,clock:{nowMs:()=>deadline-1+90000}};
    expect((await r2Routes(req('runtimes/'+data.runtime.id+':heartbeat',{expected_runtime_version:1},'beat',data.runtime_token!),expired)).status).toBe(401);
    expect((await r2Routes(req('runtimes',{label:'Boundary'},'enroll'),expired)).status).toBe(401);
   }else{expect(state.storage.sql.exec('SELECT runtime_version,status FROM runtimes WHERE id=?',data.runtime.id).one()).toEqual({runtime_version:1,status:'online'});}
  });
 }
});
it('heartbeat_never_changes_task_run_fence_lease_assignment_or_scheduler',async()=>{
 const {stub}=await setup('runtime-presence-only'),response=await stub.fetch(req('runtimes',{label:'Presence'},'enroll'));expect(response.status).toBe(201);
 const {data}=await response.json() as {data:RuntimeIssue};
 const before=await runInDurableObject(stub,(_o,state)=>{
  const runtime=state.storage.sql.exec<{credential_id:string;authority_epoch:number}>('SELECT credential_id,authority_epoch FROM runtimes WHERE id=?',data.runtime.id).one();
  state.storage.sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,assigned_agent_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES('task','ws_example','Task','','ready',1,0,?,0,0,'[]',1,1)",data.runtime.agent_id);
  state.storage.sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at) VALUES('run','ws_example','task',?,?,?,?,'active',1,7,?,1)",data.runtime.agent_id,data.runtime.id,runtime.credential_id,runtime.authority_epoch,Date.now()+60000);
  state.storage.sql.exec("UPDATE tasks SET state='doing',active_run_id='run',latest_run_id='run' WHERE id='task'");
  state.storage.sql.exec('INSERT INTO scheduler_state(id,dirty,generation) VALUES(1,1,1) ON CONFLICT(id) DO UPDATE SET dirty=1');
  return ['tasks','runs','scheduler_state'].map(t=>state.storage.sql.exec('SELECT * FROM '+t).toArray());
 });
 const result=await stub.fetch(req('runtimes/'+data.runtime.id+':heartbeat',{expected_runtime_version:1},'beat',data.runtime_token!));expect(result.status).toBe(200);
 const after=await runInDurableObject(stub,(_o,state)=>['tasks','runs','scheduler_state'].map(t=>state.storage.sql.exec('SELECT * FROM '+t).toArray()));expect(after).toEqual(before);
});
it('transaction_rollback_preserves_no_runtime_event_or_outcome_and_collision_never_reveals',async()=>{
 const {stub,name}=await setup('runtime-rollback');
 await runInDurableObject(stub,async(_o,state)=>{
  state.storage.sql.exec("CREATE TRIGGER fail_runtime_event BEFORE INSERT ON events WHEN NEW.type='runtime.enrolled' BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END");
  const result=await r2Routes(req('runtimes',{label:'Rollback'},'rollback'),owned(state.storage,name));expect(result.status).toBe(500);
  expect(state.storage.sql.exec('SELECT * FROM runtimes').toArray()).toEqual([]);expect(state.storage.sql.exec("SELECT * FROM idempotency_outcomes WHERE operation='domain.runtimes:manage'").toArray()).toEqual([]);
  state.storage.sql.exec('DROP TRIGGER fail_runtime_event');
  const ws={...owned(state.storage,name),entropy:{bytes:(n:number)=>new Uint8Array(n).fill(7)}};
  const first=await r2Routes(req('runtimes',{label:'Collision'},'first'),ws);expect(first.status).toBe(201);
  const collision=await r2Routes(req('runtimes',{label:'Collision'},'second'),ws);expect(collision.status).toBe(409);expect(JSON.stringify(await collision.json())).not.toContain('runtime_token');
  expect(state.storage.sql.exec('SELECT * FROM runtimes').toArray()).toHaveLength(1);
 });
});
it('valid_human_session_cannot_enroll_or_supply_runtime_authority',async()=>{
 const {installed,login,request:authRequest}=await import('../helpers/auth');
 const {stub}=await installed('runtime-human',['workspace:read']);
 // Even an internally over-broad synthetic human grant cannot cross the native-only lane.
 await runInDurableObject(stub,(_o,state)=>{state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"workspace:read\",\"runtimes:manage\"]'");});
 const session=await login(stub);await session.response.text();
 const sessionResponse=await stub.fetch(authRequest('session','GET',undefined,session.cookie));const data=await sessionResponse.json() as {data:{csrf_token:string}};
 const response=await stub.fetch(new Request(base+'runtimes',{method:'POST',headers:{origin:'https://hub.example.invalid',cookie:session.cookie,'x-csrf-token':data.data.csrf_token,'idempotency-key':'human','content-type':'application/json'},body:JSON.stringify({label:'Human cannot enroll'})}));expect(response.status).toBe(401);
 await runInDurableObject(stub,(_o,state)=>{expect(state.storage.sql.exec('SELECT * FROM runtimes').toArray()).toEqual([]);});
});
