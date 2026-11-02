/** PRIVATE TEST BUILD ONLY. All listeners are loopback; never deploy this harness. */
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createTestHarness} from 'wrangler';
import {buildDecisionBrowserFixture} from './lib/build-decision-browser-fixture.mjs';
const originalFetch=globalThis.fetch;let harness,https,directory,worker,storage,facts,probe,stopping=false;
async function dispose(){if(stopping)return;stopping=true;probe?.reset();globalThis.fetch=originalFetch;const failures=[];for(const close of [()=>https?.close(),()=>harness?.close()])try{await close();}catch{failures.push(1);}if(directory)await rm(directory,{recursive:true,force:true});if(failures.length)throw Error('DECISION_FIXTURE_TEARDOWN');}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void dispose().then(()=>process.exit(0),()=>process.exit(1));});
try{
 await mkdir('.superpowers/tmp',{recursive:true});directory=await mkdtemp(resolve('.superpowers/tmp/private-decision-'));
 const builds=await buildDecisionBrowserFixture({root:process.cwd(),outputDirectory:directory});
 const helper=join(directory,'helper.mjs');await build({stdin:{contents:"export * from './test/helpers/https-oidc-provider.ts'; export * from './test/helpers/environment.ts'; export * from './src/config/bootstrap.ts'; export * from './test/helpers/decision-browser-fixture.ts'; export * from './test/helpers/decision-fixture-diagnostics.ts';",resolveDir:process.cwd()},outfile:helper,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
 const {startHttpsFixture,APP_ORIGIN,ISSUER_ORIGIN,fixture,operator,prepareBootstrap,sha256,canonicalJson,configureDecisionBrowserFixture,seedDecisionBrowserFixture,parseDecisionFixtureControl,DecisionBrowserProbe,createDecisionFixtureDiagnostics}=await import(pathToFileURL(helper).href);
 const providerSecret=randomBytes(32).toString('base64url'),csrfSecret=randomBytes(32).toString('base64url'),cursorSecret=randomBytes(32).toString('hex'),nativeToken=randomBytes(32).toString('base64url');
 probe=new DecisionBrowserProbe();
 let control=async()=>{throw Error('DECISION_FIXTURE_NOT_READY');};
 https=await startHttpsFixture({fetch:async(input,init)=>{const request=new Request(input,init);if(new URL(request.url).pathname==='/__ui_fixture/control'){const diagnostic=createDecisionFixtureDiagnostics();try{const action=await parseDecisionFixtureControl(request);diagnostic.at('dispatch');return Response.json({ok:true,...await control(action,diagnostic)});}catch{console.error(diagnostic.failure());return new Response(null,{status:400});}}const generation=probe.generation;return probe.dispatch(request,()=>worker.fetch(input,init),async(approvalId,action)=>{const rows=await storage.exec('SELECT status FROM approvals WHERE id=?',approvalId);assert.ok(rows.length===1&&rows[0].status===(action==='approve'?'approved':'rejected'));},generation);}},{clientSecret:providerSecret,subjects:['synthetic-subject','readonly-subject','unassigned-subject']});
 globalThis.fetch=https.dispatch;
 const ordinary=JSON.parse(await readFile('wrangler.jsonc','utf8')),test=ordinary.env.test;
 // Exact current non-inherited test bindings. Secrets stay only in this in-memory
 // inline test configuration; no generated config file contains credentials.
 const base={...ordinary,...test,assets:{...ordinary.assets,directory:resolve(ordinary.assets.directory)},dev:{ip:'127.0.0.1',port:0}};delete base.env;delete base.build;
 for(const key of ['durable_objects','r2_buckets','services'])assert.deepEqual(base[key],test[key]);
 assert.deepEqual(base.exports,ordinary.exports);assert.equal(base.compatibility_date,ordinary.compatibility_date);
 let input,currentName;
 function config(main){return {...base,main,vars:{...test.vars,DEPLOYMENT_CONFIG:JSON.stringify(input.config),[input.config.authentication.client_secret_ref]:providerSecret,CSRF_SECRET:csrfSecret,CURSOR_ENCRYPTION_KEY:cursorSecret}};}
 const install=join(directory,'install.mjs');await writeFile(install,"export default {async fetch(request,env){if(request.method!=='POST'||new URL(request.url).pathname!=='/install')return new Response(null,{status:404});const x=await request.json();return Response.json(await env.WORKSPACE.getByName(x.name).reconcileConfiguration(x.operator,x.input));}};");
 function options(main){return {workers:[{config:config(main)},{configPath:'./workers/recovery-anchor/wrangler.jsonc',env:'test'},{config:{name:'private-decision-install',main:install,compatibility_date:ordinary.compatibility_date,durable_objects:{bindings:[{name:'WORKSPACE',class_name:'WorkspaceDO',script_name:test.name}]}}}]};}
 async function reset(main,normal=false,diagnostic=createDecisionFixtureDiagnostics()){
  diagnostic.at('reset-config');currentName='decision-browser-'+randomBytes(8).toString('hex');input=await fixture(currentName);configureDecisionBrowserFixture(input.config);
  input.config.authentication.issuer=ISSUER_ORIGIN;input.config.authentication.allowed_origins=[APP_ORIGIN];input.config.authentication.redirect_uris[0].redirect_uri=APP_ORIGIN+'/v2/workspaces/ws_example/auth/callback';input.config.authentication.reviewed_oidc_endpoints={authorization_endpoint:ISSUER_ORIGIN+'/authorize',token_endpoint:ISSUER_ORIGIN+'/token',jwks_uri:ISSUER_ORIGIN+'/jwks'};for(const grant of input.config.human_grants)grant.issuer=ISSUER_ORIGIN;
  input.bundle.credentials[0].token_sha256=await sha256(nativeToken);input.bundle.config_digest=await sha256(canonicalJson(input.config));
  diagnostic.at('reset-update');if(harness)await harness.update(options(main));else{harness=createTestHarness(options(main));const address=await harness.listen();assert.ok(['127.0.0.1','localhost','[::1]'].includes(address.url.hostname));}
  diagnostic.at('reset-bootstrap');worker=harness.getWorker();const prepared=await prepareBootstrap(input.config,input.bundle,'ws_example');
  diagnostic.at('reset-install');const installed=await harness.getWorker('private-decision-install').fetch('http://fixture-control/install',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:currentName,operator:operator(),input:prepared})});assert.equal(installed.status,200);await installed.arrayBuffer();
  diagnostic.at('reset-storage');storage=await worker.getDurableObjectStorage('WORKSPACE',{name:currentName});diagnostic.at('reset-seed');facts=await seedDecisionBrowserFixture({worker,storage,origin:APP_ORIGIN,issuer:ISSUER_ORIGIN,csrfSecret,nativeToken,normal});return facts;
 }
 await reset(builds.privateWorker);
 const ownerScopes=()=>input.config.human_grants[0].scopes;
 control=async(action,diagnostic)=>{
  if(action==='reset'){probe.reset();await reset(builds.privateWorker,false,diagnostic);return {};}
  if(action==='drop-next-decision'){probe.armDrop();return {};}
  if(action==='resume-decisions'){probe.resumeDecisions();return {};}
  if(action==='hold-next-content'){probe.armContent();return {};}
  if(action==='release-content'){probe.releaseContent();return {};}
  if(action==='read-state')return {cases:facts.cases,attempts:probe.receipts,tasks:await storage.exec('SELECT id,state,task_version,proposal_version,approval_id,active_run_id FROM tasks ORDER BY id'),approvals:await storage.exec('SELECT id,status,approval_version,proposal_version,task_id,decided_by_json FROM approvals ORDER BY id'),events:await storage.exec("SELECT type,resource_id FROM events WHERE type IN ('task.decision_requested','task.decision_approved','task.decision_rejected') ORDER BY sequence")};
  if(['revoke-decide','revoke-artifacts','restore-grants'].includes(action)){const scopes=ownerScopes().filter(scope=>action==='revoke-decide'?scope!=='approvals:decide':action==='revoke-artifacts'?scope!=='artifacts:read':true);await storage.exec("UPDATE human_grants SET scopes_json=? WHERE principal_id='human_operator'",JSON.stringify(scopes));return {};}
  throw Error('DECISION_FIXTURE_CONTROL_NOT_IMPLEMENTED');
 };
 if(process.argv.includes('--self-check')){
  await https.selfCheck();await https.selfCheckApp('/tasks');await https.selfCheckApp('/ui/app.js');assert.equal(Object.keys(facts.cases).length,4);
  const auth=await worker.fetch(APP_ORIGIN+'/v2/workspaces/ws_example/auth/start',{method:'POST',headers:{origin:APP_ORIGIN,'content-type':'application/json'},body:JSON.stringify({return_path:'/tasks'})});assert.equal(auth.status,200);await auth.arrayBuffer();
  await harness.close();harness=undefined;await reset(builds.normalWorker,true);assert.deepEqual(facts.cases,{});
  await dispose();console.log('PRIVATE_DECISION_FIXTURE_SELF_CHECK_PASS source_commands committed_r2 pending_sql normal_request_503_all_effect_tables_unchanged setup_only_browser_not_executed');
 }else console.log('CFHUB_FIXTURE_READY proxy='+https.proxyPort+' negative_proxy='+https.negativeProxyPort+' app_port='+https.appPort+' app_pin='+https.pins[0]+' issuer_pin='+https.pins[1]+' app_certificate='+Buffer.from(https.appCertificate).toString('base64'));
}catch(error){console.error('PRIVATE_DECISION_FIXTURE_FAILED '+(error instanceof Error?error.message:'unknown'));try{await dispose();}catch{console.error('PRIVATE_DECISION_FIXTURE_TEARDOWN_FAILED');}process.exitCode=1;}
