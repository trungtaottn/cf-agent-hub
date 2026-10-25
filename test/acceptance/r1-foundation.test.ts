import {describe,it,expect,beforeEach} from 'vitest';
import {R1_OPERATIONS,AUTH_LANES,routeExpectation} from '../../scripts/lib/release-policy.mjs';
import {control} from '../helpers/auth';
import {acceptanceFixture,prepareCell,sqlSnapshot,mutationCounts,assertResponse,changedRows} from '../helpers/r1-acceptance';

beforeEach(async()=>{await control('reset');});
describe('R1 actual HTTP authorization, canonical responses and persistent effects',()=>{
 for(const operation of R1_OPERATIONS)for(const lane of AUTH_LANES){
  it(operation+' / '+lane,async()=>{
   const f=await acceptanceFixture(('r1_matrix_'+operation+'_'+lane).toLowerCase());
   const cell=await prepareCell(f,operation,lane);
   const before=await sqlSnapshot(cell.target),other=cell.target===f.a?f.b:f.a,otherBefore=await sqlSnapshot(other);
   const response=await f.http(cell.request);
   const after=await sqlSnapshot(cell.target),otherAfter=await sqlSnapshot(other);
   const expected=routeExpectation(operation,lane)!;
   // Compare database effects even if an HTTP status or DTO assertion later fails.
   const counts=mutationCounts(before,after,cell.target);
   expect(counts,operation+' / '+lane+' independently measured SQL changes').toEqual(expected.mutations);
   expect(otherAfter.digest,'the other authority must not change').toBe(otherBefore.digest);
   const mutates=Object.values(expected.mutations).some(value=>value!==0);
   expect(after.digest!==before.digest,'whole SQL inventory change agrees with exact expected effects').toBe(mutates);
   await assertResponse(response,operation,lane,f,cell.target);
   if(expected.mutations.events_inserted){
    const events=changedRows(before,after,'events').inserted,outcomes=changedRows(before,after,'idempotency_outcomes').inserted;
    const eventType=operation==='createMessage'?'message.accepted':operation==='ackMessages'?'message.acknowledged':operation==='putProfile'?'profile.updated':'preferences.updated';
    expect(events).toHaveLength(1);expect(outcomes).toHaveLength(1);
    expect(events[0].type).toBe(eventType);expect(outcomes[0].event_id).toBe(events[0].id);
    expect(events[0].request_id).toBe(outcomes[0].original_request_id);
   }
  },30_000);
 }
});
