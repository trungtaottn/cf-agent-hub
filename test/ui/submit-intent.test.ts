import {describe,it,expect,vi} from 'vitest';
import {HubClient} from '../../packages/client/src/client';
import {SubmitController} from '../../src/ui/compose/submit-intent';
import {DraftStore} from '../../src/ui/compose/draft-store';
import {MemoryComposeDatabase} from '../helpers/compose-memory';
const scope={workspaceId:'ws',principalId:'human_one',generation:1};
const task={title:'First',description:''};
function fixture(){const db=new MemoryComposeDatabase(),store=new DraftStore(db);let current:typeof scope|null={...scope};const send=vi.fn(async()=>({ok:true as const,status:201,data:{id:'task_one',workspace_id:'ws'},requestId:'request_one'}));const validate=vi.fn(async()=>true);const controller=new SubmitController({draftId:'task',store,currentBinding:()=>current,revalidate:validate,send:send as never,newKey:()=>crypto.randomUUID()});return {db,store,send,validate,controller,setCurrent:(x:typeof scope|null)=>{current=x;}};}
describe('durable submission controller (synthetic transport, not server acceptance)',()=>{
 it('double submit shares identity and dispatches only after persisted uncertainty marker',async()=>{
  const f=fixture();await f.controller.open();await f.controller.save('createTask',task);
  f.send.mockImplementation(async()=>{const b=await f.store.bind(scope);expect((await f.store.load(b,'task'))?.intent?.status).toBe('uncertain');return {ok:true,status:201,data:{id:'task_one',workspace_id:'ws'},requestId:'request_one'};});
  await Promise.all([f.controller.submit(),f.controller.submit()]);expect(f.send).toHaveBeenCalledTimes(1);expect(f.controller.state.status).toBe('confirmed');
  await f.controller.submit();expect(f.send).toHaveBeenCalledTimes(1);
 });
 it('storage failure prevents network and retains editable text',async()=>{
  const f=fixture();await f.controller.open();await f.controller.save('createTask',task);f.db.failNext=true;await f.controller.submit();expect(f.send).not.toHaveBeenCalled();expect(f.controller.state.status).toBe('storage-error');
 });
 it('unknown response and reload retain original key and never automatically replay',async()=>{
  const f=fixture();await f.controller.open();await f.controller.save('createTask',task);f.send.mockRejectedValue(Error('response lost'));await f.controller.submit();
  expect(f.controller.state.status).toBe('reconciliation-required');const original=f.controller.state.entry!.intent!.key;
  await f.controller.save('createTask',{...task,title:'Edited'});await f.controller.open();await f.controller.submit();expect(f.send).toHaveBeenCalledTimes(1);expect(f.controller.state.entry!.intent!.key).toBe(original);expect(f.controller.state.entry!.draft!.bodyJson).toContain('Edited');
 });
 it('current authority/reference denial is zero-send and preserves editable data',async()=>{
  const f=fixture();await f.controller.open();await f.controller.save('createTask',task);f.validate.mockResolvedValue(false);await f.controller.submit();expect(f.send).not.toHaveBeenCalled();expect(f.controller.state.status).toBe('revalidation-required');expect(f.controller.state.entry!.draft).not.toBeNull();
 });
 it('logout during current-access revalidation fences dispatch and clears records',async()=>{
  const f=fixture();await f.controller.open();await f.controller.save('createTask',task);let resolve!:(v:boolean)=>void;f.validate.mockImplementation(()=>new Promise(r=>{resolve=r;}));const request=f.controller.submit();await vi.waitFor(()=>expect(f.validate).toHaveBeenCalled());f.setCurrent(null);await f.controller.logout();resolve(true);await request;expect(f.send).not.toHaveBeenCalled();expect(f.controller.state.status).toBe('inactive');const b=await f.store.bind(scope);expect(await f.store.load(b,'task')).toBeNull();
 });
 it('success whose durable receipt fails stays unresolved instead of minting a new request',async()=>{
  const f=fixture();await f.controller.open();await f.controller.save('createTask',task);f.send.mockImplementation(async()=>{f.db.failNext=true;return {ok:true,status:201,data:{id:'task_one',workspace_id:'ws'},requestId:'request_one'};});await f.controller.submit();expect(f.controller.state.status).toBe('storage-error');await f.controller.open();await f.controller.submit();expect(f.send).toHaveBeenCalledTimes(1);expect(f.controller.state.status).toBe('reconciliation-required');
 });
 it.each(['invalid','competing','pending'] as const)('logout while %s result load is pending never republishes private state',async branch=>{
  const f=fixture();await f.controller.open();await f.controller.save('createTask',task);if(branch==='invalid')f.validate.mockResolvedValue(false);if(branch==='competing')vi.spyOn(f.store,'claimDispatch').mockResolvedValue(false);
  const original=f.store.load.bind(f.store);let count=0,release!:()=>void,arrived!:()=>void;const gate=new Promise<void>(r=>{arrived=r;});const blocked=new Promise<void>(r=>{release=r;});
  vi.spyOn(f.store,'load').mockImplementation(async(...args)=>{const result=await original(...args);if(++count===2){arrived();await blocked;}return result;});
  const pending=f.controller.submit();await gate;f.setCurrent(null);await f.controller.logout();release();await pending;expect(f.controller.state).toEqual({status:'inactive',entry:null});expect(f.send).not.toHaveBeenCalled();
 });
 it('explicit review releases only prepared invalid input, never unresolved dispatch',async()=>{
  const f=fixture();await f.controller.open();await f.controller.save('createTask',task);f.validate.mockResolvedValue(false);await f.controller.submit();await f.controller.reviewPrepared();await f.controller.save('createTask',{...task,title:'Corrected'});f.validate.mockResolvedValue(true);await f.controller.submit();expect(f.send).toHaveBeenCalledTimes(1);expect((f.send.mock.calls[0] as unknown[])[1]).toMatchObject({body:{title:'Corrected'}});
 });

 it('uses actual browser CSRF only in transport and never persists transport credentials/options',async()=>{
  const db=new MemoryComposeDatabase(),store=new DraftStore(db),secret='actual_used_fixture_csrf';const fetch=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{expect(new Headers(init?.headers).get('x-csrf-token')).toBe(secret);return Response.json({error:{code:'FORBIDDEN',message:'Denied',retryable:false,request_id:'req_denied'}},{status:403});});const client=new HubClient('ws',{fetch});client.setCsrfToken(secret);
  const controller=new SubmitController({draftId:'task',store,currentBinding:()=>scope,revalidate:async()=>true,send:client.compose.bind(client)});await controller.open();await controller.save('createTask',task);await controller.submit();expect(fetch).toHaveBeenCalledTimes(1);const persisted=JSON.stringify(db.inspect(scope));expect(persisted).not.toContain(secret);expect(persisted).not.toContain('x-csrf-token');expect(persisted).not.toContain('headers');expect(persisted).toContain('First');
 });

});

it('exposes explicit retained-admission recovery separately from submit',()=>{expect(fixture().controller.reconcile).toBeTypeOf('function');});
const retainedTask={id:'task_one',workspace_id:'ws',title:'First',description:'',state:'backlog',task_version:1,proposal_version:0,project_id:null,work_role_id:null,assigned_agent_id:null,active_run_id:null,latest_run_id:null,approval_id:null,result:null,retry_count:0,retry_limit:2,flags:[],created_at:'2026-10-27T00:00:00Z',updated_at:'2026-10-27T00:00:00Z'};
async function recovery(){
 const db=new MemoryComposeDatabase(),store=new DraftStore(db);let current:typeof scope|null={...scope};
 const send=vi.fn(async()=>{throw Error('committed response lost (synthetic transport)');}),lookup=vi.fn(async()=>({ok:true as const,status:200,data:{status:'confirmed' as const,task:retainedTask},requestId:'lookup'})),revalidate=vi.fn(async()=>true);
 const options={draftId:'task',store,currentBinding:()=>current,revalidate,send:send as never,reconcile:lookup as never};
 const controller=new SubmitController(options);await controller.open();await controller.save('createTask',task);await controller.submit();await controller.open();
 return {db,store,controller,lookup,send,revalidate,options,setCurrent:(value:typeof scope|null)=>{current=value;}};
}
it('recovery sends only frozen original identity and preserves later draft while settling confirmed',async()=>{
 const f=await recovery(),intent=f.controller.state.entry!.intent!;await f.controller.save('createTask',{...task,title:'Later draft'});
 expect(await f.controller.reconcile()).toEqual(retainedTask);expect(f.lookup.mock.calls[0]).toEqual(['createTask',{body:task},{idempotencyKey:intent.key}]);expect(f.send).toHaveBeenCalledTimes(1);expect(f.controller.state.status).toBe('confirmed');expect(f.controller.state.entry!.draft!.bodyJson).toContain('Later draft');
});
it.each([null,401,403,404,409,503])('lookup failure %s never rejects or replaces the original intent',async status=>{
 const f=await recovery(),intent=f.controller.state.entry!.intent!;f.lookup.mockResolvedValue({ok:false,status,error:{code:'FORBIDDEN',message:'Unavailable',retryable:false},requestId:'lookup'} as never);await f.controller.reconcile();expect(f.controller.state.status).toBe('reconciliation-required');expect(f.controller.state.entry!.intent).toEqual(intent);await f.controller.submit();expect(f.send).toHaveBeenCalledTimes(1);
});
it.each([{status:'unknown'},{status:'unknown',task:retainedTask},{status:'confirmed',task:{...retainedTask,workspace_id:'foreign'}}])('unknown or malformed/foreign lookup remains unresolved: %j',async data=>{
 const f=await recovery(),intent=f.controller.state.entry!.intent!;f.lookup.mockResolvedValue({ok:true,status:200,data,requestId:'lookup'} as never);expect(await f.controller.reconcile()).toBeNull();expect(f.controller.state.status).toBe('reconciliation-required');expect(f.controller.state.entry!.intent).toEqual(intent);
});
it('concurrent controllers accept an already-identical confirmation without duplicate creation',async()=>{
 const f=await recovery(),second=new SubmitController(f.options);await second.open();await Promise.all([f.controller.reconcile(),second.reconcile()]);expect(f.controller.state.status).toBe('confirmed');expect(second.state.status).toBe('confirmed');expect(f.send).toHaveBeenCalledTimes(1);
});
it('logout fences a delayed lookup and prevents erased epoch resurrection',async()=>{
 const f=await recovery();let release!:(x:unknown)=>void;f.lookup.mockImplementation(()=>new Promise(r=>{release=r;}) as never);const pending=f.controller.reconcile();await vi.waitFor(()=>expect(f.lookup).toHaveBeenCalled());f.setCurrent(null);await f.controller.logout();release({ok:true,status:200,data:{status:'confirmed',task:retainedTask},requestId:'late'});expect(await pending).toBeNull();expect(f.controller.state).toEqual({status:'inactive',entry:null});const b=await f.store.bind(scope);expect(await f.store.load(b,'task')).toBeNull();
});
it('late lookup cannot settle a replaced same-key body or acknowledged intent',async()=>{
 const f=await recovery();let release!:(x:unknown)=>void;f.lookup.mockImplementation(()=>new Promise(r=>{release=r;}) as never);const pending=f.controller.reconcile();await vi.waitFor(()=>expect(f.lookup).toHaveBeenCalled());const row=f.db.inspect(scope) as any;row.entries.task.intent.bodyJson=JSON.stringify({description:'',title:'Replacement'});f.db.inject(scope,row);release({ok:true,status:200,data:{status:'confirmed',task:retainedTask},requestId:'late'});expect(await pending).toBeNull();expect((f.db.inspect(scope) as any).entries.task.intent.status).toBe('uncertain');
});
it('current revalidation denial prevents lookup and leaves uncertainty intact',async()=>{const f=await recovery();f.revalidate.mockResolvedValue(false);expect(await f.controller.reconcile()).toBeNull();expect(f.lookup).not.toHaveBeenCalled();expect(f.controller.state.status).toBe('reconciliation-required');});
it('duplicate explicit checks share one lookup and never dispatch another creation',async()=>{const f=await recovery();await Promise.all([f.controller.reconcile(),f.controller.reconcile()]);expect(f.lookup).toHaveBeenCalledTimes(1);expect(f.send).toHaveBeenCalledTimes(1);});
it('principal change while lookup is delayed cannot publish or confirm old scope',async()=>{
 const f=await recovery();let release!:(x:unknown)=>void;f.lookup.mockImplementation(()=>new Promise(r=>{release=r;}) as never);const pending=f.controller.reconcile();await vi.waitFor(()=>expect(f.lookup).toHaveBeenCalled());f.setCurrent({...scope,principalId:'new_human',generation:2});f.controller.invalidate();release({ok:true,status:200,data:{status:'confirmed',task:retainedTask},requestId:'late'});expect(await pending).toBeNull();expect(f.controller.state.status).toBe('inactive');expect((f.db.inspect(scope) as any).entries.task.intent.status).toBe('uncertain');
});
it('acknowledgement in another tab during final refresh cannot return a stale confirmed entity',async()=>{
 const f=await recovery(),originalLoad=f.store.load.bind(f.store);let reads=0;
 vi.spyOn(f.store,'load').mockImplementation(async(...args)=>{if(++reads===3)await f.store.acknowledge(args[0],args[1]);return originalLoad(...args);});
 expect(await f.controller.reconcile()).toBeNull();expect(f.controller.state.entry?.intent??null).toBeNull();
});
it.each(['operation','bodyJson','draftRevision','key'] as const)('store confirmation compares immutable %s, not merely a key',async field=>{
 const f=await recovery(),binding=await f.store.bind(scope),original=f.controller.state.entry!.intent!,changed={...original};
 if(field==='operation')changed.operation='createMessage';else if(field==='draftRevision')changed.draftRevision++;else changed[field]+='different';
 await expect(f.store.confirmReconciled(binding,'task',changed,retainedTask.id)).rejects.toThrow('INTENT_CHANGED');expect((await f.store.load(binding,'task'))?.intent?.status).toBe('uncertain');
});
it('identical confirmed settlement is idempotent, conflicting entity or erased epoch is not',async()=>{
 const f=await recovery(),binding=await f.store.bind(scope),original=f.controller.state.entry!.intent!;
 await f.store.confirmReconciled(binding,'task',original,retainedTask.id);await expect(f.store.confirmReconciled(binding,'task',original,retainedTask.id)).resolves.toMatchObject({status:'confirmed'});
 await expect(f.store.confirmReconciled(binding,'task',original,'other_task')).rejects.toThrow('INTENT_CHANGED');await f.store.clearScope(binding);await expect(f.store.confirmReconciled(binding,'task',original,retainedTask.id)).rejects.toThrow('SCOPE_CHANGED');
});
it('failed confirmation persistence remains held and a later lookup can recover without resend',async()=>{
 const f=await recovery();f.lookup.mockImplementation(async()=>{f.db.failNext=true;return {ok:true,status:200,data:{status:'confirmed',task:retainedTask},requestId:'lookup'};});expect(await f.controller.reconcile()).toBeNull();expect(f.controller.state.entry?.intent?.status).toBe('uncertain');
 f.lookup.mockResolvedValue({ok:true,status:200,data:{status:'confirmed',task:retainedTask},requestId:'lookup'});expect(await f.controller.reconcile()).toEqual(retainedTask);expect(f.send).toHaveBeenCalledTimes(1);const persisted=JSON.stringify(f.db.inspect(scope));expect(persisted).not.toContain('created_at');expect(persisted).not.toContain('lookup');
});
it('inactive reconciliation stays inactive and performs no lookup',async()=>{const f=await recovery();f.controller.invalidate();expect(await f.controller.reconcile()).toBeNull();expect(f.controller.state.status).toBe('inactive');expect(f.lookup).not.toHaveBeenCalled();});
