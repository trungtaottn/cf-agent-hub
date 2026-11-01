import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {decisionFixture} from '../helpers/decision-policy';
import {human,owned} from '../helpers/settings';
import {sha256} from '../../src/config/bootstrap';
import {decisionPath,decisionRoutes} from '../../src/http/decision-routes';
import {parseDecisionQuery} from '../../src/http/decision-read-routes';
const origin='https://hub.example.invalid',base=origin+'/v2/workspaces/ws_example/';
it('decision route shell admits exact generic request read and human decision paths',()=>{
 for(const path of ['tasks/task_a:request-decision','approvals','approvals/approval_a','approvals/a:approve','approvals/a:reject'])expect(decisionPath.test(new URL(base+path).pathname)).toBe(true);
 for(const path of ['approvals/a:unknown','tasks/a:claim','approvals/a/content','approvals/'])expect(decisionPath.test(new URL(base+path).pathname)).toBe(false);
});
it('decision read query is closed, singleton and bounded',()=>{
 expect(parseDecisionQuery(new URLSearchParams(),'approvals')).toEqual({limit:50,token:null});
 for(const query of ['limit=0','limit=201','limit=1&limit=2','cursor=','task_id=x','state=pending'])expect(()=>parseDecisionQuery(new URLSearchParams(query),'approvals')).toThrow();
 expect(()=>parseDecisionQuery(new URLSearchParams('limit=1'),'approval')).toThrow();
});
it('decision HTTP actual human reads and same-origin preflight remain closed',async()=>{
 const f=await decisionFixture('decision_http_shell');await runInDurableObject(f.stub,async(_o,s)=>{
  human(s.storage);const token='A'.repeat(43);s.storage.sql.exec('UPDATE sessions SET token_digest=?',await sha256(token));
  const workspace={...owned(s.storage,f.name),secrets:{CURSOR_ENCRYPTION_KEY:'f'.repeat(64)}};
  const req=(path:string,method='GET',extra:Record<string,string>={})=>new Request(base+path,{method,headers:{cookie:'cfhub_session='+token,origin,...extra}});
  const list=await decisionRoutes(req('approvals'),workspace);expect(list.status).toBe(200);expect(await list.json()).toMatchObject({data:[],page:{next_cursor:null,has_more:false}});
  expect((await decisionRoutes(req('approvals/missing'),workspace)).status).toBe(404);
  expect((await decisionRoutes(req('approvals','POST'),workspace)).status).toBe(404);
  expect((await decisionRoutes(req('approvals?limit=0'),workspace)).status).toBe(400);
  expect((await decisionRoutes(req('approvals','OPTIONS',{'access-control-request-method':'GET'}),workspace)).status).toBe(204);
  expect((await decisionRoutes(req('approvals','OPTIONS',{'access-control-request-method':'POST'}),workspace)).status).toBe(403);
  expect((await decisionRoutes(req('approvals','GET',{origin:'https://foreign.example.invalid'}),workspace)).status).toBe(403);
  expect((await decisionRoutes(new Request(base.replace('ws_example','foreign')+'approvals'),workspace)).status).toBe(404);
 });
});
import {claimSetup,proposal} from '../helpers/decision-policy';
import {claimContext,PROOF_A} from '../helpers/claims';
import {claimTaskCommand} from '../../src/tasks/claim';
import {executeCommand} from '../../src/workspace/commands';
import {vi} from 'vitest';
function snapshot(storage:DurableObjectStorage){return Object.fromEntries(['tasks','runs','approvals','decision_checkpoints','decision_proposals','decision_artifact_edges','idempotency_outcomes','events','outbox'].map(table=>[table,storage.sql.exec('SELECT * FROM '+table+' ORDER BY rowid').toArray()]));}
async function native(storage:DurableObjectStorage,name:string){
 const c=claimSetup(storage),ctx=await claimContext(storage,name,c.body,'claim',c.now);executeCommand(ctx,c.identity,claimTaskCommand('task_a','run_a',PROOF_A),c.body);
 const token='B'.repeat(42)+'A',proof='C'.repeat(42)+'A';storage.sql.exec("UPDATE native_credentials SET token_sha256=? WHERE credential_id='credential_research_1'",await sha256(token));storage.sql.exec("UPDATE runtimes SET proof_sha256=? WHERE id='runtime_a'",await sha256(proof));
 const body={expected_version:3,run_id:'run_a',fence:1,checkpoint:{summary:'Synthetic checkpoint',artifact_ids:[]},proposal:proposal('a'.repeat(64))};
 const req=(headers:Record<string,string>={},value:unknown=body)=>new Request(base+'tasks/task_a:request-decision',{method:'POST',headers:{authorization:'Bearer '+token,'x-runtime-token':proof,'content-type':'application/json','idempotency-key':'decision',...headers},body:JSON.stringify(value)});
 return {workspace:{...ctx.workspace,secrets:{...ctx.workspace.secrets,CURSOR_ENCRYPTION_KEY:'f'.repeat(64)}},token,proof,body,req};
}
it('actual native proof does not activate an unsupported production action or persist an outcome',async()=>{
 const f=await decisionFixture('decision_http_native');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await native(s.storage,f.name),before=snapshot(s.storage);
  expect((await decisionRoutes(x.req(),x.workspace)).status).toBe(503);expect(snapshot(s.storage)).toEqual(before);
  for(const proof of ['', 'malformed', 'D'.repeat(43)]){const request=x.req();if(proof)request.headers.set('x-runtime-token',proof);else request.headers.delete('x-runtime-token');expect((await decisionRoutes(request,x.workspace)).status).toBe(401);expect(snapshot(s.storage)).toEqual(before);}
  const noKey=x.req();noKey.headers.delete('idempotency-key');expect((await decisionRoutes(noKey,x.workspace)).status).toBe(400);
  expect((await decisionRoutes(x.req({}, {...x.body,authority:'invented'}),x.workspace)).status).toBe(400);
  expect((await decisionRoutes(x.req({cookie:'cfhub_session='+'A'.repeat(43)}),x.workspace)).status).toBe(400);
  expect((await decisionRoutes(new Request(base+'approvals',{headers:{authorization:'Bearer '+x.token}}),x.workspace)).status).toBe(403);
  expect(snapshot(s.storage)).toEqual(before);
 });
});
for(const change of ['credential','maintenance','scope'] as const)it('request runtime-proof await rechecks '+change,async()=>{
 const f=await decisionFixture('decision_http_race_'+change);await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await native(s.storage,f.name),before=snapshot(s.storage),digest=crypto.subtle.digest.bind(crypto.subtle);let caught=0;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,input)=>{const result=await digest(algorithm,input);if(new TextDecoder().decode(input)===x.proof){caught++;if(change==='credential')s.storage.sql.exec("UPDATE native_credentials SET revoked_at=1 WHERE credential_id='credential_research_1'");if(change==='maintenance')s.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1');if(change==='scope')s.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"tasks:read\"]' WHERE credential_id='credential_research_1'");}return result;});
  try{expect((await decisionRoutes(x.req(),x.workspace)).status).toBe(change==='scope'?403:401);expect(caught).toBe(1);expect(snapshot(s.storage)).toEqual(before);}finally{spy.mockRestore();}
 });
});
import {descriptor} from '../helpers/decision-policy';
import {artifactContext,stage,bytes} from '../helpers/artifacts';
import {uploadArtifactContent,commitArtifact} from '../../src/artifacts/content';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {createDecisionCommands} from '../../src/approvals/commands-source';
async function readable(storage:DurableObjectStorage,name:string){
 const c=claimSetup(storage),api=createDecisionCommands([descriptor]),ctx=artifactContext(storage,name,'read_fixture',c.now);
 for(const suffix of ['a','b']){
  const taskId='task_'+suffix,claim=await claimContext(storage,name,c.body,'claim_'+suffix,c.now,taskId);executeCommand(claim,c.identity,claimTaskCommand(taskId,'run_'+suffix,PROOF_A),c.body);
  const content=JSON.stringify({task_id:taskId,task_version:3}),hash=await sha256(content),artifactId='input_'+suffix;
  await stage(ctx,artifactId,{task_id:taskId,media_type:'application/json',byte_size:new TextEncoder().encode(content).length,sha256:hash});await uploadArtifactContent({...ctx,idempotencyKey:'upload_'+suffix},artifactId,bytes(content),'upload_'+suffix);await commitArtifact({...ctx,idempotencyKey:'commit_'+suffix},artifactId,{expected_artifact_version:2});
  const body={expected_version:3,run_id:'run_'+suffix,fence:1,checkpoint:{summary:'Synthetic '+suffix,artifact_ids:[artifactId]},proposal:{...proposal(hash),scope:{project_id:null,resource_ids:[taskId]},inputs:{artifact_id:artifactId,sha256:hash}}},key='decision_'+suffix;
  const command=await api.prepareRequestTaskDecision({...ctx,idempotencyKey:key},taskId,body,PROOF_A,{approvalId:'approval_'+suffix,checkpointId:'checkpoint_'+suffix,proposalId:'proposal_'+suffix});
  executeCommand({...claim,idempotencyKey:key,fingerprint:await fingerprintRequest('POST','/source-fixture/'+suffix,{},body)},c.identity,command,body);
 }
 const token='A'.repeat(43);storage.sql.exec("UPDATE sessions SET token_digest=? WHERE id='session_settings'",await sha256(token));
 const workspace={...ctx.workspace,secrets:{...ctx.workspace.secrets,CURSOR_ENCRYPTION_KEY:'f'.repeat(64)}};
 const req=(path='approvals?limit=1')=>new Request(base+path,{headers:{cookie:'cfhub_session='+token,origin}});
 return {workspace,req};
}
it('actual human approval pages retain canonical envelopes and opaque bound continuation',async()=>{
 const f=await decisionFixture('decision_http_pages');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await readable(s.storage,f.name),first=await decisionRoutes(x.req(),x.workspace),page=await first.json() as {data:{id:string}[];page:{has_more:boolean;next_cursor:string};request_id:string};
  expect(first.status).toBe(200);expect(page.data.map(x=>x.id)).toEqual(['approval_a']);expect(page.page.has_more).toBe(true);expect(page.request_id).toBeTruthy();expect(page.page.next_cursor.length).toBe(2048);
  const next=await decisionRoutes(x.req('approvals?limit=1&cursor='+page.page.next_cursor),x.workspace);expect(await next.json()).toMatchObject({data:[{id:'approval_b'}],page:{has_more:false,next_cursor:null}});
  expect((await decisionRoutes(x.req('approvals/approval_a'),x.workspace)).status).toBe(200);
  expect((await decisionRoutes(x.req('approvals?limit=2&cursor='+page.page.next_cursor),x.workspace)).status).toBe(400);
  const corrupt=(page.page.next_cursor[0]==='A'?'B':'A')+page.page.next_cursor.slice(1);expect((await decisionRoutes(x.req('approvals?limit=1&cursor='+corrupt),x.workspace)).status).toBe(400);
  s.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"tasks:read\"]' WHERE principal_id='human_operator'");expect((await decisionRoutes(x.req('approvals?limit=1&cursor='+page.page.next_cursor),x.workspace)).status).toBe(403);
 });
});
for(const change of ['session','maintenance','scope','page'] as const)it('approval cursor encryption rereads current '+change+' before disclosure',async()=>{
 const f=await decisionFixture('decision_http_encode_'+change);await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await readable(s.storage,f.name),encrypt=crypto.subtle.encrypt.bind(crypto.subtle);let caught=0;
  const spy=vi.spyOn(crypto.subtle,'encrypt').mockImplementation(async(...args)=>{const result=await encrypt(...args);caught++;if(change==='session')s.storage.sql.exec("UPDATE sessions SET revoked_at=1 WHERE id='session_settings'");if(change==='maintenance')s.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1');if(change==='scope')s.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"tasks:read\"]' WHERE principal_id='human_operator'");if(change==='page')s.storage.sql.exec("UPDATE approvals SET approval_version=approval_version+1 WHERE id='approval_a'");return result;});
  try{const response=await decisionRoutes(x.req(),x.workspace);expect(caught).toBe(1);expect(response.status).toBe(change==='scope'?403:change==='page'?503:401);expect(await response.json()).not.toHaveProperty('data');}finally{spy.mockRestore();}
 });
});
it('approval detail hidden and absent IDs are indistinguishable after global read permission',async()=>{
 const f=await decisionFixture('decision_http_hidden');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await readable(s.storage,f.name);s.storage.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_a\"]' WHERE principal_id='human_operator'");
  const hidden=await decisionRoutes(x.req('approvals/approval_a'),x.workspace),missing=await decisionRoutes(x.req('approvals/missing'),x.workspace);expect(hidden.status).toBe(404);expect(missing.status).toBe(404);
  const a=await hidden.json() as {error:{code:string}},b=await missing.json() as {error:{code:string}};expect(a.error.code).toBe(b.error.code);
 });
});
it('approval cursor decryption rechecks session and caller workspace aliases cannot rebind launch',async()=>{
 const f=await decisionFixture('decision_http_decode');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await readable(s.storage,f.name),first=await decisionRoutes(x.req(),x.workspace),page=await first.json() as {page:{next_cursor:string}};
  const decrypt=crypto.subtle.decrypt.bind(crypto.subtle);let caught=0;
  const spy=vi.spyOn(crypto.subtle,'decrypt').mockImplementation(async(...args)=>{const result=await decrypt(...args);caught++;s.storage.sql.exec("UPDATE sessions SET revoked_at=1 WHERE id='session_settings'");return result;});
  try{const response=await decisionRoutes(x.req('approvals?limit=1&cursor='+page.page.next_cursor),x.workspace);expect(caught).toBe(1);expect(response.status).toBe(401);expect(await response.json()).not.toHaveProperty('data');}finally{spy.mockRestore();}
 });
});
it('caller workspace mutation during authentication cannot change captured route workspace',async()=>{
 const f=await decisionFixture('decision_http_alias');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await readable(s.storage,f.name),pending=decisionRoutes(x.req('approvals/approval_a'),x.workspace);x.workspace.workspaceId='foreign';x.workspace.objectName='foreign';x.workspace.secrets.CURSOR_ENCRYPTION_KEY='0'.repeat(64);
  const response=await pending;expect(response.status).toBe(200);expect(await response.json()).toMatchObject({data:{id:'approval_a',workspace_id:'ws_example'}});
 });
});
import {csrfToken} from '../../src/auth/csrf';
import {withTransaction} from '../../src/storage/transaction';
import type {SessionRecord} from '../../src/auth/authorize';
it('human session and CSRF do not authorize native decision request; oversized body remains bounded',async()=>{
 const f=await decisionFixture('decision_http_human_write');await runInDurableObject(f.stub,async(_o,s)=>{
  const x=await native(s.storage,f.name),token='A'.repeat(43);s.storage.sql.exec("UPDATE sessions SET token_digest=? WHERE id='session_settings'",await sha256(token));
  const csrf=await csrfToken(x.workspace,withTransaction(s.storage,tx=>tx.one<SessionRecord>("SELECT * FROM sessions WHERE id='session_settings'")!));
  const request=x.req({cookie:'cfhub_session='+token,origin,'x-csrf-token':csrf});request.headers.delete('authorization');const before=snapshot(s.storage);
  expect((await decisionRoutes(request,x.workspace)).status).toBe(403);expect(snapshot(s.storage)).toEqual(before);
  const oversized=x.req({}, {...x.body,checkpoint:{...x.body.checkpoint,summary:'x'.repeat(65537)}});expect((await decisionRoutes(oversized,x.workspace)).status).toBe(413);expect(snapshot(s.storage)).toEqual(before);
 });
});
