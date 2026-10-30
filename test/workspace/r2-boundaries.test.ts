import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {prepareBootstrap,sha256} from '../../src/config/bootstrap';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {projectEvent} from '../../src/audit/events';
import entry from '../../src/index';
import type {VerifiedIdentity} from '../../src/workspace/context';
async function setup(name:string){
 const raw=await fixture(name),digest=await sha256('A'.repeat(43));raw.bundle.credentials[0].token_sha256=digest;
 const stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration(operator(),await prepareBootstrap(raw.config,raw.bundle,'ws_example'));
 const identity:VerifiedIdentity={kind:'agent',workspaceId:'ws_example',credentialId:'credential_research_1',tokenDigest:digest};
 return {stub,identity};
}
it('unknown_event_resource_and_missing_producer_deny_even_with_permissive_hook',async()=>{
 const {stub,identity}=await setup('r2-unknown-event');
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  const actor=resolveActor(tx,identity,Date.now());
  for(const [type,resource] of [['unknown.event','message'],['task.created','task'],['message.accepted','task'],['constructor','message'],['unknown.event','unrecognized']]){
   tx.exec('INSERT INTO events (id,workspace_id,type,actor_json,resource_type,resource_id,resource_version,thread_id,request_id,occurred_at,summary) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[type+resource,'ws_example',type,JSON.stringify({kind:'agent',principal_id:actor.principalId,agent_id:actor.agentId}),resource,'hidden',null,null,'request',Date.now(),'Hidden summary']);
   expect(projectEvent(tx,actor,type+resource,Date.now(),()=>true)).toBeNull();
  }
 }));
});
it('r3_and_unimplemented_r2_routes_remain_unavailable_without_durable_writes',async()=>{
 const {stub}=await setup('r2-unavailable');
 // Runtime enrollment and task metadata are now owned by #26/#27; valid-body old-R1 denial is covered in r1-isolation.
 const paths=['tasks/task_a:cancel','tasks/task_a:request-decision','tasks/task_a:claim','tasks/task_a:submit-result','approvals','approvals/approval_a:approve','artifacts','search','imports:preview','catalog:apply'];
 const snapshot=()=>runInDurableObject(stub,(_o,state)=>({events:state.storage.sql.exec('SELECT * FROM events').toArray(),outcomes:state.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray(),scheduler:state.storage.sql.exec('SELECT * FROM scheduler_state').toArray(),tables:state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").toArray()}));
 const before=await snapshot();
 for(const path of paths){
  const request=()=>new Request('https://hub.example.invalid/v2/workspaces/ws_example/'+path,{method:'POST',headers:{authorization:'Bearer '+'A'.repeat(43),'content-type':'application/json'},body:'{}'});
  expect((await entry.fetch(request(),env)).status).toBe(404);
  expect((await stub.fetch(request())).status).toBe(404);
 }
 expect(await snapshot()).toEqual(before);
});
