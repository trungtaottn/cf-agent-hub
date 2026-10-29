/** Source-owned ephemeral workerd checks; deliberately not a native authority adapter. */
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {createFixtureBackend} from './native-fixture-backend.mjs';
import {createFixtureService} from './native-fixture-service.mjs';
import {createFixtureClient} from './native-fixture-client.mjs';
import {createBoundFixtureVerifier} from './native-fixture-verifier.mjs';
import {FIXTURE_PROJECTIONS,fixturePolicyDigest} from './native-fixture-protocol.mjs';
import {build} from 'esbuild';
import {createTestHarness} from 'wrangler';
import Ajv from 'ajv/dist/2020.js';
import {closeLocalSandbox,snapshotLocalInstallReceipt,assertLocalDisableChange,closeLocalRound,closeLocalFixtureResources} from './native-r2-local-lifecycle.mjs';
const root=dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const budgets=Object.freeze({httpRequestsPerRound:32,sqlStatementsPerRound:128,rowsPerQuery:128,responseBytesPerRound:2097152,sqlBytesPerRound:2097152});
const reportSchema=JSON.parse(await readFile(new URL('../../spec/local-r2-sandbox-result.schema.json',import.meta.url),'utf8'));
const validateReport=new Ajv({strict:true}).compile(reportSchema);
const rejected=()=>{throw Error('LOCAL_SANDBOX_REJECTED');};
/** No target, path, module, credentials, budgets or trust hooks accepted from callers. */
export async function runLocalNativeSandbox(){
 if(arguments.length!==0)rejected();
 const controller=new AbortController(),pending=new Set(),rounds=[],fixtureSessions=[];
 let harness,buildDirectory,stage='setup',action=null,reason=null,httpStatus=null,expectedHttpStatus=null,bodySucceeded=false,cleanupClosed=false;
 const timer=setTimeout(()=>controller.abort(Error('LOCAL_SANDBOX_DEADLINE')),120000);timer.unref();
 const retain=promise=>{pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;};
 async function tracked(work){
  controller.signal.throwIfAborted();
  const promise=retain(Promise.resolve().then(work));
  let listener;
  try{return await Promise.race([promise,new Promise((_,reject)=>{listener=()=>reject(Error('LOCAL_SANDBOX_ABORTED'));controller.signal.addEventListener('abort',listener,{once:true});if(controller.signal.aborted)listener();})]);}
  finally{controller.signal.removeEventListener('abort',listener);}
 }

 try{
  await tracked(()=>mkdir(join(root,'.superpowers/tmp'),{recursive:true}));
  await tracked(async()=>{buildDirectory=await mkdtemp(join(root,'.superpowers/tmp/native-local-'));});
  const modulePath=join(buildDirectory,'fixture.mjs');
  await tracked(()=>build({stdin:{contents:"export * from './test/helpers/environment.ts'; export * from './src/config/bootstrap.ts'; export * from './test/helpers/native-r2-local-fixture.ts';",resolveDir:root},outfile:modulePath,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'}));
  const api=await tracked(()=>import(pathToFileURL(modulePath).href));
  for(const round of [1,2]){
   stage='round-'+round+'-setup';
   const name='native-local-'+randomBytes(12).toString('hex'),tokens={submitter:randomBytes(32).toString('base64url'),reviewer:randomBytes(32).toString('base64url')};
   const input=await tracked(()=>api.fixture(name));api.configureLocalNativeFixture(input.config);
   input.bundle.credentials=[{workspace_id:'ws_example',credential_id:'credential_research_1',token_sha256:await tracked(()=>api.sha256(tokens.submitter))},{workspace_id:'ws_example',credential_id:'credential_reviewer_1',token_sha256:await tracked(()=>api.sha256(tokens.reviewer))}];
   input.bundle.config_digest=await tracked(()=>api.sha256(api.canonicalJson(input.config)));
   const secret=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url'),cursor=randomBytes(32).toString('hex');
   const options=()=>({root,workers:[{configPath:'./wrangler.jsonc',env:'test',vars:{DEPLOYMENT_CONFIG:JSON.stringify(input.config)},secrets:{[input.config.authentication.client_secret_ref]:secret,CSRF_SECRET:csrf,CURSOR_ENCRYPTION_KEY:cursor}},{configPath:'./workers/recovery-anchor/wrangler.jsonc',env:'test'}]});
   stage='round-'+round+'-listen';
   if(harness)await closeLocalRound({pending,close:()=>tracked(()=>harness.close())});
   harness=createTestHarness(options());await tracked(()=>harness.listen());
   let worker=harness.getWorker(),storage;
   stage='round-'+round+'-prepare-bootstrap';
   const prepared=await tracked(()=>api.prepareBootstrap(input.config,input.bundle,'ws_example'));
   stage='round-'+round+'-install';
   let receipt=await tracked(async()=>{const env=await worker.getEnv();return snapshotLocalInstallReceipt(await env.WORKSPACE.getByName(name).reconcileConfiguration(api.operator(),prepared));});
   if(receipt.epoch!==1||receipt.installationDigest!==prepared.installationDigest)rejected();
   stage='round-'+round+'-storage';
   storage=await tracked(()=>worker.getDurableObjectStorage('WORKSPACE',{name}));
   let disabled=false;
   const disable=async()=>{
    try{
    if(disabled)rejected();disabled=true;controller.signal.throwIfAborted();stage='round-'+round+'-disable';
    const before=structuredClone(input.config);
    input.config.config_epoch=2;input.bundle.config_epoch=2;
    const credential=input.config.static_credential_refs.find(row=>row.credential_id==='credential_research_1');if(!credential)rejected();credential.enabled=false;
    assertLocalDisableChange(before,input.config);
    input.bundle.config_digest=await tracked(()=>api.sha256(api.canonicalJson(input.config)));
    stage='round-'+round+'-disable-prepare';
    const next=await tracked(()=>api.prepareBootstrap(input.config,input.bundle,'ws_example'));
    // Routing/secrets are unchanged; installed SQLite config is credential authority.
    // Keep the owned Worker context alive for this real local control installation.
    const previous=receipt;stage='round-'+round+'-disable-install';
    receipt=await tracked(async()=>{const env=await worker.getEnv();return snapshotLocalInstallReceipt(await env.WORKSPACE.getByName(name).reconcileConfiguration(api.operator(previous.epoch,previous.installationDigest),next));});
    if(receipt.epoch!==2||receipt.installationDigest!==next.installationDigest)rejected();stage='round-'+round+'-disable-storage';
    storage=await tracked(()=>worker.getDurableObjectStorage('WORKSPACE',{name}));
    }catch(error){
     const codes=new Set(['CAS_CONFLICT','WORKSPACE_IDENTITY_MISMATCH','INVALID_OPERATOR_CONTEXT','CONFIG_DIGEST_MISMATCH','INSTALLATION_DIGEST_MISMATCH','CREDENTIAL_IMMUTABLE','ADMISSION_CLOSED','STALE_EPOCH','EPOCH_CONFLICT','R2_IDENTITY_COLLISION','R2_VERSION_EXHAUSTED']);
     if(codes.has(error?.message))reason=error.message;else if(/execution context|poisoned|disposed/i.test(error?.message??''))reason='CONTEXT_INVALIDATED';else if(/constraint|SQLITE/i.test(error?.message??''))reason='SQL_CONSTRAINT';else reason='UNCLASSIFIED_CONTROL_FAILURE';
     throw error;
    }
   };
   stage='round-'+round+'-fixture-protocol';
   // This source-only identity is not an installed issuer, native runtime, or release attestation.
   const policy={type:'native-fixture-policy',version:1,origin:'https://fixture.example.invalid',issuer:'https://issuer.example.invalid',audience:'local-source-fixture',service_id:'local-fixture',principal_id:'local-source-controller',assurance:'source-test-only',expires_at:Date.now()+120000,run:{run_id:name,instance_id:name,candidate_sha:'0'.repeat(40),config_sha256:input.bundle.config_digest,scenario_sha256:createHash('sha256').update('source-local-journey-v1').digest('hex'),workspace_id:'ws_example',object_name:name},plan:{observations:39,configuration_disables:1}};
   const backend=createFixtureBackend({policy,storage:{exec:(...args)=>tracked(()=>storage.exec(...args))},disable,track:retain});
   const verify=createBoundFixtureVerifier({policy,verifyIdentity:async(_message,context)=>({version:1,request_sha256:context.request_sha256,claims:{policy_sha256:fixturePolicyDigest(policy),issuer:policy.issuer,audience:policy.audience,service_id:policy.service_id,principal_id:policy.principal_id,assurance:policy.assurance,expires_at:policy.expires_at,capabilities:[...backend.capabilities]}})});
   const service=createFixtureService({policy,backend,verify});
   const client=createFixtureClient({policy,send:request=>service.handle(request)});fixtureSessions.push(client,service);
   await tracked(()=>client.call('preflight',{required_capabilities:[...backend.capabilities]},{signal:controller.signal}));
   const queries=new Map();
   for(const [selector,columns] of Object.entries(FIXTURE_PROJECTIONS)){
    const credential=selector==='submitter_credential',epoch=selector==='workspace_epoch',table=credential?'native_credentials':epoch?'workspace_metadata':selector;
    const select=Object.entries(columns).map(([key,kind])=>kind==='integer'?key:`substr(${key},1,257) AS ${key}`).join(',');
    const where=credential?' WHERE workspace_id=? AND credential_id=?':epoch?' WHERE workspace_id=?':'',order=credential?'credential_id':epoch?'workspace_id':'id';
    queries.set(`SELECT ${select} FROM ${table}${where} ORDER BY ${order} LIMIT 129`,{selector,bindings:credential?['ws_example','credential_research_1']:epoch?['ws_example']:[]});
   }
   const observedStorage={exec:async(query,...bindings)=>{const known=queries.get(query);if(!known||JSON.stringify(bindings)!==JSON.stringify(known.bindings))rejected();return (await client.call('observe-selected-state',{selector:known.selector},{signal:controller.signal})).rows;}};
   const controlledDisable=()=>client.call('configuration-disable-local',{expected_epoch:1,expected_credential_version:1,operation_id:'disable-'+round},{signal:controller.signal});
   stage='round-'+round+'-checks';
   const summary=await tracked(()=>api.runLocalNativeFixture({round,tokens,signal:controller.signal,track:retain,worker:{fetch:(...args)=>tracked(()=>worker.fetch(...args))},storage:observedStorage,disable:controlledDisable}));
   if(backend.snapshot().sqlStatements!==41||client.snapshot().attempts!==41)rejected();
   await client.close();await service.close();
   rounds.push({...summary,sqlStatements:backend.snapshot().sqlStatements,sqlBytes:backend.snapshot().sqlBytes});
  }
  bodySucceeded=true;
 }catch(error){
  const allowed=new Set(['setup','control:configuration-disable',...['tasks','runs','task_results','task_acceptances','artifacts','runtimes','native_credentials','workspace_metadata'].map(x=>'sql:'+x),...['createRuntime','createTask','readyTask','claimTask','stageArtifact','uploadArtifactContent','commitArtifact','submitTaskResult','acceptTaskResult','heartbeatRuntime','getWorkspace'].map(x=>'http:'+x)]);
  if(error?.message==='LOCAL_NATIVE_FIXTURE_REJECTED'&&allowed.has(error.action)){action=error.action;
   if(Number.isInteger(error.httpStatus)&&error.httpStatus>=100&&error.httpStatus<=599)httpStatus=error.httpStatus;
   if(Number.isInteger(error.expectedHttpStatus)&&error.expectedHttpStatus>=100&&error.expectedHttpStatus<=599)expectedHttpStatus=error.expectedHttpStatus;
  }
  // Never print upstream errors: they may contain synthetic secrets, SQL or body data.
  bodySucceeded=false;
 }finally{
  clearTimeout(timer);controller.abort(Error('LOCAL_SANDBOX_FINISHED'));
  try{
   await closeLocalSandbox({pending,close:()=>closeLocalFixtureResources({sessions:fixtureSessions,close:()=>harness?.close()}),remove:()=>buildDirectory?rm(buildDirectory,{recursive:true,force:true}):undefined});
   cleanupClosed=true;
  }catch{cleanupClosed=false;}
 }
 if(!bodySucceeded||!cleanupClosed){const error=Error('LOCAL_SANDBOX_FAILED');Object.defineProperties(error,{stage:{value:stage},httpStatus:{value:httpStatus},expectedHttpStatus:{value:expectedHttpStatus},action:{value:action},reason:{value:reason},cleanup:{value:cleanupClosed?'closed':'unknown'}});throw error;}
 const report={type:'local-r2-sandbox-result',version:1,status:'local-source-checks-passed',transport:'local-worker-dispatch',nativeConformance:false,issue48Complete:false,acceptance:'not-evaluated',cleanup:'closed',rounds,budgets:{...budgets}};
 if(!validateReport(report))rejected();
 return report;
}
