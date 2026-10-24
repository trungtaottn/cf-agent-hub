import {it,expect,vi} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {prepared,operator,fixture} from '../helpers/environment';
import {prepareBootstrap,sha256,canonicalJson} from '../../src/config/bootstrap';
import type {InstallOperationContext} from '../../src/workspace/context';
const context=(expectedEpoch=0,digest:string|null=null,operationId='install_one',fingerprint='1'.repeat(64)):InstallOperationContext=>({...operator(expectedEpoch,digest),operationId,requestFingerprint:fingerprint,proofExpiresAt:Date.now()+300000});
it('operator_receipt_event_and_authority_commit_atomically_and_deny_without_rpc_exception',async()=>{
 const name='operator-atomic',stub=env.WORKSPACE.getByName(name),input=await prepared(name,3);
 await runInDurableObject(stub,async(object,state)=>{
  state.storage.sql.exec("CREATE TRIGGER fail_operator_receipt BEFORE INSERT ON idempotency_outcomes BEGIN SELECT RAISE(ABORT,'test_failure'); END");
  const failed=await object.installOperation(context(),input);
  expect(failed.ok).toBe(false);
  for(const table of ['workspace_metadata','events','native_credentials','idempotency_outcomes'])expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM '+table).one().n).toBe(0);
  state.storage.sql.exec('DROP TRIGGER fail_operator_receipt');
  const installed=await object.installOperation(context(),input);
  expect(installed.ok).toBe(true);
  const event=state.storage.sql.exec<{summary:string;actor_json:string;request_id:string}>('SELECT summary,actor_json,request_id FROM events').one();
  expect(event.summary).toBe('Workspace configuration installed.');
  expect(JSON.parse(event.actor_json)).toEqual({kind:'system',principal_id:'synthetic_operator',agent_id:null});
  const receipt=state.storage.sql.exec<{operation:string;target:string;key:string;expires_at:number;created_at:number}>('SELECT operation,target,key,expires_at,created_at FROM idempotency_outcomes').one();
  expect(receipt.operation).toBe('operator.install');expect(receipt.target).toBe('ws_example');expect(receipt.key).toBe('install_one');
  expect(receipt.expires_at-receipt.created_at>=86400000).toBe(true);
 });
});
it('original_operation_replay_precedes_cas_but_not_current_maintenance',async()=>{
 const name='operator-replay-admission',stub=env.WORKSPACE.getByName(name),input=await prepared(name,3);
 await runInDurableObject(stub,async(object,state)=>{
  const original=await object.installOperation(context(),input);expect(original.ok).toBe(true);
  const replay=await object.installOperation({...context(),requestId:'fresh_request'},input);
  expect(replay).toEqual(original);
  const conflict=await object.installOperation(context(0,null,'install_one','2'.repeat(64)),input);expect(conflict.ok).toBe(false);
  const newId=await object.installOperation(context(3,input.installationDigest,'new_identity'),input);expect(newId.ok).toBe(false);
  state.storage.sql.exec("INSERT INTO maintenance_state (id,state,barrier_id,authority_epoch,capture_id,updated_at) VALUES (1,'paused','barrier',3,NULL,1)");
  const closed=await object.installOperation(context(),input);expect(closed.ok).toBe(false);
  expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM idempotency_outcomes').one().n).toBe(1);
  expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM events').one().n).toBe(1);
 });
});
it('snapshot_cas_detects_intervening_install_and_validates_closed_binding_inputs',async()=>{
 const name='operator-snapshot',stub=env.WORKSPACE.getByName(name),input=await prepared(name,3),next=await prepared(name,4);
 const initial=await stub.authoritySnapshot({workspaceId:'ws_example',objectName:name});expect(initial).toEqual({epoch:0,installationDigest:null});
 await runInDurableObject(stub,async(object,state)=>{
  expect((await object.installOperation(context(),input)).ok).toBe(true);
  expect((await object.installOperation(context(initial.epoch,initial.installationDigest,'interleaved'),next)).ok).toBe(false);
  expect((await object.installOperation({...context(3,input.installationDigest,'next'),extra:'untrusted'} as InstallOperationContext,next)).ok).toBe(false);
  expect((await object.installOperation(context(3,input.installationDigest,'next'),{...next,installationDigest:'f'.repeat(64)})).ok).toBe(false);
  expect(state.storage.sql.exec('SELECT config_epoch FROM workspace_metadata').one().config_epoch).toBe(3);
 });
});

it('operator_proof_expiry_after_preparation_denies_effect_and_original_replay',async()=>{
 const name='operator-expired-proof',stub=env.WORKSPACE.getByName(name),input=await prepared(name,3);
 await runInDurableObject(stub,async(object,state)=>{
  const instant=Date.now(),proof=context();
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(instant);
  try{
   const pending=object.installOperation({...proof,proofExpiresAt:instant+1000},input);
   // prepareBootstrap has yielded to WebCrypto; expiry occurs before the transaction.
   vi.setSystemTime(instant+1000);
   expect((await pending).ok).toBe(false);
  }finally{vi.useRealTimers();}
  const expired={...proof,proofExpiresAt:Date.now()-1};
  expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM workspace_metadata').one().n).toBe(0);
  expect((await object.installOperation(proof,input)).ok).toBe(true);
  expect((await object.installOperation(expired,input)).ok).toBe(false);
  expect((await object.installOperation({...proof,requestId:'new_assertion',proofExpiresAt:Date.now()+600000},input)).ok).toBe(true);
  expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM events').one().n).toBe(1);
 });
});

it('retired_participant_validation_keeps_operator_authority_events_and_receipts_atomic',async()=>{
 const name='operator-retired-reference',stub=env.WORKSPACE.getByName(name),orphan=await prepared(name,3);
 orphan.bundle.retired_credentials=[{workspace_id:'ws_example',credential_id:'retired_missing',agent_id:'missing_agent',token_sha256:'3'.repeat(64),retired_at_epoch:2}];
 orphan.installationDigest=await sha256(canonicalJson({config:orphan.config,credentials:orphan.bundle.credentials,retired_credentials:orphan.bundle.retired_credentials}));
 await runInDurableObject(stub,async(object,state)=>{
  const snapshot=()=>['workspace_metadata','human_grants','static_agents','native_credentials','events','idempotency_outcomes'].map(table=>state.storage.sql.exec('SELECT * FROM '+table).toArray());
  const empty=snapshot();expect(empty.map(x=>x.length)).toEqual([0,0,0,0,0,0]);
  const invalid=await object.installOperation(context(),orphan);
  expect(invalid.ok).toBe(false);if(!invalid.ok)expect(invalid.code).toBe('INVALID_INSTALL');
  expect(canonicalJson(snapshot())===canonicalJson(empty)).toBe(true);
  const raw=await fixture(name,3),credential=raw.bundle.credentials.pop()!;
  raw.config.static_credential_refs=[];
  raw.bundle.retired_credentials=[{...credential,agent_id:'agent_research',retired_at_epoch:2}];
  raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
  const retired=await prepareBootstrap(raw.config,raw.bundle,'ws_example');
  expect((await object.installOperation(context(),retired)).ok).toBe(true);
  const before=snapshot();expect(before.map(x=>x.length)).toEqual([1,1,1,1,1,1]);
  const next=structuredClone(raw);next.config.config_epoch=4;next.bundle.config_epoch=4;
  next.config.static_participants=[];next.config.workspace_policies[0].notification_destinations=[];next.bundle.retired_credentials=[];
  next.bundle.config_digest=await sha256(canonicalJson(next.config));
  const dropped=await prepareBootstrap(next.config,next.bundle,'ws_example');
  expect(await object.installOperation(context(3,retired.installationDigest,'drop_participant'),dropped)).toEqual({ok:false,code:'INVALID_INSTALL'});
  expect(canonicalJson(snapshot())===canonicalJson(before)).toBe(true);
  next.config.static_participants=raw.config.static_participants;next.bundle.retired_credentials=raw.bundle.retired_credentials;
  next.bundle.config_digest=await sha256(canonicalJson(next.config));
  const retained=await prepareBootstrap(next.config,next.bundle,'ws_example');
  expect((await object.installOperation(context(3,retired.installationDigest,'retained_history'),retained)).ok).toBe(true);
  expect(snapshot().map(x=>x.length)).toEqual([1,1,1,1,2,2]);
  expect(state.storage.sql.exec('SELECT enabled,retired_at_epoch FROM native_credentials').one()).toEqual({enabled:0,retired_at_epoch:2});
 });
});
