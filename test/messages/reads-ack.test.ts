import {it,expect,vi} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {messageFixture,messageInput,messageSnapshot,owned,commandContext} from '../helpers/messages';
import {human} from '../helpers/settings';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
import {messageRoutes} from '../../src/http/message-routes';
const root='https://hub.example.invalid/v2/workspaces/ws_example';
function workspace(storage:DurableObjectStorage,name:string){return {...owned(storage,name),secrets:{...owned(storage,name).secrets,CURSOR_ENCRYPTION_KEY:'c'.repeat(64)}};}
function request(path:string,method='GET',body?:unknown,key='ack'){return new Request(root+path,{method,headers:{authorization:'Bearer '+'A'.repeat(43),...(body?{'content-type':'application/json','idempotency-key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});}
async function get(storage:DurableObjectStorage,name:string,path:string){return messageRoutes(request(path),workspace(storage,name));}
async function send(storage:DurableObjectStorage,name:string,identity:Parameters<typeof executeCommand>[1],key:string,thread?:string){
 const body=messageInput(thread?{thread_id:thread}:{});return executeCommand(await commandContext(storage,name,body,key),identity,messageCommand(owned(storage,name)),body).data;
}
it('thread_501_items_all_accessible_in_order',async()=>{
 const {stub,name,identity}=await messageFixture('read-501');let thread='',expected:string[]=[],cursor:string|null=null,seen:string[]=[];
 await runInDurableObject(stub,async(_o,state)=>{
  const first=await send(state.storage,name,identity,'first');thread=first.thread_id;expected=[first.id];
  const row=state.storage.sql.exec('SELECT * FROM messages').one();
  for(let i=1;i<=500;i++){const id='retained_'+String(i).padStart(4,'0');expected.push(id);state.storage.sql.exec('INSERT INTO messages SELECT ?,workspace_id,thread_id,sender_kind,sender_principal_id,sender_agent_id,body,refs_json,? FROM messages WHERE id=?',id,Number(row.created_at)+i,first.id);state.storage.sql.exec('INSERT INTO inbox VALUES (?,?,?,?,NULL)',id,'agent_research','ws_example',Number(row.created_at)+i);}
  const response=await get(state.storage,name,'/threads/'+thread+'?limit=500');expect(response.status).toBe(200);const page=await response.json<any>();seen=page.data.map((x:any)=>x.id);cursor=page.page.next_cursor;expect(seen).toEqual(expected.slice(0,500));expect(cursor).toBeTypeOf('string');
 });
 await evictDurableObject(stub);
 await runInDurableObject(stub,async(_o,state)=>{const response=await get(state.storage,name,'/threads/'+thread+'?limit=500&cursor='+cursor);expect(response.status).toBe(200);const p=await response.json<any>();seen.push(...p.data.map((x:any)=>x.id));expect(seen).toEqual(expected);expect(p.page).toEqual({has_more:false,next_cursor:null});console.info('TASK8_TRAVERSAL_IDS',JSON.stringify(seen));});
});
it('concurrent_insert_above_high_water_not_in_traversal_and_ack_preserves_progress',async()=>{
 const {stub,name,identity}=await messageFixture('read-highwater');await runInDurableObject(stub,async(_o,state)=>{
  const a=await send(state.storage,name,identity,'a'),b=await send(state.storage,name,identity,'b',a.thread_id),c=await send(state.storage,name,identity,'c',a.thread_id);
  const one=await get(state.storage,name,'/inbox?limit=1');expect(one.status).toBe(200);const p=await one.json<any>();
  const ack=await messageRoutes(request('/messages:ack','POST',{message_ids:[p.data[0].id]},'ack'),workspace(state.storage,name));expect(ack.status).toBe(200);
  const later=await send(state.storage,name,identity,'later',a.thread_id);const upper=state.storage.sql.exec<{n:number}>('SELECT MAX(created_at) AS n FROM messages').one().n+1;state.storage.sql.exec('UPDATE messages SET created_at=? WHERE id=?',upper,later.id);state.storage.sql.exec('UPDATE inbox SET created_at=? WHERE message_id=?',upper,later.id);
  const seen=p.data.map((x:any)=>x.id);let cursor=p.page.next_cursor;
  while(cursor){const r=await get(state.storage,name,'/inbox?limit=1&cursor='+cursor);expect(r.status).toBe(200);const next=await r.json<any>();seen.push(...next.data.map((x:any)=>x.id));cursor=next.page.next_cursor;}
  expect(new Set(seen)).toEqual(new Set([a.id,b.id,c.id]));expect(seen.length).toBe(3);console.info('TASK8_HIGHWATER_ACK',JSON.stringify(seen));
 });
});
it('oversized_or_foreign_ack_rolls_back_whole_batch_and_repeat_preserves_timestamp',async()=>{
 const {stub,name,identity}=await messageFixture('ack-atomic');await runInDurableObject(stub,async(_o,state)=>{
  const a=await send(state.storage,name,identity,'a');const before=messageSnapshot(state.storage);
  for(const ids of [[a.id,'foreign'],Array.from({length:201},(_,i)=>'id_'+i),[],[a.id,a.id]]){
   const r=await messageRoutes(request('/messages:ack','POST',{message_ids:ids}),workspace(state.storage,name));expect(r.status).toBe(ids.includes('foreign')?404:400);expect(messageSnapshot(state.storage)).toEqual(before);
  }
  const first=await messageRoutes(request('/messages:ack','POST',{message_ids:[a.id]},'one'),workspace(state.storage,name));expect(first.status).toBe(200);expect((await first.json<any>()).data).toEqual({acknowledged_ids:[a.id],already_acknowledged_ids:[]});
  const timestamp=state.storage.sql.exec('SELECT acknowledged_at FROM inbox').one().acknowledged_at,bytes=state.storage.sql.exec('SELECT payload_json,destination_snapshot_json FROM outbox').toArray(),generation=state.storage.sql.exec('SELECT generation FROM scheduler_state').one().generation;
  const second=await messageRoutes(request('/messages:ack','POST',{message_ids:[a.id]},'two'),workspace(state.storage,name));expect(second.status).toBe(200);expect((await second.json<any>()).data).toEqual({acknowledged_ids:[],already_acknowledged_ids:[a.id]});
  expect(state.storage.sql.exec('SELECT acknowledged_at FROM inbox').one().acknowledged_at).toBe(timestamp);expect(state.storage.sql.exec('SELECT payload_json,destination_snapshot_json FROM outbox').toArray()).toEqual(bytes);expect(state.storage.sql.exec('SELECT generation FROM scheduler_state').one().generation).toBe(generation);
  expect(state.storage.sql.exec("SELECT count(*) AS n FROM events WHERE type='message.acknowledged'").one()).toEqual({n:2});
 });
});
it('cursor_from_other_workspace_principal_or_filter_denied_and_tampered_expired_denied',async()=>{
 const {stub,name,identity}=await messageFixture('cursor-binding');await runInDurableObject(stub,async(_o,state)=>{
  await send(state.storage,name,identity,'a');await send(state.storage,name,identity,'b');
  const r=await get(state.storage,name,'/inbox?limit=1');expect(r.status).toBe(200);const p=await r.json<any>(),cursor=p.page.next_cursor;
  for(const path of ['/inbox?limit=2&cursor='+cursor,'/inbox?limit=1&acknowledged=true&cursor='+cursor,'/events?limit=1&cursor='+cursor,'/inbox?limit=1&cursor='+cursor.slice(0,-4)+'AAAA'])expect((await get(state.storage,name,path)).status).toBe(400);
  const expired=workspace(state.storage,name);expired.clock={nowMs:()=>Date.now()+3600001};
  state.storage.sql.exec('UPDATE native_credentials SET expires_at=?',Date.now()+10000000);
  expect((await messageRoutes(request('/inbox?limit=1&cursor='+cursor),expired)).status).toBe(410);
  for(const limit of ['0','-1','1.5','201','NaN'])expect((await get(state.storage,name,'/inbox?limit='+limit)).status).toBe(400);
  const foreign=request('/inbox');const other=new Request(foreign.url.replace('ws_example','ws_other'),foreign);expect((await messageRoutes(other,workspace(state.storage,name))).status).toBe(404);
 });
});
it('persisted_message_event_projects_authorized_thread_id_and_hidden_deleted_events_disappear',async()=>{
 const {stub,name,identity}=await messageFixture('read-event-link');await runInDurableObject(stub,async(_o,state)=>{
  const a=await send(state.storage,name,identity,'a');const opaque='thread / opaque Ω '+ 'x'.repeat(150);
  state.storage.sql.exec('PRAGMA defer_foreign_keys=ON');state.storage.sql.exec('UPDATE threads SET id=? WHERE id=?',opaque,a.thread_id);state.storage.sql.exec('UPDATE thread_participants SET thread_id=? WHERE thread_id=?',opaque,a.thread_id);state.storage.sql.exec('UPDATE messages SET thread_id=? WHERE id=?',opaque,a.id);
  const r=await get(state.storage,name,'/events');expect(r.status).toBe(200);const p=await r.json<any>();expect(p.data.find((x:any)=>x.type==='message.accepted').thread_id).toBe(opaque);
  state.storage.sql.exec("DELETE FROM thread_participants WHERE participant_kind='agent'");
  const hidden=await (await get(state.storage,name,'/events')).json<any>();expect(hidden.data).toEqual([]);expect(JSON.stringify(hidden)).not.toContain(a.id);
 });
});

import {sha256,canonicalJson,prepareBootstrap} from '../../src/config/bootstrap';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {recordRetentionFloor} from '../../src/messages/reads';
import {ackCommand} from '../../src/messages/ack';
import {profileCommand,preferencesCommand} from '../../src/config/settings-service';
import {preference} from '../helpers/settings';
import {neutralProfile} from '../../src/config/profile';
import {projectEvent,resourceEventVisibility} from '../../src/audit/events';
async function humanRequest(storage:DurableObjectStorage,path:string,other=false){
 const identity=human(storage,other);if(identity.kind!=='human')throw Error('fixture');
 const token=other?'E'.repeat(43):'I'.repeat(43),digest=await sha256(token);storage.sql.exec('UPDATE sessions SET token_digest=? WHERE id=?',digest,identity.sessionId);
 return new Request(root+path,{headers:{cookie:'cfhub_session='+token}});
}
it('empty_filtered_page_advances_hidden_scans_without_ids_snippets_or_counts',async()=>{
 const {stub,name,identity}=await messageFixture('read-empty');await runInDurableObject(stub,async(_o,state)=>{
  const a=await send(state.storage,name,identity,'a');const first=await get(state.storage,name,'/events?limit=1');expect(first.status).toBe(200);const page=await first.json<any>();expect(page.data).toEqual([]);expect(page.page.has_more).toBe(true);expect(page.page.next_cursor).toBeTypeOf('string');expect(Object.keys(page).sort()).toEqual(['data','page','request_id']);expect(JSON.stringify(page)).not.toContain('configuration_1');
  const next=await (await get(state.storage,name,'/events?limit=1&cursor='+page.page.next_cursor)).json<any>();expect(next.data[0].resource_id).toBe(a.id);expect(next.page).toEqual({next_cursor:null,has_more:false});
  state.storage.sql.exec('DELETE FROM inbox WHERE message_id=?',a.id);state.storage.sql.exec('DELETE FROM messages WHERE id=?',a.id);
  const deleted=await (await get(state.storage,name,'/events')).json<any>();expect(deleted.data).toEqual([]);expect(JSON.stringify(deleted)).not.toContain(a.id);
 });
});
it('retention_invalidated_cursor_requires_recorded_truncation_not_missing_row',async()=>{
 const {stub,name,identity}=await messageFixture('read-retention');await runInDurableObject(stub,async(_o,state)=>{
  await send(state.storage,name,identity,'a');await send(state.storage,name,identity,'b');await send(state.storage,name,identity,'c');
  const rows=state.storage.sql.exec<{id:string;created_at:number}>('SELECT id,created_at FROM messages ORDER BY created_at,id').toArray(),first=await (await get(state.storage,name,'/inbox?limit=1')).json<any>();
  state.storage.sql.exec('DELETE FROM inbox WHERE message_id=?',rows[0].id);state.storage.sql.exec('DELETE FROM messages WHERE id=?',rows[0].id);
  expect((await get(state.storage,name,'/inbox?limit=1&cursor='+first.page.next_cursor)).status).toBe(200);
  withTransaction(state.storage,tx=>{tx.exec('DELETE FROM inbox WHERE message_id=?',[rows[1].id]);tx.exec('DELETE FROM messages WHERE id=?',[rows[1].id]);recordRetentionFloor(tx,'ws_example',{createdAt:rows[1].created_at,id:rows[1].id});});
  const invalid=await get(state.storage,name,'/inbox?limit=1&cursor='+first.page.next_cursor);expect(invalid.status).toBe(410);expect((await invalid.json<any>()).error.code).toBe('CURSOR_EXPIRED');
  const snapshot=state.storage.sql.exec('SELECT message_retained_after_created_at,message_retained_after_id FROM workspace_metadata').one();
  withTransaction(state.storage,tx=>recordRetentionFloor(tx,'ws_example',{createdAt:0,id:'old'}));expect(state.storage.sql.exec('SELECT message_retained_after_created_at,message_retained_after_id FROM workspace_metadata').one()).toEqual(snapshot);
 });
});
it('reviewer_read_does_not_grant_native_inbox_or_ack_and_receipts_are_caller_only',async()=>{
 const {stub,name,identity}=await messageFixture('read-reviewer');await runInDurableObject(stub,async(_o,state)=>{
  const a=await send(state.storage,name,identity,'a');const reviewer=human(state.storage),ctx=await commandContext(state.storage,name,{message_ids:[a.id]},'human-ack');const before=messageSnapshot(state.storage);
  expect(()=>executeCommand(ctx,reviewer,ackCommand(),{message_ids:[a.id]})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));expect(messageSnapshot(state.storage)).toEqual(before);
  const review=await messageRoutes(await humanRequest(state.storage,'/threads/'+a.thread_id),workspace(state.storage,name));expect(review.status).toBe(200);expect((await review.json<any>()).data[0].acknowledged_at).toBeNull();
  expect((await messageRoutes(await humanRequest(state.storage,'/inbox'),workspace(state.storage,name))).status).toBe(403);
  const ack=await messageRoutes(request('/messages:ack','POST',{message_ids:[a.id]},'native'),workspace(state.storage,name));expect(ack.status).toBe(200);
  const native=await (await get(state.storage,name,'/threads/'+a.thread_id)).json<any>();expect(native.data[0].acknowledged_at).toBeTypeOf('string');
  const afterReview=await messageRoutes(await humanRequest(state.storage,'/threads/'+a.thread_id),workspace(state.storage,name));expect((await afterReview.json<any>()).data[0].acknowledged_at).toBeNull();
  state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"messages:read\",\"events:read\"]' WHERE principal_id='human_operator'");
  expect((await messageRoutes(await humanRequest(state.storage,'/threads/'+a.thread_id),workspace(state.storage,name))).status).toBe(404);
 });
});
it('ack_200_unique_ids_commits_atomically_and_failed_event_or_outcome_rolls_back',async()=>{
 const {stub,name,identity}=await messageFixture('ack-200');await runInDurableObject(stub,async(_o,state)=>{
  const a=await send(state.storage,name,identity,'a');const ids=[a.id];for(let i=1;i<200;i++){const id='ack_'+i;ids.push(id);state.storage.sql.exec('INSERT INTO messages SELECT ?,workspace_id,thread_id,sender_kind,sender_principal_id,sender_agent_id,body,refs_json,created_at FROM messages WHERE id=?',id,a.id);state.storage.sql.exec("INSERT INTO inbox VALUES (?,'agent_research','ws_example',1,NULL)",id);}
  for(const table of ['events','idempotency_outcomes']){const before=messageSnapshot(state.storage);state.storage.sql.exec('CREATE TRIGGER injected BEFORE INSERT ON '+table+" BEGIN SELECT RAISE(ABORT,'ack_fault'); END");const r=await messageRoutes(request('/messages:ack','POST',{message_ids:ids},table),workspace(state.storage,name));expect(r.status).toBe(500);expect(messageSnapshot(state.storage)).toEqual(before);state.storage.sql.exec('DROP TRIGGER injected');}
  const r=await messageRoutes(request('/messages:ack','POST',{message_ids:ids},'batch'),workspace(state.storage,name));expect(r.status).toBe(200);expect((await r.json<any>()).data.acknowledged_ids).toEqual(ids);const before=messageSnapshot(state.storage);
  const replay=await messageRoutes(request('/messages:ack','POST',{message_ids:ids},'batch'),workspace(state.storage,name));expect(replay.status).toBe(200);expect((await replay.json<any>()).data.acknowledged_ids).toEqual(ids);expect(messageSnapshot(state.storage)).toEqual(before);expect(state.storage.sql.exec("SELECT count(*) AS n FROM events WHERE type='message.acknowledged'").one()).toEqual({n:1});
 });
});
it('same_agent_other_credential_cannot_reuse_cursor_or_broaden_actual_read_grant',async()=>{
 const {stub,name,identity}=await messageFixture('read-credential');await runInDurableObject(stub,async(_o,state)=>{
  await send(state.storage,name,identity,'a');await send(state.storage,name,identity,'b');const first=await (await get(state.storage,name,'/inbox?limit=1')).json<any>(),digest=await sha256('E'.repeat(43));
  state.storage.sql.exec("INSERT INTO native_credentials (credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch) SELECT 'other_credential',workspace_id,agent_id,?,scopes_json,project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch FROM native_credentials",digest);
  const other=new Request(root+'/inbox?limit=1&cursor='+first.page.next_cursor,{headers:{authorization:'Bearer '+'E'.repeat(43)}});expect((await messageRoutes(other,workspace(state.storage,name))).status).toBe(400);
  state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[]' WHERE credential_id='credential_research_1'");expect((await get(state.storage,name,'/inbox?limit=1&cursor='+first.page.next_cursor)).status).toBe(403);
 });
});
it('original_native_proof_revalidated_after_both_cursor_crypto_awaits',async()=>{
 for(const phase of ['encrypt','decrypt'] as const){
  const {stub,name,identity}=await messageFixture('read-await-'+phase);await runInDurableObject(stub,async(_o,state)=>{
   const a=await send(state.storage,name,identity,'a');await send(state.storage,name,identity,'b',a.thread_id);let suffix='';
   if(phase==='decrypt'){const p=await (await get(state.storage,name,'/inbox?limit=1')).json<any>();suffix='&cursor='+p.page.next_cursor;}
   const original=crypto.subtle[phase].bind(crypto.subtle),spy=vi.spyOn(crypto.subtle,phase).mockImplementation(async (...args:Parameters<typeof original>)=>{const result=await original(args[0],args[1],args[2]);state.storage.sql.exec("UPDATE native_credentials SET token_sha256=? WHERE credential_id='credential_research_1'",'d'.repeat(64));return result;});
   try{const denied=await get(state.storage,name,'/inbox?limit=1'+suffix);expect(denied.status).toBe(401);expect(JSON.stringify(await denied.json())).not.toContain(a.id);}finally{spy.mockRestore();}
  });
 }
});
it('final_resource_projection_and_human_session_are_current_after_encode',async()=>{
 const {stub,name,identity}=await messageFixture('read-final');await runInDurableObject(stub,async(_o,state)=>{
  const a=await send(state.storage,name,identity,'a');await send(state.storage,name,identity,'b',a.thread_id);
  const original=crypto.subtle.encrypt.bind(crypto.subtle);let spy=vi.spyOn(crypto.subtle,'encrypt').mockImplementation(async (...args)=>{const result=await original(...args);state.storage.sql.exec("DELETE FROM thread_participants WHERE participant_kind='agent'");return result;});
  try{expect((await get(state.storage,name,'/threads/'+a.thread_id+'?limit=1')).status).toBe(404);}finally{spy.mockRestore();}
  const req=await humanRequest(state.storage,'/threads/'+a.thread_id+'?limit=1');
  spy=vi.spyOn(crypto.subtle,'encrypt').mockImplementation(async (...args)=>{const result=await original(...args);state.storage.sql.exec("UPDATE sessions SET revoked_at=1");return result;});
  try{expect((await messageRoutes(req,workspace(state.storage,name))).status).toBe(401);}finally{spy.mockRestore();}
 });
});
it('settings_events_apply_typed_resource_visibility_and_current_project_policy',async()=>{
 const {stub,name}=await messageFixture('read-settings-events');await runInDurableObject(stub,async(_o,state)=>{
  const who=human(state.storage),other=human(state.storage,true),body={expected_preferences_revision:0,preferences:preference};
  executeCommand(await commandContext(state.storage,name,body,'owner-preferences'),who,preferencesCommand('pref_'+ '1'.repeat(32)),body);
  executeCommand(await commandContext(state.storage,name,body,'other-preferences'),other,preferencesCommand('pref_'+ '2'.repeat(32)),body);
  const document=structuredClone(neutralProfile),profile={expected_profile_revision:1,profile:{...document,display_name:'Updated'}};
  executeCommand(await commandContext(state.storage,name,profile,'profile'),who,profileCommand(),profile);
  const view=async()=>{const r=await messageRoutes(await humanRequest(state.storage,'/events'),workspace(state.storage,name));expect(r.status).toBe(200);return (await r.json<any>()).data;};
  let data=await view();expect(data.map((e:any)=>e.type)).toEqual(['configuration.installed','preferences.updated','profile.updated']);expect(data.find((e:any)=>e.type==='preferences.updated')).toMatchObject({resource_id:'pref_'+ '1'.repeat(32),resource_version:1,thread_id:null,task_version:null,run_id:null,fence:null});
  state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"events:read\",\"workspace:read\"]' WHERE principal_id='human_operator'");data=await view();expect(data.map((e:any)=>e.type)).toEqual(['preferences.updated','profile.updated']);
  state.storage.sql.exec("UPDATE human_grants SET project_ids_json='[]' WHERE principal_id='human_operator'");expect(await view()).toEqual([]);
  state.storage.sql.exec("UPDATE human_grants SET project_ids_json='null',scopes_json='[\"events:read\",\"operations:read\"]' WHERE principal_id='human_operator'");expect((await view()).map((e:any)=>e.type)).toEqual(['configuration.installed']);
  const owner=human(state.storage);withTransaction(state.storage,tx=>{const actor=resolveActor(tx,owner,Date.now());const id=tx.one<{id:string}>("SELECT id FROM events WHERE type='profile.updated'")!.id;tx.exec("UPDATE events SET resource_type='message' WHERE id=?",[id]);expect(projectEvent(tx,actor,id,Date.now(),resourceEventVisibility)).toBeNull();});
 });
});

import worker from '../../src/index';
import {env} from 'cloudflare:workers';
import {fixture,operator} from '../helpers/environment';
it('two_workspace_worker_and_do_reads_ack_and_cursors_preserve_catalog_ownership',async()=>{
 const name='read-isolation-one',secondName='read-isolation-two',raw=await fixture(name),config=raw.config,bundle=raw.bundle;
 config.workspace_catalog.push({workspace_id:'ws_other',object_name:secondName});
 for(const key of ['human_grants','static_participants','static_credential_refs','workspace_policies'] as const){
  const list=config[key] as Array<{workspace_id:string}>;list.push(...list.filter(x=>x.workspace_id==='ws_example').map(x=>({...structuredClone(x),workspace_id:'ws_other'})));
 }
 config.authentication.redirect_uris.push({workspace_id:'ws_other',redirect_uri:'https://hub.example.invalid/v2/workspaces/ws_other/auth/callback'});
 bundle.credentials[0].token_sha256=await sha256('A'.repeat(43));bundle.credentials.push({...bundle.credentials[0],workspace_id:'ws_other'});bundle.config_digest=await sha256(canonicalJson(config));
 const first=env.WORKSPACE.getByName(name),second=env.WORKSPACE.getByName(secondName);
 await first.reconcileConfiguration(operator(),await prepareBootstrap(config,bundle,'ws_example'));await second.reconcileConfiguration({...operator(),workspaceId:'ws_other'},await prepareBootstrap(config,bundle,'ws_other'));
 let thread='',id='';await runInDurableObject(first,async(_o,state)=>{const identity={kind:'agent' as const,workspaceId:'ws_example',credentialId:'credential_research_1',tokenDigest:bundle.credentials[0].token_sha256};const a=await send(state.storage,name,identity,'a');thread=a.thread_id;id=a.id;await send(state.storage,name,identity,'b',thread);});
 const configured={...env,DEPLOYMENT_CONFIG:JSON.stringify(config)} as unknown as Parameters<typeof worker.fetch>[1];
 const initial=await worker.fetch(request('/inbox?limit=1'),configured);expect(initial.status).toBe(200);const page=await initial.json<any>();
 const foreign=(path:string,method='GET',body?:unknown)=>new Request(root.replace('ws_example','ws_other')+path,{method,headers:{authorization:'Bearer '+'A'.repeat(43),...(body?{'content-type':'application/json','idempotency-key':'foreign'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 expect((await worker.fetch(foreign('/inbox?limit=1&cursor='+page.page.next_cursor),configured)).status).toBe(400);
 expect((await worker.fetch(foreign('/threads/'+thread),configured)).status).toBe(404);
 expect((await worker.fetch(foreign('/messages:ack','POST',{message_ids:[id]}),configured)).status).toBe(404);
 for(const path of ['/inbox','/events','/threads/'+thread,'/messages:ack'])expect((await first.fetch(foreign(path,path==='/messages:ack'?'POST':'GET',path==='/messages:ack'?{message_ids:[id]}:undefined))).status).toBe(401);
 const missing=new Request(root.replace('ws_example','ws_missing')+'/inbox',{headers:{authorization:'Bearer '+'A'.repeat(43)}});expect((await worker.fetch(missing,configured)).status).toBe(401);
 console.info('TASK8_TWO_WORKSPACE_HTTP_DENIALS',JSON.stringify({cursor:400,thread:404,ack:404,wrongOwner:401,unknownCatalog:401}));
});
it('route_limits_duplicate_queries_event_start_and_current_message_project_scope_are_enforced',async()=>{
 const {stub,name,identity}=await messageFixture('read-query');await runInDurableObject(stub,async(_o,state)=>{
  const a=await send(state.storage,name,identity,'a');await send(state.storage,name,identity,'b',a.thread_id);
  for(const path of ['/threads/'+a.thread_id+'?limit=501','/threads/'+a.thread_id+'?limit=0','/events?limit=201','/events?limit=-1','/events?after_sequence=-1','/events?after_sequence=0.1','/inbox?limit=1&limit=2','/inbox?acknowledged=1','/inbox?agent_id=agent_other','/events?cursor='])expect((await get(state.storage,name,path)).status).toBe(400);
  const start=await get(state.storage,name,'/events?after_sequence=1&limit=1');expect(start.status).toBe(200);const p=await start.json<any>();expect(p.data[0].type).toBe('message.accepted');expect(p.page.has_more).toBe(true);
  expect((await get(state.storage,name,'/events?limit=1&after_sequence=1&cursor='+p.page.next_cursor)).status).toBe(400);
  const next=await get(state.storage,name,'/events?limit=1&cursor='+p.page.next_cursor);expect(next.status).toBe(200);expect((await next.json<any>()).data[0].type).toBe('message.accepted');
  state.storage.sql.exec("UPDATE native_credentials SET project_ids_json='[]'");
  expect((await get(state.storage,name,'/inbox')).status).toBe(403);expect((await get(state.storage,name,'/threads/'+a.thread_id)).status).toBe(403);
  expect((await (await get(state.storage,name,'/events')).json<any>()).data).toEqual([]);
 });
});

it('duplicate_proto_ack_ids_are_invalid_before_receipt_lookup_or_writes_and_single_opaque_id_is_valid',async()=>{
 const {stub,name,identity}=await messageFixture('ack-proto-unique');await runInDurableObject(stub,async(_o,state)=>{
  const original=await send(state.storage,name,identity,'seed'),id='__proto__';
  state.storage.sql.exec('INSERT INTO messages SELECT ?,workspace_id,thread_id,sender_kind,sender_principal_id,sender_agent_id,body,refs_json,created_at FROM messages WHERE id=?',id,original.id);
  state.storage.sql.exec("INSERT INTO inbox VALUES (?,'agent_research','ws_example',1,NULL)",id);
  const before=messageSnapshot(state.storage);
  const duplicate=await messageRoutes(request('/messages:ack','POST',{message_ids:[id,id]},'duplicate-unacknowledged'),workspace(state.storage,name));
  expect(duplicate.status).toBe(400);expect((await duplicate.json<any>()).error.code).toBe('INVALID_REQUEST');expect(messageSnapshot(state.storage)).toEqual(before);
  const single=await messageRoutes(request('/messages:ack','POST',{message_ids:[id]},'single-opaque'),workspace(state.storage,name));
  expect(single.status).toBe(200);expect((await single.json<any>()).data).toEqual({acknowledged_ids:[id],already_acknowledged_ids:[]});
  const firstTimestamp=state.storage.sql.exec<{acknowledged_at:number}>('SELECT acknowledged_at FROM inbox WHERE message_id=?',id).one().acknowledged_at;expect(firstTimestamp).toBeTypeOf('number');
  const afterSingle=messageSnapshot(state.storage);
  const duplicateAcknowledged=await messageRoutes(request('/messages:ack','POST',{message_ids:[id,id]},'duplicate-acknowledged'),workspace(state.storage,name));
  expect(duplicateAcknowledged.status).toBe(400);expect((await duplicateAcknowledged.json<any>()).error.code).toBe('INVALID_REQUEST');expect(messageSnapshot(state.storage)).toEqual(afterSingle);
  const repeatedSingle=await messageRoutes(request('/messages:ack','POST',{message_ids:[id]},'repeat-single-opaque'),workspace(state.storage,name));
  expect(repeatedSingle.status).toBe(200);expect((await repeatedSingle.json<any>()).data).toEqual({acknowledged_ids:[],already_acknowledged_ids:[id]});expect(state.storage.sql.exec('SELECT acknowledged_at FROM inbox WHERE message_id=?',id).one().acknowledged_at).toBe(firstTimestamp);
 });
});
