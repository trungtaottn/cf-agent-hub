import { it,expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { fixture,operator } from '../helpers/environment';
import { prepareBootstrap,sha256,canonicalJson,installConfiguration } from '../../src/config/bootstrap';
import { withTransaction } from '../../src/storage/transaction';
import { resolveActor,authorize } from '../../src/auth/authorize';
import type { VerifiedIdentity } from '../../src/workspace/context';
const token='A'.repeat(43);
async function installed(name:string) {
 const input=await fixture(name); input.bundle.credentials[0].token_sha256=await sha256(token);
 const prepared=await prepareBootstrap(input.config,input.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);
 await stub.reconcileConfiguration(operator(),prepared);
 return {stub,input,prepared,identity:{kind:'agent',workspaceId:'ws_example',credentialId:'credential_research_1',tokenDigest:await sha256(token)} as VerifiedIdentity};
}
it('names_and_roles_do_not_grant_scope',async()=>{
 const {stub,identity}=await installed('native-names');
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  tx.exec("UPDATE static_agents SET display_name='Administrator'");
  tx.exec("UPDATE native_credentials SET scopes_json='[\"messages:read\"]'");
  const actor=resolveActor(tx,identity,Date.now());
  expect(actor.principalId).toBe('agent_research');expect([...actor.scopes]).toEqual(['messages:read']);
  expect(()=>authorize(tx,actor,'messages:read')).not.toThrow();
  for(const scope of ['messages:send','profile:edit','runtime:execute'])expect(()=>authorize(tx,actor,scope)).toThrow();
 }));
});
it('wrong_workspace_or_expired_token_denied',async()=>{
 const {stub,identity}=await installed('native-expiry');
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  expect(()=>resolveActor(tx,{...identity,workspaceId:'ws_foreign'},Date.now())).toThrow();
  const expiry=tx.one<{expires_at:number}>('SELECT expires_at FROM native_credentials')!.expires_at;
  expect(()=>resolveActor(tx,identity,expiry)).toThrow();
  expect(()=>resolveActor(tx,identity,expiry-1)).not.toThrow();
 }));
});
it('replay_after_revocation_denied',async()=>{
 const {stub,identity}=await installed('native-replay');
 await runInDurableObject(stub,(_o,state)=>{
  const actor=withTransaction(state.storage,tx=>resolveActor(tx,identity,Date.now()));
  withTransaction(state.storage,tx=>tx.exec('UPDATE native_credentials SET enabled=0'));
  expect(()=>withTransaction(state.storage,tx=>authorize(tx,actor,'messages:read'))).toThrow();
 });
});
it('same_principal_second_credential_replay_requires_current_scope_and_project',async()=>{
 const name='native-second',{stub,input,prepared,identity}=await installed(name),secondToken='C'.repeat(42)+'A';
 const next=structuredClone(input);next.config.config_epoch=2;next.bundle.config_epoch=2;
 next.config.static_credential_refs.push({...next.config.static_credential_refs[0],credential_id:'credential_second',scopes:['messages:read'],project_ids:['project_a']});
 next.bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_second',token_sha256:await sha256(secondToken)});
 next.bundle.config_digest=await sha256(canonicalJson(next.config));
 await stub.reconcileConfiguration(operator(1,prepared.installationDigest),await prepareBootstrap(next.config,next.bundle,'ws_example'));
 const {verifyNativeCredential}=await import('../../src/auth/native');
 await runInDurableObject(stub,async(_o,state)=>{
  const workspace={storage:state.storage,workspaceId:'ws_example',objectName:name,secrets:{},clock:{nowMs:()=>Date.now()},entropy:{bytes:(n:number)=>crypto.getRandomValues(new Uint8Array(n))}};
  const second=await verifyNativeCredential(workspace,secondToken,Date.now());
  withTransaction(state.storage,tx=>{
   const broad=resolveActor(tx,identity,Date.now()),narrow=resolveActor(tx,second,Date.now());
   expect(broad.principalId).toBe(narrow.principalId);expect(broad.credentialId===narrow.credentialId).toBe(false);
   expect(()=>authorize(tx,broad,'messages:send',{kind:'thread',id:'thread_a',projectId:'project_a'})).not.toThrow();
   expect(()=>authorize(tx,narrow,'messages:read',{kind:'thread',id:'thread_a',projectId:'project_a'})).not.toThrow();
   expect(()=>authorize(tx,narrow,'messages:read',{kind:'thread',id:'thread_b',projectId:'project_b'})).toThrow();
   expect(()=>authorize(tx,narrow,'messages:send',{kind:'thread',id:'thread_a',projectId:'project_a'})).toThrow();
   tx.exec("UPDATE native_credentials SET project_ids_json='[]' WHERE credential_id='credential_second'");
   expect(()=>authorize(tx,narrow,'messages:read',{kind:'thread',id:'thread_a',projectId:'project_a'})).toThrow();
  });
 });
});
it('old_worker_epoch_cannot_restore_revoked_credential',async()=>{
 const {stub,input,prepared,identity}=await installed('native-old');
 const next=structuredClone(input);next.config.config_epoch=2;next.bundle.config_epoch=2;next.config.static_credential_refs[0].enabled=false;
 next.bundle.config_digest=await sha256(canonicalJson(next.config));
 const latest=await prepareBootstrap(next.config,next.bundle,'ws_example');
 await stub.reconcileConfiguration(operator(1,prepared.installationDigest),latest);
 await runInDurableObject(stub,async(object,state)=>{
  await expect(object.reconcileConfiguration(operator(2,latest.installationDigest),prepared)).rejects.toThrow('STALE_EPOCH');
  expect(()=>withTransaction(state.storage,tx=>resolveActor(tx,identity,Date.now()))).toThrow();
  // Captured older domain state is not authority: latest ledger overlay remains disabled.
  withTransaction(state.storage,tx=>tx.exec("INSERT INTO threads (id,workspace_id,created_at,subject) VALUES ('old_thread','ws_example',1,'captured')"));
  expect(()=>withTransaction(state.storage,tx=>resolveActor(tx,identity,Date.now()))).toThrow();
 });
});
it('native_bearer_preparation_uses_actual_digest_and_current_authority',async()=>{
 const {verifyNativeCredential}=await import('../../src/auth/native');
 const {stub}=await installed('native-proof');
 await runInDurableObject(stub,async(_o,state)=>{
  const workspace={storage:state.storage,workspaceId:'ws_example',objectName:'native-proof',secrets:{},clock:{nowMs:()=>Date.now()},entropy:{bytes:(n:number)=>crypto.getRandomValues(new Uint8Array(n))}};
  const proof=await verifyNativeCredential(workspace,token,Date.now());
  expect(proof.kind).toBe('agent');
  for(const bearer of ['B'.repeat(43),token+'=',token.slice(1),'', 'Bearer '+token])await expect(verifyNativeCredential(workspace,bearer,Date.now())).rejects.toThrow();
  await expect(verifyNativeCredential({...workspace,workspaceId:'ws_foreign'},token,Date.now())).rejects.toThrow();
  withTransaction(state.storage,tx=>tx.exec('UPDATE native_credentials SET enabled=0'));
  expect(()=>withTransaction(state.storage,tx=>resolveActor(tx,proof,Date.now()))).toThrow();
  await expect(verifyNativeCredential(workspace,token,Date.now())).rejects.toThrow();
 });
});
it('no_runtime_authority_from_message_bearer',async()=>{
 const {stub,identity}=await installed('native-runtime');
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  const actor=resolveActor(tx,identity,Date.now());expect(actor.runtimeId).toBeNull();
  expect(()=>authorize(tx,actor,'runtime:execute')).toThrow();
  expect(()=>authorize(tx,{...actor,runtimeId:'readable_runtime'},'messages:send')).toThrow();
 }));
});

it('old_state_current_ledger_overlay_preserves_disabled_credential',async()=>{
 const name='native-ledger-overlay',{stub,input,identity}=await installed(name);
 const latest=structuredClone(input);latest.config.config_epoch=4;latest.bundle.config_epoch=4;latest.config.static_credential_refs[0].enabled=false;
 latest.bundle.config_digest=await sha256(canonicalJson(latest.config));
 const ledger=await prepareBootstrap(latest.config,latest.bundle,'ws_example');
 await runInDurableObject(stub,(_o,state)=>{
  // Synthetic restore boundary only: pause the old snapshot before overlaying reviewed authority.
  withTransaction(state.storage,tx=>{tx.exec("UPDATE workspace_metadata SET admission_state='maintenance'");});
  expect(()=>withTransaction(state.storage,tx=>resolveActor(tx,identity,Date.now()))).toThrow();
  withTransaction(state.storage,tx=>{
   // This whole fixture overlay is atomic; no command can observe old authority reopened.
   tx.exec("UPDATE workspace_metadata SET admission_state='installed'");
   installConfiguration(tx,ledger.config,ledger,Date.now());
   tx.exec("UPDATE workspace_metadata SET admission_state='maintenance'");
  });
  withTransaction(state.storage,tx=>{tx.exec("UPDATE workspace_metadata SET admission_state='installed'");});
  expect(()=>withTransaction(state.storage,tx=>resolveActor(tx,identity,Date.now()))).toThrow();
  expect(state.storage.sql.exec('SELECT config_epoch,enabled FROM native_credentials').one()).toEqual({config_epoch:4,enabled:0});
 });
});
