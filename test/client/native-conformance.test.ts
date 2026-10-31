import {describe,it,expect,vi} from 'vitest';
import {HubClient} from '../../packages/client/src/client';

const configuration={config_epoch:1,profile_revision:1,preferences_revision:0,allowed_user_overrides:[],enabled_features:['workspace']};
describe('shared HTTP boundary regressions',()=>{
 it.each(['text/plain','text/html','application/octet-stream'])('never treats %s content as a valid JSON success',async type=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({data:configuration,request_id:'req'}),{headers:{'content-type':type}}));
  expect(await new HubClient('ws',{fetch}).request('getConfiguration',{})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('still accepts canonical JSON media type with charset',async()=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({data:configuration,request_id:'req'}),{headers:{'content-type':'application/json; charset=utf-8'}}));
  expect(await new HubClient('ws',{fetch}).request('getConfiguration',{})).toMatchObject({ok:true,data:configuration});
 });
});

import {createNativeClient} from '../../packages/client/src/native-client';
import {clientOperations} from '../../src/http/generated/client-operations';
import type {EnabledOperationId,CredentialProvenance,CredentialDispatchLease} from '../../packages/client/src/types';
import {nativeFixture,nativeOrigin,secret,proof,runtime,ok as nativeOk,denied} from './native-helpers';

describe('native context and canonical shared transport',()=>{
 it.each(['http://hub.example.invalid','https://hub.example.invalid/',' https://hub.example.invalid','https://user@hub.example.invalid','https://hub.example.invalid/path','https://hub.example.invalid?x','https://hub.example.invalid#x','https://HUB.example.invalid','https://hub.example.invalid:443','https://hub.example.invalid\\evil'])('rejects nonexact HTTPS origin %s',origin=>{
  const f=nativeFixture();expect(()=>createNativeClient({origin,workspaceId:'ws',credentialProvider:f.provider,fetch:f.fetch})).toThrow('Invalid native origin');expect(f.fetch).not.toHaveBeenCalled();
 });
 it('requires explicit provider and fetch, rejects browser or arbitrary-header configuration',()=>{
  const f=nativeFixture();for(const extra of [{fetch:undefined},{credentialProvider:undefined},{headers:{authorization:secret}},{csrfToken:'cookie'},{timeoutMs:Infinity}])expect(()=>createNativeClient({origin:nativeOrigin,workspaceId:'ws',credentialProvider:f.provider,fetch:f.fetch,...extra} as never)).toThrow();
 });
 it('sends only the native lane headers to the exact root',async()=>{
  const f=nativeFixture();expect(await f.client.call('getConfiguration',{})).toMatchObject({ok:true});
  expect(f.fetch).toHaveBeenCalledTimes(1);const [url,init]=f.fetch.mock.calls[0]!;
  expect(url).toBe(nativeOrigin+'/v2/workspaces/ws/configuration');expect(init).toMatchObject({credentials:'omit',redirect:'manual',cache:'no-store'});
  const headers=new Headers(init!.headers);expect(headers.get('authorization')).toBe('Bearer '+secret);expect(headers.has('cookie')).toBe(false);expect(headers.has('x-csrf-token')).toBe(false);expect(headers.has('x-runtime-token')).toBe(false);
  expect(f.releases).toHaveBeenCalledTimes(1);
 });
 it.each([...Object.entries(clientOperations).filter(([,c])=>!c.native).map(([id])=>id),'requestTaskDecision','listApprovals','getApproval','approveApproval','rejectApproval','callbackAuth','getLiveness','toString','__proto__','https://evil.example'])('rejects %s without acquiring or fetching',async operation=>{
  const f=nativeFixture();expect(await f.client.call(operation as EnabledOperationId,{} as never)).toMatchObject({ok:false,error:{code:'OPERATION_UNAVAILABLE'}});expect(f.acquire).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
 });
 it('requires explicit enrollment mode without any network',async()=>{const f=nativeFixture();expect(await f.client.call('createRuntime',{body:{label:'runtime'}},{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'ENROLLMENT_REQUIRED'}});expect(f.acquire).not.toHaveBeenCalled();});
 it.each([{query:{limit:0}},{query:{limit:201}},{query:{cursor:''}},{query:{cursor:'cursor',after_sequence:1}},{query:{extra:'value'}}])('rejects invalid canonical query %j before acquiring',async request=>{const f=nativeFixture();expect(await f.client.call('listEvents',request as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(f.acquire).not.toHaveBeenCalled();});
 it('encodes exact path and page query, preserving opaque cursors',async()=>{
  const f=nativeFixture();f.fetch.mockImplementation(async()=>Response.json({data:[],page:{next_cursor:'opaque+/=?',has_more:true},request_id:'request with spaces'}));
  expect(await f.client.call('getThread',{path:{thread_id:'thread /?#%'},query:{limit:3,cursor:'opaque+/=?'}})).toMatchObject({ok:true,page:{next_cursor:'opaque+/=?',has_more:true}});
  expect(f.fetch.mock.calls[0]![0]).toBe(nativeOrigin+'/v2/workspaces/ws/threads/thread%20%2F%3F%23%25?cursor=opaque%2B%2F%3D%3F&limit=3');
 });
 it.each(['text/html','text/plain','application/octet-stream'])('rejects native %s JSON lookalike',async type=>{const f=nativeFixture();f.fetch.mockImplementation(async()=>new Response(JSON.stringify({data:configuration,request_id:'req'}),{headers:{'content-type':type}}));expect(await f.client.call('getConfiguration',{})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});});
 it.each([{data:configuration,request_id:''},{data:configuration,request_id:12},{data:configuration,request_id:'x'.repeat(129)},{data:configuration,request_id:'req',secret},{data:{...configuration,config_epoch:'1'},request_id:'req'}])('rejects malformed native envelope %j',async envelope=>{const f=nativeFixture();f.fetch.mockImplementation(async()=>Response.json(envelope));expect(await f.client.call('getConfiguration',{})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});});
 it('rejects wrong success status and redirects without redispatch',async()=>{
  for(const response of [nativeOk(configuration,201),new Response(null,{status:302,headers:{location:'https://evil.example/private'}})]){const f=nativeFixture();f.fetch.mockImplementation(async()=>response);expect(await f.client.call('getConfiguration',{})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});expect(f.fetch).toHaveBeenCalledTimes(1);}
 });
 it('preserves sanitized denial and request correlation without secret diagnostics',async()=>{const f=nativeFixture();f.fetch.mockImplementation(async()=>denied('VERSION_CONFLICT',409));const result=await f.client.call('getConfiguration',{});expect(result).toMatchObject({ok:false,status:409,requestId:'req_denied',error:{code:'VERSION_CONFLICT',details:{current_version:2}}});expect(JSON.stringify(result)).not.toContain(secret);});
 it('denies unbound mutation and caller-supplied forged provenance',async()=>{
  const f=nativeFixture();const request={body:{title:'Task',description:''}};
  for(const provenance of [null,{binding:{origin:nativeOrigin,workspaceId:'ws',principalId:'agent_one',slotId:'slot_one',slotGeneration:1,provenanceId:'caller-label'}} as CredentialProvenance]){f.state.provenance=provenance;expect(await f.client.call('createTask',request,{idempotencyKey:'caller-key'})).toMatchObject({ok:false,error:{code:'CREDENTIAL_UNBOUND'}});}
  expect(f.fetch).not.toHaveBeenCalled();
 });
 it('captures exact-lease enrollment proof privately and returns only safe runtime',async()=>{
  const f=nativeFixture();const result=await f.enroll();expect(result).toEqual({ok:true,status:201,data:runtime,requestId:'req_native'});expect(JSON.stringify(result)).not.toContain(proof);expect(JSON.stringify(result)).not.toContain(secret);
  expect(f.state.provenance!.binding).toMatchObject({origin:nativeOrigin,workspaceId:'ws',principalId:'agent_one',slotId:'slot_one',slotGeneration:1});
  f.fetch.mockImplementation(async()=>denied());expect(await f.client.call('createTask',{body:{title:'Task',description:''}},{idempotencyKey:'caller-key',expectedBinding:f.state.provenance!.binding})).toMatchObject({ok:false,status:403,error:{code:'FORBIDDEN'}});
  expect(f.fetch).toHaveBeenCalledTimes(2);expect(new Headers(f.fetch.mock.calls[1]![1]!.headers).get('idempotency-key')).toBe('caller-key');
 });
 it('never accepts a JSON-copied authentic receipt',async()=>{const f=nativeFixture();await f.enroll();f.state.provenance=JSON.parse(JSON.stringify(f.state.provenance));expect(await f.client.call('createTask',{body:{title:'Task',description:''}},{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'CREDENTIAL_UNBOUND'}});expect(f.fetch).toHaveBeenCalledTimes(1);});
 it.each([{runtime_token:null,revealed:false},{runtime_token:proof,revealed:false},{runtime_token:null,revealed:true}])('does not claim enrollment success from replay/inconsistent proof %j',async fields=>{const f=nativeFixture();const capture=vi.fn();f.fetch.mockImplementation(async()=>nativeOk({runtime,...fields},201));expect(await f.client.enrollRuntime({body:{label:'Runtime'}},{idempotencyKey:'key',captureRuntime:capture})).toMatchObject({ok:false,error:{code:'ENROLLMENT_PROOF_UNAVAILABLE'}});expect(capture).not.toHaveBeenCalled();expect(f.fetch).toHaveBeenCalledTimes(1);});
 it('does not activate callback-retained provenance after capture failure',async()=>{
  const f=nativeFixture();f.fetch.mockImplementation(async()=>nativeOk({runtime,runtime_token:proof,revealed:true},201));let during:unknown;
  const result=await f.client.enrollRuntime({body:{label:'Runtime'}},{idempotencyKey:'key',captureRuntime:async capture=>{f.state.provenance=capture.provenance;during=await f.client.call('createTask',{body:{title:'Task',description:''}},{idempotencyKey:'during'});throw Error('private proof '+proof);}});
  expect(during).toMatchObject({ok:false,error:{code:'CREDENTIAL_CHANGED'}});expect(result).toMatchObject({ok:false,requestId:'req_native',error:{code:'CAPTURE_FAILED'}});expect(JSON.stringify(result)).not.toContain(proof);
  expect(await f.client.call('createTask',{body:{title:'Task',description:''}},{idempotencyKey:'after'})).toMatchObject({ok:false,error:{code:'CREDENTIAL_UNBOUND'}});expect(f.fetch).toHaveBeenCalledTimes(1);
 });
 it('rejects provider rotation and mismatched expected binding without silent rebind',async()=>{
  const f=nativeFixture();await f.enroll();const expected=f.state.provenance!.binding;f.state.generation++;
  expect(await f.client.call('createTask',{body:{title:'Task',description:''}},{idempotencyKey:'key',expectedBinding:expected})).toMatchObject({ok:false,error:{code:'CREDENTIAL_CHANGED'}});expect(f.fetch).toHaveBeenCalledTimes(1);
 });
 it('admits runtime proof only on exact proof-required operations',async()=>{
  const f=nativeFixture();await f.enroll();f.fetch.mockImplementation(async()=>denied());
  expect(await f.client.call('getConfiguration',{}, {runtimeProof:proof})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});
  expect(await f.client.call('claimTask',{path:{task_id:'task_one'},body:{expected_version:1,runtime_instance_id:'runtime_one'}},{idempotencyKey:'claim'})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});
  expect(await f.client.call('claimTask',{path:{task_id:'task_one'},body:{expected_version:1,runtime_instance_id:'runtime_one'}},{idempotencyKey:'claim',runtimeProof:proof})).toMatchObject({ok:false,status:403});
  expect(f.fetch).toHaveBeenCalledTimes(2);expect(new Headers(f.fetch.mock.calls[1]![1]!.headers).get('x-runtime-token')).toBe(proof);
 });
 it('times out one dispatch without changing body or caller key',async()=>{
  const f=nativeFixture({timeoutMs:20});await f.enroll();f.fetch.mockImplementation(()=>new Promise(()=>{}));
  const result=await f.client.call('createTask',{body:{title:'Original',description:''}},{idempotencyKey:'original-key'});
  expect(result).toMatchObject({ok:false,error:{code:'REQUEST_TIMEOUT'}});expect(f.fetch).toHaveBeenCalledTimes(2);expect(f.fetch.mock.calls[1]![1]!.body).toBe('{"title":"Original","description":""}');expect(new Headers(f.fetch.mock.calls[1]![1]!.headers).get('idempotency-key')).toBe('original-key');expect(f.releases).toHaveBeenCalledTimes(2);
 });
 it('releases a provider lease that arrives after total deadline without fetching',async()=>{
  const release=vi.fn();let resolve!:(lease:CredentialDispatchLease)=>void;
  const f=nativeFixture({timeoutMs:10,credentialProvider:{acquire:()=>new Promise(r=>resolve=r)}});
  expect(await f.client.call('getConfiguration',{})).toMatchObject({ok:false,error:{code:'REQUEST_TIMEOUT'}});
  resolve({slotId:'late',slotGeneration:1,provenance:null,isCurrent:()=>true,use:fn=>fn(secret),release});await new Promise(r=>setTimeout(r,0));
  expect(release).toHaveBeenCalledTimes(1);expect(f.fetch).not.toHaveBeenCalled();
 });
 it('times out a stalled JSON body and cancels it',async()=>{
  const f=nativeFixture({timeoutMs:10}),cancel=vi.fn();f.fetch.mockImplementation(async()=>new Response(new ReadableStream({cancel}),{headers:{'content-type':'application/json'}}));
  expect(await f.client.call('getConfiguration',{})).toMatchObject({ok:false,error:{code:'REQUEST_TIMEOUT'}});expect(cancel).toHaveBeenCalledTimes(1);expect(f.releases).toHaveBeenCalledTimes(1);
 });
});

describe('reviewed transport boundaries',()=>{
 it('lets canonical Runtime schema own its unbounded opaque request ID',async()=>{
  const f=nativeFixture();await f.enroll();f.fetch.mockImplementation(async()=>Response.json({data:runtime,request_id:'r'.repeat(129)}));
  expect(await f.client.call('heartbeatRuntime',{path:{runtime_instance_id:runtime.id},body:{expected_runtime_version:1}},{idempotencyKey:'heartbeat',runtimeProof:proof})).toMatchObject({ok:true,requestId:'r'.repeat(129)});
 });
 it('never dispatches through an already aborted native deadline',async()=>{
  const {Deadline,HttpTransport}=await import('../../packages/client/src/transport');const controller=new AbortController();controller.abort();const deadline=new Deadline(100,controller.signal),fetch=vi.fn(async()=>nativeOk(configuration));
  await expect(new HttpTransport(fetch).open(nativeOrigin,{signal:deadline.signal},deadline)).rejects.toThrow('REQUEST_ABORTED');expect(fetch).not.toHaveBeenCalled();deadline.dispose();
 });
});

describe('independent provenance and redaction regressions',()=>{
 it('rejects authentic receipt graft to a different provider with colliding slot labels',async()=>{
  const a=nativeFixture(),b=nativeFixture();await a.enroll();b.state.provenance=a.state.provenance;b.fetch.mockImplementation(async()=>denied());
  expect(await b.client.call('createTask',{body:{title:'Task',description:''}},{idempotencyKey:'key',expectedBinding:a.state.provenance!.binding})).toMatchObject({ok:false,error:{code:'CREDENTIAL_CHANGED'}});expect(b.fetch).not.toHaveBeenCalled();
 });
 it('never reflects a secret-bearing ClientFault from protected capture',async()=>{
  const {ClientFault}=await import('../../packages/client/src/transport');const f=nativeFixture();f.fetch.mockImplementation(async()=>nativeOk({runtime,runtime_token:proof,revealed:true},201));
  const result=await f.client.enrollRuntime({body:{label:'Runtime'}},{idempotencyKey:'key',captureRuntime:()=>{throw new ClientFault(proof);}});
  expect(result.ok).toBe(false);expect(JSON.stringify(result)).not.toContain(proof);expect(JSON.stringify(result)).not.toContain(secret);expect(f.fetch).toHaveBeenCalledTimes(1);
 });
});

describe('deadline and late-result cleanup',()=>{
 it('cancels a response body arriving after the call timed out',async()=>{
  const f=nativeFixture({timeoutMs:10}),cancel=vi.fn();let resolve!:(response:Response)=>void;f.fetch.mockImplementation(()=>new Promise(r=>resolve=r));
  expect(await f.client.call('getConfiguration',{})).toMatchObject({ok:false,error:{code:'REQUEST_TIMEOUT'}});
  resolve(new Response(new ReadableStream({cancel}),{headers:{'content-type':'application/json'}}));await new Promise(r=>setTimeout(r,0));expect(cancel).toHaveBeenCalledTimes(1);expect(f.releases).toHaveBeenCalledTimes(1);
 });
 it('rejects zero-progress JSON chunks instead of accepting timer-starving producers',async()=>{
  const f=nativeFixture();let n=0;f.fetch.mockImplementation(async()=>new Response(new ReadableStream({pull(c){if(n++<3)c.enqueue(new Uint8Array());else if(n===4)c.enqueue(new TextEncoder().encode(JSON.stringify({data:configuration,request_id:'req'})));else c.close();}},{highWaterMark:0}),{headers:{'content-type':'application/json'}}));
  expect(await f.client.call('getConfiguration',{})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});expect(f.releases).toHaveBeenCalledTimes(1);
 });
});

describe('native dispatch and capture race boundaries',()=>{
 it('snapshots caller intent and key before the credential await',async()=>{
  const f=nativeFixture();await f.enroll();const original=f.acquire.getMockImplementation()!;let resume!:()=>void;const gate=new Promise<void>(r=>resume=r);
  f.acquire.mockImplementationOnce(async()=>{await gate;return original();});f.fetch.mockImplementation(async()=>denied('VERSION_CONFLICT',409));
  const request={body:{title:'Original',description:''}},options={idempotencyKey:'original-key',expectedBinding:f.state.provenance!.binding};const pending=f.client.call('createTask',request,options);request.body.title='Changed';options.idempotencyKey='replacement-key';resume();
  expect(await pending).toMatchObject({ok:false,status:409});const init=f.fetch.mock.calls[1]![1]!;expect(init.body).toBe('{"title":"Original","description":""}');expect(new Headers(init.headers).get('idempotency-key')).toBe('original-key');expect(f.fetch).toHaveBeenCalledTimes(2);
 });
 it('does not publish successful data after provider changes while fetch is awaited',async()=>{
  const f=nativeFixture(),cancel=vi.fn();f.fetch.mockImplementation(async()=>{f.state.current=false;return new Response(new ReadableStream({cancel}),{headers:{'content-type':'application/json'}});});
  expect(await f.client.call('getConfiguration',{})).toMatchObject({ok:false,error:{code:'CREDENTIAL_CHANGED'}});expect(cancel).toHaveBeenCalledTimes(1);expect(f.releases).toHaveBeenCalledTimes(1);
 });
 it('quarantines a late capture receipt and preserves one dispatch',async()=>{
  const f=nativeFixture({timeoutMs:15});f.fetch.mockImplementation(async()=>nativeOk({runtime,runtime_token:proof,revealed:true},201));let resolve!:()=>void;
  const result=await f.client.enrollRuntime({body:{label:'Runtime'}},{idempotencyKey:'key',captureRuntime:c=>{f.state.provenance=c.provenance;return new Promise<void>(r=>resolve=r);}});expect(result).toMatchObject({ok:false,error:{code:'REQUEST_TIMEOUT'}});resolve();await Promise.resolve();
  expect(await f.client.call('createTask',{body:{title:'Task',description:''}},{idempotencyKey:'next'})).toMatchObject({ok:false,error:{code:'CREDENTIAL_UNBOUND'}});expect(f.fetch).toHaveBeenCalledTimes(1);
 });
 it('rejects changed slot during capture before activating provenance',async()=>{
  const f=nativeFixture();f.fetch.mockImplementation(async()=>nativeOk({runtime,runtime_token:proof,revealed:true},201));
  expect(await f.client.enrollRuntime({body:{label:'Runtime'}},{idempotencyKey:'key',captureRuntime:c=>{f.state.provenance=c.provenance;f.state.generation++;}})).toMatchObject({ok:false,error:{code:'CREDENTIAL_CHANGED'}});
  expect(await f.client.call('createTask',{body:{title:'Task',description:''}},{idempotencyKey:'next'})).toMatchObject({ok:false,error:{code:'CREDENTIAL_UNBOUND'}});expect(f.fetch).toHaveBeenCalledTimes(1);
 });
 it.each([{workspace_id:'other'},{agent_id:'agent_other'}])('rejects conflicting authenticated enrollment metadata %j',async patch=>{
  const f=nativeFixture();await f.enroll();f.fetch.mockImplementation(async()=>nativeOk({runtime:{...runtime,...patch},runtime_token:proof,revealed:true},201));const capture=vi.fn();
  expect(await f.client.enrollRuntime({body:{label:'Runtime'}},{idempotencyKey:'fresh-key',captureRuntime:capture})).toMatchObject({ok:false,error:{code:'CREDENTIAL_CHANGED'}});expect(capture).not.toHaveBeenCalled();
 });
 it('cancels late response if the provider throws after invoking its dispatch callback',async()=>{
  const cancel=vi.fn();let resolve!:(response:Response)=>void;
  const provider={acquire:async()=>({slotId:'slot',slotGeneration:1,provenance:null,isCurrent:()=>true,use:<T>(fn:(credential:string)=>T):T=>{fn(secret);throw Error('provider error');},release:vi.fn()})};
  const fetch=vi.fn(()=>new Promise<Response>(r=>resolve=r));const client=createNativeClient({origin:nativeOrigin,workspaceId:'ws',credentialProvider:provider,fetch});
  expect(await client.call('getConfiguration',{})).toMatchObject({ok:false,error:{code:'NETWORK_ERROR'}});resolve(new Response(new ReadableStream({cancel})));await new Promise(r=>setTimeout(r,0));expect(cancel).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each(['redirected','wrong-origin','opaque-redirect'])('rejects %s responses and cancels bytes',async kind=>{
  const f=nativeFixture(),cancel=vi.fn();const response=new Response(new ReadableStream({cancel}),{headers:{'content-type':'application/json'}});
  if(kind==='redirected')Object.defineProperty(response,'redirected',{value:true});if(kind==='wrong-origin')Object.defineProperty(response,'url',{value:'https://other.example.invalid/response'});if(kind==='opaque-redirect'){Object.defineProperty(response,'type',{value:'opaqueredirect'});Object.defineProperty(response,'status',{value:0});}
  f.fetch.mockImplementation(async()=>response);expect(await f.client.call('getConfiguration',{})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});expect(cancel).toHaveBeenCalledTimes(1);expect(f.fetch).toHaveBeenCalledTimes(1);
 });
});
it('rejects non-string operation objects without coercion or raw promise rejection',async()=>{
 const f=nativeFixture();for(const operation of [new String('getConfiguration'),{[Symbol.toPrimitive](){throw Error(secret);}},null,undefined,42]){
  await expect(f.client.call(operation as never,{} as never)).resolves.toMatchObject({ok:false,error:{code:'OPERATION_UNAVAILABLE'}});
 }
 expect(f.acquire).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
});

describe('strict pure preflight',()=>{
 it('rejects a non-encodable path before acquiring credentials',async()=>{const f=nativeFixture();expect(await f.client.call('getThread',{path:{thread_id:'\uD800'}})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(f.acquire).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();});
 it('rejects a non-ByteString idempotency header before acquiring credentials',async()=>{const f=nativeFixture();expect(await f.client.enrollRuntime({body:{label:'Runtime'}},{idempotencyKey:'key😀',captureRuntime:()=>{}})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(f.acquire).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();});
 it.each([{unexpected:undefined},{query:{unexpected:undefined}}])('rejects unknown keys even when undefined',async request=>{const f=nativeFixture();expect(await f.client.call('getProfile',request as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(f.acquire).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();});
 it('preserves legitimate omitted optional query fields',async()=>{const f=nativeFixture();f.fetch.mockImplementation(async()=>Response.json({data:[],page:{next_cursor:null,has_more:false},request_id:'req'}));expect(await f.client.call('listEvents',{query:{limit:undefined,cursor:undefined}})).toMatchObject({ok:true});expect(f.fetch).toHaveBeenCalledTimes(1);});
});
