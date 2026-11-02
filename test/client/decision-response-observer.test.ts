import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {installDecisionResponseObserver,type DecisionObserverHost} from '../helpers/decision-response-observer';
const origin='https://hub.fixture.example.invalid',path='/v2/workspaces/ws_example/approvals/approval:approve';
const init={method:'POST',headers:{'idempotency-key':'fixed-key'},body:'{"reason":"synthetic"}'};
function fixture(fetcher:typeof fetch){const host:DecisionObserverHost={fetch:fetcher,crypto,location:{origin}};installDecisionResponseObserver(host);return {host,observer:host.__decisionResponseObserver!};}
it('returns original fetch promise and response immediately while independently capturing actual clone EOF',async()=>{
 let finish!:()=>void;const original=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"actual":'));finish=()=>{c.enqueue(new TextEncoder().encode('true}'));c.close();};}}),{headers:{'content-type':'application/json'}}),pending=Promise.resolve(original),fetcher=vi.fn(()=>pending);
 const {host,observer}=fixture(fetcher);const bound=host.fetch.bind(host);observer.arm(path);const capture=observer.take(),sent=bound(origin+path,init);expect(sent).toBe(pending);expect(await sent).toBe(original);expect(fetcher).toHaveBeenCalledOnce();finish();const facts=await capture;expect(facts.text).toBe('{"actual":true}');expect(await original.text()).toBe(facts.text);expect(facts.status).toBe(200);expect(facts.bodySha256).toMatch(/^[a-f0-9]{64}$/);observer.dispose();
});
it('leaves other origins methods and paths untouched, with no matching observation',async()=>{
 const fetcher=vi.fn(async()=>new Response('unchanged'));const {host,observer}=fixture(fetcher);observer.arm(path);const capture=observer.take();
 for(const [url,options] of [['https://issuer.fixture.example.invalid'+path,init],[origin+'/other',init],[origin+path,{method:'GET'}]] as const)expect(await(await host.fetch(url,options)).text()).toBe('unchanged');
 observer.dispose();await expect(capture).rejects.toThrow('DECISION_OBSERVER_DISPOSED');expect(fetcher).toHaveBeenCalledTimes(3);
});
it.each([
 ['too-large',()=>new Response('x'.repeat(1048577),{headers:{'content-type':'application/json'}})],
 ['short',()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'3'}})],
 ['malformed-length',()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'02'}})],
 ['wrong-media',()=>new Response('{}',{headers:{'content-type':'text/plain'}})],
 ['invalid-utf8',()=>new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}})]
] as const)('rejects %s without replacing or consuming original response',async(_name,response)=>{
 const original=response(),{host,observer}=fixture(async()=>original);observer.arm(path);const captured=observer.take(),rejected=expect(captured).rejects.toThrow();expect(await host.fetch(origin+path,init)).toBe(original);await rejected;expect(original.bodyUsed).toBe(false);await original.arrayBuffer();observer.dispose();
});
it('fails duplicate matching calls while forwarding each original fetch only once',async()=>{
 const fetcher=vi.fn(async()=>Response.json({actual:true})),{host,observer}=fixture(fetcher);observer.arm(path);const captured=observer.take(),rejected=expect(captured).rejects.toThrow('DECISION_OBSERVER_DUPLICATE');
 await Promise.all([host.fetch(origin+path,init),host.fetch(origin+path,init)]);await rejected;expect(fetcher).toHaveBeenCalledTimes(2);observer.dispose();
});
it('does not consume an unsupported Request body or change its actual forwarding',async()=>{
 const fetcher=vi.fn(async()=>Response.json({actual:true})),{host,observer}=fixture(fetcher);observer.arm(path);const captured=observer.take(),rejected=expect(captured).rejects.toThrow('DECISION_OBSERVER_REQUEST_SHAPE');const request=new Request(origin+path,init);await host.fetch(request);await rejected;expect(request.bodyUsed).toBe(false);expect(fetcher).toHaveBeenCalledWith(request,undefined);observer.dispose();
});
it('times out an unfinished clone without aborting the original sibling and fences stale completion',async()=>{
 vi.useFakeTimers();try{let finish!:()=>void;const original=new Response(new ReadableStream({start(c){finish=()=>{c.enqueue(new TextEncoder().encode('{}'));c.close();};}}),{headers:{'content-type':'application/json'}}),{host,observer}=fixture(async()=>original);observer.arm(path);const captured=observer.take(),rejected=expect(captured).rejects.toThrow('DECISION_OBSERVER_TIMEOUT');await host.fetch(origin+path,init);await vi.advanceTimersByTimeAsync(30000);await rejected;observer.dispose();finish();expect(await original.text()).toBe('{}');
  observer.arm(path);const fresh=observer.take();observer.dispose();await expect(fresh).rejects.toThrow('DECISION_OBSERVER_DISPOSED');
 }finally{vi.useRealTimers();}
});
it('does not install on issuer documents and refuses malformed arm paths',()=>{
 const fetcher=vi.fn(async()=>new Response('issuer')),host:DecisionObserverHost={fetch:fetcher,crypto,location:{origin:'https://issuer.fixture.example.invalid'}};installDecisionResponseObserver(host);expect(host.fetch).toBe(fetcher);expect(host.__decisionResponseObserver).toBeUndefined();
 const f=fixture(fetcher);for(const invalid of ['/other',path+'?x=1','https://hub.fixture.example.invalid'+path])expect(()=>f.observer.arm(invalid)).toThrow('DECISION_OBSERVER_PATH');
});
it('fences delayed old fetch completion and retains only one unfinished capture budget',async()=>{
 let complete!:(response:Response)=>void;const pending=new Promise<Response>(resolve=>{complete=resolve;}),{host,observer}=fixture(()=>pending);observer.arm(path);const captured=observer.take(),rejected=expect(captured).rejects.toThrow('DECISION_OBSERVER_DISPOSED');expect(host.fetch(origin+path,init)).toBe(pending);observer.dispose();await rejected;expect(()=>observer.arm(path)).toThrow('DECISION_OBSERVER_BUSY');
 const original=Response.json({old:true});complete(original);await pending;await Promise.resolve();await Promise.resolve();await Promise.resolve();expect(original.bodyUsed).toBe(false);expect(await original.json()).toEqual({old:true});
 observer.arm(path);const fresh=observer.take();observer.dispose();await expect(fresh).rejects.toThrow('DECISION_OBSERVER_DISPOSED');
});
it('requires a key and bounded string body without changing original fetch rejection or response',async()=>{
 for(const options of [{method:'POST',body:'{}'},{...init,body:'x'.repeat(65537)}]){const original=Response.json({actual:true}),{host,observer}=fixture(async()=>original);observer.arm(path);const captured=observer.take(),rejected=expect(captured).rejects.toThrow('DECISION_OBSERVER_REQUEST_SHAPE');expect(await host.fetch(origin+path,options)).toBe(original);await rejected;observer.dispose();}
 const originalError=Error('ACTUAL_FETCH_FAILURE'),pending=Promise.reject(originalError);void pending.catch(()=>{});const {host,observer}=fixture(()=>pending);observer.arm(path);const captured=observer.take(),rejected=expect(captured).rejects.toThrow('DECISION_OBSERVER_CAPTURE_FAILED');expect(host.fetch(origin+path,init)).toBe(pending);await expect(pending).rejects.toBe(originalError);await rejected;observer.dispose();
});
it('uses decoded EOF count for encoded transfers, without treating encoded length as decoded length',async()=>{
 const original=new Response('{"decoded":true}',{headers:{'content-type':'application/json','content-encoding':'gzip','content-length':'999'}}),{host,observer}=fixture(async()=>original);observer.arm(path);const captured=observer.take();await host.fetch(origin+path,init);expect((await captured).text).toBe('{"decoded":true}');expect(await original.text()).toBe('{"decoded":true}');observer.dispose();
});
it('has no product entry import or build-configuration inclusion',()=>{
 for(const path of ['../../src/index.ts','../../src/ui/app.ts','../../scripts/build-ui.mjs','../../wrangler.jsonc'])expect(readFileSync(new URL(path,import.meta.url),'utf8')).not.toContain('decision-response-observer');
});
