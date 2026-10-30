import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {human,owned,commandContext} from '../helpers/settings';
import {prepareBootstrap,sha256,canonicalJson} from '../../src/config/bootstrap';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor,authorize} from '../../src/auth/authorize';
import {verifyNativeCredential} from '../../src/auth/native';
import {delegationScopes} from '../../src/auth/credential-authority';
import {createAgent} from '../../src/agents/commands';
import {issueCredential,revokeCredential,issueCredentialCommand,revokeCredentialCommand} from '../../src/auth/native-credentials';
import {listCredentials} from '../../src/agents/reads';
import {executeCommand} from '../../src/workspace/commands';
import {projectEvent,resourceEventVisibility} from '../../src/audit/events';
import type {CredentialCreateRequest} from '../../src/http/dto';
import type {CursorBinding} from '../../src/http/cursors';
const token=btoa('g'.repeat(32)).replace(/=+$/,'');
const binding:CursorBinding={workspaceId:'ws_example',principalId:'human_operator',lane:'human',credentialId:null,sessionId:'session_settings',operation:'credentials',queryHash:'a'.repeat(64)};
async function setup(name:string,ceiling?:string[]){
 const raw=await fixture(name);
 raw.config.human_grants[0].scopes=['workspace:read','agents:manage','credentials:manage','messages:read','events:read'];
 if(ceiling!==undefined)Object.assign(raw.config.human_grants[0],{delegable_native_scopes:ceiling});
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);
 await stub.reconcileConfiguration(operator(),input);
 return {stub,name,digest:await sha256(token)};
}
function body(scopes:CredentialCreateRequest['scopes']):CredentialCreateRequest{return {agent_id:'agent_delegation',label:'Synthetic delegated authority',scopes,project_ids:null,expires_at:new Date(Date.now()+3600000).toISOString()};}
function amendConfig(storage:DurableObjectStorage,edit:(config:Record<string,any>)=>void){const row=storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one(),config=JSON.parse(row.config_json);edit(config);storage.sql.exec('UPDATE workspace_metadata SET config_json=?',JSON.stringify(config));}
function context(storage:DurableObjectStorage){const identity=human(storage),nowMs=Date.now();return withTransaction(storage,tx=>({actor:resolveActor(tx,identity,nowMs),nowMs,requestId:'delegate',idempotencyKey:'delegate'}));}
function create(storage:DurableObjectStorage){const ctx=context(storage);withTransaction(storage,tx=>createAgent(tx,{...ctx,agentId:'agent_delegation'},{display_name:'Delegation test',description:'',work_role_ids:[]}));return ctx;}
it('canonical installed native delegation permits issuance authentication metadata revoke and audit without human execution scopes',async()=>{
 const {stub,name,digest}=await setup('delegation-consumers',['runtimes:manage']);
 await runInDurableObject(stub,async(_o,state)=>{
  const ctx=create(state.storage),identity=human(state.storage),request=body(['runtimes:manage']),command=issueCredentialCommand({credentialId:'credential_delegation',tokenSha256:digest});
  expect(ctx.actor.scopes.has('runtimes:manage')).toBe(false);
  const execution=await commandContext(state.storage,name,request,'issued');
  const issued=executeCommand(execution,identity,command,request);expect(issued.data.credential.scopes).toEqual(['runtimes:manage']);
  expect(await verifyNativeCredential(owned(state.storage,name),token,Date.now())).toMatchObject({kind:'agent',credentialId:'credential_delegation'});
  withTransaction(state.storage,tx=>{
   expect(delegationScopes(tx,'ws_example','human_operator')).toEqual(['runtimes:manage']);
   const page=listCredentials(tx,ctx.actor,{limit:1,nowMs:Date.now(),binding});expect(page.items.map(c=>c.id)).toEqual(['credential_delegation']);expect(page.hasMore).toBe(false);expect(page.next).toBeNull();
   const event=tx.one<{id:string}>("SELECT id FROM events WHERE type='credential.issued'")!;
   expect(projectEvent(tx,ctx.actor,event.id,Date.now(),resourceEventVisibility)?.resource_id).toBe('credential_delegation');
   expect(revokeCredential(tx,ctx,'credential_delegation',{expected_credential_version:1,reason:'Synthetic'}).status).toBe('revoked');
  });
  await expect(verifyNativeCredential(owned(state.storage,name),token,Date.now())).rejects.toThrow();
 });
});
it.each([{ceiling:[] as string[]},{ceiling:['runtimes:manage']}])('explicit ceiling $ceiling replaces rather than unions executable scopes',async ({ceiling})=>{
 const {stub,digest}=await setup('delegation-exact-'+ceiling.length,ceiling);
 await runInDurableObject(stub,(_o,state)=>{
  const ctx=create(state.storage);
  withTransaction(state.storage,tx=>{
   expect(delegationScopes(tx,'ws_example','human_operator')).toEqual(ceiling);
   expect(()=>issueCredential(tx,ctx,body(['messages:read']),{credentialId:'must_deny',tokenSha256:digest})).toThrowError(expect.objectContaining({status:403}));
   if(ceiling.length===0)expect(()=>issueCredential(tx,ctx,body(['runtimes:manage']),{credentialId:'must_deny_runtime',tokenSha256:digest})).toThrowError(expect.objectContaining({status:403}));
  });
  expect(state.storage.sql.exec("SELECT * FROM native_credentials WHERE origin='human_managed'").toArray()).toEqual([]);
 });
});
it('omitted delegation preserves native intersection and grants no native-only authority',async()=>{
 const {stub,digest}=await setup('delegation-legacy');await runInDurableObject(stub,(_o,state)=>{
  const ctx=create(state.storage);withTransaction(state.storage,tx=>{
   expect(delegationScopes(tx,'ws_example','human_operator')).toEqual(expect.arrayContaining(['messages:read']));
   expect(delegationScopes(tx,'ws_example','human_operator')).not.toContain('credentials:manage');
   expect(delegationScopes(tx,'ws_example','human_operator')).not.toContain('runtimes:manage');
   expect(issueCredential(tx,ctx,body(['messages:read']),{credentialId:'legacy_read',tokenSha256:digest}).credential.scopes).toEqual(['messages:read']);
   expect(()=>issueCredential(tx,ctx,body(['runtimes:manage']),{credentialId:'legacy_denied',tokenSha256:'b'.repeat(64)})).toThrowError(expect.objectContaining({status:403}));
  });
 });
});
it.each(['malformed','epoch','principal','issuer','subject','workspace','duplicate','invalid-scope'] as const)('delegation denies malformed or mismatched installed binding: %s',async mutation=>{
 const {stub}=await setup('delegation-invalid-'+mutation,['runtimes:manage']);await runInDurableObject(stub,(_o,state)=>{
  if(mutation==='malformed')state.storage.sql.exec("UPDATE workspace_metadata SET config_json='{}'");
  else amendConfig(state.storage,config=>{
   if(mutation==='epoch')config.config_epoch++;
   if(mutation==='principal')config.human_grants[0].principal_id='other_principal';
   if(mutation==='issuer')config.human_grants[0].issuer='https://other.example.invalid';
   if(mutation==='subject')config.human_grants[0].subject='other_subject';
   if(mutation==='workspace')config.human_grants[0].workspace_id='other_workspace';
   if(mutation==='duplicate')config.human_grants.push({...config.human_grants[0]});
   if(mutation==='invalid-scope')config.human_grants[0].delegable_native_scopes=['credentials:manage'];
  });
  withTransaction(state.storage,tx=>{expect(delegationScopes(tx,'ws_example','human_operator')).toBeNull();});
 });
});
it('current project ceiling and separate static ceilings cannot be bypassed by native delegation',async()=>{
 const {stub,digest}=await setup('delegation-project-static',['runtimes:manage','messages:read']);await runInDurableObject(stub,(_o,state)=>{
  const ctx=create(state.storage);state.storage.sql.exec("UPDATE human_grants SET project_ids_json='[]'");
  withTransaction(state.storage,tx=>{expect(()=>issueCredential(tx,ctx,body(['runtimes:manage']),{credentialId:'global_denied',tokenSha256:digest})).toThrowError(expect.objectContaining({status:403}));});
  state.storage.sql.exec("UPDATE human_grants SET project_ids_json='null'");
  state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"runtimes:manage\"]'");
  state.storage.sql.exec("INSERT INTO native_credentials SELECT 'static_second',workspace_id,agent_id,?, '[\"messages:read\"]',project_ids_json,expires_at,enabled,config_epoch,retired_at_epoch,origin,credential_version,label,created_at,revoked_at,issued_by_principal_id FROM native_credentials LIMIT 1",'c'.repeat(64));
  withTransaction(state.storage,tx=>{expect(()=>issueCredential(tx,ctx,{...body(['runtimes:manage','messages:read']),agent_id:'agent_research'},{credentialId:'union_denied',tokenSha256:digest})).toThrowError(expect.objectContaining({status:403}));});
 });
});
it('narrowed exact delegation hides immutable replay and events and invalidates current native authority',async()=>{
 const {stub,name,digest}=await setup('delegation-narrow',['runtimes:manage','messages:read']);await runInDurableObject(stub,async(_o,state)=>{
  const ctx=create(state.storage),identity=human(state.storage),request=body(['runtimes:manage','messages:read']);
  const execution=await commandContext(state.storage,name,request,'issue'),command=issueCredentialCommand({credentialId:'credential_narrow',tokenSha256:digest});executeCommand(execution,identity,command,request);
  const event=state.storage.sql.exec<{id:string}>("SELECT id FROM events WHERE type='credential.issued'").one().id;
  amendConfig(state.storage,config=>{config.human_grants[0].delegable_native_scopes=['runtimes:manage'];});
  await expect(verifyNativeCredential(owned(state.storage,name),token,Date.now())).rejects.toThrow();
  const before=state.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray();
  expect(()=>executeCommand(execution,identity,command,request)).toThrow();
  withTransaction(state.storage,tx=>{expect(listCredentials(tx,ctx.actor,{limit:1,nowMs:Date.now(),binding}).items).toEqual([]);expect(projectEvent(tx,ctx.actor,event,Date.now(),resourceEventVisibility)).toBeNull();expect(()=>revokeCredential(tx,ctx,'credential_narrow',{expected_credential_version:1,reason:'Denied'})).toThrow();});
  expect(state.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray()).toEqual(before);
 });
});
it('revoke replay rechecks original scope ceiling even when current resource narrows',async()=>{
 const {stub,name,digest}=await setup('delegation-revoke-replay',['runtimes:manage','messages:read']);await runInDurableObject(stub,async(_o,state)=>{
  const ctx=create(state.storage),identity=human(state.storage);withTransaction(state.storage,tx=>issueCredential(tx,ctx,body(['runtimes:manage','messages:read']),{credentialId:'credential_replay',tokenSha256:digest}));
  const request={expected_credential_version:1,reason:'Synthetic'},execution=await commandContext(state.storage,name,request,'revoke'),command=revokeCredentialCommand('credential_replay');executeCommand(execution,identity,command,request);
  amendConfig(state.storage,config=>{config.human_grants[0].delegable_native_scopes=['runtimes:manage'];});state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"runtimes:manage\"]' WHERE credential_id='credential_replay'");
  expect(()=>executeCommand(execution,identity,command,request)).toThrowError(expect.objectContaining({status:403}));
 });
});

it('all four native-only delegation capabilities remain unavailable to direct human authorization',async()=>{
 const capabilities=['messages:ack','runtimes:manage','tasks:claim','tasks:execute'];
 const {stub}=await setup('delegation-not-execution',capabilities);
 await runInDurableObject(stub,(_o,state)=>{
  const ctx=context(state.storage);
  withTransaction(state.storage,tx=>{
   expect(delegationScopes(tx,'ws_example','human_operator')).toEqual(capabilities);
   for(const scope of capabilities){expect(ctx.actor.scopes.has(scope)).toBe(false);expect(()=>authorize(tx,ctx.actor,scope,undefined,ctx.nowMs)).toThrowError(expect.objectContaining({status:403}));}
  });
 });
});
