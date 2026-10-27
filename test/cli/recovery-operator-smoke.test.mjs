import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createTestHarness} from 'wrangler';
import {canonicalBytes,decodeHeader} from '../../src/recovery/encoding.ts';
import {TABLE_REGISTRY} from '../../src/recovery/table-registry.ts';
import {CURRENT_SCHEMA_VERSION} from '../../src/storage/schema-version.ts';

const checkout=fileURLToPath(new URL('../../',import.meta.url));
const workspaceId='ws_recovery_transport',captureId='capture_cli_smoke';
const origins={source:'https://source-operator.example.invalid',target:'https://operator.example.invalid'};
const names={source:'recovery-source-workspace',target:'operator-fixture-ws_recovery_transport'};
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Buffer.from(canonicalBytes(value)).toString('utf8');
const service={client_id:'fixture-client.access',client_secret:'synthetic_cli_smoke_service_secret'};

// Bundle the existing typed fixture solely for this Node test; product imports remain untouched.
async function existingFixture(){
 const result=await build({entryPoints:[path.join(checkout,'test/helpers/operator-fixture.ts')],bundle:true,write:false,format:'esm',platform:'node',target:'node24'});
 const {operatorFixture}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 return operatorFixture();
}

async function actualOperatorFixture(directory){
 const fixture=await existingFixture(),originalFetch=globalThis.fetch;
 const sourcePolicy=structuredClone(fixture.policy);
 sourcePolicy.environment_id='fixture_source';sourcePolicy.origin=origins.source;
 sourcePolicy.workspace_catalog.find(entry=>entry.workspace_id===workspaceId).object_name=names.source;
 sourcePolicy.services[0].environment_id='fixture_source';
 const app=(lane,bindings)=>({name:'recovery-cli-'+lane,main:path.join(checkout,'src/index.ts'),compatibility_date:'2026-10-19',vars:bindings,
  exports:{WorkspaceDO:{type:'durable-object',storage:'sqlite'}},durable_objects:{bindings:[{name:'WORKSPACE',class_name:'WorkspaceDO'}]},
  r2_buckets:[{binding:'RECOVERY_BUCKET',bucket_name:'recovery-cli-'+lane}],rules:[{type:'Text',globs:['**/*.sql'],fallthrough:true}]});
 const gateway=(lane,policy)=>({name:'recovery-cli-operator-'+lane,main:path.join(checkout,'workers/operator/src/index.ts'),compatibility_date:'2026-10-19',
  vars:{...fixture.bindings,OPERATOR_POLICY:JSON.stringify(policy)},durable_objects:{bindings:[{name:'WORKSPACE',class_name:'WorkspaceDO',script_name:'recovery-cli-'+lane}]}});
 const unexpectedOutbound=[];
 globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init);
  if(request.url!=='https://access.example.invalid/cdn-cgi/access/certs')unexpectedOutbound.push(request.url);
  return fixture.handler(request);
 };
 const harness=createTestHarness({root:checkout,workers:[{config:gateway('target',fixture.policy)},{config:gateway('source',sourcePolicy)},{config:app('target',fixture.workspaceBindings)},{config:app('source',fixture.sourceBindings)}]});
 const sockets=new Set(),observations=[];
 let server,restoreFault=null,droppedRestoreInit=false;
 const close=async()=>{
  for(const socket of sockets)socket.destroy();
  if(server)await new Promise(resolve=>server.close(resolve));
  try{await harness.close();}finally{globalThis.fetch=originalFetch;}
 };
 try{
  const keyPath=path.join(directory,'tls.key'),certPath=path.join(directory,'tls.crt');
  await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=operator.example.invalid','-addext','subjectAltName=DNS:operator.example.invalid,DNS:source-operator.example.invalid','-keyout',keyPath,'-out',certPath],{maxBuffer:65536});
  fs.chmodSync(keyPath,0o600);const cert=fs.readFileSync(certPath);
  await harness.listen();
  const assertion=async()=>(await fixture.handler(new Request('https://operator-fixture.example.invalid/assertion',{method:'POST',body:'{}'}))).text();
  const worker=lane=>harness.getWorker('recovery-cli-operator-'+lane);
  const appWorker=lane=>harness.getWorker('recovery-cli-'+lane);
  const storage=lane=>appWorker(lane).getDurableObjectStorage('WORKSPACE',{name:names[lane]});
  const removeHarnessNameTable=async lane=>{
   // createTestHarness enables Miniflare's inspection wrapper, whose constructor adds this
   // exact test-only name table. Remove only its verified fixture record; recovery itself
   // still sees and validates the full unfiltered production registry. Eviction recreates it.
   const sql=await storage(lane);
   assert.deepEqual(await sql.exec('PRAGMA table_info(__miniflare_do_name)'),[
    {cid:0,name:'id',type:'INTEGER',notnull:0,dflt_value:null,pk:1},
    {cid:1,name:'name',type:'TEXT',notnull:0,dflt_value:null,pk:0}
   ]);
   assert.deepEqual(await sql.exec('SELECT id,name FROM __miniflare_do_name'),[{id:1,name:names[lane]}]);
   await sql.exec('DROP TABLE __miniflare_do_name');
  };
  server=https.createServer({key:fs.readFileSync(keyPath),cert},(request,response)=>{void(async()=>{
   const lane=Object.keys(origins).find(key=>new URL(origins[key]).host===request.headers.host);
   if(!lane||request.url!=='/operator/recovery'||request.method!=='POST'||request.headers.authorization||request.headers.cookie||request.headers['cf-access-client-id']!==service.client_id||request.headers['cf-access-client-secret']!==service.client_secret){response.writeHead(403);response.end();return;}
   const chunks=[];let size=0;
   for await(const part of request){size+=part.length;if(size>1048576)throw Error('FIXTURE_BODY_LIMIT');chunks.push(part);}
   const body=Buffer.concat(chunks),binary=request.headers['content-type']==='application/octet-stream';
   const command=binary?decodeHeader(request.headers['x-cfhub-recovery-control']):JSON.parse(body.toString('utf8'));
   const observation={lane,operation:command.operation,operationId:command.operation_id,expectedEpoch:command.expected_authority_epoch,status:null,binary,bodySha256:sha256(body),forwarded:false};
   if(lane==='target'&&command.operation==='restore'&&restoreFault==='before_dispatch'&&!droppedRestoreInit){droppedRestoreInit=true;observations.push(observation);response.destroy();return;}
   const headers={'content-type':request.headers['content-type'],'cf-access-jwt-assertion':await assertion()};
   if(binary)headers['X-CFHub-Recovery-Control']=request.headers['x-cfhub-recovery-control'];
   const upstream=await worker(lane).fetch(origins[lane]+'/operator/recovery',{method:'POST',headers,body});
   const responseBytes=Buffer.from(await upstream.arrayBuffer());
   observations.push({...observation,status:upstream.status,forwarded:true});
   if(lane==='target'&&command.operation==='restore'&&upstream.status===200&&restoreFault==='after_commit'&&!droppedRestoreInit){droppedRestoreInit=true;response.destroy();return;}
   response.writeHead(upstream.status,Object.fromEntries(upstream.headers));response.end(responseBytes);
  })().catch(()=>{if(!response.headersSent)response.writeHead(502);response.end();});});
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const requestImpl=(url,options,callback)=>{
   assert.ok(Object.values(origins).some(origin=>url.href===origin+'/operator/recovery'));
   return https.request(url,{...options,hostname:'127.0.0.1',port:server.address().port,servername:url.hostname,ca:cert,rejectUnauthorized:true},callback);
  };
  const sourceConfig=JSON.parse(fixture.bindings.RECOVERY_TRANSPORT_SOURCE_CONFIG),sourceBundle=JSON.parse(fixture.bindings.RECOVERY_TRANSPORT_SOURCE_BUNDLE);
  const installed=await worker('source').fetch(origins.source+'/operator/recovery',{method:'POST',headers:{'content-type':'application/json','cf-access-jwt-assertion':await assertion()},body:JSON.stringify({operation:'install',workspace_id:workspaceId,capture_id:null,expected_authority_epoch:0,operation_id:'smoke_source_install',reason:'Synthetic CLI integration setup',payload:{config:sourceConfig,verification_bundle:sourceBundle}})});
  assert.equal(installed.status,200,'actual source installation must succeed');
  const sql=await storage('source'),now=Date.now(),agent=sourceConfig.static_participants[0],destination=sourceConfig.workspace_policies[0].notification_destinations[0],grant=sourceConfig.human_grants[0];
  await sql.exec('INSERT INTO threads (id,workspace_id,subject,created_at) VALUES (?,?,?,?)','thread_cli_smoke',workspaceId,'CLI retained fixture',now);
  await sql.exec("INSERT INTO thread_participants (thread_id,participant_kind,participant_id) VALUES (?,'agent',?)",'thread_cli_smoke',agent.agent_id);
  await sql.exec("INSERT INTO messages (id,workspace_id,thread_id,sender_kind,sender_principal_id,sender_agent_id,body,refs_json,created_at) VALUES (?,?,?,'agent',?,?,?,'[]',?)",'message_cli_smoke',workspaceId,'thread_cli_smoke',agent.agent_id,agent.agent_id,'Retained CLI body',now);
  await sql.exec('INSERT INTO inbox (message_id,recipient_agent_id,workspace_id,created_at,acknowledged_at) VALUES (?,?,?,?,NULL)','message_cli_smoke',agent.agent_id,workspaceId,now);
  await sql.exec("INSERT INTO events (id,workspace_id,type,actor_json,resource_type,resource_id,resource_version,thread_id,request_id,occurred_at,summary) VALUES (?,?,'message.accepted',?,'message',?,NULL,?,'request_cli_smoke',?,'Message accepted.')",'event_cli_smoke',workspaceId,canonical({kind:'agent',principal_id:agent.agent_id,agent_id:agent.agent_id}),'message_cli_smoke','thread_cli_smoke',now);
  await sql.exec("INSERT INTO outbox (id,workspace_id,message_id,destination_id,notification_id,payload_json,status,attempts,next_due_at,retry_multiplier,lease_token,lease_expires_at,last_status,last_error,created_at,updated_at,destination_snapshot_json) VALUES (?,?,?,?,?,?,'in_flight',1,?,1,?,?,503,'network',?,?,?)",'delivery_cli_smoke',workspaceId,'message_cli_smoke',destination.destination_id,'delivery_cli_smoke',canonical({payload_version:1,type:'message.accepted',delivery_id:'delivery_cli_smoke',workspace_id:workspaceId,recipient_agent_id:agent.agent_id,message_id:'message_cli_smoke',thread_id:'thread_cli_smoke',event_id:'event_cli_smoke',occurred_at:new Date(now).toISOString()}),now+3600000,'lease_cli_smoke',now+3600000,now,now,canonical({agent_id:agent.agent_id,url:destination.url,signing_key_ref:destination.signing_key_ref}));
  await sql.exec("UPDATE sqlite_sequence SET seq=500 WHERE name='events'");
  await sql.exec('INSERT INTO sessions (id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,revoked_at,auth_epoch) VALUES (?,?,?,?,?,?,?,?,?,NULL,1)','session_cli_smoke',workspaceId,grant.principal_id,sha256('B'.repeat(43)),'0'.repeat(64),grant.issuer,grant.subject,now,now+3600000);
  await removeHarnessNameTable('source');await removeHarnessNameTable('target');
  const installUnrelatedTarget=async()=>{
   const ledger=JSON.parse(fixture.bindings.RECOVERY_TRANSPORT_LEDGER),config=structuredClone(ledger.config),bundle=structuredClone(ledger.verification_bundle);
   config.config_epoch=3;bundle.config_epoch=3;bundle.config_digest=sha256(canonicalBytes(config));
   const {tag,...auth}=bundle.auth;
   bundle.auth.tag=crypto.createHmac('sha256',Buffer.from(fixture.bindings.BOOTSTRAP_INTEGRITY_KEY,'base64')).update(canonicalBytes({...bundle,auth})).digest('hex');
   const response=await worker('target').fetch(origins.target+'/operator/recovery',{method:'POST',headers:{'content-type':'application/json','cf-access-jwt-assertion':await assertion()},body:JSON.stringify({operation:'install',workspace_id:workspaceId,capture_id:null,expected_authority_epoch:0,operation_id:'smoke_unrelated_target_install',reason:'Synthetic unrelated authority fixture',payload:{config,verification_bundle:bundle}})});
   assert.equal(response.status,200,'unrelated epoch3 authority fixture must install through the real gateway');
  };
  const snapshot=async lane=>{
   const sql=await storage(lane),tables=[...TABLE_REGISTRY,{name:'sqlite_sequence',primaryKey:['name']}];
   assert.deepEqual((await sql.exec("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")).map(x=>x.name),tables.map(x=>x.name).sort());
   const rows={};for(const table of tables)rows[table.name]=await sql.exec('SELECT * FROM "'+table.name+'" ORDER BY '+table.primaryKey.map(x=>'"'+x+'"').join(','));
   return sha256(canonicalBytes(rows));
  };
  return {fixture,requestImpl,observations,unexpectedOutbound,storage,close,installUnrelatedTarget,snapshot,loseRestoreInit:mode=>{restoreFault=mode;},wasRestoreInitDropped:()=>droppedRestoreInit,
   evict:async lane=>{await appWorker(lane).evictDurableObject('WORKSPACE',{name:names[lane]});await removeHarnessNameTable(lane);},
   ledger:JSON.parse(fixture.bindings.RECOVERY_TRANSPORT_LEDGER),integrity:{keyId:'recovery_fixture',key:fixture.workspaceBindings.RECOVERY_INTEGRITY_KEY}};
 }catch(error){await close();throw error;}
}

// Schema8 deliberately has no V1 recovery runtime. The former schema7 end-to-end
// after_commit/before_dispatch/unrelated_epoch restore journeys are not exercised
// by this current-runtime test; #43 owns their R2 runtime replacements. Historical
// V1 controller crash cases remain separate tests, not schema8 acceptance.
test('actual Worker/HTTPS recovery CLI rejects current schema before recovery effects', {timeout:120000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cfhub-cli-recovery-smoke-'));fs.chmodSync(directory,0o700);
 let actual;const descriptors=[];
 try{
  actual=await actualOperatorFixture(directory);
  assert.equal((await (await actual.storage('source')).exec('SELECT config_epoch FROM workspace_metadata'))[0].config_epoch,1);
  assert.equal((await (await actual.storage('source')).exec('SELECT COUNT(*) AS n FROM outbox'))[0].n,1);
  // The production controller supplies every recovery continuation; this fixture never loops the protocol itself.
  const {runRecovery}=await import('../../scripts/lib/recovery-client.mjs');
  const {createRecoveryTransport}=await import('../../scripts/lib/recovery-transport.mjs');
  const put=(name,value)=>{const target=path.join(directory,name);fs.writeFileSync(target,canonicalBytes(value),{flag:'wx',mode:0o600});return target;};
  const descriptor=(name,value)=>{const fd=fs.openSync(put(name,value),'r');descriptors.push(fd);return fd;};
  const encryption={key_id:'cli_smoke_encryption',key_fd:descriptor('encryption.json',{key:crypto.randomBytes(32).toString('base64')})};
  const integrity={key_id:actual.integrity.keyId,key_fd:descriptor('integrity.json',{key:actual.integrity.key})};
  const serviceReference={principal_id:'operator_fixture',credentials_fd:descriptor('service.json',service)};
  const artifactDirectory=path.join(directory,'capture');
  const transports=Object.fromEntries(Object.entries(origins).map(([lane,origin])=>[lane,createRecoveryTransport({origin,service},{requestImpl:actual.requestImpl})]));
  const input=(command,lane,extra={})=>put(command+'-'+lane+'.json',{
   format_version:1,origin:origins[lane],environment_id:lane==='source'?'fixture_source':'fixture',workspace_id:workspaceId,object_name:names[lane],allowed_workspace_ids:[workspaceId],
   expected_authority_epoch:lane==='source'?1:2,operation_id:'cli_smoke_'+command.replaceAll('-','_')+'_'+lane,capture_id:command==='probe'?null:captureId,
   reason:'Synthetic actual Worker CLI smoke',encryption,integrity,service:serviceReference,state_path:path.join(directory,command+'-'+lane+'.state.enc'),artifact_directory:artifactDirectory,max_requests:256,...extra
  });
  const invoke=(command,lane,config)=>runRecovery(command,config,{transport:transports[lane]});
  const sourceBefore=await actual.snapshot('source'),targetBefore=await actual.snapshot('target');
  const source=await actual.storage('source');
  assert.equal((await source.exec('SELECT MAX(version) AS version FROM schema_migrations'))[0].version,CURRENT_SCHEMA_VERSION);
  const denied=error=>error?.code==='RECOVERY_HTTP_DENIED'&&error.status===503&&error.serverCode==='AUTH_UNAVAILABLE'&&error.canonicalError===true&&typeof error.requestId==='string'&&error.requestId.length>0;
  await assert.rejects(invoke('capture','source',input('capture','source',{budget:{max_rows:10000,max_artifacts:0,max_total_bytes:16777216}})),denied);
  await assert.rejects(invoke('probe','source',input('probe','source')),denied);
  assert.deepEqual(actual.observations.map(x=>({lane:x.lane,operation:x.operation,status:x.status,forwarded:x.forwarded})),[
   {lane:'source',operation:'capture',status:503,forwarded:true},
   {lane:'source',operation:'probe',status:503,forwarded:true}
  ],'each denied intent reaches the actual authenticated HTTPS gateway once; no continuation is sent');
  assert.equal(await actual.snapshot('source'),sourceBefore,'denial must not freeze admission, mutate authority, create jobs or rewrite domain rows');
  assert.equal(await actual.snapshot('target'),targetBefore,'target remains untouched');
  assert.deepEqual(actual.unexpectedOutbound,[],'denial must not dispatch retained notifications');
  const files=fs.readdirSync(artifactDirectory,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile());
  assert.equal(files.length,2,'only encrypted capture/probe request evidence is expected, not completion evidence');
  for(const entry of files){
   assert.match(entry.name,/^cli_smoke_(capture|probe)_source\.request\.enc$/);
   const artifact=path.join(entry.parentPath,entry.name);assert.equal(fs.statSync(artifact).mode&0o777,0o600);
   const bytes=fs.readFileSync(artifact);
   for(const secret of [service.client_secret,actual.integrity.key,'Retained CLI body'])assert.equal(bytes.includes(Buffer.from(secret)),false);
  }
  for(const name of ['manifest.enc','retirement.enc'])assert.equal(fs.existsSync(path.join(artifactDirectory,name)),false);
  assert.equal(files.some(entry=>/^chunk-|receipt|response/.test(entry.name)),false);
  // Local encrypted state/request recording is intentional on a denied attempt.
  // No complete receipt, SQL capture, restore, retirement or resume is claimed.
 }catch(error){
  if(actual){
   error.message+='\nObserved protocol: '+JSON.stringify({count:actual.observations.length,last:actual.observations.slice(-8)});
   try{error.message+='\nSource tables: '+JSON.stringify(await (await actual.storage('source')).exec("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name"));}catch{}
  }
  throw error;
 }finally{
  for(const fd of descriptors)fs.closeSync(fd);
  if(actual)await actual.close();
  fs.rmSync(directory,{recursive:true,force:true});
 }
});
