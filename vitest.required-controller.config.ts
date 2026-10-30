import {cloudflareTest} from '@cloudflare/vitest-plugin';
import {defineConfig} from 'vitest/config';
import {outboundProvider} from './test/helpers/outbound-oidc-provider';
const provider=await outboundProvider();
export default defineConfig({plugins:[cloudflareTest({wrangler:{configPath:'./test/helpers/required-controller.wrangler.jsonc'},miniflare:{serviceBindings:{RECOVERY_ANCHOR:async()=>new Response(null,{status:503})},bindings:provider.bindings,outboundService:async request=>{const response=await provider.handler(new Request(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:request.method==='GET'||request.method==='HEAD'?undefined:await request.arrayBuffer(),redirect:'manual'}));return new Response(await response.arrayBuffer(),{status:response.status,headers:response.headers});}}})],test:{include:['test/native-fixture/native-required-controller.test.ts'],fileParallelism:false}});
