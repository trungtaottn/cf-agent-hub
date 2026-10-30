import test from 'node:test';
import assert from 'node:assert/strict';
import {completeCallSchedule,createCompleteCallOwner} from '../../scripts/lib/native-complete-call-owner.mjs';
const request=row=>({sequence:row.sequence,request_id:'request_'+row.sequence,operation:row.operation,slot:row.slot,pass:row.pass});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('single complete schedule has370 exact admissions and all process passes',()=>{
 const s=completeCallSchedule();assert.equal(s.length,370);assert.equal(s.filter(x=>x.operation==='read-original').length,42);
 assert.equal(s.filter(x=>x.operation==='scan-process-output'&&x.pass==='immediate').length,56);
 assert.equal(s.filter(x=>x.operation==='scan-process-output'&&x.pass==='final').length,56);
 assert.equal(s.at(-1).operation,'close-run');assert.ok(Object.isFrozen(s));
 for(const row of s.filter(x=>x.operation==='scan-process-output'&&x.pass==='immediate')){
  assert.equal(s[row.sequence-2].operation,'complete-process');assert.equal(s[row.sequence].operation,'observe-slot');
 }
});
test('every successful source-fake callback executes exactly once, including one owned close',async()=>{
 const owner=createCompleteCallOwner();let effects=0;
 for(const row of completeCallSchedule().slice(0,-1))await owner.execute(request(row),async()=>{effects++;return 'source-fake';});
 const r=await owner.close(request(completeCallSchedule().at(-1)),async()=>{effects++;return {status:'closed'};});
 assert.equal(effects,370);assert.equal(r.status,'closed');assert.equal(owner.snapshot().calls,370);assert.equal(owner.snapshot().scope,'source-lifecycle-only');
});
test('future request poisons before dispatch, close spends single allowance with no skipped receipts',async()=>{
 const owner=createCompleteCallOwner();let effects=0;
 await assert.rejects(owner.execute(request(completeCallSchedule()[1]),()=>{effects++;}));assert.equal(effects,0);
 const result=await owner.close({sequence:1,request_id:'close',operation:'close-run',slot:null,pass:null},()=>{effects++;return {status:'closed'};});
 assert.equal(result.status,'closed');assert.equal(owner.snapshot().completed,0);assert.equal(owner.snapshot().calls,1);assert.equal(effects,1);
});
test('duplicate request cannot invoke a second effect or refund first call',async()=>{
 const owner=createCompleteCallOwner(),first=request(completeCallSchedule()[0]);let effects=0;
 await owner.execute(first,()=>{effects++;return {status:'closed'};});await assert.rejects(owner.execute(first,()=>{effects++;}));
 assert.equal(effects,1);assert.equal(owner.snapshot().calls,1);assert.equal(owner.snapshot().failed,true);
});
test('concurrent call poisons and ownership remains busy until actual promise settles',async()=>{
 const owner=createCompleteCallOwner();let release;const gate=new Promise(resolve=>{release=resolve;});let calls=0;
 const first=owner.execute(request(completeCallSchedule()[0]),async()=>{calls++;await gate;});await tick();
 await assert.rejects(owner.execute(request(completeCallSchedule()[1]),()=>{calls++;}));
 assert.equal(owner.snapshot().pending,1);assert.equal(calls,1);release();await assert.rejects(first);assert.equal(owner.snapshot().pending,0);
});
test('cleanup cannot start while owned actual effect is pending; timeout is unknown not release',async()=>{
 const owner=createCompleteCallOwner();let release,cleanups=0;const gate=new Promise(resolve=>{release=resolve;});
 const first=owner.execute(request(completeCallSchedule()[0]),()=>gate);await tick();
 const closing=owner.close({sequence:2,request_id:'close',operation:'close-run',slot:null,pass:null},()=>{cleanups++;return {status:'closed'};});
 const result=await closing;assert.equal(result.status,'cleanup-unknown');assert.equal(cleanups,0);assert.equal(owner.snapshot().pending,1);
 release();await assert.rejects(first);await tick();assert.equal(cleanups,1);assert.equal(owner.snapshot().cleanup,'closed');
 await assert.rejects(owner.close({sequence:3,request_id:'another_close',operation:'close-run',slot:null,pass:null},()=>{cleanups++;}));assert.equal(cleanups,1);
});

test('fulfilled cleanup-unknown is not promoted to closed',async()=>{
 const owner=createCompleteCallOwner();await assert.rejects(owner.execute(request(completeCallSchedule()[1]),()=>{}));
 const result=await owner.close({sequence:1,request_id:'close',operation:'close-run',slot:null,pass:null},async()=>({status:'cleanup-unknown'}));
 assert.equal(result.status,'cleanup-unknown');assert.equal(owner.snapshot().cleanup,'cleanup-unknown');
});
test('cleanup promise remains counted after deadline until actual terminal receipt',async()=>{
 const owner=createCompleteCallOwner();await assert.rejects(owner.execute(request(completeCallSchedule()[1]),()=>{}));
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const result=await owner.close({sequence:1,request_id:'close',operation:'close-run',slot:null,pass:null},()=>gate);
 assert.equal(result.status,'cleanup-unknown');assert.equal(owner.snapshot().pending,1);
 release({status:'closed'});await tick();assert.equal(owner.snapshot().pending,0);assert.equal(owner.snapshot().cleanup,'closed');
});
