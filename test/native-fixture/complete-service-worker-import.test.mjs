/** Actual workerd capability probe, no authority, credentials or unsafe eval. */
import test from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';
test('fixed service source dependency graph imports in normal nodejs-compatible workerd',async()=>{
 const directory=await mkdtemp(join(process.cwd(),'.complete-service-import-'));let mf;
 try{const scriptPath=join(directory,'worker.mjs');await build({stdin:{contents:"import {createCompleteServiceCore} from './scripts/lib/native-complete-service.mjs'; export default {fetch(){return new Response(typeof createCompleteServiceCore);}};",resolveDir:process.cwd(),sourcefile:'complete-service-import-probe.mjs'},outfile:scriptPath,bundle:true,platform:'neutral',format:'esm',mainFields:['module','main'],conditions:['node'],external:['node:*'],logLevel:'silent'});
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath,compatibilityDate:'2026-10-19',compatibilityFlags:['nodejs_compat']}));await mf.ready;const response=await mf.dispatchFetch('https://source-fixture.example/');assert.equal(await response.text(),'function');
 }finally{try{if(mf)await mf.dispose();}finally{await rm(directory,{recursive:true,force:true});}}
});
