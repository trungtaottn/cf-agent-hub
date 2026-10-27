import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {messageFixture,messageInput,owned,commandContext} from '../helpers/messages';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
import {canonicalJson} from '../../src/config/bootstrap';
import {withTransaction,type WorkspaceTransaction,type SqlValue} from '../../src/storage/transaction';
import * as repository from '../../src/outbox/repository';
import {claimDue,finishAttempt,type OutboxRow} from '../../src/outbox/repository';
import {assertAdmissionOpen} from '../../src/recovery/maintenance';
async function population(storage:DurableObjectStorage,name:string,identity:Parameters<typeof executeCommand>[1],total:number){
 const body=messageInput();executeCommand(await commandContext(storage,name,body,'seed'),identity,messageCommand(owned(storage,name)),body);
 const original=storage.sql.exec('SELECT * FROM outbox').one() as unknown as OutboxRow,now=original.next_due_at;
 storage.sql.exec("UPDATE outbox SET status='succeeded' WHERE id=?",original.id);
 withTransaction(storage,tx=>{for(let i=0;i<total;i++){
  const id='bounded_'+String(i).padStart(5,'0'),flight=i%2===1,due=i%5===0?now+10000:now-1000+i%3;
  tx.exec('INSERT INTO outbox(id,workspace_id,message_id,destination_id,notification_id,payload_json,status,attempts,next_due_at,retry_multiplier,lease_token,lease_expires_at,last_status,last_error,created_at,updated_at,destination_snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,original.workspace_id,original.message_id,original.destination_id,id,canonicalJson({...JSON.parse(original.payload_json),delivery_id:id}),flight?'in_flight':'pending',flight?1:0,flight?now-2000:due,1,flight?JSON.stringify([id,1]):null,flight?due:null,null,null,original.created_at,now-1,original.destination_snapshot_json]);
 }});return {now,original};
}
/** Observe actual production SQL via the supplied transaction interface, not an imitation selector. */
function traced<T>(storage:DurableObjectStorage,body:(tx:WorkspaceTransaction)=>T){
 const reads:{query:string;rowsRead:number;returned:number}[]=[];
 const value=withTransaction(storage,base=>{
  const all=<R>(query:string,bindings:readonly SqlValue[]=[])=>{const cursor=storage.sql.exec(query,...bindings),rows=cursor.toArray();reads.push({query,rowsRead:cursor.rowsRead,returned:rows.length});return rows as unknown as readonly R[];};
  const tx:WorkspaceTransaction={all,one:<R>(query:string,bindings:readonly SqlValue[]=[])=>all<R>(query,bindings)[0]??null,exec:(query,bindings)=>base.exec(query,bindings)};
  return body(tx);
 });return {value,reads};
}
const snapshot=(s:DurableObjectStorage)=>s.sql.exec('SELECT * FROM outbox ORDER BY id').toArray();
for(const [total,distribution] of [[1000,'mixed'],[5000,'mixed'],[1000,'pending'],[1000,'in_flight']] as const)it('production_claim_bounds_actual_SQL_at_'+total+'_'+distribution+'_rows_and_preserves_exact_selection',async()=>{
 const {stub,name,identity}=await messageFixture('bounded-production-'+total+'-'+distribution);const measured=await runInDurableObject(stub,async(_o,state)=>{
  const s=state.storage,{now}=await population(s,name,identity,total);
  if(distribution!=='mixed')s.sql.exec("UPDATE outbox SET status=?,attempts=?,lease_token=CASE WHEN ?='in_flight' THEN json_array(id,1) ELSE NULL END,lease_expires_at=CASE WHEN ?='in_flight' THEN next_due_at ELSE NULL END WHERE id LIKE 'bounded_%'",distribution,distribution==='in_flight'?1:0,distribution,distribution);
  const before=snapshot(s);
  const expected=s.sql.exec<{id:string;status:string;attempts:number;due:number}>("SELECT id,status,attempts,CASE WHEN status='in_flight' THEN lease_expires_at ELSE next_due_at END AS due FROM outbox WHERE (status='pending' AND next_due_at<=?) OR (status='in_flight' AND lease_expires_at<=?) ORDER BY due,id LIMIT 25",now,now).toArray();
  const result=traced(s,tx=>claimDue(tx,now,25));
  expect(result.value.map(row=>row.deliveryId)).toEqual(expected.filter(row=>row.status==='pending').map(row=>row.id));
  const selected=new Set(expected.map(row=>row.id)),after=snapshot(s);
  for(let i=0;i<before.length;i++){
   if(!selected.has(String(before[i].id)))expect(after[i]).toEqual(before[i]);
   else if(before[i].status==='pending')expect(after[i]).toMatchObject({status:'in_flight',attempts:1,lease_expires_at:now+30000,updated_at:now});
   else expect(after[i]).toMatchObject({status:'pending',attempts:1,last_error:'outcome_unknown',lease_token:null,lease_expires_at:null,next_due_at:now+5000,updated_at:now});
  }
  expect(selected.size).toBe(25);expect(s.sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
  const outboxReads=result.reads.filter(row=>/FROM outbox\b/.test(row.query)).reduce((sum,row)=>sum+row.rowsRead,0),allReads=result.reads.reduce((sum,row)=>sum+row.rowsRead,0);
  const candidate=result.reads.find(row=>row.query.includes('UNION ALL'))!,hydrations=result.reads.filter(row=>row.query==='SELECT * FROM outbox WHERE id=?');
  const plan=s.sql.exec<{detail:string}>('EXPLAIN QUERY PLAN '+candidate.query,now,25,now,25,25).toArray();
  for(const index of ['outbox_pending_order','outbox_lease_order'])expect(plan.some(row=>row.detail.includes('COVERING INDEX '+index))).toBe(true);
  expect(plan.some(row=>/SCAN outbox/.test(row.detail))).toBe(false);
  // SQL BINARY-preserving merge counts derived/temp rows too: two25-row inputs,
  // <=100 candidate cursor reads, plus exactly25 primary-key hydration reads.
  expect(candidate.rowsRead).toBeLessThanOrEqual(100);expect(candidate.returned).toBe(25);
  expect(hydrations).toHaveLength(25);expect(hydrations.every(row=>row.rowsRead===1&&row.returned===1)).toBe(true);
  expect(outboxReads).toBeLessThanOrEqual(125);expect(allReads).toBeLessThanOrEqual(1000);expect(result.reads.length).toBeLessThanOrEqual(300);
  return {total,distribution,outboxReads,allReads,readStatements:result.reads.length,selected:expected.map(row=>row.id)};
 });console.info('PRODUCTION_OUTBOX_BOUND '+JSON.stringify(measured));
});
it('production_due_selection_includes_exact_boundary_and_ties_then_respects_requested_sub_limit',async()=>{
 const {stub,name,identity}=await messageFixture('bounded-deadline-ties');await runInDurableObject(stub,async(_o,state)=>{
  const s=state.storage,{now}=await population(s,name,identity,40);
  s.sql.exec("UPDATE outbox SET next_due_at=?,lease_expires_at=CASE WHEN status='in_flight' THEN ? ELSE NULL END WHERE id LIKE 'bounded_%'",now,now);
  const before=snapshot(s);expect(withTransaction(s,tx=>claimDue(tx,now-1,25))).toEqual([]);expect(snapshot(s)).toEqual(before);
  // Existing API clamps a runtime number to the fixed25 ceiling; exercise the lower value without changing its public signature.
  const result=withTransaction(s,tx=>claimDue(tx,now,3 as 25));expect(result.map(row=>row.deliveryId)).toEqual(['bounded_00000','bounded_00002']);
  const after=snapshot(s),changed=after.filter((row,i)=>JSON.stringify(row)!==JSON.stringify(before[i])).map(row=>row.id);expect(changed).toEqual(['bounded_00000','bounded_00001','bounded_00002']);
  expect(s.sql.exec("SELECT attempts,last_error,next_due_at FROM outbox WHERE id='bounded_00001'").one()).toEqual({attempts:1,last_error:'outcome_unknown',next_due_at:now+5000});
 });
});
it('production_completion_uses_bounded_identity_seek_and_stale_tokens_never_finish_new_attempt',async()=>{
 const {stub,name,identity}=await messageFixture('bounded-completion');const measured=await runInDurableObject(stub,async(_o,state)=>{
  const s=state.storage,{now}=await population(s,name,identity,5000),id='bounded_00005',old=JSON.stringify([id,1]),fresh=JSON.stringify([id,2]);
  s.sql.exec("UPDATE outbox SET attempts=2,lease_token=? WHERE id=?",fresh,id);const fence=withTransaction(s,assertAdmissionOpen),before=snapshot(s);
  for(const token of [old,'not-json','null',JSON.stringify([id,2,'extra']),JSON.stringify([id,3])])withTransaction(s,tx=>finishAttempt(tx,id,token,{kind:'delivered',status:204},now,fence));
  withTransaction(s,tx=>finishAttempt(tx,'bounded_00007',fresh,{kind:'delivered',status:204},now,fence));
  expect(snapshot(s)).toEqual(before);
  const result=traced(s,tx=>finishAttempt(tx,id,fresh,{kind:'delivered',status:204},now,fence));
  expect(s.sql.exec('SELECT status,attempts,last_status FROM outbox WHERE id=?',id).one()).toEqual({status:'succeeded',attempts:2,last_status:204});
  const outboxReads=result.reads.filter(row=>/FROM outbox\b/.test(row.query)).reduce((sum,row)=>sum+row.rowsRead,0);expect(outboxReads).toBeLessThanOrEqual(1);
  const settled=snapshot(s);withTransaction(s,tx=>finishAttempt(tx,id,fresh,{kind:'transient',category:'synthetic'},now,fence));expect(snapshot(s)).toEqual(settled);
  return {total:5000,outboxReads,readStatements:result.reads.length};
 });console.info('PRODUCTION_COMPLETION_BOUND '+JSON.stringify(measured));
});

it('production_earliest_uses_bounded_seeks_ignores_null_flight_deadline_and_preserves_SQL_binary_ties',async()=>{
 const {stub,name,identity}=await messageFixture('bounded-earliest');const measured=await runInDurableObject(stub,async(_o,state)=>{
  const s=state.storage,{now}=await population(s,name,identity,5000);
  s.sql.exec("UPDATE outbox SET lease_expires_at=NULL WHERE id='bounded_00001'");
  const expected=s.sql.exec("SELECT MIN(CASE WHEN status='in_flight' THEN lease_expires_at ELSE next_due_at END) AS due FROM outbox WHERE status IN ('pending','in_flight')").one().due;
  const helper=(repository as unknown as {nextOutboxDue:(tx:WorkspaceTransaction)=>number|null}).nextOutboxDue;
  expect(typeof helper).toBe('function');const result=traced(s,tx=>helper(tx));expect(result.value).toBe(expected);
  const rowsRead=result.reads.reduce((n,row)=>n+row.rowsRead,0);expect(rowsRead).toBeLessThanOrEqual(2);
  s.sql.exec("UPDATE outbox SET status='succeeded'");
  for(const [old,id] of [['bounded_00000','tie_\uE000'],['bounded_00002','tie_\u{10000}']]){
   const row=s.sql.exec('SELECT payload_json FROM outbox WHERE id=?',old).one();
   s.sql.exec("UPDATE outbox SET id=?,notification_id=?,payload_json=?,status='pending',next_due_at=? WHERE id=?",id,id,canonicalJson({...JSON.parse(String(row.payload_json)),delivery_id:id}),now,old);
  }
  const order=s.sql.exec("SELECT id FROM outbox WHERE status='pending' ORDER BY next_due_at,id").toArray().map(row=>row.id);
  expect(order).toEqual(['tie_\uE000','tie_\u{10000}']);expect(withTransaction(s,tx=>claimDue(tx,now,1 as 25)).map(row=>row.deliveryId)).toEqual(order.slice(0,1));
  return {total:5000,rowsRead};
 });console.info('PRODUCTION_EARLIEST_BOUND '+JSON.stringify(measured));
});
