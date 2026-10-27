import {operatorInclude} from './test/helpers/runtime-suites';
import {build} from 'esbuild';
import {cloudflareTest} from '@cloudflare/vitest-plugin';
import {defineConfig} from 'vitest/config';
import {operatorFixture} from './test/helpers/operator-fixture';
const fixture=await operatorFixture();
const app=await build({entryPoints:['./src/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*','node:*'],loader:{'.sql':'text'}});
const outboundService=async(request:any)=>{
 const response=await fixture.handler(new Request(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:request.method==='GET'||request.method==='HEAD'?undefined:await request.arrayBuffer(),redirect:'manual'}));
 return new Response(await response.arrayBuffer(),{status:response.status,headers:response.headers});
};
export default defineConfig({plugins:[cloudflareTest({main:'./workers/operator/src/index.ts',remoteBindings:false,miniflare:{
 compatibilityDate:'2026-10-19',bindings:fixture.bindings,durableObjects:{WORKSPACE:{className:'WorkspaceDO',scriptName:'workspace-app'},SOURCE_WORKSPACE:{className:'WorkspaceDO',scriptName:'workspace-source'}},outboundService,
 workers:[{name:'workspace-app',compatibilityDate:'2026-10-19',bindings:fixture.workspaceBindings,modules:[{type:'ESModule',path:'workspace.mjs',contents:app.outputFiles[0].text}],durableObjects:{WORKSPACE:{className:'WorkspaceDO',useSQLite:true}},r2Buckets:{RECOVERY_BUCKET:'operator-integration-recovery'},outboundService},{name:'workspace-source',compatibilityDate:'2026-10-19',bindings:fixture.sourceBindings,modules:[{type:'ESModule',path:'workspace.mjs',contents:app.outputFiles[0].text}],durableObjects:{WORKSPACE:{className:'WorkspaceDO',useSQLite:true}},r2Buckets:{RECOVERY_BUCKET:'operator-source-recovery'},outboundService}]
}})],test:{include:operatorInclude,fileParallelism:false}});
