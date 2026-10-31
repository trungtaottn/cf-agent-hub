import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('actual local complete fixture uses normal login and fixed P/F bindings (source only)',async()=>{
 const directory=await mkdtemp(join(process.cwd(),'.complete-local-test-'));let fixture;
 try{
  const outfile=join(directory,'fixture.mjs');
  await build({entryPoints:[join(process.cwd(),'test/helpers/native-complete/local-fixture.ts')],outfile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
  const api=await import(pathToFileURL(outfile).href);fixture=await api.createLocalCompleteFixture();
  assert.equal(fixture.expected.role,'primary');assert.notEqual(fixture.expected.workspaces.primary.id,fixture.expected.workspaces.foreign.id);
  assert.match(fixture.human.session_cookie,/^[A-Za-z0-9_-]{43}$/);assert.match(fixture.human.csrf_token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(typeof Object.getOwnPropertyDescriptor(fixture.controller,'installRequiredRun').value,'function');
  assert.equal(typeof Object.getOwnPropertyDescriptor(fixture.controller,'fetch').value,'function');
  // Actual Miniflare proxy ingress must still reject an unconfigured foreign Origin.
  const rejected=await fixture.controller.fetch(new Request('https://hub.example.invalid/v2/workspaces/ws_example/credentials/cred_s:revoke',{method:'POST',headers:{origin:'https://foreign-origin.example.invalid','content-type':'application/json'},body:'{}'}));
  assert.equal(rejected.status,403);await rejected.body?.cancel();
  assert.deepEqual(fixture.startup,{scope:'source-test-only',reconciliations:2,auth_requests:3,metadata_selects:3,metadata_kv_reads:2,metadata_kv_writes:2});
  assert.equal((await fixture.close()).status,'closed');assert.equal((await fixture.close()).status,'closed');
 }finally{if(fixture)await fixture.close();await rm(directory,{recursive:true,force:true});}
});

test('source-instrumented delayed request body cannot forward after local close',async()=>{
 const {Miniflare}=await import('miniflare'),original=Miniflare.prototype.getBindings;let forwarded=0,fixture,release;const gate=new Promise(r=>release=r),directory=await mkdtemp(join(process.cwd(),'.complete-local-test-'));
 Miniflare.prototype.getBindings=async function(...args){const e=await original.apply(this,args);return {WORKSPACE:e.WORKSPACE,CONTROLLER:{getByName(name){const s=e.CONTROLLER.getByName(name);return Object.fromEntries(['installRequiredRun','provisionRequiredRun','openRequiredPhase','closeRequiredPhase','observeRequiredControl','openRequiredAuxiliary','closeRequiredAuxiliary','completeRequiredExternalE1','readRequiredPrivateProjection','closeRequiredRun','fetch'].map(k=>[k,(...a)=>{if(k==='fetch')forwarded++;return s[k](...a);} ]));}}};};
 try{const outfile=join(directory,'fixture.mjs');await build({entryPoints:[join(process.cwd(),'test/helpers/native-complete/local-fixture.ts')],outfile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});const api=await import(pathToFileURL(outfile).href);fixture=await api.createLocalCompleteFixture();let entered;const reading=new Promise(r=>entered=r);const body=new ReadableStream({async pull(c){entered();await gate;try{c.enqueue(new Uint8Array([120]));c.close();}catch{}},cancel(){release();}}),request=new Request('https://hub.example.invalid/v2/workspaces/ws_example/tasks',{method:'POST',body,duplex:'half'}),work=fixture.controller.fetch(request);work.catch(()=>{});await reading;const cleanup=fixture.close();await new Promise(r=>setImmediate(r));release();await assert.rejects(work);await cleanup;assert.equal(forwarded,0);}finally{release();if(fixture)await fixture.close();Miniflare.prototype.getBindings=original;await rm(directory,{recursive:true,force:true});}
});
