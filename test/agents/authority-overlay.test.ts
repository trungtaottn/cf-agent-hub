import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {settingsFixture} from '../helpers/settings';
import {fixture} from '../helpers/environment';
import {prepareBootstrap,installConfiguration,restoreAuthorityOverlay} from '../../src/config/bootstrap';
import {withTransaction,type WorkspaceTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {participantCanReadMessages} from '../../src/messages/references';
const digest='a'.repeat(64),workspaceId='ws_example';
const identity={kind:'agent' as const,workspaceId,credentialId:'dynamic_credential',tokenDigest:digest};
function seed(tx:WorkspaceTransaction,now:number,staticAgent=false){
 tx.exec(`UPDATE human_grants SET scopes_json='["messages:read","credentials:manage"]'`);
 if(!staticAgent)tx.exec("INSERT INTO static_agents(agent_id,workspace_id,display_name,config_epoch,origin,created_at,updated_at) VALUES ('dynamic_agent',?,'Synthetic',1,'human_managed',?,?)",[workspaceId,now,now]);
 tx.exec("INSERT INTO native_credentials(credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,origin,created_at,issued_by_principal_id) VALUES ('dynamic_credential',?,?,?,'[\"messages:read\"]','null',?,1,1,'human_managed',?,'human_operator')",[workspaceId,staticAgent?'agent_research':'dynamic_agent',digest,now+100000,now]);
 tx.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES ('synthetic_runtime',?,?,'dynamic_credential',1,?,1,'Synthetic','online',?,?,?)",[workspaceId,staticAgent?'agent_research':'dynamic_agent','b'.repeat(64),now,now,now+90000]);
}
it('dynamic_authority_is_bounded_by_current_issuer_and_native_policy',async()=>{
 const {stub}=await settingsFixture('identity-issuer-ceiling');
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  const now=Date.now();seed(tx,now);expect(resolveActor(tx,identity,now).agentId).toBe('dynamic_agent');
  tx.exec('UPDATE human_grants SET enabled=0');expect(()=>resolveActor(tx,identity,now)).toThrow();
  tx.exec("UPDATE human_grants SET enabled=1,project_ids_json='[]'");expect(()=>resolveActor(tx,identity,now)).toThrow();
  tx.exec("UPDATE human_grants SET project_ids_json='null'; UPDATE native_credentials SET scopes_json='[\"agents:manage\"]' WHERE credential_id='dynamic_credential'");expect(()=>resolveActor(tx,identity,now)).toThrow();
 }));
});
it('dynamic_adoption_requires_one_live_static_ceiling_including_expiry',async()=>{
 const {stub}=await settingsFixture('identity-static-ceiling');
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  const now=Date.now();seed(tx,now,true);expect(resolveActor(tx,identity,now).agentId).toBe('agent_research');
  tx.exec("UPDATE native_credentials SET expires_at=? WHERE origin='operator_static'",[now+99999]);expect(()=>resolveActor(tx,identity,now)).toThrow();
  tx.exec("UPDATE native_credentials SET expires_at=?,revoked_at=? WHERE origin='operator_static'",[now+200000,now]);expect(()=>resolveActor(tx,identity,now)).toThrow();
 }));
});
it('archived_or_locally_revoked_static_authority_is_denied_in_auth_and_background',async()=>{
 const {stub}=await settingsFixture('identity-static-revocation');
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  const now=Date.now(),row=tx.one<{token_sha256:string}>('SELECT token_sha256 FROM native_credentials')!;
  const proof={...identity,credentialId:'credential_research_1',tokenDigest:row.token_sha256},participant={kind:'agent' as const,id:'agent_research'};
  expect(resolveActor(tx,proof,now).agentId).toBe(participant.id);expect(participantCanReadMessages(tx,workspaceId,participant,[],now)).toBe(true);
  tx.exec('UPDATE native_credentials SET revoked_at=?',[now]);expect(()=>resolveActor(tx,proof,now)).toThrow();expect(participantCanReadMessages(tx,workspaceId,participant,[],now)).toBe(false);
  tx.exec("UPDATE native_credentials SET revoked_at=NULL; UPDATE static_agents SET status='archived'");expect(()=>resolveActor(tx,proof,now)).toThrow();expect(participantCanReadMessages(tx,workspaceId,participant,[],now)).toBe(false);
 }));
});
it('epoch_overlay_preserves_identity_history_revokes_dynamic_authority_and_is_atomic',async()=>{
 const name='identity-epoch-overlay',{stub}=await settingsFixture(name),raw=await fixture(name,2),next=await prepareBootstrap(raw.config,raw.bundle,workspaceId);
 await runInDurableObject(stub,(_o,state)=>{
  const now=Date.now();withTransaction(state.storage,tx=>{seed(tx,now);tx.exec("UPDATE static_agents SET status='archived' WHERE origin='operator_static'");tx.exec("UPDATE native_credentials SET revoked_at=? WHERE origin='operator_static'",[now]);});
  const before=state.storage.sql.exec('SELECT * FROM native_credentials').toArray();
  expect(()=>withTransaction(state.storage,tx=>{installConfiguration(tx,next.config,next,now);throw Error('synthetic_abort');})).toThrow('synthetic_abort');
  expect(state.storage.sql.exec('SELECT * FROM native_credentials').toArray()).toEqual(before);
  withTransaction(state.storage,tx=>installConfiguration(tx,next.config,next,now));
  expect(state.storage.sql.exec("SELECT config_epoch,status FROM static_agents WHERE agent_id='dynamic_agent'").one()).toEqual({config_epoch:2,status:'active'});
  expect(state.storage.sql.exec("SELECT status FROM static_agents WHERE origin='operator_static'").one()).toEqual({status:'archived'});
  expect(state.storage.sql.exec("SELECT enabled,config_epoch,revoked_at FROM native_credentials WHERE origin='human_managed'").one()).toEqual({enabled:0,config_epoch:1,revoked_at:now});
  expect(state.storage.sql.exec('SELECT revoked_at FROM runtimes').one()).toEqual({revoked_at:now});
  expect(state.storage.sql.exec("SELECT revoked_at FROM native_credentials WHERE origin='operator_static'").one()).toEqual({revoked_at:now});
 });
});
it('same_epoch_install_is_noop_but_restore_overlay_revokes_dynamic_rows',async()=>{
 const {stub,input}=await settingsFixture('identity-same-epoch');
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  const now=Date.now();seed(tx,now);installConfiguration(tx,input.config,input,now);
  expect(resolveActor(tx,identity,now).agentId).toBe('dynamic_agent');
  tx.exec("UPDATE workspace_metadata SET admission_state='maintenance'");restoreAuthorityOverlay(tx,input,now);
  expect(tx.one('SELECT enabled,revoked_at FROM native_credentials WHERE origin=\'human_managed\'')).toEqual({enabled:0,revoked_at:now});
  expect(tx.one('SELECT revoked_at FROM runtimes')).toEqual({revoked_at:now});
 }));
});
it('partial_static_grants_are_never_unioned_for_dynamic_adoption_or_dispatch',async()=>{
 const {stub}=await settingsFixture('identity-nonunion-ceiling');
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  const now=Date.now();seed(tx,now,true);
  tx.exec(`UPDATE human_grants SET scopes_json='["messages:read","messages:send","credentials:manage"]'`);
  tx.exec(`UPDATE native_credentials SET scopes_json='["messages:read","messages:send"]' WHERE origin='human_managed'`);
  tx.exec(`UPDATE native_credentials SET scopes_json='["messages:read"]' WHERE origin='operator_static'`);
  tx.exec(`INSERT INTO native_credentials(credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch) VALUES ('static_second','ws_example','agent_research',?,'["messages:send"]','null',?,1,1)`,['c'.repeat(64),now+200000]);
  expect(()=>resolveActor(tx,identity,now)).toThrow();
  expect(participantCanReadMessages(tx,workspaceId,{kind:'agent',id:'agent_research'},[],now,'messages:send')).toBe(false);
  tx.exec(`UPDATE native_credentials SET scopes_json='["messages:read","messages:send"]' WHERE credential_id='static_second'`);
  expect(resolveActor(tx,identity,now).scopes.has('messages:send')).toBe(true);
  expect(participantCanReadMessages(tx,workspaceId,{kind:'agent',id:'agent_research'},[],now,'messages:send')).toBe(true);
 }));
});
it('current_issuer_manage_scope_epoch_and_projects_are_independent_dynamic_ceilings',async()=>{
 const {stub}=await settingsFixture('identity-issuer-changes');
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  const now=Date.now();seed(tx,now);
  tx.exec(`UPDATE native_credentials SET project_ids_json='[]' WHERE origin='human_managed'`);
  tx.exec(`UPDATE human_grants SET project_ids_json='[]'`);expect(resolveActor(tx,identity,now).projectIds).toEqual([]);
  tx.exec(`UPDATE native_credentials SET project_ids_json='null' WHERE origin='human_managed'`);expect(()=>resolveActor(tx,identity,now)).toThrow();
  tx.exec(`UPDATE human_grants SET project_ids_json='null',scopes_json='["messages:read"]'`);expect(()=>resolveActor(tx,identity,now)).toThrow();
  tx.exec(`UPDATE human_grants SET scopes_json='["messages:read","credentials:manage"]',config_epoch=2`);expect(()=>resolveActor(tx,identity,now)).toThrow();
  tx.exec(`UPDATE human_grants SET config_epoch=1`);expect(resolveActor(tx,identity,now).agentId).toBe('dynamic_agent');
  tx.exec(`UPDATE native_credentials SET issued_by_principal_id='missing' WHERE origin='human_managed'`);expect(()=>resolveActor(tx,identity,now)).toThrow();
 }));
});
it('epoch_metadata_change_increments_agent_version_without_resurrecting_local_revocation',async()=>{
 const name='identity-operator-version',{stub}=await settingsFixture(name),raw=await fixture(name,2);
 raw.config.static_participants[0].display_name='Updated by operator';
 const {canonicalJson,sha256}=await import('../../src/config/bootstrap');raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 const input=await prepareBootstrap(raw.config,raw.bundle,workspaceId);
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  const now=Date.now(),before=tx.one<{token_sha256:string}>('SELECT token_sha256 FROM native_credentials')!;
  tx.exec('UPDATE native_credentials SET revoked_at=?',[now]);
  installConfiguration(tx,input.config,input,now);
  expect(tx.one('SELECT display_name,agent_version FROM static_agents')).toEqual({display_name:'Updated by operator',agent_version:2});
  expect(()=>resolveActor(tx,{...identity,credentialId:'credential_research_1',tokenDigest:before.token_sha256},now)).toThrow();
  expect(participantCanReadMessages(tx,workspaceId,{kind:'agent',id:'agent_research'},[],now)).toBe(false);
 }));
});
it('epoch_overlay_keeps_archived_dynamic_identity_and_never_reclassifies_it',async()=>{
 const name='identity-archived-dynamic',{stub}=await settingsFixture(name),raw=await fixture(name,2),input=await prepareBootstrap(raw.config,raw.bundle,workspaceId);
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  const now=Date.now();seed(tx,now);tx.exec(`UPDATE static_agents SET status='archived' WHERE origin='human_managed'`);
  installConfiguration(tx,input.config,input,now);
  expect(tx.one(`SELECT origin,status,config_epoch FROM static_agents WHERE agent_id='dynamic_agent'`)).toEqual({origin:'human_managed',status:'archived',config_epoch:1});
  expect(()=>resolveActor(tx,identity,now)).toThrow();
 }));
});
it('operator_credential_mutation_invalidates_stale_expected_version',async()=>{
 const name='identity-static-version',{stub}=await settingsFixture(name),raw=await fixture(name,2);
 raw.config.static_credential_refs[0].scopes=['messages:read'];
 const {canonicalJson,sha256}=await import('../../src/config/bootstrap');raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 const input=await prepareBootstrap(raw.config,raw.bundle,workspaceId);
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  installConfiguration(tx,input.config,input,Date.now());
  expect(tx.one('SELECT credential_version,scopes_json FROM native_credentials')).toEqual({credential_version:2,scopes_json:'["messages:read"]'});
 }));
});
it('operator_retirement_advances_credential_version_once',async()=>{
 const name='identity-static-retirement-version',{stub}=await settingsFixture(name),raw=await fixture(name,2);
 const ref=raw.config.static_credential_refs[0],hash=raw.bundle.credentials[0].token_sha256;
 raw.config.static_credential_refs=[];raw.bundle.credentials=[];raw.bundle.retired_credentials=[{workspace_id:workspaceId,agent_id:ref.agent_id,credential_id:ref.credential_id,token_sha256:hash,retired_at_epoch:2}];
 const {canonicalJson,sha256}=await import('../../src/config/bootstrap');raw.bundle.config_digest=await sha256(canonicalJson(raw.config));const input=await prepareBootstrap(raw.config,raw.bundle,workspaceId);
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  installConfiguration(tx,input.config,input,Date.now());
  expect(tx.one('SELECT credential_version,retired_at_epoch FROM native_credentials')).toEqual({credential_version:2,retired_at_epoch:2});
  installConfiguration(tx,input.config,input,Date.now());
  expect(tx.one('SELECT credential_version FROM native_credentials')).toEqual({credential_version:2});
 }));
});
