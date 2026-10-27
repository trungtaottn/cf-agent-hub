import {resetLegacyAuthorityFixture} from '../helpers/legacy-migration-fixture';
import {it,expect} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
import {messageFixture,messageInput,messageSnapshot,owned,commandContext} from '../helpers/messages';
it('commit_loss_replays_original_message',async()=>{
 const {stub,name,identity}=await messageFixture('message-replay');let original:unknown,before:unknown;
 await runInDurableObject(stub,async(_o,state)=>{const body=messageInput(),ctx=await commandContext(state.storage,name,body,'same');original=executeCommand(ctx,identity,messageCommand(owned(state.storage,name)),body);before=messageSnapshot(state.storage);});
 await evictDurableObject(stub);
 await runInDurableObject(stub,async(_o,state)=>{const body=messageInput(),ctx=await commandContext(state.storage,name,body,'same');expect(executeCommand(ctx,identity,messageCommand(owned(state.storage,name)),body)).toEqual(original);expect(messageSnapshot(state.storage)).toEqual(before);expect(state.storage.sql.exec('SELECT count(*) AS n FROM messages').one()).toEqual({n:1});console.info('TASK7_RESTART_REPLAY_SQL_EVIDENCE',JSON.stringify(messageSnapshot(state.storage)));});
});
import {human} from '../helpers/settings';
import {canonicalJson} from '../../src/config/bootstrap';
import {validateEvent,validateMessageNotification} from '../../src/http/generated/auth-validators.js';
import {messageRoutes} from '../../src/http/message-routes';
function addAgent(storage:DurableObjectStorage,id:string,scopes=['messages:read'],projects:string[]|null=null){
 storage.sql.exec('INSERT INTO static_agents (agent_id,workspace_id,display_name,config_epoch) VALUES (?,?,?,1)',id,'ws_example',id);
 storage.sql.exec('INSERT INTO native_credentials (credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch) VALUES (?,?,?,?,?,?,?,1,1)','credential_'+id,'ws_example',id,'b'.repeat(64),JSON.stringify(scopes),JSON.stringify(projects),Date.now()+1000000);
}
async function send(storage:DurableObjectStorage,name:string,identity:Parameters<typeof executeCommand>[1],body=messageInput(),key='send'){
 return executeCommand(await commandContext(storage,name,body,key),identity,messageCommand(owned(storage,name)),body);
}
it('crash_each_insert_rolls_back_all_five_families',async()=>{
 const {stub,name,identity}=await messageFixture('message-rollback');
 await runInDurableObject(stub,async(_o,state)=>{
  for(const table of ['threads','thread_participants','messages','inbox','outbox','scheduler_state','events','idempotency_outcomes']){
   const before=messageSnapshot(state.storage);state.storage.sql.exec(`CREATE TRIGGER injected AFTER INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'fault_${table}'); END`);
   await expect(send(state.storage,name,identity)).rejects.toThrow();expect(messageSnapshot(state.storage)).toEqual(before);state.storage.sql.exec('DROP TRIGGER injected');
  }
  const committed=await send(state.storage,name,identity);expect(committed.status).toBe(201);const beforeReply=messageSnapshot(state.storage);state.storage.sql.exec("CREATE TRIGGER injected AFTER INSERT ON events BEGIN SELECT RAISE(ABORT,'fault_existing_scheduler'); END");await expect(send(state.storage,name,identity,messageInput({thread_id:committed.data.thread_id}),'reply')).rejects.toThrow();expect(messageSnapshot(state.storage)).toEqual(beforeReply);state.storage.sql.exec('DROP TRIGGER injected');
 });
});
it('thread_reply_cannot_add_participant',async()=>{
 const {stub,name,identity}=await messageFixture('message-fixed');await runInDurableObject(stub,async(_o,state)=>{
  const first=await send(state.storage,name,identity);addAgent(state.storage,'new_agent');const before=messageSnapshot(state.storage);
  await expect(send(state.storage,name,identity,messageInput({thread_id:first.data.thread_id,recipient_agent_ids:['new_agent']}),'reply')).rejects.toMatchObject({code:'NOT_FOUND'});expect(messageSnapshot(state.storage)).toEqual(before);
  const reviewer=human(state.storage);await expect(send(state.storage,name,reviewer,messageInput({thread_id:first.data.thread_id}),'reviewer')).rejects.toMatchObject({code:'NOT_FOUND'});
 });
});
it('human_sender_membership_survives_restart_and_reviewer_cannot_reply',async()=>{
 const {stub,name}=await messageFixture('message-human');let thread='';
 await runInDurableObject(stub,async(_o,state)=>{const first=await send(state.storage,name,human(state.storage));thread=first.data.thread_id;expect(state.storage.sql.exec("SELECT participant_kind,participant_id FROM thread_participants WHERE participant_kind='human'").one()).toEqual({participant_kind:'human',participant_id:'human_operator'});});
 await evictDurableObject(stub);await runInDurableObject(stub,async(_o,state)=>{expect((await send(state.storage,name,human(state.storage),messageInput({thread_id:thread}),'reply')).status).toBe(201);await expect(send(state.storage,name,human(state.storage,true),messageInput({thread_id:thread}),'other')).rejects.toMatchObject({code:'NOT_FOUND'});});
});
it('recipient_must_be_enabled_static_agent',async()=>{
 const {stub,name}=await messageFixture('message-recipient');await runInDurableObject(stub,async(_o,state)=>{
  const identity=human(state.storage),base=state.storage.sql.exec('SELECT * FROM native_credentials').one();
  for(const change of ["enabled=0","expires_at=0","retired_at_epoch=1,enabled=0","config_epoch=2","scopes_json='[]'","project_ids_json='[]'"]){
   state.storage.sql.exec('UPDATE native_credentials SET '+change);const before=messageSnapshot(state.storage);await expect(send(state.storage,name,identity)).rejects.toMatchObject({code:'NOT_FOUND'});expect(messageSnapshot(state.storage)).toEqual(before);
   state.storage.sql.exec('UPDATE native_credentials SET enabled=1,expires_at=?,retired_at_epoch=NULL,config_epoch=1,scopes_json=?,project_ids_json=?',base.expires_at,base.scopes_json,base.project_ids_json);
  }
  state.storage.sql.exec('DELETE FROM static_agents');await expect(send(state.storage,name,identity)).rejects.toMatchObject({code:'NOT_FOUND'});
 });
});
it('disjoint_credentials_cannot_be_combined_and_caller_proof_cannot_be_broadened',async()=>{
 const {stub,name,identity}=await messageFixture('message-coherent');await runInDurableObject(stub,async(_o,state)=>{
  addAgent(state.storage,'split',['messages:read'],[]);
  state.storage.sql.exec("INSERT INTO native_credentials (credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch) SELECT 'split_other',workspace_id,agent_id,token_sha256,'[]','null',expires_at,enabled,config_epoch,retired_at_epoch FROM native_credentials WHERE agent_id='split'");
  await expect(send(state.storage,name,identity,messageInput({recipient_agent_ids:['split']}))).rejects.toMatchObject({code:'NOT_FOUND'});state.storage.sql.exec("INSERT INTO native_credentials (credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch) SELECT 'split_valid',workspace_id,agent_id,token_sha256,'[\"messages:read\"]','null',expires_at,enabled,config_epoch,retired_at_epoch FROM native_credentials WHERE credential_id='credential_split'");expect((await send(state.storage,name,identity,messageInput({recipient_agent_ids:['split']}),'coherent')).status).toBe(201);
  const reference=await send(state.storage,name,identity,messageInput(),'reference');
  state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"messages:send\"]' WHERE credential_id='credential_research_1'");
  state.storage.sql.exec("INSERT INTO native_credentials (credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch) SELECT 'caller_other',workspace_id,agent_id,token_sha256,'[\"messages:read\"]','null',expires_at,enabled,config_epoch,retired_at_epoch FROM native_credentials WHERE credential_id='credential_research_1'");
  await expect(send(state.storage,name,identity,messageInput({refs:[{kind:'message',id:reference.data.id}]}),'leak')).rejects.toMatchObject({code:'NOT_FOUND'});
 });
});
it('foreign_or_private_reference_rejected_including_omitted_fixed_participants',async()=>{
 const {stub,name,identity}=await messageFixture('message-references');await runInDurableObject(stub,async(_o,state)=>{
  addAgent(state.storage,'omitted');
  const privateMessage=await send(state.storage,name,identity,messageInput(),'private');
  const fixed=await send(state.storage,name,identity,messageInput({recipient_agent_ids:['agent_research','omitted']}),'fixed');const before=messageSnapshot(state.storage);
  for(const id of [privateMessage.data.id,'foreign_or_missing'])await expect(send(state.storage,name,identity,messageInput({thread_id:fixed.data.thread_id,refs:[{kind:'message',id}]}),'reply_'+id)).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(messageSnapshot(state.storage)).toEqual(before);
  state.storage.sql.exec('UPDATE messages SET workspace_id=? WHERE id=?','ws_foreign',privateMessage.data.id);
  await expect(send(state.storage,name,identity,messageInput({refs:[{kind:'message',id:privateMessage.data.id}]}),'foreign')).rejects.toMatchObject({code:'NOT_FOUND'});
 });
});
it('missing_artifact_task_refs_rejected_atomically',async()=>{
 const {stub,name,identity}=await messageFixture('message-disabled');await runInDurableObject(stub,async(_o,state)=>{
  const before=messageSnapshot(state.storage);
  for(const body of [messageInput({artifact_ids:['absent']}),messageInput({refs:[{kind:'artifact',id:'absent'}]}),messageInput({refs:[{kind:'task',id:'absent'}]})])await expect(send(state.storage,name,identity,body)).rejects.toMatchObject({code:'NOT_FOUND',details:undefined});
  expect(messageSnapshot(state.storage)).toEqual(before);
 });
});
it('outbox_acceptance_is_not_delivery_or_ack_and_payload_is_immutable',async()=>{
 const {stub,name,identity}=await messageFixture('message-linkage');await runInDurableObject(stub,async(_o,state)=>{
  const result=await send(state.storage,name,identity);expect(result.status).toBe(201);expect(result.data.acknowledged_at).toBeNull();
  const row=state.storage.sql.exec('SELECT * FROM outbox').one(),event=state.storage.sql.exec("SELECT * FROM events WHERE type='message.accepted'").one(),outcome=state.storage.sql.exec("SELECT * FROM idempotency_outcomes WHERE operation='domain.messages:send'").one(),payload=JSON.parse(row.payload_json as string);
  expect(validateMessageNotification(payload)).toBe(true);expect(row.id).toBe(row.notification_id);expect(payload).toEqual({payload_version:1,type:'message.accepted',delivery_id:row.id,workspace_id:'ws_example',recipient_agent_id:'agent_research',message_id:result.data.id,thread_id:result.data.thread_id,event_id:event.id,occurred_at:new Date(event.occurred_at as number).toISOString()});
  expect(outcome.event_id).toBe(event.id);expect(row.payload_json).toBe(canonicalJson(payload));expect(JSON.parse(row.destination_snapshot_json as string)).toEqual({agent_id:'agent_research',url:'https://receiver.example.invalid/cfhub',signing_key_ref:'NOTIFICATION_SIGNING_KEY'});
  expect(row).toMatchObject({status:'pending',attempts:0,next_due_at:event.occurred_at,created_at:event.occurred_at,updated_at:event.occurred_at,lease_token:null,lease_expires_at:null,last_status:null,last_error:null});expect(row.retry_multiplier).toBeGreaterThanOrEqual(.8);expect(row.retry_multiplier).toBeLessThanOrEqual(1);
  expect(state.storage.sql.exec('SELECT dirty,generation FROM scheduler_state').one()).toEqual({dirty:1,generation:1});
  state.storage.sql.exec('UPDATE inbox SET acknowledged_at=123');const before=messageSnapshot(state.storage);expect(await send(state.storage,name,identity)).toEqual(result);expect(messageSnapshot(state.storage)).toEqual(before);
 });
});
it('zero_destination_retains_inbox_without_inventing_transport',async()=>{
 const {stub,name,identity}=await messageFixture('message-polling');await runInDurableObject(stub,async(_o,state)=>{
  const config=JSON.parse(state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one().config_json);config.workspace_policies[0].notification_destinations=[];state.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',JSON.stringify(config));
  expect((await send(state.storage,name,identity)).status).toBe(201);expect(state.storage.sql.exec('SELECT count(*) AS n FROM inbox').one()).toEqual({n:1});expect(state.storage.sql.exec('SELECT count(*) AS n FROM outbox').one()).toEqual({n:0});expect(state.storage.sql.exec('SELECT count(*) AS n FROM scheduler_state').one()).toEqual({n:0});
 });
});
it('opaque_event_thread_linkage_and_closed_notification_contract',async()=>{
 const {stub,name,identity}=await messageFixture('message-opaque');await runInDurableObject(stub,async(_o,state)=>{
  const thread='opaque /?# '+ '長'.repeat(140);state.storage.sql.exec('INSERT INTO threads VALUES (?,?,?,?)',thread,'ws_example','',Date.now());state.storage.sql.exec('INSERT INTO thread_participants VALUES (?,?,?)',thread,'agent','agent_research');
  const result=await send(state.storage,name,identity,messageInput({thread_id:thread}));expect(result.data.thread_id).toBe(thread);
  const row=state.storage.sql.exec("SELECT * FROM events WHERE type='message.accepted'").one();expect(row.thread_id).toBe(thread);
  const event:Record<string,unknown>={...row,actor:JSON.parse(row.actor_json as string),occurred_at:new Date(row.occurred_at as number).toISOString(),task_version:null,run_id:null,fence:null};delete event.actor_json;expect(validateEvent(event)).toBe(true);
  expect(validateEvent({...event,thread_id:''})).toBe(false);expect(validateEvent({...event,thread_id:12})).toBe(false);expect(validateEvent({...event,type:'message.acknowledged'})).toBe(false);
  const payload=JSON.parse(state.storage.sql.exec<{payload_json:string}>('SELECT payload_json FROM outbox').one().payload_json);expect(validateMessageNotification({...payload,body:'secret'})).toBe(false);expect(validateMessageNotification({...payload,payload_version:2})).toBe(false);
 });
});
it('http_message_admission_uses_real_command_and_byte_boundaries',async()=>{
 const {stub,name}=await messageFixture('message-http');await runInDurableObject(stub,async(_o,state)=>{
  const request=(body:unknown,key:string)=>new Request('https://hub.example.invalid/v2/workspaces/ws_example/messages',{method:'POST',headers:{authorization:'Bearer '+'A'.repeat(43),'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});
  const w=owned(state.storage,name);expect((await messageRoutes(request(messageInput({body:'😀'.repeat(8192)}),'limit'),w)).status).toBe(201);
  const before=messageSnapshot(state.storage);expect((await messageRoutes(request(messageInput({body:'😀'.repeat(8192)+'a'}),'over'),w)).status).toBe(413);expect(messageSnapshot(state.storage)).toEqual(before);
  expect((await messageRoutes(request({...messageInput(),sender:{kind:'human'}},'closed'),w)).status).toBe(400);
 });
});
import {migrate,FOUNDATION_SQL} from '../../src/storage/migrations';
it('forward_migration_preserves_legacy_membership_bytes_attempts_and_unproven_route',async()=>{
 const {stub}=await messageFixture('message-legacy');await runInDurableObject(stub,async(_o,state)=>{
  await resetLegacyAuthorityFixture(state.storage,3);
  state.storage.sql.exec("INSERT INTO threads VALUES ('legacy-thread','ws_example','',1)");state.storage.sql.exec("INSERT INTO thread_participants VALUES ('legacy-thread','agent_research')");
  state.storage.sql.exec("INSERT INTO outbox (id,workspace_id,message_id,destination_id,notification_id,payload_json,status,attempts,next_due_at,retry_multiplier,created_at,updated_at) VALUES ('legacy','ws_example','legacy-message','research','original-notification','{\"old\": true}','exhausted',6,100,.9,1,2)");state.storage.sql.exec('INSERT INTO scheduler_state VALUES (1,100,90,80)');
  const before=state.storage.sql.exec('SELECT * FROM outbox').one();state.storage.sql.exec("CREATE TRIGGER migration_fault BEFORE INSERT ON schema_migrations WHEN NEW.version=4 BEGIN SELECT RAISE(ABORT,'migration_fault'); END");
  expect(()=>migrate(state.storage)).toThrow();expect(state.storage.sql.exec('SELECT * FROM outbox').one()).toEqual(before);expect(state.storage.sql.exec('SELECT * FROM thread_participants').one()).toEqual({thread_id:'legacy-thread',agent_id:'agent_research'});state.storage.sql.exec('DROP TRIGGER migration_fault');
  migrate(state.storage);expect(state.storage.sql.exec('SELECT * FROM outbox').one()).toEqual({...before,destination_snapshot_json:null});expect(state.storage.sql.exec('SELECT * FROM thread_participants').one()).toEqual({thread_id:'legacy-thread',participant_kind:'agent',participant_id:'agent_research'});expect(state.storage.sql.exec('SELECT * FROM scheduler_state').one()).toEqual({id:1,next_due_at:100,armed_at:90,last_run_at:80,dirty:0,generation:0,last_error_code:null});
  state.storage.sql.exec("UPDATE outbox SET status='suppressed'");expect(()=>state.storage.sql.exec('UPDATE scheduler_state SET generation=-1')).toThrow();expect(()=>state.storage.sql.exec('UPDATE scheduler_state SET dirty=2')).toThrow();
  console.info('TASK7_LEGACY_SQL_EVIDENCE',JSON.stringify({outbox:state.storage.sql.exec('SELECT * FROM outbox').one(),participants:state.storage.sql.exec('SELECT * FROM thread_participants').toArray(),scheduler:state.storage.sql.exec('SELECT * FROM scheduler_state').one()}));
 });
});
it('notifications_are_per_enabled_addressed_destination_and_scheduler_advances',async()=>{
 const {stub,name,identity}=await messageFixture('message-destinations');await runInDurableObject(stub,async(_o,state)=>{
  const config=JSON.parse(state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one().config_json);const destinations=config.workspace_policies[0].notification_destinations;
  destinations.push({...destinations[0],destination_id:'second',url:'https://receiver.example.invalid/second'},{...destinations[0],destination_id:'disabled',enabled:false});state.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',JSON.stringify(config));
  const first=await send(state.storage,name,identity);expect(state.storage.sql.exec('SELECT count(*) AS n FROM inbox').one()).toEqual({n:1});expect(state.storage.sql.exec('SELECT count(*) AS n FROM outbox').one()).toEqual({n:2});expect(state.storage.sql.exec('SELECT dirty,generation FROM scheduler_state').one()).toEqual({dirty:1,generation:2});
  expect(new Set(state.storage.sql.exec<{id:string}>('SELECT id FROM outbox').toArray().map(x=>x.id)).size).toBe(2);
  await send(state.storage,name,identity,messageInput({thread_id:first.data.thread_id}),'reply');expect(state.storage.sql.exec('SELECT dirty,generation FROM scheduler_state').one()).toEqual({dirty:1,generation:4});
 });
});
it('actual_do_route_accepts_post_and_denies_other_workspace_and_preflight_is_bounded',async()=>{
 const {stub}=await messageFixture('message-route');const url='https://hub.example.invalid/v2/workspaces/ws_example/messages';
 const response=await stub.fetch(new Request(url,{method:'POST',headers:{authorization:'Bearer '+'A'.repeat(43),'idempotency-key':'route','content-type':'application/json'},body:JSON.stringify(messageInput())}));expect(response.status).toBe(201);expect((await response.json() as {data:{acknowledged_at:unknown}}).data.acknowledged_at).toBeNull();
 const foreign=await stub.fetch(new Request(url.replace('ws_example','foreign'),{method:'POST'}));expect(foreign.status).toBe(401);await foreign.text();
 const preflight=await stub.fetch(new Request(url,{method:'OPTIONS',headers:{origin:'https://hub.example.invalid','access-control-request-method':'POST','access-control-request-headers':'content-type,idempotency-key,x-csrf-token'}}));expect(preflight.status).toBe(204);expect(preflight.headers.get('access-control-allow-methods')).toBe('POST');await preflight.text();
 const denied=await stub.fetch(new Request(url,{method:'OPTIONS',headers:{origin:'https://evil.invalid','access-control-request-method':'POST'}}));expect(denied.status).toBe(403);await denied.text();
});
import notificationExample from '../../examples/http/r1-message-notification.json';
it('canonical_sanitized_notification_example_is_valid',()=>{expect(validateMessageNotification(notificationExample)).toBe(true);});
it('fixed_human_visibility_uses_current_grant_without_a_fabricated_session',async()=>{
 const {stub,name,identity}=await messageFixture('message-human-grant');await runInDurableObject(stub,async(_o,state)=>{
  const first=await send(state.storage,name,human(state.storage));state.storage.sql.exec('UPDATE sessions SET revoked_at=1');
  expect((await send(state.storage,name,identity,messageInput({thread_id:first.data.thread_id,refs:[{kind:'message',id:first.data.id}]}),'reply')).status).toBe(201);
  state.storage.sql.exec('UPDATE human_grants SET enabled=0');const before=messageSnapshot(state.storage);await expect(send(state.storage,name,identity,messageInput({thread_id:first.data.thread_id,refs:[{kind:'message',id:first.data.id}]}),'denied')).rejects.toMatchObject({code:'NOT_FOUND'});expect(messageSnapshot(state.storage)).toEqual(before);
 });
});
it('caller_project_restriction_cannot_be_broadened_by_another_credential',async()=>{
 const {stub,name,identity}=await messageFixture('message-caller-project');await runInDurableObject(stub,async(_o,state)=>{
  state.storage.sql.exec("INSERT INTO native_credentials (credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch) SELECT 'read_only_other',workspace_id,agent_id,token_sha256,'[\"messages:read\"]','null',expires_at,enabled,config_epoch,retired_at_epoch FROM native_credentials WHERE credential_id='credential_research_1'");state.storage.sql.exec("UPDATE native_credentials SET project_ids_json='[]' WHERE credential_id='credential_research_1'");
  const before=messageSnapshot(state.storage);await expect(send(state.storage,name,identity)).rejects.toMatchObject({code:'FORBIDDEN'});expect(messageSnapshot(state.storage)).toEqual(before);
 });
});
