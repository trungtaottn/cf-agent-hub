import {it,expect,vi,afterEach} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {settingsFixture,owned,human} from '../helpers/settings';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {createAgent} from '../../src/agents/commands';
import {issueCredential,revokeCredential} from '../../src/auth/native-credentials';
import {verifyNativeCredential} from '../../src/auth/native';
import {requireRuntimeProof} from '../../src/auth/runtime-proof';
import {sha256,canonicalJson,prepareBootstrap} from '../../src/config/bootstrap';
import {env} from 'cloudflare:workers';
import {fixture,operator} from '../helpers/environment';
import {r2Routes} from '../../src/http/r2-routes';
import type {RuntimeIssue} from '../../src/http/dto';
afterEach(()=>vi.restoreAllMocks());
const bearer=btoa('r'.repeat(32)).replace(/=+$/,'');
const request=(path:string,body:unknown,key:string,proof?:string)=>new Request('https://hub.example.invalid/v2/workspaces/ws_example/'+path,{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json','idempotency-key':key,...(proof?{'x-runtime-token':proof}:{})},body:JSON.stringify(body)});
async function setup(name:string){
 const f=await settingsFixture(name),digest=await sha256(bearer);
 await runInDurableObject(f.stub,(_o,s)=>{s.storage.sql.exec("UPDATE native_credentials SET token_sha256=?,scopes_json='[\"runtimes:manage\"]'",digest);});return f;
}
const mutations=['revoke','archive','epoch','maintenance','credential-expiry','presence-expiry','scope'] as const;
type Mutation=typeof mutations[number];
function change(storage:DurableObjectStorage,mutation:Mutation,now:number):number{
 if(mutation==='revoke')storage.sql.exec('UPDATE native_credentials SET enabled=0,revoked_at=?',now);
 if(mutation==='archive')storage.sql.exec("UPDATE static_agents SET status='archived'");
 if(mutation==='epoch'){
  // Keep a valid new epoch, so this is a stale admission/authority failure, not malformed metadata.
  storage.sql.exec('UPDATE workspace_metadata SET config_epoch=config_epoch+1');
  storage.sql.exec('UPDATE maintenance_state SET authority_epoch=authority_epoch+1');
  storage.sql.exec('UPDATE static_agents SET config_epoch=config_epoch+1');
  storage.sql.exec('UPDATE native_credentials SET config_epoch=config_epoch+1');
 }
 if(mutation==='maintenance'){
  storage.sql.exec("UPDATE maintenance_state SET state='capturing',generation=generation+1");
  storage.sql.exec("UPDATE workspace_metadata SET admission_state='maintenance'");
  storage.sql.exec("UPDATE maintenance_state SET state='open',generation=generation+1");
  storage.sql.exec("UPDATE workspace_metadata SET admission_state='installed'");
 }
 if(mutation==='credential-expiry')storage.sql.exec('UPDATE native_credentials SET expires_at=?',now);
 if(mutation==='scope')storage.sql.exec("UPDATE native_credentials SET scopes_json='[]'");
 return mutation==='presence-expiry'?storage.sql.exec<{presence_expires_at:number}>('SELECT presence_expires_at FROM runtimes').one().presence_expires_at:now;
}
it.each(mutations)('heartbeat rechecks %s after proof hashing, including open-again admission',async mutation=>{
 const {stub,name}=await setup('runtime-hash-race-'+mutation);
 await runInDurableObject(stub,async(_o,state)=>{
  let now=Date.now();const workspace={...owned(state.storage,name),clock:{nowMs:()=>now}};
  const enrollment=await r2Routes(request('runtimes',{label:'Race'},'enroll'),workspace);expect(enrollment.status).toBe(201);
  const issued=(await enrollment.json() as {data:RuntimeIssue}).data;
  const before=state.storage.sql.exec('SELECT * FROM runtimes').toArray();
  const events=state.storage.sql.exec('SELECT * FROM events').toArray();
  const outcomes=state.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray();
  const original=crypto.subtle.digest.bind(crypto.subtle);let intercepted=0;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{
   const result=await original(algorithm,data);
   if(new TextDecoder().decode(data)===issued.runtime_token){intercepted++;now=change(state.storage,mutation,now);}
   return result;
  });
  try{
   const response=await r2Routes(request('runtimes/'+issued.runtime.id+':heartbeat',{expected_runtime_version:1},'race',issued.runtime_token!),workspace);
   expect(intercepted).toBe(1);expect(response.status).toBe(mutation==='scope'?403:401);expect(await response.text()).not.toContain(issued.runtime_token);
   expect(state.storage.sql.exec('SELECT * FROM runtimes').toArray()).toEqual(before);
   expect(state.storage.sql.exec('SELECT * FROM events').toArray()).toEqual(events);
   expect(state.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray()).toEqual(outcomes);
  }finally{spy.mockRestore();}
 });
});
it.each(['revoke','archive','epoch','maintenance'] as const)('enrollment loses authority during generated proof hash: %s',async mutation=>{
 const {stub,name}=await setup('runtime-enroll-race-'+mutation);
 await runInDurableObject(stub,async(_o,state)=>{
  const now=Date.now(),bytes=new Uint8Array(32).fill(17),token=btoa(String.fromCharCode(...bytes)).replace(/=+$/,'');
  const workspace={...owned(state.storage,name),clock:{nowMs:()=>now},entropy:{bytes:(n:number)=>n===32?bytes:crypto.getRandomValues(new Uint8Array(n))}};
  const priorOutcomes=state.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray();
  const original=crypto.subtle.digest.bind(crypto.subtle);let intercepted=0;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{
   const result=await original(algorithm,data);if(new TextDecoder().decode(data)===token){intercepted++;change(state.storage,mutation,now);}return result;
  });
  try{
   const response=await r2Routes(request('runtimes',{label:'Denied'},'enroll'),workspace);expect(intercepted).toBe(1);expect(response.status).toBe(401);expect(await response.text()).not.toContain(token);
   expect(state.storage.sql.exec('SELECT * FROM runtimes').toArray()).toEqual([]);
   expect(state.storage.sql.exec("SELECT * FROM events WHERE type LIKE 'runtime.%'").toArray()).toEqual([]);
   expect(state.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray()).toEqual(priorOutcomes);
  }finally{spy.mockRestore();}
 });
});
it('lost enrollment response and restart require fresh runtime without inheriting old run attribution',async()=>{
 const {stub}=await setup('runtime-loss-restart');
 // Discard the body: simulate loss after server commit, without retaining the original proof.
 const lost=await stub.fetch(request('runtimes',{label:'Lost'},'lost'));expect(lost.status).toBe(201);await lost.body!.cancel();
 const old=await runInDurableObject(stub,(_o,state)=>{
  const row=state.storage.sql.exec<{id:string;agent_id:string;credential_id:string}>('SELECT id,agent_id,credential_id FROM runtimes').one(),now=Date.now();
  state.storage.sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,assigned_agent_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES('task_old','ws_example','Old work','','ready',1,0,?,0,0,'[]',?,?)",row.agent_id,now,now);
  state.storage.sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at) VALUES('run_old','ws_example','task_old',?,?,?,1,'active',1,1,?,?)",row.agent_id,row.id,row.credential_id,now+60000,now);
  state.storage.sql.exec("UPDATE tasks SET state='doing',active_run_id='run_old',latest_run_id='run_old' WHERE id='task_old'");
  return {runtime:row,tasks:state.storage.sql.exec('SELECT * FROM tasks').toArray(),runs:state.storage.sql.exec('SELECT * FROM runs').toArray(),proof:state.storage.sql.exec<{proof_sha256:string}>('SELECT proof_sha256 FROM runtimes').one().proof_sha256};
 });
 await evictDurableObject(stub);
 const replay=await stub.fetch(request('runtimes',{label:'Lost'},'lost'));expect(replay.status).toBe(201);
 expect(await replay.json()).toMatchObject({data:{runtime:{id:old.runtime.id},runtime_token:null,revealed:false}});
 const fresh=await stub.fetch(request('runtimes',{label:'Fresh'},'fresh'));expect(fresh.status).toBe(201);
 const issued=(await fresh.json() as {data:RuntimeIssue}).data;expect(issued.runtime.id).not.toBe(old.runtime.id);expect(await sha256(issued.runtime_token!)).not.toBe(old.proof);
 const heartbeat=await stub.fetch(request('runtimes/'+issued.runtime.id+':heartbeat',{expected_runtime_version:1},'fresh-heartbeat',issued.runtime_token!));expect(heartbeat.status).toBe(200);await heartbeat.text();
 await runInDurableObject(stub,(_o,state)=>{
  expect(state.storage.sql.exec('SELECT * FROM tasks').toArray()).toEqual(old.tasks);expect(state.storage.sql.exec('SELECT * FROM runs').toArray()).toEqual(old.runs);
  expect(state.storage.sql.exec('SELECT id FROM runs WHERE runtime_instance_id=?',issued.runtime.id).toArray()).toEqual([]);
  state.storage.sql.exec('UPDATE native_credentials SET revoked_at=?,enabled=0',Date.now());
 });
 await evictDurableObject(stub);
 const denied=await stub.fetch(request('runtimes/'+issued.runtime.id+':heartbeat',{expected_runtime_version:1},'fresh-heartbeat',issued.runtime_token!));expect(denied.status).toBe(401);await denied.text();
});
it.each(['issuer-scope','issuer-projects','issuer-disabled','credential-revoked'] as const)('dynamic runtime checks current human ceiling for heartbeat and enrollment replay: %s',async mutation=>{
 const name='runtime-dynamic-ceiling-'+mutation,raw=await fixture(name);
 raw.config.human_grants[0].scopes=['agents:manage','credentials:manage'];
 Object.assign(raw.config.human_grants[0],{delegable_native_scopes:['runtimes:manage']});
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 const prepared=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);
 await stub.reconcileConfiguration(operator(),prepared);
 const token=btoa('d'.repeat(32)).replace(/=+$/,''),digest=await sha256(token);
 const nativeRequest=(path:string,body:unknown,key:string,proof?:string)=>{const req=request(path,body,key,proof);req.headers.set('authorization','Bearer '+token);return req;};
 await runInDurableObject(stub,async(_o,state)=>{
  const workspace=owned(state.storage,name),identity=human(state.storage),now=workspace.clock.nowMs();
  withTransaction(state.storage,tx=>{
   const ctx={actor:resolveActor(tx,identity,now),nowMs:now,requestId:'dynamic_setup',idempotencyKey:'dynamic_setup'};
   createAgent(tx,{...ctx,agentId:'agent_dynamic_runtime'},{display_name:'Dynamic runtime test',description:'',work_role_ids:[]});
   issueCredential(tx,ctx,{agent_id:'agent_dynamic_runtime',label:'Dynamic proof test',scopes:['runtimes:manage'],project_ids:null,expires_at:new Date(now+3600000).toISOString()},{credentialId:'credential_dynamic_runtime',tokenSha256:digest});
  });
  const enrolled=await r2Routes(nativeRequest('runtimes',{label:'Dynamic'},'dynamic-enroll'),workspace);expect(enrolled.status).toBe(201);
  const issued=(await enrolled.json() as {data:RuntimeIssue}).data,proofHash=await sha256(issued.runtime_token!);
  const native=await verifyNativeCredential(workspace,token,now);
  withTransaction(state.storage,tx=>{
   const actor=resolveActor(tx,native,now),ctx={actor,nowMs:now,requestId:'proof-direct',idempotencyKey:'proof-direct'};
   expect(requireRuntimeProof(tx,ctx,issued.runtime.id,proofHash)).toMatchObject({credentialId:'credential_dynamic_runtime',authorityEpoch:1,runtime:{id:issued.runtime.id}});
   expect(()=>requireRuntimeProof(tx,{...ctx,actor:{...actor,runtimeId:issued.runtime.id}},issued.runtime.id,proofHash)).toThrowError(expect.objectContaining({status:401}));
  });
  if(mutation==='issuer-scope')state.storage.sql.exec('UPDATE human_grants SET scopes_json=?',JSON.stringify(['agents:manage']));
  if(mutation==='issuer-projects')state.storage.sql.exec("UPDATE human_grants SET project_ids_json='[]'");
  if(mutation==='issuer-disabled')state.storage.sql.exec('UPDATE human_grants SET enabled=0');
  if(mutation==='credential-revoked')withTransaction(state.storage,tx=>{
   revokeCredential(tx,{actor:resolveActor(tx,identity,now),nowMs:now,requestId:'revoke-dynamic',idempotencyKey:'revoke-dynamic'},'credential_dynamic_runtime',{expected_credential_version:1,reason:'Synthetic revocation'});
  });
  const runtimes=state.storage.sql.exec('SELECT * FROM runtimes').toArray(),outcomes=state.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray(),events=state.storage.sql.exec('SELECT * FROM events').toArray();
  const heartbeat=await r2Routes(nativeRequest('runtimes/'+issued.runtime.id+':heartbeat',{expected_runtime_version:1},'dynamic-heartbeat',issued.runtime_token!),workspace);expect(heartbeat.status).toBe(401);await heartbeat.text();
  const replay=await r2Routes(nativeRequest('runtimes',{label:'Dynamic'},'dynamic-enroll'),workspace);expect(replay.status).toBe(401);await replay.text();
  expect(state.storage.sql.exec('SELECT * FROM runtimes').toArray()).toEqual(runtimes);expect(state.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray()).toEqual(outcomes);expect(state.storage.sql.exec('SELECT * FROM events').toArray()).toEqual(events);
 });
});
