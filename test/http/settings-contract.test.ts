import {it,expect,beforeEach,vi} from 'vitest';
import {env,exports} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {settingsFixture,snapshot,preference,owned} from '../helpers/settings';
import {login,control,origin} from '../helpers/auth';
import {sha256} from '../../src/config/bootstrap';
import {settingsRoutes} from '../../src/http/settings-routes';
import {validateConfiguration,validatePreferencesData,validateProfilePreview,validateError,validateProfileExport} from '../../src/http/generated/auth-validators.js';
beforeEach(async()=>{await control('reset');});
const base='/v2/workspaces/ws_example/';
function req(endpoint:string,method='GET',body?:unknown,cookie?:string,csrf?:string,key='settings'){
 return new Request(origin+base+endpoint,{method,headers:{...(body!==undefined?{'content-type':'application/json',origin,'idempotency-key':key}:{}),...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
}
async function authenticated(name:string){
 const setup=await settingsFixture(name),auth=await login(setup.stub);expect(auth.response.status).toBe(302);
 const session=await (await setup.stub.fetch(new Request(origin+base+'auth/session',{headers:{cookie:auth.cookie}}))).json() as {data:{csrf_token:string}};
 return {...setup,cookie:auth.cookie,csrf:session.data.csrf_token};
}
it('settings_routes_apply_current_human_lane_csrf_and_advisory_preview',async()=>{
 const {stub,cookie,csrf}=await authenticated('settings-http-human');
 const initial=await (await stub.fetch(req('profile','GET',undefined,cookie))).json() as {data:{profile_revision:number;profile:unknown}};
 const body={expected_profile_revision:1,profile:initial.data.profile};
 const before=await runInDurableObject(stub,(_o,state)=>snapshot(state.storage));
 expect((await stub.fetch(req('profile:preview','POST',body,cookie))).status).toBe(403);
 const preview=await stub.fetch(req('profile:preview','POST',body,cookie,csrf)),proposed=await preview.json() as {data:unknown};expect(preview.status).toBe(200);expect(validateProfilePreview(proposed.data)).toBe(true);
 expect(await runInDurableObject(stub,(_o,state)=>snapshot(state.storage))).toEqual(before);
 expect((await stub.fetch(req('profile','PUT',body,cookie))).status).toBe(403);
 const applied=await stub.fetch(req('profile','PUT',body,cookie,csrf));expect(applied.status).toBe(200);
 const replay=await stub.fetch(req('profile','PUT',body,cookie,csrf));expect(replay.status).toBe(200);
 const events=await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec("SELECT * FROM events WHERE type='profile.updated'").toArray());expect(events).toHaveLength(1);
 const exported=await stub.fetch(req('profile:export','GET',undefined,cookie));expect(exported.status).toBe(200);expect(validateProfileExport((await exported.json() as {data:unknown}).data)).toBe(true);
 expect(exported.headers.get('cache-control')).toBe('no-store');
});
it('revision_zero_is_canonical_and_stale_first_write_reports_actual_zero',async()=>{
 const {stub,cookie,csrf}=await authenticated('settings-http-zero');
 const response=await stub.fetch(req('preferences','GET',undefined,cookie)),read=await response.json() as {data:{preferences_revision:number;default_view_fallback_reason:null}};
 expect(response.status).toBe(200);expect(validatePreferencesData(read.data)).toBe(true);expect(read.data.preferences_revision).toBe(0);
 const before=await runInDurableObject(stub,(_o,state)=>snapshot(state.storage));
 const stale=await stub.fetch(req('preferences','PUT',{expected_preferences_revision:1,preferences:preference},cookie,csrf,'stale')),error=await stale.json();expect(stale.status).toBe(409);expect(validateError(error)).toBe(true);expect(error).toMatchObject({error:{details:{current_revision:0}}});
 expect(await runInDurableObject(stub,(_o,state)=>snapshot(state.storage))).toEqual(before);
 const first=await stub.fetch(req('preferences','PUT',{expected_preferences_revision:0,preferences:{...preference,default_view:'tasks'}},cookie,csrf,'first')),data=await first.json() as {data:unknown};
 expect(first.status).toBe(200);expect(validatePreferencesData(data.data)).toBe(true);expect(data.data).toMatchObject({preferences_revision:1,preferences:{default_view:'tasks'},effective:{default_view:'overview'},default_view_fallback_reason:'VIEW_UNAVAILABLE'});
 const configuration=await (await stub.fetch(req('configuration','GET',undefined,cookie))).json() as {data:unknown};expect(validateConfiguration(configuration.data)).toBe(true);expect(configuration.data).toMatchObject({preferences_revision:1});
});
it('native_configuration_has_no_human_state_and_native_preferences_are_forbidden',async()=>{
 const {stub}=await settingsFixture('settings-http-native'),token='A'.repeat(43),digest=await sha256(token);
 await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec('UPDATE native_credentials SET token_sha256=?',digest));
 const request=(path:string)=>new Request(origin+base+path,{headers:{authorization:'Bearer '+token}});
 const response=await stub.fetch(request('configuration')),body=await response.json() as {data:unknown};expect(response.status).toBe(200);expect(validateConfiguration(body.data)).toBe(true);expect(body.data).toMatchObject({preferences_revision:null,allowed_user_overrides:[]});expect(JSON.stringify(body)).not.toContain('preferences_record');
 expect((await stub.fetch(request('profile'))).status).toBe(200);expect((await stub.fetch(request('preferences'))).status).toBe(403);expect((await stub.fetch(request('profile:export'))).status).toBe(403);
});
it('profile_edit_only_export_preview_apply_do_not_require_workspace_read',async()=>{
 const {stub,cookie,csrf}=await authenticated('settings-http-editor');
 const initial=await (await stub.fetch(req('profile','GET',undefined,cookie))).json() as {data:{profile:unknown}};
 await runInDurableObject(stub,(_o,state)=>state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"profile:edit\"]'"));
 expect((await stub.fetch(req('configuration','GET',undefined,cookie))).status).toBe(403);expect((await stub.fetch(req('profile','GET',undefined,cookie))).status).toBe(403);expect((await stub.fetch(req('preferences','GET',undefined,cookie))).status).toBe(403);
 expect((await stub.fetch(req('profile:export','GET',undefined,cookie))).status).toBe(200);
 const body={expected_profile_revision:1,profile:initial.data.profile};
 expect((await stub.fetch(req('profile:preview','POST',body,cookie,csrf))).status).toBe(200);expect((await stub.fetch(req('profile','PUT',body,cookie,csrf))).status).toBe(200);
});
it('settings_forbid_foreign_origin_mixed_lanes_queries_and_writable_configuration',async()=>{
 const {stub,cookie,csrf}=await authenticated('settings-http-deny'),body={expected_preferences_revision:0,preferences:preference},before=await runInDurableObject(stub,(_o,state)=>snapshot(state.storage));
 const mixed=req('preferences','PUT',body,cookie,csrf);mixed.headers.set('authorization','Bearer '+'A'.repeat(43));expect((await stub.fetch(mixed)).status).toBe(400);
 const foreign=req('preferences','PUT',body,cookie,csrf);foreign.headers.set('origin','https://foreign.example.invalid');expect((await stub.fetch(foreign)).status).toBe(403);
 expect((await stub.fetch(req('preferences?principal_id=human_other','GET',undefined,cookie))).status).toBe(400);
 expect((await stub.fetch(req('configuration','PUT',{},cookie,csrf))).status).toBe(404);
 expect((await stub.fetch(req('profile:preview','GET',undefined,cookie))).status).toBe(404);
 expect(await runInDurableObject(stub,(_o,state)=>snapshot(state.storage))).toEqual(before);
});
it('closed_preferences_reject_css_html_assets_and_response_only_fields_atomically',async()=>{
 const {stub,cookie,csrf}=await authenticated('settings-http-closed'),before=await runInDurableObject(stub,(_o,state)=>snapshot(state.storage));
 for(const extra of [{css:'body{}'},{html:'<script>'},{asset_url:'https://evil.invalid'},{default_view_fallback_reason:null}]){
 const response=await stub.fetch(req('preferences','PUT',{expected_preferences_revision:0,preferences:{...preference,...extra}},cookie,csrf));expect(response.status).toBe(400);expect(validateError(await response.json())).toBe(true);
 }expect(await runInDurableObject(stub,(_o,state)=>snapshot(state.storage))).toEqual(before);
});
it('missing_installed_policy_fails_affected_reads_preview_and_writes',async()=>{
 const {stub,cookie,csrf}=await authenticated('settings-http-policy');
 const initial=await (await stub.fetch(req('profile','GET',undefined,cookie))).json() as {data:{profile:unknown}};
 await runInDurableObject(stub,(_o,state)=>{const row=state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one(),config=JSON.parse(row.config_json);config.workspace_policies=[];state.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',JSON.stringify(config));});
 const before=await runInDurableObject(stub,(_o,state)=>snapshot(state.storage));
 for(const endpoint of ['configuration','profile','preferences','profile:export'])expect((await stub.fetch(req(endpoint,'GET',undefined,cookie))).status).toBe(503);
 const body={expected_profile_revision:1,profile:initial.data.profile};expect((await stub.fetch(req('profile:preview','POST',body,cookie,csrf))).status).toBe(503);expect((await stub.fetch(req('profile','PUT',body,cookie,csrf))).status).toBe(503);
 expect(await runInDurableObject(stub,(_o,state)=>snapshot(state.storage))).toEqual(before);
});
it('public_worker_routes_settings_through_its_stable_catalog',async()=>{
 const routing=JSON.parse((env as unknown as {DEPLOYMENT_CONFIG:string}).DEPLOYMENT_CONFIG),name=routing.workspace_catalog[0].object_name;
 const {cookie}=await authenticated(name),response=await exports.default.fetch(req('configuration','GET',undefined,cookie));expect(response.status).toBe(200);expect(validateConfiguration((await response.json() as {data:unknown}).data)).toBe(true);
});

it('preview_rechecks_session_after_csrf_crypto_and_rejects_without_state',async()=>{
 const {stub,cookie,csrf,name}=await authenticated('settings-preview-race'),initial=await (await stub.fetch(req('profile','GET',undefined,cookie))).json() as {data:{profile:unknown}};
 await runInDurableObject(stub,async(_o,state)=>{
  const before=snapshot(state.storage),workspace=owned(state.storage,name);workspace.secrets=new Proxy({CSRF_SECRET:(env as unknown as Record<string,unknown>).CSRF_SECRET},{get(target,key){if(key==='CSRF_SECRET')state.storage.sql.exec('UPDATE sessions SET revoked_at=?',Date.now());return Reflect.get(target,key);}});
  const response=await settingsRoutes(req('profile:preview','POST',{expected_profile_revision:1,profile:initial.data.profile},cookie,csrf),workspace);expect(response.status).toBe(401);expect(snapshot(state.storage)).toEqual(before);
 });
});
it('read_publication_rechecks_session_after_async_digest',async()=>{
 const {stub,cookie,name}=await authenticated('settings-read-race');
 await runInDurableObject(stub,async(_o,state)=>{
  const before=snapshot(state.storage),digest=crypto.subtle.digest.bind(crypto.subtle),hook=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(...args:Parameters<SubtleCrypto['digest']>)=>{const result=await digest(...args);state.storage.sql.exec('UPDATE sessions SET revoked_at=?',Date.now());return result;});
  try{const response=await settingsRoutes(req('preferences','GET',undefined,cookie),owned(state.storage,name));expect(response.status).toBe(401);expect(await response.text()).not.toContain('preferences_revision');expect(snapshot(state.storage)).toEqual(before);}finally{hook.mockRestore();}
 });
});
