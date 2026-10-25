import {it,expect,vi} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {canonicalJson,prepareBootstrap,sha256,installConfiguration} from '../../src/config/bootstrap';
import {withTransaction} from '../../src/storage/transaction';
import {executeCommand,type CommandDescriptor,type CommandExecutionContext} from '../../src/workspace/commands';
import {fingerprintRequest,cleanupCompletedOutcomes} from '../../src/workspace/idempotency';
import {projectEvent} from '../../src/audit/events';
import {resolveActor,authorize} from '../../src/auth/authorize';
import {dispatchCommand} from '../../src/http/router';
import {csrfToken} from '../../src/auth/csrf';
import {HttpError,toHttpResponse} from '../../src/http/envelopes';
import type {AuthWorkspace} from '../../src/auth/context';
import type {VerifiedIdentity} from '../../src/workspace/context';
const token='A'.repeat(43),secret='canary_body_cookie_bearer_private_endpoint_stack_digest';
async function setup(name:string){
 const raw=await fixture(name);raw.bundle.credentials[0].token_sha256=await sha256(token);
 const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration(operator(),input);
 const identity:VerifiedIdentity={kind:'agent',workspaceId:'ws_example',credentialId:'credential_research_1',tokenDigest:await sha256(token)};
 return {stub,identity,name,input};
}
function workspace(storage:DurableObjectStorage,name:string,now=Date.now()):AuthWorkspace{return {storage,workspaceId:'ws_example',objectName:name,secrets:{},clock:{nowMs:()=>now},entropy:{bytes:n=>crypto.getRandomValues(new Uint8Array(n))}};}
const counts=(storage:DurableObjectStorage)=>Object.fromEntries(['threads','messages','outbox','events','idempotency_outcomes'].map(t=>[t,storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM '+t).one().n]));
function descriptor(id='message_one',fault=false):CommandDescriptor<{body:string;items?:number[]},{id:string}>{
 return {operation:'messages:send',target:'messages',
 resource:()=>undefined,checkAccess:()=>{},checkReplay:(tx,ctx,_body,outcome)=>{authorize(tx,ctx.actor,'messages:read',undefined,ctx.nowMs);if(!tx.one('SELECT id FROM messages WHERE id=?',[outcome.data.id]))throw new HttpError('NOT_FOUND',404);},
 execute:(tx,ctx,body)=>{
  // First-execution precondition intentionally fails if rerun during replay.
  if(tx.one('SELECT id FROM messages WHERE id=?',[id]))throw Error('FIRST_EXECUTION_ONLY');
  tx.exec('INSERT INTO threads (id,workspace_id,subject,created_at) VALUES (?,?,?,?)',['thread_'+id,ctx.actor.workspaceId,'synthetic',ctx.nowMs]);
  tx.exec('INSERT INTO messages (id,workspace_id,thread_id,sender_kind,sender_principal_id,sender_agent_id,body,refs_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[id,ctx.actor.workspaceId,'thread_'+id,ctx.actor.kind,ctx.actor.principalId,ctx.actor.agentId,body.body,'[]',ctx.nowMs]);
  tx.exec("INSERT INTO outbox (id,workspace_id,message_id,destination_id,notification_id,payload_json,status,next_due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',?,?,?)",['out_'+id,ctx.actor.workspaceId,id,'synthetic_destination','notify_'+id,'{}',ctx.nowMs,ctx.nowMs,ctx.nowMs]);
  if(fault)throw Error(secret);
  return {outcome:{status:201,data:{id}},event:{type:'message.accepted',resourceType:'message',resourceId:id,resourceVersion:null,threadId:'thread_'+id}};
 }};
}
async function context(storage:DurableObjectStorage,name:string,body:unknown,key='same',now=Date.now()):Promise<CommandExecutionContext>{return {workspace:workspace(storage,name,now),requestId:'req_'+key,idempotencyKey:key,fingerprint:await fingerprintRequest('POST','/messages',{},body),admissionGeneration:storage.sql.exec<{generation:number}>('SELECT generation FROM maintenance_state WHERE id=1').one().generation,admissionEpoch:storage.sql.exec<{config_epoch:number}>('SELECT config_epoch FROM workspace_metadata WHERE id=1').one().config_epoch};}
it('canonical_key_order_replays_array_order_conflicts',async()=>{
 const {stub,identity,name}=await setup('command-order');
 await runInDurableObject(stub,async(_o,state)=>{
  const a={body:secret,items:[1,2]},ctx=await context(state.storage,name,a);
  const original=executeCommand(ctx,identity,descriptor(),a),before=counts(state.storage);
  const b={items:[1,2],body:secret},replay=executeCommand({...await context(state.storage,name,b),requestId:'req_replay'},identity,descriptor(),b);
  expect(replay).toEqual(original);expect(counts(state.storage)).toEqual(before);
  expect(before).toMatchObject({messages:1,outbox:1,idempotency_outcomes:1,events:2});
  expect(await toHttpResponse(replay,'req_replay').json()).toEqual({data:{id:'message_one'},request_id:'req_replay'});
  expect(state.storage.sql.exec('SELECT original_request_id,event_id FROM idempotency_outcomes').one()).toMatchObject({original_request_id:'req_same'});
  expect(()=>executeCommand({...ctx,fingerprint:'f'.repeat(64)},identity,descriptor(),a)).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT',status:409}));
  expect(counts(state.storage)).toEqual(before);
 });
});
it('same_key_other_principal_is_separate',async()=>{
 const {stub,identity,name}=await setup('command-principal');
 await runInDurableObject(stub,async(_o,state)=>{
  const body={body:'safe'},ctx=await context(state.storage,name,body);
  executeCommand(ctx,identity,descriptor(),body);
  withTransaction(state.storage,tx=>{const row=tx.one<{token_sha256:string}>('SELECT token_sha256 FROM native_credentials')!;tx.exec('INSERT INTO static_agents VALUES (?,?,?,?)',['agent_other','ws_example','Other',1]);tx.exec('INSERT INTO native_credentials (credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch) VALUES (?,?,?,?,?,?,?,?,?)',['credential_other','ws_example','agent_other',row.token_sha256,'["messages:send","messages:read"]','null',Date.now()+100000,1,1]);});
  const other={...identity,credentialId:'credential_other'} as VerifiedIdentity;
  executeCommand(ctx,other,descriptor('message_two'),body);
  expect(counts(state.storage)).toMatchObject({messages:2,outbox:2,idempotency_outcomes:2});
 });
});
it('failure_before_commit_writes_nothing',async()=>{
 const {stub,identity,name}=await setup('command-failure');
 await runInDurableObject(stub,async(_o,state)=>{
  const body={body:secret},ctx=await context(state.storage,name,body),before=counts(state.storage);
  expect(()=>executeCommand(ctx,identity,descriptor('failed',true),body)).toThrow(secret);
  expect(counts(state.storage)).toEqual(before);
  // Failure after event insertion also rolls back effects/outbox/event/outcome.
  state.storage.sql.exec("CREATE TRIGGER reject_outcome BEFORE INSERT ON idempotency_outcomes BEGIN SELECT RAISE(ABORT,'fault_outcome'); END");
  expect(()=>executeCommand(ctx,identity,descriptor(),body)).toThrow();expect(counts(state.storage)).toEqual(before);
 });
});
it('replay_checks_current_grants_before_outcome',async()=>{
 const {stub,identity,name}=await setup('command-grants');
 await runInDurableObject(stub,async(_o,state)=>{
  const body={body:'safe'},ctx=await context(state.storage,name,body);executeCommand(ctx,identity,descriptor(),body);const before=counts(state.storage);
  state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[]'");
  expect(()=>executeCommand(ctx,identity,descriptor(),body)).toThrowError(expect.objectContaining({status:403}));
  expect(counts(state.storage)).toEqual(before);
  state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"messages:send\"]'");
  expect(()=>executeCommand(ctx,identity,descriptor(),body)).toThrowError(expect.objectContaining({status:403}));
  state.storage.sql.exec('UPDATE native_credentials SET enabled=0');
  expect(()=>executeCommand(ctx,identity,descriptor(),body)).toThrowError(expect.objectContaining({status:401}));
 });
});
it('fresh_time_and_admission_are_checked_after_async_preparation',async()=>{
 const {stub,identity,name}=await setup('command-time');
 await runInDurableObject(stub,async(_o,state)=>{
  const body={body:'safe'},ctx=await context(state.storage,name,body);
  state.storage.sql.exec('UPDATE native_credentials SET expires_at=?',ctx.workspace.clock.nowMs()+1);
  const stale={...ctx,workspace:{...ctx.workspace,clock:{nowMs:()=>ctx.workspace.clock.nowMs()+1}}};
  expect(()=>executeCommand(stale,identity,descriptor(),body)).toThrowError(expect.objectContaining({status:401}));
  state.storage.sql.exec('UPDATE native_credentials SET expires_at=?',Date.now()+100000);
  state.storage.sql.exec("UPDATE maintenance_state SET state='capturing',capture_id='capture',generation=generation+1,updated_at=1 WHERE id=1");
  expect(()=>executeCommand(ctx,identity,descriptor(),body)).toThrowError(expect.objectContaining({status:503}));
  expect(counts(state.storage)).toMatchObject({messages:0,outbox:0,idempotency_outcomes:0});
 });
});
it('completed_outcomes_survive_restart_and_exactly_24_hours_operator_receipts_are_separate',async()=>{
 const {stub,identity,name}=await setup('command-retention');let now=0;
 await runInDurableObject(stub,async(_o,state)=>{
  const body={body:'safe'},ctx=await context(state.storage,name,body);now=ctx.workspace.clock.nowMs();executeCommand(ctx,identity,descriptor(),body);
  state.storage.sql.exec("INSERT INTO idempotency_outcomes VALUES ('operator','operator.install','ws_example','install','ws_example',?,200,'{}','req_install',NULL,?,?)",'e'.repeat(64),now,now+86400000);
  withTransaction(state.storage,tx=>cleanupCompletedOutcomes(tx,'ws_example',now+86400000));
  expect(counts(state.storage).idempotency_outcomes).toBe(2);
 });
 await evictDurableObject(stub);
 await runInDurableObject(stub,async(_o,state)=>{
  const ctx=await context(state.storage,name,{body:'safe'},'same',now+86400000);
  expect(executeCommand(ctx,identity,descriptor(),{body:'safe'})).toEqual({status:201,data:{id:'message_one'}});
  withTransaction(state.storage,tx=>cleanupCompletedOutcomes(tx,'ws_example',now+86400001));
  expect(state.storage.sql.exec('SELECT operation FROM idempotency_outcomes').toArray()).toEqual([{operation:'operator.install'}]);
 });
});
it('event_projection_requires_events_scope_and_current_underlying_visibility',async()=>{
 const {stub,identity,name}=await setup('event-visibility');
 await runInDurableObject(stub,async(_o,state)=>{
  const body={body:secret},ctx=await context(state.storage,name,body);executeCommand(ctx,identity,descriptor(),body);
  const eventId=state.storage.sql.exec<{id:string}>("SELECT id FROM events WHERE type='message.accepted'").one().id;
  withTransaction(state.storage,tx=>{
   const actor=resolveActor(tx,identity,ctx.workspace.clock.nowMs());
   expect(projectEvent(tx,actor,eventId,ctx.workspace.clock.nowMs(),()=>false)).toBeNull();
   const event=projectEvent(tx,actor,eventId,ctx.workspace.clock.nowMs(),()=>true);
   expect(event).toMatchObject({request_id:'req_same',resource_id:'message_one',thread_id:'thread_message_one'});
   expect(JSON.stringify(event)).not.toContain(secret);
   tx.exec("UPDATE native_credentials SET project_ids_json='[]'");
   expect(projectEvent(tx,actor,eventId,ctx.workspace.clock.nowMs(),(_tx,current)=>current.projectIds===null)).toBeNull();
   tx.exec("UPDATE native_credentials SET scopes_json='[]'");
   expect(()=>projectEvent(tx,actor,eventId,ctx.workspace.clock.nowMs(),()=>true)).toThrowError(expect.objectContaining({status:403}));
  });
 });
});
it('authenticated_dispatch_ignores_caller_identity_and_generates_fresh_request_ids',async()=>{
 const {stub,name}=await setup('dispatch-native');
 await runInDurableObject(stub,async(_o,state)=>{
  const owned=workspace(state.storage,name),route={method:'POST',path:'/v2/workspaces/ws_example/messages',schema:'MessageCreateRequest' as const,query:()=>({}),command:descriptor()};
  const body={recipient_agent_ids:['agent_research'],body:'safe',refs:[],artifact_ids:[]};
  const request=(authorization:string|undefined,extra:unknown={})=>new Request('https://hub.example.invalid'+route.path,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'dispatch','x-request-id':'forged_correlation',...(authorization?{authorization}:{})},body:JSON.stringify({...body,...extra as object})});
  const missing=await dispatchCommand(request(undefined),owned,route);expect(missing.status).toBe(401);
  const forged=await dispatchCommand(request('Bearer '+token,{identity:{kind:'agent',principalId:'admin'}}),owned,route);expect(forged.status).toBe(400);
  const first=await dispatchCommand(request('Bearer '+token),owned,route),again=await dispatchCommand(request('Bearer '+token),owned,route);
  expect(first.status).toBe(201);expect(again.status).toBe(201);
  const a=await first.json() as {request_id:string},b=await again.json() as {request_id:string};expect(a.request_id).not.toBe('forged_correlation');expect(a.request_id).not.toBe(b.request_id);
  const before=counts(state.storage);state.storage.sql.exec('UPDATE native_credentials SET enabled=0');
  expect((await dispatchCommand(request('Bearer '+token),owned,route)).status).toBe(401);expect(counts(state.storage)).toEqual(before);
 });
});
it('human_dispatch_requires_csrf_and_replay_rechecks_original_session',async()=>{
 const {stub,name}=await setup('dispatch-human');
 await runInDurableObject(stub,async(_o,state)=>{
  const owned={...workspace(state.storage,name),secrets:{CSRF_SECRET:'synthetic_csrf_secret_'.repeat(3)}},now=owned.clock.nowMs();
  const session={id:'session_one',workspace_id:'ws_example',principal_id:'human_operator',issuer:'https://identity.example.invalid',subject:'synthetic-subject',expires_at:now+100000,revoked_at:null,auth_epoch:1};
  const cookie='B'.repeat(43),csrf=await csrfToken(owned,session);
  state.storage.sql.exec('INSERT INTO sessions (id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,auth_epoch) VALUES (?,?,?,?,?,?,?,?,?,?)',session.id,session.workspace_id,session.principal_id,await sha256(cookie),await sha256(csrf),session.issuer,session.subject,now,session.expires_at,1);
  const route={method:'POST',path:'/v2/workspaces/ws_example/messages',schema:'MessageCreateRequest' as const,query:()=>({}),command:descriptor()};
  const request=(value:string|undefined)=>new Request('https://hub.example.invalid'+route.path,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'human','cookie':'cfhub_session='+cookie,origin:'https://hub.example.invalid',...(value?{'x-csrf-token':value}:{})},body:JSON.stringify({recipient_agent_ids:['agent_research'],body:'safe',refs:[],artifact_ids:[]})});
  expect((await dispatchCommand(request(undefined),owned,route)).status).toBe(403);
  expect(counts(state.storage).messages).toBe(0);
  expect((await dispatchCommand(request(csrf),owned,route)).status).toBe(201);
  state.storage.sql.exec('UPDATE sessions SET revoked_at=? WHERE id=?',now,session.id);
  expect((await dispatchCommand(request(csrf),owned,route)).status).toBe(401);
  expect(counts(state.storage).messages).toBe(1);
 });
});
it('secret_canaries_are_absent_from_persisted_events_outcomes_and_all_diagnostic_sinks',async()=>{
 const {stub,identity,name}=await setup('command-canary'),warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),info=vi.spyOn(console,'info').mockImplementation(()=>{});
 try{await runInDurableObject(stub,async(_o,state)=>{
  const body={body:secret},ctx=await context(state.storage,name,body);executeCommand(ctx,identity,descriptor(),body);executeCommand(ctx,identity,descriptor(),body);
  expect(()=>executeCommand({...ctx,idempotencyKey:'failure'},identity,descriptor('failure',true),body)).toThrow(secret);
  for(const table of ['events','idempotency_outcomes','outbox'])expect(JSON.stringify(state.storage.sql.exec('SELECT * FROM '+table).toArray())).not.toContain(secret);
 });expect(JSON.stringify([...warn.mock.calls,...info.mock.calls])).not.toContain(secret);
 }finally{warn.mockRestore();info.mockRestore();}
});

it.each(['resource','checkAccess','execute'] as const)('promise_%s_callback_fails_closed_and_rolls_back',async hook=>{
 const {stub,identity,name}=await setup('async-first-'+hook.toLowerCase());
 await runInDurableObject(stub,async(_o,state)=>{
  const body={body:'safe'},ctx=await context(state.storage,name,body),command=descriptor(),before=counts(state.storage);
  let rejection:Promise<never>|undefined;
  const bad=(tx:Parameters<typeof command.execute>[0],callCtx:Parameters<typeof command.execute>[1])=>{
   if(hook==='execute')command.execute(tx,callCtx,body,'event_async_probe');
   else tx.exec('INSERT INTO threads (id,workspace_id,subject,created_at) VALUES (?,?,?,?)',['guard_probe','ws_example','probe',1]);
   return rejection=Promise.reject(new HttpError('FORBIDDEN',403));
  };
  const broken={...command,[hook]:bad} as unknown as typeof command;
  let outcome:unknown,error:unknown;
  try{outcome=executeCommand(ctx,identity,broken,body);}catch(caught){error=caught;}
  // Keep vulnerable RED free of unrelated unhandled-rejection noise. GREEN must consume its own rejection.
  if(!error)void rejection?.catch(()=>{});
  expect(error).toMatchObject({code:'INTERNAL_ERROR',status:500});expect(outcome).toBeUndefined();
  expect(counts(state.storage)).toEqual(before);
  await new Promise(resolve=>setTimeout(resolve,0));
 });
});
it('promise_replay_guard_returns_no_protected_outcome_and_rolls_back',async()=>{
 const {stub,identity,name}=await setup('async-replay');
 await runInDurableObject(stub,async(_o,state)=>{
  const body={body:'safe'},ctx=await context(state.storage,name,body),command=descriptor();executeCommand(ctx,identity,command,body);
  const before=counts(state.storage);let rejection:Promise<never>|undefined;
  const broken={...command,checkReplay:((tx:Parameters<typeof command.checkReplay>[0])=>{
   tx.exec("INSERT INTO threads (id,workspace_id,subject,created_at) VALUES ('replay_guard','ws_example','probe',1)");
   return rejection=Promise.reject(new HttpError('FORBIDDEN',403));
  }) as unknown as typeof command.checkReplay};
  let outcome:unknown,error:unknown;try{outcome=executeCommand(ctx,identity,broken,body);}catch(caught){error=caught;}
  if(!error)void rejection?.catch(()=>{});
  expect(error).toMatchObject({code:'INTERNAL_ERROR',status:500});expect(outcome).toBeUndefined();expect(counts(state.storage)).toEqual(before);
  await new Promise(resolve=>setTimeout(resolve,0));
 });
});
it.each(['checkAccess','checkReplay'] as const)('thenable_%s_guard_fails_closed',async hook=>{
 const {stub,identity,name}=await setup('thenable-'+hook.toLowerCase());
 await runInDurableObject(stub,async(_o,state)=>{
  const body={body:'safe'},ctx=await context(state.storage,name,body),command=descriptor();
  if(hook==='checkReplay')executeCommand(ctx,identity,command,body);
  const before=counts(state.storage);
  const broken={...command,[hook]:()=>({then(_resolve:unknown,reject:(error:unknown)=>void){reject(new HttpError('FORBIDDEN',403));}})} as unknown as typeof command;
  let outcome:unknown,error:unknown;try{outcome=executeCommand(ctx,identity,broken,body);}catch(caught){error=caught;}
  expect(error).toMatchObject({code:'INTERNAL_ERROR',status:500});expect(outcome).toBeUndefined();expect(counts(state.storage)).toEqual(before);
  await new Promise(resolve=>setTimeout(resolve,0));
 });
});
it.each(['first','replay'] as const)('native_origin_epoch_interleaving_denies_%s_without_effects_or_original_data',async mode=>{
 const {stub,name,input}=await setup('origin-race-'+mode);
 await runInDurableObject(stub,async(_o,state)=>{
  const owned=workspace(state.storage,name),route={method:'POST',path:'/v2/workspaces/ws_example/messages',schema:'MessageCreateRequest' as const,query:()=>({}),command:descriptor()};
  const oldOrigin='https://hub.example.invalid',newOrigin='https://new-hub.example.invalid';
  const request=(origin:string)=>new Request(origin+route.path,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'origin-race',authorization:'Bearer '+token,origin},body:JSON.stringify({recipient_agent_ids:['agent_research'],body:'safe',refs:[],artifact_ids:[]})});
  if(mode==='replay')expect((await dispatchCommand(request(oldOrigin),owned,route)).status).toBe(201);
  const updated=structuredClone(input);updated.config.config_epoch=2;updated.bundle.config_epoch=2;
  updated.config.authentication.allowed_origins=[newOrigin];
  updated.config.authentication.redirect_uris[0].redirect_uri=newOrigin+'/v2/workspaces/ws_example/auth/callback';
  updated.bundle.config_digest=await sha256(canonicalJson(updated.config));
  const prepared=await prepareBootstrap(updated.config,updated.bundle,'ws_example');
  let hashes=0,afterInstall:ReturnType<typeof counts>|undefined;
  const digest=crypto.subtle.digest.bind(crypto.subtle);
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(...args:Parameters<typeof crypto.subtle.digest>)=>{
   const hash=await digest(...args);
   // Native proof is hash 1; fingerprint is hash 2. Install only origin policy while preserving the credential.
   if(++hashes===2){withTransaction(state.storage,tx=>installConfiguration(tx,prepared.config,prepared,owned.clock.nowMs()));afterInstall=counts(state.storage);}
   return hash;
  });
  let denied:Response;try{denied=await dispatchCommand(request(oldOrigin),owned,route);}finally{spy.mockRestore();}
  expect(afterInstall).toBeDefined();expect(denied.status).toBe(401);expect(await denied.json()).not.toHaveProperty('data');expect(counts(state.storage)).toEqual(afterInstall);
  // A current independently prepared request at the new allowed origin may create/replay normally.
  const fresh=await dispatchCommand(request(newOrigin),owned,route);expect(fresh.status).toBe(201);
  expect(await fresh.json()).toHaveProperty('data.id','message_one');
  expect(state.storage.sql.exec("SELECT enabled,config_epoch,token_sha256 FROM native_credentials").one()).toMatchObject({enabled:1,config_epoch:2,token_sha256:(input.bundle.credentials[0]).token_sha256});
 });
});
