import {identityFixture as settingsFixture} from '../helpers/identity';
import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {human,commandContext} from '../helpers/settings';
import {executeCommand} from '../../src/workspace/commands';
import {revokeCredentialCommand} from '../../src/auth/native-credentials';
it('revoke_replay_does_not_disclose_original_grant_after_current_ceiling_narrows',async()=>{
 const {stub,name}=await settingsFixture('identity-revoke-replay-ceiling');
 await runInDurableObject(stub,async(_o,state)=>{
  const identity=human(state.storage),body={expected_credential_version:1,reason:'Synthetic revoke'};
  state.storage.sql.exec(`UPDATE human_grants SET scopes_json='["credentials:manage","messages:read","messages:send"]'`);
  state.storage.sql.exec(`UPDATE native_credentials SET scopes_json='["messages:read","messages:send"]'`);
  const ctx=await commandContext(state.storage,name,body,'revoke-ceiling'),command=revokeCredentialCommand('credential_research_1');
  expect(executeCommand(ctx,identity,command,body).data.scopes).toEqual(['messages:read','messages:send']);
  const retained=state.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray();
  // Operator narrowed the persisted static grant and caller ceiling; the immutable
  // original outcome is broader, even though the current resource is visible.
  state.storage.sql.exec(`UPDATE human_grants SET scopes_json='["credentials:manage","messages:read"]'`);
  state.storage.sql.exec(`UPDATE native_credentials SET scopes_json='["messages:read"]'`);
  expect(()=>executeCommand(ctx,identity,command,body)).toThrowError(expect.objectContaining({status:403}));
  expect(state.storage.sql.exec('SELECT * FROM idempotency_outcomes').toArray()).toEqual(retained);
  expect(state.storage.sql.exec('SELECT credential_version FROM native_credentials').one()).toEqual({credential_version:2});
 });
});
