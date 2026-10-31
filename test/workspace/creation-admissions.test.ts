import {cleanupCompletedOutcomes} from '../../src/workspace/idempotency';
import {it,expect,vi} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {taskFixture} from '../helpers/tasks';
import {owned,human} from '../helpers/settings';
import {sha256} from '../../src/config/bootstrap';
import {csrfToken} from '../../src/auth/csrf';
import {withTransaction} from '../../src/storage/transaction';
import type {SessionRecord} from '../../src/auth/authorize';
const origin='https://hub.example.invalid',cookie='C'.repeat(43);
const bodies={messages:{body:'Exact admission',recipient_agent_ids:['agent_research'],refs:[],artifact_ids:[]},tasks:{title:'Exact admission',description:'Original'}};
async function session(storage:DurableObjectStorage,name:string){
 const identity=human(storage);if(identity.kind!=='human')throw Error('Expected human fixture');const workspace={...owned(storage,name),secrets:env as unknown as Record<string,unknown>};
 storage.sql.exec('UPDATE sessions SET token_digest=? WHERE id=?',await sha256(cookie),identity.sessionId);
 const row=withTransaction(storage,tx=>tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=?',[identity.sessionId])!);return {workspace,csrf:await csrfToken(workspace,row)};
}
function request(collection:keyof typeof bodies,csrf:string,suffix=':prepare',key='original',body:unknown=bodies[collection],extra:Record<string,string>={}){return new Request(origin+'/v2/workspaces/ws_example/'+collection+suffix,{method:'POST',headers:{'content-type':'application/json',origin,cookie:'cfhub_session='+cookie,'x-csrf-token':csrf,'idempotency-key':key,...extra},body:JSON.stringify(body)});}
it.each(['messages','tasks'] as const)('prepares %s exact admission without domain effects and repeats without renewal',async collection=>{
 const f=await taskFixture('admission-prepare-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name),counts=()=>Object.fromEntries(['messages','tasks','events','outbox','idempotency_outcomes'].map(table=>[table,state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM '+table).one().n]));
  const before=counts(),response=await object.fetch(request(collection,csrf));expect(response.status).toBe(200);
  const first=(await response.json() as {data:{admission_id:string;expires_at:string}}).data;
  expect(first.admission_id).toMatch(/^event_[a-f0-9]{48}$/);expect(Number.isFinite(Date.parse(first.expires_at))).toBe(true);expect(counts()).toEqual(before);
  const retry=await object.fetch(request(collection,csrf));expect(retry.status).toBe(200);expect((await retry.json() as {data:unknown}).data).toEqual(first);expect(counts()).toEqual(before);
 });
});
it.each(['messages','tasks'] as const)('missing %s admission handle cannot execute creation',async collection=>{
 const f=await taskFixture('admission-missing-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name);
  const r=await object.fetch(request(collection,csrf,'','original',bodies[collection],{'x-creation-admission':'event_'+'a'.repeat(48)}));
  expect(r.status).toBe(409);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM '+collection).one().n).toBe(0);
 });
});
it.each(['messages','tasks'] as const)('recovers exact %s event after outcome GC and ignores later legacy same-key admission',async collection=>{
 const f=await taskFixture('admission-gc-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name);
  const preparation=await object.fetch(request(collection,csrf));expect(preparation.status).toBe(200);const prepared=(await preparation.json() as {data:{admission_id:string}}).data;
  // The server commits; deliberately discard the creation response body as a lost response.
  const lost=await object.fetch(request(collection,csrf,'','original',bodies[collection],{'x-creation-admission':prepared.admission_id}));expect(lost.status).toBe(201);await lost.arrayBuffer();
  const original=state.storage.sql.exec<{resource_id:string}>('SELECT resource_id FROM events WHERE id=?',prepared.admission_id).one();
  expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM creation_admissions').one().n).toBe(0);
  state.storage.sql.exec("UPDATE idempotency_outcomes SET created_at=?,expires_at=? WHERE key='original'",Date.now()-172800000,Date.now()-86400000);withTransaction(state.storage,tx=>cleanupCompletedOutcomes(tx,'ws_example',Date.now()));
  const refused=await object.fetch(request(collection,csrf,'','original',bodies[collection],{'x-creation-admission':prepared.admission_id}));expect(refused.status).toBe(409);
  // Legacy callers may legally reuse the key; this is not the original admission.
  const later=await object.fetch(request(collection,csrf));expect(later.status).toBe(200);
  const legacy=await object.fetch(request(collection,csrf,''));expect(legacy.status).toBe(201);await legacy.arrayBuffer();
  const checked=await object.fetch(request(collection,csrf,':reconcile','original',bodies[collection],{'x-creation-admission':prepared.admission_id}));expect(checked.status).toBe(200);
  expect((await checked.json() as {data:unknown}).data).toEqual({status:'admitted',admission:{event_id:prepared.admission_id,entity_id:original.resource_id}});
  state.storage.sql.exec('DELETE FROM task_history WHERE event_id=?',prepared.admission_id);state.storage.sql.exec('DELETE FROM events WHERE id=?',prepared.admission_id);
  const missing=await object.fetch(request(collection,csrf,':reconcile','original',bodies[collection],{'x-creation-admission':prepared.admission_id}));expect(missing.status).toBe(200);expect((await missing.json() as {data:unknown}).data).toEqual({status:'unknown'});
 });
});
it.each(['messages','tasks'] as const)('browser %s creation preflight admits only explicit preparation header',async collection=>{
 const f=await taskFixture('admission-options-'+collection);
 await runInDurableObject(f.stub,async(object)=>{
  const r=await object.fetch(new Request(origin+'/v2/workspaces/ws_example/'+collection,{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type,idempotency-key,x-csrf-token,x-creation-admission'}}));expect(r.status).toBe(204);expect(r.headers.get('access-control-allow-headers')).toContain('x-creation-admission');
 });
});
it.each(['messages','tasks'] as const)('prepared %s cannot relabel an intervening legacy admission',async collection=>{
 const f=await taskFixture('admission-legacy-race-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name),p=await object.fetch(request(collection,csrf));const id=(await p.json() as {data:{admission_id:string}}).data.admission_id;
  const legacy=await object.fetch(request(collection,csrf,''));expect(legacy.status).toBe(201);await legacy.arrayBuffer();
  const r=await object.fetch(request(collection,csrf,'','original',bodies[collection],{'x-creation-admission':id}));expect(r.status).toBe(409);
  const read=await object.fetch(request(collection,csrf,':reconcile','original',bodies[collection],{'x-creation-admission':id}));expect((await read.json() as {data:unknown}).data).toEqual({status:'unknown'});
  expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM '+collection).one().n).toBe(1);
 });
});
it.each(['messages','tasks'] as const)('expired %s reservation denies writes at boundary without renewal',async collection=>{
 const f=await taskFixture('admission-expired-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name),p=await object.fetch(request(collection,csrf));const id=(await p.json() as {data:{admission_id:string}}).data.admission_id;
  const now=Date.now();state.storage.sql.exec('UPDATE creation_admissions SET created_at=?,expires_at=? WHERE id=?',now-86400000,now,id);
  const r=await object.fetch(request(collection,csrf,'','original',bodies[collection],{'x-creation-admission':id}));expect(r.status).toBe(409);
  expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM '+collection).one().n).toBe(0);
  const read=await object.fetch(request(collection,csrf,':reconcile','original',bodies[collection],{'x-creation-admission':id}));expect((await read.json() as {data:unknown}).data).toEqual({status:'unknown'});
 });
});
it.each(['authorization','x-runtime-token'] as const)('preparation rejects present %s even when empty',async header=>{
 const f=await taskFixture('admission-native-'+header);await runInDurableObject(f.stub,async(object,state)=>{const {csrf}=await session(state.storage,f.name);const r=await object.fetch(request('tasks',csrf,':prepare','key',bodies.tasks,{[header]:''}));expect(r.status).toBe(400);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM creation_admissions').one().n).toBe(0);});
});
it('preparation conflicts on edited body and does not renew original expiry',async()=>{
 const f=await taskFixture('admission-edited');await runInDurableObject(f.stub,async(object,state)=>{const {csrf}=await session(state.storage,f.name);const p=await object.fetch(request('tasks',csrf));const first=(await p.json() as {data:unknown}).data;const r=await object.fetch(request('tasks',csrf,':prepare','original',{...bodies.tasks,title:'edited'}));expect(r.status).toBe(409);const again=await object.fetch(request('tasks',csrf));expect((await again.json() as {data:unknown}).data).toEqual(first);});
});
it('current event-read authority is required even when the handle is missing',async()=>{
 const f=await taskFixture('admission-event-authority');await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name);const g=state.storage.sql.exec<{scopes_json:string}>("SELECT scopes_json FROM human_grants WHERE principal_id='human_operator'").one();state.storage.sql.exec("UPDATE human_grants SET scopes_json=? WHERE principal_id='human_operator'",JSON.stringify((JSON.parse(g.scopes_json) as string[]).filter(x=>x!=='events:read')));
  const r=await object.fetch(request('tasks',csrf,':reconcile','original',bodies.tasks,{'x-creation-admission':'event_'+'b'.repeat(48)}));expect(r.status).toBe(403);
 });
});
it('one scoped actor cannot inspect another actor original admission with the same key',async()=>{
 const f=await taskFixture('admission-actor');await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name);const p=await object.fetch(request('tasks',csrf)),id=(await p.json() as {data:{admission_id:string}}).data.admission_id;expect((await object.fetch(request('tasks',csrf,'','original',bodies.tasks,{'x-creation-admission':id}))).status).toBe(201);
  const other=human(state.storage,true);if(other.kind!=='human')throw Error('fixture');const otherCookie='D'.repeat(43);state.storage.sql.exec('UPDATE sessions SET token_digest=? WHERE id=?',await sha256(otherCookie),other.sessionId);const row=withTransaction(state.storage,tx=>tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=?',[other.sessionId])!);const token=await csrfToken(workspace,row);
  const read=await object.fetch(request('tasks',token,':reconcile','original',bodies.tasks,{'x-creation-admission':id,cookie:'cfhub_session='+otherCookie}));expect(read.status).toBe(200);expect((await read.json() as {data:unknown}).data).toEqual({status:'unknown'});
 });
});
it('reconciliation cannot write SQL state or turn missing event into replacement admission',async()=>{
 const f=await taskFixture('admission-no-writes');await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name);const p=await object.fetch(request('tasks',csrf)),id=(await p.json() as {data:{admission_id:string}}).data.admission_id;expect((await object.fetch(request('tasks',csrf,'','original',bodies.tasks,{'x-creation-admission':id}))).status).toBe(201);
  const snapshot=()=>Object.fromEntries(state.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").toArray().map(({name})=>[name,state.storage.sql.exec('SELECT * FROM '+name).toArray()]));const before=snapshot();
  const r=await object.fetch(request('tasks',csrf,':reconcile','original',bodies.tasks,{'x-creation-admission':id}));expect((await r.json() as {data:{status:string}}).data.status).toBe('admitted');expect(snapshot()).toEqual(before);
 });
});
it('capacity failure never evicts unexpired reservations or creates a domain entity',async()=>{
 const f=await taskFixture('admission-capacity');await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name),now=Date.now();for(let i=0;i<64;i++)state.storage.sql.exec('INSERT INTO creation_admissions VALUES(?,?,?,?,?,?,?,?,?)','event_'+i.toString(16).padStart(48,'0'),'ws_example','human_operator','tasks:create','tasks:create',i.toString(16).padStart(64,'0'),'a'.repeat(64),now,now+86400000);
  const r=await object.fetch(request('tasks',csrf));expect(r.status).toBe(429);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM creation_admissions').one().n).toBe(64);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM tasks').one().n).toBe(0);
 });
});
it('early outcome loss cannot reopen an already consumed handle',async()=>{
 const f=await taskFixture('admission-early-gc');await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name),p=await object.fetch(request('tasks',csrf)),id=(await p.json() as {data:{admission_id:string}}).data.admission_id;expect((await object.fetch(request('tasks',csrf,'','original',bodies.tasks,{'x-creation-admission':id}))).status).toBe(201);
  // Deliberate premature loss, separate from the production collector tests above.
  state.storage.sql.exec("DELETE FROM idempotency_outcomes WHERE key='original'");const r=await object.fetch(request('tasks',csrf,'','original',bodies.tasks,{'x-creation-admission':id}));expect(r.status).toBe(409);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM tasks').one().n).toBe(1);
 });
});
it('domain writes and pending deletion rollback together on correlation persistence failure',async()=>{
 const f=await taskFixture('admission-rollback');await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name),p=await object.fetch(request('tasks',csrf)),id=(await p.json() as {data:{admission_id:string}}).data.admission_id;
  state.storage.sql.exec("CREATE TRIGGER reject_creation_binding BEFORE INSERT ON idempotency_outcomes BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END");
  const failed=await object.fetch(request('tasks',csrf,'','original',bodies.tasks,{'x-creation-admission':id}));expect(failed.status).toBe(500);
  expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM tasks').one().n).toBe(0);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM creation_admissions WHERE id=?',id).one().n).toBe(1);
  state.storage.sql.exec('DROP TRIGGER reject_creation_binding');const successful=await object.fetch(request('tasks',csrf,'','original',bodies.tasks,{'x-creation-admission':id}));expect(successful.status).toBe(201);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM tasks').one().n).toBe(1);
 });
});
it('concurrent prepared dispatches return one exact entity without duplicate events',async()=>{
 const f=await taskFixture('admission-concurrent');await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name),preps=await Promise.all([object.fetch(request('tasks',csrf)),object.fetch(request('tasks',csrf))]);const ids=await Promise.all(preps.map(async p=>(await p.json() as {data:{admission_id:string}}).data.admission_id));expect(ids[0]).toBe(ids[1]);
  const rs=await Promise.all(ids.map(id=>object.fetch(request('tasks',csrf,'','original',bodies.tasks,{'x-creation-admission':id}))));expect(rs.map(r=>r.status)).toEqual([201,201]);const values=await Promise.all(rs.map(async r=>(await r.json() as {data:{id:string}}).data.id));expect(values[0]).toBe(values[1]);expect(state.storage.sql.exec<{n:number}>("SELECT count(*) AS n FROM events WHERE type='task.created'").one().n).toBe(1);
 });
});
it('bounded expired cleanup advances even when the requested principal quota is on a later page',async()=>{
 const f=await taskFixture('admission-cleanup-progress');await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name),now=Date.now();for(let i=0;i<264;i++)state.storage.sql.exec('INSERT INTO creation_admissions VALUES(?,?,?,?,?,?,?,?,?)','event_'+i.toString(16).padStart(48,'0'),'ws_example',i<200?'human_other':'human_operator','tasks:create','tasks:create',i.toString(16).padStart(64,'0'),'a'.repeat(64),now-172800000+i,now-86400000+i);
  const first=await object.fetch(request('tasks',csrf));expect(first.status).toBe(429);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM creation_admissions').one().n).toBe(64);
  const next=await object.fetch(request('tasks',csrf));expect(next.status).toBe(200);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM creation_admissions').one().n).toBe(1);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM tasks').one().n).toBe(0);
 });
});
it.each(['project_id','work_role_id','assigned_agent_id'] as const)('task preparation validates current %s before reserving',async field=>{
 const f=await taskFixture('admission-reference-'+field);await runInDurableObject(f.stub,async(object,state)=>{const {csrf}=await session(state.storage,f.name);const r=await object.fetch(request('tasks',csrf,':prepare','original',{...bodies.tasks,[field]:'does_not_exist'}));expect(r.status).toBe(404);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM creation_admissions').one().n).toBe(0);});
});
it('workspace capacity is bounded independently of per-principal capacity',async()=>{
 const f=await taskFixture('admission-workspace-cap');await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name),now=Date.now();for(let i=0;i<1024;i++)state.storage.sql.exec('INSERT INTO creation_admissions VALUES(?,?,?,?,?,?,?,?,?)','event_'+i.toString(16).padStart(48,'0'),'ws_example','principal_'+i,'tasks:create','tasks:create',i.toString(16).padStart(64,'0'),'a'.repeat(64),now,now+86400000);
  const r=await object.fetch(request('tasks',csrf));expect(r.status).toBe(429);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM creation_admissions').one().n).toBe(1024);
 });
});
it.each(['','not-an-event','event_'+'a'.repeat(47),'event_'+'A'.repeat(48)])('malformed creation handle %s denies before domain writes',async id=>{
 const f=await taskFixture('admission-malformed-'+id.length);await runInDurableObject(f.stub,async(object,state)=>{const {csrf}=await session(state.storage,f.name);const r=await object.fetch(request('tasks',csrf,'','original',bodies.tasks,{'x-creation-admission':id}));expect(r.status).toBe(400);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM tasks').one().n).toBe(0);});
});
it.each(['authorization','x-runtime-token'])('creation rejects reservation mixed with present %s',async h=>{
 const f=await taskFixture('admission-create-native-'+h);await runInDurableObject(f.stub,async(object,state)=>{const {csrf}=await session(state.storage,f.name);const r=await object.fetch(request('tasks',csrf,'','original',bodies.tasks,{'x-creation-admission':'event_'+'a'.repeat(48),[h]:''}));expect(r.status).toBe(400);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM tasks').one().n).toBe(0);});
});
it('server entropy collision cannot issue an existing event identity as a new preparation',async()=>{
 const f=await taskFixture('admission-id-collision');await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name),p=await object.fetch(request('tasks',csrf)),id=(await p.json() as {data:{admission_id:string}}).data.admission_id;expect((await object.fetch(request('tasks',csrf,'','original',bodies.tasks,{'x-creation-admission':id}))).status).toBe(201);
  const {prepareCreation}=await import('../../src/workspace/creation-admissions'),{taskPreparationAccess}=await import('../../src/tasks/commands'),{fingerprintRequest}=await import('../../src/workspace/idempotency'),{currentConfiguration}=await import('../../src/auth/context');
  const installed=withTransaction(state.storage,tx=>currentConfiguration(tx,workspace)),identity=human(state.storage),fingerprint=await fingerprintRequest('POST','/v2/workspaces/ws_example/tasks',{},bodies.tasks);
  const bytes=new Uint8Array(id.slice(6).match(/../g)!.map(x=>parseInt(x,16)));
  await expect(prepareCreation({workspace:{...workspace,entropy:{bytes:()=>bytes}},requestId:'collision',idempotencyKey:'new-key',fingerprint,admissionEpoch:installed.epoch,admissionGeneration:installed.fence.maintenanceGeneration},identity,taskPreparationAccess(),bodies.tasks)).rejects.toMatchObject({code:'INTERNAL_ERROR'});
  expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM creation_admissions').one().n).toBe(0);
 });
});
it.each(['create','reconcile'] as const)('current authority is rechecked after %s admission binding digest await',async mode=>{
 const f=await taskFixture('admission-await-'+mode);await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name),p=await object.fetch(request('tasks',csrf)),id=(await p.json() as {data:{admission_id:string}}).data.admission_id;
  if(mode==='reconcile')expect((await object.fetch(request('tasks',csrf,'','original',bodies.tasks,{'x-creation-admission':id}))).status).toBe(201);
  const before=state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM tasks').one().n,digest=crypto.subtle.digest.bind(crypto.subtle);let revoked=false;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(...args)=>{const result=await digest(...args),input=args[1],bytes=ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):new Uint8Array(input);if(!revoked&&new TextDecoder().decode(bytes).includes('cfhub.browser-creation-admission')){revoked=true;state.storage.sql.exec("UPDATE human_grants SET enabled=0 WHERE principal_id='human_operator'");}return result;});
  try{const r=await object.fetch(request('tasks',csrf,mode==='create'?'':':reconcile','original',bodies.tasks,{'x-creation-admission':id}));expect(revoked).toBe(true);expect(r.status).toBe(401);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM tasks').one().n).toBe(before);}finally{spy.mockRestore();}
 });
});
it.each(['body','key','handle'] as const)('exact prepared evidence rejects a changed %s without domain or receipt writes',async changed=>{
 const f=await taskFixture('admission-binding-'+changed);await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name),p=await object.fetch(request('tasks',csrf)),id=(await p.json() as {data:{admission_id:string}}).data.admission_id;expect((await object.fetch(request('tasks',csrf,'','original',bodies.tasks,{'x-creation-admission':id}))).status).toBe(201);
  const r=await object.fetch(request('tasks',csrf,':reconcile',changed==='key'?'different':'original',changed==='body'?{...bodies.tasks,title:'changed'}:bodies.tasks,{'x-creation-admission':changed==='handle'?'event_'+'f'.repeat(48):id}));expect(r.status).toBe(200);expect((await r.json() as {data:unknown}).data).toEqual({status:'unknown'});expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM tasks').one().n).toBe(1);expect(state.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM creation_admissions').one().n).toBe(0);
 });
});
