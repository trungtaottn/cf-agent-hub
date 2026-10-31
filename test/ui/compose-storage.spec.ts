import {buildSync} from 'esbuild';
import {test,expect,appOrigin} from '../helpers/browser';
import type * as StoreModule from '../../src/ui/compose/draft-store';
declare global {interface Window {composeTest:typeof StoreModule;}}
// Synthetic same-origin storage page, not product UI/login or server acceptance.
const script=buildSync({entryPoints:['src/ui/compose/draft-store.ts'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'composeTest',target:'es2022',logLevel:'silent'}).outputFiles[0]!.text;
test.beforeEach(async({page,context})=>{
 await context.route(appOrigin+'/__compose_storage__.js',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await context.route(appOrigin+'/__compose_storage__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic IndexedDB fixture</title><script src="/__compose_storage__.js"></script>'}));
 await page.goto(appOrigin+'/__compose_storage__');await page.waitForFunction(()=>!!window.composeTest);
});
test('actual_indexeddb_two_connections_commit_one_dispatch_and_reopen_exact_intent',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {DraftStore,IndexedComposeDatabase}=window.composeTest,scope={workspaceId:'ws',principalId:'storage_race'};
  const db1=new IndexedComposeDatabase(),db2=new IndexedComposeDatabase(),a=new DraftStore(db1),b=new DraftStore(db2),x=await a.bind(scope),y=await b.bind(scope);
  await a.save(x,'draft','createTask',{title:'Original',description:''});const [i,j]=await Promise.all([a.admit(x,'draft','key_a'),b.admit(y,'draft','key_b')]);
  await a.freezeAdmission(x,'draft',i,{admission_id:'event_'+'a'.repeat(48),expires_at:'2030-01-01T00:00:00Z'});
  const claims=await Promise.all([a.claimDispatch(x,'draft',i.key),b.claimDispatch(y,'draft',j.key)]);await a.save(x,'draft','createTask',{title:'Edited',description:''});await db1.close();await db2.close();
  const db3=new IndexedComposeDatabase(),c=new DraftStore(db3),z=await c.bind(scope),entry=await c.load(z,'draft');await c.clearScope(z);await db3.close();return {same:i.key===j.key,claims,entry};
 });
 expect(result.same).toBe(true);expect(result.claims.filter(Boolean)).toHaveLength(1);expect(result.entry?.intent?.status).toBe('uncertain');expect(result.entry?.intent?.bodyJson).toContain('Original');expect(result.entry?.draft?.bodyJson).toContain('Edited');
});
test('actual_indexeddb_scope_logout_fences_old_connection_and_retains_other_principal',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {DraftStore,IndexedComposeDatabase}=window.composeTest,db1=new IndexedComposeDatabase(),db2=new IndexedComposeDatabase(),a=new DraftStore(db1),b=new DraftStore(db2),scope={workspaceId:'ws',principalId:'logout_owner'};
  const x=await a.bind(scope),old=await b.bind(scope),other=await b.bind({...scope,principalId:'other_owner'});await a.save(x,'draft','createTask',{title:'Private',description:''});await b.save(other,'draft','createTask',{title:'Other',description:''});await a.clearScope(x);let error='';try{await b.save(old,'draft','createTask',{title:'Resurrection',description:''});}catch(e){error=(e as Error).message;}
  const fresh=await a.bind(scope),entry=await a.load(fresh,'draft'),otherEntry=await b.load(other,'draft');await b.clearScope(other);await db1.close();await db2.close();return {error,entry,otherEntry};
 });
 expect(result.error).toBe('SCOPE_CHANGED');expect(result.entry).toBeNull();expect(result.otherEntry?.draft?.bodyJson).toContain('Other');
});
test('actual_indexeddb_abort_rolls_back_admission_before_completion',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {DraftStore,IndexedComposeDatabase}=window.composeTest,db=new IndexedComposeDatabase(),store=new DraftStore(db),scope={workspaceId:'ws',principalId:'abort_owner'},b=await store.bind(scope);await store.save(b,'draft','createTask',{title:'Kept',description:''});let error='';try{await db.transact(scope,raw=>{const record=raw as StoreModule.ScopeRecord;record.entries={};throw Error('synthetic_abort');});}catch(e){error=(e as Error).message;}const entry=await store.load(b,'draft');await store.clearScope(b);await db.close();return {error,entry};
 });
 expect(result.error).toBe('synthetic_abort');expect(result.entry?.draft?.bodyJson).toContain('Kept');expect(result.entry?.intent).toBeNull();
});

test('actual_page_reload_retains_uncertain_identity_without_dispatch',async({page})=>{
 const before=await page.evaluate(async()=>{const {DraftStore,IndexedComposeDatabase}=window.composeTest,db=new IndexedComposeDatabase(),store=new DraftStore(db),b=await store.bind({workspaceId:'ws',principalId:'reload_owner'});await store.save(b,'draft','createTask',{title:'Reload exact',description:''});const intent=await store.admit(b,'draft','reload_key');await store.freezeAdmission(b,'draft',intent,{admission_id:'event_'+'a'.repeat(48),expires_at:'2030-01-01T00:00:00Z'});await store.claimDispatch(b,'draft',intent.key);await db.close();return intent;});
 await page.reload();await page.waitForFunction(()=>!!window.composeTest);
 const after=await page.evaluate(async()=>{const {DraftStore,IndexedComposeDatabase}=window.composeTest,db=new IndexedComposeDatabase(),store=new DraftStore(db),b=await store.bind({workspaceId:'ws',principalId:'reload_owner'}),entry=await store.load(b,'draft');await store.clearScope(b);await db.close();return entry;});
 expect(after?.intent?.key).toBe(before.key);expect(after?.intent?.bodyJson).toBe(before.bodyJson);expect(after?.intent?.status).toBe('uncertain');
});
test('actual_two_tabs_share_one_transactional_dispatch_claim',async({page,context})=>{
 await page.evaluate(async()=>{const {DraftStore,IndexedComposeDatabase}=window.composeTest,db=new IndexedComposeDatabase(),store=new DraftStore(db),b=await store.bind({workspaceId:'ws',principalId:'tabs_owner'});await store.save(b,'draft','createTask',{title:'Two tabs',description:''});const intent=await store.admit(b,'draft','tabs_key');await store.freezeAdmission(b,'draft',intent,{admission_id:'event_'+'a'.repeat(48),expires_at:'2030-01-01T00:00:00Z'});await db.close();});
 const second=await context.newPage();await second.goto(appOrigin+'/__compose_storage__');await second.waitForFunction(()=>!!window.composeTest);
 const claim=async()=>{const {DraftStore,IndexedComposeDatabase}=window.composeTest,db=new IndexedComposeDatabase(),store=new DraftStore(db),b=await store.bind({workspaceId:'ws',principalId:'tabs_owner'});const result=await store.claimDispatch(b,'draft','tabs_key');await db.close();return result;};
 const results=await Promise.all([page.evaluate(claim),second.evaluate(claim)]);expect(results.filter(Boolean)).toHaveLength(1);
 await page.evaluate(async()=>{const {DraftStore,IndexedComposeDatabase}=window.composeTest,db=new IndexedComposeDatabase(),store=new DraftStore(db),b=await store.bind({workspaceId:'ws',principalId:'tabs_owner'});await store.clearScope(b);await db.close();});await second.close();
});
