import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {runInDurableObject,evictDurableObject,runDurableObjectAlarm} from 'cloudflare:test';
import {claimFixture,claimSetup,claimContext,PROOF_A} from '../helpers/claims';
import {owned,human,commandContext} from '../helpers/settings';
import {messageInput} from '../helpers/messages';
import {claimTaskCommand} from '../../src/tasks/claim';
import {heartbeatRunCommand} from '../../src/tasks/lease';
import {createTask,readyTask} from '../../src/tasks/commands';
import {resolveActor} from '../../src/auth/authorize';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
import {withTransaction} from '../../src/storage/transaction';
import {OutboxScheduler,sweepCatalog} from '../../src/outbox/scheduler';
import {DeliveryDispatcher} from '../../src/outbox/dispatcher';
import {markSchedulerDirty} from '../../src/outbox/scheduler-state';
const scopes=['workspace:read','events:read','tasks:read','tasks:claim','tasks:execute','runtimes:manage','messages:read','messages:send'] as const;
const fixture=(name:string)=>claimFixture(name,{wip:100,scopes:[...scopes]});
beforeEach(()=>{const future=Date.now()+120000;vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(future);});
afterEach(()=>vi.useRealTimers());
const run=(storage:DurableObjectStorage,id='run_000')=>storage.sql.exec('SELECT id,status,run_version,ended_at,lease_expires_at FROM runs WHERE id=?',id).one();
function runtime(storage:DurableObjectStorage,name:string,now:()=>number){
 const workspace={...owned(storage,name),clock:{nowMs:now},secrets:{NOTIFICATION_SIGNING_KEY:'SYNTHETIC-ONLY-notification-signing-key-0123456789'}};
 const fetcher=vi.fn(async()=>new Response(null,{status:204}));
 const dispatcher=new DeliveryDispatcher(workspace,{fetch:fetcher});
 return {workspace,dispatcher,fetcher,scheduler:new OutboxScheduler(workspace,dispatcher)};
}
async function claimed(storage:DurableObjectStorage,name:string,count=1){
 const setup=claimSetup(storage),humanIdentity=human(storage);
 for(let i=0;i<count;i++){
  const taskId=i===0?'task_a':i===1?'task_b':'task_'+String(i).padStart(3,'0');
  if(i>1)withTransaction(storage,tx=>{const ctx={actor:resolveActor(tx,humanIdentity,setup.now),nowMs:setup.now,requestId:'fixture_'+i,idempotencyKey:'fixture_'+i};createTask(tx,{...ctx,taskId},{title:'Synthetic expiry task',description:''});readyTask(tx,ctx,taskId,{expected_version:1});});
  executeCommand(await claimContext(storage,name,setup.body,'claim_'+i,setup.now,taskId),setup.identity,claimTaskCommand(taskId,'run_'+String(i).padStart(3,'0'),PROOF_A),setup.body);
 }
 return setup;
}
async function send(storage:DurableObjectStorage,name:string,key='message'){
 const body=messageInput();executeCommand(await commandContext(storage,name,body,key),human(storage),messageCommand(owned(storage,name)),body);
}
it('lease_only_commit_is_armed_by_shared_scheduler_and_real_alarm_survives_eviction',async()=>{
 const {stub,name}=await fixture('expiry-real-alarm');let deadline=0;
 await runInDurableObject(stub,async(_o,state)=>{const {now}=await claimed(state.storage,name);deadline=now+60000;expect(await state.storage.getAlarm()).toBeNull();});
 await stub.repairSchedule();
 await runInDurableObject(stub,async(_o,state)=>{expect(await state.storage.getAlarm()).toBe(deadline);expect(state.storage.sql.exec('SELECT next_due_at,dirty FROM scheduler_state').one()).toEqual({next_due_at:deadline,dirty:0});});
 await evictDurableObject(stub);vi.setSystemTime(deadline);expect(await runDurableObjectAlarm(stub)).toBe(true);
 await runInDurableObject(stub,(_o,state)=>{expect(run(state.storage)).toMatchObject({status:'expired',run_version:2,ended_at:deadline});expect(state.storage.sql.exec("SELECT state,active_run_id,latest_run_id,retry_count,flags_json FROM tasks WHERE id='task_a'").one()).toEqual({state:'backlog',active_run_id:null,latest_run_id:'run_000',retry_count:0,flags_json:'["outcome_unknown"]'});expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM task_history WHERE run_id='run_000'").one().n).toBe(2);});
 await stub.runDueWork(deadline);await evictDurableObject(stub);
 await runInDurableObject(stub,(_o,state)=>{expect(run(state.storage)).toMatchObject({status:'expired',run_version:2,ended_at:deadline});expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM task_history WHERE run_id='run_000'").one().n).toBe(2);});
});
it('shared_alarm_selects_earliest_outbox_or_lease_and_renewal_moves_only_lease_deadline',async()=>{
 const {stub,name}=await fixture('expiry-earliest');await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity}=await claimed(state.storage,name);await send(state.storage,name);const r=runtime(state.storage,name,()=>now);
  await r.scheduler.repairSchedule();expect(state.storage.sql.exec('SELECT next_due_at FROM scheduler_state').one().next_due_at).toBe(now);
  withTransaction(state.storage,tx=>{tx.exec('UPDATE outbox SET next_due_at=?',[now+120000]);markSchedulerDirty(tx);});
  await r.scheduler.repairSchedule();expect(await state.storage.getAlarm()).toBe(now+60000);
  const body={expected_run_version:1,fence:1};executeCommand(await claimContext(state.storage,name,body,'renew',now+20000),identity,heartbeatRunCommand('run_000',PROOF_A),body);
  await r.scheduler.repairSchedule();expect(await state.storage.getAlarm()).toBe(now+80000);
  await runtime(state.storage,name,()=>now+60000).scheduler.runDueWork(now+60000);expect(run(state.storage)).toMatchObject({status:'active',run_version:2,lease_expires_at:now+80000});
  await runtime(state.storage,name,()=>now+80000).scheduler.runDueWork(now+80000);expect(run(state.storage)).toMatchObject({status:'expired',run_version:3});expect(await state.storage.getAlarm()).toBe(now+120000);
 });
});
it('injected_alarm_port_stale_later_arm_cannot_strand_new_earlier_lease_after_generation_race',async()=>{
 const {stub,name}=await fixture('expiry-arm-generation');await runInDurableObject(stub,async(_o,state)=>{
  const setup=claimSetup(state.storage),now=setup.now;await send(state.storage,name);
  withTransaction(state.storage,tx=>{tx.exec('UPDATE outbox SET next_due_at=?',[now+120000]);markSchedulerDirty(tx);});
  const r=runtime(state.storage,name,()=>now);let release!:()=>void,entered!:()=>void,calls=0;
  const start=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const delayed=new OutboxScheduler(r.workspace,r.dispatcher,{setAlarm:async at=>{if(++calls===1){entered();await gate;}await state.storage.setAlarm(at);},deleteAlarm:()=>state.storage.deleteAlarm()});
  const pending=delayed.repairSchedule();await start;
  executeCommand(await claimContext(state.storage,name,setup.body,'new-earlier',now),setup.identity,claimTaskCommand('task_a','run_000',PROOF_A),setup.body);
  await r.scheduler.repairSchedule();release();await pending;
  // Either exact repair or a conservative earlier wake is valid; merely dirty with a later alarm is not.
  const alarm=await state.storage.getAlarm();expect(alarm).not.toBeNull();expect(alarm!).toBeLessThanOrEqual(now+60000);
  expect(run(state.storage)).toMatchObject({status:'active',lease_expires_at:now+60000});
 });
});
it('lease_failure_preserves_prior_unit_remaining_due_and_diagnostic_while_outbox_succeeds',async()=>{
 const {stub,name}=await fixture('expiry-partial-failure');let deadline=0;
 await runInDurableObject(stub,async(_o,state)=>{
  const {now}=await claimed(state.storage,name,3);deadline=now+60000;await send(state.storage,name);
  state.storage.sql.exec("CREATE TRIGGER reject_second_expiry BEFORE UPDATE ON runs WHEN OLD.id='run_001' AND NEW.status='expired' BEGIN SELECT RAISE(ABORT,'synthetic_private_expiry_failure'); END");
  const r=runtime(state.storage,name,()=>deadline);await r.scheduler.runDueWork(deadline);
  expect(run(state.storage,'run_000')).toMatchObject({status:'expired',run_version:2});expect(run(state.storage,'run_001')).toMatchObject({status:'active',run_version:1});expect(run(state.storage,'run_002')).toMatchObject({status:'active',run_version:1});
  expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM task_history WHERE run_id='run_001'").one().n).toBe(1);
  expect(state.storage.sql.exec('SELECT status,attempts FROM outbox').one()).toEqual({status:'succeeded',attempts:1});expect(r.fetcher).toHaveBeenCalledTimes(1);
  expect(state.storage.sql.exec('SELECT last_error_code,next_due_at FROM scheduler_state').one()).toEqual({last_error_code:'DUE_WORK_FAILED',next_due_at:deadline});
  expect(JSON.stringify(state.storage.sql.exec('SELECT * FROM scheduler_state').one())).not.toContain('synthetic_private');
 });
 await evictDurableObject(stub);
 await runInDurableObject(stub,async(_o,state)=>{expect(state.storage.sql.exec('SELECT last_error_code FROM scheduler_state').one().last_error_code).toBe('DUE_WORK_FAILED');state.storage.sql.exec('DROP TRIGGER reject_second_expiry');await runtime(state.storage,name,()=>deadline).scheduler.runDueWork(deadline);expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM runs WHERE status='expired'").one().n).toBe(3);expect(state.storage.sql.exec('SELECT last_error_code FROM scheduler_state').one().last_error_code).toBeNull();expect(state.storage.sql.exec('SELECT attempts FROM outbox').one().attempts).toBe(1);});
});
it('bounded_tick_processes_25_tied_leases_and_25_outbox_intents_without_source_starvation',async()=>{
 const {stub,name}=await fixture('expiry-fair-budgets');await runInDurableObject(stub,async(_o,state)=>{
  const {now}=await claimed(state.storage,name,27);for(let i=0;i<27;i++)await send(state.storage,name,'send_'+i);
  const deadline=now+60000,r=runtime(state.storage,name,()=>deadline);await r.scheduler.runDueWork(deadline);
  expect(state.storage.sql.exec("SELECT id FROM runs WHERE status='expired' ORDER BY id").toArray().map(row=>row.id)).toEqual(Array.from({length:25},(_,i)=>'run_'+String(i).padStart(3,'0')));
  expect(state.storage.sql.exec("SELECT id FROM runs WHERE status='active' ORDER BY id").toArray().map(row=>row.id)).toEqual(['run_025','run_026']);
  expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM outbox WHERE status='succeeded'").one().n).toBe(25);expect(r.fetcher).toHaveBeenCalledTimes(25);
  expect(state.storage.sql.exec('SELECT next_due_at FROM scheduler_state').one().next_due_at).toBeLessThanOrEqual(deadline);
  await r.scheduler.runDueWork(deadline);expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM runs WHERE status='expired'").one().n).toBe(27);expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM outbox WHERE status='succeeded'").one().n).toBe(27);expect(r.fetcher).toHaveBeenCalledTimes(27);
 });
});
it('closed_maintenance_freezes_lease_and_scheduler_then_fresh_resume_expires',async()=>{
 const {stub,name}=await fixture('expiry-maintenance');await runInDurableObject(stub,async(_o,state)=>{
  const {now}=await claimed(state.storage,name),deadline=now+60000;const r=runtime(state.storage,name,()=>deadline);
  state.storage.sql.exec("UPDATE maintenance_state SET state='capturing',generation=generation+1 WHERE id=1");
  const before={runs:state.storage.sql.exec('SELECT * FROM runs').toArray(),tasks:state.storage.sql.exec('SELECT * FROM tasks').toArray(),scheduler:state.storage.sql.exec('SELECT * FROM scheduler_state').toArray()};
  expect((await r.scheduler.repairSchedule()).armed).toBe(false);await r.scheduler.runDueWork(deadline);
  expect({runs:state.storage.sql.exec('SELECT * FROM runs').toArray(),tasks:state.storage.sql.exec('SELECT * FROM tasks').toArray(),scheduler:state.storage.sql.exec('SELECT * FROM scheduler_state').toArray()}).toEqual(before);
  state.storage.sql.exec("UPDATE maintenance_state SET state='open',generation=generation+1 WHERE id=1");await r.scheduler.runDueWork(deadline);expect(run(state.storage)).toMatchObject({status:'expired'});
 });
});
it('injected_alarm_port_delayed_repair_crossing_same_epoch_maintenance_reconciles_current_deadline',async()=>{
 const {stub,name}=await fixture('expiry-maintenance-arm');await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity}=await claimed(state.storage,name);await send(state.storage,name);withTransaction(state.storage,tx=>{tx.exec('UPDATE outbox SET next_due_at=?',[now+120000]);markSchedulerDirty(tx);});const r=runtime(state.storage,name,()=>now);let release!:()=>void,entered!:()=>void,calls=0;
  const start=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const delayed=new OutboxScheduler(r.workspace,r.dispatcher,{setAlarm:async at=>{if(++calls===1){entered();await gate;}await state.storage.setAlarm(at);},deleteAlarm:()=>state.storage.deleteAlarm()});
  const pending=delayed.repairSchedule();await start;
  state.storage.sql.exec("UPDATE maintenance_state SET state='capturing',generation=generation+1 WHERE id=1");state.storage.sql.exec("UPDATE maintenance_state SET state='open',generation=generation+1 WHERE id=1");
  const body={expected_run_version:1,fence:1};executeCommand(await claimContext(state.storage,name,body,'renew-after-resume',now+20000),identity,heartbeatRunCommand('run_000',PROOF_A),body);
  release();await pending;expect(await state.storage.getAlarm()).toBe(now+80000);expect(run(state.storage)).toMatchObject({status:'active',run_version:2});
 });
});
it('failed_alarm_arm_keeps_lease_due_and_eviction_alone_is_not_repair',async()=>{
 const {stub,name}=await fixture('expiry-arm-failure');let deadline=0;
 await runInDurableObject(stub,async(_o,state)=>{
  const {now}=await claimed(state.storage,name);deadline=now+60000;const r=runtime(state.storage,name,()=>now);
  const failing=new OutboxScheduler(r.workspace,r.dispatcher,{setAlarm:async()=>{throw Error('synthetic_secret_alarm_failure');},deleteAlarm:()=>state.storage.deleteAlarm()});
  expect((await failing.repairSchedule()).armed).toBe(false);expect(state.storage.sql.exec('SELECT dirty,last_error_code FROM scheduler_state').one()).toEqual({dirty:1,last_error_code:'ALARM_ARM_FAILED'});expect(await state.storage.getAlarm()).toBeNull();
 });
 await evictDurableObject(stub);await runInDurableObject(stub,async(_o,state)=>{expect(await state.storage.getAlarm()).toBeNull();expect(run(state.storage)).toMatchObject({status:'active',lease_expires_at:deadline});});
 await sweepCatalog([{workspace_id:'ws_example',object_name:name}],{getByName:()=>stub});await runInDurableObject(stub,async(_o,state)=>{expect(await state.storage.getAlarm()).toBe(deadline);expect(state.storage.sql.exec('SELECT dirty,last_error_code FROM scheduler_state').one()).toEqual({dirty:0,last_error_code:null});});
});
it('workers_query_study_bounds_lease_reads_and_records_historical_outbox_scan',async()=>{
 const {stub,name}=await fixture('expiry-query-study');const measured=await runInDurableObject(stub,async(_o,state)=>{
  const {now}=claimSetup(state.storage),sql=state.storage.sql;
  for(let i=0;i<1201;i++){
   const active=i<201,id='study_'+String(i).padStart(4,'0'),rid='run_'+id;
   sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES(?,'ws_example','Study','','backlog',1,0,0,2,'[]',?,?)",id,now,now);
   sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at,ended_at) VALUES(?,'ws_example',?,'agent_research','runtime_a','credential_research_1',1,?,1,1,?,?,?)",rid,id,active?'active':'failed',now,now-60000,active?null:now);
   if(active)sql.exec("UPDATE tasks SET state='doing',active_run_id=?,latest_run_id=?,next_fence=2 WHERE id=?",rid,rid,id);
  }
  const samples=[];for(const limit of [1,25,200]){const q=sql.exec("SELECT id FROM runs WHERE workspace_id=? AND status='active' AND lease_expires_at<=? ORDER BY lease_expires_at,id LIMIT ?",'ws_example',now,limit);expect(q.toArray()).toHaveLength(limit);expect(q.rowsRead).toBeLessThanOrEqual(limit);samples.push({limit,rowsRead:q.rowsRead});}
  const next=sql.exec("SELECT lease_expires_at FROM runs WHERE workspace_id=? AND status='active' ORDER BY lease_expires_at,id LIMIT 1",'ws_example');expect(next.one().lease_expires_at).toBe(now);expect(next.rowsRead).toBeLessThanOrEqual(1);
  const plan=sql.exec("EXPLAIN QUERY PLAN SELECT id FROM runs WHERE workspace_id=? AND status='active' AND lease_expires_at<=? ORDER BY lease_expires_at,id LIMIT ?",'ws_example',now,25).toArray();expect(JSON.stringify(plan)).toContain('runs_lease_due');
  for(let i=0;i<40;i++)await send(state.storage,name,'study_send_'+i);
  const outbox=sql.exec("SELECT MIN(CASE WHEN status='in_flight' THEN lease_expires_at ELSE next_due_at END) AS due FROM outbox WHERE status IN ('pending','in_flight')");expect(outbox.one().due).toBe(now);expect(outbox.rowsRead).toBeGreaterThan(25);
  const due=sql.exec("SELECT * FROM outbox WHERE (status='pending' AND next_due_at<=?) OR (status='in_flight' AND lease_expires_at<=?) ORDER BY CASE WHEN status='in_flight' THEN lease_expires_at ELSE next_due_at END,id LIMIT ?",now,now,25);expect(due.toArray()).toHaveLength(25);
  expect(sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
  return {active:201,terminal:1000,samples,nextRowsRead:next.rowsRead,leasePlan:plan,historicalOutboxRows:40,outboxMinRowsRead:outbox.rowsRead,outboxClaimRowsRead:due.rowsRead,scope:'Lease reads bounded; historical outbox query shape is not bounded by returned-row budgets and was replaced in issue30.'};
 });console.info('EXPIRY_QUERY_STUDY '+JSON.stringify(measured));
});
it('revoked_runtime_owner_does_not_block_trusted_expiry_or_gain_a_replacement_claim',async()=>{
 const {stub,name}=await fixture('expiry-revoked-owner');await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=await claimed(state.storage,name);state.storage.sql.exec("UPDATE native_credentials SET revoked_at=? WHERE credential_id='credential_research_1'",now+1);
  state.storage.sql.exec("UPDATE runtimes SET revoked_at=? WHERE id='runtime_a'",now+1);
  const deadline=now+60000;await runtime(state.storage,name,()=>deadline).scheduler.runDueWork(deadline);
  expect(run(state.storage)).toMatchObject({status:'expired',ended_at:deadline});
  const event=state.storage.sql.exec<{actor_json:string;run_id:string;fence:number;task_version:number}>("SELECT actor_json,run_id,fence,task_version FROM events WHERE type='task.expired'").one();
  expect(JSON.parse(event.actor_json)).toMatchObject({kind:'system',agent_id:null});expect(event).toMatchObject({run_id:'run_000',fence:1,task_version:4});
  const ctx=await claimContext(state.storage,name,body,'revoked-reclaim',deadline,'task_b');expect(()=>executeCommand(ctx,identity,claimTaskCommand('task_b','run_forbidden',PROOF_A),body)).toThrow();expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM runs').one().n).toBe(1);
 });
});
it('injected_repair_await_crossing_maintenance_cannot_expire_newly_due_runs_or_dispatch_old_batch',async()=>{
 const {stub,name}=await fixture('expiry-work-maintenance');await runInDurableObject(stub,async(_o,state)=>{
  const {now}=await claimed(state.storage,name);await send(state.storage,name);let current=now,release!:()=>void,entered!:()=>void,calls=0;
  const r=runtime(state.storage,name,()=>current),start=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const scheduler=new OutboxScheduler(r.workspace,r.dispatcher,{setAlarm:async at=>{if(++calls===1){entered();await gate;}await state.storage.setAlarm(at);},deleteAlarm:()=>state.storage.deleteAlarm()});
  const pending=scheduler.runDueWork(now);await start;
  state.storage.sql.exec("UPDATE maintenance_state SET state='capturing',generation=generation+1 WHERE id=1");state.storage.sql.exec("UPDATE maintenance_state SET state='open',generation=generation+1 WHERE id=1");current=now+60000;
  const protectedState={runs:state.storage.sql.exec('SELECT * FROM runs').toArray(),tasks:state.storage.sql.exec('SELECT * FROM tasks').toArray(),outbox:state.storage.sql.exec('SELECT * FROM outbox').toArray()};
  release();await pending;
  expect({runs:state.storage.sql.exec('SELECT * FROM runs').toArray(),tasks:state.storage.sql.exec('SELECT * FROM tasks').toArray(),outbox:state.storage.sql.exec('SELECT * FROM outbox').toArray()}).toEqual(protectedState);expect(r.fetcher).not.toHaveBeenCalled();expect(run(state.storage)).toMatchObject({status:'active'});
  await r.scheduler.runDueWork(current);expect(run(state.storage)).toMatchObject({status:'expired'});
 });
});
it('scheduler_sql_ack_failure_does_not_lose_dirty_lease_work_across_eviction',async()=>{
 const {stub,name}=await fixture('expiry-repair-sql-failure');let deadline=0;
 await runInDurableObject(stub,async(_o,state)=>{
  const {now}=await claimed(state.storage,name);deadline=now+60000;
  state.storage.sql.exec("CREATE TRIGGER reject_schedule_ack BEFORE UPDATE ON scheduler_state WHEN NEW.dirty=0 BEGIN SELECT RAISE(ABORT,'synthetic_scheduler_ack_failure'); END");
  // The port write can succeed while the subsequent SQL acknowledgement rolls back.
  await expect(runtime(state.storage,name,()=>now).scheduler.repairSchedule()).rejects.toThrow('synthetic_scheduler_ack_failure');
  expect(run(state.storage)).toMatchObject({status:'active',lease_expires_at:deadline});expect(state.storage.sql.exec('SELECT dirty FROM scheduler_state').one().dirty).toBe(1);expect(await state.storage.getAlarm()).toBe(deadline);
  state.storage.sql.exec('DROP TRIGGER reject_schedule_ack');
 });
 await evictDurableObject(stub);await stub.repairSchedule();
 await runInDurableObject(stub,async(_o,state)=>{expect(await state.storage.getAlarm()).toBe(deadline);expect(state.storage.sql.exec('SELECT next_due_at,dirty FROM scheduler_state').one()).toEqual({next_due_at:deadline,dirty:0});});
});
it('injected_repeated_generation_churn_uses_bounded_conservative_physical_wake',async()=>{
 const {stub,name}=await fixture('expiry-bounded-fallback');await runInDurableObject(stub,async(_o,state)=>{
  const {now}=await claimed(state.storage,name),r=runtime(state.storage,name,()=>now);let arms=0;
  const scheduler=new OutboxScheduler(r.workspace,r.dispatcher,{setAlarm:async at=>{arms++;if(arms<=2)withTransaction(state.storage,tx=>markSchedulerDirty(tx));await state.storage.setAlarm(at);},deleteAlarm:()=>state.storage.deleteAlarm()});
  const receipt=await scheduler.repairSchedule();expect(arms).toBe(3);expect(receipt).toMatchObject({armed:true,dirty:true,nextDueAt:now+60000});expect(await state.storage.getAlarm()).toBe(now+1);expect(state.storage.sql.exec('SELECT dirty,next_due_at FROM scheduler_state').one()).toEqual({dirty:1,next_due_at:now+60000});
 });
});
it('injected_conservative_wake_write_failure_is_redacted_and_remains_repairable',async()=>{
 const {stub,name}=await fixture('expiry-fallback-fails');await runInDurableObject(stub,async(_o,state)=>{
  const {now}=await claimed(state.storage,name),r=runtime(state.storage,name,()=>now);let arms=0;
  const scheduler=new OutboxScheduler(r.workspace,r.dispatcher,{setAlarm:async at=>{if(++arms<=2){withTransaction(state.storage,tx=>markSchedulerDirty(tx));await state.storage.setAlarm(at);}else throw Error('synthetic_sensitive_fallback');},deleteAlarm:()=>state.storage.deleteAlarm()});
  const receipt=await scheduler.repairSchedule();expect(arms).toBe(3);expect(receipt).toMatchObject({armed:false,dirty:true});expect(state.storage.sql.exec('SELECT dirty,last_error_code FROM scheduler_state').one()).toEqual({dirty:1,last_error_code:'ALARM_ARM_FAILED'});expect(run(state.storage)).toMatchObject({status:'active'});
  await r.scheduler.repairSchedule();expect(await state.storage.getAlarm()).toBe(now+60000);expect(state.storage.sql.exec('SELECT dirty,last_error_code FROM scheduler_state').one()).toEqual({dirty:0,last_error_code:null});
 });
});
it('injected_stale_delete_alarm_is_repaired_after_first_lease_commits',async()=>{
 const {stub,name}=await fixture('expiry-delete-race');await runInDurableObject(stub,async(_o,state)=>{
  const setup=claimSetup(state.storage),r=runtime(state.storage,name,()=>setup.now);let release!:()=>void,entered!:()=>void;
  const start=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const old=new OutboxScheduler(r.workspace,r.dispatcher,{setAlarm:at=>state.storage.setAlarm(at),deleteAlarm:async()=>{entered();await gate;await state.storage.deleteAlarm();}});
  const pending=old.repairSchedule();await start;executeCommand(await claimContext(state.storage,name,setup.body,'first-lease',setup.now),setup.identity,claimTaskCommand('task_a','run_000',PROOF_A),setup.body);await r.scheduler.repairSchedule();release();await pending;
  expect(await state.storage.getAlarm()).not.toBeNull();expect((await state.storage.getAlarm())!).toBeLessThanOrEqual(setup.now+60000);
 });
});
it('injected_second_maintenance_churn_during_reconciliation_cannot_strand_earlier_lease',async()=>{
 const {stub,name}=await fixture('expiry-reconcile-maintenance-churn');await runInDurableObject(stub,async(_o,state)=>{
  const setup=claimSetup(state.storage),now=setup.now;await send(state.storage,name);withTransaction(state.storage,tx=>{tx.exec('UPDATE outbox SET next_due_at=?',[now+120000]);markSchedulerDirty(tx);});
  const r=runtime(state.storage,name,()=>now);let arms=0;
  const scheduler=new OutboxScheduler(r.workspace,r.dispatcher,{setAlarm:async at=>{
   arms++;if(arms<=2){state.storage.sql.exec("UPDATE maintenance_state SET state='capturing',generation=generation+1 WHERE id=1");state.storage.sql.exec("UPDATE maintenance_state SET state='open',generation=generation+1 WHERE id=1");}
   if(arms===2)executeCommand(await claimContext(state.storage,name,setup.body,'during-second-repair',now),setup.identity,claimTaskCommand('task_a','run_000',PROOF_A),setup.body);
   await state.storage.setAlarm(at);
  },deleteAlarm:()=>state.storage.deleteAlarm()});
  await scheduler.repairSchedule();expect(arms).toBeLessThanOrEqual(6);expect(run(state.storage)).toMatchObject({status:'active',lease_expires_at:now+60000});expect(await state.storage.getAlarm()).not.toBeNull();expect((await state.storage.getAlarm())!).toBeLessThanOrEqual(now+60000);
 });
});
