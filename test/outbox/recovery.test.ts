import {assertAdmissionOpen} from '../../src/recovery/maintenance';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {messageFixture,messageInput,owned,commandContext} from '../helpers/messages';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
import {withTransaction} from '../../src/storage/transaction';
import {claimDue,finishAttempt} from '../../src/outbox/repository';
import {DeliveryDispatcher} from '../../src/outbox/dispatcher';
import {OutboxScheduler,sweepCatalog} from '../../src/outbox/scheduler';
import {markSchedulerDirty} from '../../src/outbox/scheduler-state';
import {canonicalJson} from '../../src/config/bootstrap';
const key='SYNTHETIC-ONLY-notification-signing-key-0123456789';
// Clock-only fixture control keeps alarm wakeups from racing explicit fault boundaries.
beforeEach(()=>{const future=Date.now()+60000;vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(future);});
afterEach(()=>vi.useRealTimers());
async function send(storage:DurableObjectStorage,name:string,identity:Parameters<typeof executeCommand>[1],id='send'){
 const body=messageInput();return executeCommand(await commandContext(storage,name,body,id),identity,messageCommand(owned(storage,name)),body).data;
}
function runtime(storage:DurableObjectStorage,name:string,now:()=>number,fetcher:typeof fetch=async()=>new Response(null,{status:503})){
 const workspace={...owned(storage,name),clock:{nowMs:now},secrets:{NOTIFICATION_SIGNING_KEY:key}};
 const dispatcher=new DeliveryDispatcher(workspace,{fetch:fetcher});
 return {workspace,dispatcher,scheduler:new OutboxScheduler(workspace,dispatcher)};
}
const row=(storage:DurableObjectStorage)=>storage.sql.exec<any>('SELECT * FROM outbox ORDER BY id').one();
function policy(storage:DurableObjectStorage,change:(c:any)=>void){withTransaction(storage,tx=>{const c=JSON.parse(tx.one<{config_json:string}>('SELECT config_json FROM workspace_metadata')!.config_json);change(c);tx.exec('UPDATE workspace_metadata SET config_json=?',[canonicalJson(c)]);});}
it('restart_preserves_attempt_count_and_jitter_due_time',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-restart');let snapshot:any;
 await runInDurableObject(stub,async(_o,state)=>{
  await send(state.storage,name,identity);const now=row(state.storage).next_due_at;state.storage.sql.exec('UPDATE outbox SET retry_multiplier=.8');
  await runtime(state.storage,name,()=>now).scheduler.runDueWork(now);
  snapshot=row(state.storage);expect(snapshot).toMatchObject({attempts:1,status:'pending',next_due_at:now+4000,retry_multiplier:.8,last_status:503});
 });
 await evictDurableObject(stub);
 await runInDurableObject(stub,async(_o,state)=>{expect(row(state.storage)).toEqual(snapshot);await runtime(state.storage,name,()=>snapshot.next_due_at-1).scheduler.runDueWork(snapshot.next_due_at-1);expect(row(state.storage)).toEqual(snapshot);console.info('OUTBOX_RESTART_SQL',JSON.stringify(snapshot));});
});
it('duplicate_alarm_does_not_create_parallel_attempt',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-duplicate');await runInDurableObject(stub,async(_o,state)=>{
  await send(state.storage,name,identity);const now=row(state.storage).next_due_at;let release!:()=>void,started!:()=>void;const entered=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);let calls=0;
  const r=runtime(state.storage,name,()=>now,async()=>{calls++;started();await gate;return new Response(null,{status:204});});
  const first=r.scheduler.runDueWork(now);await entered;await r.scheduler.runDueWork(now);expect(row(state.storage)).toMatchObject({attempts:1,status:'in_flight',lease_expires_at:now+30000});release();await first;
  expect(calls).toBe(1);expect(row(state.storage)).toMatchObject({attempts:1,status:'succeeded',last_status:204});expect(state.storage.sql.exec('SELECT acknowledged_at FROM inbox').one().acknowledged_at).toBeNull();
 });
});
it('crash_before_fetch_consumes_reserved_attempt',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-before-fetch');let now=0,attempt:any;
 await runInDurableObject(stub,async(_o,state)=>{await send(state.storage,name,identity);now=row(state.storage).next_due_at;state.storage.sql.exec('UPDATE outbox SET retry_multiplier=.8');attempt=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];expect(attempt.attemptNumber).toBe(1);expect(row(state.storage).attempts).toBe(1);});
 await evictDurableObject(stub);
 await runInDurableObject(stub,async(_o,state)=>{
  now+=30000;const r=runtime(state.storage,name,()=>now);await r.scheduler.runDueWork(now);expect(row(state.storage)).toMatchObject({attempts:1,status:'pending',last_error:'outcome_unknown',next_due_at:now+4000});
  withTransaction(state.storage,tx=>finishAttempt(tx,attempt.attemptId,{kind:'delivered',status:200},now,attempt.admissionFence));expect(row(state.storage).status).toBe('pending');
  now+=4000;await r.scheduler.runDueWork(now);expect(row(state.storage).attempts).toBe(2);
 });
});
it('remote_acceptance_then_crash_redelivers_same_identity',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-after-remote');let now=0,first:any,body='',delivery='';
 await runInDurableObject(stub,async(_o,state)=>{await send(state.storage,name,identity);now=row(state.storage).next_due_at;state.storage.sql.exec('UPDATE outbox SET retry_multiplier=1');first=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];
  const r=runtime(state.storage,name,()=>now,async(input,init)=>{const req=new Request(input,init);body=await req.text();delivery=req.headers.get('X-CF-Agent-Hub-Delivery-Id')!;return new Response(null,{status:200});});expect((await r.dispatcher.dispatchAttempt(first)).kind).toBe('delivered');expect(row(state.storage).status).toBe('in_flight');
 });
 await evictDurableObject(stub);
 await runInDurableObject(stub,async(_o,state)=>{now+=30000;let secondBody='',secondDelivery='';const r=runtime(state.storage,name,()=>now,async(input,init)=>{const req=new Request(input,init);secondBody=await req.text();secondDelivery=req.headers.get('X-CF-Agent-Hub-Delivery-Id')!;return new Response(null,{status:200});});await r.scheduler.runDueWork(now);now=row(state.storage).next_due_at;await r.scheduler.runDueWork(now);expect(secondBody).toBe(body);expect(secondDelivery).toBe(delivery);expect(row(state.storage)).toMatchObject({attempts:2,status:'succeeded'});console.info('OUTBOX_REMOTE_GAP_SQL',JSON.stringify(row(state.storage)));});
});
it('six_attempts_end_in_visible_failure',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-six');let now=0;
 await runInDurableObject(stub,async(_o,state)=>{await send(state.storage,name,identity);now=row(state.storage).next_due_at;state.storage.sql.exec('UPDATE outbox SET retry_multiplier=1');});
 const expected=[5000,30000,120000,600000,3600000];
 for(let i=0;i<6;i++){
  await runInDurableObject(stub,async(_o,state)=>{await runtime(state.storage,name,()=>now).scheduler.runDueWork(now);const current=row(state.storage);expect(current.attempts).toBe(i+1);expect(current.status).toBe(i===5?'exhausted':'pending');if(i<5){expect(current.next_due_at).toBe(now+expected[i]);now=current.next_due_at;}expect(state.storage.sql.exec('SELECT count(*) AS n FROM messages').one().n).toBe(1);expect(state.storage.sql.exec('SELECT count(*) AS n FROM inbox').one().n).toBe(1);console.info('OUTBOX_SPENT_BUDGET_SQL',JSON.stringify(current));});
  await evictDurableObject(stub);
 }
 await runInDurableObject(stub,async(_o,state)=>{await runtime(state.storage,name,()=>now+9999999).scheduler.runDueWork(now+9999999);expect(row(state.storage).attempts).toBe(6);});
});
it('ack_before_claim_suppresses_delivery',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-ack-before');await runInDurableObject(stub,async(_o,state)=>{await send(state.storage,name,identity);const now=row(state.storage).next_due_at;state.storage.sql.exec('UPDATE inbox SET acknowledged_at=?',now);const attempts=withTransaction(state.storage,tx=>claimDue(tx,now,25));expect(attempts).toEqual([]);expect(row(state.storage)).toMatchObject({attempts:0,status:'suppressed'});});
});
it('ack_during_fetch_cannot_retract_started_delivery',async()=>{
 for(const status of [204,503]){const {stub,name,identity}=await messageFixture('outbox-ack-during-'+status);await runInDurableObject(stub,async(_o,state)=>{await send(state.storage,name,identity);const now=row(state.storage).next_due_at;const r=runtime(state.storage,name,()=>now,async()=>{state.storage.sql.exec('UPDATE inbox SET acknowledged_at=?',now);return new Response(null,{status});});await r.scheduler.runDueWork(now);expect(row(state.storage)).toMatchObject({attempts:1,last_status:status,status:status===204?'succeeded':'suppressed'});});}
});
it('claim_checks_exact_recipient_ack_and_never_spends_legacy_attempts',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-legacy');await runInDurableObject(stub,async(_o,state)=>{await send(state.storage,name,identity);const now=row(state.storage).next_due_at;state.storage.sql.exec('INSERT INTO inbox VALUES (?,?,?,?,?)',row(state.storage).message_id,'other','ws_example',now,now);state.storage.sql.exec('UPDATE outbox SET destination_snapshot_json=NULL');const original=row(state.storage);expect(withTransaction(state.storage,tx=>claimDue(tx,now,25))).toEqual([]);expect(row(state.storage)).toMatchObject({attempts:0,status:'cancelled',last_error:null,payload_json:original.payload_json,destination_snapshot_json:null});});
});
it('claim_validates_closed_payload_and_all_row_relationships_before_spending',async()=>{
 const variants=[(s:DurableObjectStorage)=>s.sql.exec("UPDATE outbox SET notification_id='wrong'"),(s:DurableObjectStorage)=>{const p=JSON.parse(row(s).payload_json);p.extra=true;s.sql.exec('UPDATE outbox SET payload_json=?',JSON.stringify(p));},(s:DurableObjectStorage)=>s.sql.exec("UPDATE events SET resource_id='wrong' WHERE type='message.accepted'"),(s:DurableObjectStorage)=>s.sql.exec('DELETE FROM inbox')];
 for(let i=0;i<variants.length;i++){const {stub,name,identity}=await messageFixture('outbox-invalid-'+i);await runInDurableObject(stub,async(_o,state)=>{await send(state.storage,name,identity);variants[i](state.storage);expect(withTransaction(state.storage,tx=>claimDue(tx,row(state.storage).next_due_at,25))).toEqual([]);expect(row(state.storage)).toMatchObject({attempts:0,status:'cancelled',last_error:'invalid_intent'});});}
});
it('claim_is_bounded_to_25_and_live_lease_is_not_reclaimed',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-25');await runInDurableObject(stub,async(_o,state)=>{for(let i=0;i<27;i++)await send(state.storage,name,identity,'send'+i);const now=Date.now();expect(withTransaction(state.storage,tx=>claimDue(tx,now,25))).toHaveLength(25);expect(withTransaction(state.storage,tx=>claimDue(tx,now,25))).toHaveLength(2);expect(withTransaction(state.storage,tx=>claimDue(tx,now,25))).toHaveLength(0);});
});
it('commit_before_alarm_arm_repaired_without_user_request',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-commit-gap');let due=0;
 await runInDurableObject(stub,async(_o,state)=>{await send(state.storage,name,identity);due=row(state.storage).next_due_at;expect(await state.storage.getAlarm()).toBeNull();expect(state.storage.sql.exec('SELECT dirty FROM scheduler_state').one().dirty).toBe(1);});
 await evictDurableObject(stub);
 await sweepCatalog([{workspace_id:'ws_example',object_name:name}],{getByName:()=>stub});
 await runInDurableObject(stub,async(_o,state)=>{expect(await state.storage.getAlarm()).not.toBeNull();expect(state.storage.sql.exec('SELECT next_due_at,dirty FROM scheduler_state').one()).toEqual({next_due_at:due,dirty:0});});
});
it('exhausted_platform_retries_rearmed_by_sweep',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-platform-gap');await runInDurableObject(stub,async(_o,state)=>{await send(state.storage,name,identity);await runtime(state.storage,name,()=>Date.now()).scheduler.repairSchedule();await state.storage.deleteAlarm();state.storage.sql.exec('UPDATE scheduler_state SET dirty=0');});
 await sweepCatalog([{workspace_id:'ws_example',object_name:name}],{getByName:()=>stub});
 await runInDurableObject(stub,async(_o,state)=>{expect(await state.storage.getAlarm()).not.toBeNull();expect(row(state.storage).attempts).toBe(0);});
});
it('insertion_during_arming_cannot_clear_new_generation_and_stale_arm_reasserts_dirty',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-arm-race');await runInDurableObject(stub,async(_o,state)=>{
  await send(state.storage,name,identity);let now=row(state.storage).next_due_at;const r=runtime(state.storage,name,()=>now);let entered!:()=>void,release!:()=>void;const start=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  const old=new OutboxScheduler(r.workspace,r.dispatcher,{setAlarm:async at=>{entered();await gate;await state.storage.setAlarm(at);},deleteAlarm:()=>state.storage.deleteAlarm()});
  const pending=old.repairSchedule();await start;await send(state.storage,name,identity,'inserted');withTransaction(state.storage,tx=>{tx.exec('UPDATE outbox SET next_due_at=?',[now-1000]);markSchedulerDirty(tx);});await r.scheduler.repairSchedule();release();await pending;
  expect(state.storage.sql.exec('SELECT dirty FROM scheduler_state').one().dirty).toBe(1);await r.scheduler.repairSchedule();expect(state.storage.sql.exec('SELECT dirty FROM scheduler_state').one().dirty).toBe(0);expect(state.storage.sql.exec('SELECT next_due_at FROM scheduler_state').one().next_due_at).toBe(now-1000);
 });
});
it('arm_failure_keeps_acceptance_and_persisted_diagnostics',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-arm-failure');await runInDurableObject(stub,async(_o,state)=>{await send(state.storage,name,identity);const r=runtime(state.storage,name,()=>Date.now());const scheduler=new OutboxScheduler(r.workspace,r.dispatcher,{setAlarm:async()=>{throw Error('sensitive provider details');},deleteAlarm:async()=>{}});expect((await scheduler.repairSchedule()).armed).toBe(false);expect(state.storage.sql.exec('SELECT dirty,last_error_code FROM scheduler_state').one()).toEqual({dirty:1,last_error_code:'ALARM_ARM_FAILED'});expect(state.storage.sql.exec('SELECT count(*) AS n FROM messages').one().n).toBe(1);});
});

it('claimed_batch_starts_concurrently_before_the_lease_expires',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-concurrent-25');await runInDurableObject(stub,async(_o,state)=>{
  for(let i=0;i<27;i++)await send(state.storage,name,identity,'batch'+i);const now=Date.now();let entered!:()=>void,release!:()=>void,calls=0;
  const start=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r),r=runtime(state.storage,name,()=>now,async()=>{if(++calls===25)entered();await gate;return new Response(null,{status:204});});
  const pending=r.scheduler.runDueWork(now);await start;expect(state.storage.sql.exec("SELECT count(*) AS n FROM outbox WHERE status='in_flight'").one().n).toBe(25);expect(calls).toBe(25);release();await pending;expect(state.storage.sql.exec("SELECT count(*) AS n FROM outbox WHERE status='succeeded'").one().n).toBe(25);expect(state.storage.sql.exec("SELECT count(*) AS n FROM outbox WHERE status='pending'").one().n).toBe(2);
 });
});
it('late_completion_cannot_overwrite_a_new_live_attempt_and_final_crash_exhausts_budget',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-late');await runInDurableObject(stub,async(_o,state)=>{
  await send(state.storage,name,identity);let now=row(state.storage).next_due_at;const old=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];
  now+=30000;withTransaction(state.storage,tx=>claimDue(tx,now,25));now=row(state.storage).next_due_at;const fresh=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];
  withTransaction(state.storage,tx=>finishAttempt(tx,old.attemptId,{kind:'delivered',status:200},now,old.admissionFence));expect(row(state.storage)).toMatchObject({status:'in_flight',lease_token:fresh.attemptId,attempts:2});
  state.storage.sql.exec('UPDATE outbox SET attempts=6');now+=30000;withTransaction(state.storage,tx=>claimDue(tx,now,25));expect(row(state.storage)).toMatchObject({attempts:6,status:'exhausted',last_error:'outcome_unknown'});expect(withTransaction(state.storage,tx=>claimDue(tx,now+99999999,25))).toEqual([]);
 });
});
it('another_recipients_ack_does_not_suppress_this_intent',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-target-ack');await runInDurableObject(stub,async(_o,state)=>{await send(state.storage,name,identity);const now=row(state.storage).next_due_at;state.storage.sql.exec('INSERT INTO inbox VALUES (?,?,?,?,?)',row(state.storage).message_id,'other','ws_example',now,now);expect(withTransaction(state.storage,tx=>claimDue(tx,now,25))).toHaveLength(1);expect(row(state.storage)).toMatchObject({status:'in_flight',attempts:1});});
});

it('legacy_null_routing_cancellation_preserves_transport_and_lease_history_across_restart',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-legacy-history');let retained:any,now=0;
 await runInDurableObject(stub,async(_o,state)=>{
  await send(state.storage,name,identity);now=row(state.storage).next_due_at;
  state.storage.sql.exec("UPDATE outbox SET destination_snapshot_json=NULL,attempts=3,last_status=429,last_error='http_transient',lease_token='legacy-spent-attempt',lease_expires_at=?",now+30000);
  const before=row(state.storage);let fetched=false;const r=runtime(state.storage,name,()=>now,async()=>{fetched=true;return new Response();});
  await r.scheduler.runDueWork(now);retained=row(state.storage);
  expect(retained).toEqual({...before,status:'cancelled',updated_at:now});expect(fetched).toBe(false);
 });
 await evictDurableObject(stub);
 await runInDurableObject(stub,async(_o,state)=>{
  let fetched=false;await runtime(state.storage,name,()=>now+9999999,async()=>{fetched=true;return new Response();}).scheduler.runDueWork(now+9999999);
  withTransaction(state.storage,tx=>finishAttempt(tx,'legacy-spent-attempt',{kind:'delivered',status:200},now+1,assertAdmissionOpen(tx)));
  expect(row(state.storage)).toEqual(retained);expect(fetched).toBe(false);console.info('LEGACY_NULL_INERT_HISTORY',JSON.stringify(retained));
 });
});

it('maintenance_pauses_run_and_repair_without_sql_or_alarm_mutation',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-maintenance-noop');await runInDurableObject(stub,async(_o,state)=>{
  await send(state.storage,name,identity);const now=row(state.storage).next_due_at;let fetched=false,alarms=0;
  const r=runtime(state.storage,name,()=>now,async()=>{fetched=true;return new Response();}),scheduler=new OutboxScheduler(r.workspace,r.dispatcher,{setAlarm:async()=>{alarms++;},deleteAlarm:async()=>{alarms++;}});
  state.storage.sql.exec("UPDATE maintenance_state SET state='capturing',generation=generation+1,updated_at=? WHERE id=1",now);
  const before={outbox:row(state.storage),scheduler:state.storage.sql.exec('SELECT * FROM scheduler_state').one()};
  expect((await scheduler.repairSchedule()).armed).toBe(false);await scheduler.runDueWork(now);
  expect({outbox:row(state.storage),scheduler:state.storage.sql.exec('SELECT * FROM scheduler_state').one()}).toEqual(before);expect(alarms).toBe(0);expect(fetched).toBe(false);
 });
});
it('maintenance_entered_during_arm_preserves_scheduler_sql_on_success_and_error',async()=>{
 for(const fails of [false,true]){const {stub,name,identity}=await messageFixture('outbox-maintenance-arm-'+fails);await runInDurableObject(stub,async(_o,state)=>{
  await send(state.storage,name,identity);const now=row(state.storage).next_due_at,r=runtime(state.storage,name,()=>now);let entered!:()=>void,release!:()=>void;
  const start=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r),scheduler=new OutboxScheduler(r.workspace,r.dispatcher,{setAlarm:async()=>{entered();await gate;if(fails)throw Error('synthetic arming failure');},deleteAlarm:async()=>{throw Error('unexpected delete');}});
  const pending=scheduler.repairSchedule();await start;state.storage.sql.exec("UPDATE maintenance_state SET state='capturing',generation=generation+1,updated_at=? WHERE id=1",now);const before=state.storage.sql.exec('SELECT * FROM scheduler_state').one();release();await pending;expect(state.storage.sql.exec('SELECT * FROM scheduler_state').one()).toEqual(before);
 });}
});
it('maintenance_entered_during_fetch_freezes_completion_and_scheduler_sql',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-maintenance-fetch');await runInDurableObject(stub,async(_o,state)=>{
  await send(state.storage,name,identity);const now=row(state.storage).next_due_at;let frozen:any;
  const r=runtime(state.storage,name,()=>now,async()=>{state.storage.sql.exec("UPDATE maintenance_state SET state='capturing',generation=generation+1,updated_at=? WHERE id=1",now);frozen={outbox:row(state.storage),scheduler:state.storage.sql.exec('SELECT * FROM scheduler_state').one()};return new Response(null,{status:204});});
  await r.scheduler.runDueWork(now);expect({outbox:row(state.storage),scheduler:state.storage.sql.exec('SELECT * FROM scheduler_state').one()}).toEqual(frozen);expect(row(state.storage)).toMatchObject({status:'in_flight',attempts:1});
 });
});
