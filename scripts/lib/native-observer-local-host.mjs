/** Real ephemeral local workerd → private observer → authenticated source service. */
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,generateKeyPairSync,timingSafeEqual} from 'node:crypto';
import {build} from 'esbuild';
import {createTestHarness} from 'wrangler';
import {createLocalObserverBackend} from './native-host-v2-local-backend.mjs';
import {createNativeObserverService} from './native-host-v2-service.mjs';
import {createNativeObserverClient} from './native-host-v2-client.mjs';
import {OBSERVER_STEPS,OBSERVER_CAPABILITIES,observerPolicyDigest,observerHash,validateObserverPolicy} from './native-host-v2-protocol.mjs';
const root=dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const reject=()=>{throw Error('LOCAL_OBSERVER_INTEGRATION_REJECTED');},check=v=>{if(!v)reject();};
export async function runPrivateObserverLocalIntegration(){
 if(arguments.length)reject();let harness,directory,service,backend,client,stage='setup',status='failed',cleanup='pending',error=null,summary=null;
 const pending=new Set(),track=p=>{const actual=Promise.resolve(p);pending.add(actual);actual.then(()=>pending.delete(actual),()=>pending.delete(actual));return actual;};
 try{
  await mkdir(join(root,'.superpowers/tmp'),{recursive:true});directory=await mkdtemp(join(root,'.superpowers/tmp/observer-service-'));
  const fixturePath=join(directory,'fixture.mjs');await track(build({entryPoints:[join(root,'test/helpers/native-observer/local-fixture.ts')],outfile:fixturePath,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'}));
  const api=await import(pathToFileURL(fixturePath).href),name='observer_local_'+randomBytes(8).toString('hex'),bearer=randomBytes(32).toString('base64url'),serviceBearer=randomBytes(32).toString('base64url'),runId='run_'+randomBytes(16).toString('hex');
  const fixture=await api.prepareObserverFixture(name,bearer);
  stage='local-workerd-start';harness=createTestHarness({root,workers:[{configPath:'./test/helpers/native-observer/wrangler.jsonc',vars:{DEPLOYMENT_CONFIG:JSON.stringify(fixture.config)},secrets:{[fixture.config.authentication.client_secret_ref]:'local-observer-synthetic-client-secret',CSRF_SECRET:randomBytes(32).toString('base64url'),CURSOR_ENCRYPTION_KEY:randomBytes(32).toString('base64url')}}]});await track(harness.listen());
  const worker=harness.getWorker(),environment=await track(worker.getEnv()),stub=environment.WORKSPACE.getByName(name);
  stage='fixture-configuration';const receipt=await track(stub.reconcileConfiguration(api.operator(),fixture.input));check(receipt.epoch===1&&receipt.installationDigest===fixture.input.installationDigest);
  stage='fixture-native-setup';const seed=await track(api.seedObserverFixture(stub,bearer));check(seed.setupRequests===5);
  const storage=await track(worker.getDurableObjectStorage('WORKSPACE',{name}));const rows=await track(storage.exec('SELECT generation FROM maintenance_state WHERE id=1'));check(rows.length===1&&Number.isSafeInteger(rows[0].generation));
  const entries=[];for(const step of OBSERVER_STEPS){const target=step==='success/getAgent'?'agent_reviewer':step==='success/getTask'?seed.taskId:step==='success/getRun'?seed.runId:null;entries.push({step_id:step,invocation_id:'invocation_'+step.slice(8),prepared_request_sha256:await api.sha256(api.canonicalJson({step,target})),credential_handle:'source_credential',workspace_id:'ws_example',object_name:name,credential_id:'credential_research_1',agent_id:'agent_research',candidate_sha:'a'.repeat(40),config_digest:fixture.bundle.config_digest,installation_digest:fixture.input.installationDigest,expected_epoch:1,maintenance_generation:rows[0].generation,target_id:target});}
  const policy=validateObserverPolicy({type:'native-observer-run-policy',version:2,assurance:'source-test-only',origin:'https://observer.example.invalid',service_id:'source_observer_service',instance_id:'instance_'+randomBytes(8).toString('hex'),run_id:runId,descriptor_sha256:'b'.repeat(64),expires_at:Date.now()+120000,entries},Date.now());
  backend=createLocalObserverBackend({policy,stub,privateRegistry:{run_id:runId,workspace_id:'ws_example',object_name:name,entries:entries.map(e=>({...e,bearer}))}});
  const keys=generateKeyPairSync('ed25519'),expectedHeader=Buffer.from('Bearer '+serviceBearer);
  service=createNativeObserverService({policy,backend,privateKey:keys.privateKey,verify:async(message,context)=>{const actual=Buffer.from(message.headers.get('authorization')??'');check(actual.length===expectedHeader.length&&timingSafeEqual(actual,expectedHeader));check(context.policy_sha256===observerPolicyDigest(policy)&&context.request_sha256===observerHash(context.request));return {version:2,policy_sha256:context.policy_sha256,request_sha256:context.request_sha256,service_id:policy.service_id,instance_id:policy.instance_id,run_id:policy.run_id,descriptor_sha256:policy.descriptor_sha256,expires_at:policy.expires_at,assurance:'source-test-only',capabilities:OBSERVER_CAPABILITIES};}});
  client=createNativeObserverClient({policy,publicKeyDer:keys.publicKey.export({type:'spki',format:'der'}),send:request=>{const headers=new Headers(request.headers);headers.set('authorization','Bearer '+serviceBearer);return service.handle(new Request(request,{headers}));}});
  stage='bind-private-registry';await track(client.bind());let originals=0,rawBytes=0;
  for(const entry of entries){stage='observe-'+entry.step_id.slice(8);const manifest=await track(client.observe(entry.step_id));check(manifest.records.length===25);for(const record of manifest.records){const original=await track(client.readOriginal(entry.step_id,record.record_id));check(original.installedAuthority===false&&original.metadata.kind===record.kind&&original.bytes.length===record.byte_size);rawBytes+=original.bytes.length;originals++;}}
  stage='close-service';const closed=await track(client.close());check(closed.status==='closed'&&closed.observations===7&&closed.originals_read===175&&closed.requests===184);check(backend.snapshot().calls===184);check(originals===175);
  summary={observations:7,originals,raw_bytes:rawBytes,service_requests:client.snapshot().sequence,private_rpc_calls:backend.snapshot().calls,source_enforced_sql_ledger:603,setup_native_requests:seed.setupRequests,setup_sql_queries:1,service_request_bytes:client.snapshot().requestBytes,service_response_bytes:client.snapshot().responseBytes,private_rpc_request_bytes:backend.snapshot().requestBytes,private_rpc_response_bytes:backend.snapshot().responseBytes};status='passed';
 }catch(e){const allowed=['OBSERVER_BACKEND_REJECTED','OBSERVER_SERVICE_REJECTED','OBSERVER_CLIENT_REJECTED','INVALID_OBSERVER_PROTOCOL','LOCAL_OBSERVER_FIXTURE_REJECTED','LOCAL_OBSERVER_INTEGRATION_REJECTED'];error=allowed.includes(e?.message)?e.message:'LOCAL_OBSERVER_INTEGRATION_REJECTED';}
 finally{
  let cleanupFailures=0;
  while(pending.size)await Promise.allSettled([...pending]);
  try{if(client)check((await client.dispose()).status==='closed');}catch{cleanupFailures++;}
  try{if(service)check((await service.close()).status==='closed');else if(backend)check((await backend.close()).status==='closed');}catch{cleanupFailures++;}
  try{if(harness)await harness.close();}catch{cleanupFailures++;}
  cleanup=cleanupFailures?'failed':'closed';if(cleanupFailures)status='failed';
  if(directory&&cleanup==='closed')try{await rm(directory,{recursive:true,force:true});}catch{status='failed';cleanup='failed';}
 }
 return Object.freeze({type:'local-private-observer-result',version:1,status,stage,cleanup,summary,error,backend_diagnostic:backend?.snapshot().diagnostic??null,installedAuthority:false,native_conformance:false});
}
