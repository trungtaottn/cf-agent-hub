import {describe,it,expect,vi} from 'vitest';
import {HubClient} from '../../packages/client/src/client';
import type {Task} from '../../src/http/dto';
const task:Task={id:'task_one',workspace_id:'ws',title:'Synthetic',description:'',state:'ready',task_version:2,proposal_version:0,project_id:null,work_role_id:null,assigned_agent_id:null,active_run_id:null,latest_run_id:null,approval_id:null,result:null,retry_count:0,retry_limit:2,flags:[],created_at:'2026-10-27T00:00:00Z',updated_at:'2026-10-27T00:00:00Z'};
const reply=()=>Response.json({data:{task,run:null,approval:null},request_id:'synthetic_command'});
const input={path:{task_id:'task_one'},body:{expected_version:1}};
function fixture(response:()=>Response=reply){const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>response());const client=new HubClient('ws',{fetch});client.setCsrfToken('synthetic-csrf');return {fetch,client};}
describe('narrow cookie task command lane',()=>{
 it.each([['readyTask','ready'],['cancelTask','cancel'],['requeueTask','requeue'],['acceptTaskResult','accept-result']] as const)('dispatches canonical %s once with explicit CSRF and key',async(operation,suffix)=>{
  const {client,fetch}=fixture();const body=operation==='readyTask'?{expected_version:1}:{expected_version:1,reason:'Reviewed reason'};
  expect(await client.command(operation,{path:{task_id:'task /?#'},body},{idempotencyKey:'original-key'})).toMatchObject({ok:true});
  expect(fetch).toHaveBeenCalledTimes(1);const [url,init]=fetch.mock.calls[0]!;
  expect(url).toBe('/v2/workspaces/ws/tasks/task%20%2F%3F%23:'+suffix);expect(init).toMatchObject({method:'POST',credentials:'same-origin',mode:'same-origin',cache:'no-store',redirect:'error'});
  expect(JSON.parse(init!.body as string)).toEqual(body);const headers=new Headers(init!.headers);
  expect(headers.get('x-csrf-token')).toBe('synthetic-csrf');expect(headers.get('idempotency-key')).toBe('original-key');expect(headers.has('authorization')).toBe(false);expect(headers.has('x-runtime-token')).toBe(false);
 });
 it.each(['createTask','claimTask','submitTaskResult','approveProposal','getTask','unknown'])('rejects operation %s locally',async operation=>{
  const {client,fetch}=fixture();expect(await client.command(operation as never,input as never,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'OPERATION_UNAVAILABLE'}});expect(fetch).not.toHaveBeenCalled();
 });
 it.each([undefined,{},null,{idempotencyKey:''},{idempotencyKey:' key'},{idempotencyKey:'key\n'},{idempotencyKey:'key',signal:{}},{idempotencyKey:'key',headers:{}},{idempotencyKey:'key',runtimeProof:'secret'},{idempotencyKey:'key',origin:'https://foreign.invalid'}])('rejects missing or noncanonical options %j before fetch',async options=>{
  const {client,fetch}=fixture();expect(await client.command('readyTask',input,options as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(fetch).not.toHaveBeenCalled();
 });
 it.each([{path:{task_id:'..'},body:{expected_version:1}},{path:{task_id:'task_one'},body:{expected_version:0}},{path:{task_id:'task_one'},body:{expected_version:1,reason:'extra'}},{path:{task_id:'task_one'},body:{expected_version:1},headers:{}}])('rejects malformed command input',async request=>{
  const {client,fetch}=fixture();expect(await client.command('readyTask',request as never,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(fetch).not.toHaveBeenCalled();
 });
 it('missing CSRF rejects locally; a real HTTP 403 clears the cached token',async()=>{
  const {client,fetch}=fixture(()=>Response.json({error:{code:'FORBIDDEN',message:'private',retryable:false,request_id:'denied'}},{status:403}));client.setCsrfToken(null);
  expect(await client.command('readyTask',input,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'CSRF_REQUIRED'}});expect(fetch).not.toHaveBeenCalled();client.setCsrfToken('rotated');
  expect(await client.command('readyTask',input,{idempotencyKey:'key'})).toMatchObject({ok:false,status:403,error:{code:'FORBIDDEN'}});
  expect(await client.command('readyTask',input,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'CSRF_REQUIRED'}});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([()=>Response.json({data:{task},request_id:'bad'}),()=>new Response('private',{status:200}),()=>new Response(' '.repeat(1048577),{headers:{'content-type':'application/json'}})])('rejects invalid/bounded response without retry',async response=>{
  const {client,fetch}=fixture(response);expect(await client.command('readyTask',input,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('aborted first dispatch sends nothing',async()=>{const {client,fetch}=fixture();expect(await client.command('readyTask',input,{idempotencyKey:'key',signal:AbortSignal.abort()})).toMatchObject({ok:false,error:{code:'REQUEST_ABORTED'}});expect(fetch).not.toHaveBeenCalled();});
 it('deadline covers stalled body and cancels once without replay',async()=>{
  vi.useFakeTimers();const cancel=vi.fn();try{const {client,fetch}=fixture(()=>new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel}),{headers:{'content-type':'application/json'}}));
   const pending=client.command('readyTask',input,{idempotencyKey:'key'});await vi.advanceTimersByTimeAsync(30_000);expect(await pending).toMatchObject({ok:false,error:{code:'REQUEST_TIMEOUT'}});expect(fetch).toHaveBeenCalledTimes(1);expect(cancel).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
 });
});
