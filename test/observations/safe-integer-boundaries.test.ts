import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {taskFixture} from '../helpers/tasks';
import {sha256,canonicalJson} from '../../src/config/bootstrap';
import {withTransaction} from '../../src/storage/transaction';
import {assertObservationGraph,observationSlots,observationMetadata,storeObservationSlot} from '../../src/observations/repository';
import type {ObservationBatchReceipt,ObservationBatchRequest} from '../../src/http/dto';

const MAX=Number.MAX_SAFE_INTEGER;
const bearer=btoa('n'.repeat(32)).replace(/=+$/,''),proof=btoa('i'.repeat(32)).replace(/=+$/,'');
const base='https://hub.example.invalid/v2/workspaces/ws_example/tasks/task_numeric';
const reported={observed_at:'2026-11-01T00:00:00Z',relative_path:'src/synthetic-boundary.ts',activity:'read-observed' as const,source_oid:null};
const pilot={enabled:true,repository_id:'synthetic_numeric',adapter_id:'synthetic-boundary',adapter_version:'1',supported_events:['read-observed'],slots:[{agent_id:'agent_research',checkout_slot_id:'numeric_a'},{agent_id:'agent_second',checkout_slot_id:'numeric_b'}]};
function request(suffix:string,body:unknown){return new Request(base+suffix,{method:'POST',headers:{authorization:'Bearer '+bearer,'x-runtime-token':proof,'content-type':'application/json'},body:JSON.stringify(body)});}
function sqlSnapshot(storage:DurableObjectStorage):Record<string,Record<string,SqlStorageValue>[]>{
 return {...Object.fromEntries(storage.sql.exec<{name:string}>("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").toArray().map(({name})=>[name,storage.sql.exec('SELECT * FROM "'+name.replaceAll('"','""')+'"').toArray().sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)))])),$schema:storage.sql.exec('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').toArray()};
}
async function boundaryFixture(name:string,highWater:number,priorIngest=1,epoch=1){
 const f=await taskFixture(name),digest=await sha256(bearer),proofHash=await sha256(proof);
 await runInDurableObject(f.stub,(_o,state)=>{
  const s=state.storage.sql,now=Date.now(),config=JSON.parse(s.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one().config_json);
  config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_second',display_name:'Second synthetic'});config.workspace_policies[0].observation_pilot=pilot;s.exec('UPDATE workspace_metadata SET config_json=?',canonicalJson(config));s.exec('UPDATE native_credentials SET token_sha256=?',digest);
  const credential=s.exec<{credential_id:string}>('SELECT credential_id FROM native_credentials').one().credential_id;
  s.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES('runtime_numeric','ws_example','agent_research',?,1,?,1,'Synthetic numeric boundary','online',?,?,?)",credential,proofHash,now,now,now+3600000);
  s.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,assigned_agent_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES('task_numeric','ws_example','Synthetic numeric boundary','','ready',1,0,'agent_research',0,2,'[]',?,?)",now,now);
  s.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at) VALUES('run_numeric','ws_example','task_numeric','agent_research','runtime_numeric',?,1,'active',1,1,?,?)",credential,now+60000,now);
  s.exec("UPDATE tasks SET state='doing',active_run_id='run_numeric',latest_run_id='run_numeric' WHERE id='task_numeric'");
 });
 const established=await f.stub.fetch(request('/observations:establish',{run_id:'run_numeric',fence:1,adapter_id:pilot.adapter_id,adapter_version:pilot.adapter_version}));expect(established.status).toBe(200);const sessionId=(await established.json() as {data:{session_id:string}}).data.session_id;
 const suffix='/observation-sessions/'+sessionId+'/records',seedBody:ObservationBatchRequest={run_id:'run_numeric',fence:1,first_sequence:1,records:[reported]};
 const seed=await f.stub.fetch(request(suffix,seedBody));expect(seed.status).toBe(200);const receipt=(await seed.json() as {data:ObservationBatchReceipt}).data;
 const fingerprint=await sha256(canonicalJson({method:'POST',path:new URL(base+suffix).pathname,sessionId,body:{...seedBody,first_sequence:highWater}}));
 // Clearly synthetic boundary seed: retain one valid suffix row/receipt near MAX.
 // This does not claim quadrillions of real observations were ingested. Structural
 // graph validation proves the seed satisfies the same SQL/metadata invariants.
 await runInDurableObject(f.stub,(_o,state)=>withTransaction(state.storage,tx=>{
  const row=observationSlots(tx)[0],metadata=observationMetadata(row);row.high_water=highWater;row.session_epoch=epoch;
  metadata.latest_batch_receipt={...receipt,first_sequence:highWater,last_sequence:highWater,request_fingerprint:fingerprint};metadata.retained_range={first_sequence:highWater,last_sequence:highWater};metadata.truncated=highWater>1;
  tx.exec('UPDATE observation_records SET sequence=?,ingest_order=? WHERE session_id=?',[highWater,priorIngest,sessionId]);storeObservationSlot(tx,row,metadata);assertObservationGraph(tx);
 }));
 return {...f,sessionId,suffix,batch:(firstSequence:number,count:number):ObservationBatchRequest=>({run_id:'run_numeric',fence:1,first_sequence:firstSequence,records:Array.from({length:count},()=>reported)})};
}

it('MAX sequence plus two records rejects LIMIT_EXCEEDED with the entire SQL snapshot unchanged',async()=>{
 const f=await boundaryFixture('numeric-sequence-max-two',MAX-1),before=await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage));
 const response=await f.stub.fetch(request(f.suffix,f.batch(MAX,2))),body=await response.json();
 expect(await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage))).toEqual(before);
 expect({status:response.status,body}).toMatchObject({status:409,body:{error:{code:'LIMIT_EXCEEDED'}}});
});
it.each([{first:MAX,count:1},{first:MAX-1,count:2}])('valid sequence suffix first=$first count=$count reaches exact MAX without rounding',async({first,count})=>{
 const f=await boundaryFixture('numeric-sequence-positive-'+count,first-1),body=f.batch(first,count),before=await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage)),response=await f.stub.fetch(request(f.suffix,body));expect(response.status).toBe(200);const receipt=(await response.json() as {data:ObservationBatchReceipt}).data;expect(receipt).toMatchObject({first_sequence:first,last_sequence:MAX,record_count:count});
 const committed=await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage));for(const [table,rows] of Object.entries(before))if(!['observation_slots','observation_records'].includes(table))expect(committed[table],table+' remains unchanged').toEqual(rows);
 const replay=await f.stub.fetch(request(f.suffix,body));expect(replay.status).toBe(200);expect((await replay.json() as {data:ObservationBatchReceipt}).data).toEqual(receipt);expect(await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage))).toEqual(committed);
 await runInDurableObject(f.stub,(_o,s)=>withTransaction(s.storage,tx=>{assertObservationGraph(tx);expect(observationSlots(tx)[0].high_water).toBe(MAX);}));
});
it.each([{prior:MAX-1,count:2},{prior:MAX,count:1}])('ingest prior=$prior count=$count rejects before SQL mutation',async({prior,count})=>{
 const f=await boundaryFixture('numeric-ingest-reject-'+count,1,prior),before=await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage)),response=await f.stub.fetch(request(f.suffix,f.batch(2,count))),body=await response.json();
 expect(await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage))).toEqual(before);expect({status:response.status,body}).toMatchObject({status:409,body:{error:{code:'LIMIT_EXCEEDED'}}});
});
it.each([{prior:MAX-1,count:1},{prior:MAX-2,count:2}])('valid ingest prior=$prior count=$count reaches exact MAX',async({prior,count})=>{
 const f=await boundaryFixture('numeric-ingest-positive-'+count,1,prior),body=f.batch(2,count),response=await f.stub.fetch(request(f.suffix,body));expect(response.status).toBe(200);const receipt=(await response.json() as {data:ObservationBatchReceipt}).data;expect(receipt).toMatchObject({first_sequence:2,last_sequence:1+count,record_count:count});
 const committed=await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage)),replay=await f.stub.fetch(request(f.suffix,body));expect(replay.status).toBe(200);expect((await replay.json() as {data:ObservationBatchReceipt}).data).toEqual(receipt);expect(await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage))).toEqual(committed);
 await runInDurableObject(f.stub,(_o,s)=>withTransaction(s.storage,tx=>{assertObservationGraph(tx);expect(tx.one<{last:number}>('SELECT MAX(ingest_order) AS last FROM observation_records')!.last).toBe(MAX);expect(observationSlots(tx)[0].high_water).toBe(1+count);}));
});
it('exhausted MAX highwater rejects a nonreplay append as LIMIT_EXCEEDED without touching history',async()=>{
 const f=await boundaryFixture('numeric-sequence-exhausted',MAX),before=await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage)),response=await f.stub.fetch(request(f.suffix,f.batch(MAX-1,1))),body=await response.json();
 expect(await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage))).toEqual(before);expect({status:response.status,body}).toMatchObject({status:409,body:{error:{code:'LIMIT_EXCEEDED'}}});
});
it('MAX session epoch replacement already rejects without deleting retained history',async()=>{
 const f=await boundaryFixture('numeric-epoch-max',1,1,MAX),before=await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage));
 const response=await f.stub.fetch(request('/observation-sessions:replace',{run_id:'run_numeric',fence:1,expected_session_id:f.sessionId,expected_high_water:1,replacement_request_id:'00000000-0000-4000-8000-000000000009',reason:'coverage_loss'}));expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'LIMIT_EXCEEDED'}});expect(await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage))).toEqual(before);
});

it('malformed REAL ingest counter preserves the preexisting integer rejection without SQL effects',async()=>{
 const f=await boundaryFixture('numeric-ingest-real-corruption',1);
 // Deliberately corrupt an otherwise graph-valid synthetic fixture AFTER seeding.
 // SQLite INTEGER affinity alone permits REAL1.5; this is not ordinary input or
 // a valid restore graph, and must not relax the earlier integer-counter guard.
 await runInDurableObject(f.stub,(_o,s)=>{
  s.storage.sql.exec('UPDATE observation_records SET ingest_order=1.5');
  expect(s.storage.sql.exec('SELECT ingest_order,typeof(ingest_order) AS storage_type FROM observation_records').one()).toEqual({ingest_order:1.5,storage_type:'real'});
  expect(()=>withTransaction(s.storage,assertObservationGraph)).toThrow();
 });
 const before=await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage)),response=await f.stub.fetch(request(f.suffix,f.batch(2,1))),body=await response.json(),after=await runInDurableObject(f.stub,(_o,s)=>sqlSnapshot(s.storage));
 expect({status:response.status,body,unchanged:canonicalJson(after)===canonicalJson(before)}).toMatchObject({status:409,body:{error:{code:'LIMIT_EXCEEDED'}},unchanged:true});expect(after).toEqual(before);
});
