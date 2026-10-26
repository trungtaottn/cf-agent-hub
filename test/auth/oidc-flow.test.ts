import { it, expect } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { prepared, operator } from '../helpers/environment';
it('installed_human_login_starts_verified_code_flow',async()=>{
 const name='workspace-example';
 await env.WORKSPACE.getByName(name).reconcileConfiguration(operator(),await prepared(name));
 const response=await exports.default.fetch(new Request('https://hub.example.invalid/v2/workspaces/ws_example/auth/start',{method:'POST',headers:{origin:'https://hub.example.invalid','content-type':'application/json'},body:JSON.stringify({return_path:'/overview'})}));
 expect(response.status).toBe(200);
 const result=await response.json() as {data:{authorization_url:string}};
 expect(new URL(result.data.authorization_url).searchParams.get('code_challenge_method')).toBe('S256');
});

import { beforeEach } from 'vitest';
import { runInDurableObject } from 'cloudflare:test';
import { installed,control,start,callback,login,request,cookie } from '../helpers/auth';
beforeEach(async()=>{await control('reset');});
it.each(['signature','wrong_algorithm','unknown_refresh_failed','issuer','audience','extra_audience','azp','nonce','subject','old_iat','invalid_iat','missing_iat','missing_exp','expired','equal_exp_iat','invalid_nbf','unknown_key','jwks-down','jwks-redirect','jwks-oversize'])('rejects_invalid_signature_issuer_audience_and_nonce: %s',async(mode)=>{
 const {stub}=await installed('reject-'+mode);const result=await login(stub,mode);
 expect(result.response.status).toBe(401);expect(Boolean(result.cookie)).toBe(false);
 expect(await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT COUNT(*) AS n FROM sessions').one().n)).toBe(0);
});
// Keep one-second claim boundaries deterministic across signing/JWKS transport.
// A real wall clock can cross into the claimed second before verification.
it.each(['future_iat','future_nbf','normal'])('verifies_claim_time_against_fixed_clock: %s',async(mode)=>{
 const name='fixed-time-'+mode,{stub}=await installed(name),attempt=await start(stub);
 const instant=Date.now();
 const issued=await (await control('issue',{authorization_url:attempt.authorization_url,mode,now:instant})).json() as {code:string};
 const outcome=await runInDurableObject(stub,async(_o,state)=>{
  try {
   await completeLogin({storage:state.storage,workspaceId:'ws_example',objectName:name,secrets:env as unknown as Record<string,unknown>,clock:{nowMs:()=>instant},entropy:systemEntropy},issued.code,new URL(attempt.authorization_url).searchParams.get('state')!,attempt.cookie.split('=')[1]);
   return 'accepted';
  } catch(error) {
   if(!(error instanceof AuthError))throw error;
   expect(error.status).toBe(401);
   return error.code;
  }
 });
 expect(outcome).toBe(mode==='normal'?'accepted':'UNAUTHENTICATED');
 expect(await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT COUNT(*) AS n FROM sessions').one().n)).toBe(mode==='normal'?1:0);
});
it.each(['pin-mismatch','issuer-mismatch','unsupported-auth','unsupported-mode','discovery-redirect','discovery-oversize','discovery-down'])('refuses_unapproved_discovery_before_endpoint_use: %s',async(mode)=>{
 const {stub}=await installed('discovery-'+mode);await control('mode',mode);
 const response=await stub.fetch(request('start','POST',{return_path:'/'}));expect(response.status).toBe(503);
 const trace=await (await control('requests')).json() as {requests:string[]};expect(trace.requests).toEqual(['/.well-known/openid-configuration']);
});
it('trusted_rotation_uses_only_pinned_keys_and_accepts_discovery_basic_default',async()=>{
 const {stub}=await installed('rotation');await control('mode','default-basic');
 expect((await login(stub)).response.status).toBe(302);
 expect((await login(stub,'rotation')).response.status).toBe(302);
 expect((await login(stub,'unknown_key')).response.status).toBe(401);
 expect((await login(stub,'token_key_url')).response.status).toBe(302);
 const trace=await (await control('requests')).json() as {requests:string[]};expect(trace.requests.every(p=>['/.well-known/openid-configuration','/token','/jwks'].includes(p))).toBe(true);
});
it('rejects_expired_state_cookie_mixup_and_callback_replay',async()=>{
 const {stub}=await installed('replay'),first=await start(stub),second=await start(stub);
 expect(first.cookie===second.cookie).toBe(false);expect(new URL(first.authorization_url).searchParams.get('state')===new URL(second.authorization_url).searchParams.get('state')).toBe(false);
 const mismatch=await callback(stub,{...first,cookie:second.cookie});expect(mismatch.response.status).toBe(401);
 const success=await callback(stub,first);expect(success.response.status).toBe(302);
 expect((await stub.fetch(request(success.route,'GET',undefined,first.cookie))).status).toBe(401);
 await runInDurableObject(stub,(_o,state)=>{state.storage.sql.exec('UPDATE login_attempts SET expires_at=created_at+1 WHERE consumed_at IS NULL');});
 expect((await callback(stub,second)).response.status).toBe(401);
});
it('one_concurrent_callback_consumes_the_attempt',async()=>{
 const {stub}=await installed('concurrent'),attempt=await start(stub);
 const results=await Promise.all([callback(stub,attempt),callback(stub,attempt)]);expect(results.map(x=>x.response.status).sort()).toEqual([302,401]);
 expect(await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT COUNT(*) AS n FROM sessions').one().n)).toBe(1);
});
it('token_redirect_is_not_followed',async()=>{
 const {stub}=await installed('token-redirect');await control('mode','token-redirect');expect((await login(stub)).response.status).toBe(401);
});
it('callback_rejects_duplicate_and_extra_parameters',async()=>{
 const {stub}=await installed('duplicates'),attempt=await start(stub);
 for(const query of ['code=a&state=b&state=c','code=a&state=b&id_token=x','code=a&state=b&response_mode=form_post'])expect((await stub.fetch(request('callback?'+query,'GET',undefined,attempt.cookie))).status).toBe(400);
});
it('no_tokens_in_browser_storage_or_redirect',async()=>{
 const {stub}=await installed('browser-secrets'),result=await login(stub);
 expect(result.response.status).toBe(302);expect(result.response.headers.get('location')).toBe('/overview');expect(await result.response.text()).toBe('');
 for(const value of [result.attempt.response.headers.get('set-cookie')!,result.response.headers.getSetCookie().find(x=>x.startsWith('cfhub_session='))!]) {
  expect(['Secure','HttpOnly','SameSite=Lax','Path=/'].every(attribute=>value.includes(attribute))&&!value.includes('Domain=')).toBe(true);
 }
 expect(result.response.headers.get('cache-control')).toBe('no-store');expect(result.response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
 const rows=await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT * FROM sessions').toArray());expect(JSON.stringify(rows).includes(result.cookie.split('=')[1])).toBe(false);expect(rows[0].auth_epoch).toBe(1);
});

import { AuthError } from '../../src/auth/context';
import { completeLogin,beginLogin } from '../../src/auth/sessions';
import { installConfiguration } from '../../src/config/bootstrap';
import { withTransaction } from '../../src/storage/transaction';
import { systemClock,systemEntropy } from '../../src/workspace/context';
import { FixedEntropy } from '../helpers/entropy';
import { prepared as nextConfiguration } from '../helpers/environment';
it('proof_verified_under_old_epoch_cannot_be_stamped_with_new_epoch',async()=>{
 const name='proof-interleaving',{stub}=await installed(name),attempt=await start(stub),next=await nextConfiguration(name,2);
 const issued=await (await control('issue',{authorization_url:attempt.authorization_url,now:Date.now()})).json() as {code:string};
 const outcome=await runInDurableObject(stub,async(_o,state)=>{
  let changed=false;
  const entropy={bytes(length:number){if(!changed){changed=true;withTransaction(state.storage,tx=>installConfiguration(tx,next.config,next,Date.now()));}return systemEntropy.bytes(length);}};
  try{await completeLogin({storage:state.storage,workspaceId:'ws_example',objectName:name,secrets:env as unknown as Record<string,unknown>,clock:systemClock,entropy},issued.code,new URL(attempt.authorization_url).searchParams.get('state')!,attempt.cookie.split('=')[1]);return 'accepted';}catch(error){return (error as Error).message;}
 });
 expect(outcome).toBe('UNAUTHENTICATED');
 expect(await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT COUNT(*) AS n FROM sessions').one().n)).toBe(0);
});
it('grant_removed_after_verified_proof_prevents_session_insertion',async()=>{
 const name='grant-interleaving',{stub}=await installed(name),attempt=await start(stub);
 const issued=await (await control('issue',{authorization_url:attempt.authorization_url,now:Date.now()})).json() as {code:string};
 const outcome=await runInDurableObject(stub,async(_o,state)=>{
  const entropy={bytes(length:number){state.storage.sql.exec('UPDATE human_grants SET enabled=0');return systemEntropy.bytes(length);}};
  try{await completeLogin({storage:state.storage,workspaceId:'ws_example',objectName:name,secrets:env as unknown as Record<string,unknown>,clock:systemClock,entropy},issued.code,new URL(attempt.authorization_url).searchParams.get('state')!,attempt.cookie.split('=')[1]);return 'accepted';}catch(error){return (error as Error).message;}
 });expect(outcome).toBe('FORBIDDEN');
});
it('discovery_under_old_epoch_cannot_publish_authorization_url',async()=>{
 const name='discovery-interleaving',{stub}=await installed(name),next=await nextConfiguration(name,2);
 const outcome=await runInDurableObject(stub,async(_o,state)=>{
  let changed=false;const entropy={bytes(length:number){if(!changed){changed=true;withTransaction(state.storage,tx=>installConfiguration(tx,next.config,next,Date.now()));}return systemEntropy.bytes(length);}};
  try{await beginLogin({storage:state.storage,workspaceId:'ws_example',objectName:name,secrets:env as unknown as Record<string,unknown>,clock:systemClock,entropy},'/','https://hub.example.invalid');return 'accepted';}catch(error){return (error as Error).message;}
 });expect(outcome).toBe('UNAUTHENTICATED');
 expect(await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('SELECT COUNT(*) AS n FROM login_attempts').one().n)).toBe(0);
});
it('deterministic_entropy_produces_distinct_concurrent_attempts',async()=>{
 const name='deterministic-attempts',{stub}=await installed(name);
 const result=await runInDurableObject(stub,async(_o,state)=>{
  const workspace={storage:state.storage,workspaceId:'ws_example',objectName:name,secrets:env as unknown as Record<string,unknown>,clock:systemClock,entropy:new FixedEntropy()};
  const attempts=await Promise.all([beginLogin(workspace,'/','https://hub.example.invalid'),beginLogin(workspace,'/','https://hub.example.invalid')]);
  return {distinctCookies:attempts[0].cookie!==attempts[1].cookie,count:state.storage.sql.exec('SELECT COUNT(*) AS n FROM login_attempts').one().n};
 });expect(result).toEqual({distinctCookies:true,count:2});
});
it('auth_responses_match_canonical_callback_status_and_error_envelope',async()=>{
 const {stub}=await installed('http-contract'),result=await login(stub);
 expect(result.response.status).toBe(302);
 const denied=await stub.fetch(request('session'));const payload=await denied.json() as {error:{code:string;request_id?:string};request_id?:string};
 expect(payload.error.code).toBe('UNAUTHENTICATED');expect(typeof payload.error.request_id).toBe('string');expect(payload.request_id).toBeUndefined();
 await control('mode','discovery-down');const unavailable=await stub.fetch(request('start','POST',{return_path:'/'}));expect((await unavailable.json() as {error:{code:string}}).error.code).toBe('DEPENDENCY_UNAVAILABLE');
});
it('callback_failure_clears_transient_cookie_even_for_unknown_workspace',async()=>{
 const response=await exports.default.fetch(new Request('https://hub.example.invalid/v2/workspaces/ws_unknown/auth/callback?code=unused&state=unused',{redirect:'manual'}));
 expect(response.status).toBe(401);expect(response.headers.get('set-cookie')?.includes('cfhub_login=;')).toBe(true);expect(response.headers.get('set-cookie')?.includes('Max-Age=0')).toBe(true);
});
it('successful_reauthentication_rotates_and_revokes_previous_session',async()=>{
 const {stub}=await installed('session-rotation'),first=await login(stub),second=await start(stub);
 const completed=await callback(stub,{...second,cookie:second.cookie+'; '+first.cookie});expect(completed.response.status).toBe(302);
 expect((await stub.fetch(request('session','GET',undefined,first.cookie))).status).toBe(401);
 expect((await stub.fetch(request('session','GET',undefined,cookie(completed.response,'cfhub_session')))).status).toBe(200);
});
