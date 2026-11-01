import {binding} from './helpers';
import {beforeAll,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const artifact='dist/observation-adapter/reporter.mjs';
beforeAll(()=>{const r=spawnSync(process.execPath,['scripts/build-observation-adapter.mjs'],{encoding:'utf8'});expect(r.status).toBe(0);},30000);
it('separate_artifact_has_no_native_host_entry_or_generic_owner_registration',()=>{
 const manifest=JSON.parse(readFileSync('dist/observation-adapter/reporter.manifest.json','utf8'));const bytes=readFileSync(artifact);expect(manifest.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));expect(manifest.byte_size).toBe(bytes.length);expect(bytes.length).toBeLessThan(4194304);
 expect(manifest.inputs).toContain('packages/observation-adapter/src/owner-transport.ts');expect(manifest.inputs).toContain('packages/cli/src/secret-store.ts');expect(manifest.inputs).not.toContain('scripts/native-complete-host-entry.mjs');expect(manifest.inputs.every((p:string)=>!p.startsWith('../')&&!p.startsWith('/')&&!p.startsWith('test/'))).toBe(true);
 const catalog=readFileSync('src/http/generated/client-operations.ts','utf8');expect(catalog).not.toMatch(/observations:establish|observation-sessions:replace/);
});
it('actual_unconfigured_executable_is_neutral_and_never_initializes_state',()=>{
 const directory=mkdtempSync(join(dirname(process.cwd()),'b2-unconfigured-'));try{for(const input of ['',JSON.stringify({hook_event_name:'PostToolUse',tool_name:'Read',tool_input:{file_path:'/private/path',content:'SECRET'}})]){
 const r=spawnSync(process.execPath,[artifact,'--credential','SECRET','--state',directory],{input,encoding:'utf8',timeout:3000});expect({status:r.status,stdout:r.stdout,stderr:r.stderr}).toEqual({status:0,stdout:'',stderr:''});
 }}finally{rmSync(directory,{recursive:true,force:true});}
});
it('artifact_exposes_usable_trusted_provider_API_with_process_entry_budget',()=>{
 const source=`import {runTrustedHook} from './${artifact}'; let called=0; const result=await runTrustedHook(()=>{called++;throw Error('SECRET')},new ReadableStream(),performance.now());if(result!==0||called!==1)process.exitCode=1;`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:3000});expect({status:r.status,stdout:r.stdout,stderr:r.stderr}).toEqual({status:0,stdout:'',stderr:''});
 const expired=spawnSync(process.execPath,['--input-type=module','-e',`import {runTrustedHook} from './${artifact}'; let called=0; await runTrustedHook(()=>{called++;throw Error('SECRET')},new ReadableStream(),performance.now()-2001);if(called)process.exitCode=1;`],{encoding:'utf8',timeout:3000});expect({status:expired.status,stdout:expired.stdout,stderr:expired.stderr}).toEqual({status:0,stdout:'',stderr:''});
});
it('built_trusted_API_lazily_reopens_real_protected_store_and_is_silent',async()=>{
 const {protectedFixture}=await import('./owner-helper');const {testFlock}=await import('./flock-profile');const {withStateLock}=await import('../../packages/observation-adapter/src/state-file');const {Deadline}=await import('../../packages/client/src/transport');const f=await protectedFixture();const directory=mkdtempSync(join(dirname(process.cwd()),'b2-artifact-state-')),state={directory,worktreeRoot:process.cwd(),flock:testFlock};
 const d=new Deadline(2000);try{await withStateLock({...state,purpose:'initialize'},d,async store=>store.initialize(f.binding));}finally{d.dispose();}f.provider.close();
 try{
 const source=`import {runTrustedHook} from './${artifact}';import {readFileSync} from 'node:fs';let calls=0;const binding=${JSON.stringify(f.binding)},state=${JSON.stringify(state)};await runTrustedHook(()=>({binding,state,root:'/private/checkout',profile:'claude-posttooluse-path-docs-20261101-v1',observedAt:'2026-11-01T00:00:00.000Z',credentialDirectory:${JSON.stringify(f.directory)},currentBinding:()=>binding,fetch:async(u,i)=>{calls++;const saved=JSON.parse(readFileSync(state.directory+'/state.json','utf8'));if(saved.phase!=='pending'||!new Headers(i.headers).has('x-runtime-token'))throw Error('SYNTHETIC_NOT_READY');return Response.json({data:{kind:'current_binding',session_id:'obs_'+'a'.repeat(48),session_epoch:1,run_id:binding.runId,fence:1,established_at:'2026-11-01T00:00:00.000Z',coverage:{configured_events:['read-observed','write-observed'],completeness:'unknown',reported_loss:false}},request_id:'synthetic'});}}),new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({hook_event_name:'PostToolUse',cwd:'/private/checkout',tool_name:'Read',tool_input:{file_path:'/private/checkout/file.ts'}})));c.close();}}));if(calls!==1)process.exitCode=JSON.parse(readFileSync(state.directory+'/state.json','utf8')).phase==='pending'?2:3;`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:4000});expect({status:r.status,stdout:r.stdout,stderr:r.stderr}).toEqual({status:0,stdout:'',stderr:''});const persisted=readFileSync(join(directory,'state.json'),'utf8');expect(JSON.parse(persisted)).toMatchObject({phase:'awaiting-owner-status',session:{highWater:null}});expect(persisted).not.toMatch(/SSSS|PPPP|runtime_token|authorization/);
 }finally{f.close();rmSync(directory,{recursive:true,force:true});}
});
// Historical B1/adapter-only baseline: 4,170,954 bytes, SHA256
// 0362f94729789325c39c7c45d52ef039dafae164a1a2a40130268ee5bfb67cfa.
// Prior schema19/MCP17 baseline: 4,188,076 bytes, SHA256
// d63c8574ea26e2d290abf1e19417ae522e4d89e7be4e063653172bbceb97c66f.
// Current schema19 + MCP17 + claim-only reconciliation has a distinct exact identity.
it('native_complete_host_matches_reviewed_claim_lookup_identity_and_unchanged_cap',()=>{
 const result=spawnSync(process.execPath,['scripts/build-native-host.mjs'],{encoding:'utf8',timeout:30000});expect(result.status).toBe(0);
 const bytes=readFileSync('dist/native-host/host-v2.mjs');expect(bytes.length).toBe(4189618);expect(bytes.length).toBeLessThanOrEqual(4194304);expect(createHash('sha256').update(bytes).digest('hex')).toBe('3f8efe03be2d2d5956bbcac0eeac39640415eda1863841714f3c2e6fa1d6e517');
 const manifest=readFileSync('dist/native-host/host-v2.manifest.json');expect(createHash('sha256').update(manifest).digest('hex')).toBe('b3daa008ea167217f990b7b75e6c19c29694a74f2ba2ae9df419f231d05b1c91');
},30000);
it('built_entry_budget_includes_trusted_preparation_and_stalled_stdin',()=>{
 const source=`import {runTrustedHook} from './${artifact}';const start=performance.now(),binding=${JSON.stringify(binding)};await runTrustedHook(()=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1500);return {binding,root:'/private/checkout',profile:'claude-posttooluse-path-docs-20261101-v1',observedAt:'2026-11-01T00:00:00.000Z',state:{flock:{}},credentialDirectory:'/missing',currentBinding:()=>binding}},new ReadableStream({pull(){return new Promise(()=>{})}}),start);if(performance.now()-start<1800||performance.now()-start>2500)process.exitCode=1;`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:4000});expect({status:result.status,stdout:result.stdout,stderr:result.stderr}).toEqual({status:0,stdout:'',stderr:''});
});
it('default_process_origin_budget_is_already_exhausted_before_late_preparation',()=>{
 const source=`import {runTrustedHook} from './${artifact}';const remaining=2001-performance.now();if(remaining>0)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,remaining);let called=0;await runTrustedHook(()=>{called++;return null},new ReadableStream());if(called)process.exitCode=1;`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:4000});expect({status:result.status,stdout:result.stdout,stderr:result.stderr}).toEqual({status:0,stdout:'',stderr:''});
});
