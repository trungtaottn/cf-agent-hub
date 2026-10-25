import {describe,it,expect,vi} from 'vitest';
import {HubClient} from '../../packages/client/src/client';
import type {Operation,PreferencesWriteRequest} from '../../packages/client/src/types';

const configuration={config_epoch:1,profile_revision:1,preferences_revision:0,allowed_user_overrides:[],enabled_features:['workspace']};
const preferences={contract_revision:'0.1',theme:'dark',density:'compact',default_view:'overview'} as const;
const body:PreferencesWriteRequest={expected_preferences_revision:0,preferences};
const response=(data:unknown,status=200)=>Response.json(data,{status});
const ok=(data:unknown)=>response({data,request_id:'req-1'});
const page={next_cursor:'opaque+/=&?',has_more:true};

describe('R1 browser HTTP client',()=>{
 it('reads workspace capability scopes through the canonical root route',async()=>{
  const workspace={id:'ws',display_name:'Workspace',contract_revision:'0.1',actor:{kind:'human',principal_id:'human',agent_id:null},effective_scopes:['workspace:read','profile:edit']};
  const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>ok(workspace));
  const result=await new HubClient('ws',{fetch}).request('getWorkspace',{});
  expect(result).toMatchObject({ok:true,data:workspace});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe('/v2/workspaces/ws');
  expect(fetch.mock.calls[0]![1]).toMatchObject({method:'GET',credentials:'same-origin',mode:'same-origin'});
 });
 it('rejects malformed workspace capability scopes',async()=>{
  const workspace={id:'ws',display_name:'Workspace',contract_revision:'0.1',actor:{kind:'human',principal_id:'human',agent_id:null},effective_scopes:['unrecognized:authority']};
  const result=await new HubClient('ws',{fetch:vi.fn(async()=>ok(workspace))}).request('getWorkspace',{});
  expect(result).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});
 });

 it('uses exact root-relative routes, same-origin cookies and encoded query values',async()=>{
  const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>response({data:[],page,request_id:'req-page'}));
  const client=new HubClient('workspace_1',{fetch});
  const result=await client.request('getThread',{thread_id:'thread /?#%',cursor:'opaque+/=&?',limit:3});
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe('/v2/workspaces/workspace_1/threads/thread%20%2F%3F%23%25?cursor=opaque%2B%2F%3D%26%3F&limit=3');
  expect(init).toMatchObject({method:'GET',credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store'});
  expect(new Headers(init.headers).has('authorization')).toBe(false);
  expect(result).toMatchObject({ok:true,status:200,data:[],page,requestId:'req-page'});
  if(result.ok)await client.request('getThread',{thread_id:'thread /?#%',cursor:result.page!.next_cursor!});
  expect(fetch.mock.calls[1][0]).toContain('cursor=opaque%2B%2F%3D%26%3F');
 });
 it('preserves explicit key and serialized body across caller-driven replay after response loss',async()=>{
  const fetch=vi.fn().mockRejectedValueOnce(new TypeError('private network URL')).mockResolvedValueOnce(ok({preferences_revision:1,preferences,effective:preferences,allowed_user_overrides:[],default_view_fallback_reason:null}));
  const client=new HubClient('ws',{fetch});client.setCsrfToken('memory-only-token');
  const options={idempotencyKey:'original-intent-key'};
  expect(await client.request('putPreferences',body,options)).toMatchObject({ok:false,status:null,error:{code:'NETWORK_ERROR'}});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await client.request('putPreferences',body,options)).toMatchObject({ok:true,status:200});
  expect(fetch).toHaveBeenCalledTimes(2);
  for(const [,init] of fetch.mock.calls){
   expect(init.body).toBe(JSON.stringify(body));
   const headers=new Headers(init.headers);expect(headers.get('idempotency-key')).toBe(options.idempotencyKey);
   expect(headers.get('x-csrf-token')).toBe('memory-only-token');
   expect(headers.get('content-type')).toBe('application/json');
  }
 });
 it('requires explicit key and in-memory CSRF for settings writes without fetching',async()=>{
  const fetch=vi.fn();const client=new HubClient('ws',{fetch});
  client.setCsrfToken('token');expect(await client.request('putPreferences',body)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});
  client.setCsrfToken(null);expect(await client.request('putPreferences',body,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'CSRF_REQUIRED'}});
  expect(fetch).not.toHaveBeenCalled();
 });
 it('supports auth start/session/logout and clears CSRF after logout or denied access',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(ok({authorization_url:'https://issuer.example/authorize'})).mockResolvedValueOnce(ok({actor:{kind:'human',principal_id:'human',agent_id:null},csrf_token:'session-token',expires_at:'2026-10-25T10:00:00Z'})).mockResolvedValueOnce(ok({logged_out:true}));
  const client=new HubClient('ws',{fetch});
  expect((await client.request('startAuth',{return_path:'/overview'})).ok).toBe(true);
  expect(new Headers(fetch.mock.calls[0][1].headers).has('idempotency-key')).toBe(false);
  expect((await client.request('getAuthSession',{})).ok).toBe(true);
  client.setCsrfToken('session-token');expect((await client.request('logoutAuth',{})).ok).toBe(true);
  expect(await client.request('putPreferences',body,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'CSRF_REQUIRED'}});
 });
 it('retains sanitized server error category, request ID, retryability and current revision',async()=>{
  const fetch=vi.fn(async()=>response({error:{code:'VERSION_CONFLICT',message:'secret upstream exception',retryable:false,request_id:'req-conflict',details:{current_revision:4,current_version:2,reason:'secret',token:'secret'}}},409));
  const result=await new HubClient('ws',{fetch}).request('getConfiguration',{});
  expect(result).toEqual({ok:false,status:409,requestId:'req-conflict',error:{code:'VERSION_CONFLICT',message:'Resource version changed',retryable:false,details:{current_revision:4,current_version:2}}});
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([401,403])('preserves HTTP %s on malformed error and clears CSRF',async status=>{
  const fetch=vi.fn(async()=>new Response('<private diagnostic>',{status}));
  const client=new HubClient('ws',{fetch});client.setCsrfToken('token');
  expect(await client.request('getConfiguration',{})).toMatchObject({ok:false,status,requestId:null,error:{code:'INVALID_RESPONSE'}});
  expect(await client.request('putPreferences',body,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'CSRF_REQUIRED'}});
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([null,{data:configuration},{data:null,request_id:'req'},{data:{},request_id:'req'},{error:{code:'SURPRISE',message:'secret',retryable:true,request_id:'req'}}])('does not turn malformed body into success',async data=>{
  const result=await new HubClient('ws',{fetch:vi.fn(async()=>response(data))}).request('getConfiguration',{});
  expect(result).toMatchObject({ok:false,status:200,error:{code:'INVALID_RESPONSE'}});
 });
 it.each([undefined,{next_cursor:null,has_more:true},{next_cursor:'cursor',has_more:false},{next_cursor:3,has_more:true}])('rejects absent or malformed pagination metadata',async value=>{
  const fetch=vi.fn(async()=>response({data:[],page:value,request_id:'req'}));
  expect(await new HubClient('ws',{fetch}).request('listEvents',{})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});
 });
 it.each(['getInbox','ackMessages','createTask','callbackAuth','https://evil.example','toString','__proto__'])('fails closed for disallowed operation %s',async operation=>{
  const fetch=vi.fn();const result=await new HubClient('ws',{fetch}).request(operation as Operation,{});
  expect(result).toMatchObject({ok:false,error:{code:'OPERATION_UNAVAILABLE'}});expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['..','.','../elsewhere','https://evil.example','ws?x=1'])('rejects unsafe workspace ID %s',id=>{
  expect(()=>new HubClient(id)).toThrow('Invalid workspace ID');
 });
 it.each(['.','..'])('rejects dot-segment thread ID %s',async thread_id=>{
  const fetch=vi.fn();expect(await new HubClient('ws',{fetch}).request('getThread',{thread_id})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(fetch).not.toHaveBeenCalled();
 });
 it('rejects unknown query inputs instead of interpreting URLs or headers',async()=>{
  const fetch=vi.fn();const client=new HubClient('ws',{fetch});
  expect(await client.request('listEvents',{url:'https://evil.example'} as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});
  expect(fetch).not.toHaveBeenCalled();
 });
 it('sends abort signal once and returns a sanitized aborted result',async()=>{
  const controller=new AbortController();controller.abort();
  const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>{throw new DOMException('secret','AbortError');});
  const result=await new HubClient('ws',{fetch}).request('getConfiguration',{}, {signal:controller.signal});
  expect(result).toMatchObject({ok:false,status:null,error:{code:'REQUEST_ABORTED'}});
  expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1]!.signal).toBe(controller.signal);
 });
});

describe('R1 canonical response regressions',()=>{
 const session={actor:{kind:'human',principal_id:'human',agent_id:null},csrf_token:'token',expires_at:'2026-10-25T10:00:00Z'};
 it.each(['request:opaque.1','request with spaces','😀'.repeat(128)])('preserves canonical success request ID %s',async request_id=>{
  const fetch=vi.fn(async()=>response({data:configuration,request_id}));
  expect(await new HubClient('ws',{fetch}).request('getConfiguration',{})).toMatchObject({ok:true,requestId:request_id});
 });
 it.each(['request:opaque.1','opaque.'.repeat(40)])('preserves nonempty unbounded canonical error request ID %s',async request_id=>{
  const fetch=vi.fn(async()=>response({error:{code:'FORBIDDEN',message:'Access denied',retryable:false,request_id}},403));
  expect(await new HubClient('ws',{fetch}).request('getConfiguration',{})).toMatchObject({ok:false,status:403,requestId:request_id,error:{code:'FORBIDDEN'}});
 });
 it.each(['request:opaque.1','opaque.'.repeat(40)])('preserves canonical paginated request ID %s',async request_id=>{
  const fetch=vi.fn(async()=>response({data:[],page:{next_cursor:null,has_more:false},request_id}));
  expect(await new HubClient('ws',{fetch}).request('listEvents',{})).toMatchObject({ok:true,requestId:request_id});
 });
 it.each(['','a'.repeat(129),null,7])('rejects actual bounded success request ID violation',async request_id=>{
  const fetch=vi.fn(async()=>response({data:configuration,request_id}));
  expect(await new HubClient('ws',{fetch}).request('getConfiguration',{})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});
 });
 it.each([
  {authorization_url:'javascript:alert(1)'},
  {authorization_url:'http://issuer.example/authorize'},
  {authorization_url:'https://issuer.example/invalid uri'},
  {authorization_url:'https://issuer.example/'+ 'a'.repeat(8192)},
  {authorization_url:'https://issuer.example/authorize',unexpected:'private'}
 ])('rejects auth start data outside its canonical schema',async data=>{
  const fetch=vi.fn(async()=>ok(data));
  expect(await new HubClient('ws',{fetch}).request('startAuth',{return_path:'/overview'})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});
 });
 it.each([
  {...session,unexpected:'private'},
  {...session,actor:{...session.actor,unexpected:'private'}},
  {...session,actor:{...session.actor,principal_id:'a'.repeat(129)}},
  {...session,csrf_token:'a'.repeat(2049)},
  {...session,expires_at:'2026-02-30T10:00:00Z'},
  {...session,expires_at:'October 25, 2026'},
 ])('rejects session data outside its canonical schema',async data=>{
  const fetch=vi.fn(async()=>ok(data));
  expect(await new HubClient('ws',{fetch}).request('getAuthSession',{})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});
 });
 it('rejects unknown auth logout fields',async()=>{
  const fetch=vi.fn(async()=>ok({logged_out:true,unexpected:'private'}));
  const client=new HubClient('ws',{fetch});client.setCsrfToken('token');
  expect(await client.request('logoutAuth',{})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});
 });
 it('preserves canonical sanitized field paths alongside revision details',async()=>{
  const fetch=vi.fn(async()=>response({error:{code:'INVALID_REQUEST',message:'Invalid request',retryable:false,request_id:'req',details:{field:'/expected_preferences_revision',current_revision:0,token:'secret',reason:'secret'}}},400));
  const result=await new HubClient('ws',{fetch}).request('getConfiguration',{});
  expect(result).toMatchObject({ok:false,error:{details:{field:'/expected_preferences_revision',current_revision:0}}});
  expect(JSON.stringify(result)).not.toContain('secret');
 });
 it.each(['/private_token','expected_preferences_revision','/profile/secret','/profile/'+ '0'.repeat(6)])('redacts unsafe field path %s',async field=>{
  const fetch=vi.fn(async()=>response({error:{code:'INVALID_REQUEST',message:'Invalid request',retryable:false,request_id:'req',details:{field}}},400));
  expect(await new HubClient('ws',{fetch}).request('getConfiguration',{})).toEqual({ok:false,status:400,requestId:'req',error:{code:'INVALID_REQUEST',message:'Invalid request',retryable:false}});
 });
});
