import {resetLegacyAuthorityFixture} from '../helpers/legacy-migration-fixture';
import { it,expect,beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject,evictDurableObject } from 'cloudflare:test';
import { control,installed,login,request } from '../helpers/auth';
import { operator,prepared } from '../helpers/environment';
beforeEach(async()=>{await control('reset');});
it('empty_store_never_bootstraps_admin',async()=>{
 const stub=env.WORKSPACE.getByName('empty-auth');expect((await stub.fetch(request('session'))).status).toBe(401);
 expect(await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT COUNT(*) AS n FROM human_grants').one().n)).toBe(0);
});
it('provider_allowed_but_no_workspace_grant_is_denied',async()=>{
 const {stub}=await installed('ungranted');expect((await login(stub,'ungranted')).response.status).toBe(403);
});
it('protocol_session_and_logout_require_no_domain_read_scope',async()=>{
 const {stub}=await installed('profile-only',['profile:edit']),result=await login(stub);
 expect(result.response.status).toBe(302);
 const response=await stub.fetch(request('session','GET',undefined,result.cookie));expect(response.status).toBe(200);
 const {data}=await response.json() as {data:{csrf_token:string;actor:{principal_id:string}}};expect(data.actor.principal_id).toBe('human_operator');
 const logout=await stub.fetch(request('logout','POST',{},result.cookie,{'x-csrf-token':data.csrf_token}));expect(logout.status).toBe(200);expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
 expect((await stub.fetch(request('session','GET',undefined,result.cookie))).status).toBe(401);
});
it('csrf_requires_origin_and_session_token',async()=>{
 const {stub}=await installed('csrf'),one=await login(stub),two=await login(stub);
 const session=await (await stub.fetch(request('session','GET',undefined,one.cookie))).json() as {data:{csrf_token:string}};
 for(const headers of ([{},{'x-csrf-token':'wrong'},{'x-csrf-token':session.data.csrf_token,origin:'https://evil.example.invalid'},{'x-csrf-token':session.data.csrf_token,origin:''}] as Record<string,string>[]))expect((await stub.fetch(request('logout','POST',{},one.cookie,headers))).status).toBe(403);
 expect((await stub.fetch(request('logout','POST',{},two.cookie,{'x-csrf-token':session.data.csrf_token}))).status).toBe(403);
 expect((await stub.fetch(request('session','GET',undefined,one.cookie))).status).toBe(200);
});
it('membership_removal_invalidates_live_session',async()=>{
 const {stub}=await installed('membership'),result=await login(stub);
 await runInDurableObject(stub,(_o,state)=>{state.storage.sql.exec('UPDATE human_grants SET enabled=0');});
 expect((await stub.fetch(request('session','GET',undefined,result.cookie))).status).toBe(401);
});
it('higher_epoch_invalidates_but_identical_install_replay_preserves_session',async()=>{
 const name='session-epoch',{stub,config}=await installed(name),result=await login(stub);
 await stub.reconcileConfiguration(operator(1,config.installationDigest),config);const live=await stub.fetch(request('session','GET',undefined,result.cookie));expect(live.status).toBe(200);await live.text();
 await stub.reconcileConfiguration(operator(1,config.installationDigest),await prepared(name,2));const denied=await stub.fetch(request('session','GET',undefined,result.cookie));expect(denied.status).toBe(401);await denied.text();
 await result.response.text();// JOSE's documented 5s abort signal can outlive its completed JWKS fetch.
 await evictDurableObject(stub);expect((await stub.fetch(request('session','GET',undefined,result.cookie))).status).toBe(401);
},10000);
it('rejects_mixed_credentials_cross_origin_and_workspace_cookie',async()=>{
 const {stub}=await installed('lanes'),result=await login(stub);
 expect((await stub.fetch(request('session','GET',undefined,result.cookie,{authorization:'Bearer invalid'}))).status).toBe(400);
 const foreign=await stub.fetch(request('session','GET',undefined,result.cookie,{origin:'https://evil.example.invalid'}));expect(foreign.status).toBe(403);expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
 expect((await stub.fetch(new Request('https://hub.example.invalid/v2/workspaces/ws_other/auth/session',{headers:{cookie:result.cookie}}))).status).toBe(401);
 const allowed=await stub.fetch(request('session','GET',undefined,result.cookie,{origin:'https://hub.example.invalid'}));expect(allowed.headers.get('access-control-allow-origin')).toBe('https://hub.example.invalid');expect(allowed.headers.get('access-control-allow-credentials')).toBe('true');
});

import { FOUNDATION_SQL } from '../../src/storage/migrations';
import { sha256 } from '../../src/config/bootstrap';
import { resolveActor,authorize } from '../../src/auth/authorize';
import { verifyHumanSession,revokeSession } from '../../src/auth/sessions';
import { withTransaction } from '../../src/storage/transaction';
import { systemClock,systemEntropy } from '../../src/workspace/context';
import { afterEach,vi } from 'vitest';
afterEach(()=>vi.useRealTimers());
it('v1_sessions_and_attempts_migrate_invalid_and_remain_invalid_after_restart',async()=>{
 const name='legacy-session',{stub}=await installed(name),token='A'.repeat(43),digest=await sha256(token),now=Date.now();
 await runInDurableObject(stub,async(_o,state)=>{
  await resetLegacyAuthorityFixture(state.storage,1);
  state.storage.sql.exec('INSERT INTO sessions (id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)','legacy','ws_example','human_operator',digest,'','https://identity.example.invalid','synthetic-subject',now,now+60000);
  state.storage.sql.exec('INSERT INTO login_attempts (id,workspace_id,state_digest,nonce,pkce_verifier,cookie_digest,redirect_uri,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)','legacy','ws_example',digest,'unused','unused',digest,'https://hub.example.invalid/v2/workspaces/ws_example/auth/callback',now,now+60000);
 });
 await evictDurableObject(stub);
 const migrated=await runInDurableObject(stub,(_o,state)=>({session:state.storage.sql.exec('SELECT auth_epoch FROM sessions').one().auth_epoch,attempt:state.storage.sql.exec('SELECT auth_epoch,return_path FROM login_attempts').one(),versions:state.storage.sql.exec('SELECT version FROM schema_migrations ORDER BY version').toArray()}));
 expect(migrated).toEqual({session:0,attempt:{auth_epoch:0,return_path:'/'},versions:[{version:1},{version:2},{version:3},{version:4},{version:5},{version:6},{version:7},{version:8},{version:9},{version:10},{version:11},{version:12},{version:13},{version:14}]});
 const denied=await stub.fetch(request('session','GET',undefined,'cfhub_session='+token));expect(denied.status).toBe(401);await denied.text();
 const oldAttempt=await stub.fetch(request('callback?code=unused&state='+token,'GET',undefined,'cfhub_login='+token));expect(oldAttempt.status).toBe(401);await oldAttempt.text();
 await evictDurableObject(stub);
 expect(await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT auth_epoch FROM sessions').one().auth_epoch)).toBe(0);
});
it('provider_expiry_bounds_session_and_no_refresh_extends_it',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.parse('2026-10-23T00:00:00Z'));
 const {stub}=await installed('expiry'),result=await login(stub,'short_proof');expect(result.response.status).toBe(302);
 const response=await stub.fetch(request('session','GET',undefined,result.cookie));const data=await response.json() as {data:{expires_at:string}};expect(Date.parse(data.data.expires_at)).toBe(Date.now()+2000);
 vi.setSystemTime(Date.now()+2000);expect((await stub.fetch(request('session','GET',undefined,result.cookie))).status).toBe(401);
});
it('provider_outage_denies_new_login_but_keeps_current_proven_session',async()=>{
 const {stub}=await installed('outage'),result=await login(stub);await control('mode','discovery-down');
 expect((await stub.fetch(request('start','POST',{return_path:'/'}))).status).toBe(503);
 expect((await stub.fetch(request('session','GET',undefined,result.cookie))).status).toBe(200);
});
it('resolved_identity_and_actor_do_not_survive_logout_or_membership_removal',async()=>{
 const name='reread',{stub}=await installed(name),result=await login(stub);
 await runInDurableObject(stub,async(_o,state)=>{
  const workspace={storage:state.storage,workspaceId:'ws_example',objectName:name,secrets:env as unknown as Record<string,unknown>,clock:systemClock,entropy:systemEntropy};
  const identity=await verifyHumanSession(workspace,result.cookie,Date.now());
  const actor=withTransaction(state.storage,tx=>resolveActor(tx,identity,Date.now()));
  withTransaction(state.storage,tx=>authorize(tx,actor,'workspace:read',undefined,Date.now()));
  withTransaction(state.storage,tx=>revokeSession(tx,actor.sessionId!,Date.now()));
  expect(()=>withTransaction(state.storage,tx=>resolveActor(tx,identity,Date.now()))).toThrow('UNAUTHENTICATED');
  expect(()=>withTransaction(state.storage,tx=>authorize(tx,actor,'workspace:read',undefined,Date.now()))).toThrow('UNAUTHENTICATED');
 });
});

import { authRoutes } from '../../src/http/auth-routes';
it('session_is_rechecked_after_csrf_crypto_await',async()=>{
 const name='csrf-interleaving',{stub}=await installed(name),result=await login(stub);
 const status=await runInDurableObject(stub,async(_o,state)=>{
  const secrets=new Proxy(env as unknown as Record<string,unknown>,{get(target,key){if(key==='CSRF_SECRET')state.storage.sql.exec('UPDATE sessions SET revoked_at=?',Date.now());return Reflect.get(target,key);}});
  const response=await authRoutes(request('session','GET',undefined,result.cookie),{storage:state.storage,workspaceId:'ws_example',objectName:name,secrets,clock:systemClock,entropy:systemEntropy});await response.text();return response.status;
 });expect(status).toBe(401);
});
it('auth_failures_do_not_create_workspace_events_under_invented_actors',async()=>{
 const {stub}=await installed('no-auth-events');
 const count=()=>runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT COUNT(*) AS n FROM events').one().n);
 const before=await count();expect((await login(stub,'ungranted')).response.status).toBe(403);expect(await count()).toBe(before);
});

import { csrfToken } from '../../src/auth/csrf';
import { secret } from '../../src/auth/context';
it('csrf_secret_requires_independent_strength_without_inventing_provider_secret_length_policy',async()=>{
 const name='secret-policy',{stub}=await installed(name),result=await login(stub);expect(result.response.status).toBe(302);
 await runInDurableObject(stub,async(_o,state)=>{
  const workspace={storage:state.storage,workspaceId:'ws_example',objectName:name,secrets:{CSRF_SECRET:'x'.repeat(20),provider:'short'},clock:systemClock,entropy:systemEntropy};
  const session=state.storage.sql.exec('SELECT * FROM sessions').one() as unknown as import('../../src/auth/authorize').SessionRecord;
  let denied=false;try{await csrfToken(workspace,session);}catch(error){denied=(error as Error).message==='AUTH_UNAVAILABLE';}expect(denied).toBe(true);
  expect(secret(workspace,'provider')==='short').toBe(true);
 });
});
