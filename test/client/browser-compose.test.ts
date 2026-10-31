import {describe,it,expect,vi} from 'vitest';
import {HubClient} from '../../packages/client/src/client';
import type {Task,Message} from '../../src/http/dto';
const task:Task={id:'task_one',workspace_id:'ws',title:'Synthetic',description:'',state:'backlog',task_version:1,proposal_version:0,project_id:null,work_role_id:null,assigned_agent_id:null,active_run_id:null,latest_run_id:null,approval_id:null,result:null,retry_count:0,retry_limit:2,flags:[],created_at:'2026-10-27T00:00:00Z',updated_at:'2026-10-27T00:00:00Z'};
const message:Message={id:'message_one',workspace_id:'ws',thread_id:'thread_one',sender:{kind:'human',principal_id:'human_one',agent_id:null},recipient_agent_ids:['agent_one'],body:'Hello',refs:[],artifact_ids:[],created_at:'2026-10-27T00:00:00Z',acknowledged_at:null};
const taskInput={body:{title:'Synthetic',description:''}};
const messageInput={body:{recipient_agent_ids:['agent_one'],body:'Hello',refs:[],artifact_ids:[]}};
function fixture(reply:()=>Response=()=>Response.json({data:task,request_id:'compose_request'},{status:201})){
 const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>reply());const client=new HubClient('ws',{fetch});client.setCsrfToken('synthetic-csrf');return {client,fetch};
}
describe('closed browser composition adapter',()=>{
 it('offers a separate compose surface without broadening command',async()=>{
  const {client,fetch}=fixture();expect(client.compose).toBeTypeOf('function');
  expect(await client.command('createTask' as never,taskInput as never,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'OPERATION_UNAVAILABLE'}});expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['createTask','createMessage'] as const)('dispatches %s exactly once through cookie/CSRF',async operation=>{
  const {client,fetch}=fixture(()=>Response.json({data:operation==='createTask'?task:message,request_id:'compose_request'},{status:201}));
  const input=operation==='createTask'?taskInput:messageInput;
  const result=await client.compose(operation,input,{idempotencyKey:'frozen-key'});
  expect(result).toEqual({ok:true,status:201,data:operation==='createTask'?task:message,requestId:'compose_request'});
  expect(fetch).toHaveBeenCalledTimes(1);const [url,init]=fetch.mock.calls[0]!;
  expect(url).toBe('/v2/workspaces/ws/'+(operation==='createTask'?'tasks':'messages'));
  expect(init).toMatchObject({method:'POST',credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store'});
  expect(JSON.parse(init!.body as string)).toEqual(input.body);
  const headers=new Headers(init!.headers);expect(headers.get('x-csrf-token')).toBe('synthetic-csrf');expect(headers.get('idempotency-key')).toBe('frozen-key');expect(headers.has('authorization')).toBe(false);expect(headers.has('x-runtime-token')).toBe(false);
 });
 it.each(['readyTask','claimTask','approveApproval','getTask','__proto__'])('rejects unavailable %s before fetch',async operation=>{
  const {client,fetch}=fixture();expect(await client.compose(operation as never,taskInput as never,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'OPERATION_UNAVAILABLE'}});expect(fetch).not.toHaveBeenCalled();
 });
 it.each([undefined,null,{}, {idempotencyKey:''},{idempotencyKey:' key'},{idempotencyKey:'key\n'},{idempotencyKey:'key',signal:{}},{idempotencyKey:'key',headers:{}},{idempotencyKey:'key',runtimeProof:'secret'},{idempotencyKey:'key',expectedBinding:{}},{idempotencyKey:'key',origin:'https://foreign.invalid'}])('rejects noncanonical options %j',async options=>{
  const {client,fetch}=fixture();expect(await client.compose('createTask',taskInput,options as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(fetch).not.toHaveBeenCalled();
 });
 it('requires in-memory CSRF and rejects caller authority/invalid bytes',async()=>{
  const {client,fetch}=fixture();client.setCsrfToken(null);
  expect(await client.compose('createTask',taskInput,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'CSRF_REQUIRED'}});
  client.setCsrfToken('synthetic-csrf');
  for(const input of [{body:{...taskInput.body,actor_id:'human'}},{...taskInput,headers:{}},{body:{title:'',description:''}},{body:{title:'x',description:'あ'.repeat(40000)}}])expect(await client.compose('createTask',input as never,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});
  expect(fetch).not.toHaveBeenCalled();
 });
 it.each([401,403])('clears CSRF on HTTP %s even if body is invalid',async status=>{
  const {client,fetch}=fixture(()=>new Response('not-json',{status}));await client.compose('createTask',taskInput,{idempotencyKey:'key'});
  expect(await client.compose('createTask',taskInput,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'CSRF_REQUIRED'}});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('preserves conflict correlation and does not retry',async()=>{
  const {client,fetch}=fixture(()=>Response.json({error:{code:'IDEMPOTENCY_CONFLICT',message:'Conflict',retryable:false,request_id:'conflict_request'}},{status:409}));
  expect(await client.compose('createTask',taskInput,{idempotencyKey:'key'})).toMatchObject({ok:false,status:409,requestId:'conflict_request',error:{code:'IDEMPOTENCY_CONFLICT'}});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('retains transport ambiguity as an error and never automatically retries',async()=>{
  const {client,fetch}=fixture();fetch.mockRejectedValue(new TypeError('lost response'));
  expect(await client.compose('createTask',taskInput,{idempotencyKey:'key'})).toMatchObject({ok:false,status:null,error:{code:'NETWORK_ERROR'}});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('rejects invalid success envelope without inventing admission',async()=>{
  const {client,fetch}=fixture(()=>Response.json({data:{id:'not-a-task'},request_id:'bad'},{status:201}));
  expect(await client.compose('createTask',taskInput,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('honors an already aborted signal without fetch',async()=>{
  const {client,fetch}=fixture();const controller=new AbortController();controller.abort();
  expect(await client.compose('createTask',taskInput,{idempotencyKey:'key',signal:controller.signal})).toMatchObject({ok:false,error:{code:'REQUEST_ABORTED'}});expect(fetch).not.toHaveBeenCalled();
 });
});

// Compile-only lane checks; never dispatched by the test runner.
function compositionTypes(client:HubClient){
 const taskResult:Promise<import('../../packages/client/src/types').ApiResult<Task>>=client.compose('createTask',taskInput,{idempotencyKey:'key'});
 const messageResult:Promise<import('../../packages/client/src/types').ApiResult<Message>>=client.compose('createMessage',messageInput,{idempotencyKey:'key'});
 // @ts-expect-error native proof options never enter the browser lane
 client.compose('createTask',taskInput,{idempotencyKey:'key',runtimeProof:'no'});
 // @ts-expect-error approval decisions are not composition operations
 client.compose('approveApproval',taskInput,{idempotencyKey:'key'});
 // @ts-expect-error operation-specific request types are preserved
 client.compose('createMessage',taskInput,{idempotencyKey:'key'});
 void [taskResult,messageResult];
}
void compositionTypes;
