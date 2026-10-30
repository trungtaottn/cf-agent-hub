import {it,expect,vi,afterEach,beforeAll} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {installed,login,request as authRequest,origin} from '../helpers/auth';
import {owned} from '../helpers/settings';
import {r2Routes} from '../../src/http/r2-routes';
afterEach(()=>vi.restoreAllMocks());
const scopes=['workspace:read','agents:read','agents:manage','credentials:manage','messages:read','messages:send','events:read'];
const base=origin+'/v2/workspaces/ws_example/';
async function setup(name:string){
 const {stub}=await installed(name,scopes),session=await login(stub);
 await session.response.text();
 const response=await stub.fetch(authRequest('session','GET',undefined,session.cookie));
 const data=await response.json() as {data:{csrf_token:string}};
 const req=(path:string,body:unknown,key:string,method='POST')=>new Request(base+path,{method,headers:{origin,cookie:session.cookie,'content-type':'application/json','idempotency-key':key,'x-csrf-token':data.data.csrf_token},body:JSON.stringify(body)});
 return {stub,name,req,cookie:session.cookie};
}
let httpFixture:Awaited<ReturnType<typeof setup>>,lossFixture:Awaited<ReturnType<typeof setup>>;
beforeAll(async()=>{
 [httpFixture,lossFixture]=await Promise.all([setup('identity-http'),setup('identity-http-loss')]);
 // JOSE's real remote-JWKS timeout lives for 5s even after successful login. Drain
 // that setup I/O before testing post-issuance restart under unchanged test timeout.
 await Promise.all([evictDurableObject(httpFixture.stub),evictDurableObject(lossFixture.stub)]);
});
const agentBody={display_name:'Synthetic HTTP agent',description:'',work_role_ids:[]};
it('human_http_create_and_duplicate_issuance_reveal_exactly_once_without_sql_or_log_leaks',async()=>{
 const logs=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')];
 const {stub,req}=httpFixture;
 const created=await stub.fetch(req('agents',agentBody,'agent'));expect(created.status).toBe(201);
 const agent=await created.json() as {data:{id:string}};
 const body={agent_id:agent.data.id,label:'Synthetic issue',scopes:['messages:read'],project_ids:null,expires_at:new Date(Date.now()+3600000).toISOString()};
 const responses=await Promise.all([stub.fetch(req('credentials',body,'issue')),stub.fetch(req('credentials',body,'issue'))]);
 expect(responses.map(r=>r.status)).toEqual([201,201]);
 const data=await Promise.all(responses.map(r=>r.json())) as {data:{token:string|null;revealed:boolean;credential:{id:string}}}[];
 expect(data.filter(x=>x.data.revealed)).toHaveLength(1);expect(data.filter(x=>x.data.token===null)).toHaveLength(1);
 const token=data.find(x=>x.data.token)?.data.token!;expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
 expect(new Set(data.map(x=>x.data.credential.id)).size).toBe(1);
 expect(JSON.stringify(logs.map(log=>log.mock.calls))).not.toContain(token);
 await runInDurableObject(stub,(_o,state)=>{
  const tables=state.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").toArray();
  const values=tables.map(t=>state.storage.sql.exec('SELECT * FROM '+t.name).toArray());expect(JSON.stringify(values)).not.toContain(token);
 });
 await evictDurableObject(stub);
 const replay=await stub.fetch(req('credentials',body,'issue'));expect(replay.status).toBe(201);expect(await replay.json()).toMatchObject({data:{token:null,revealed:false}});
 expect((await stub.fetch(req('credentials',{...body,label:'changed'},'issue'))).status).toBe(409);
 const noCsrf=req('agents',agentBody,'missing-csrf');noCsrf.headers.delete('x-csrf-token');expect((await stub.fetch(noCsrf)).status).toBe(403);
 const foreign=req('agents',agentBody,'foreign');foreign.headers.set('origin','https://other.example.invalid');expect((await stub.fetch(foreign)).status).toBe(403);
});
it('response_loss_after_commit_never_recovers_or_reissues_secret',async()=>{
 const {stub,name,req}=lossFixture;
 const created=await stub.fetch(req('agents',agentBody,'agent'));expect(created.status).toBe(201);
 const agent=await created.json() as {data:{id:string}},body={agent_id:agent.data.id,label:'Lost synthetic issue',scopes:['messages:read'],project_ids:null,expires_at:new Date(Date.now()+3600000).toISOString()};
 let lostId='';
 await runInDurableObject(stub,async(_o,state)=>{
  const original=Response.json,spy=vi.spyOn(Response,'json').mockImplementation((data,init)=>{
   const item=data as {data?:{token?:string;credential?:{id:string}}};
   if(item.data?.token){lostId=item.data.credential!.id;throw Error('synthetic_response_loss');}
   return original(data,init);
  });
  try{const response=await r2Routes(req('credentials',body,'lost'),{...owned(state.storage,name),secrets:env as unknown as Record<string,unknown>});expect(response.status).toBe(500);}finally{spy.mockRestore();}
  expect(lostId).not.toBe('');
 });
 await evictDurableObject(stub);
 const replay=await stub.fetch(req('credentials',body,'lost'));expect(replay.status).toBe(201);expect(await replay.json()).toMatchObject({data:{token:null,revealed:false,credential:{id:lostId}}});
 const fresh=await stub.fetch(req('credentials',body,'fresh'));expect(fresh.status).toBe(201);
 const replacement=await fresh.json() as {data:{token:string;credential:{id:string}}};expect(replacement.data.credential.id).not.toBe(lostId);expect(replacement.data.token).toHaveLength(43);
});
it('issuance_rechecks_session_archive_and_epoch_after_secret_hash_await',async()=>{
 for(const mutation of ['session','archive','epoch']){
  const {stub,name,req}=await setup('identity-http-race-'+mutation),created=await stub.fetch(req('agents',agentBody,'agent'));expect(created.status).toBe(201);
  const agent=await created.json() as {data:{id:string}},body={agent_id:agent.data.id,label:'Race issue',scopes:['messages:read'],project_ids:null,expires_at:new Date(Date.now()+3600000).toISOString()};
  await runInDurableObject(stub,async(_o,state)=>{
   const workspace={...owned(state.storage,name),secrets:env as unknown as Record<string,unknown>,entropy:{bytes:(n:number)=>n===32?new Uint8Array(n).fill(7):crypto.getRandomValues(new Uint8Array(n))}};
   const token=btoa(String.fromCharCode(...new Uint8Array(32).fill(7))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
   const original=crypto.subtle.digest.bind(crypto.subtle);let changed=false;
   const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{
    const result=await original(algorithm,data);
    if(new TextDecoder().decode(data)===token){changed=true;
     if(mutation==='session')state.storage.sql.exec('UPDATE sessions SET revoked_at=?',Date.now());
     if(mutation==='archive')state.storage.sql.exec("UPDATE static_agents SET status='archived' WHERE agent_id=?",agent.data.id);
     if(mutation==='epoch')state.storage.sql.exec('UPDATE workspace_metadata SET config_epoch=config_epoch+1');
    }
    return result;
   });
   try{
    const response=await r2Routes(req('credentials',body,'race'),workspace);expect(changed).toBe(true);expect(response.status).toBe(mutation==='archive'?409:401);await response.text();
    expect(state.storage.sql.exec("SELECT * FROM native_credentials WHERE origin='human_managed'").toArray()).toEqual([]);
    expect(state.storage.sql.exec("SELECT * FROM events WHERE type='credential.issued'").toArray()).toEqual([]);
    expect(state.storage.sql.exec("SELECT * FROM idempotency_outcomes WHERE operation='credentials:manage'").toArray()).toEqual([]);
   }finally{spy.mockRestore();}
  });
 }
});
it('identity_http_does_not_run_scheduler_repairs_after_final_authority_check',async()=>{
 const {stub,req}=httpFixture;
 await runInDurableObject(stub,(_o,state)=>{state.storage.sql.exec('INSERT INTO scheduler_state(id,dirty,generation) VALUES(1,1,1) ON CONFLICT(id) DO UPDATE SET dirty=1');});
 const before=await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT * FROM scheduler_state').toArray());
 expect(before).toHaveLength(1);expect(before[0]).toMatchObject({dirty:1});
 const response=await stub.fetch(req('agents',agentBody,'no-scheduler-repair'));expect(response.status).toBe(201);await response.json();
 const after=await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT * FROM scheduler_state').toArray());expect(after).toEqual(before);
 await runInDurableObject(stub,async(_o,state)=>{expect(state.storage.sql.exec('SELECT * FROM outbox').toArray()).toEqual([]);expect(await state.storage.getAlarm()).toBeNull();expect(state.storage.sql.exec("SELECT * FROM events WHERE type='agent.created'").toArray().length).toBeGreaterThan(0);});
 await stub.repairSchedule();
 expect(await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT dirty FROM scheduler_state WHERE id=1').one())).toEqual({dirty:0});
});
