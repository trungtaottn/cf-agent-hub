import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {runInDurableObject,evictDurableObject,runDurableObjectAlarm,createScheduledController} from 'cloudflare:test';
import {env} from 'cloudflare:workers';
import worker from '../../src/index';
import {messageFixture,messageInput,owned,commandContext} from '../helpers/messages';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
import {control} from '../helpers/auth';
// Keep real alarms in the future so the explicit platform callback cannot race an automatic wakeup.
beforeEach(()=>{const future=Date.now()+60000;vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(future);});
afterEach(()=>vi.useRealTimers());
function forDelivery(e:any,id:string){return {requests:e.requests.filter((r:any)=>JSON.parse(r.body).delivery_id===id),ledger:{deliveries:e.ledger.deliveries.filter((r:any)=>JSON.parse(r.binding_key)[2]===id),effects:e.ledger.effects.filter((r:any)=>JSON.parse(r.binding_key)[2]===id)}};}
it('production_alarm_fetches_exact_persisted_intent_and_receiver_deduplicates_after_reentry',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-real-alarm');let original='',id='';
 await runInDurableObject(stub,async(_o,state)=>{const body=messageInput();executeCommand(await commandContext(state.storage,name,body,'send'),identity,messageCommand(owned(state.storage,name)),body);const row=state.storage.sql.exec<any>('SELECT * FROM outbox').one();original=row.payload_json;id=row.id;expect(row.attempts).toBe(0);});
 await stub.repairSchedule();await evictDurableObject(stub);expect(await runDurableObjectAlarm(stub)).toBe(true);
 await runInDurableObject(stub,(_o,state)=>{expect(state.storage.sql.exec('SELECT status,attempts,last_status FROM outbox').one()).toEqual({status:'succeeded',attempts:1,last_status:200});expect(state.storage.sql.exec('SELECT acknowledged_at FROM inbox').one().acknowledged_at).toBeNull();});
 const evidence=forDelivery(await (await control('notification-evidence')).json<any>(),id);expect(evidence.requests).toHaveLength(1);expect(evidence.requests[0].body).toBe(original);expect(evidence.requests[0].headers.authorization).toBeUndefined();expect(evidence.ledger.effects).toHaveLength(1);expect(evidence.ledger.deliveries[0].status).toBe('completed');
 // A repeated platform wakeup cannot spend another attempt on a completed intent.
 await stub.runDueWork(Date.now());await evictDurableObject(stub);await runInDurableObject(stub,(_o,state)=>{expect(state.storage.sql.exec('SELECT id,attempts,status FROM outbox').one()).toEqual({id,attempts:1,status:'succeeded'});});console.info('ALARM_RECEIVER_EVIDENCE',JSON.stringify(evidence));
});
it('scheduled_handler_uses_only_operator_catalog_and_rearms_clean_missing_alarm',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-scheduled-handler');let config:any;
 await runInDurableObject(stub,async(_o,state)=>{const body=messageInput();executeCommand(await commandContext(state.storage,name,body,'send'),identity,messageCommand(owned(state.storage,name)),body);config=JSON.parse(state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one().config_json);state.storage.sql.exec('UPDATE scheduler_state SET dirty=0');await state.storage.deleteAlarm();});
 await worker.scheduled(createScheduledController({cron:'* * * * *'}),{...env,DEPLOYMENT_CONFIG:JSON.stringify(config)} as Env);
 await runInDurableObject(stub,async(_o,state)=>{expect(await state.storage.getAlarm()).not.toBeNull();expect(state.storage.sql.exec('SELECT attempts FROM outbox').one().attempts).toBe(0);});
 // An invalid/unconfigured catalog cannot create request-derived tenants.
 await worker.scheduled(createScheduledController(),{...env,DEPLOYMENT_CONFIG:'{}'} as Env);
});

it('diagnostics_stay_read_only_and_regular_request_startup_repairs_without_disclosing_queue',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-startup-repair');await runInDurableObject(stub,async(_o,state)=>{const body=messageInput();executeCommand(await commandContext(state.storage,name,body,'send'),identity,messageCommand(owned(state.storage,name)),body);await state.storage.deleteAlarm();});
 await evictDurableObject(stub);const response=await stub.fetch(new Request('https://hub.example.invalid/v2/workspaces/ws_example/operations'));expect(response.status).toBe(401);expect(await response.text()).not.toContain('pending_count');
 await runInDurableObject(stub,async(_o,state)=>{expect(await state.storage.getAlarm()).toBeNull();expect(state.storage.sql.exec('SELECT dirty FROM scheduler_state').one().dirty).toBe(1);expect(state.storage.sql.exec('SELECT attempts FROM outbox').one().attempts).toBe(0);});
 const ordinaryRead=await stub.fetch(new Request('https://hub.example.invalid/v2/workspaces/ws_example/events'));expect(ordinaryRead.status).toBe(401);expect(await ordinaryRead.text()).not.toContain('pending_count');
 await runInDurableObject(stub,async(_o,state)=>{expect(await state.storage.getAlarm()).not.toBeNull();expect(state.storage.sql.exec('SELECT dirty FROM scheduler_state').one().dirty).toBe(0);expect(state.storage.sql.exec('SELECT attempts FROM outbox').one().attempts).toBe(0);});
});

it('remote_receiver_effect_then_local_disposition_crash_redelivers_same_id_after_eviction',async()=>{
 const {stub,name,identity}=await messageFixture('outbox-real-remote-gap');let lease=0,id='';
 await runInDurableObject(stub,async(_o,state)=>{const body=messageInput();executeCommand(await commandContext(state.storage,name,body,'send'),identity,messageCommand(owned(state.storage,name)),body);state.storage.sql.exec('UPDATE outbox SET retry_multiplier=1');id=state.storage.sql.exec<{id:string}>('SELECT id FROM outbox').one().id;state.storage.sql.exec("CREATE TRIGGER finish_crash BEFORE UPDATE ON outbox WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'simulated local disposition crash'); END");});
 await stub.repairSchedule();expect(await runDurableObjectAlarm(stub)).toBe(true);
 await runInDurableObject(stub,(_o,state)=>{const row=state.storage.sql.exec<any>('SELECT * FROM outbox').one();expect(row).toMatchObject({status:'in_flight',attempts:1});lease=row.lease_expires_at;state.storage.sql.exec('DROP TRIGGER finish_crash');});
 const accepted=forDelivery(await (await control('notification-evidence')).json<any>(),id);expect(accepted.ledger.effects).toHaveLength(1);await evictDurableObject(stub);
 // Advance only the trusted Workers clock; the controlled receiver remains within freshness tolerance.
 vi.useFakeTimers({toFake:['Date']});
 try{
  vi.setSystemTime(lease);await stub.runDueWork(Date.now());let due=0;
  await runInDurableObject(stub,(_o,state)=>{const row=state.storage.sql.exec<any>('SELECT * FROM outbox').one();expect(row).toMatchObject({attempts:1,status:'pending',last_error:'outcome_unknown'});due=row.next_due_at;});
  vi.setSystemTime(due);await stub.runDueWork(Date.now());await evictDurableObject(stub);
  await runInDurableObject(stub,(_o,state)=>{expect(state.storage.sql.exec('SELECT attempts,status,last_status FROM outbox').one()).toEqual({attempts:2,status:'succeeded',last_status:200});expect(state.storage.sql.exec('SELECT acknowledged_at FROM inbox').one().acknowledged_at).toBeNull();});
 }finally{vi.useRealTimers();}
 const evidence=forDelivery(await (await control('notification-evidence')).json<any>(),id);expect(evidence.requests).toHaveLength(2);expect(evidence.requests[0].body).toBe(evidence.requests[1].body);expect(evidence.requests[0].headers['x-cf-agent-hub-delivery-id']).toBe(evidence.requests[1].headers['x-cf-agent-hub-delivery-id']);expect(evidence.ledger.effects).toHaveLength(1);expect(evidence.ledger.deliveries[0].status).toBe('completed');console.info('REMOTE_SQL_GAP_RECEIVER_LEDGER',JSON.stringify(evidence));
});

it('http_message_acceptance_stays_201_when_post_commit_alarm_arming_fails',async()=>{
 const {stub}=await messageFixture('outbox-http-arm-failure');await runInDurableObject(stub,async(object,state)=>{
  const arm=vi.spyOn(state.storage,'setAlarm').mockRejectedValue(Error('synthetic alarm service unavailable'));
  try{
   const response=await object.fetch(new Request('https://hub.example.invalid/v2/workspaces/ws_example/messages',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'A'.repeat(43),'idempotency-key':'accepted-despite-arm-failure'},body:JSON.stringify(messageInput())}));
   expect(response.status).toBe(201);expect(state.storage.sql.exec('SELECT count(*) AS n FROM messages').one().n).toBe(1);
   expect(state.storage.sql.exec('SELECT attempts,status FROM outbox').one()).toEqual({attempts:0,status:'pending'});
   expect(state.storage.sql.exec('SELECT dirty,last_error_code FROM scheduler_state').one()).toEqual({dirty:1,last_error_code:'ALARM_ARM_FAILED'});
  }finally{arm.mockRestore();}
 });
});
