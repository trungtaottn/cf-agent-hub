// Synthetic integration composition only. No production provider or deployment binding is added.
import {cloudflareTest} from '@cloudflare/vitest-plugin';
import {defineConfig} from 'vitest/config';
import {operatorFixture} from './test/helpers/operator-fixture';
const issuer=await operatorFixture();
const anchors=new Map<string,Record<string,unknown>>();
const adapt=async(request:any,handler:(request:Request)=>Promise<Response>)=>{
 const response=await handler(new Request(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:request.method==='GET'||request.method==='HEAD'?undefined:await request.arrayBuffer(),redirect:'manual'}));
 return new Response(await response.arrayBuffer(),{status:response.status,headers:response.headers});
};
export default defineConfig({plugins:[cloudflareTest({main:'./test/helpers/current-restore-operator-worker.ts',additionalExports:{NoAnchorWorkspaceDO:'DurableObject'},wrangler:{configPath:'./wrangler.jsonc',environment:'test'},miniflare:{
 durableObjects:{NO_ANCHOR_WORKSPACE:{className:'NoAnchorWorkspaceDO',useSQLite:true}},r2Buckets:['TEST_RESTORE_ARTIFACT_BUCKET'],bindings:{...issuer.bindings,CURRENT_RESTORE_OPERATOR_TEST:'enabled',RECOVERY_ENVIRONMENT_ID:'current_target',RECOVERY_INTEGRITY_KEY_ID:'recovery_fixture',RECOVERY_INTEGRITY_KEY:Buffer.from('r'.repeat(32)).toString('base64'),RECOVERY_ANCHOR_BINDING_ID:'operator_anchor_fixture',RECOVERY_RELEASE:JSON.stringify({revision:'operator_restore_fixture',worker_version:'operator_restore_fixture',binding_ids:['operator_anchor_fixture','recovery_fixture','artifact_fixture']})},
 serviceBindings:{RECOVERY_ANCHOR:async(request:any)=>adapt(request,async request=>{
  if(request.url!=='https://recovery-anchor.invalid/current'||request.method!=='POST')return new Response(null,{status:403});
  const input=await request.json() as {object_name:string};const anchor=anchors.get(input.object_name);
  return anchor?Response.json(anchor):new Response(null,{status:503});
 })},
 outboundService:async(request:any)=>adapt(request,async request=>{
  if(request.url==='https://operator-restore-control.invalid/anchor'&&request.method==='POST'){
   const anchor=await request.json() as Record<string,unknown>;anchors.set(String(anchor.object_name),anchor);return Response.json({ok:true});
  }
  return issuer.handler(request);
 })
}})],test:{include:['test/recovery/current-restore-operator.test.ts'],fileParallelism:false}});
