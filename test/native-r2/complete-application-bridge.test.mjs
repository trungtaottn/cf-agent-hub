import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompleteApplicationBridge} from '../../scripts/lib/native-complete-application-bridge.mjs';
const request=(body)=>new Request('https://fixture.example/v2/workspaces/W/tasks',{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer synthetic','x-test':'preserve'},...(body===undefined?{}:{body,duplex:'half'})});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
test('forwards exact bytes and headers once; response remains owned until consumption',async()=>{
 let count=0;const b=createCompleteApplicationBridge({controllerFetch:async r=>{count++;assert.equal(r.url,'https://fixture.example/v2/workspaces/W/tasks');assert.equal(r.method,'POST');assert.equal(r.headers.get('x-test'),'preserve');assert.equal(await r.text(),'hello');return new Response('world',{status:201,statusText:'Created',headers:{'x-reply':'kept'}});}});
 const r=await b.forward(request('hello'));assert.equal(count,1);assert.equal(r.status,201);assert.equal(r.headers.get('x-reply'),'kept');assert.equal(b.snapshot().pending_publications,1);assert.equal(await r.text(),'world');assert.equal(b.snapshot().pending_publications,0);assert.equal((await b.close()).status,'closed');
});
test('captures fixed data function once and rejects accessor or proxy injection',async()=>{
 let hit=0;assert.throws(()=>createCompleteApplicationBridge({get controllerFetch(){hit++;return ()=>{};}}));assert.equal(hit,0);assert.throws(()=>createCompleteApplicationBridge(new Proxy({controllerFetch:()=>{}},{})));
 const input={controllerFetch:async()=>new Response(null,{status:204})};const b=createCompleteApplicationBridge(input);input.controllerFetch=()=>{throw Error('replacement');};assert.equal((await b.forward(request())).status,204);assert.equal((await b.close()).status,'closed');
});
test('rejects fake, proxy, disturbed and locked requests without dispatch',async()=>{
 for(const make of [()=>({url:'https://fixture.example'}),()=>new Proxy(request(),{}),async()=>{const r=request('used');await r.text();return r;},()=>{const r=request('locked');r.body.getReader();return r;}]){let n=0;const b=createCompleteApplicationBridge({controllerFetch:()=>{n++;}});await assert.rejects(b.forward(await make()));assert.equal(n,0);}
});
test('rejects fake and used responses rather than duck typing',async()=>{
 for(const make of [()=>({status:200,body:null}),()=>new Proxy(new Response('x'),{}),async()=>{const r=new Response('x');await r.text();return r;}]){const b=createCompleteApplicationBridge({controllerFetch:async()=>make()});await assert.rejects(b.forward(request()));assert.equal(b.snapshot().failed,true);}
});
test('HOLD retains actual fetch until external disarm resolves, without blocking snapshot',async()=>{
 const held=deferred();const b=createCompleteApplicationBridge({controllerFetch:()=>held.promise});const pending=b.forward(request());await tick();assert.equal(b.snapshot().pending_fetches,1);held.resolve(new Response('released'));const r=await pending;assert.equal(b.snapshot().pending_fetches,0);assert.equal(b.snapshot().pending_publications,1);assert.equal(await r.text(),'released');assert.equal((await b.close()).status,'closed');
});
test('abort rejects outward await but unresolved underlying fetch stays owned',async()=>{
 const actual=deferred(),ac=new AbortController();let seen;const b=createCompleteApplicationBridge({controllerFetch:r=>{seen=r.signal;return actual.promise;}});const p=b.forward(new Request('https://fixture.example',{signal:ac.signal}));await tick();ac.abort();await assert.rejects(p);assert.equal(seen.aborted,true);assert.equal(b.snapshot().pending_fetches,1);actual.resolve(new Response('late'));await tick();await tick();assert.equal((await b.close()).status,'closed');
});
test('unread response close cancellation must settle before closed',async()=>{
 const cancellation=deferred();let n=0;const b=createCompleteApplicationBridge({controllerFetch:()=>new Response(new ReadableStream({cancel(){n++;return cancellation.promise;}}))});await b.forward(request());const result=await b.close();assert.equal(n,1);assert.equal(result.status,'cleanup-unknown');assert.ok(b.snapshot().pending_cancellations>0);cancellation.resolve();await tick();assert.equal((await b.close()).status,'closed');
});
test('failed cancellation never becomes closed',async()=>{
 const b=createCompleteApplicationBridge({controllerFetch:()=>new Response(new ReadableStream({cancel(){throw Error('private reason');}}))});await b.forward(request());assert.equal((await b.close()).status,'cleanup-unknown');assert.equal((await b.close()).status,'cleanup-unknown');
});
test('enforces response single and aggregate streamed byte bounds',async()=>{
 const b=createCompleteApplicationBridge({controllerFetch:()=>new Response(new Uint8Array(26606))});const r=await b.forward(request());await assert.rejects(r.arrayBuffer());assert.equal(b.snapshot().failed,true);
 const c=createCompleteApplicationBridge({controllerFetch:()=>new Response(new Uint8Array(26605))});for(let i=0;i<4;i++)assert.equal((await (await c.forward(request())).arrayBuffer()).byteLength,26605);await assert.rejects((await c.forward(request())).arrayBuffer());
});
test('enforces request bytes and count without retry or zero-chunk churn',async()=>{
 let n=0;const b=createCompleteApplicationBridge({controllerFetch:async r=>{n++;await r.arrayBuffer();return new Response(null,{status:204});}});await assert.rejects(b.forward(request(new Uint8Array(369))));assert.equal(n,1);
 const c=createCompleteApplicationBridge({controllerFetch:()=>new Response(null,{status:204})});for(let i=0;i<57;i++)await c.forward(request());await assert.rejects(c.forward(request()));
 const d=createCompleteApplicationBridge({controllerFetch:()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array());}}))});await assert.rejects((await d.forward(request())).arrayBuffer());
});
test('close forbids new work and cancels request body not consumed by controller',async()=>{
 let cancelled=0;const b=createCompleteApplicationBridge({controllerFetch:()=>new Response(null,{status:204})});await b.forward(request(new ReadableStream({cancel(){cancelled++;}})));assert.equal((await b.close()).status,'closed');assert.equal(cancelled,1);await assert.rejects(b.forward(request()));
});
test('unowned locked response latches cleanup unknown instead of success',async()=>{
 const r=new Response('locked');const reader=r.body.getReader();const b=createCompleteApplicationBridge({controllerFetch:()=>r});await assert.rejects(b.forward(request()));assert.equal((await b.close()).status,'cleanup-unknown');await reader.cancel();reader.releaseLock();
});
test('proxy/accessor/shared chunks are rejected without invoking untrusted hooks',async()=>{
 for(const kind of ['proxy','accessor','shared']){let hooks=0;let chunk;if(kind==='proxy')chunk=new Proxy(new Uint8Array([1]),{getPrototypeOf(){hooks++;return Uint8Array.prototype;},get(){hooks++;return 1;}});else if(kind==='accessor'){chunk=new Uint8Array([1]);Object.defineProperty(chunk,'byteLength',{get(){hooks++;return 1;}});}else chunk=new Uint8Array(new SharedArrayBuffer(1));
  const b=createCompleteApplicationBridge({controllerFetch:()=>new Response(new ReadableStream({start(c){c.enqueue(chunk);c.close();}}))});await assert.rejects((await b.forward(request())).arrayBuffer());assert.equal(hooks,0);
 }
});
test('copied publication chunk cannot be mutated after its bounded read',async()=>{
 const bytes=new Uint8Array([1,2]);const b=createCompleteApplicationBridge({controllerFetch:()=>new Response(new ReadableStream({start(c){c.enqueue(bytes);c.close();}}))});const reader=(await b.forward(request())).body.getReader();const v=await reader.read();bytes[0]=9;assert.deepEqual([...v.value],[1,2]);await reader.read();reader.releaseLock();assert.equal((await b.close()).status,'closed');
});
test('actual stream locked accessor is never called and malformed stream remains cleanup unknown',async()=>{
 let hooks=0;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.close();}});const original=new Response(stream);Object.defineProperty(stream,'locked',{get(){hooks++;return false;}});const b=createCompleteApplicationBridge({controllerFetch:()=>original});assert.deepEqual([...new Uint8Array(await (await b.forward(request())).arrayBuffer())],[1]);assert.equal(hooks,0);assert.equal((await b.close()).status,'closed');
 const malformed=new ReadableStream();const response=new Response(malformed);Object.setPrototypeOf(malformed,{});const c=createCompleteApplicationBridge({controllerFetch:()=>response});await assert.rejects(c.forward(request()));assert.equal((await c.close()).status,'cleanup-unknown');
});
