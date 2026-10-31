import {describe,it,expect,vi} from 'vitest';
import {DraftStore,IndexedComposeDatabase} from '../../src/ui/compose/draft-store';
import {MemoryComposeDatabase} from '../helpers/compose-memory';
import {canonicalBody} from '../../packages/client/src/native-request';
const scope={workspaceId:'ws',principalId:'human_one'};
const body={title:'First draft',description:''};
const admission={admission_id:'event_'+'a'.repeat(48),expires_at:'2030-01-01T00:00:00Z'};
describe('scoped transactional draft and intent contract (memory adapter, not browser persistence proof)',()=>{
 it('keeps immutable admitted bytes separate from later edits and one winning dispatch',async()=>{
  const db=new MemoryComposeDatabase(),a=new DraftStore(db),b=new DraftStore(db);
  const x=await a.bind(scope),y=await b.bind(scope);await a.save(x,'task','createTask',body);
  const [one,two]=await Promise.all([a.admit(x,'task','key_one'),b.admit(y,'task','key_two')]);
  expect(one.key).toBe(two.key);expect(one.bodyJson).toBe(canonicalBody(body));
  await a.save(x,'task','createTask',{...body,title:'Edited draft'});
  expect((await a.load(x,'task'))?.intent?.bodyJson).toBe(canonicalBody(body));
  expect((await a.load(x,'task'))?.draft?.bodyJson).toContain('Edited draft');
  await a.freezeAdmission(x,'task',one,admission);
  expect(await Promise.all([a.claimDispatch(x,'task',one.key),b.claimDispatch(y,'task',one.key)])).toEqual([true,false]);
  expect((await b.load(y,'task'))?.intent?.status).toBe('uncertain');
 });
 it('logout clears scoped data and stale bindings cannot resurrect it',async()=>{
  const db=new MemoryComposeDatabase(),store=new DraftStore(db),a=await store.bind(scope),other=await store.bind({...scope,principalId:'other'});
  await store.save(a,'task','createTask',body);await store.save(other,'task','createTask',{...body,title:'Other'});
  await store.clearScope(a);
  await expect(store.save(a,'task','createTask',body)).rejects.toThrow('SCOPE_CHANGED');
  const fresh=await store.bind(scope);expect(await store.load(fresh,'task')).toBeNull();expect((await store.load(other,'task'))?.draft?.bodyJson).toContain('Other');
 });
 it('rejects unknown authority fields before persistence but keeps empty editable text',async()=>{
  const db=new MemoryComposeDatabase(),store=new DraftStore(db),binding=await store.bind(scope);
  await expect(store.save(binding,'task','createTask',{...body,csrf_token:'actual-secret'})).rejects.toThrow();
  expect(await store.load(binding,'task')).toBeNull();await store.save(binding,'task','createTask',{title:'',description:''});
  await expect(store.admit(binding,'task','key')).rejects.toThrow('INVALID_REQUEST');
  expect((await store.load(binding,'task'))?.draft?.bodyJson).toBe('{"description":"","title":""}');
 });
 it('discard does not cancel an unresolved intent or free its identity',async()=>{
  const store=new DraftStore(new MemoryComposeDatabase()),binding=await store.bind(scope);await store.save(binding,'task','createTask',body);
  const intent=await store.admit(binding,'task','key');await store.freezeAdmission(binding,'task',intent,admission);await store.claimDispatch(binding,'task',intent.key);await store.discard(binding,'task');
  expect((await store.load(binding,'task'))?.draft).toBeNull();expect((await store.load(binding,'task'))?.intent?.status).toBe('uncertain');
  await expect(store.acknowledge(binding,'task')).rejects.toThrow('RECONCILIATION_REQUIRED');
 });
 it('unknown schema/corrupt persisted state is rejected without silently clearing evidence',async()=>{
  const db=new MemoryComposeDatabase();db.inject(scope,{version:99,epoch:0,entries:{}});
  await expect(new DraftStore(db).bind(scope)).rejects.toThrow('STORAGE_CORRUPT');expect(db.inspect(scope)).toMatchObject({version:99});
 });
 it('transaction failure does not admit an intent or permit dispatch',async()=>{
  const db=new MemoryComposeDatabase(),store=new DraftStore(db),binding=await store.bind(scope);await store.save(binding,'task','createTask',body);
  db.failNext=true;await expect(store.admit(binding,'task','key')).rejects.toThrow('STORAGE_UNAVAILABLE');expect((await store.load(binding,'task'))?.intent).toBeNull();
 });
 it('discard then new edit never reuses the admitted revision or erases new text on acknowledge',async()=>{
  const store=new DraftStore(new MemoryComposeDatabase()),b=await store.bind(scope);await store.save(b,'task','createTask',body);const i=await store.admit(b,'task','key');await store.freezeAdmission(b,'task',i,admission);await store.claimDispatch(b,'task',i.key);await store.discard(b,'task');await store.save(b,'task','createTask',{...body,title:'New text after discard'});await store.settle(b,'task',i.key,'confirmed','task_one');await store.acknowledge(b,'task');expect((await store.load(b,'task'))?.draft?.bodyJson).toContain('New text after discard');
 });
 it('logout erases corrupt records and fences stale bindings without interpreting their payload',async()=>{
  const db=new MemoryComposeDatabase(),store=new DraftStore(db),b=await store.bind(scope);db.inject(scope,{version:99,epoch:b.epoch,entries:{secret:'corrupt-private-text'}});await store.clearScope(b);expect(JSON.stringify(db.inspect(scope))).not.toContain('corrupt-private-text');await expect(store.load(b,'task')).rejects.toThrow('SCOPE_CHANGED');
 });

 it('supports opaque principal and entity IDs without treating them as object keys',async()=>{
  const store=new DraftStore(new MemoryComposeDatabase()),b=await store.bind({...scope,principalId:'human.name@example.invalid'});await store.save(b,'task','createTask',body);const intent=await store.admit(b,'task','key');await store.freezeAdmission(b,'task',intent,admission);await store.claimDispatch(b,'task',intent.key);await store.settle(b,'task',intent.key,'confirmed','task:opaque.id');expect((await store.load(b,'task'))?.intent?.entityId).toBe('task:opaque.id');
 });
 it('allows deliberate prepared correction but cannot erase an uncertain competing claim',async()=>{
  const store=new DraftStore(new MemoryComposeDatabase()),b=await store.bind(scope);await store.save(b,'task','createTask',body);const intent=await store.admit(b,'task','first_key');await store.abandonPrepared(b,'task',intent.key);await store.save(b,'task','createTask',{...body,title:'Corrected'});const next=await store.admit(b,'task','second_key');await store.freezeAdmission(b,'task',next,admission);await store.claimDispatch(b,'task',next.key);await expect(store.abandonPrepared(b,'task',next.key)).rejects.toThrow('RECONCILIATION_REQUIRED');expect((await store.load(b,'task'))?.intent?.key).toBe('second_key');
 });

 it('blocked database open fails once and closes eventual success without a hidden retry',async()=>{
  const close=vi.fn(),createObjectStore=vi.fn(),abort=vi.fn();const request={result:{close,createObjectStore,onversionchange:null},transaction:{abort},onblocked:null as null|(()=>void),onsuccess:null as null|(()=>void),onupgradeneeded:null as null|(()=>void)};const open=vi.fn(()=>request);const db=new IndexedComposeDatabase({open} as unknown as IDBFactory);const outcome=db.close().catch(error=>(error as Error).message);request.onblocked!();request.onupgradeneeded!();request.onsuccess!();expect(await outcome).toBe('STORAGE_UNAVAILABLE');expect(open).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);expect(abort).toHaveBeenCalledTimes(1);expect(createObjectStore).not.toHaveBeenCalled();
 });

});
it('concurrent scoped clears accept only a validated higher-epoch empty tombstone',async()=>{const db=new MemoryComposeDatabase(),store=new DraftStore(db),b=await store.bind(scope);await store.clearScope(b);await expect(store.clearScope(b)).resolves.toBeNull();const next=await store.bind(scope);await store.save(next,'task','createTask',{title:'Fresh',description:''});await expect(store.clearScope(b)).rejects.toThrow('SCOPE_CHANGED');expect((await store.load(next,'task'))?.draft?.bodyJson).toContain('Fresh');});
it('stale erase cannot accept corrupt or wrong-scope empty tombstone',async()=>{for(const corrupt of [{version:99},{principalId:'other_owner'}]){const db=new MemoryComposeDatabase(),store=new DraftStore(db),b=await store.bind(scope);db.inject(scope,{version:2,...scope,epoch:b.epoch+1,entries:{},...corrupt});await expect(store.clearScope(b)).rejects.toThrow();}});
