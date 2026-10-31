import {resetLegacyAuthorityFixture} from '../helpers/legacy-migration-fixture';
import {validateEvent} from '../../src/http/generated/auth-validators.js';
import {migrate,FOUNDATION_SQL} from '../../src/storage/migrations';
import {it,expect,vi} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {settingsFixture,human,actor,commandContext,snapshot,preference,owned} from '../helpers/settings';
import {withTransaction} from '../../src/storage/transaction';
import {readConfiguration,readProfile,previewProfile,readPreferences,exportProfile,profileCommand,preferencesCommand} from '../../src/config/settings-service';
import {executeCommand} from '../../src/workspace/commands';
import {projectEvent,settingsEventVisibility} from '../../src/audit/events';
import {sha256,canonicalJson} from '../../src/config/bootstrap';
import {resolveDiagnosticActor} from '../../src/health/diagnostic-auth';
const read=(storage:DurableObjectStorage,identity:ReturnType<typeof human>)=>withTransaction(storage,tx=>readProfile(tx,actor(storage,identity)));
it.each([
 {label:'unrestricted',projectIds:null,scopes:['workspace:read','operations:read'],enabled:true},
 {label:'empty_projects',projectIds:[],scopes:['workspace:read','operations:read'],enabled:false},
 {label:'restricted_project',projectIds:['project_one'],scopes:['workspace:read','operations:read'],enabled:false},
 {label:'missing_scope',projectIds:null,scopes:['workspace:read'],enabled:false},
])('configuration_operations_capability_$label',async({label,projectIds,scopes,enabled})=>{
 const {stub,name}=await settingsFixture('settings-operations-'+label);
 await runInDurableObject(stub,(_o,state)=>{const identity=human(state.storage),cached=actor(state.storage,identity),workspace=owned(state.storage,name);
  state.storage.sql.exec('UPDATE human_grants SET scopes_json=?,project_ids_json=? WHERE principal_id=? AND workspace_id=?',JSON.stringify(scopes),JSON.stringify(projectIds),cached.principalId,cached.workspaceId);
  const diagnostic=()=>withTransaction(state.storage,tx=>resolveDiagnosticActor(tx,workspace,identity,Date.now()));
  if(enabled)expect(diagnostic().principalId).toBe(cached.principalId);
  else expect(diagnostic).toThrowError(expect.objectContaining({code:'FORBIDDEN',status:403}));
  const configuration=withTransaction(state.storage,tx=>readConfiguration(tx,cached));
  expect(configuration.enabled_features.includes('operations')).toBe(enabled);
  expect(configuration.enabled_features).toContain('workspace');
 });
});
it('configuration_operations_requires_current_workspace_membership',async()=>{
 const {stub,name}=await settingsFixture('settings-operations-membership');
 await runInDurableObject(stub,(_o,state)=>{const identity=human(state.storage),cached=actor(state.storage,identity),workspace=owned(state.storage,name);
  expect(withTransaction(state.storage,tx=>readConfiguration(tx,cached)).enabled_features).toContain('operations');
  state.storage.sql.exec('UPDATE human_grants SET enabled=0 WHERE principal_id=? AND workspace_id=?',cached.principalId,cached.workspaceId);
  expect(()=>withTransaction(state.storage,tx=>readConfiguration(tx,cached))).toThrowError(expect.objectContaining({code:'UNAUTHENTICATED',status:401}));
  expect(()=>withTransaction(state.storage,tx=>resolveDiagnosticActor(tx,workspace,identity,Date.now()))).toThrowError(expect.objectContaining({code:'UNAUTHENTICATED',status:401}));
 });
});
it('new_workspace_is_neutral_and_empty',async()=>{
 const {stub}=await settingsFixture('settings-neutral');
 await runInDurableObject(stub,(_o,state)=>{const a=actor(state.storage,human(state.storage)),before=snapshot(state.storage);
  const p=withTransaction(state.storage,tx=>readProfile(tx,a));expect(p.profile_revision).toBe(1);expect(p.profile.projects).toEqual([]);expect(p.profile.work_roles).toEqual([]);
  const prefs=withTransaction(state.storage,tx=>readPreferences(tx,a));expect(prefs).toMatchObject({preferences_revision:0,preferences:preference,effective:preference,default_view_fallback_reason:null});
  expect(snapshot(state.storage)).toEqual(before);
 });
});
it('invalid_profile_leaves_last_valid_revision',async()=>{
 const {stub,name}=await settingsFixture('settings-invalid');
 await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),p=read(state.storage,id),before=snapshot(state.storage),hash=await sha256(canonicalJson(p));
  for(const extra of [{grants:[]},{workspace_catalog:[]},{branding:{accent:'blue',css:'evil'}},{asset_url:'https://evil.invalid'}]){
   const body={expected_profile_revision:1,profile:{...p.profile,...extra}},ctx=await commandContext(state.storage,name,body,JSON.stringify(Object.keys(extra)));
   expect(()=>executeCommand(ctx,id,profileCommand(),body as never)).toThrow();
   expect(snapshot(state.storage)).toEqual(before);expect(await sha256(canonicalJson(read(state.storage,id)))).toBe(hash);
  }
  console.info(JSON.stringify({category:'PROFILE_HASH_EVIDENCE',case:'rejected',before:hash,after:await sha256(canonicalJson(read(state.storage,id)))}));
 });
});
it('omitted_stable_ids_survive_upsert',async()=>{
 const {stub,name}=await settingsFixture('settings-merge');
 await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),a=actor(state.storage,id),p=read(state.storage,id);
  const first={expected_profile_revision:1,profile:{...p.profile,projects:[{id:'project_one',display_name:'One',description:'',archived:false}],work_roles:[{id:'role_one',display_name:'One',description:'',archived:false}]}};
  const preview=withTransaction(state.storage,tx=>previewProfile(tx,{actor:a,requestId:'preview',idempotencyKey:'preview',nowMs:Date.now()},first));expect(preview.base_revision).toBe(1);
  const changed=executeCommand(await commandContext(state.storage,name,first,'first'),id,profileCommand(),first).data;expect(changed.profile_revision).toBe(2);
  const second={expected_profile_revision:2,profile:{...p.profile,display_name:'Changed'}};
  const result=executeCommand(await commandContext(state.storage,name,second,'second'),id,profileCommand(),second).data;
  expect(result.profile.projects).toEqual(first.profile.projects);expect(result.profile.work_roles).toEqual(first.profile.work_roles);
  console.info(JSON.stringify({category:'PROFILE_HASH_EVIDENCE',case:'committed',before:await sha256(canonicalJson(p)),after:await sha256(canonicalJson(result))}));
  const before=snapshot(state.storage);expect(()=>withTransaction(state.storage,tx=>previewProfile(tx,{actor:a,requestId:'preview',idempotencyKey:'preview',nowMs:Date.now()},first))).toThrowError(expect.objectContaining({code:'VERSION_CONFLICT',details:{current_revision:3}}));
  const stale=await commandContext(state.storage,name,first,'stale');expect(()=>executeCommand(stale,id,profileCommand(),first)).toThrow();expect(snapshot(state.storage)).toEqual(before);
 });
});
it('preferences_only_affect_owner_allowed_fields',async()=>{
 const {stub,name}=await settingsFixture('settings-prefs');
 await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),a=actor(state.storage,id),other=actor(state.storage,human(state.storage,true));
  const body={expected_preferences_revision:0,preferences:{...preference,theme:'dark' as const}},ctx=await commandContext(state.storage,name,body,'first');
  const original=executeCommand(ctx,id,preferencesCommand('pref_'+'a'.repeat(32)),body);expect(original.data.preferences_revision).toBe(1);
  const row=state.storage.sql.exec<{record_id:string}>('SELECT record_id FROM preferences').one();expect(row.record_id).toBe('pref_'+'a'.repeat(32));
  expect(executeCommand(ctx,id,preferencesCommand('pref_'+'b'.repeat(32)),body)).toEqual(original);
  expect(withTransaction(state.storage,tx=>readPreferences(tx,other)).preferences_revision).toBe(0);
  const event=state.storage.sql.exec<{id:string}>("SELECT id FROM events WHERE type='preferences.updated'").one();
  expect(withTransaction(state.storage,tx=>projectEvent(tx,a,event.id,Date.now(),settingsEventVisibility))).toMatchObject({resource_id:row.record_id,resource_version:1,summary:'User preferences updated.'});
  expect(withTransaction(state.storage,tx=>projectEvent(tx,other,event.id,Date.now(),settingsEventVisibility))).toBeNull();
  const metadata=state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one(),c=JSON.parse(metadata.config_json);c.workspace_policies[0].allowed_user_overrides=['density'];state.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',JSON.stringify(c));
  expect(withTransaction(state.storage,tx=>readPreferences(tx,a)).effective.theme).toBe('system');
  const allowed={expected_preferences_revision:1,preferences:{...body.preferences,density:'compact' as const}};
  executeCommand(await commandContext(state.storage,name,allowed,'allowed'),id,preferencesCommand('pref_'+'c'.repeat(32)),allowed);
  expect(state.storage.sql.exec('SELECT record_id FROM preferences').one().record_id).toBe(row.record_id);
  const before=snapshot(state.storage),forbidden={expected_preferences_revision:2,preferences:{...allowed.preferences,theme:'light' as const,density:'comfortable' as const}},bad=await commandContext(state.storage,name,forbidden,'forbidden');
  expect(()=>executeCommand(bad,id,preferencesCommand('pref_'+'d'.repeat(32)),forbidden)).toThrowError(expect.objectContaining({code:'FORBIDDEN',details:{field:'/preferences/theme'}}));expect(snapshot(state.storage)).toEqual(before);
  expect(()=>state.storage.sql.exec("UPDATE preferences SET principal_id='human_other'")).toThrow();expect(()=>state.storage.sql.exec("UPDATE preferences SET record_id=?", 'pref_'+'e'.repeat(32))).toThrow();
 });
});
it('export_excludes_private_state',async()=>{
 const {stub,name}=await settingsFixture('settings-export');
 await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),a=actor(state.storage,id),p=read(state.storage,id),body={expected_profile_revision:1,profile:{...p.profile,display_name:'Portable'}};
  executeCommand(await commandContext(state.storage,name,body,'edit'),id,profileCommand(),body);
  const exported=withTransaction(state.storage,tx=>exportProfile(tx,a));expect(Object.keys(exported).sort()).toEqual(['included_categories','profile','profile_revision']);expect(exported.included_categories).toEqual(['presentation','projects','work_roles']);
  const event=state.storage.sql.exec<{id:string}>("SELECT id FROM events WHERE type='profile.updated'").one();
  expect(withTransaction(state.storage,tx=>projectEvent(tx,a,event.id,Date.now(),settingsEventVisibility))).toMatchObject({type:'profile.updated',resource_id:'ws_example',resource_version:2,actor:{kind:'human',principal_id:'human_operator'},summary:'Workspace profile updated.'});
 });
});
it('config_event_requires_operations_scope',async()=>{
 const {stub}=await settingsFixture('settings-config-event');await runInDurableObject(stub,(_o,state)=>{const a=actor(state.storage,human(state.storage));
  expect(withTransaction(state.storage,tx=>projectEvent(tx,a,'configuration_1',Date.now(),settingsEventVisibility))).toMatchObject({summary:'Workspace configuration installed.'});
  state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"workspace:read\",\"events:read\"]'");
  expect(withTransaction(state.storage,tx=>projectEvent(tx,a,'configuration_1',Date.now(),settingsEventVisibility))).toBeNull();
 });
});
it('malformed_preferences_keep_actual_revision_without_read_time_write',async()=>{
 const {stub,name}=await settingsFixture('settings-malformed');await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),a=actor(state.storage,id),body={expected_preferences_revision:0,preferences:preference};
 executeCommand(await commandContext(state.storage,name,body,'create'),id,preferencesCommand('pref_'+'f'.repeat(32)),body);state.storage.sql.exec("UPDATE preferences SET document_json='{\"theme\":\"private-canary\"}'");
 const before=snapshot(state.storage),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});try{expect(withTransaction(state.storage,tx=>readPreferences(tx,a))).toMatchObject({preferences_revision:1,preferences:preference,effective:preference});expect(JSON.stringify(warn.mock.calls)).not.toContain('private-canary');}finally{warn.mockRestore();}expect(snapshot(state.storage)).toEqual(before);
 });});
it('valid_edits_and_opaque_owner_identity_survive_restart',async()=>{
 const {stub,name}=await settingsFixture('settings-restart');let identity:ReturnType<typeof human>;await runInDurableObject(stub,async(_o,state)=>{identity=human(state.storage);const body={expected_preferences_revision:0,preferences:{...preference,theme:'light' as const}};executeCommand(await commandContext(state.storage,name,body,'persist'),identity,preferencesCommand('pref_'+'1'.repeat(32)),body);});
 await evictDurableObject(stub);await runInDurableObject(stub,(_o,state)=>{expect(withTransaction(state.storage,tx=>readPreferences(tx,actor(state.storage,identity)))).toMatchObject({preferences_revision:1,preferences:{theme:'light'}});expect(state.storage.sql.exec('SELECT record_id FROM preferences').one()).toEqual({record_id:'pref_'+'1'.repeat(32)});});
});

it.each(['blue','teal','indigo','violet','amber','slate'] as const)('approved_accent_%s_is_portable',async accent=>{
 const {stub,name}=await settingsFixture('settings-accent-'+accent);await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),p=read(state.storage,id),body={expected_profile_revision:1,profile:{...p.profile,branding:{accent}}};
 expect(executeCommand(await commandContext(state.storage,name,body,'accent'),id,profileCommand(),body).data.profile.branding.accent).toBe(accent);
 });
});
it.each(['system','light','dark'] as const)('approved_theme_%s_and_both_densities',async theme=>{
 const {stub,name}=await settingsFixture('settings-theme-'+theme);await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage);for(const [index,density] of (['comfortable','compact'] as const).entries()){const body={expected_preferences_revision:index,preferences:{...preference,theme,density}};const result=executeCommand(await commandContext(state.storage,name,body,'density'+index),id,preferencesCommand('pref_'+'2'.repeat(32)),body).data;expect(result.effective).toMatchObject({theme,density});}});
});
it.each(['projects','work_roles'] as const)('duplicate_%s_ids_fail_without_partial_effects',async collection=>{
 const {stub,name}=await settingsFixture('settings-duplicate-'+collection);await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),p=read(state.storage,id),item={id:'record_one',display_name:'One',description:'',archived:false},body={expected_profile_revision:1,profile:{...p.profile,[collection]:[item,{...item,display_name:'Different'}]}},ctx=await commandContext(state.storage,name,body,'duplicate'),before=snapshot(state.storage);
 expect(()=>executeCommand(ctx,id,profileCommand(),body)).toThrowError(expect.objectContaining({code:'INVALID_REQUEST',details:{field:'/profile/'+collection+'/1/id'}}));expect(snapshot(state.storage)).toEqual(before);
 });
});
it.each([false,true])('referenced_archive_change_from_%s_is_advisory_conflict_and_atomic_rejection',async archived=>{
 const {stub,name}=await settingsFixture('settings-archive-'+archived);await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),p=read(state.storage,id),project={id:'project_ref',display_name:'Referenced',description:'',archived},first={expected_profile_revision:1,profile:{...p.profile,projects:[project]}};
 // Seed a retained archived record directly; ordinary imports no longer create archived IDs.
 if(archived)state.storage.sql.exec('INSERT INTO profiles(workspace_id,version,document_json,updated_at,updated_by) VALUES(?,?,?,?,?)','ws_example',2,JSON.stringify(first.profile),Date.now(),'human_operator');
 else executeCommand(await commandContext(state.storage,name,first,'create'),id,profileCommand(),first);
 state.storage.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_ref\"]'");
 const a=actor(state.storage,id),body={expected_profile_revision:2,profile:{...p.profile,projects:[{...project,archived:!archived}]}},before=snapshot(state.storage),preview=withTransaction(state.storage,tx=>previewProfile(tx,{actor:a,requestId:'preview',idempotencyKey:'preview',nowMs:Date.now()},body));expect(preview.conflicts).toEqual([{field:'/projects/0/archived',code:'REFERENCED_ARCHIVE'}]);expect(snapshot(state.storage)).toEqual(before);
 const ctx=await commandContext(state.storage,name,body,'archive');expect(()=>executeCommand(ctx,id,profileCommand(),body)).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));expect(snapshot(state.storage)).toEqual(before);
 });
});
it('preview_bounds_reject_change_count_and_utf8_envelope_overflow_without_truncation',async()=>{
 const {stub}=await settingsFixture('settings-preview-bounds');await runInDurableObject(stub,(_o,state)=>{const id=human(state.storage),a=actor(state.storage,id),p=read(state.storage,id),before=snapshot(state.storage);
 for(const projects of [Array.from({length:201},(_,n)=>({id:'project_'+n,display_name:'P',description:'',archived:false})),Array.from({length:20},(_,n)=>({id:'project_'+n,display_name:'P',description:'😀'.repeat(1000),archived:false}))]){
  expect(()=>withTransaction(state.storage,tx=>previewProfile(tx,{actor:a,requestId:'bounded',idempotencyKey:'bounded',nowMs:Date.now()},{expected_profile_revision:1,profile:{...p.profile,projects}}))).toThrowError(expect.objectContaining({code:'LIMIT_EXCEEDED',status:413}));expect(snapshot(state.storage)).toEqual(before);
 }
 });
});
it('empty_policy_carries_unchanged_fields_and_reason_tracks_current_allowed_view',async()=>{
 const {stub,name}=await settingsFixture('settings-fallback');await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),a=actor(state.storage,id),body={expected_preferences_revision:0,preferences:{...preference,theme:'dark' as const,default_view:'inbox' as const}};
 expect(executeCommand(await commandContext(state.storage,name,body,'inbox'),id,preferencesCommand('pref_'+'3'.repeat(32)),body).data).toMatchObject({preferences:{default_view:'inbox'},effective:{default_view:'overview'},default_view_fallback_reason:'VIEW_UNAVAILABLE'});
 const metadata=state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one(),config=JSON.parse(metadata.config_json);config.workspace_policies[0].allowed_user_overrides=[];state.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',JSON.stringify(config));
 expect(withTransaction(state.storage,tx=>readPreferences(tx,a))).toMatchObject({preferences:{theme:'dark',default_view:'inbox'},effective:preference,default_view_fallback_reason:'PREFERENCE_NOT_ALLOWED'});
 const unchanged={...body,expected_preferences_revision:1};expect(executeCommand(await commandContext(state.storage,name,unchanged,'unchanged'),id,preferencesCommand('pref_'+'4'.repeat(32)),unchanged).data.preferences_revision).toBe(2);
 const change={expected_preferences_revision:2,preferences:{...body.preferences,density:'compact' as const}},ctx=await commandContext(state.storage,name,change,'change'),before=snapshot(state.storage);expect(()=>executeCommand(ctx,id,preferencesCommand('pref_'+'5'.repeat(32)),change)).toThrowError(expect.objectContaining({code:'FORBIDDEN',details:{field:'/preferences/density'}}));expect(snapshot(state.storage)).toEqual(before);
 });
});
it('failure_after_event_insertion_rolls_back_settings_revision_event_and_outcome',async()=>{
 const {stub,name}=await settingsFixture('settings-rollback-event');await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),body={expected_preferences_revision:0,preferences:{...preference,theme:'dark' as const}},ctx=await commandContext(state.storage,name,body,'rollback'),before=snapshot(state.storage);
 state.storage.sql.exec("CREATE TRIGGER settings_test_outcome_fault BEFORE INSERT ON idempotency_outcomes WHEN NEW.operation LIKE 'domain.%' BEGIN SELECT RAISE(ABORT,'synthetic_after_event_fault'); END");
 expect(()=>executeCommand(ctx,id,preferencesCommand('pref_'+'6'.repeat(32)),body)).toThrow();expect(snapshot(state.storage)).toEqual(before);state.storage.sql.exec('DROP TRIGGER settings_test_outcome_fault');
 const result=executeCommand(ctx,id,preferencesCommand('pref_'+'6'.repeat(32)),body);expect(result.data.preferences_revision).toBe(1);expect(state.storage.sql.exec("SELECT count(*) AS n FROM events WHERE type='preferences.updated'").one().n).toBe(1);
 });
});

it('forward_migration_backfills_unique_opaque_owners_atomically_and_preserves_legacy_revisions',async()=>{
 const {stub}=await settingsFixture('settings-owner-migration');
 await runInDurableObject(stub,async(_o,state)=>{
  await resetLegacyAuthorityFixture(state.storage,2);
  for(const [id,version]of [['legacy_owner_a',4],['legacy_owner_b',8]] as const)state.storage.sql.exec('INSERT INTO preferences (principal_id,workspace_id,version,document_json,updated_at) VALUES (?,?,?,?,?)',id,'ws_example',version,JSON.stringify(preference),1);
  const before=state.storage.sql.exec('SELECT * FROM preferences ORDER BY principal_id').toArray(),events=state.storage.sql.exec('SELECT * FROM events').toArray();
  const entropy=vi.spyOn(crypto,'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
  try{expect(()=>migrate(state.storage)).toThrow();}finally{entropy.mockRestore();}
  expect(state.storage.sql.exec('SELECT * FROM preferences ORDER BY principal_id').toArray()).toEqual(before);expect(state.storage.sql.exec('SELECT version FROM schema_migrations ORDER BY version').toArray()).toEqual([{version:1},{version:2}]);
  migrate(state.storage);const rows=state.storage.sql.exec<{record_id:string;principal_id:string;version:number}>('SELECT record_id,principal_id,version FROM preferences ORDER BY principal_id').toArray();
  expect(rows.map(x=>x.version)).toEqual([4,8]);expect(new Set(rows.map(x=>x.record_id)).size).toBe(2);for(const row of rows){expect(row.record_id).toMatch(/^pref_[a-f0-9]{32}$/);expect(row.record_id).not.toContain(row.principal_id);}
  expect(()=>state.storage.sql.exec('UPDATE preferences SET workspace_id=? WHERE principal_id=?','foreign','legacy_owner_a')).toThrow();expect(()=>state.storage.sql.exec('INSERT INTO preferences (principal_id,workspace_id,version,document_json,updated_at,record_id) VALUES (?,?,?,?,?,?)','third','ws_example',1,JSON.stringify(preference),1,rows[0].record_id)).toThrow();
  expect(()=>state.storage.sql.exec('INSERT INTO preferences (principal_id,workspace_id,version,document_json,updated_at) VALUES (?,?,?,?,?)','third','ws_example',1,JSON.stringify(preference),1)).toThrow();
  expect(state.storage.sql.exec('SELECT * FROM events').toArray()).toEqual(events.map(row=>({...row,task_version:null,run_id:null,fence:null,creation_binding:null})));
 });await evictDurableObject(stub);await runInDurableObject(stub,(_o,state)=>{expect(state.storage.sql.exec('SELECT version FROM schema_migrations ORDER BY version').toArray()).toEqual([{version:1},{version:2},{version:3},{version:4},{version:5},{version:6},{version:7},{version:8},{version:9},{version:10},{version:11},{version:12},{version:13},{version:14},{version:15},{version:16},{version:17}]);expect(state.storage.sql.exec('SELECT record_id FROM preferences').toArray()).toHaveLength(2);});
});
it('owner_event_projection_rechecks_current_scopes_and_session_before_projection',async()=>{
 const {stub,name}=await settingsFixture('settings-event-authority');await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),a=actor(state.storage,id),body={expected_preferences_revision:0,preferences:preference};executeCommand(await commandContext(state.storage,name,body,'event'),id,preferencesCommand('pref_'+'7'.repeat(32)),body);
 const event=state.storage.sql.exec<{id:string}>("SELECT id FROM events WHERE type='preferences.updated'").one();
 state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"events:read\"]'");
 expect(withTransaction(state.storage,tx=>projectEvent(tx,a,event.id,Date.now(),settingsEventVisibility))).toBeNull();
 state.storage.sql.exec("UPDATE sessions SET revoked_at=?",Date.now());
 expect(()=>withTransaction(state.storage,tx=>projectEvent(tx,a,event.id,Date.now(),settingsEventVisibility))).toThrow();
 });
});


it('profile_cannot_change_grants_or_catalog',async()=>{
 const {stub,name}=await settingsFixture('settings-authority-isolation');await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),p=read(state.storage,id),authority=()=>Object.fromEntries(['workspace_metadata','human_grants','native_credentials','static_agents'].map(table=>[table,state.storage.sql.exec('SELECT * FROM '+table).toArray()])),before=authority(),body={expected_profile_revision:1,profile:{...p.profile,display_name:'Visual rename'}};
 executeCommand(await commandContext(state.storage,name,body,'visual'),id,profileCommand(),body);expect(authority()).toEqual(before);
 });
});
it('stale_preview_apply_conflicts',async()=>{
 const {stub,name}=await settingsFixture('settings-stale-preview');await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),a=actor(state.storage,id),p=read(state.storage,id),body={expected_profile_revision:1,profile:{...p.profile,display_name:'Proposed'}};
 const preview=withTransaction(state.storage,tx=>previewProfile(tx,{actor:a,requestId:'preview',idempotencyKey:'preview',nowMs:Date.now()},body));expect(preview.base_revision).toBe(1);
 const competing={...body,profile:{...body.profile,display_name:'Competing'}};executeCommand(await commandContext(state.storage,name,competing,'competing'),id,profileCommand(),competing);
 const before=snapshot(state.storage),ctx=await commandContext(state.storage,name,body,'stale');expect(()=>executeCommand(ctx,id,profileCommand(),body)).toThrowError(expect.objectContaining({code:'VERSION_CONFLICT',status:409,details:{current_revision:2}}));expect(snapshot(state.storage)).toEqual(before);
 });
});
it('profile_event_matches_closed_schema',async()=>{
 const {stub,name}=await settingsFixture('settings-profile-schema');await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),a=actor(state.storage,id),p=read(state.storage,id),body={expected_profile_revision:1,profile:{...p.profile,branding:{accent:'teal' as const}}};
 executeCommand(await commandContext(state.storage,name,body,'schema'),id,profileCommand(),body);const row=state.storage.sql.exec<{id:string}>("SELECT id FROM events WHERE type='profile.updated'").one(),event=withTransaction(state.storage,tx=>projectEvent(tx,a,row.id,Date.now(),settingsEventVisibility));expect(validateEvent(event)).toBe(true);expect(event).toMatchObject({resource_version:2,resource_id:'ws_example',task_version:null,run_id:null,fence:null,thread_id:null,request_id:'request_schema'});expect(validateEvent({...event,thread_id:'foreign'})).toBe(false);
 });
});
it('preference_event_visible_only_to_owner',async()=>{
 const {stub,name}=await settingsFixture('settings-owner-only');await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),owner=actor(state.storage,id),other=actor(state.storage,human(state.storage,true)),body={expected_preferences_revision:0,preferences:preference};executeCommand(await commandContext(state.storage,name,body,'owner'),id,preferencesCommand('pref_'+'8'.repeat(32)),body);
 const row=state.storage.sql.exec<{id:string}>("SELECT id FROM events WHERE type='preferences.updated'").one();expect(withTransaction(state.storage,tx=>projectEvent(tx,owner,row.id,Date.now(),settingsEventVisibility))).not.toBeNull();expect(withTransaction(state.storage,tx=>projectEvent(tx,other,row.id,Date.now(),settingsEventVisibility))).toBeNull();
 });
});
it('preference_replay_does_not_republish_effective_values_disallowed_by_current_policy',async()=>{
 const {stub,name}=await settingsFixture('settings-replay-policy');await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),body={expected_preferences_revision:0,preferences:{...preference,theme:'dark' as const}},ctx=await commandContext(state.storage,name,body,'original');executeCommand(ctx,id,preferencesCommand('pref_'+'9'.repeat(32)),body);
 const row=state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one(),config=JSON.parse(row.config_json);config.workspace_policies[0].allowed_user_overrides=[];state.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',JSON.stringify(config));const before=snapshot(state.storage);
 expect(()=>executeCommand(ctx,id,preferencesCommand('pref_'+'0'.repeat(32)),body)).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));expect(snapshot(state.storage)).toEqual(before);
 expect(withTransaction(state.storage,tx=>readPreferences(tx,actor(state.storage,id))).effective.theme).toBe('system');
 });
});

it('event_visibility_thenable_fails_closed_and_rolls_back',async()=>{
 const {stub}=await settingsFixture('settings-visibility-thenable');await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),a=actor(state.storage,id),before=snapshot(state.storage);let rejection:Promise<never>|undefined,error:unknown,result:unknown;
 const bad=((tx:import('../../src/storage/transaction').WorkspaceTransaction)=>{tx.exec("INSERT INTO threads (id,workspace_id,subject,created_at) VALUES ('visibility_probe','ws_example','probe',1)");return rejection=Promise.reject(Error('private_canary_visibility'));}) as unknown as import('../../src/audit/events').EventVisibility;
 try{result=withTransaction(state.storage,tx=>projectEvent(tx,a,'configuration_1',Date.now(),bad));}catch(caught){error=caught;}
 if(!error)void rejection?.catch(()=>{});
 expect(error).toMatchObject({code:'INTERNAL_ERROR',status:500});expect(result).toBeUndefined();expect(snapshot(state.storage)).toEqual(before);expect(state.storage.sql.exec("SELECT id FROM threads WHERE id='visibility_probe'").toArray()).toEqual([]);await new Promise(resolve=>setTimeout(resolve,0));
 });
});

it.each(['overview','agents','activity','inbox','tasks','kanban','approvals'] as const)('default_view_%s_preserves_portable_intent_and_reports_availability',async default_view=>{
 const {stub,name}=await settingsFixture('settings-view-'+default_view);await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),body={expected_preferences_revision:0,preferences:{...preference,default_view}},view=executeCommand(await commandContext(state.storage,name,body,'view'),id,preferencesCommand('pref_'+'b'.repeat(32)),body).data,available=['overview','activity'].includes(default_view);
 expect(view.preferences.default_view).toBe(default_view);expect(view.effective.default_view).toBe(available?default_view:'overview');expect(view.default_view_fallback_reason).toBe(available?null:'VIEW_UNAVAILABLE');
 if(default_view==='activity'){state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"workspace:read\"]'");expect(withTransaction(state.storage,tx=>readPreferences(tx,actor(state.storage,id)))).toMatchObject({preferences:{default_view:'activity'},effective:{default_view:'overview'},default_view_fallback_reason:'VIEW_UNAVAILABLE'});}
 });
});
it('profile_navigation_hides_activity_preference_without_changing_stored_intent',async()=>{
 const {stub,name}=await settingsFixture('settings-navigation-activity');
 await runInDurableObject(stub,async(_o,state)=>{
  const id=human(state.storage),initial=read(state.storage,id);
  const preferences={expected_preferences_revision:0,preferences:{...preference,default_view:'activity' as const}};
  const saved=executeCommand(await commandContext(state.storage,name,preferences,'activity-pref'),id,preferencesCommand('pref_'+'e'.repeat(32)),preferences).data;
  expect(saved.effective.default_view).toBe('activity');
  const restricted={expected_profile_revision:1,profile:{...initial.profile,navigation:{visible_views:['overview' as const]}}};
  executeCommand(await commandContext(state.storage,name,restricted,'profile-nav'),id,profileCommand(),restricted);
  const result=withTransaction(state.storage,tx=>readPreferences(tx,actor(state.storage,id)));
  expect(result).toMatchObject({preferences:{default_view:'activity'},effective:{default_view:'overview'},default_view_fallback_reason:'VIEW_UNAVAILABLE'});
 });
});
it('profile_restoration_is_new_revision_and_keeps_later_stable_ids',async()=>{
 const {stub,name}=await settingsFixture('settings-profile-restore');await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),initial=read(state.storage,id);
 for(const [index,recordId]of ['project_one','project_two'].entries()){const body={expected_profile_revision:index+1,profile:{...initial.profile,projects:[{id:recordId,display_name:'Same label',description:'',archived:false}]}};executeCommand(await commandContext(state.storage,name,body,'generation'+index),id,profileCommand(),body);}
 const restoration={expected_profile_revision:3,profile:initial.profile},restored=executeCommand(await commandContext(state.storage,name,restoration,'restore'),id,profileCommand(),restoration).data;
 expect(restored.profile_revision).toBe(4);expect(restored.profile.projects.map(x=>x.id)).toEqual(['project_one','project_two']);expect(state.storage.sql.exec("SELECT count(*) AS n FROM events WHERE type='profile.updated'").one().n).toBe(3);
 });
});
it('preference_policy_order_does_not_change_replay_authority',async()=>{
 const {stub,name}=await settingsFixture('settings-policy-order');await runInDurableObject(stub,async(_o,state)=>{const id=human(state.storage),body={expected_preferences_revision:0,preferences:{...preference,theme:'dark' as const}},ctx=await commandContext(state.storage,name,body,'ordered'),original=executeCommand(ctx,id,preferencesCommand('pref_'+'c'.repeat(32)),body);
 const row=state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one(),config=JSON.parse(row.config_json);config.workspace_policies[0].allowed_user_overrides.reverse();state.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',JSON.stringify(config));const before=snapshot(state.storage);
 expect(executeCommand(ctx,id,preferencesCommand('pref_'+'d'.repeat(32)),body)).toEqual(original);expect(snapshot(state.storage)).toEqual(before);
 });
});
