import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {messageFixture,messageInput,commandContext,owned} from '../helpers/messages';
import {human,actor} from '../helpers/settings';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
import {withTransaction} from '../../src/storage/transaction';
import {projectOperations} from '../../src/http/operations-routes';
import {login} from '../helpers/auth';
it('operations_projects_real_counts_and_unknown_readiness_without_fabricated_probe',async()=>{
 const {stub,name,identity}=await messageFixture('operations-counts');await runInDurableObject(stub,async(_o,state)=>{
  const body=messageInput();executeCommand(await commandContext(state.storage,name,body,'send'),identity,messageCommand(owned(state.storage,name)),body);
  state.storage.sql.exec("UPDATE outbox SET status='exhausted',attempts=6,last_error='network'");const h=actor(state.storage,human(state.storage)),workspace=owned(state.storage,name);
  const data=withTransaction(state.storage,tx=>projectOperations(tx,workspace,h,Date.now()));
  expect(data.outbox).toMatchObject({pending_count:0,in_flight_count:0,failed_count:1,suppressed_count:0});
  expect(data.readiness.ready).toBe(false);
  expect(data.readiness.checks).toContainEqual({name:'storage_probe',status:'unknown',code:'PROBE_NOT_RUN',checked_at:null});
  expect(data.readiness.checks).toContainEqual(expect.objectContaining({name:'delivery',status:'fail',code:'DELIVERY_FAILURES'}));
  expect(data.readiness.checks).toContainEqual({name:'r2_artifacts',status:'unknown',code:'CAPABILITY_UNAVAILABLE_R1',checked_at:null});expect(data.schema_version).toBe(8);
  state.storage.sql.exec('UPDATE human_grants SET enabled=0');expect(()=>withTransaction(state.storage,tx=>projectOperations(tx,workspace,h,Date.now()))).toThrow();
 });
});
it('operations_http_requires_current_human_scope_and_has_no_repair_route',async()=>{
 const {stub}=await messageFixture('operations-http');
 const root='https://hub.example.invalid/v2/workspaces/ws_example';
 expect((await stub.fetch(new Request(root+'/operations'))).status).toBe(401);
 expect((await stub.fetch(new Request(root+'/operations',{headers:{authorization:'Bearer '+'A'.repeat(43)}}))).status).toBe(403);
 const signed=await login(stub);expect(signed.response.status).toBe(302);
 expect((await stub.fetch(new Request(root+'/operations',{headers:{cookie:signed.cookie}}))).status).toBe(200);
 for(const path of ['/operations:repair','/deliveries:redrive','/readiness'])expect((await stub.fetch(new Request(root+path,{method:'POST'}))).status).toBe(404);
 await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec("UPDATE human_grants SET scopes_json='[]'"));
 expect((await stub.fetch(new Request(root+'/operations',{headers:{cookie:signed.cookie}}))).status).toBe(403);
});
