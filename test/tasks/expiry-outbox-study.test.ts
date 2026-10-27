import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {messageFixture,messageInput,owned,commandContext} from '../helpers/messages';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
import {canonicalJson} from '../../src/config/bootstrap';
import {withTransaction} from '../../src/storage/transaction';
import {validateIntent,type OutboxRow} from '../../src/outbox/repository';
/** Query-only comparison. Candidate indexes are test-local DDL, never a product migration. */
for(const total of [1000,5000,10000])it('outbox_query_shape_study_'+total+'_live_rows',async()=>{
 const {stub,name,identity}=await messageFixture('expiry-outbox-study-'+total);
 const result=await runInDurableObject(stub,async(_object,state)=>{
  const storage=state.storage,sql=storage.sql;
  // Isolated historical query baseline: remove only the new production indexes,
  // preserving the inherited outbox_due index and all production migration bytes.
  sql.exec('DROP INDEX IF EXISTS outbox_pending_order');sql.exec('DROP INDEX IF EXISTS outbox_lease_order');
  const body=messageInput();executeCommand(await commandContext(storage,name,body,'seed'),identity,messageCommand(owned(storage,name)),body);
  const original=sql.exec('SELECT * FROM outbox').one() as unknown as OutboxRow,now=original.next_due_at;
  sql.exec("UPDATE outbox SET status='succeeded' WHERE id=?",original.id);
  // Copy the canonical accepted message intent with unique synthetic delivery identities.
  // Relationships, immutable event timestamp, destination and recipient are preserved.
  // This is a query population, not a claim that admission creates duplicate delivery rows.
  withTransaction(storage,tx=>{for(let i=0;i<total;i++){
   const id='study_delivery_'+String(i).padStart(5,'0'),flight=i%2===1,due=i%5===0?now+10000:now-1000+i%3;
   const payload=canonicalJson({...JSON.parse(original.payload_json),delivery_id:id});
   tx.exec('INSERT INTO outbox(id,workspace_id,message_id,destination_id,notification_id,payload_json,status,attempts,next_due_at,retry_multiplier,lease_token,lease_expires_at,last_status,last_error,created_at,updated_at,destination_snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,original.workspace_id,original.message_id,original.destination_id,id,payload,flight?'in_flight':'pending',flight?1:0,flight?now-2000:due,1,flight?JSON.stringify([id,1]):null,flight?due:null,null,null,original.created_at,original.updated_at,original.destination_snapshot_json]);
  }});
  expect(sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
  expect(sql.exec("SELECT COUNT(*) AS n FROM outbox WHERE status IN ('pending','in_flight')").one().n).toBe(total);
  expect(sql.exec("SELECT COUNT(*) AS n FROM outbox WHERE id<>notification_id OR id<>json_extract(payload_json,'$.delivery_id') OR message_id<>json_extract(payload_json,'$.message_id') OR workspace_id<>json_extract(payload_json,'$.workspace_id')").one().n).toBe(0);
  for(const id of ['study_delivery_00000','study_delivery_00001','study_delivery_'+String(total-2).padStart(5,'0'),'study_delivery_'+String(total-1).padStart(5,'0')])expect(withTransaction(storage,tx=>validateIntent(tx,tx.one<OutboxRow>('SELECT * FROM outbox WHERE id=?',[id])!))).not.toBeNull();
  const minimum="SELECT MIN(CASE WHEN status='in_flight' THEN lease_expires_at ELSE next_due_at END) AS due FROM outbox WHERE status IN ('pending','in_flight')";
  const claim="SELECT * FROM outbox WHERE (status='pending' AND next_due_at<=?) OR (status='in_flight' AND lease_expires_at<=?) ORDER BY CASE WHEN status='in_flight' THEN lease_expires_at ELSE next_due_at END,id LIMIT ?";
  function measure<T>(query:string,...args:(string|number)[]){const start=performance.now(),cursor=sql.exec(query,...args),rows=cursor.toArray() as unknown as T[];return {rows,rowsRead:cursor.rowsRead,elapsedMs:performance.now()-start};}
  const oldMin=measure<{due:number}>(minimum),oldClaim=measure<OutboxRow>(claim,now,now,25);
  const completionId='study_delivery_00005',completionToken=JSON.stringify([completionId,1]),completionQuery="SELECT * FROM outbox WHERE status='in_flight' AND lease_token=? AND lease_expires_at>?";
  const oldCompletion=measure<OutboxRow>(completionQuery,completionToken,now);expect(oldCompletion.rows).toHaveLength(1);
  expect(oldClaim.rows).toHaveLength(25);expect(oldMin.rowsRead).toBeGreaterThanOrEqual(total);expect(oldClaim.rowsRead).toBeGreaterThanOrEqual(total);
  sql.exec('CREATE INDEX study_outbox_pending_order ON outbox(status,next_due_at,id)');
  sql.exec('CREATE INDEX study_outbox_lease_order ON outbox(status,lease_expires_at,id)');
  const unchangedMin=measure<{due:number}>(minimum),unchangedClaim=measure<OutboxRow>(claim,now,now,25),unchangedCompletion=measure<OutboxRow>(completionQuery,completionToken,now);
  const keyedCompletion=measure<OutboxRow>("SELECT * FROM outbox WHERE id=? AND status='in_flight' AND lease_token=? AND lease_expires_at>?",completionId,completionToken,now);expect(keyedCompletion.rows).toEqual(oldCompletion.rows);expect(keyedCompletion.rowsRead).toBeLessThanOrEqual(1);
  const pendingNext=measure<{due:number}>("SELECT next_due_at AS due FROM outbox WHERE status='pending' ORDER BY next_due_at,id LIMIT 1"),flightNext=measure<{due:number}>("SELECT lease_expires_at AS due FROM outbox WHERE status='in_flight' ORDER BY lease_expires_at,id LIMIT 1");
  const candidateMin=Math.min(pendingNext.rows[0].due,flightNext.rows[0].due);expect(candidateMin).toBe(oldMin.rows[0].due);expect(pendingNext.rowsRead+flightNext.rowsRead).toBeLessThanOrEqual(2);
  const pending=measure<{id:string;due:number}>("SELECT id,next_due_at AS due FROM outbox WHERE status='pending' AND next_due_at<=? ORDER BY next_due_at,id LIMIT ?",now,25),flight=measure<{id:string;due:number}>("SELECT id,lease_expires_at AS due FROM outbox WHERE status='in_flight' AND lease_expires_at<=? ORDER BY lease_expires_at,id LIMIT ?",now,25);
  const selected=[...pending.rows,...flight.rows].sort((a,b)=>a.due-b.due||(a.id<b.id?-1:a.id>b.id?1:0)).slice(0,25);
  expect(selected.map(row=>row.id)).toEqual(oldClaim.rows.map(row=>row.id));expect(unchangedClaim.rows.map(row=>row.id)).toEqual(oldClaim.rows.map(row=>row.id));expect(pending.rowsRead+flight.rowsRead).toBeLessThanOrEqual(50);
  let hydrationRows=0;for(const row of selected){const q=measure<OutboxRow>('SELECT * FROM outbox WHERE id=?',row.id);expect(q.rows).toEqual(oldClaim.rows.filter(old=>old.id===row.id));hydrationRows+=q.rowsRead;}expect(hydrationRows).toBeLessThanOrEqual(25);
  const plans={oldMin:sql.exec('EXPLAIN QUERY PLAN '+minimum).toArray(),pending:sql.exec("EXPLAIN QUERY PLAN SELECT id,next_due_at AS due FROM outbox WHERE status='pending' AND next_due_at<=? ORDER BY next_due_at,id LIMIT ?",now,25).toArray(),flight:sql.exec("EXPLAIN QUERY PLAN SELECT id,lease_expires_at AS due FROM outbox WHERE status='in_flight' AND lease_expires_at<=? ORDER BY lease_expires_at,id LIMIT ?",now,25).toArray()};
  expect(JSON.stringify(plans.pending)).toContain('study_outbox_pending_order');expect(JSON.stringify(plans.flight)).toContain('study_outbox_lease_order');
  return {liveRows:total,pendingRows:total/2,inFlightRows:total/2,original:{minimumRowsRead:oldMin.rowsRead,claimRowsRead:oldClaim.rowsRead,minimumElapsedMs:oldMin.elapsedMs,claimElapsedMs:oldClaim.elapsedMs,completionRowsRead:oldCompletion.rowsRead,completionElapsedMs:oldCompletion.elapsedMs},indexesOnly:{minimumRowsRead:unchangedMin.rowsRead,claimRowsRead:unchangedClaim.rowsRead,completionRowsRead:unchangedCompletion.rowsRead},splitSeeks:{minimumRowsRead:pendingNext.rowsRead+flightNext.rowsRead,candidateRowsRead:pending.rowsRead+flight.rowsRead,hydrationRowsRead:hydrationRows,totalClaimRowsRead:pending.rowsRead+flight.rowsRead+hydrationRows,keyedCompletionRowsRead:keyedCompletion.rowsRead,minimumElapsedMs:pendingNext.elapsedMs+flightNext.elapsedMs,candidateElapsedMs:pending.elapsedMs+flight.elapsedMs},plans,scope:'Query selection only. Excludes payload bytes, validation joins, signing/network effects, writes and migration cost. performance.now can be frozen inside a synchronous Workers turn; zero timings are not zero cost.'};
 });
 console.info('OUTBOX_BOUND_STUDY '+JSON.stringify(result));
},30000);
