import {describe,it,expect} from 'vitest';
import {prepareNativeOperation} from '../../packages/client/src/native-request';

describe('single canonical native request preparation',()=>{
 it('binds exact encoded target and canonical query/body without credentials',()=>{
  const input={path:{task_id:'task /?#'},body:{expected_version:1,reason:'Original'}};
  const prepared=prepareNativeOperation('https://hub.example.invalid','ws','cancelTask',input);
  expect(prepared.path).toBe('/v2/workspaces/ws/tasks/task%20%2F%3F%23:cancel');
  expect(prepared.canonicalBody).toBe('{"expected_version":1,"reason":"Original"}');
  expect(prepared.method).toBe('POST');
  input.body.reason='Changed';expect(prepared.request.body).toEqual({expected_version:1,reason:'Original'});
 });
 it('rejects unsupported/human operations and invalid schema before any storage or fetch',()=>{
  for(const [op,input]of [['createCredential',{}],['createTask',{body:{title:1}}],['getTask',{path:{task_id:'..'}}]])expect(()=>prepareNativeOperation('https://hub.example.invalid','ws',op as never,input)).toThrow();
 });
 it('canonicalizes semantic JSON independent of input member order',()=>{
  const a=prepareNativeOperation('https://hub.example.invalid','ws','createTask',{body:{title:'Task',description:'Text'}});
  const b=prepareNativeOperation('https://hub.example.invalid','ws','createTask',{body:{description:'Text',title:'Task'}});
  expect(a.canonicalBody).toBe(b.canonicalBody);
 });
});

import {nativeFixture,runtime,proof,ok} from './native-helpers';
import {vi} from 'vitest';

describe('durable capture finalization boundary',()=>{
 it('passes the actual pinned lease and commits protected capture before success',async()=>{
  const f=nativeFixture(),events:string[]=[];f.fetch.mockImplementation(async()=>ok({runtime,runtime_token:proof,revealed:true},201));
  const result=await f.client.enrollRuntime({body:{label:'Runtime'}},{idempotencyKey:'capture',captureRuntime:c=>{
   expect(c.lease.slotId).toBe(c.provenance.binding.slotId);expect(c.lease.isCurrent()).toBe(true);events.push('stage');
   return {commit(){events.push('commit');},abort(){events.push('abort');}};
  }});
  expect(result.ok).toBe(true);expect(events).toEqual(['stage','commit']);expect(JSON.stringify(result)).not.toContain(proof);
 });
 it('does not activate a receipt when its durable commit fails',async()=>{
  const f=nativeFixture(),abort=vi.fn();f.fetch.mockImplementation(async()=>ok({runtime,runtime_token:proof,revealed:true},201));
  const result=await f.client.enrollRuntime({body:{label:'Runtime'}},{idempotencyKey:'capture',captureRuntime:c=>{f.state.provenance=c.provenance;return {commit(){throw Error('synthetic storage failure '+proof);},abort};}});
  expect(result).toMatchObject({ok:false,error:{code:'CAPTURE_FAILED'}});expect(abort).toHaveBeenCalledTimes(1);expect(JSON.stringify(result)).not.toContain(proof);
  expect(await f.client.call('createTask',{body:{title:'Task',description:''}},{idempotencyKey:'after'})).toMatchObject({ok:false,error:{code:'CREDENTIAL_UNBOUND'}});expect(f.fetch).toHaveBeenCalledTimes(1);
 });
});


describe('journal guard executes inside pinned native dispatch',()=>{
 it('awaits durable preparation and calls final synchronous gate once before fetch',async()=>{
  const f=nativeFixture();await f.enroll();const order:string[]=[];f.fetch.mockImplementation(async()=>{order.push('fetch');return ok(runtime);});
  const result=await f.client.call('heartbeatRuntime',{path:{runtime_instance_id:runtime.id},body:{expected_runtime_version:1}},{idempotencyKey:'original-key',runtimeProof:proof,dispatchGuard:async c=>{
   order.push('persist');expect(c.key).toBe('original-key');expect(c.binding).toEqual(f.state.provenance!.binding);expect(c.request.path).toBe('/v2/workspaces/ws/runtimes/runtime_one:heartbeat');expect(c.lease.isCurrent()).toBe(true);
   await Promise.resolve();return ()=>{order.push('check');};
  }});
  expect(result.ok).toBe(true);expect(order).toEqual(['persist','check','fetch']);
 });
 it('sends nothing when the durable stamp or final elapsed proof is denied',async()=>{
  for(const late of [false,true]){const f=nativeFixture();await f.enroll();
   const result=await f.client.call('createTask',{body:{title:'Task',description:''}},{idempotencyKey:'original-key',dispatchGuard:()=>{if(!late)throw Error('storage failure');return ()=>{throw Error('outside replay window');};}});
   expect(result.ok).toBe(false);expect(f.fetch).toHaveBeenCalledTimes(1);
  }
 });
});

describe('protected actual-lease proof dispatch hook',()=>{
 it('obtains proof only inside the actual credential dispatch lease',async()=>{
  const f=nativeFixture();await f.enroll();f.fetch.mockImplementation(async()=>ok(runtime));let called=0;
  const result=await f.client.call('heartbeatRuntime',{path:{runtime_instance_id:runtime.id},body:{expected_runtime_version:1}},{idempotencyKey:'proof-hook',runtimeProofDispatch:(context,send)=>{
   called++;expect(context.binding).toEqual(f.state.provenance!.binding);expect(context.runtimeId).toBe(runtime.id);expect(context.lease.isCurrent()).toBe(true);return send(proof);
  }});
  expect(result.ok).toBe(true);expect(called).toBe(1);expect(new Headers(f.fetch.mock.calls[1]![1]!.headers).get('x-runtime-token')).toBe(proof);
 });
 it('rejects a proof hook on a nonproof operation and double-provided proof',async()=>{
  const f=nativeFixture();await f.enroll();const hook=vi.fn((_context,send)=>send(proof));
  expect((await f.client.call('createTask',{body:{title:'Task',description:''}},{idempotencyKey:'key',runtimeProofDispatch:hook})).ok).toBe(false);
  expect((await f.client.call('heartbeatRuntime',{path:{runtime_instance_id:runtime.id},body:{expected_runtime_version:1}},{idempotencyKey:'key',runtimeProof:proof,runtimeProofDispatch:hook})).ok).toBe(false);expect(hook).not.toHaveBeenCalled();expect(f.fetch).toHaveBeenCalledTimes(1);
 });
});
it('rechecks the journal horizon after protected proof lookup immediately before fetch',async()=>{
 const f=nativeFixture();await f.enroll();let expired=false;
 const result=await f.client.call('heartbeatRuntime',{path:{runtime_instance_id:runtime.id},body:{expected_runtime_version:1}},{idempotencyKey:'late-proof',dispatchGuard:()=>()=>{if(expired)throw Error('deadline');},runtimeProofDispatch:(_c,send)=>{expired=true;return send(proof);}});
 expect(result.ok).toBe(false);expect(f.fetch).toHaveBeenCalledTimes(1);
});
it('rejects actual-lease proof lookup for another runtime path without fetch',async()=>{
 const f=nativeFixture();await f.enroll();const hook=vi.fn((_context,send)=>send(proof));
 expect(await f.client.call('heartbeatRuntime',{path:{runtime_instance_id:'runtime_other'},body:{expected_runtime_version:1}},{idempotencyKey:'wrong-runtime',runtimeProofDispatch:hook})).toMatchObject({ok:false,error:{code:'CREDENTIAL_CHANGED'}});expect(hook).not.toHaveBeenCalled();expect(f.fetch).toHaveBeenCalledTimes(1);
});
it('rejects public guard rotation before dispatch and observes deadline expiration inside provider currentness',async()=>{
 const rotated=nativeFixture();await rotated.enroll();expect((await rotated.client.call('createTask',{body:{title:'Task',description:''}},{idempotencyKey:'key',dispatchGuard:()=>()=>{rotated.state.generation++;}})).ok).toBe(false);expect(rotated.fetch).toHaveBeenCalledTimes(1);
 const f=nativeFixture({timeoutMs:15}),acquire=f.acquire.getMockImplementation()!;let block=false;
 f.acquire.mockImplementation(async()=>{const lease=await acquire();return {...lease,isCurrent:()=>{if(block){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);block=false;}return lease.isCurrent();}};});
 expect((await f.client.call('getConfiguration',{}, {dispatchGuard:()=>()=>{block=true;}})).ok).toBe(false);expect(f.fetch).not.toHaveBeenCalled();
});
it.each(['request-id','runtime-metadata'])('does not reflect one-time proof from canonical %s even without successful capture',async kind=>{
 const f=nativeFixture();f.fetch.mockImplementation(async()=>Response.json({data:{runtime:kind==='runtime-metadata'?{...runtime,label:proof}:runtime,runtime_token:proof,revealed:true},request_id:kind==='request-id'?proof:'safe_request'},{status:201}));
 const capture=vi.fn(()=>{throw Error('synthetic storage failure');});const result=await f.client.enrollRuntime({body:{label:'Synthetic'}},{idempotencyKey:'reflection',captureRuntime:capture});
 expect(result).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'},requestId:null});expect(JSON.stringify(result)).not.toContain(proof);expect(capture).not.toHaveBeenCalled();expect(f.fetch).toHaveBeenCalledTimes(1);
});
