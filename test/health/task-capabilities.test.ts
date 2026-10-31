import entry from '../../src/index';
import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {ingressFixture} from '../helpers/task-ingress';
import {withTransaction} from '../../src/storage/transaction';
import {readPreferences,preferenceView} from '../../src/config/preferences';
import {actor,human} from '../helpers/settings';
import {storedProfile} from '../../src/config/profile';
import type {Workspace,UserPreferences} from '../../src/http/dto';

const rootRequest=(f:Awaited<ReturnType<typeof ingressFixture>>)=>{const request=f.req('','GET',undefined,'read',undefined,true);return new Request(request.url.replace(/\/$/,''),request);};

it('workspace discovery exposes current implemented task-create grants and removes revoked authority',async()=>{
 const f=await ingressFixture('board-capabilities');
 const response=await f.stub.fetch(rootRequest(f));expect(response.status).toBe(200);
 const data=(await response.json() as {data:Workspace}).data;
 expect(data.effective_scopes).toContain('tasks:read');expect(data.effective_scopes).toContain('artifacts:read');expect(data.effective_scopes).toContain('tasks:create');
 await runInDurableObject(f.stub,(_o,state)=>state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"workspace:read\",\"tasks:read\"]',project_ids_json='[]' WHERE principal_id='human_operator'"));
 const partial=(await (await f.stub.fetch(rootRequest(f))).json() as {data:Workspace}).data;
 expect(partial.effective_scopes).toEqual(['tasks:read','workspace:read']);
 expect((await f.send('tasks','POST',{title:'Revoked create',description:''},'revoked-create',undefined,true)).status).toBe(403);
 const page=await f.send('tasks','GET',undefined,'tasks',undefined,true);expect(page.status).toBe(200);expect((await page.json() as {data:unknown[]}).data).toEqual([]);
 await runInDurableObject(f.stub,(_o,state)=>state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"workspace:read\"]' WHERE principal_id='human_operator'"));
 expect((await (await f.stub.fetch(rootRequest(f))).json() as {data:Workspace}).data.effective_scopes).toEqual(['workspace:read']);
 expect((await f.send('tasks','GET',undefined,'tasks',undefined,true)).status).toBe(403);
 await runInDurableObject(f.stub,(_o,state)=>state.storage.sql.exec("UPDATE human_grants SET enabled=0 WHERE principal_id='human_operator'"));
 expect((await f.stub.fetch(rootRequest(f))).status).toBe(401);
});
it('foreign workspace path cannot discover task capabilities',async()=>{
 const f=await ingressFixture('board-foreign');const request=rootRequest(f);
 const foreign=new Request(request.url.replace('/ws_example','/ws_foreign'),request);
 const response=await entry.fetch(foreign,f.bindings);expect(response.status).toBe(401);
 expect(await response.text()).not.toContain('effective_scopes');
});
it.each(['tasks','kanban'] as const)('supported %s preference aliases respect current scope, profile and policy',async preferred=>{
 const f=await ingressFixture('board-preference-'+preferred);
 await runInDurableObject(f.stub,(_o,state)=>{
  const identity=human(state.storage),live=actor(state.storage,identity),prefs:UserPreferences={contract_revision:'0.1',theme:'system',density:'comfortable',default_view:preferred};
  const read=()=>withTransaction(state.storage,tx=>preferenceView(tx,live,prefs,0,Date.now()));
  expect(read()).toMatchObject({effective:{default_view:'tasks'},default_view_fallback_reason:null});
  const profile=withTransaction(state.storage,tx=>storedProfile(tx,live).profile);profile.navigation.visible_views=['overview','kanban'];
  state.storage.sql.exec('INSERT INTO profiles(workspace_id,version,document_json,updated_at,updated_by) VALUES(?,?,?,?,?)','ws_example',2,JSON.stringify(profile),Date.now(),'human_operator');
  expect(read().effective.default_view).toBe('tasks');
  profile.navigation.visible_views=['overview'];state.storage.sql.exec('UPDATE profiles SET document_json=?',JSON.stringify(profile));
  expect(read()).toMatchObject({effective:{default_view:'overview'},default_view_fallback_reason:'VIEW_UNAVAILABLE'});
  profile.navigation.visible_views=['tasks'];state.storage.sql.exec('UPDATE profiles SET document_json=?',JSON.stringify(profile));
  state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"workspace:read\"]' WHERE principal_id='human_operator'");
  expect(read()).toMatchObject({effective:{default_view:'overview'},default_view_fallback_reason:'VIEW_UNAVAILABLE'});
  const metadata=state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one(),config=JSON.parse(metadata.config_json);config.workspace_policies[0].allowed_user_overrides=[];state.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',JSON.stringify(config));
  expect(read()).toMatchObject({effective:{default_view:'overview'},default_view_fallback_reason:'PREFERENCE_NOT_ALLOWED'});
 });
});
