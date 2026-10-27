import {withTransaction} from '../../src/storage/transaction';
import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {login,request as authRequest,origin} from '../helpers/auth';
import {canonicalJson,sha256,prepareBootstrap,restoreAuthorityOverlay,installConfiguration} from '../../src/config/bootstrap';
import type {CredentialIssue,RuntimeIssue} from '../../src/http/dto';
const base=origin+'/v2/workspaces/ws_example/';
async function install(name:string,delegation:string[]|undefined,epoch=1,priorDigest:string|null=null){
 const raw=await fixture(name,epoch);
 raw.config.human_grants[0].scopes=['workspace:read','agents:read','agents:manage','credentials:manage','messages:read'];
 if(delegation!==undefined)Object.assign(raw.config.human_grants[0],{delegable_native_scopes:delegation});
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 const prepared=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);
 const receipt=await stub.reconcileConfiguration(operator(epoch-1,priorDigest),prepared);
 return {stub,receipt,prepared};
}
async function humanClient(stub:Awaited<ReturnType<typeof install>>['stub']){
 const session=await login(stub);expect(session.response.status).toBe(302);await session.response.text();
 const response=await stub.fetch(authRequest('session','GET',undefined,session.cookie));expect(response.status).toBe(200);
 const data=await response.json() as {data:{csrf_token:string}};
 const req=(path:string,body?:unknown,key='human',method='POST')=>new Request(base+path,{method,headers:{origin,cookie:session.cookie,'content-type':'application/json','idempotency-key':key,'x-csrf-token':data.data.csrf_token},body:body===undefined?undefined:JSON.stringify(body)});
 return {req};
}
function nativeRequest(token:string,path:string,body:unknown,key:string,proof?:string){return new Request(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','idempotency-key':key,...(proof?{'x-runtime-token':proof}:{})},body:JSON.stringify(body)});}
async function createAgent(stub:Awaited<ReturnType<typeof install>>['stub'],req:Awaited<ReturnType<typeof humanClient>>['req']){
 const response=await stub.fetch(req('agents',{display_name:'Delegation agent',description:'',work_role_ids:[]},'agent'));expect(response.status).toBe(201);
 return (await response.json() as {data:{id:string}}).data.id;
}
const credentialBody=(agentId:string,scopes:string[]= ['runtimes:manage'])=>({agent_id:agentId,label:'Synthetic delegated credential',scopes,project_ids:null,expires_at:new Date(Date.now()+3600000).toISOString()});
it('canonical operator delegation supports real login credential list enrollment without human native authority',async()=>{
 const {stub}=await install('delegation-canonical',['runtimes:manage']),{req}=await humanClient(stub),agentId=await createAgent(stub,req),body=credentialBody(agentId);
 const response=await stub.fetch(req('credentials',body,'issue'));expect(response.status).toBe(201);
 const credential=(await response.json() as {data:CredentialIssue}).data;expect(credential.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
 const listed=await stub.fetch(req('credentials',undefined,'list','GET'));expect(listed.status).toBe(200);expect(JSON.stringify(await listed.json())).toContain(credential.credential.id);
 const replay=await stub.fetch(req('credentials',body,'issue'));expect(replay.status).toBe(201);expect(await replay.json()).toMatchObject({data:{token:null,revealed:false,credential:{id:credential.credential.id}}});
 const enrollment=await stub.fetch(nativeRequest(credential.token!,'runtimes',{label:'Native runtime'},'enroll'));expect(enrollment.status).toBe(201);
 const runtime=(await enrollment.json() as {data:RuntimeIssue}).data;
 const heartbeat=await stub.fetch(nativeRequest(credential.token!,'runtimes/'+runtime.runtime.id+':heartbeat',{expected_runtime_version:1},'heartbeat',runtime.runtime_token!));expect(heartbeat.status).toBe(200);await heartbeat.text();
 const humanEnroll=await stub.fetch(req('runtimes',{label:'Must deny'},'human-enroll'));expect(humanEnroll.status).toBe(403);await humanEnroll.text();
 const humanHeartbeat=req('runtimes/'+runtime.runtime.id+':heartbeat',{expected_runtime_version:2},'human-heartbeat');humanHeartbeat.headers.set('x-runtime-token',runtime.runtime_token!);
 expect((await stub.fetch(humanHeartbeat)).status).toBe(403);
 await runInDurableObject(stub,(_o,state)=>{const row=state.storage.sql.exec<{scopes_json:string}>('SELECT scopes_json FROM human_grants').one();expect(JSON.parse(row.scopes_json)).not.toContain('runtimes:manage');});
 const revoked=await stub.fetch(req('credentials/'+credential.credential.id+':revoke',{expected_credential_version:1,reason:'Synthetic cleanup'},'revoke'));expect(revoked.status).toBe(200);await revoked.text();
 expect((await stub.fetch(nativeRequest(credential.token!,'runtimes/'+runtime.runtime.id+':heartbeat',{expected_runtime_version:2},'revoked-heartbeat',runtime.runtime_token!))).status).toBe(401);
});
it.each([{delegation:[] as string[]},{delegation:undefined}])('explicit empty differs from omitted legacy delegation: $delegation',async({delegation})=>{
 const {stub}=await install(delegation===undefined?'delegation-omitted':'delegation-empty',delegation),{req}=await humanClient(stub),agentId=await createAgent(stub,req);
 const nativeOnly=await stub.fetch(req('credentials',credentialBody(agentId),'native-only'));expect(nativeOnly.status).toBe(403);await nativeOnly.text();
 const shared=await stub.fetch(req('credentials',credentialBody(agentId,['messages:read']),'shared'));
 expect(shared.status).toBe(delegation===undefined?201:403);await shared.text();
});
it('higher epoch narrows delegation revokes old runtime and later explicit grant permits fresh login issuance',async()=>{
 const name='delegation-epochs',first=await install(name,['runtimes:manage']);let client=await humanClient(first.stub);
 const agentId=await createAgent(first.stub,client.req),body=credentialBody(agentId);
 const issue=await first.stub.fetch(client.req('credentials',body,'old-issue'));expect(issue.status).toBe(201);const credential=(await issue.json() as {data:CredentialIssue}).data;
 const enrolled=await first.stub.fetch(nativeRequest(credential.token!,'runtimes',{label:'Old'},'old-enroll'));expect(enrolled.status).toBe(201);const old=(await enrolled.json() as {data:RuntimeIssue}).data;
 const second=await install(name,[],2,first.receipt.installationDigest);
 const denied=await second.stub.fetch(nativeRequest(credential.token!,'runtimes/'+old.runtime.id+':heartbeat',{expected_runtime_version:1},'old-heartbeat',old.runtime_token!));expect(denied.status).toBe(401);await denied.text();
 client=await humanClient(second.stub);const narrowed=await second.stub.fetch(client.req('credentials',body,'narrowed'));expect(narrowed.status).toBe(403);await narrowed.text();
 const third=await install(name,['runtimes:manage'],3,second.receipt.installationDigest);client=await humanClient(third.stub);
 const fresh=await third.stub.fetch(client.req('credentials',body,'fresh'));expect(fresh.status).toBe(201);const current=(await fresh.json() as {data:CredentialIssue}).data;
 const freshEnroll=await third.stub.fetch(nativeRequest(current.token!,'runtimes',{label:'Fresh'},'fresh-enroll'));expect(freshEnroll.status).toBe(201);const runtime=(await freshEnroll.json() as {data:RuntimeIssue}).data;
 expect(runtime.runtime.id).not.toBe(old.runtime.id);expect(current.credential.id).not.toBe(credential.credential.id);
 await runInDurableObject(third.stub,(_o,state)=>{expect(state.storage.sql.exec('SELECT status,revoked_at FROM runtimes WHERE id=?',old.runtime.id).one()).toMatchObject({status:'expired',revoked_at:expect.any(Number)});expect(state.storage.sql.exec('SELECT authority_epoch FROM runtimes WHERE id=?',runtime.runtime.id).one()).toEqual({authority_epoch:3});});
});

it('delegation changes remain digest and epoch bound and restore overlay revokes existing proof',async()=>{
 const first=await install('delegation-config-overlay',['runtimes:manage']),{req}=await humanClient(first.stub),agentId=await createAgent(first.stub,req);
 const issue=await first.stub.fetch(req('credentials',credentialBody(agentId),'issue'));expect(issue.status).toBe(201);const credential=(await issue.json() as {data:CredentialIssue}).data;
 const enrollment=await first.stub.fetch(nativeRequest(credential.token!,'runtimes',{label:'Overlay'},'enroll'));expect(enrollment.status).toBe(201);const runtime=(await enrollment.json() as {data:RuntimeIssue}).data;
 for(const remove of [false,true]){
  const config=structuredClone(first.prepared.config),bundle=structuredClone(first.prepared.bundle);
  if(remove)delete config.human_grants[0].delegable_native_scopes;else config.human_grants[0].delegable_native_scopes=[];
  bundle.config_digest=await sha256(canonicalJson(config));expect(bundle.config_digest).not.toBe(first.prepared.bundle.config_digest);
  const changed=await prepareBootstrap(config,bundle,'ws_example');
  // Test the actual transaction primitive inside Workers; RPC rejection also emits an unhandled harness error.
  await runInDurableObject(first.stub,(_o,state)=>{expect(()=>withTransaction(state.storage,tx=>installConfiguration(tx,changed.config,changed,Date.now()))).toThrow('EPOCH_CONFLICT');});
 }
 await runInDurableObject(first.stub,(_o,state)=>{
  const before=state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one().config_json;
  withTransaction(state.storage,tx=>{
   tx.exec("UPDATE workspace_metadata SET admission_state='maintenance'");
   restoreAuthorityOverlay(tx,first.prepared,Date.now());
   tx.exec("UPDATE workspace_metadata SET admission_state='installed'");
  });
  expect(state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one().config_json).toBe(before);
  expect(state.storage.sql.exec('SELECT revoked_at,status FROM runtimes WHERE id=?',runtime.runtime.id).one()).toMatchObject({revoked_at:expect.any(Number),status:'expired'});
 });
 expect((await first.stub.fetch(nativeRequest(credential.token!,'runtimes/'+runtime.runtime.id+':heartbeat',{expected_runtime_version:1},'old-proof',runtime.runtime_token!))).status).toBe(401);
 // This tests the existing synchronous authority overlay primitive, not schema8 recovery transport.
});
