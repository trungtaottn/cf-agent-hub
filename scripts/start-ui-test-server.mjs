import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createTestHarness } from 'wrangler';
import {startReadOnlyPreview} from './lib/local-readonly-preview.mjs';

const originalFetch=globalThis.fetch;
let harness,fixture,preview,buildDirectory,stopping=false;
async function dispose() {
 if(stopping)return;stopping=true;
 globalThis.fetch=originalFetch;
 const failures=[];
 for(const close of [()=>preview?.close(),()=>fixture?.close(),()=>harness?.close()])try{await close();}catch(error){failures.push(error);}
 if(buildDirectory)await rm(buildDirectory,{recursive:true,force:true});
 if(failures.length)throw Error('FIXTURE_TEARDOWN_FAILED');
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void dispose().then(()=>process.exit(0),()=>process.exit(1));});
try {
 if(process.argv.includes('--preview-readonly')&&process.argv.some(arg=>arg==='--self-check'||arg==='--self-check-r2'))throw Error('FIXTURE_MODE_CONFLICT');
 await mkdir('.superpowers/tmp',{recursive:true});
 buildDirectory=await mkdtemp(resolve('.superpowers/tmp/ui-build-'));
 const modulePath=join(buildDirectory,'fixture.mjs');
 await build({
  stdin:{contents:`export * from './test/helpers/https-oidc-provider.ts'; export * from './test/helpers/environment.ts'; export * from './src/config/bootstrap.ts'; export * from './test/helpers/r2-ui-fixture.ts';`,resolveDir:process.cwd()},
  outfile:modulePath,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'
 });
 const {startHttpsFixture,APP_ORIGIN,ISSUER_ORIGIN,fixture:configurationFixture,operator,prepareBootstrap,sha256,canonicalJson,configureR2UiFixture,seedR2UiFixture}=await import(pathToFileURL(modulePath).href);
 let worker,r2Fixture=null,currentName='ui-fixture',dropPreferencesResponse=false,control=async(_action)=>{throw Error('FIXTURE_NOT_READY');};
 const providerClientSecret=randomBytes(32).toString('base64url'),csrfSecret=randomBytes(32).toString('base64url'),cursorSecret=randomBytes(32).toString('hex');
 fixture=await startHttpsFixture({fetch:async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url);
  if(url.pathname==='/__ui_fixture/control'){
   if(request.method!=='POST'||request.headers.get('origin')!==APP_ORIGIN)return new Response(null,{status:403});
   const value=await request.json();if(Object.keys(value).length!==1||typeof value.action!=='string')return new Response(null,{status:400});
   await control(value.action);return Response.json({ok:true});
  }
  const response=await worker.fetch(input,init);
  if(dropPreferencesResponse&&request.method==='PUT'&&url.pathname==='/v2/workspaces/ws_example/preferences'){
   if(response.ok){await response.arrayBuffer();throw Error('FIXTURE_DROP_COMMITTED_RESPONSE');}
  }
  return response;
 }},{clientSecret:providerClientSecret,subjects:['synthetic-subject','restricted-subject','tasks-only-subject']});
 globalThis.fetch=fixture.dispatch;
 const probePath=join(buildDirectory,'egress-probe.mjs');
 await writeFile(probePath,"export default {async fetch(request){try{return await fetch(request);}catch{return new Response(null,{status:599,headers:{'x-fixture-egress-denied':'1'}});}}};\n");
 const installPath=join(buildDirectory,'fixture-install.mjs');
 await writeFile(installPath,"export default {async fetch(request,env){if(request.method!=='POST'||new URL(request.url).pathname!=='/install')return new Response(null,{status:404});const value=await request.json();const target=env.WORKSPACE.getByName(value.name);const receipt=await target.reconcileConfiguration(value.operator,value.input);return Response.json(receipt);}};\n");
 const input=await configurationFixture('ui-fixture');
 input.config.authentication.issuer=ISSUER_ORIGIN;
 input.config.authentication.allowed_origins=[APP_ORIGIN];
 input.config.authentication.redirect_uris[0].redirect_uri=APP_ORIGIN+'/v2/workspaces/ws_example/auth/callback';
 input.config.authentication.reviewed_oidc_endpoints={authorization_endpoint:ISSUER_ORIGIN+'/authorize',token_endpoint:ISSUER_ORIGIN+'/token',jwks_uri:ISSUER_ORIGIN+'/jwks'};
 input.config.human_grants[0].issuer=ISSUER_ORIGIN;
 input.config.human_grants.push({...structuredClone(input.config.human_grants[0]),principal_id:'human_restricted',subject:'restricted-subject',scopes:['workspace:read','events:read'],project_ids:[]});
 input.config.static_credential_refs[0].expires_at=new Date(Date.now()+30*86400000).toISOString();
 const fixtureNativeToken=randomBytes(32).toString('base64url');
 input.bundle.credentials[0].token_sha256=await sha256(fixtureNativeToken);
 input.bundle.config_digest=await sha256(canonicalJson(input.config));
 const {auth:_,...unsigned}=input.bundle;
 input.bundle.auth.tag=createHmac('sha256',randomBytes(32)).update(canonicalJson(unsigned)).digest('hex');
 const baselineConfig=structuredClone(input.config);
 const prepared=await prepareBootstrap(input.config,input.bundle,'ws_example');
 const harnessOptions=()=>({workers:[{configPath:'./wrangler.jsonc',env:'test',vars:{DEPLOYMENT_CONFIG:JSON.stringify(input.config)},secrets:{[input.config.authentication.client_secret_ref]:providerClientSecret,CSRF_SECRET:csrfSecret,CURSOR_ENCRYPTION_KEY:cursorSecret}},{configPath:'./workers/recovery-anchor/wrangler.jsonc',env:'test'},{config:{name:'cf-agent-hub-egress-fixture',main:probePath,compatibility_date:'2026-10-19'}},{config:{name:'cf-agent-hub-control-fixture',main:installPath,compatibility_date:'2026-10-19',durable_objects:{bindings:[{name:'WORKSPACE',class_name:'WorkspaceDO',script_name:'cf-agent-hub-test'}]}}}]});
 harness=createTestHarness(harnessOptions());
 await harness.listen();
 worker=harness.getWorker();
 const bindings=await worker.getEnv();
 const stub=bindings.WORKSPACE.getByName('ui-fixture');
 // Synthetic fixture context travels only over this trusted internal binding.
 // Task4's authenticated gateway owns the production Access/HMAC verification.
 const receipt=await stub.reconcileConfiguration(operator(),prepared);
 assert.equal(receipt.installationDigest,prepared.installationDigest);
 assert.equal(receipt.epoch,1);
 const admission=await stub.command({workspaceId:'ws_example',objectName:'ui-fixture',requestId:'req_fixture_ready',operation:'readiness'});
 assert.equal(admission.code,'AUTHENTICATION_REQUIRED');
 const storage=await worker.getDurableObjectStorage('WORKSPACE',{name:'ui-fixture'});
 const grants=await storage.exec('SELECT COUNT(*) AS count FROM human_grants WHERE enabled=1');
 assert.equal(grants[0].count,2);
 const credentials=await storage.exec('SELECT COUNT(*) AS count FROM native_credentials WHERE enabled=1');
 assert.equal(credentials[0].count,1);
 const live=await worker.fetch(APP_ORIGIN+'/health/live');
 assert.equal(live.status,200);assert.match(live.headers.get('content-type')??'',/^application\/json\b/);assert.deepEqual(await live.json(),{status:'alive'});
 const probe=harness.getWorker('cf-agent-hub-egress-fixture');
 await fixture.selfCheck(async(input,init)=>{const request=new Request(input,init);const response=await probe.fetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:request.body?await request.arrayBuffer():undefined,redirect:'manual'});if(response.headers.get('x-fixture-egress-denied')==='1')throw Error('FIXTURE_EGRESS_DENIED');return response;});
 // These controls exist only in the isolated HTTPS fixture, never in production Worker routes.
 control=async action=>{
  if(action==='drop-next-preferences-response'){dropPreferencesResponse=true;return;}
  if(action==='resume-preferences-responses'){dropPreferencesResponse=false;return;}
  if(action==='restart'){await worker.evictDurableObject('WORKSPACE',{name:currentName});return;}
  if(action==='r2-advance-backlog'){if(!r2Fixture)throw Error('R2_FIXTURE_NOT_READY');await r2Fixture.advanceBacklog();return;}
  if(action==='r2-revoke-human'){if(!r2Fixture)throw Error('R2_FIXTURE_NOT_READY');await r2Fixture.revokeHumans();return;}
  if(action==='fresh'||action==='r2-board'){
   input.config=structuredClone(baselineConfig);input.bundle.config_epoch=1;dropPreferencesResponse=false;r2Fixture=null;
   if(action==='r2-board')configureR2UiFixture(input.config);
   currentName='ui-fixture-'+randomBytes(8).toString('hex');
   input.config.workspace_catalog[0].object_name=currentName;
   input.bundle.config_digest=await sha256(canonicalJson(input.config));
   await harness.update(harnessOptions());worker=harness.getWorker();
   const next=await prepareBootstrap(input.config,input.bundle,'ws_example');
   const response=await harness.getWorker('cf-agent-hub-control-fixture').fetch('http://fixture-control/install',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:currentName,operator:operator(),input:next})});
   if(response.status!==200){await response.arrayBuffer();throw Error('FIXTURE_INSTALL_FAILED');}
   await response.arrayBuffer();
   if(action==='r2-board')r2Fixture=await seedR2UiFixture({worker,storage:await worker.getDurableObjectStorage('WORKSPACE',{name:currentName}),origin:APP_ORIGIN,issuer:ISSUER_ORIGIN,csrfSecret,nativeToken:fixtureNativeToken});
   return;
  }
  if(action==='restrict-overrides'){
   const env=await worker.getEnv(),metadata=await worker.getDurableObjectStorage('WORKSPACE',{name:currentName});
   const rows=await metadata.exec('SELECT config_epoch,installation_digest FROM workspace_metadata WHERE id=1');
   input.config.config_epoch++;input.bundle.config_epoch=input.config.config_epoch;input.config.workspace_policies[0].allowed_user_overrides=[];
   input.bundle.config_digest=await sha256(canonicalJson(input.config));
   await harness.update(harnessOptions());worker=harness.getWorker();
   await (await worker.getEnv()).WORKSPACE.getByName(currentName).reconcileConfiguration(operator(rows[0].config_epoch,rows[0].installation_digest),await prepareBootstrap(input.config,input.bundle,'ws_example'));return;
  }
  throw Error('UNKNOWN_FIXTURE_CONTROL');
 };
 if(process.argv.includes('--preview-readonly')){
  await control('r2-board');
  const previewProbe=await r2Fixture.readForPreview('/tasks',{signal:AbortSignal.timeout(5000)});
  console.log('CFHUB_LOCAL_PREVIEW_PROBE '+JSON.stringify({status:previewProbe.status,html:previewProbe.headers.get('content-type')?.startsWith('text/html')??false,nodeResponse:previewProbe instanceof Response,bodyMarker:/<body(?:\s[^>]*)?>/.test(await previewProbe.text())}));
  preview=await startReadOnlyPreview({read:(path,options)=>r2Fixture.readForPreview(path,options)});
  console.log('CFHUB_LOCAL_PREVIEW_READY '+preview.origin+' synthetic_read_only');
 }
 if(process.argv.includes('--self-check')||process.argv.includes('--self-check-r2')) {
  await control('fresh');
  const authProbe=await worker.fetch(APP_ORIGIN+'/v2/workspaces/ws_example/auth/start',{method:'POST',headers:{origin:APP_ORIGIN,'content-type':'application/json'},body:JSON.stringify({return_path:'/overview'})});
  if(authProbe.status!==200){const value=await authProbe.json();throw Error('FIXTURE_FRESH_AUTH_FAILED_'+authProbe.status+'_'+value.error?.code);}
  await authProbe.arrayBuffer();
  await fixture.selfCheckApp();
  await fixture.selfCheckApp('/overview');
  await fixture.selfCheckApp('/ui/app.js');
  await fixture.selfCheckApp('/ui/styles.css');
  if(process.argv.includes('--self-check-r2')){
   await control('r2-board');await r2Fixture.assertPersisted();await control('restart');await r2Fixture.assertPersisted();await fixture.selfCheckApp('/tasks');
   await control('r2-advance-backlog');await control('fresh');
   assert.equal(input.config.human_grants[0].scopes.includes('tasks:read'),false);assert.equal(input.config.human_grants.length,2);
   const resetStorage=await worker.getDurableObjectStorage('WORKSPACE',{name:currentName});assert.equal((await resetStorage.exec('SELECT COUNT(*) AS count FROM tasks'))[0].count,0);
  }
  await control('restart');
  await fixture.selfCheckApp();
  const proxy=fixture.proxyPort,negativeProxy=fixture.negativeProxyPort;
  await dispose();
  const {connect}=await import('node:net');
  for(const port of [proxy,negativeProxy])await new Promise((resolve,reject)=>{const socket=connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();reject(Error('LISTENER_SURVIVED_TEARDOWN'));});socket.once('error',()=>resolve());});
  console.log('CFHUB_FIXTURE_SELF_CHECK_PASS provider_signature basic_auth pkce one_use_code exact_egress worker_sql_authority teardown'+(process.argv.includes('--self-check-r2')?' r2_real_commands retained_results committed_artifact bounded_pages do_eviction':''));
 } else {
  console.log('CFHUB_FIXTURE_READY proxy='+fixture.proxyPort+' negative_proxy='+fixture.negativeProxyPort+' app_port='+fixture.appPort+' app_pin='+fixture.pins[0]+' issuer_pin='+fixture.pins[1]+' app_certificate='+Buffer.from(fixture.appCertificate).toString('base64'));
 }
} catch(error) {
 // Do not print provider tokens, environment, request bodies or key material.
 console.error('CFHUB_FIXTURE_STARTUP_FAILED '+(error instanceof Error?error.message:'unknown'));
 try{await dispose();}catch{console.error('CFHUB_FIXTURE_TEARDOWN_FAILED');}
 process.exitCode=1;
}
