import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createTestHarness } from 'wrangler';

const originalFetch=globalThis.fetch;
let harness,fixture,buildDirectory,stopping=false;
async function dispose() {
 if(stopping)return;stopping=true;
 globalThis.fetch=originalFetch;
 const failures=[];
 for(const close of [()=>fixture?.close(),()=>harness?.close()])try{await close();}catch(error){failures.push(error);}
 if(buildDirectory)await rm(buildDirectory,{recursive:true,force:true});
 if(failures.length)throw Error('FIXTURE_TEARDOWN_FAILED');
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void dispose().then(()=>process.exit(0),()=>process.exit(1));});
try {
 await mkdir('.superpowers/tmp',{recursive:true});
 buildDirectory=await mkdtemp(resolve('.superpowers/tmp/ui-build-'));
 const modulePath=join(buildDirectory,'fixture.mjs');
 await build({
  stdin:{contents:`export * from './test/helpers/https-oidc-provider.ts'; export * from './test/helpers/environment.ts'; export * from './src/config/bootstrap.ts';`,resolveDir:process.cwd()},
  outfile:modulePath,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'
 });
 const {startHttpsFixture,APP_ORIGIN,ISSUER_ORIGIN,fixture:configurationFixture,operator,prepareBootstrap,sha256,canonicalJson}=await import(pathToFileURL(modulePath).href);
 let worker;
 fixture=await startHttpsFixture({fetch:(input,init)=>worker.fetch(input,init)});
 globalThis.fetch=fixture.dispatch;
 harness=createTestHarness({workers:[{configPath:'./wrangler.jsonc',env:'test'}]});
 await harness.listen();
 worker=harness.getWorker();
 const input=await configurationFixture('ui-fixture');
 input.config.authentication.issuer=ISSUER_ORIGIN;
 input.config.authentication.allowed_origins=[APP_ORIGIN];
 input.config.authentication.redirect_uris[0].redirect_uri=APP_ORIGIN+'/v2/workspaces/ws_example/auth/callback';
 input.config.authentication.reviewed_oidc_endpoints={authorization_endpoint:ISSUER_ORIGIN+'/authorize',token_endpoint:ISSUER_ORIGIN+'/token',jwks_uri:ISSUER_ORIGIN+'/jwks'};
 input.config.human_grants[0].issuer=ISSUER_ORIGIN;
 input.config.static_credential_refs[0].expires_at=new Date(Date.now()+30*86400000).toISOString();
 input.bundle.credentials[0].token_sha256=await sha256(randomBytes(32).toString('base64url'));
 input.bundle.config_digest=await sha256(canonicalJson(input.config));
 const {auth:_,...unsigned}=input.bundle;
 input.bundle.auth.tag=createHmac('sha256',randomBytes(32)).update(canonicalJson(unsigned)).digest('hex');
 const prepared=await prepareBootstrap(input.config,input.bundle,'ws_example');
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
 assert.equal(grants[0].count,1);
 const credentials=await storage.exec('SELECT COUNT(*) AS count FROM native_credentials WHERE enabled=1');
 assert.equal(credentials[0].count,1);
 const live=await worker.fetch(APP_ORIGIN+'/health/live');
 assert.equal(live.status,200);assert.equal(await live.text(),'alive');
 await fixture.selfCheck();
 if(process.argv.includes('--self-check')) {
  const proxy=fixture.proxyPort,negativeProxy=fixture.negativeProxyPort;
  await dispose();
  const {connect}=await import('node:net');
  for(const port of [proxy,negativeProxy])await new Promise((resolve,reject)=>{const socket=connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();reject(Error('LISTENER_SURVIVED_TEARDOWN'));});socket.once('error',()=>resolve());});
  console.log('CFHUB_FIXTURE_SELF_CHECK_PASS provider_signature basic_auth pkce one_use_code exact_egress worker_sql_authority teardown');
 } else {
  console.log('CFHUB_FIXTURE_READY proxy='+fixture.proxyPort+' negative_proxy='+fixture.negativeProxyPort+' app_port='+fixture.appPort+' app_pin='+fixture.pins[0]+' issuer_pin='+fixture.pins[1]);
 }
} catch(error) {
 // Do not print provider tokens, environment, request bodies or key material.
 console.error('CFHUB_FIXTURE_STARTUP_FAILED '+(error instanceof Error?error.message:'unknown'));
 try{await dispose();}catch{console.error('CFHUB_FIXTURE_TEARDOWN_FAILED');}
 process.exitCode=1;
}
