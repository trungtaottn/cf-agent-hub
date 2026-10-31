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
