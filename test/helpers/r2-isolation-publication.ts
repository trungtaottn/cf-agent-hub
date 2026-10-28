import {afterEach,beforeEach,beforeAll,expect,it,vi} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {recordIsolationEvidence} from './r2-isolation-matrix';
import {control} from './auth';
import {r2IsolationFixture} from './r2-isolation';
import {validateAuthSessionResponse,validateProfileDataResponse,validateError} from '../../src/http/generated/auth-validators.js';

beforeEach(async()=>{await control('reset');});
afterEach(()=>vi.restoreAllMocks());

function deferred<T>(){
 let resolve!:(value:T)=>void;
 const promise=new Promise<T>(r=>{resolve=r;});
 return {promise,resolve};
}

const cases=[
 {name:'native-profile',path:'profile',human:false,change:'credential' as const,validate:validateProfileDataResponse},
 {name:'human-session',path:'auth/session',human:true,change:'session' as const,validate:validateAuthSessionResponse},
 {name:'native-maintenance',path:'profile',human:false,change:'maintenance' as const,validate:validateProfileDataResponse},
];

for(const testCase of cases)it('actual DO publishes '+testCase.name+' without awaiting unrelated final alarm repair',async()=>{
 const f=await r2IsolationFixture('isolation-final-repair-'+testCase.name);
 await runInDurableObject(f.a.stub,async(object,{storage})=>{
  // Eliminate an automatic alarm as an unrelated observer. Only the physical
  // alarm adapter is controlled below; SQL scheduler/current-authority code runs.
  await storage.deleteAlarm();
  storage.sql.exec('INSERT INTO scheduler_state(id,dirty,generation) VALUES(1,1,1) ON CONFLICT(id) DO UPDATE SET dirty=1,generation=generation+1');
  const tables=['profiles','preferences','messages','threads','thread_participants','inbox','events','idempotency_outcomes','outbox','tasks','runs','artifacts','artifact_generations'] as const;
  const domain=()=>Object.fromEntries(tables.map(table=>[table,storage.sql.exec('SELECT * FROM '+table).toArray()]));
  const before=domain(),entered=deferred<void>(),resume=deferred<void>();
  let alarmCalls=0,settled:Response|undefined;
  const alarm=async()=>{
   alarmCalls++;
   if(alarmCalls===1)throw Error('synthetic startup alarm unavailable');
   if(alarmCalls===2){entered.resolve();await resume.promise;}
   // Never physically arm; failed arming must retain repair debt rather than
   // alter accepted domain state. This failure is not an authentication bypass.
   throw Error('synthetic final alarm unavailable');
  };
  const set=vi.spyOn(storage,'setAlarm').mockImplementation(alarm);
  const clear=vi.spyOn(storage,'deleteAlarm').mockImplementation(alarm);
  const pending=object.fetch(f.request(testCase.path,{human:testCase.human}));
  const published=pending.then(response=>{settled=response;return {kind:'published' as const,response};});
  let beforeRevocation=false;
  let response:Response|undefined;
  try{
   const first=await Promise.race([published,entered.promise.then(()=>({kind:'repair-held' as const}))]);
   if(first.kind==='repair-held'){
    // A real asynchronous crypto completion gives the normal response promise
    // chain a turn to settle without advancing time or releasing the alarm.
    // This also accepts a legitimate waitUntil repair: it may enter the barrier,
    // but must not hold fetch's finished response behind that barrier.
    await crypto.subtle.digest('SHA-256',new Uint8Array([0]));
   }
   beforeRevocation=settled!==undefined;
   expect(storage.sql.exec('SELECT dirty,last_error_code FROM scheduler_state WHERE id=1').one()).toEqual({dirty:1,last_error_code:'ALARM_ARM_FAILED'});
   if(testCase.change==='credential')storage.sql.exec("UPDATE native_credentials SET enabled=0,revoked_at=? WHERE credential_id='credential_research_1'",Date.now());
   else if(testCase.change==='session')storage.sql.exec('UPDATE sessions SET revoked_at=? WHERE revoked_at IS NULL',Date.now());
   else storage.sql.exec('UPDATE maintenance_state SET generation=generation+1');
  }finally{
   resume.resolve();
   try{response=await pending;}finally{set.mockRestore();clear.mockRestore();}
  }
  // This is the exact expected RED on the vulnerable base. Do not change it to
  // assert that a 200 after held repair/revocation is acceptable.
  expect(beforeRevocation,'final projection must publish before an unrelated held alarm can admit later authority changes').toBe(true);
  expect(response!.status).toBe(200);
  expect(testCase.validate(await response!.json())).toBe(true);
  expect(domain()).toEqual(before);
  if(testCase.change!=='maintenance'){
   // Revocation after publication must still deny a fresh use of the same proof;
   // do not relogin/re-enroll, reinstall or silently use another credential.
   const denied=await object.fetch(f.request(testCase.path,{human:testCase.human}));
   expect(denied.status).toBe(401);
   const body=await denied.json();expect(validateError(body)).toBe(true);
   expect(body).not.toHaveProperty('data');
   expect(domain()).toEqual(before);
  }
 });recordIsolationEvidence('publication',testCase.name,'no-final-await');
},30_000);

/**
 * Retained scheduler semantics:
 * - Startup repair before authentication still runs and may retain dirty=1 on
 *   physical alarm failure; SQL and existing catalog/restart repair remain owner.
 * - Already committed writes are not rolled back or turned into an artificial
 *   denial merely because a later actor loses authority.
 * - Task/message/artifact accepted commands continue to register repair with
 *   ctx.waitUntil where they dirty scheduler state. No remote send in SQL.
 * - Diagnostics remain read-only and never create a fresh health observation.
 * - Existing test/outbox/alarm.test.ts:31-37,56-65 and
 *   test/messages/r2-references.test.ts:137-139 retain their expectations.
 */

let repairDebtFixture:Awaited<ReturnType<typeof r2IsolationFixture>>;
beforeAll(async()=>{repairDebtFixture=await r2IsolationFixture('isolation-repair-debt');await evictDurableObject(repairDebtFixture.a.stub);});
it('failed startup alarm retains durable repair debt across eviction and successful retry',async()=>{
 const f=repairDebtFixture;
 await runInDurableObject(f.a.stub,async(object,{storage})=>{
  storage.sql.exec('INSERT INTO scheduler_state(id,dirty,generation) VALUES(1,1,1) ON CONFLICT(id) DO UPDATE SET dirty=1,generation=generation+1');
  const set=vi.spyOn(storage,'setAlarm').mockRejectedValue(Error('synthetic arm failure')),clear=vi.spyOn(storage,'deleteAlarm').mockRejectedValue(Error('synthetic clear failure'));
  try{const response=await object.fetch(f.request('profile'));expect(response.status).toBe(200);await response.arrayBuffer();expect(set.mock.calls.length+clear.mock.calls.length).toBe(1);expect(storage.sql.exec('SELECT dirty,last_error_code FROM scheduler_state WHERE id=1').one()).toEqual({dirty:1,last_error_code:'ALARM_ARM_FAILED'});}finally{set.mockRestore();clear.mockRestore();}
 });
 await evictDurableObject(f.a.stub);
 await runInDurableObject(f.a.stub,async(object,{storage})=>{
  expect(storage.sql.exec('SELECT dirty FROM scheduler_state WHERE id=1').one().dirty).toBe(1);
  const receipt=await object.repairSchedule();expect(receipt.armed).toBe(true);expect(receipt.dirty).toBe(false);expect(storage.sql.exec('SELECT dirty,last_error_code FROM scheduler_state WHERE id=1').one()).toEqual({dirty:0,last_error_code:null});expect(await storage.getAlarm()).not.toBeNull();await storage.deleteAlarm();
 });recordIsolationEvidence('scheduler','system','failed-arm-restart-retry');
});
