import {artifactFixture,artifactContext,stage,bytes,claimSetup} from '../helpers/artifacts';
import {uploadArtifactContent,commitArtifact} from '../../src/artifacts/content';
import {taskCreationAccess} from '../../src/tasks/commands';
import {reconcileCreation} from '../../src/workspace/creation-reconciliation';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {creationReconciliationRoutes} from '../../src/http/creation-reconciliation-routes';
import {messageRoutes} from '../../src/http/message-routes';
import {taskRoutes} from '../../src/http/task-routes';
import {withTransaction} from '../../src/storage/transaction';
import {cleanupCompletedOutcomes} from '../../src/workspace/idempotency';
import {it,expect,vi} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {taskFixture,taskProfile} from '../helpers/tasks';
import {owned,human} from '../helpers/settings';
import {sha256} from '../../src/config/bootstrap';
import {csrfToken} from '../../src/auth/csrf';
import type {SessionRecord} from '../../src/auth/authorize';
const origin='https://hub.example.invalid',cookie='C'.repeat(43);
const bodies={messages:{body:'Exact 😀 original',recipient_agent_ids:['agent_research'],refs:[],artifact_ids:[]},tasks:{title:'Exact 😀 task',description:'Original'}};
function snapshot(storage:DurableObjectStorage){return Object.fromEntries(storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name GLOB '[a-z]*' ORDER BY name").toArray().map(({name})=>{if(!/^[A-Za-z0-9_]+$/.test(name))throw Error('Unexpected table');return [name,storage.sql.exec('SELECT * FROM '+name).toArray().map(row=>JSON.stringify(row)).sort()];}));}
async function session(storage:DurableObjectStorage,name:string){
 const identity=human(storage);if(identity.kind!=='human')throw Error('Expected human fixture');const workspace={...owned(storage,name),secrets:env as unknown as Record<string,unknown>};
 storage.sql.exec('UPDATE sessions SET token_digest=? WHERE id=?',await sha256(cookie),identity.sessionId);
 const row=withTransaction(storage,tx=>tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=?',[identity.sessionId])!);return {workspace,csrf:await csrfToken(workspace,row)};
}
function request(collection:keyof typeof bodies,csrf:string,{reconcile=false,key='original',body=bodies[collection],headers={},query=''}:{reconcile?:boolean;key?:string;body?:unknown;headers?:Record<string,string>;query?:string}={}){return new Request(origin+'/v2/workspaces/ws_example/'+collection+(reconcile?':reconcile':'')+query,{method:'POST',headers:{'content-type':'application/json',origin,'cookie':'cfhub_session='+cookie,'x-csrf-token':csrf,'idempotency-key':key,...headers},body:JSON.stringify(body)});}
it.each(['messages','tasks'] as const)('retained %s creation reconciles through actual DO without SQL writes',async collection=>{
 const f=await taskFixture('reconcile-positive-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name);
  const created=await (collection==='messages'?messageRoutes:taskRoutes)(request(collection,csrf),workspace);expect(created.status).toBe(201);const original=(await created.json() as {data:unknown}).data;
  if(collection==='messages'){
   const message=original as {id:string;thread_id:string},receipt=state.storage.sql.exec<{event_id:string}>("SELECT event_id FROM idempotency_outcomes WHERE principal_id='human_operator' AND operation='domain.messages:send' AND target='messages' AND key='original'").one();
   expect(state.storage.sql.exec<{type:string;resource_id:string}>('SELECT type,resource_id FROM events WHERE id=?',receipt.event_id).one()).toEqual({type:'message.accepted',resource_id:message.id});
   const deliveries=state.storage.sql.exec<{message_id:string;payload_json:string;status:string;attempts:number}>('SELECT message_id,payload_json,status,attempts FROM outbox WHERE message_id=?',message.id).toArray();
   expect(deliveries).toHaveLength(1);expect(deliveries[0]).toMatchObject({message_id:message.id,status:'pending',attempts:0});expect(JSON.parse(deliveries[0].payload_json)).toMatchObject({message_id:message.id,thread_id:message.thread_id,event_id:receipt.event_id});
  }
  const before=snapshot(state.storage),response=await object.fetch(request(collection,csrf,{reconcile:true}));
  expect(response.status).toBe(200);expect((await response.json() as {data:unknown}).data).toEqual({status:'confirmed',[collection==='messages'?'message':'task']:original});expect(snapshot(state.storage)).toEqual(before);
 });
});
it.each(['messages','tasks'] as const)('unknown, mismatch, retained age and actual GC are read-only for %s',async collection=>{
 const f=await taskFixture('reconcile-retention-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name);expect((await (collection==='messages'?messageRoutes:taskRoutes)(request(collection,csrf),workspace)).status).toBe(201);
  const before=snapshot(state.storage);
  for(const options of [{key:'unused'},{body:collection==='messages'?{...bodies.messages,body:'different'}:{...bodies.tasks,title:'different'}}]){
   const r=await object.fetch(request(collection,csrf,{reconcile:true,...options}));expect(r.status).toBe(200);expect((await r.json() as {data:unknown}).data).toEqual({status:'unknown'});expect(snapshot(state.storage)).toEqual(before);
  }
  state.storage.sql.exec('UPDATE idempotency_outcomes SET created_at=?,expires_at=? WHERE key=?',Date.now()-172800000,Date.now()-86400000,'original');
  const aged=snapshot(state.storage);expect((await (await object.fetch(request(collection,csrf,{reconcile:true}))).json() as {data:{status:string}}).data.status).toBe('confirmed');expect(snapshot(state.storage)).toEqual(aged);
  withTransaction(state.storage,tx=>cleanupCompletedOutcomes(tx,'ws_example',Date.now()));
  const cleaned=snapshot(state.storage);const r=await object.fetch(request(collection,csrf,{reconcile:true}));expect((await r.json() as {data:unknown}).data).toEqual({status:'unknown'});expect(snapshot(state.storage)).toEqual(cleaned);
 });
});
it.each(['messages','tasks'] as const)('foreign principal/workspace cannot discover %s receipt',async collection=>{
 const f=await taskFixture('reconcile-foreign-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {workspace,csrf}=await session(state.storage,f.name);expect((await (collection==='messages'?messageRoutes:taskRoutes)(request(collection,csrf),workspace)).status).toBe(201);
  const foreign=human(state.storage,true);if(foreign.kind!=='human')throw Error('Expected human fixture');const otherCookie='D'.repeat(43);state.storage.sql.exec('UPDATE sessions SET token_digest=? WHERE id=?',await sha256(otherCookie),foreign.sessionId);
  const otherCsrf=await csrfToken(workspace,withTransaction(state.storage,tx=>tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=?',[foreign.sessionId])!)),before=snapshot(state.storage);
  const r=await object.fetch(request(collection,otherCsrf,{reconcile:true,headers:{cookie:'cfhub_session='+otherCookie}}));expect(r.status).toBe(200);expect((await r.json() as {data:unknown}).data).toEqual({status:'unknown'});
  const req=request(collection,csrf,{reconcile:true});const foreignRequest=new Request(req.url.replace('ws_example','ws_foreign'),req);expect((await object.fetch(foreignRequest)).status).toBe(401);expect(snapshot(state.storage)).toEqual(before);
 });
});
it.each(['messages','tasks'] as const)('rejects corrupt retained creation status/JSON/schema for %s',async collection=>{
 const f=await taskFixture('reconcile-corrupt-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name);expect((await (collection==='messages'?messageRoutes:taskRoutes)(request(collection,csrf),workspace)).status).toBe(201);
  const original=state.storage.sql.exec<{status:number;outcome_json:string}>('SELECT status,outcome_json FROM idempotency_outcomes WHERE key=?','original').one();
  expect(()=>state.storage.sql.exec('UPDATE idempotency_outcomes SET outcome_json=? WHERE key=?','{','original')).toThrow();
  for(const [status,json] of [[200,original.outcome_json],[201,'null'],[201,'{}']] as const){
   state.storage.sql.exec('UPDATE idempotency_outcomes SET status=?,outcome_json=? WHERE key=?',status,json,'original');const before=snapshot(state.storage);
   const r=await object.fetch(request(collection,csrf,{reconcile:true}));expect(r.status).toBe(500);expect((await r.json() as {error:{code:string}}).error.code).toBe('INTERNAL_ERROR');expect(snapshot(state.storage)).toEqual(before);
  }
 });
});
it.each(['messages','tasks'] as const)('cookie/CSRF-only %s lookup rejects authority headers and malformed input',async collection=>{
 const f=await taskFixture('reconcile-boundary-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name),before=snapshot(state.storage);
  for(const [options,status] of [
   [{headers:{authorization:''}},400],[{headers:{'x-runtime-token':''}},400],[{headers:{cookie:''}},401],[{headers:{'x-csrf-token':''}},403],[{headers:{origin:'https://foreign.invalid'}},403],
   [{query:'?extra=1'},400],[{body:{...bodies[collection],principal_id:'forged'}},400],
   [{body:collection==='messages'?{...bodies.messages,body:'😀'.repeat(16384)}:{...bodies.tasks,description:'😀'.repeat(16384)}},413]
  ] as const){const r=await object.fetch(request(collection,csrf,{reconcile:true,...options}));expect(r.status).toBe(status);expect(snapshot(state.storage)).toEqual(before);}
  const r=await object.fetch(new Request(origin+'/v2/workspaces/ws_example/'+collection+':reconcile',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'authorization'}}));expect(r.status).toBe(403);
  const good=await object.fetch(new Request(origin+'/v2/workspaces/ws_example/'+collection+':reconcile',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type, idempotency-key, x-csrf-token'}}));expect(good.status).toBe(204);expect(good.headers.get('access-control-allow-headers')).not.toContain('authorization');expect(snapshot(state.storage)).toEqual(before);
 });
});
it.each(['messages','tasks'] as const)('current revocation prevents reading an existing %s receipt',async collection=>{
 const f=await taskFixture('reconcile-revoked-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name);expect((await (collection==='messages'?messageRoutes:taskRoutes)(request(collection,csrf),workspace)).status).toBe(201);
  state.storage.sql.exec("UPDATE human_grants SET enabled=0 WHERE principal_id='human_operator'");const before=snapshot(state.storage);
  const r=await object.fetch(request(collection,csrf,{reconcile:true}));expect(r.status).toBe(401);expect(snapshot(state.storage)).toEqual(before);
 });
});
it.each(['messages','tasks'] as const)('canonical property order and original collection identity are preserved for %s',async collection=>{
 const f=await taskFixture('reconcile-canonical-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name);expect((await (collection==='messages'?messageRoutes:taskRoutes)(request(collection,csrf),workspace)).status).toBe(201);
  const reordered=Object.fromEntries(Object.entries(bodies[collection]).reverse()),before=snapshot(state.storage);
  expect((await (await object.fetch(request(collection,csrf,{reconcile:true,body:reordered}))).json() as {data:{status:string}}).data.status).toBe('confirmed');
  const explicitNull={...bodies[collection],...(collection==='tasks'?{project_id:null}:{thread_id:null})};
  const r=await object.fetch(request(collection,csrf,{reconcile:true,body:explicitNull}));expect(r.status).toBe(200);expect((await r.json() as {data:unknown}).data).toEqual({status:'unknown'});expect(snapshot(state.storage)).toEqual(before);
 });
});
it.each(['session','grant','config','generation','maintenance','gc'] as const)('final guard observes %s change during async original fingerprint preparation',async mode=>{
 const f=await taskFixture('reconcile-race-'+mode);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name);expect((await taskRoutes(request('tasks',csrf),workspace)).status).toBe(201);
  const digest=crypto.subtle.digest.bind(crypto.subtle);let changed=false;let afterChange:ReturnType<typeof snapshot>|undefined;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(...args)=>{
   const result=await digest(...args),input=args[1];const bytes=ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):new Uint8Array(input);
   if(!changed&&new TextDecoder().decode(bytes).includes('"path":"/v2/workspaces/ws_example/tasks"')){
    changed=true;
    if(mode==='session')state.storage.sql.exec("UPDATE sessions SET revoked_at=? WHERE id='session_settings'",Date.now());
    if(mode==='grant')state.storage.sql.exec("UPDATE human_grants SET enabled=0 WHERE principal_id='human_operator'");
    if(mode==='config'){state.storage.sql.exec('UPDATE workspace_metadata SET config_epoch=config_epoch+1 WHERE id=1');state.storage.sql.exec('UPDATE maintenance_state SET authority_epoch=authority_epoch+1 WHERE id=1');}
    if(mode==='generation')state.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1 WHERE id=1');
    if(mode==='maintenance')state.storage.sql.exec("UPDATE maintenance_state SET state='capturing' WHERE id=1");
    if(mode==='gc'){state.storage.sql.exec('UPDATE idempotency_outcomes SET created_at=?,expires_at=? WHERE key=?',Date.now()-172800000,Date.now()-86400000,'original');withTransaction(state.storage,tx=>cleanupCompletedOutcomes(tx,'ws_example',Date.now()));}
    afterChange=snapshot(state.storage);
   }
   return result;
  });
  try{const r=await object.fetch(request('tasks',csrf,{reconcile:true}));expect(changed).toBe(true);expect(r.status).toBe(mode==='gc'?200:mode==='maintenance'?503:401);if(mode==='gc')expect((await r.json() as {data:unknown}).data).toEqual({status:'unknown'});expect(snapshot(state.storage)).toEqual(afterChange);}finally{spy.mockRestore();}
 });
});
it.each(['messages','tasks'] as const)('returned-resource visibility changes deny %s without executing first-use guards',async collection=>{
 const f=await taskFixture('reconcile-result-access-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name);expect((await (collection==='messages'?messageRoutes:taskRoutes)(request(collection,csrf),workspace)).status).toBe(201);
  if(collection==='messages'){state.storage.sql.exec("DELETE FROM thread_participants WHERE participant_kind='human' AND participant_id='human_operator'");const scopes=JSON.parse(state.storage.sql.exec<{scopes_json:string}>("SELECT scopes_json FROM human_grants WHERE principal_id='human_operator'").one().scopes_json) as string[];state.storage.sql.exec("UPDATE human_grants SET scopes_json=? WHERE principal_id='human_operator'",JSON.stringify(scopes.filter(x=>x!=='messages:review')));}
  else state.storage.sql.exec("UPDATE human_grants SET project_ids_json='[]' WHERE principal_id='human_operator'");
  const before=snapshot(state.storage),r=await object.fetch(request(collection,csrf,{reconcile:true}));expect([403,404]).toContain(r.status);expect(snapshot(state.storage)).toEqual(before);
 });
});
it('the HTTP lookup consumes no entity entropy and does not repair dirty scheduler state',async()=>{
 const f=await taskFixture('reconcile-zero-entropy');
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name);expect((await messageRoutes(request('messages',csrf),workspace)).status).toBe(201);
  const entropy=vi.fn(()=>{throw Error('No entity allocation permitted');}),before=snapshot(state.storage);
  for(const key of ['original','unused']){const r=await creationReconciliationRoutes(request('messages',csrf,{reconcile:true,key}),{...workspace,entropy:{bytes:entropy}});expect(r.status).toBe(200);}
  expect(entropy).not.toHaveBeenCalled();expect(snapshot(state.storage)).toEqual(before);
  // Real DO registration must also skip both pre-request and post-response scheduler repair.
  const repair=vi.spyOn(object,'repairSchedule').mockImplementation(async()=>{throw Error('No scheduling permitted');});
  try{expect((await object.fetch(request('messages',csrf,{reconcile:true}))).status).toBe(200);await Promise.resolve();expect(repair).not.toHaveBeenCalled();expect(snapshot(state.storage)).toEqual(before);}finally{repair.mockRestore();}
 });
});
it.each(['body','auth-hash','csrf'] as const)('session revoked during %s await is never confirmed',async stage=>{
 const f=await taskFixture('reconcile-stage-'+stage);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name);expect((await taskRoutes(request('tasks',csrf),workspace)).status).toBe(201);
  let changed=false;let afterChange:ReturnType<typeof snapshot>|undefined;
  const revoke=()=>{if(changed)return;changed=true;state.storage.sql.exec("UPDATE sessions SET revoked_at=? WHERE id='session_settings'",Date.now());afterChange=snapshot(state.storage);};
  const digest=crypto.subtle.digest.bind(crypto.subtle),sign=crypto.subtle.sign.bind(crypto.subtle);
  const d=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(...args)=>{const result=await digest(...args);if(stage==='auth-hash')revoke();return result;});
  const s=vi.spyOn(crypto.subtle,'sign').mockImplementation(async(...args)=>{const result=await sign(...args);if(stage==='csrf')revoke();return result;});
  let req=request('tasks',csrf,{reconcile:true});
  if(stage==='body'){const original=req,bytes=new TextEncoder().encode(JSON.stringify(bodies.tasks));let chunk=0;req=new Request(original.url,{method:'POST',headers:original.headers,body:new ReadableStream({pull(controller){if(chunk++===0)controller.enqueue(bytes);else{revoke();controller.close();}}})});}
  try{expect((await object.fetch(req)).status).toBe(401);expect(changed).toBe(true);expect(snapshot(state.storage)).toEqual(afterChange);}finally{d.mockRestore();s.mockRestore();}
 });
});
it.each(['resource','checkAccess','checkReplay'] as const)('reconciliation rejects asynchronous %s descriptors without SQL writes',async method=>{
 const f=await taskFixture('reconcile-thenable-'+method.toLowerCase());
 await runInDurableObject(f.stub,async(_object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name);expect((await taskRoutes(request('tasks',csrf),workspace)).status).toBe(201);
  const identity=human(state.storage),context={workspace,requestId:'fixture_lookup',idempotencyKey:'original',fingerprint:await fingerprintRequest('POST','/v2/workspaces/ws_example/tasks',{},bodies.tasks),admissionEpoch:1,admissionGeneration:0};
  const access=taskCreationAccess(),before=snapshot(state.storage),execute=vi.fn(()=>{throw Error('Must not execute');});
  const asynchronous=vi.fn(()=>Promise.resolve(undefined)),asyncAccess={...access,execute,[method]:asynchronous} as unknown as typeof access;
  expect(()=>reconcileCreation(context,identity,asyncAccess,bodies.tasks)).toThrow();expect(asynchronous).toHaveBeenCalledOnce();expect(execute).not.toHaveBeenCalled();expect(snapshot(state.storage)).toEqual(before);
 });
});
it.each([['messages','original'],['messages','unused'],['tasks','original'],['tasks','unused']] as const)('reconciliation HTTP performs only SQL reads for %s/%s',async(collection,key)=>{
 const f=await taskFixture('reconcile-select-only-'+collection+'-'+key);
 await runInDurableObject(f.stub,async(_object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name);expect((await (collection==='messages'?messageRoutes:taskRoutes)(request(collection,csrf),workspace)).status).toBe(201);
  const exec=state.storage.sql.exec.bind(state.storage.sql),seen:string[]=[];
  const spy=vi.spyOn(state.storage.sql,'exec').mockImplementation((query:string,...bindings:SqlStorageValue[])=>{seen.push(query.split(/\s+/)[0].toUpperCase());if(!/^\s*SELECT\b/i.test(query))throw Error('Lookup attempted non-read SQL');return exec(query,...bindings);});
  try{expect((await creationReconciliationRoutes(request(collection,csrf,{reconcile:true,key}),workspace)).status).toBe(200);expect(seen.length).toBeGreaterThan(0);expect(new Set(seen)).toEqual(new Set(['SELECT']));}finally{spy.mockRestore();}
 });
});
it.each(['messages','tasks'] as const)('malformed UTF8 and full envelope byte boundaries are enforced for %s',async collection=>{
 const f=await taskFixture('reconcile-utf8-'+collection);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf}=await session(state.storage,f.name),base=request(collection,csrf,{reconcile:true}),before=snapshot(state.storage);
  expect((await object.fetch(new Request(base.url,{method:'POST',headers:base.headers,body:new Uint8Array([0xff])}))).status).toBe(400);
  const json=JSON.stringify(bodies[collection]),length=new TextEncoder().encode(json).length;
  for(const bytes of [65536,65537]){const r=await object.fetch(new Request(base.url,{method:'POST',headers:base.headers,body:json+' '.repeat(bytes-length)}));expect(r.status).toBe(bytes===65536?200:413);if(r.ok)expect((await r.json() as {data:unknown}).data).toEqual({status:'unknown'});}
  if(collection==='messages')expect((await object.fetch(request(collection,csrf,{reconcile:true,body:{...bodies.messages,body:'😀'.repeat(8192)+'a'}}))).status).toBe(413);
  expect(snapshot(state.storage)).toEqual(before);
 });
});
it('task lookup rechecks the current returned task even when original project remains permitted',async()=>{
 const f=await taskFixture('reconcile-current-task-project');
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name);taskProfile(state.storage);const body={...bodies.tasks,project_id:'project_a'};
  const created=await taskRoutes(request('tasks',csrf,{body}),workspace);expect(created.status).toBe(201);
  const id=(await created.json() as {data:{id:string}}).data.id;
  state.storage.sql.exec("UPDATE tasks SET project_id='project_b' WHERE id=?",id);
  state.storage.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_a\"]' WHERE principal_id='human_operator'");
  const before=snapshot(state.storage),r=await object.fetch(request('tasks',csrf,{reconcile:true,body}));expect(r.status).toBe(403);expect(snapshot(state.storage)).toEqual(before);
 });
});
it('message lookup rechecks recipient access to the original task reference',async()=>{
 const f=await taskFixture('reconcile-recipient-reference');
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name),task=await taskRoutes(request('tasks',csrf,{key:'task_ref'}),workspace);expect(task.status).toBe(201);
  const id=(await task.json() as {data:{id:string}}).data.id,body={...bodies.messages,refs:[{kind:'task',id}]};expect((await messageRoutes(request('messages',csrf,{body}),workspace)).status).toBe(201);
  const scopes=JSON.parse(state.storage.sql.exec<{scopes_json:string}>("SELECT scopes_json FROM native_credentials WHERE credential_id='credential_research_1'").one().scopes_json) as string[];
  state.storage.sql.exec("UPDATE native_credentials SET scopes_json=? WHERE credential_id='credential_research_1'",JSON.stringify(scopes.filter(x=>x!=='tasks:read')));
  const before=snapshot(state.storage),r=await object.fetch(request('messages',csrf,{reconcile:true,body}));expect(r.status).toBe(404);expect(snapshot(state.storage)).toEqual(before);
 });
});
it.each(['reference','attachment'] as const)('message lookup rechecks committed artifact %s current access',async kind=>{
 const f=await artifactFixture('reconcile-artifact-'+kind,['messages:read','messages:send']);
 await runInDurableObject(f.stub,async(object,state)=>{
  const {csrf,workspace}=await session(state.storage,f.name),setup=claimSetup(state.storage),ctx=artifactContext(state.storage,f.name,'lookup_artifact',setup.now);
  await stage(ctx,'artifact_reconcile',{task_id:'task_a'});await uploadArtifactContent({...ctx,idempotencyKey:'upload_reconcile'},'artifact_reconcile',bytes(),'upload_reconcile');await commitArtifact({...ctx,idempotencyKey:'commit_reconcile'},'artifact_reconcile',{expected_artifact_version:2});
  const body={...bodies.messages,...(kind==='reference'?{refs:[{kind:'artifact',id:'artifact_reconcile'}]}:{artifact_ids:['artifact_reconcile']})};expect((await messageRoutes(request('messages',csrf,{body}),workspace)).status).toBe(201);
  const scopes=JSON.parse(state.storage.sql.exec<{scopes_json:string}>("SELECT scopes_json FROM human_grants WHERE principal_id='human_operator'").one().scopes_json) as string[];
  state.storage.sql.exec("UPDATE human_grants SET scopes_json=? WHERE principal_id='human_operator'",JSON.stringify(scopes.filter(x=>x!=='artifacts:read')));
  const before=snapshot(state.storage),r=await object.fetch(request('messages',csrf,{reconcile:true,body}));expect(r.status).toBe(404);expect(snapshot(state.storage)).toEqual(before);
 });
});
