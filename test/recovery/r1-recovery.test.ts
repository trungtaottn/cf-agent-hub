import {CURRENT_SCHEMA_VERSION} from '../../src/storage/schema-version';
import {resetLegacyAuthorityFixture} from '../helpers/legacy-migration-fixture';
import {migrate} from '../../src/storage/migrations';
import {describe,it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {prepared,operator} from '../helpers/environment';
import {currentConfiguration} from '../../src/auth/context';
import {systemClock,systemEntropy} from '../../src/workspace/context';
import {withTransaction} from '../../src/storage/transaction';
import {inspectRegistry,TABLE_REGISTRY} from '../../src/recovery/table-registry';
import {readAdmissionFence,assertAdmissionOpen,transitionMaintenance} from '../../src/recovery/maintenance';
import {OutboxScheduler} from '../../src/outbox/scheduler';
import {DeliveryDispatcher} from '../../src/outbox/dispatcher';
const runtime=(storage:DurableObjectStorage,name:string)=>({storage,workspaceId:'ws_example',objectName:name,secrets:{},clock:systemClock,entropy:systemEntropy});
async function installed(name:string){const stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration(operator(),await prepared(name));return stub;}
describe('R1 recovery registry and durable admission',()=>{
 it('checks the unfiltered Workers schema including exact engine metadata',async()=>{
  const stub=await installed('recovery_schema_observation');
  await runInDurableObject(stub,(_instance,state)=>{
   const names=state.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").toArray().map(x=>x.name);
   expect(names).toEqual([...TABLE_REGISTRY.map(x=>x.name),'sqlite_sequence'].sort());
   expect(withTransaction(state.storage,inspectRegistry)).toEqual({schemaVersion:CURRENT_SCHEMA_VERSION,eventSequence:1,tables:37});
  });
 });
 it('fails closed when a durable maintenance fence is present',async()=>{
  const name='recovery_barrier_red',stub=await installed(name);
  await runInDurableObject(stub,(_instance,state)=>{
   state.storage.sql.exec("UPDATE maintenance_state SET state='capturing',barrier_id='barrier_fixture',capture_id='capture_fixture',generation=generation+1,updated_at=? WHERE id=1",Date.now());
   expect(()=>withTransaction(state.storage,tx=>currentConfiguration(tx,runtime(state.storage,name)))).toThrow();
  });
 });
 it('rejects unknown tables and columns instead of filtering names',async()=>{
  const stub=await installed('recovery_schema_drift');
  await runInDurableObject(stub,(_instance,state)=>{
   state.storage.sql.exec('CREATE TABLE unreviewed_table (id INTEGER PRIMARY KEY)');
   expect(()=>withTransaction(state.storage,inspectRegistry)).toThrow('RECOVERY_SCHEMA_MISMATCH');
   state.storage.sql.exec('DROP TABLE unreviewed_table');
   state.storage.sql.exec('ALTER TABLE messages ADD COLUMN unexpected TEXT');
   expect(()=>withTransaction(state.storage,inspectRegistry)).toThrow('RECOVERY_SCHEMA_MISMATCH');
  });
 });
 it('preserves and validates the historical events high-water after retained rows disappear',async()=>{
  const stub=await installed('recovery_event_highwater');
  await runInDurableObject(stub,(_instance,state)=>{
   state.storage.sql.exec("UPDATE sqlite_sequence SET seq=55 WHERE name='events'");
   expect(withTransaction(state.storage,inspectRegistry).eventSequence).toBe(55);
   state.storage.sql.exec("UPDATE sqlite_sequence SET seq=0 WHERE name='events'");
   expect(()=>withTransaction(state.storage,inspectRegistry)).toThrow('RECOVERY_EVENT_SEQUENCE');
  });
 });
 it('retains a monotonic generation across same-epoch resume and object eviction',async()=>{
  const name='recovery_monotonic',stub=await installed(name);
  const old=await runInDurableObject(stub,(_instance,state)=>withTransaction(state.storage,tx=>{
   const old=assertAdmissionOpen(tx);const input={epoch:1,barrierId:'barrier_fixture',captureId:'capture_fixture',nowMs:Date.now(),advance:true};
   transitionMaintenance(tx,{...input,state:'capturing'});transitionMaintenance(tx,{...input,state:'open'});
   expect(()=>assertAdmissionOpen(tx,old)).toThrow('STALE_ADMISSION_FENCE');
   expect(assertAdmissionOpen(tx).maintenanceGeneration).toBe(2);return old;
  }));
  await evictDurableObject(stub);
  await runInDurableObject(stub,(_instance,state)=>withTransaction(state.storage,tx=>{
   expect(readAdmissionFence(tx)).toEqual({authorityEpoch:1,maintenanceGeneration:2});
   expect(()=>assertAdmissionOpen(tx,old)).toThrow('STALE_ADMISSION_FENCE');
  }));
 });
 it('does not publish an old asynchronous alarm completion after same-epoch resume',async()=>{
  const name='recovery_async_fence',stub=await installed(name);
  await runInDurableObject(stub,async(_instance,state)=>{
   let release!:()=>void,started!:()=>void;const wait=new Promise<void>(r=>release=r),begin=new Promise<void>(r=>started=r);
   const workspace=runtime(state.storage,name),scheduler=new OutboxScheduler(workspace,new DeliveryDispatcher(workspace),{setAlarm:async()=>{started();await wait;},deleteAlarm:async()=>{started();await wait;}});
   const pending=scheduler.repairSchedule();await begin;
   withTransaction(state.storage,tx=>{
    const input={epoch:1,barrierId:'barrier_fixture',captureId:'capture_fixture',nowMs:Date.now(),advance:true};
    transitionMaintenance(tx,{...input,state:'capturing'});transitionMaintenance(tx,{...input,state:'open'});
   });
   const before=state.storage.sql.exec('SELECT * FROM scheduler_state').one();release();
   expect((await pending).armed).toBe(false);
   expect(state.storage.sql.exec('SELECT * FROM scheduler_state').one()).toEqual(before);
  });
 });
});

it('does not migrate a legacy non-open fence when metadata still says installed',async()=>{
 const stub=await installed('recovery_legacy_frozen');
 await runInDurableObject(stub,async(_instance,state)=>{
  await resetLegacyAuthorityFixture(state.storage,6);
  state.storage.sql.exec("UPDATE maintenance_state SET state='capturing' WHERE id=1");
  const before=state.storage.sql.exec("SELECT sql FROM sqlite_schema WHERE name='maintenance_state'").one();
  expect(()=>migrate(state.storage)).toThrow('FROZEN_SCHEMA_MIGRATION');
  expect(state.storage.sql.exec("SELECT sql FROM sqlite_schema WHERE name='maintenance_state'").one()).toEqual(before);
  expect(state.storage.sql.exec<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations').one().version).toBe(6);
 });
});
it.each([false,true])('reconciles the actual alarm after a stale completion; resumed=%s',async resumed=>{
 const name='recovery_physical_alarm_'+String(resumed),stub=await installed(name);
 await runInDurableObject(stub,async(_instance,state)=>{
  const now=Date.now(),oldDue=now+600000,newDue=now+1200000;
  state.storage.sql.exec("INSERT INTO outbox (id,workspace_id,message_id,destination_id,notification_id,payload_json,status,attempts,next_due_at,retry_multiplier,created_at,updated_at) VALUES ('delivery_alarm','ws_example','message_alarm','destination_alarm','delivery_alarm','{}','pending',0,?,1,?,?)",oldDue,now,now);
  let release!:()=>void,started!:()=>void,calls=0;const wait=new Promise<void>(r=>release=r),begin=new Promise<void>(r=>started=r);
  const workspace=runtime(state.storage,name),scheduler=new OutboxScheduler(workspace,new DeliveryDispatcher(workspace),{setAlarm:async when=>{if(++calls===1){started();await wait;}await state.storage.setAlarm(when);},deleteAlarm:()=>state.storage.deleteAlarm()});
  const pending=scheduler.repairSchedule();await begin;
  withTransaction(state.storage,tx=>{
   const input={epoch:1,barrierId:'barrier_fixture',captureId:'capture_fixture',nowMs:now,advance:true};transitionMaintenance(tx,{...input,state:'capturing'});
   if(resumed){transitionMaintenance(tx,{...input,state:'open'});tx.exec('UPDATE outbox SET next_due_at=?',[newDue]);}
  });
  const frozen=state.storage.sql.exec('SELECT * FROM scheduler_state').one();
  if(resumed){await scheduler.repairSchedule();expect(await state.storage.getAlarm()).toBe(newDue);}
  release();await pending;
  expect(await state.storage.getAlarm()).toBe(resumed?newDue:null);
  if(!resumed)expect(state.storage.sql.exec('SELECT * FROM scheduler_state').one()).toEqual(frozen);
 });
});
