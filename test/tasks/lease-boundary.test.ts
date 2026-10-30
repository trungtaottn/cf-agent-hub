import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {claimFixture,claimSetup,claimContext,claimIdentity,claimSnapshot} from '../helpers/claims';
import {human} from '../helpers/settings';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {requireRuntimeProof} from '../../src/auth/runtime-proof';
import {executeCommand} from '../../src/workspace/commands';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {claimTaskCommand} from '../../src/tasks/claim';
import {heartbeatRunCommand,getRun,assertActiveRun} from '../../src/tasks/lease';
import {projectEvent,resourceEventVisibility} from '../../src/audit/events';
import type {CommandContext,VerifiedIdentity} from '../../src/workspace/context';
const proof='a'.repeat(64);
async function heartbeatContext(storage:DurableObjectStorage,name:string,body:unknown,key:string,now:number){
 const ctx=await claimContext(storage,name,body,key,now);
 return {...ctx,fingerprint:await fingerprintRequest('POST','/v2/workspaces/ws_example/runs/run_a:heartbeat',{},body)};
}
const beat={expected_run_version:1,fence:1};
function context(storage:DurableObjectStorage,identity:VerifiedIdentity,nowMs:number):CommandContext {
 return withTransaction(storage,tx=>({actor:resolveActor(tx,identity,nowMs),nowMs,requestId:'lease_read',idempotencyKey:'lease_read'}));
}
async function started(storage:DurableObjectStorage,name:string){
 const setup=claimSetup(storage),ctx=await claimContext(storage,name,setup.body,'claim',setup.now);
 const original=executeCommand(ctx,setup.identity,claimTaskCommand('task_a','run_a',proof),setup.body);
 expect(original.data.run).toMatchObject({id:'run_a',run_version:1,fence:1,lease_expires_at:new Date(setup.now+60000).toISOString()});
 return {...setup,original};
}
function stateRows(storage:DurableObjectStorage){return Object.fromEntries(['tasks','runs','runtimes','events','task_history','idempotency_outcomes','scheduler_state','outbox'].map(t=>[t,storage.sql.exec('SELECT * FROM '+t).toArray()]));}
it.each([-1,0,1])('execution expiry is exclusive at deadline %+i ms without waiting for alarm',async delta=>{
 const {stub,name}=await claimFixture('lease-deadline-'+(delta<0?'minus':delta===0?'zero':'plus'));await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name),at=now+60000+delta,ctx=await heartbeatContext(s.storage,name,beat,'beat',at),before=stateRows(s.storage);
  const renew=()=>executeCommand(ctx,identity,heartbeatRunCommand('run_a',proof),beat);
  if(delta<0){expect(renew().data).toMatchObject({run_version:2,lease_expires_at:new Date(at+60000).toISOString()});}
  else{expect(renew).toThrowError(expect.objectContaining({code:'STALE_RUN'}));expect(stateRows(s.storage)).toEqual(before);}
  expect(await s.storage.getAlarm()).toBeNull();
 });
});
it('delayed heartbeat samples transaction time and does not use caller preflight time',async()=>{
 const {stub,name}=await claimFixture('lease-delay');await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name),ctx=await heartbeatContext(s.storage,name,beat,'delayed',now+59000),before=stateRows(s.storage);
  ctx.workspace.clock={nowMs:()=>now+60000};
  expect(()=>executeCommand(ctx,identity,heartbeatRunCommand('run_a',proof),beat)).toThrowError(expect.objectContaining({code:'STALE_RUN'}));expect(stateRows(s.storage)).toEqual(before);
 });
});
it('heartbeat changes only run version and lease in domain rows, not task proposal or runtime presence',async()=>{
 const {stub,name}=await claimFixture('lease-renew-fields');await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name),before=stateRows(s.storage),ctx=await heartbeatContext(s.storage,name,beat,'renew',now+20000);
  const result=executeCommand(ctx,identity,heartbeatRunCommand('run_a',proof),beat),after=stateRows(s.storage);
  expect(result.data).toMatchObject({id:'run_a',run_version:2,fence:1,started_at:new Date(now).toISOString(),lease_expires_at:new Date(now+80000).toISOString()});
  expect(after.tasks).toEqual(before.tasks);expect(after.runtimes).toEqual(before.runtimes);expect(after.outbox).toEqual(before.outbox);
  expect(after.runs).toEqual(before.runs.map(row=>({...row,run_version:2,lease_expires_at:now+80000})));
  expect(after.events).toHaveLength(before.events.length+1);expect(after.idempotency_outcomes).toHaveLength(before.idempotency_outcomes.length+1);
  expect(after.scheduler_state[0]).toMatchObject({dirty:1,generation:Number(before.scheduler_state[0].generation)+1});
 });
});
it.each([{expected_run_version:2,fence:1},{expected_run_version:1,fence:2},{expected_run_version:0,fence:1},{expected_run_version:1,fence:0}])('renewal rejects stale or invalid version/fence %j atomically',async body=>{
 const {stub,name}=await claimFixture('lease-version-'+body.expected_run_version+'-'+body.fence);await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name),ctx=await heartbeatContext(s.storage,name,body,'bad',now+1),before=stateRows(s.storage);
  expect(()=>executeCommand(ctx,identity,heartbeatRunCommand('run_a',proof),body)).toThrow();expect(stateRows(s.storage)).toEqual(before);
 });
});
it.each(['b','c','d','e'])('another runtime or fabricated proof cannot renew owning run (%s)',async hash=>{
 const {stub,name}=await claimFixture('lease-proof-'+hash);await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name),ctx=await heartbeatContext(s.storage,name,beat,'bad-proof',now+1),before=stateRows(s.storage);
  expect(()=>executeCommand(ctx,identity,heartbeatRunCommand('run_a',hash.repeat(64)),beat)).toThrow();expect(stateRows(s.storage)).toEqual(before);
 });
});
it('another current credential for the same agent cannot take over or replay the run',async()=>{
 const {stub,name}=await claimFixture('lease-rotated');await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name),ctx=await heartbeatContext(s.storage,name,beat,'renew',now+1);
  const original=executeCommand(ctx,identity,heartbeatRunCommand('run_a',proof),beat),other=s.storage.sql.exec<{credential_id:string}>("SELECT credential_id FROM runtimes WHERE id='runtime_rotated'").one().credential_id,before=stateRows(s.storage);
  for(const hash of [proof,'c'.repeat(64)])expect(()=>executeCommand(ctx,claimIdentity(s.storage,other),heartbeatRunCommand('run_a',hash),beat)).toThrow();
  expect(stateRows(s.storage)).toEqual(before);expect(original.data.run_version).toBe(2);
 });
});
it.each(['runtime','credential','agent','presence'])('current %s revocation/expiry denies renewal and replay',async changed=>{
 const {stub,name}=await claimFixture('lease-revoke-'+changed);await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name),ctx=await heartbeatContext(s.storage,name,beat,'renew',now+1);executeCommand(ctx,identity,heartbeatRunCommand('run_a',proof),beat);
  if(changed==='runtime')s.storage.sql.exec("UPDATE runtimes SET revoked_at=? WHERE id='runtime_a'",now);
  if(changed==='credential')s.storage.sql.exec("UPDATE native_credentials SET revoked_at=? WHERE credential_id='credential_research_1'",now);
  if(changed==='agent')s.storage.sql.exec("UPDATE static_agents SET status='archived' WHERE agent_id='agent_research'");
  if(changed==='presence')ctx.workspace.clock={nowMs:()=>now+90000};
  const before=stateRows(s.storage);expect(()=>executeCommand(ctx,identity,heartbeatRunCommand('run_a',proof),beat)).toThrow();expect(stateRows(s.storage)).toEqual(before);
 });
});
it.each(['expired','ended'])('same-key heartbeat replay after %s returns original deadline without renewing or reviving',async condition=>{
 const {stub,name}=await claimFixture('lease-replay-'+condition);await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name),ctx=await heartbeatContext(s.storage,name,beat,'renew',now+1000),original=executeCommand(ctx,identity,heartbeatRunCommand('run_a',proof),beat);
  if(condition==='ended')s.storage.transactionSync(()=>{s.storage.sql.exec("UPDATE tasks SET state='review',active_run_id=NULL WHERE id='task_a'");s.storage.sql.exec("UPDATE runs SET status='submitted',ended_at=? WHERE id='run_a'",now+2000);});
  ctx.workspace.clock={nowMs:()=>now+61000};const before=stateRows(s.storage);expect(executeCommand(ctx,identity,heartbeatRunCommand('run_a',proof),beat)).toEqual(original);expect(stateRows(s.storage)).toEqual(before);
  const fresh=await heartbeatContext(s.storage,name,{expected_run_version:2,fence:1},'fresh',now+61000);expect(()=>executeCommand(fresh,identity,heartbeatRunCommand('run_a',proof),{expected_run_version:2,fence:1})).toThrowError(expect.objectContaining({code:'STALE_RUN'}));expect(stateRows(s.storage)).toEqual(before);
 });
});
it.each(['task','run','fence','runtime','pointer'])('active guard rejects mismatched %s with no side effects',async changed=>{
 const {stub,name}=await claimFixture('lease-active-'+changed);await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name),ctx=context(s.storage,identity,now+1);
  if(changed==='pointer')s.storage.sql.exec("UPDATE tasks SET state='ready',active_run_id=NULL WHERE id='task_a'");
  const before=stateRows(s.storage);expect(()=>withTransaction(s.storage,tx=>{const verified=requireRuntimeProof(tx,ctx,changed==='runtime'?'runtime_b':'runtime_a',changed==='runtime'?'b'.repeat(64):proof);return assertActiveRun(tx,ctx,changed==='task'?'task_b':'task_a',changed==='run'?'unknown':'run_a',changed==='fence'?2:1,verified);})).toThrow();expect(stateRows(s.storage)).toEqual(before);
 });
});
it('active guard accepts exact current owner and denies every ended status',async()=>{
 const {stub,name}=await claimFixture('lease-active-status');await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name),ctx=context(s.storage,identity,now+1),guard=()=>withTransaction(s.storage,tx=>assertActiveRun(tx,ctx,'task_a','run_a',1,requireRuntimeProof(tx,ctx,'runtime_a',proof)));
  expect(guard()).toMatchObject({id:'run_a',status:'active',fence:1});s.storage.sql.exec("UPDATE tasks SET state='ready',active_run_id=NULL WHERE id='task_a'");
  for(const status of ['paused','submitted','failed','expired','cancelled']){s.storage.sql.exec("UPDATE runs SET status=?,ended_at=? WHERE id='run_a'",status,now);expect(guard).toThrowError(expect.objectContaining({code:'STALE_RUN'}));}
 });
});
it('scoped getRun is a read, not an ownership transfer, and requires current tasks read',async()=>{
 const {stub,name}=await claimFixture('lease-read');await runInDurableObject(stub,async(_o,s)=>{
  const {now}=await started(s.storage,name),identity=human(s.storage),ctx=context(s.storage,identity,now+1),before=claimSnapshot(s.storage);
  expect(withTransaction(s.storage,tx=>getRun(tx,ctx,'run_a'))).toMatchObject({id:'run_a',task_id:'task_a',agent_id:'agent_research'});expect(claimSnapshot(s.storage)).toEqual(before);
  s.storage.sql.exec("UPDATE human_grants SET scopes_json='[]'");expect(()=>withTransaction(s.storage,tx=>getRun(tx,ctx,'run_a'))).toThrowError(expect.objectContaining({status:403}));
 });
});
it('getRun and run events preserve project and complete current result visibility',async()=>{
 const {stub,name}=await claimFixture('lease-read-project-result');await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name);executeCommand(await heartbeatContext(s.storage,name,beat,'renew',now+1),identity,heartbeatRunCommand('run_a',proof),beat);
  const reader=human(s.storage),eventId=s.storage.sql.exec<{id:string}>("SELECT id FROM events WHERE type='run.heartbeat'").one().id;
  const read=()=>{const ctx=context(s.storage,reader,now+2);return withTransaction(s.storage,tx=>getRun(tx,ctx,'run_a'));};
  const event=()=>withTransaction(s.storage,tx=>projectEvent(tx,resolveActor(tx,reader,now+2),eventId,now+2,resourceEventVisibility));
  s.storage.sql.exec("UPDATE tasks SET project_id='project_a' WHERE id='task_a'");s.storage.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_a\"]'");
  expect(read().id).toBe('run_a');expect(event()).toMatchObject({type:'run.heartbeat',resource_type:'run',resource_id:'run_a',task_version:3,run_id:'run_a',fence:1});
  s.storage.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_b\"]'");expect(read).toThrowError(expect.objectContaining({status:403}));expect(event()).toBeNull();
  s.storage.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_a\"]'");
  s.storage.transactionSync(()=>{s.storage.sql.exec("UPDATE tasks SET state='review',active_run_id=NULL WHERE id='task_a'");s.storage.sql.exec("UPDATE runs SET status='submitted',ended_at=? WHERE id='run_a'",now+2);
   s.storage.sql.exec("INSERT INTO task_results(id,workspace_id,task_id,run_id,submission_sequence,submitted_kind,submitted_principal_id,submitted_agent_id,summary,created_at) VALUES('hidden_result','ws_example','task_a','run_a',1,'agent','agent_research','agent_research','Hidden result',?)",now+2);
   s.storage.sql.exec("INSERT INTO artifacts(id,workspace_id,task_id,run_id,owner_kind,owner_principal_id,authority_epoch,artifact_version,filename,media_type,byte_size,sha256,status,created_at,expires_at) VALUES('hidden_artifact','ws_example','task_a','run_a','agent','agent_research',1,1,'file','text/plain',0,?,'staged',?,?)",'b'.repeat(64),now,now+900000);
   s.storage.sql.exec("INSERT INTO result_artifacts VALUES('ws_example','hidden_result','hidden_artifact',0)");s.storage.sql.exec("UPDATE tasks SET current_result_id='hidden_result' WHERE id='task_a'");
  });
  expect(read).toThrowError(expect.objectContaining({status:403}));expect(event()).toBeNull();
 });
});
it('claim and heartbeat event metadata binds the exact task run and fence without private proof or safety evidence',async()=>{
 const {stub,name}=await claimFixture('lease-event-binding',{replaySafe:true});await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name);executeCommand(await heartbeatContext(s.storage,name,beat,'renew',now+1),identity,heartbeatRunCommand('run_a',proof),beat);
  const events=s.storage.sql.exec("SELECT type,resource_type,resource_id,task_version,run_id,fence FROM events WHERE type IN ('task.claimed','run.heartbeat') ORDER BY sequence").toArray();
  expect(events).toEqual([{type:'task.claimed',resource_type:'task',resource_id:'task_a',task_version:3,run_id:'run_a',fence:1},{type:'run.heartbeat',resource_type:'run',resource_id:'run_a',task_version:3,run_id:'run_a',fence:1}]);
  const serial=JSON.stringify({events:s.storage.sql.exec('SELECT * FROM events').toArray(),outcomes:s.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray()});expect(serial).not.toContain(proof);expect(serial).not.toContain('proof_sha256');expect(serial).not.toContain('replay_evidence_ref');expect(serial).not.toContain('urn:synthetic:preexecution-evidence');
  const reader=human(s.storage),ids=s.storage.sql.exec<{id:string}>("SELECT id FROM events WHERE type IN ('task.claimed','run.heartbeat') ORDER BY sequence").toArray();
  for(const row of ids)expect(withTransaction(s.storage,tx=>projectEvent(tx,resolveActor(tx,reader,now+2),row.id,now+2,resourceEventVisibility))).not.toBeNull();
  s.storage.sql.exec("UPDATE events SET type='run.unknown' WHERE type='run.heartbeat'");expect(withTransaction(s.storage,tx=>projectEvent(tx,resolveActor(tx,reader,now+2),ids[1].id,now+2,resourceEventVisibility))).toBeNull();
 });
});
it('claim and heartbeat do not borrow an ungranted tasks read scope',async()=>{
 const {stub,name}=await claimFixture('lease-no-read',{scopes:['tasks:claim','tasks:execute','runtimes:manage']});await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name),ctx=await heartbeatContext(s.storage,name,beat,'renew',now+1);
  expect(executeCommand(ctx,identity,heartbeatRunCommand('run_a',proof),beat).data).toMatchObject({id:'run_a',run_version:2});
  const readCtx=context(s.storage,identity,now+2);expect(()=>withTransaction(s.storage,tx=>getRun(tx,readCtx,'run_a'))).toThrowError(expect.objectContaining({status:403}));
 });
});
it('an expired run remains scoped readable without regranting execution authority',async()=>{
 const {stub,name}=await claimFixture('lease-expired-readable');await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name),ctx=context(s.storage,identity,now+60000);
  expect(withTransaction(s.storage,tx=>getRun(tx,ctx,'run_a'))).toMatchObject({status:'active',lease_expires_at:new Date(now+60000).toISOString()});
  expect(()=>withTransaction(s.storage,tx=>assertActiveRun(tx,ctx,'task_a','run_a',1,requireRuntimeProof(tx,ctx,'runtime_a',proof)))).toThrowError(expect.objectContaining({code:'STALE_RUN'}));
 });
});
it('heartbeat needs current execute authority but not permission to claim another attempt',async()=>{
 const {stub,name}=await claimFixture('lease-execute-only');await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name);
  // Narrow every credential for this agent: another credential cannot mask a hidden claim requirement.
  const credentials=s.storage.sql.exec<{credential_id:string;scopes_json:string}>("SELECT credential_id,scopes_json FROM native_credentials WHERE agent_id='agent_research'").toArray();
  for(const credential of credentials)s.storage.sql.exec('UPDATE native_credentials SET scopes_json=? WHERE credential_id=?',JSON.stringify((JSON.parse(credential.scopes_json) as string[]).filter(scope=>scope!=='tasks:claim')),credential.credential_id);
  const ctx=await heartbeatContext(s.storage,name,beat,'execute-only-renew',now+20000);
  expect(executeCommand(ctx,identity,heartbeatRunCommand('run_a',proof),beat).data).toMatchObject({id:'run_a',run_version:2,lease_expires_at:new Date(now+80000).toISOString()});
  const readCtx=context(s.storage,identity,now+20000);expect(readCtx.actor.scopes.has('tasks:claim')).toBe(false);expect(readCtx.actor.scopes.has('tasks:execute')).toBe(true);
 });
});
it('heartbeat event insertion abort rolls back lease version scheduler and all retained outcomes',async()=>{
 const {stub,name}=await claimFixture('lease-event-abort');await runInDurableObject(stub,async(_o,s)=>{
  const {identity,now}=await started(s.storage,name),ctx=await heartbeatContext(s.storage,name,beat,'abort-renew',now+20000);
  s.storage.sql.exec("CREATE TRIGGER reject_heartbeat_event BEFORE INSERT ON events WHEN NEW.type='run.heartbeat' BEGIN SELECT RAISE(ABORT,'synthetic_heartbeat_abort'); END");
  const before=stateRows(s.storage);expect(()=>executeCommand(ctx,identity,heartbeatRunCommand('run_a',proof),beat)).toThrow('synthetic_heartbeat_abort');expect(stateRows(s.storage)).toEqual(before);
 });
});
