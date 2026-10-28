import {describe,it,expect,vi} from 'vitest';
import {HubClient} from '../../packages/client/src/client';
import {validateAuthStartRequest} from '../../src/http/generated/auth-validators.js';
import spec from '../../spec/openapi.json';
import {authReturnPaths} from '../../src/http/dto';
import {isUiRequest} from '../../src/http/ui-routes';
const reply=(data:unknown=[],status=200)=>Response.json({data,page:{next_cursor:null,has_more:false},request_id:'synthetic_read'},{status});

describe('canonical browser task reads',()=>{
 it('uses one cookie-authenticated generated read route, with encoded input and bounded page',async()=>{
  const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>reply());
  const client=new HubClient('ws',{fetch});
  const result=await client.read('listTaskResults',{path:{task_id:'task /?#'},query:{limit:20,cursor:'opaque+=?'}});
  expect(result).toMatchObject({ok:true,data:[],page:{has_more:false,next_cursor:null}});
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url,init]=fetch.mock.calls[0]!;
  expect(url).toBe('/v2/workspaces/ws/tasks/task%20%2F%3F%23/results?cursor=opaque%2B%3D%3F&limit=20');
  expect(init).toMatchObject({method:'GET',credentials:'same-origin',mode:'same-origin',cache:'no-store',redirect:'error'});
  const headers=new Headers(init?.headers);expect(headers.has('authorization')).toBe(false);expect(headers.has('x-runtime-token')).toBe(false);expect(headers.has('x-csrf-token')).toBe(false);
 });
 it.each(['createTask','createRuntime','downloadArtifactContent','getOperations','unknown'])('denies non-board read operation %s before fetch',async operation=>{
  const fetch=vi.fn(async()=>reply());const result=await new HubClient('ws',{fetch}).read(operation as never,{} as never);
  expect(result).toMatchObject({ok:false,error:{code:'OPERATION_UNAVAILABLE'}});expect(fetch).not.toHaveBeenCalled();
 });
 it.each([{query:{limit:201}},{query:{state:'invented'}},{query:{principal_id:'foreign'}},{path:{task_id:'..'}}])('rejects malformed input without dispatch',async input=>{
  const fetch=vi.fn(async()=>reply());const result=await new HubClient('ws',{fetch}).read('listTasks',input as never);
  expect(result).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(fetch).not.toHaveBeenCalled();
 });
 it.each([
  ()=>reply([{id:'invented-task'}]),
  ()=>Response.json({data:[],page:{has_more:true,next_cursor:null},request_id:'synthetic'}),
  ()=>Response.json({data:[],page:{has_more:false,next_cursor:null},request_id:'synthetic',invented:'field'}),
  ()=>new Response('<private>',{status:200,headers:{'content-type':'text/html'}}),
  ()=>reply([],201)
 ])('rejects malformed success against full canonical envelope',async response=>{
  expect(await new HubClient('ws',{fetch:vi.fn(async()=>response())}).read('listTasks',{})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});
 });
 it('preserves HTTP authority denial and never retries',async()=>{
  const fetch=vi.fn(async()=>new Response('private diagnostic',{status:403}));
  expect(await new HubClient('ws',{fetch}).read('listTasks',{})).toMatchObject({ok:false,status:403});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('honors abort without retry',async()=>{
  const signal=AbortSignal.abort();const fetch=vi.fn(async()=>reply());
  expect(await new HubClient('ws',{fetch}).read('listTasks',{}, {signal})).toMatchObject({ok:false,error:{code:'REQUEST_ABORTED'}});expect(fetch).not.toHaveBeenCalled();
 });
 it('keeps the total deadline while a streamed body stalls and cancels without retry',async()=>{
  vi.useFakeTimers();const cancelled=vi.fn();
  try{
   const fetch=vi.fn(async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel:cancelled}),{headers:{'content-type':'application/json'}}));
   const pending=new HubClient('ws',{fetch}).read('listTasks',{});
   await vi.advanceTimersByTimeAsync(30_000);
   expect(await pending).toMatchObject({ok:false,error:{code:'REQUEST_TIMEOUT'}});expect(fetch).toHaveBeenCalledTimes(1);expect(cancelled).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
 });
 it('bounds streamed response bytes',async()=>{
  const fetch=vi.fn(async()=>new Response(' '.repeat(1048577),{headers:{'content-type':'application/json'}}));
  expect(await new HubClient('ws',{fetch}).read('listTasks',{})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});
 });
});

describe('exact task document return path',()=>{
 it('admits tasks consistently in shell/start/callback',()=>{
  expect(isUiRequest(new Request('https://hub.example.invalid/tasks'))).toBe(true);
  expect(authReturnPaths).toContain('/tasks');expect(validateAuthStartRequest({return_path:'/tasks'})).toBe(true);expect(spec.components.schemas.AuthCallbackHeaders.properties.Location.enum).toContain('/tasks');
  expect(spec.paths['/v2/workspaces/{workspace_id}/auth/callback'].get.responses['302'].headers.Location.schema.enum).toContain('/tasks');
 });
 it.each(['/tasks?task=x','//evil.invalid/tasks','https://evil.invalid/tasks','/tasks/../settings','/tasks#x','/tasks/'])('rejects non-exact return %s',path=>{
  expect(validateAuthStartRequest({return_path:path})).toBe(false);expect(spec.components.schemas.AuthCallbackHeaders.properties.Location.enum).not.toContain(path);
 });
});

it.each(['GET','HEAD'])('serves exact task shell with safe workspace binding for %s',async method=>{
 const {serveUi}=await import('../../src/http/ui-routes');const {default:config}=await import('../../examples/config/deployment.example.json');
 const fetch=vi.fn(async(_request:Request)=>new Response('<body data-workspace="{{WORKSPACE_ID}}"></body>',{headers:{'content-type':'text/html'}}));
 const response=await serveUi(new Request('https://hub.example.invalid/tasks?workspace=ws_example',{method}),{ASSETS:{fetch},DEPLOYMENT_CONFIG:JSON.stringify(config)} as unknown as Env);
 expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('text/html');expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
 expect(await response.text()).toBe(method==='HEAD'?'':'<body data-workspace="ws_example"></body>');expect(new URL(fetch.mock.calls[0]![0].url).pathname).toBe('/ui/index.html');
});
