import {it,expect,vi} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {messageFixture,messageInput,owned,commandContext} from '../helpers/messages';
import {human} from '../helpers/settings';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
import {withTransaction} from '../../src/storage/transaction';
import {claimDue,finishAttempt,retryDelayMs} from '../../src/outbox/repository';
import {DeliveryDispatcher,signNotification} from '../../src/outbox/dispatcher';
import {egressAllowed,classifyResponse} from '../../src/outbox/egress';
import {canonicalJson} from '../../src/config/bootstrap';
const key='SYNTHETIC-ONLY-notification-signing-key-0123456789';
const current=(s:DurableObjectStorage)=>s.sql.exec<any>('SELECT * FROM outbox').one();
async function prepared(name:string,humanSender=false){
 const f=await messageFixture(name);
 await runInDurableObject(f.stub,async(_o,state)=>{const body=messageInput(),identity=humanSender?human(state.storage):f.identity;executeCommand(await commandContext(state.storage,name,body,'send'),identity,messageCommand(owned(state.storage,name)),body);});
 return f;
}
function changePolicy(storage:DurableObjectStorage,fn:(c:any)=>void){withTransaction(storage,tx=>{const c=JSON.parse(tx.one<{config_json:string}>('SELECT config_json FROM workspace_metadata')!.config_json);fn(c);tx.exec('UPDATE workspace_metadata SET config_json=?',[canonicalJson(c)]);});}
it('retry_after_cap_does_not_shorten_nominal',()=>{
 expect(retryDelayMs(4,.8,600,30)).toBe(480000);expect(retryDelayMs(4,1,3600,0)).toBe(600000);expect(retryDelayMs(1,.8,3600,30)).toBe(30000);expect(retryDelayMs(1,1,undefined,3600)).toBe(5000);
});
it('classifies_transport_without_persisting_response_body',()=>{
 for(const status of [200,204,299])expect(classifyResponse(new Response(null,{status}),0)).toMatchObject({kind:'delivered',status});
 for(const status of [408,429,500,503,599])expect(classifyResponse(new Response('sensitive remote body',{status,headers:{'retry-after':'60'}}),0)).toEqual({kind:'transient',status,category:'http_transient',retryAfterSeconds:60});
 for(const status of [300,301,307,308,400,401,403,404,422])expect(classifyResponse(new Response(null,{status}),0).kind).toBe('permanent');
 expect(classifyResponse(new Response(null,{status:429,headers:{'retry-after':'invalid'}}),0)).not.toHaveProperty('retryAfterSeconds');
 expect(classifyResponse(new Response(null,{status:503,headers:{'retry-after':'Thu, 01 Jan 1970 00:01:00 GMT'}}),0)).toHaveProperty('retryAfterSeconds',60);
});
it('redirect_and_private_destination_denied',()=>{
 for(const url of ['http://receiver.example.invalid/','https://127.0.0.1/','https://[::1]/','https://metadata.google.internal/','https://localhost/','https://foo.local/','https://receiver.example.invalid:444/','https://user@receiver.example.invalid/','https://receiver.example.invalid/?x=1','https://receiver.example.invalid/#x'])expect(egressAllowed(url,[url])).toBe(false);
 expect(egressAllowed('https://receiver.example.invalid/cfhub',['https://receiver.example.invalid/cfhub'])).toBe(true);expect(egressAllowed('https://other.example.invalid/cfhub',['https://receiver.example.invalid/cfhub'])).toBe(false);
});
it('revoked_destination_or_grant_prevents_dispatch',async()=>{
 const mutations=[(s:DurableObjectStorage)=>changePolicy(s,c=>c.workspace_policies[0].notification_destinations[0].enabled=false),(s:DurableObjectStorage)=>s.sql.exec('UPDATE native_credentials SET enabled=0'),(s:DurableObjectStorage)=>s.sql.exec('UPDATE native_credentials SET expires_at=0'),(s:DurableObjectStorage)=>s.sql.exec("DELETE FROM thread_participants"),(s:DurableObjectStorage)=>s.sql.exec('UPDATE static_agents SET config_epoch=0')];
 for(let i=0;i<mutations.length;i++){const f=await prepared('egress-revoke-'+i);await runInDurableObject(f.stub,async(_o,state)=>{const now=current(state.storage).next_due_at,attempt=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];mutations[i](state.storage);let sent=false;const workspace={...owned(state.storage,f.name),clock:{nowMs:()=>now},secrets:{NOTIFICATION_SIGNING_KEY:key}};const result=await new DeliveryDispatcher(workspace,{fetch:async()=>{sent=true;return new Response();}}).dispatchAttempt(attempt);expect(sent).toBe(false);expect(result.kind).toBe('permanent');});}
});
it('destination_rebinding_terminates_old_intent_but_same_reference_key_rotation_is_allowed',async()=>{
 for(const field of ['url','agent_id','signing_key_ref']){
  const f=await prepared('egress-rebind-'+field);await runInDurableObject(f.stub,async(_o,state)=>{const now=current(state.storage).next_due_at,a=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];changePolicy(state.storage,c=>{const d=c.workspace_policies[0].notification_destinations[0];d[field]=field==='url'?'https://receiver.example.invalid/new':field==='agent_id'?'agent_other':'OTHER_KEY';if(field==='agent_id')c.static_participants.push({...c.static_participants[0],agent_id:'agent_other'});});const workspace={...owned(state.storage,f.name),clock:{nowMs:()=>now},secrets:{NOTIFICATION_SIGNING_KEY:key}};const result=await new DeliveryDispatcher(workspace,{fetch:async()=>{throw Error('must not send');}}).dispatchAttempt(a);expect(result).toMatchObject({kind:'permanent',category:'destination_changed'});withTransaction(state.storage,tx=>finishAttempt(tx,a.attemptId,result,now));expect(current(state.storage).status).toBe('cancelled');});
 }
 const f=await prepared('egress-key-rotation');await runInDurableObject(f.stub,async(_o,state)=>{const now=current(state.storage).next_due_at,a=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];let sent=false;const workspace={...owned(state.storage,f.name),clock:{nowMs:()=>now},secrets:{NOTIFICATION_SIGNING_KEY:key+'rotated'}};expect((await new DeliveryDispatcher(workspace,{fetch:async()=>{sent=true;return new Response(null,{status:204});}}).dispatchAttempt(a)).kind).toBe('delivered');expect(sent).toBe(true);});
});
it('final_check_after_signing_blocks_changed_authority_lease_maintenance_and_destination',async()=>{
 const changes=[(s:DurableObjectStorage)=>s.sql.exec('UPDATE native_credentials SET enabled=0'),(s:DurableObjectStorage)=>s.sql.exec("UPDATE outbox SET lease_token='new-token'"),(s:DurableObjectStorage)=>s.sql.exec("INSERT INTO maintenance_state VALUES (1,'capture',NULL,1,NULL,0)"),(s:DurableObjectStorage)=>changePolicy(s,c=>c.workspace_policies[0].notification_destinations[0].url='https://receiver.example.invalid/new'),(s:DurableObjectStorage)=>s.sql.exec("UPDATE workspace_metadata SET object_name='different'")];
 for(let i=0;i<changes.length;i++){const f=await prepared('egress-final-'+i);await runInDurableObject(f.stub,async(_o,state)=>{const now=current(state.storage).next_due_at,a=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];let sent=false;const workspace={...owned(state.storage,f.name),clock:{nowMs:()=>now},secrets:{NOTIFICATION_SIGNING_KEY:key}};const result=await new DeliveryDispatcher(workspace,{sign:async(...args)=>{const headers=await signNotification(...args);changes[i](state.storage);return headers;},fetch:async()=>{sent=true;return new Response();}}).dispatchAttempt(a);expect(sent).toBe(false);expect(result.kind).not.toBe('delivered');});}
});
it('human_background_eligibility_uses_current_installed_grant_without_expired_session',async()=>{
 const f=await prepared('egress-human',true);await runInDurableObject(f.stub,async(_o,state)=>{state.storage.sql.exec('UPDATE sessions SET expires_at=created_at+1');const now=current(state.storage).next_due_at,a=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];const workspace={...owned(state.storage,f.name),clock:{nowMs:()=>now},secrets:{NOTIFICATION_SIGNING_KEY:key}};expect((await new DeliveryDispatcher(workspace,{fetch:async()=>new Response(null,{status:204})}).dispatchAttempt(a)).kind).toBe('delivered');});
});
it('current_reference_visibility_cannot_union_credentials_or_bypass_typed_membership',async()=>{
 const f=await prepared('egress-reference');await runInDurableObject(f.stub,async(_o,state)=>{const original=current(state.storage),now=original.next_due_at;state.storage.sql.exec("UPDATE messages SET refs_json=? WHERE id=?",JSON.stringify([{kind:'message',id:original.message_id}]),original.message_id);const a=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"messages:read\"]',project_ids_json='[\"project_a\"]'");state.storage.sql.exec("INSERT INTO native_credentials SELECT 'other',workspace_id,agent_id,?, '[\"messages:send\"]','null',expires_at,enabled,config_epoch,retired_at_epoch FROM native_credentials LIMIT 1",'b'.repeat(64));const workspace={...owned(state.storage,f.name),clock:{nowMs:()=>now},secrets:{NOTIFICATION_SIGNING_KEY:key}};expect((await new DeliveryDispatcher(workspace,{fetch:async()=>{throw Error('must not send');}}).dispatchAttempt(a)).kind).toBe('permanent');});
});
it('original_bytes_fresh_timestamp_no_bearer_manual_redirect_and_10_second_abort',async()=>{
 const f=await prepared('egress-wire');await runInDurableObject(f.stub,async(_o,state)=>{let now=current(state.storage).next_due_at;const original=current(state.storage).payload_json;const workspace={...owned(state.storage,f.name),clock:{nowMs:()=>now},secrets:{NOTIFICATION_SIGNING_KEY:key}};const requests:Request[]=[];const d=new DeliveryDispatcher(workspace,{fetch:async(input,init)=>{requests.push(new Request(input,init));return new Response('untrusted text',{status:503});}});const a=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];const result=await d.dispatchAttempt(a);withTransaction(state.storage,tx=>finishAttempt(tx,a.attemptId,result,now));now=current(state.storage).next_due_at;const b=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];await d.dispatchAttempt(b);expect(await requests[0].text()).toBe(original);expect(await requests[1].text()).toBe(original);expect(requests[0].headers.get('authorization')).toBeNull();expect(requests[0].redirect).toBe('manual');expect(requests[0].headers.get('X-CF-Agent-Hub-Delivery-Id')).toBe(requests[1].headers.get('X-CF-Agent-Hub-Delivery-Id'));expect(requests[0].headers.get('X-CF-Agent-Hub-Timestamp')).not.toBe(requests[1].headers.get('X-CF-Agent-Hub-Timestamp'));expect(requests[0].headers.get('X-CF-Agent-Hub-Signature')).not.toBe(requests[1].headers.get('X-CF-Agent-Hub-Signature'));expect(current(state.storage).last_error).toBe('http_transient');});
});
it('short_utf8_key_binding_and_expired_lease_never_fetch',async()=>{
 const f=await prepared('egress-short-key');await runInDurableObject(f.stub,async(_o,state)=>{let now=current(state.storage).next_due_at;const a=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];let sent=false;const workspace={...owned(state.storage,f.name),clock:{nowMs:()=>now},secrets:{NOTIFICATION_SIGNING_KEY:'x'.repeat(31)}};const d=new DeliveryDispatcher(workspace,{fetch:async()=>{sent=true;return new Response();}});expect((await d.dispatchAttempt(a)).kind).toBe('permanent');workspace.secrets.NOTIFICATION_SIGNING_KEY=key;now+=30000;expect((await d.dispatchAttempt(a)).kind).toBe('obsolete');expect(sent).toBe(false);});
});

it('fetch_abort_is_exactly_10_seconds_and_network_failures_are_transient',async()=>{
 const f=await prepared('egress-timeout');await runInDurableObject(f.stub,async(_o,state)=>{
  const now=current(state.storage).next_due_at,a=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0],workspace={...owned(state.storage,f.name),clock:{nowMs:()=>now},secrets:{NOTIFICATION_SIGNING_KEY:key}};
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  try{
   let entered!:()=>void;const start=new Promise<void>(r=>entered=r);let aborted=false;
   const d=new DeliveryDispatcher(workspace,{fetch:async(_input,init)=>{entered();return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));}));}});
   const pending=d.dispatchAttempt(a);await start;await vi.advanceTimersByTimeAsync(9999);expect(aborted).toBe(false);await vi.advanceTimersByTimeAsync(1);expect(await pending).toEqual({kind:'transient',category:'timeout'});expect(aborted).toBe(true);
  }finally{vi.useRealTimers();}
  expect(await new DeliveryDispatcher(workspace,{fetch:async()=>{throw Error('sensitive network error');}}).dispatchAttempt(a)).toEqual({kind:'transient',category:'network'});
 });
});

it('stored_original_lexical_bytes_are_signed_and_sent_without_reserialization',async()=>{
 const f=await prepared('egress-original-lexical');await runInDurableObject(f.stub,async(_o,state)=>{
  const accepted=JSON.parse(current(state.storage).payload_json),original=JSON.stringify(accepted,null,2)+'\n';
  state.storage.sql.exec('UPDATE outbox SET payload_json=?',original);const now=current(state.storage).next_due_at,a=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0],workspace={...owned(state.storage,f.name),clock:{nowMs:()=>now},secrets:{NOTIFICATION_SIGNING_KEY:key}};
  state.storage.sql.exec("UPDATE messages SET body='mutable message text changed after admission'");let actualBody='',actualSignature='';
  const result=await new DeliveryDispatcher(workspace,{fetch:async(input,init)=>{const request=new Request(input,init);actualBody=await request.text();actualSignature=request.headers.get('X-CF-Agent-Hub-Signature')!;return new Response(null,{status:204});}}).dispatchAttempt(a);
  expect(result.kind).toBe('delivered');expect(actualBody).toBe(original);
  const expected=await signNotification(a.deliveryId,original,key,now),reserialized=await signNotification(a.deliveryId,JSON.stringify(accepted),key,now);
  expect(actualSignature).toBe(expected.get('X-CF-Agent-Hub-Signature'));expect(actualSignature).not.toBe(reserialized.get('X-CF-Agent-Hub-Signature'));
 });
});
it('revoked_current_human_grant_blocks_background_dispatch',async()=>{
 const f=await prepared('egress-human-revoked',true);await runInDurableObject(f.stub,async(_o,state)=>{
  const now=current(state.storage).next_due_at,a=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];state.storage.sql.exec('UPDATE human_grants SET enabled=0');
  const workspace={...owned(state.storage,f.name),clock:{nowMs:()=>now},secrets:{NOTIFICATION_SIGNING_KEY:key}};
  expect(await new DeliveryDispatcher(workspace,{fetch:async()=>{throw Error('must not send');}}).dispatchAttempt(a)).toEqual({kind:'permanent',category:'authority_revoked'});
 });
});
