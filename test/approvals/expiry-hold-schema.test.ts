import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {decisionFixture} from '../helpers/decision-policy';
import {admitted} from '../helpers/persisted-decision';
it('decision expiry hold is nullable closed diagnostic and never changes approval authority',async()=>{
 const f=await decisionFixture('expiry_hold_schema');await runInDurableObject(f.stub,async(_o,s)=>{
  await admitted(s.storage,f.name);
  expect(s.storage.sql.exec<{name:string}>('PRAGMA table_info(approvals)').toArray().map(r=>r.name)).toContain('expiry_hold_code');
  for(const value of ['unknown','',1.5])expect(()=>s.storage.sql.exec('UPDATE approvals SET expiry_hold_code=?',value)).toThrow();
  s.storage.sql.exec("UPDATE approvals SET expiry_hold_code='DECISION_STATE_INVALID'");
  expect(s.storage.sql.exec('SELECT status,approval_version,expiry_hold_code FROM approvals').one()).toEqual({status:'pending',approval_version:1,expiry_hold_code:'DECISION_STATE_INVALID'});
 });
});
