import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { configDefaults,defineConfig } from 'vitest/config';
import { outboundProvider } from './test/helpers/outbound-oidc-provider';
const provider=await outboundProvider();
export default defineConfig({plugins:[cloudflareTest({wrangler:{configPath:'./wrangler.jsonc',environment:'test'},miniflare:{bindings:provider.bindings,outboundService:async request=>{
 const response=await provider.handler(new Request(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:request.method==='GET'||request.method==='HEAD'?undefined:await request.arrayBuffer(),redirect:'manual'}));
 return new Response(await response.arrayBuffer(),{status:response.status,headers:response.headers});
}}})],test:{exclude:[...configDefaults.exclude,'test/auth/operator-provisioning.test.ts','test/auth/operator-gateway.test.ts'],include:['test/workspace/**/*.test.ts','test/storage/**/*.test.ts','test/auth/**/*.test.ts'],fileParallelism:false}});
