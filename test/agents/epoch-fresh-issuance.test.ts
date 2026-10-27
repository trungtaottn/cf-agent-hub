import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {settingsFixture,human,owned,commandContext} from '../helpers/settings';
import {fixture} from '../helpers/environment';
import {canonicalJson,sha256,prepareBootstrap,installConfiguration} from '../../src/config/bootstrap';
import {withTransaction} from '../../src/storage/transaction';
import {executeCommand} from '../../src/workspace/commands';
import {createAgentCommand} from '../../src/agents/commands';
import {issueCredentialCommand} from '../../src/auth/native-credentials';
import {verifyNativeCredential} from '../../src/auth/native';
it('higher_epoch_revokes_old_token_but_current_human_can_issue_for_preserved_identity',async()=>{
 const name='identity-fresh-after-epoch',{stub}=await settingsFixture(name),raw=await fixture(name,2);
 raw.config.human_grants[0].scopes=['agents:manage','credentials:manage','messages:read'];raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 const next=await prepareBootstrap(raw.config,raw.bundle,'ws_example');
 await runInDurableObject(stub,async(_o,state)=>{
  const identity=human(state.storage),workspace=owned(state.storage,name),agent={display_name:'Preserved',description:'',work_role_ids:[]};
  state.storage.sql.exec('UPDATE human_grants SET scopes_json=?',JSON.stringify(raw.config.human_grants[0].scopes));
  executeCommand(await commandContext(state.storage,name,agent,'agent'),identity,createAgentCommand('agent_preserved'),agent);
  const body={agent_id:'agent_preserved',label:'Epoch fixture',scopes:['messages:read'] as ['messages:read'],project_ids:null,expires_at:new Date(Date.now()+60000).toISOString()};
  const oldToken='A'.repeat(43),freshToken='B'.repeat(42)+'A';
  executeCommand(await commandContext(state.storage,name,body,'old'),identity,issueCredentialCommand({credentialId:'credential_old_epoch',tokenSha256:await sha256(oldToken)}),body);
  expect((await verifyNativeCredential(workspace,oldToken,Date.now())).kind).toBe('agent');
  withTransaction(state.storage,tx=>installConfiguration(tx,next.config,next,Date.now()));
  await expect(verifyNativeCredential(workspace,oldToken,Date.now())).rejects.toThrow();
  expect(()=>executeCommand({workspace,requestId:'stale',idempotencyKey:'old',fingerprint:'a'.repeat(64),admissionEpoch:1,admissionGeneration:0},identity,issueCredentialCommand({credentialId:'unused',tokenSha256:'e'.repeat(64)}),body)).toThrow();
  // A new verified login would create this current-epoch session; the old session
  // remains invalid. This SQL fixture owns only session evidence, not a second auth path.
  state.storage.sql.exec("INSERT INTO sessions SELECT 'session_current',workspace_id,principal_id,'fresh_session_digest','fresh_csrf_digest',issuer,subject,created_at,expires_at,NULL,2 FROM sessions WHERE id='session_settings'");
  const current={...identity,sessionId:'session_current'};
  const result=executeCommand(await commandContext(state.storage,name,body,'fresh'),current,issueCredentialCommand({credentialId:'credential_fresh_epoch',tokenSha256:await sha256(freshToken)}),body);
  expect(result.data).toMatchObject({token:null,revealed:false,credential:{agent_id:'agent_preserved'}});
  expect(await verifyNativeCredential(workspace,freshToken,Date.now())).toMatchObject({credentialId:'credential_fresh_epoch'});
  expect(state.storage.sql.exec("SELECT config_epoch,origin,status FROM static_agents WHERE agent_id='agent_preserved'").one()).toEqual({config_epoch:2,origin:'human_managed',status:'active'});
 });
});
