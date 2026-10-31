import {it,expect,vi,beforeAll} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {env} from 'cloudflare:workers';
import {isolationHttpFixture,createIsolationTask,prepareIsolationOperation} from './r2-isolation-http';
import {recordIsolationEvidence} from './r2-isolation-matrix';
import {assertDenied} from './r2-isolation-boundaries';
import {owned} from './settings';
import {artifactBucket,wrapBucket} from './artifacts';
import {artifactRoutes} from '../../src/http/artifact-routes';
import {canonicalJson} from '../../src/config/bootstrap';
import {DeliveryDispatcher,signNotification} from '../../src/outbox/dispatcher';
import {claimDue} from '../../src/outbox/repository';
import {withTransaction} from '../../src/storage/transaction';
import {messageFixture,messageInput,commandContext} from './messages';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
const applicationTables=['task_acceptances','result_artifacts','artifact_associations','message_artifacts','thread_participants','tasks','runs','task_results','artifacts','artifact_generations','messages','threads','inbox','events','idempotency_outcomes','outbox','task_history','catalog_plans','import_plans','import_mappings'] as const;
function domain(storage:DurableObjectStorage){return Object.fromEntries(applicationTables.map(t=>[t,storage.sql.exec('SELECT * FROM '+t).toArray()]));}
for(const lane of ['human','native'] as const)for(const phase of ['encrypt','decrypt'] as const)it(lane+' original proof expiration during cursor '+phase+' prevents publication',async()=>{
 const f=await isolationHttpFixture('cursor_await_'+lane+'_'+phase);await createIsolationTask(f);await createIsolationTask(f);
 const initial=await f.send('listTasks',lane,{query:{limit:1}}),first=await initial.json() as {page:{next_cursor:string}};expect(initial.status).toBe(200);
 await runInDurableObject(f.a.stub,async(object,{storage})=>{
  const before=domain(storage),original=crypto.subtle[phase].bind(crypto.subtle);let reached=false;
  const spy=vi.spyOn(crypto.subtle,phase).mockImplementation(async(...args:Parameters<typeof original>)=>{const result=await original(args[0],args[1],args[2]);reached=true;storage.sql.exec(lane==='human'?'UPDATE sessions SET expires_at=?':"UPDATE native_credentials SET expires_at=? WHERE credential_id='credential_research_1'",Date.now()-1);return result;});
  try{await assertDenied(await object.fetch(f.make('listTasks',lane,{query:{limit:1,...(phase==='decrypt'?{cursor:first.page.next_cursor}:{})}})),401);expect(reached).toBe(true);expect(domain(storage)).toEqual(before);}finally{spy.mockRestore();}
 });recordIsolationEvidence('listTasks',lane,'cursor-'+phase);
});
const mutationFixtures=new Map<string,Awaited<ReturnType<typeof isolationHttpFixture>>>();
// Real JOSE remote-JWKS login retains a bounded 5s abort timer. Drain setup
// I/O before the timed authority/restart assertion, as in identity-http tests.
beforeAll(async()=>{
 for(const lane of ['human','native'])for(const mode of ['fresh','retained-replay'])mutationFixtures.set(lane+'/'+mode,await isolationHttpFixture('mutation_await_'+lane+'_'+mode));
 await Promise.all([...mutationFixtures.values()].map(f=>evictDurableObject(f.a.stub)));
});
for(const lane of ['human','native'] as const)for(const mode of ['fresh','retained-replay'] as const)it(lane+' revocation during request fingerprint denies '+mode,async()=>{
 const f=mutationFixtures.get(lane+'/'+mode)!,input={key:'original-prepared',body:{title:'Prepared intent',description:'Bounded write'}};
 if(mode==='retained-replay'){const response=await f.send('createTask',lane,input);expect(response.status).toBe(201);await response.arrayBuffer();}
 const expected=canonicalJson({method:'POST',path:'/v2/workspaces/ws_example/tasks',query:{},body:input.body});
 await runInDurableObject(f.a.stub,async(object,{storage})=>{
  const before=domain(storage),original=crypto.subtle.digest.bind(crypto.subtle);let reached=false;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(...args)=>{const result=await original(...args);const bytes=args[1] instanceof ArrayBuffer?new Uint8Array(args[1]):new Uint8Array(args[1].buffer,args[1].byteOffset,args[1].byteLength);if(new TextDecoder().decode(bytes)===expected){reached=true;if(lane==='human')storage.sql.exec('UPDATE sessions SET revoked_at=?',Date.now());else storage.sql.exec("UPDATE native_credentials SET enabled=0 WHERE credential_id='credential_research_1'");}return result;});
  try{await assertDenied(await object.fetch(f.make('createTask',lane,input)),401);expect(reached).toBe(true);expect(domain(storage)).toEqual(before);expect(storage.sql.exec("SELECT COUNT(*) n FROM idempotency_outcomes WHERE key='original-prepared'").one().n).toBe(mode==='retained-replay'?1:0);}finally{spy.mockRestore();}
 });
 await evictDurableObject(f.a.stub);await assertDenied(await f.send('createTask',lane,input),401);recordIsolationEvidence('createTask',lane,'fingerprint-'+mode);
});
for(const lane of ['human','native'] as const)for(const operation of ['commitArtifact','downloadArtifactContent'] as const)it(lane+' '+operation+' revocation after real R2 read denies publication',async()=>{
 const f=await isolationHttpFixture(('bytes_await_'+lane+'_'+operation).toLowerCase()),prepared=await prepareIsolationOperation(f,operation,lane);
 await runInDurableObject(f.a.stub,async(_object,{storage})=>{
  const before=domain(storage),bucket=artifactBucket();let gets=0;
  const wrapped=wrapBucket(bucket,{get:async(...args:Parameters<R2Bucket['get']>)=>{const result=await bucket.get(...args);gets++;if(lane==='human')storage.sql.exec('UPDATE sessions SET expires_at=?',Date.now()-1);else storage.sql.exec("UPDATE native_credentials SET enabled=0 WHERE credential_id='credential_research_1'");return result;}});
  const response=await artifactRoutes(f.make(operation,lane,prepared.input),{...owned(storage,f.a.name),secrets:env as unknown as Record<string,unknown>},wrapped);
  await assertDenied(response,401);expect(gets).toBe(1);expect(domain(storage)).toEqual(before);
 });recordIsolationEvidence(operation,lane,'after-r2-read');
});
it('same agent cannot use a different enrolled runtime for existing run proof or replay',async()=>{
 const f=await isolationHttpFixture('same_agent_runtime'),prepared=await prepareIsolationOperation(f,'submitTaskResult','native'),second=await f.data('createRuntime','native',{body:{label:'Different runtime same agent'}});
 const before=await f.snapshot();await assertDenied(await f.send('submitTaskResult','native',{...prepared.input,proof:second.runtime_token}),401);expect((await f.snapshot()).digest).toBe(before.digest);
 const accepted=await f.send('submitTaskResult','native',prepared.input);expect(accepted.status).toBe(200);await accepted.arrayBuffer();const after=await f.snapshot();
 await assertDenied(await f.send('submitTaskResult','native',{...prepared.input,proof:second.runtime_token}),401);expect((await f.snapshot()).digest).toBe(after.digest);recordIsolationEvidence('runtime','native','different-proof');
});
it('delivery signing await rechecks retained participant authority after restart and performs no outbound send',async()=>{
 const f=await messageFixture('dispatch_await_isolation');
 await runInDurableObject(f.stub,async(_o,{storage})=>{const body=messageInput();executeCommand(await commandContext(storage,f.name,body,'send'),f.identity,messageCommand(owned(storage,f.name)),body);});
 await evictDurableObject(f.stub);
 await runInDurableObject(f.stub,async(_o,{storage})=>{
  const due=storage.sql.exec<{next_due_at:number}>('SELECT next_due_at FROM outbox').one().next_due_at,attempt=withTransaction(storage,tx=>claimDue(tx,due,25))[0];expect(attempt).toBeDefined();let signed=false,sends=0;
  const ws={...owned(storage,f.name),clock:{nowMs:()=>due},secrets:{NOTIFICATION_SIGNING_KEY:'SYNTHETIC-notification-signing-key-0123456789'}};
  const dispatcher=new DeliveryDispatcher(ws,{sign:async(...args)=>{const headers=await signNotification(...args);signed=true;storage.sql.exec("UPDATE native_credentials SET enabled=0 WHERE agent_id='agent_research'");return headers;},fetch:async()=>{sends++;return new Response();}});
  expect(await dispatcher.dispatchAttempt(attempt)).toEqual({kind:'permanent',category:'authority_revoked'});expect(signed).toBe(true);expect(sends).toBe(0);
  const row=storage.sql.exec<{status:string}>('SELECT status FROM outbox').one();expect(row.status).toBe('in_flight');recordIsolationEvidence('dispatcher','native','post-signing');
 });
});
