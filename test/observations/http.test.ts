import {it,expect,vi,afterEach} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {taskFixture,taskProfile} from '../helpers/tasks';
import {owned,human} from '../helpers/settings';
import {observationRoutes} from '../../src/http/observation-routes';
import {taskRoutes} from '../../src/http/task-routes';
import {assertObservationGraph,observationSlotBytes,observationRecordBytes} from '../../src/observations/repository';
import {withTransaction} from '../../src/storage/transaction';
import {operator} from '../helpers/environment';
import {sha256,canonicalJson,prepareBootstrap} from '../../src/config/bootstrap';
const base='https://hub.example.invalid/v2/workspaces/ws_example/tasks/task_observation';
const bearer=btoa('o'.repeat(32)).replace(/=+$/,''),proof=btoa('p'.repeat(32)).replace(/=+$/,'');
const request=(suffix:string,body?:unknown,headers:Record<string,string>={})=>new Request(base+suffix,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+bearer,...(body===undefined?{}:{'content-type':'application/json','x-runtime-token':proof}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
afterEach(()=>vi.restoreAllMocks());
it('observation ingress is explicitly unavailable without optional pilot configuration',async()=>{
 const {stub}=await taskFixture('observation-config-absent');
 const response=await stub.fetch(request('/observations:establish',{run_id:'run_observation',fence:1,adapter_id:'synthetic-adapter',adapter_version:'1'}));
 expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:{code:'DEPENDENCY_UNAVAILABLE'}});
});
const pilot={enabled:true,repository_id:'repository_fixture',adapter_id:'synthetic-adapter',adapter_version:'1',supported_events:['read-observed','write-observed'],slots:[{agent_id:'agent_research',checkout_slot_id:'checkout_a'},{agent_id:'agent_second',checkout_slot_id:'checkout_b'}]};
const establish={run_id:'run_observation',fence:1,adapter_id:pilot.adapter_id,adapter_version:pilot.adapter_version};
const record={observed_at:'2026-11-01T00:00:00Z',relative_path:'src/Case Ω.ts',activity:'read-observed',source_oid:null};
async function setup(name:string){
 const f=await taskFixture(name),digest=await sha256(bearer),proofHash=await sha256(proof);
 await runInDurableObject(f.stub,(_o,state)=>{
  const s=state.storage.sql,now=Date.now(),row=s.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one(),config=JSON.parse(row.config_json);
  config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_second',display_name:'Second synthetic'});config.workspace_policies[0].observation_pilot=pilot;s.exec('UPDATE workspace_metadata SET config_json=?',canonicalJson(config));
  s.exec('UPDATE native_credentials SET token_sha256=?',digest);
  const credential=s.exec<{credential_id:string}>('SELECT credential_id FROM native_credentials').one().credential_id;
  s.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES('runtime_observation','ws_example','agent_research',?,1,?,1,'Synthetic','online',?,?,?)",credential,proofHash,now,now,now+3600000);
  s.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,assigned_agent_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES('task_observation','ws_example','Observation fixture','','ready',1,0,'agent_research',0,2,'[]',?,?)",now,now);
  s.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at) VALUES('run_observation','ws_example','task_observation','agent_research','runtime_observation',?,1,'active',1,1,?,?)",credential,now+60000,now);
  s.exec("UPDATE tasks SET state='doing',active_run_id='run_observation',latest_run_id='run_observation' WHERE id='task_observation'");
 });return f;
}
const domain=(s:DurableObjectStorage)=>Object.fromEntries(['tasks','runs','runtimes','events','task_history','idempotency_outcomes','outbox'].map(t=>[t,s.sql.exec('SELECT * FROM '+t).toArray()]));
it('native current owner establishes durable binding without any domain mutation',async()=>{
 const {stub}=await setup('observation-establish');const before=await runInDurableObject(stub,(_o,s)=>domain(s.storage));
 const response=await stub.fetch(request('/observations:establish',establish));expect(response.status).toBe(200);
 const first=await response.json() as any;expect(first.data).toMatchObject({kind:'current_binding',run_id:establish.run_id,fence:1,session_epoch:1,coverage:{completeness:'unknown',reported_loss:false}});expect(first.data.session_id).toMatch(/^obs_[a-f0-9]{48}$/);
 await evictDurableObject(stub);
 const second=await stub.fetch(request('/observations:establish',establish));expect(second.status).toBe(200);expect((await second.json() as any).data).toEqual(first.data);
 expect(await runInDurableObject(stub,(_o,s)=>domain(s.storage))).toEqual(before);
});
it('append exact latest replay and replacement replay preserve frozen receipts and successor highwater',async()=>{
 const {stub}=await setup('observation-replay');const binding=await stub.fetch(request('/observations:establish',establish));expect(binding.status).toBe(200);const sid=(await binding.json() as any).data.session_id;
 const batch={run_id:establish.run_id,fence:1,first_sequence:1,records:[record]};
 const first=await stub.fetch(request('/observation-sessions/'+sid+'/records',batch));expect(first.status).toBe(200);const receipt=(await first.json() as any).data;
 const replay=await stub.fetch(request('/observation-sessions/'+sid+'/records',batch));expect(replay.status).toBe(200);expect((await replay.json() as any).data).toEqual(receipt);
 expect((await stub.fetch(request('/observation-sessions/'+sid+'/records',{...batch,records:[{...record,label:'changed'}]}))).status).toBe(409);
 expect((await stub.fetch(request('/observation-sessions/'+sid+'/records',{...batch,first_sequence:3}))).status).toBe(409);
 const replacement={run_id:establish.run_id,fence:1,expected_session_id:sid,expected_high_water:1,replacement_request_id:'00000000-0000-4000-8000-000000000001',reason:'coverage_loss'};
 const replace=await stub.fetch(request('/observation-sessions:replace',replacement));expect(replace.status).toBe(200);const rr=(await replace.json() as any).data;
 expect((await stub.fetch(request('/observation-sessions/'+rr.new_session_id+'/records',batch))).status).toBe(200);
 const retry=await stub.fetch(request('/observation-sessions:replace',replacement));expect(retry.status).toBe(200);expect((await retry.json() as any).data).toEqual(rr);
 const status=await stub.fetch(request('/observation-sessions/'+rr.new_session_id+'/owner-status',undefined,{'x-runtime-token':proof}));expect(status.status).toBe(200);expect((await status.json() as any).data).toMatchObject({high_water:1,latest_replacement_receipt:rr});
 const read=await stub.fetch(request('/observations'));expect(read.status).toBe(200);const view=await read.json() as any;expect(view.data.records).toHaveLength(1);expect(JSON.stringify(view)).not.toContain('request_fingerprint');expect(JSON.stringify(view)).not.toContain('credential');
});
it('human write and missing proof fail closed; expired owner cannot replay',async()=>{
 const {stub}=await setup('observation-authority');
 expect((await stub.fetch(request('/observations:establish',establish,{'x-runtime-token':''}))).status).toBe(401);
 const first=await stub.fetch(request('/observations:establish',establish));expect(first.status).toBe(200);const sid=(await first.json() as any).data.session_id;
 await runInDurableObject(stub,async(_o,s)=>{human(s.storage);s.storage.sql.exec('UPDATE sessions SET token_digest=?',await sha256('A'.repeat(43)));});
 const humanWrite=request('/observations:establish',establish,{cookie:'cfhub_session='+'A'.repeat(43)});humanWrite.headers.delete('authorization');expect((await stub.fetch(humanWrite)).status).toBe(403);
 await runInDurableObject(stub,(_o,s)=>{s.storage.sql.exec('UPDATE runs SET lease_expires_at=?',Date.now()-1);});
 const before=await runInDurableObject(stub,(_o,s)=>({domain:domain(s.storage),slots:s.storage.sql.exec('SELECT * FROM observation_slots').toArray(),records:s.storage.sql.exec('SELECT * FROM observation_records').toArray()}));
 expect((await stub.fetch(request('/observation-sessions/'+sid+'/owner-status',undefined,{'x-runtime-token':proof}))).status).toBe(409);
 expect(await runInDurableObject(stub,(_o,s)=>({domain:domain(s.storage),slots:s.storage.sql.exec('SELECT * FROM observation_slots').toArray(),records:s.storage.sql.exec('SELECT * FROM observation_records').toArray()}))).toEqual(before);
 expect((await stub.fetch(request('/observations'))).status).toBe(200);
});
it('current scope denial precedes generation invalidation and leaves diagnostic state unchanged',async()=>{
 const {stub}=await setup('observation-deny-before-clear');const response=await stub.fetch(request('/observations:establish',establish));expect(response.status).toBe(200);await response.text();
 await runInDurableObject(stub,(_o,s)=>{s.storage.sql.exec("UPDATE observation_slots SET mapping_digest=?",'0'.repeat(64));s.storage.sql.exec("UPDATE native_credentials SET scopes_json='[]'");});
 const snapshot=()=>runInDurableObject(stub,(_o,s)=>({domain:domain(s.storage),slots:s.storage.sql.exec('SELECT * FROM observation_slots').toArray(),records:s.storage.sql.exec('SELECT * FROM observation_records').toArray()})),before=await snapshot();
 expect((await stub.fetch(request('/observations'))).status).toBe(403);expect(await snapshot()).toEqual(before);
 expect((await stub.fetch(request('/observations:establish',establish))).status).toBe(403);expect(await snapshot()).toEqual(before);
});
it('append accepts valid exactly32768-byte body but rejects +1 and duplicate JSON without writes',async()=>{
 const {stub}=await setup('observation-byte-bounds');const binding=await stub.fetch(request('/observations:establish',establish));expect(binding.status).toBe(200);const sid=(await binding.json() as any).data.session_id;
 const body={run_id:establish.run_id,fence:1,first_sequence:1,records:Array.from({length:22},()=>({...record,relative_path:'p',label:''}))};
 let remaining=32768-new TextEncoder().encode(JSON.stringify(body)).length;
 for(const r of body.records){const p=Math.min(1023,remaining);r.relative_path+='p'.repeat(p);remaining-=p;const label=Math.min(512,remaining);r.label='l'.repeat(label);remaining-=label;}
 expect(remaining).toBe(0);const text=JSON.stringify(body);expect(new TextEncoder().encode(text).length).toBe(32768);
 const raw=(value:string)=>new Request(base+'/observation-sessions/'+sid+'/records',{method:'POST',headers:{authorization:'Bearer '+bearer,'x-runtime-token':proof,'content-type':'application/json'},body:value});
 expect((await stub.fetch(raw(text+' '))).status).toBe(413);
 expect((await stub.fetch(raw(text.replace('"fence":1','"fence":1,"fence":1')))).status).toBe(413);
 expect((await stub.fetch(raw('{"run_id":"run_observation","fence":1,"fence":1,"first_sequence":1,"records":[]}'))).status).toBe(400);
 expect((await stub.fetch(raw(text))).status).toBe(200);
 expect(await runInDurableObject(stub,(_o,s)=>s.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM observation_records').one().n)).toBe(22);
});
it('four held diagnostic bodies do not block heartbeat; abort releases despite never-settling cancel',async()=>{
 const {stub,name}=await setup('observation-body-starvation');await runInDurableObject(stub,async(_o,state)=>{
  const workspace=owned(state.storage,name),controllers=Array.from({length:4},()=>new AbortController());
  const pending=controllers.map(controller=>observationRoutes(new Request(base+'/observations:establish',{method:'POST',headers:{authorization:'Bearer '+bearer,'x-runtime-token':proof,'content-type':'application/json'},body:new ReadableStream<Uint8Array>({pull(){return new Promise(()=>{});},cancel(){return new Promise(()=>{});}}),signal:controller.signal}),workspace));
  await new Promise(resolve=>setTimeout(resolve,30));
  expect((await observationRoutes(request('/observations:establish',establish),workspace)).status).toBe(429);
  const heartbeat=await taskRoutes(new Request('https://hub.example.invalid/v2/workspaces/ws_example/runs/run_observation:heartbeat',{method:'POST',headers:{authorization:'Bearer '+bearer,'x-runtime-token':proof,'content-type':'application/json','idempotency-key':'independent-heartbeat'},body:JSON.stringify({expected_run_version:1,fence:1})}),workspace);expect(heartbeat.status).toBe(200);
  for(const controller of controllers)controller.abort();
  const settled=await Promise.race([Promise.all(pending),new Promise<'not_released'>(resolve=>setTimeout(()=>resolve('not_released'),200))]);expect(settled).not.toBe('not_released');if(typeof settled!=='string')for(const response of settled)expect(response.status).toBe(503);
  expect((await observationRoutes(request('/observations:establish',establish),workspace)).status).toBe(200);
 });
},10000);
it('never-resolving body and cancellation callback obey fixed5000ms deadline without writing',async()=>{
 const {stub,name}=await setup('observation-body-deadline');await runInDurableObject(stub,async(_o,state)=>{
  const workspace=owned(state.storage,name),before=domain(state.storage),start=Date.now();
  const response=await observationRoutes(new Request(base+'/observations:establish',{method:'POST',headers:{authorization:'Bearer '+bearer,'x-runtime-token':proof,'content-type':'application/json'},body:new ReadableStream<Uint8Array>({pull(){return new Promise(()=>{});},cancel(){return new Promise(()=>{});}})}),workspace);
  expect(response.status).toBe(503);expect(Date.now()-start).toBeGreaterThanOrEqual(4900);expect(Date.now()-start).toBeLessThan(8000);expect(domain(state.storage)).toEqual(before);expect(state.storage.sql.exec('SELECT * FROM observation_slots').toArray()).toEqual([]);
  expect((await observationRoutes(request('/observations:establish',establish),workspace)).status).toBe(200);
 });
},10000);
it('held proof crypto stays accounted after timeout and late completion cannot establish',async()=>{
 const {stub,name}=await setup('observation-crypto-accounting');await runInDurableObject(stub,async(_o,state)=>{
  const workspace=owned(state.storage,name),original=crypto.subtle.digest.bind(crypto.subtle),settle:Array<()=>void>=[];let notify:()=>void=()=>{};const allHeld=new Promise<void>(resolve=>notify=resolve);
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{const value=await original(algorithm,data);if(new TextDecoder().decode(data)===proof)return new Promise<ArrayBuffer>(resolve=>{settle.push(()=>resolve(value));if(settle.length===4)notify();});return value;});
  try{
   const pending=Array.from({length:4},()=>observationRoutes(request('/observations:establish',establish),workspace));await allHeld;
   for(const response of await Promise.all(pending))expect(response.status).toBe(503);
   expect((await observationRoutes(request('/observations:establish',establish),workspace)).status).toBe(429);
   for(const resolve of settle)resolve();await Promise.resolve();await Promise.resolve();spy.mockRestore();
   expect(state.storage.sql.exec('SELECT * FROM observation_slots').toArray()).toEqual([]);
   expect((await observationRoutes(request('/observations:establish',establish),workspace)).status).toBe(200);
  }finally{spy.mockRestore();for(const resolve of settle)resolve();}
 });
},12000);
it('historical read intersects captured and current project visibility without hidden binding leakage',async()=>{
 const {stub}=await setup('observation-project-privacy');
 await runInDurableObject(stub,(_o,s)=>{s.storage.sql.exec("UPDATE tasks SET project_id='project_a',work_role_id='role_a'");const row=s.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one(),c=JSON.parse(row.config_json);c.workspace_policies[0].execution_policy.eligibility_rules.push({project_id:'project_b',work_role_id:'role_a',eligible_agent_ids:['agent_research']});s.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',canonicalJson(c));});
 // Live execution also requires real configured profile references.
 await runInDurableObject(stub,(_o,s)=>taskProfile(s.storage));
 const first=await stub.fetch(request('/observations:establish',establish));expect(first.status).toBe(200);const sid=(await first.json() as any).data.session_id;
 expect((await stub.fetch(request('/observation-sessions/'+sid+'/records',{run_id:establish.run_id,fence:1,first_sequence:1,records:[{...record,relative_path:'private/old-project.txt'}]}))).status).toBe(200);
 await runInDurableObject(stub,(_o,s)=>{s.storage.sql.exec("UPDATE tasks SET project_id='project_b'");s.storage.sql.exec("UPDATE native_credentials SET project_ids_json='[\"project_b\"]'");});
 for(const suffix of ['/observations','/observations?expected_session_id='+sid]){const response=await stub.fetch(request(suffix));expect(response.status).toBe(200);const text=await response.text();expect(text).not.toContain(sid);expect(text).not.toContain('private/');expect(JSON.parse(text)).toMatchObject({data:{status:'no_retained_data',binding:null,coverage:null,retained_range:null,truncated:false,records:[]},page:{next_cursor:null,has_more:false}});}
 await runInDurableObject(stub,(_o,s)=>{s.storage.sql.exec("UPDATE native_credentials SET project_ids_json='[\"project_a\",\"project_b\"]'");});
 const visible=await stub.fetch(request('/observations'));expect(visible.status).toBe(200);expect((await visible.json() as any).data.records).toHaveLength(1);
});
it('cursor pins session and highwater; consumed eviction is disclosed but unread eviction conflicts',async()=>{
 const {stub}=await setup('observation-cursor-retention');const first=await stub.fetch(request('/observations:establish',establish));expect(first.status).toBe(200);const sid=(await first.json() as any).data.session_id;
 let sequence=1;const append=async(n:number)=>{while(n>0){const count=Math.min(n,32),r=await stub.fetch(request('/observation-sessions/'+sid+'/records',{run_id:establish.run_id,fence:1,first_sequence:sequence,records:Array.from({length:count},()=>record)}));expect(r.status).toBe(200);await r.text();n-=count;sequence+=count;}};
 await append(256);const page=await stub.fetch(request('/observations?limit=50'));expect(page.status).toBe(200);const initial=await page.json() as any;expect(initial.page.next_cursor).toHaveLength(2048);expect(initial.data.records[49].sequence).toBe(50);
 await append(32);const continued=await stub.fetch(request('/observations?limit=50&expected_session_id='+sid+'&cursor='+initial.page.next_cursor));expect(continued.status).toBe(200);const next=await continued.json() as any;expect(next.data.records[0].sequence).toBe(51);expect(next.data.retained_range.last_sequence).toBe(256);expect(next.data.truncated).toBe(true);
 await append(256);const evicted=await stub.fetch(request('/observations?limit=50&expected_session_id='+sid+'&cursor='+initial.page.next_cursor));expect(evicted.status).toBe(409);expect(await evicted.json()).not.toHaveProperty('data');
 await runInDurableObject(stub,(_o,s)=>{expect(s.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM observation_records').one().n).toBe(256);withTransaction(s.storage,assertObservationGraph);});
});
it('cursor encryption cannot publish after current grant revocation or session replacement',async()=>{
 for(const mutation of ['scope','replace'] as const){const {stub,name}=await setup('observation-read-race-'+mutation);await runInDurableObject(stub,async(_o,state)=>{
  const workspace={...owned(state.storage,name),secrets:{CURSOR_ENCRYPTION_KEY:'f'.repeat(64)}},first=await observationRoutes(request('/observations:establish',establish),workspace);expect(first.status).toBe(200);const sid=(await first.json() as any).data.session_id;
  expect((await observationRoutes(request('/observation-sessions/'+sid+'/records',{run_id:establish.run_id,fence:1,first_sequence:1,records:[record,record]}),workspace)).status).toBe(200);
  const original=crypto.subtle.encrypt.bind(crypto.subtle);let intercepted=0;
  const spy=vi.spyOn(crypto.subtle,'encrypt').mockImplementation(async(...args)=>{const result=await original(...args);if(intercepted++===0){if(mutation==='scope')state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[]'");else{const r=await observationRoutes(request('/observation-sessions:replace',{run_id:establish.run_id,fence:1,expected_session_id:sid,expected_high_water:2,replacement_request_id:'00000000-0000-4000-8000-000000000002',reason:'coverage_loss'}),workspace);expect(r.status).toBe(200);}}return result;});
  try{const response=await observationRoutes(request('/observations?limit=1'),workspace);expect(intercepted).toBe(1);expect(response.status).toBe(mutation==='scope'?403:503);expect(await response.json()).not.toHaveProperty('data');}finally{spy.mockRestore();}
 });}
});
it.each(['scope','lease','fence','runtime','epoch','generation'] as const)('append rechecks current %s after fingerprint crypto with no diagnostic or domain side effects',async mutation=>{
 const {stub,name}=await setup('observation-append-race-'+mutation);await runInDurableObject(stub,async(_o,state)=>{
  const workspace=owned(state.storage,name),first=await observationRoutes(request('/observations:establish',establish),workspace);expect(first.status).toBe(200);const sid=(await first.json() as any).data.session_id;
  const snapshot=()=>({domain:domain(state.storage),slots:state.storage.sql.exec('SELECT * FROM observation_slots').toArray(),records:state.storage.sql.exec('SELECT * FROM observation_records').toArray()}),original=crypto.subtle.digest.bind(crypto.subtle);let changed:any,intercepted=0;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{const result=await original(algorithm,data);if(new TextDecoder().decode(data).includes('"method":"POST"')){intercepted++;if(mutation==='scope')state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[]'");if(mutation==='lease')state.storage.sql.exec('UPDATE runs SET lease_expires_at=?',Date.now()-1);if(mutation==='fence')state.storage.sql.exec('UPDATE runs SET fence=2');if(mutation==='runtime')state.storage.sql.exec("UPDATE runtimes SET status='expired'");if(mutation==='epoch')state.storage.sql.exec('UPDATE workspace_metadata SET config_epoch=2');if(mutation==='generation')state.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1');changed=snapshot();}return result;});
  try{const response=await observationRoutes(request('/observation-sessions/'+sid+'/records',{run_id:establish.run_id,fence:1,first_sequence:1,records:[record]}),workspace);expect(intercepted).toBe(1);expect([401,403,409]).toContain(response.status);expect(snapshot()).toEqual(changed);}finally{spy.mockRestore();}
 });
});
it('restore graph rejects oversized row cardinality before bulk row materialization',async()=>{
 const {stub}=await setup('observation-graph-preflight');const first=await stub.fetch(request('/observations:establish',establish));expect(first.status).toBe(200);const sid=(await first.json() as any).data.session_id;
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  const text=canonicalJson(record);for(let i=1;i<=513;i++)tx.exec('INSERT INTO observation_records VALUES (?,?,?,?,?,?)',[sid,i,i,Date.now(),text,new TextEncoder().encode(text).length]);
  let bulk=0;const traced={...tx,all:<T>(sql:string,bindings?:readonly import('../../src/storage/transaction').SqlValue[])=>{bulk++;return tx.all<T>(sql,bindings);}};
  expect(()=>assertObservationGraph(traced)).toThrow();expect(bulk).toBe(0);
 }));
});
it('corrupt public metadata cannot turn an opaque repository token into a private filesystem root',async()=>{
 const {stub}=await setup('observation-metadata-root');const first=await stub.fetch(request('/observations:establish',establish));expect(first.status).toBe(200);await first.text();
 await runInDurableObject(stub,(_o,state)=>{const row=state.storage.sql.exec<{metadata_json:string}>('SELECT metadata_json FROM observation_slots').one(),m=JSON.parse(row.metadata_json);m.repository_id='/home/private/repo';const text=canonicalJson(m);state.storage.sql.exec('UPDATE observation_slots SET metadata_json=?,metadata_bytes=?',text,new TextEncoder().encode(text).length);});
 const response=await stub.fetch(request('/observations'));expect(response.status).toBe(503);expect(await response.text()).not.toContain('/home/private');
});
it('full stored metadata projection accepts exactly16384 bytes and rejects +1 without partial slot',async()=>{
 const {stub}=await setup('observation-metadata-cap');const first=await stub.fetch(request('/observations:establish',establish));expect(first.status).toBe(200);await first.text();
 const initial=await runInDurableObject(stub,(_o,s)=>s.storage.sql.exec<import('../../src/observations/repository').ObservationSlotRow & Record<string,SqlStorageValue>>('SELECT * FROM observation_slots').one());
 const taskId='task_observation'+'x'.repeat(16384-observationSlotBytes(initial));
 async function rename(from:string,to:string){await runInDurableObject(stub,(_o,s)=>withTransaction(s.storage,tx=>{tx.exec('PRAGMA defer_foreign_keys=ON');tx.exec('DELETE FROM observation_records');tx.exec('DELETE FROM observation_slots');tx.exec('UPDATE tasks SET id=? WHERE id=?',[to,from]);tx.exec('UPDATE runs SET task_id=? WHERE task_id=?',[to,from]);}));}
 await rename('task_observation',taskId);
 const target=(id:string)=>new Request('https://hub.example.invalid/v2/workspaces/ws_example/tasks/'+id+'/observations:establish',{method:'POST',headers:{authorization:'Bearer '+bearer,'x-runtime-token':proof,'content-type':'application/json'},body:JSON.stringify(establish)});
 expect((await stub.fetch(target(taskId))).status).toBe(200);
 await runInDurableObject(stub,(_o,s)=>{const row=s.storage.sql.exec<import('../../src/observations/repository').ObservationSlotRow & Record<string,SqlStorageValue>>('SELECT * FROM observation_slots').one();expect(observationSlotBytes(row)).toBe(16384);withTransaction(s.storage,assertObservationGraph);});
 await rename(taskId,taskId+'x');expect((await stub.fetch(target(taskId+'x'))).status).toBe(409);expect(await runInDurableObject(stub,(_o,s)=>s.storage.sql.exec('SELECT * FROM observation_slots').toArray())).toEqual([]);
});
it('large accepted records are evicted by exact stored bytes and private ingest order despite clock rollback',async()=>{
 const {stub,name}=await setup('observation-stored-byte-cap');await runInDurableObject(stub,async(_o,state)=>{
  let now=Date.now();const workspace={...owned(state.storage,name),clock:{nowMs:()=>now}};const first=await observationRoutes(request('/observations:establish',establish),workspace);expect(first.status).toBe(200);const sid=(await first.json() as any).data.session_id;
  const large={...record,relative_path:'p'.repeat(1024),label:'l'.repeat(512)};let sequence=1;
  for(let i=0;i<18;i++){now-=1;const response=await observationRoutes(request('/observation-sessions/'+sid+'/records',{run_id:establish.run_id,fence:1,first_sequence:sequence,records:Array.from({length:16},()=>large)}),workspace);expect(response.status).toBe(200);await response.text();sequence+=16;}
  const slots=state.storage.sql.exec<import('../../src/observations/repository').ObservationSlotRow & Record<string,SqlStorageValue>>('SELECT * FROM observation_slots').toArray(),rows=state.storage.sql.exec<import('../../src/observations/repository').ObservationRecordRow & Record<string,SqlStorageValue>>('SELECT * FROM observation_records ORDER BY sequence').toArray();expect(rows.length).toBeLessThan(256);expect(rows.at(-1)!.sequence).toBe(288);expect(rows.every((r,i)=>i===0||r.ingest_order>rows[i-1].ingest_order&&r.received_at<=rows[i-1].received_at)).toBe(true);expect(slots.reduce((n,s)=>n+observationSlotBytes(s),0)+rows.reduce((n,r)=>n+observationRecordBytes(r),0)).toBeLessThanOrEqual(262144);withTransaction(state.storage,assertObservationGraph);
 });
});
it('sequence, epoch and ingest-order overflow reject the whole batch/replacement before mutation',async()=>{
 for(const field of ['high_water','session_epoch','ingest_order'] as const){const {stub}=await setup('observation-overflow-'+field);const first=await stub.fetch(request('/observations:establish',establish));expect(first.status).toBe(200);const sid=(await first.json() as any).data.session_id;
  if(field==='ingest_order'){expect((await stub.fetch(request('/observation-sessions/'+sid+'/records',{run_id:establish.run_id,fence:1,first_sequence:1,records:[record]}))).status).toBe(200);}
  await runInDurableObject(stub,(_o,s)=>{s.storage.sql.exec(field==='ingest_order'?'UPDATE observation_records SET ingest_order=?':'UPDATE observation_slots SET '+field+'=?',Number.MAX_SAFE_INTEGER);});
  const snapshot=()=>runInDurableObject(stub,(_o,s)=>({slots:s.storage.sql.exec('SELECT * FROM observation_slots').toArray(),records:s.storage.sql.exec('SELECT * FROM observation_records').toArray(),domain:domain(s.storage)})),before=await snapshot();
  const response=field==='session_epoch'?await stub.fetch(request('/observation-sessions:replace',{run_id:establish.run_id,fence:1,expected_session_id:sid,expected_high_water:0,replacement_request_id:'00000000-0000-4000-8000-000000000003',reason:'coverage_loss'})):await stub.fetch(request('/observation-sessions/'+sid+'/records',{run_id:establish.run_id,fence:1,first_sequence:field==='high_water'?Number.MAX_SAFE_INTEGER:2,records:[record,record]}));
  expect(response.status).toBe(409);expect(await snapshot()).toEqual(before);
 }
});
it('record count, UTF8 fields, canonical paths, timestamps and configured coverage are closed at exact boundaries',async()=>{
 const {stub}=await setup('observation-record-validation');const first=await stub.fetch(request('/observations:establish',establish));expect(first.status).toBe(200);const sid=(await first.json() as any).data.session_id;
 const body=(records:unknown[],first_sequence=1)=>({run_id:establish.run_id,fence:1,first_sequence,records});
 const valid={...record,relative_path:'😀'.repeat(256),label:'😀'.repeat(128),source_oid:'a'.repeat(64)};
 expect((await stub.fetch(request('/observation-sessions/'+sid+'/records',body(Array.from({length:32},()=>record))))).status).toBe(200);
 expect((await stub.fetch(request('/observation-sessions/'+sid+'/records',body([valid],33)))).status).toBe(200);
 const snapshot=()=>runInDurableObject(stub,(_o,s)=>({slots:s.storage.sql.exec('SELECT * FROM observation_slots').toArray(),records:s.storage.sql.exec('SELECT * FROM observation_records').toArray(),domain:domain(s.storage)})),before=await snapshot();
 const invalid=[...['/absolute','trailing/','a//b','a/./b','a/../b','a\\b','a\0b','C:relative'].map(relative_path=>({...record,relative_path})),{...valid,relative_path:valid.relative_path+'x'},{...valid,label:valid.label+'x'},{...record,activity:'test-finished'},{...record,source_oid:'A'.repeat(40)},{...record,observed_at:'2026-02-30T00:00:00Z'},{...record,observed_at:'2026-11-01T00:00:00+00:00'},{...record,extra:'forged'}];
 for(const r of invalid)expect((await stub.fetch(request('/observation-sessions/'+sid+'/records',body([r],34)))).status).toBe(400);
 expect((await stub.fetch(request('/observation-sessions/'+sid+'/records',body(Array.from({length:33},()=>record),34)))).status).toBe(400);expect(await snapshot()).toEqual(before);
 for(const q of ['?limit=51','?limit=1&limit=2','?cursor='+'a'.repeat(2048),'?expected_session_id=x','?unknown=true'])expect((await stub.fetch(request('/observations'+q))).status).toBe(400);
});
it('finite read-attempt preflight cancels an under-byte fragmented stream rather than starving forever',async()=>{
 const {stub,name}=await setup('observation-stream-attempts');await runInDurableObject(stub,async(_o,state)=>{
  let cancelled=false;const response=await observationRoutes(new Request(base+'/observations:establish',{method:'POST',headers:{authorization:'Bearer '+bearer,'x-runtime-token':proof,'content-type':'application/json'},body:new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<1025;i++)controller.enqueue(new Uint8Array());},cancel(){cancelled=true;}})}),owned(state.storage,name));expect(response.status).toBe(413);expect(cancelled).toBe(true);expect(state.storage.sql.exec('SELECT * FROM observation_slots').toArray()).toEqual([]);
 });
});
it('oversized existing human identity binding returns bounded LIMIT_EXCEEDED, not a larger cursor or identifier truncation',async()=>{
 const {stub}=await setup('observation-cursor-binding-size');const first=await stub.fetch(request('/observations:establish',establish));expect(first.status).toBe(200);const sid=(await first.json() as any).data.session_id;expect((await stub.fetch(request('/observation-sessions/'+sid+'/records',{run_id:establish.run_id,fence:1,first_sequence:1,records:[record,record]}))).status).toBe(200);
 await runInDurableObject(stub,async(_o,s)=>{human(s.storage);s.storage.sql.exec('UPDATE sessions SET id=?,token_digest=?','session_'+'x'.repeat(2000),await sha256('A'.repeat(43)));});
 const response=await stub.fetch(new Request(base+'/observations?limit=1',{headers:{cookie:'cfhub_session='+'A'.repeat(43)}}));expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'LIMIT_EXCEEDED'}});
});
it('two configured slots isolate exact owner proof while retaining authorized human/native history',async()=>{
 const {stub}=await setup('observation-two-slots'),secondBearer=btoa('s'.repeat(32)).replace(/=+$/,''),secondProof=btoa('q'.repeat(32)).replace(/=+$/,''),tokenHash=await sha256(secondBearer),proofHash=await sha256(secondProof);
 await runInDurableObject(stub,(_o,state)=>{const s=state.storage.sql,now=Date.now(),row=s.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one(),c=JSON.parse(row.config_json);c.workspace_policies[0].execution_policy.eligibility_rules[0].eligible_agent_ids.push('agent_second');s.exec('UPDATE workspace_metadata SET config_json=?',canonicalJson(c));
  s.exec("INSERT INTO static_agents(agent_id,workspace_id,display_name,config_epoch) VALUES('agent_second','ws_example','Second synthetic',1)");
  s.exec("INSERT INTO native_credentials(credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch) SELECT 'credential_second',workspace_id,'agent_second',?,scopes_json,project_ids_json,expires_at,enabled,config_epoch,NULL FROM native_credentials WHERE agent_id='agent_research'",tokenHash);
  s.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES('runtime_second','ws_example','agent_second','credential_second',1,?,1,'Second synthetic','online',?,?,?)",proofHash,now,now,now+3600000);
  s.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,assigned_agent_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES('task_second','ws_example','Second synthetic','','ready',1,0,'agent_second',0,2,'[]',?,?)",now,now);
  s.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at) VALUES('run_second','ws_example','task_second','agent_second','runtime_second','credential_second',1,'active',1,1,?,?)",now+60000,now);s.exec("UPDATE tasks SET state='doing',active_run_id='run_second',latest_run_id='run_second' WHERE id='task_second'");
 });
 const second=(suffix:string,body?:unknown,headers:Record<string,string>={})=>{const r=request(suffix,body,{authorization:'Bearer '+secondBearer,'x-runtime-token':secondProof,...headers});return new Request(r.url.replace('/task_observation/','/task_second/'),r);};
 const a=await stub.fetch(request('/observations:establish',establish)),b=await stub.fetch(second('/observations:establish',{...establish,run_id:'run_second'}));expect(a.status).toBe(200);expect(b.status).toBe(200);const sidA=(await a.json() as any).data.session_id,sidB=(await b.json() as any).data.session_id;expect(sidA).not.toBe(sidB);
 expect((await stub.fetch(second('/observation-sessions/'+sidB+'/records',{run_id:'run_second',fence:1,first_sequence:1,records:[record]}))).status).toBe(200);
 const foreign=second('/observation-sessions/'+sidB+'/owner-status',undefined,{authorization:'Bearer '+bearer,'x-runtime-token':proof});expect((await stub.fetch(foreign)).status).toBe(403);
 expect((await stub.fetch(second('/observation-sessions/'+sidB+'/owner-status',undefined,{'x-runtime-token':proof}))).status).toBe(401);
 const historical=second('/observations',undefined,{authorization:'Bearer '+bearer});expect((await stub.fetch(historical)).status).toBe(200);
 await runInDurableObject(stub,async(_o,s)=>{expect(s.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM observation_slots').one().n).toBe(2);withTransaction(s.storage,assertObservationGraph);human(s.storage);s.storage.sql.exec('UPDATE sessions SET token_digest=?',await sha256('A'.repeat(43)));});
 const humanRead=await stub.fetch(new Request(base.replace('/task_observation','/task_second')+'/observations',{headers:{cookie:'cfhub_session='+'A'.repeat(43)}}));expect(humanRead.status).toBe(200);expect((await humanRead.json() as any).data.records).toHaveLength(1);
});
it('configuration epoch change atomically invalidates diagnostics; failed install rolls back before old sessions can revive',async()=>{
 const f=await setup('observation-config-invalidation'),first=await f.stub.fetch(request('/observations:establish',establish));expect(first.status).toBe(200);const sid=(await first.json() as any).data.session_id;const append=await f.stub.fetch(request('/observation-sessions/'+sid+'/records',{run_id:establish.run_id,fence:1,first_sequence:1,records:[record]}));expect(append.status).toBe(200);await append.text();
 const config=structuredClone(f.input.config);config.config_epoch=2;config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_second',display_name:'Second synthetic'});config.workspace_policies[0].observation_pilot=pilot as any;
 const bundle=structuredClone(f.input.bundle);bundle.config_epoch=2;bundle.config_digest=await sha256(canonicalJson(config));bundle.credentials[0].token_sha256=await sha256(bearer);
 const bad=structuredClone(bundle);bad.credentials[0].token_sha256='0'.repeat(64);const rejected=await prepareBootstrap(config,bad,'ws_example');
 const snapshot=()=>runInDurableObject(f.stub,(_o,s)=>({slots:s.storage.sql.exec('SELECT * FROM observation_slots').toArray(),records:s.storage.sql.exec('SELECT * FROM observation_records').toArray()})),before=await snapshot();
 expect(await runInDurableObject(f.stub,async object=>{try{await object.reconcileConfiguration(operator(1,f.input.installationDigest),rejected);return 'unexpected';}catch{return 'rejected';}})).toBe('rejected');expect(await snapshot()).toEqual(before);
 await f.stub.reconcileConfiguration(operator(1,f.input.installationDigest),await prepareBootstrap(config,bundle,'ws_example'));expect(await snapshot()).toEqual({slots:[],records:[]});
 await evictDurableObject(f.stub);expect((await f.stub.fetch(request('/observation-sessions/'+sid+'/owner-status',undefined,{'x-runtime-token':proof}))).status).toBe(403);expect((await f.stub.fetch(request('/observations:establish',establish))).status).toBe(401);
});
