import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import vectors from '../fixtures/notification-wire.json';
import {signNotification} from '../../src/outbox/dispatcher';
import {NotificationReceiver} from '../helpers/notification-receiver';
const time=1792800000,binding={workspaceId:'ws_synthetic_reference',recipientAgentId:'agent_synthetic_receiver',key:vectors.key,nowSeconds:()=>time};
const body=(i=0)=>Buffer.from(vectors.vectors[i].bodyBase64,'base64');
function request(i=0,headers?:Headers,bytes=body(i)){const v=vectors.vectors[i];return new Request('https://receiver.example.invalid/cfhub',{method:'POST',headers:headers??{'content-type':'application/json','X-CF-Agent-Hub-Delivery-Id':v.encodedId,'X-CF-Agent-Hub-Timestamp':v.timestamp,'X-CF-Agent-Hub-Signature':v.signature},body:bytes});}
function signed(changes:Record<string,unknown>={},id=vectors.vectors[0].deliveryId){
 const payload={...JSON.parse(body().toString('utf8')),...changes,delivery_id:id},bytes=Buffer.from(JSON.stringify(payload)),encoded=Buffer.from(JSON.stringify(id)).toString('base64url'),timestamp=String(time);
 const signature='v1='+createHmac('sha256',vectors.key).update(['cf-agent-hub-notification-v1',encoded,timestamp,''].join('\n')).update(bytes).digest('base64url');
 return new Request('https://receiver.example.invalid/cfhub',{method:'POST',headers:{'content-type':'application/json','X-CF-Agent-Hub-Delivery-Id':encoded,'X-CF-Agent-Hub-Timestamp':timestamp,'X-CF-Agent-Hub-Signature':signature},body:bytes});
}
it('sender_matches_independent_exact_original_byte_golden_vectors_including_lone_surrogates',async()=>{
 for(const v of vectors.vectors){const headers=await signNotification(v.deliveryId,Buffer.from(v.bodyBase64,'base64').toString('utf8'),vectors.key,time*1000);expect(headers.get('X-CF-Agent-Hub-Delivery-Id')).toBe(v.encodedId);expect(headers.get('X-CF-Agent-Hub-Timestamp')).toBe(v.timestamp);expect(headers.get('X-CF-Agent-Hub-Signature')).toBe(v.signature);}
});
it('receiver_verifies_all_independent_golden_vectors_and_exact_opaque_ids',async()=>{
 const r=new NotificationReceiver(':memory:',binding);try{for(let i=0;i<vectors.vectors.length;i++){const response=await r.receive(request(i));expect(response.status).toBe(200);expect((await response.json() as {delivery_id:string}).delivery_id).toBe(vectors.vectors[i].deliveryId);}expect(r.evidence().effects).toHaveLength(3);}finally{r.close();}
});
it('receiver_freshness_is_inclusive_at_300_and_rejects_301',async()=>{
 for(const delta of [-301,-300,0,300,301]){const r=new NotificationReceiver(':memory:',{...binding,nowSeconds:()=>time+delta});try{expect((await r.receive(request())).status).toBe(Math.abs(delta)<=300?200:401);expect(r.evidence().effects).toHaveLength(Math.abs(delta)<=300?1:0);}finally{r.close();}}
});
it('receiver_rejects_missing_duplicate_noncanonical_and_unsupported_headers_before_ledger',async()=>{
 const v=vectors.vectors[0];
 const cases:[string,string|null][]=[['X-CF-Agent-Hub-Delivery-Id',null],['X-CF-Agent-Hub-Timestamp',null],['X-CF-Agent-Hub-Signature',null],['X-CF-Agent-Hub-Timestamp','01792800000'],['X-CF-Agent-Hub-Timestamp','+1792800000'],['X-CF-Agent-Hub-Timestamp','1792800000.0'],['X-CF-Agent-Hub-Timestamp','1e9'],['X-CF-Agent-Hub-Timestamp','9007199254740992'],['X-CF-Agent-Hub-Delivery-Id',v.encodedId+'='],['X-CF-Agent-Hub-Delivery-Id','_w'],['X-CF-Agent-Hub-Delivery-Id',Buffer.from('123').toString('base64url')],['X-CF-Agent-Hub-Delivery-Id',Buffer.from('"\\u0064elivery_ascii_001"').toString('base64url')],['X-CF-Agent-Hub-Signature','v2='+v.signature.slice(3)],['X-CF-Agent-Hub-Signature',v.signature+'=']];
 const r=new NotificationReceiver(':memory:',binding);try{
  for(const [name,value]of cases){const h=new Headers(request().headers);value===null?h.delete(name):h.set(name,value);expect((await r.receive(request(0,h))).status).toBe(401);}
  for(const name of ['X-CF-Agent-Hub-Delivery-Id','X-CF-Agent-Hub-Timestamp','X-CF-Agent-Hub-Signature']){const h=new Headers(request().headers);h.append(name,h.get(name)!);expect((await r.receive(request(0,h))).status).toBe(401);}
  expect(r.evidence()).toEqual({deliveries:[],effects:[]});
 }finally{r.close();}
});
it('receiver_rejects_tampered_body_id_schema_and_verified_wrong_binding_before_ledger',async()=>{
 const r=new NotificationReceiver(':memory:',binding);try{
  expect((await r.receive(request(0,undefined,Buffer.concat([body(),Buffer.from(' ')])))).status).toBe(401);
  expect((await r.receive(signed({extra:true}))).status).toBe(400);
  expect((await r.receive(signed({payload_version:2}))).status).toBe(400);
  expect((await r.receive(signed({workspace_id:'other'}))).status).toBe(403);
  expect((await r.receive(signed({recipient_agent_id:'other'}))).status).toBe(403);
  const h=new Headers(request().headers);h.set('X-CF-Agent-Hub-Delivery-Id',vectors.vectors[1].encodedId);expect((await r.receive(request(0,h))).status).toBe(401);
  expect(r.evidence()).toEqual({deliveries:[],effects:[]});
 }finally{r.close();}
});
it('receiver_atomic_claim_excludes_concurrent_duplicates_and_completed_effect_survives_reopen',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cfhub-receiver-')),path=join(dir,'ledger.sqlite');let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(r=>release=r),start=new Promise<void>(r=>entered=r),first=new NotificationReceiver(path,binding,async()=>{entered();await gate;}),second=new NotificationReceiver(path,binding);
 try{
  const pending=first.receive(request());await start;expect((await second.receive(request())).status).toBe(503);expect(second.evidence().effects).toHaveLength(0);release();expect((await pending).status).toBe(200);first.close();second.close();
  const reopened=new NotificationReceiver(path,{...binding,nowSeconds:()=>time+60});try{
   const freshHeaders=await signNotification(vectors.vectors[0].deliveryId,body().toString('utf8'),vectors.key,(time+60)*1000);
   expect((await reopened.receive(request(0,freshHeaders))).status).toBe(200);expect(reopened.evidence().effects).toHaveLength(1);console.info('RECEIVER_COMPLETED_REOPEN',JSON.stringify(reopened.evidence()));
  }finally{reopened.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('receiver_claim_only_crash_is_uncertain_after_reopen_and_does_not_reexecute',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cfhub-uncertain-')),path=join(dir,'ledger.sqlite'),r=new NotificationReceiver(path,binding,async()=>{throw Error('simulated crash after durable claim');});
 try{await expect(r.receive(request())).rejects.toThrow('simulated crash');r.close();const reopened=new NotificationReceiver(path,binding);try{expect((await reopened.receive(request())).status).toBe(503);expect(reopened.evidence().effects).toHaveLength(0);expect(reopened.evidence().deliveries[0].status).toBe('claimed');console.info('RECEIVER_UNCERTAIN_REOPEN',JSON.stringify(reopened.evidence()));}finally{reopened.close();}}finally{rmSync(dir,{recursive:true,force:true});}
});
it('same_id_in_another_independently_verified_binding_does_not_suppress_delivery',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cfhub-bindings-')),path=join(dir,'ledger.sqlite'),r=new NotificationReceiver(path,binding),other=new NotificationReceiver(path,{...binding,workspaceId:'other'});
 try{expect((await r.receive(request())).status).toBe(200);expect((await other.receive(signed({workspace_id:'other'}))).status).toBe(200);expect(other.evidence().effects).toHaveLength(2);}finally{r.close();other.close();rmSync(dir,{recursive:true,force:true});}
});
it('key_length_is_utf8_bytes_and_key_binding_is_never_base64_decoded',async()=>{
 await expect(signNotification('id','{}','x'.repeat(31),time*1000)).rejects.toThrow();const k='é'.repeat(16);expect((await signNotification('id','{}',k,time*1000)).get('X-CF-Agent-Hub-Signature')).toBe('v1='+createHmac('sha256',Buffer.from(k)).update('cf-agent-hub-notification-v1\nImlkIg\n1792800000\n{}').digest('base64url'));
});

it('authenticated_header_body_id_mismatch_and_non_json_body_are_rejected_before_claim',async()=>{
 const receiver=new NotificationReceiver(':memory:',binding);
 const build=(bytes:Buffer,encoded=vectors.vectors[1].encodedId)=>{
  const timestamp=String(time),signature='v1='+createHmac('sha256',vectors.key).update(['cf-agent-hub-notification-v1',encoded,timestamp,''].join('\n')).update(bytes).digest('base64url');
  return new Request('https://receiver.example.invalid/cfhub',{method:'POST',headers:{'content-type':'application/json','X-CF-Agent-Hub-Delivery-Id':encoded,'X-CF-Agent-Hub-Timestamp':timestamp,'X-CF-Agent-Hub-Signature':signature},body:new Uint8Array(bytes)});
 };
 try{expect((await receiver.receive(build(body()))).status).toBe(400);expect((await receiver.receive(build(Buffer.from('{invalid')))).status).toBe(400);expect(receiver.evidence()).toEqual({deliveries:[],effects:[]});}finally{receiver.close();}
});
it('long_opaque_delivery_ids_have_no_added_slug_or_length_rule',async()=>{
 const id='opaque\"\\\u0000é'.repeat(20000),req=signed({},id),bytes=await req.clone().text(),headers=await signNotification(id,bytes,vectors.key,time*1000);
 const receiver=new NotificationReceiver(':memory:',binding);try{expect((await receiver.receive(new Request(req,{headers}))).status).toBe(200);expect(receiver.evidence().effects).toHaveLength(1);}finally{receiver.close();}
});
