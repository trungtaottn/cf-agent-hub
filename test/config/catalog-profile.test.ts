import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {settingsFixture,human,actor} from '../helpers/settings';
import {withTransaction} from '../../src/storage/transaction';
import {neutralProfile,previewProfile,applyProfile} from '../../src/config/profile';
const record=(id:string,archived=false)=>({id,display_name:'Same',description:'',archived});
it('ordinary_profile_import_cannot_archive_or_reactivate_even_unreferenced_ids',async()=>{
 const {stub}=await settingsFixture('catalog-profile-guards');await runInDurableObject(stub,(_o,state)=>{
  const ctx={actor:actor(state.storage,human(state.storage)),nowMs:Date.now(),requestId:'preview',idempotencyKey:'preview'};
  withTransaction(state.storage,tx=>applyProfile(tx,ctx,{expected_profile_revision:1,profile:{...neutralProfile,projects:[record('project_a')]}}));
  const attempt=(projects:ReturnType<typeof record>[])=>withTransaction(state.storage,tx=>applyProfile(tx,ctx,{expected_profile_revision:2,profile:{...neutralProfile,projects}}));
  expect(()=>attempt([record('project_a',true)])).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
  expect(()=>attempt([record('project_new',true)])).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
  state.storage.sql.exec("UPDATE profiles SET document_json=json_set(document_json,'$.projects[0].archived',json('true'))");
  expect(()=>attempt([record('project_a',false)])).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
  expect(attempt([]).profile.projects).toEqual([record('project_a',true)]);
 });
});
it('duplicate_labels_are_advisory_but_duplicate_ids_reject_and_omitted_ids_survive',async()=>{
 const {stub}=await settingsFixture('catalog-profile-labels');await runInDurableObject(stub,(_o,state)=>{
  const ctx={actor:actor(state.storage,human(state.storage)),nowMs:Date.now(),requestId:'preview',idempotencyKey:'preview'},body={expected_profile_revision:1,profile:{...neutralProfile,projects:[record('project_a'),record('project_b')]}};
  expect(withTransaction(state.storage,tx=>previewProfile(tx,ctx,body)).conflicts).toEqual([{field:'/projects/1/display_name',code:'DUPLICATE_NAME'}]);
  expect(withTransaction(state.storage,tx=>applyProfile(tx,ctx,body)).profile.projects).toHaveLength(2);
  const next={expected_profile_revision:2,profile:{...neutralProfile,projects:[{...record('project_a'),display_name:'Renamed'}]}};
  expect(withTransaction(state.storage,tx=>applyProfile(tx,ctx,next)).profile.projects.map(x=>x.id)).toEqual(['project_a','project_b']);
  expect(()=>withTransaction(state.storage,tx=>applyProfile(tx,ctx,{...next,expected_profile_revision:3,profile:{...next.profile,projects:[record('project_a'),record('project_a')]}}))).toThrowError(expect.objectContaining({code:'INVALID_REQUEST'}));
 });
});
