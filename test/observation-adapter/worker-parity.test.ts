import {testFlock} from './flock-profile';
/** Actual Node protected-store → narrow transport → Workerd/SQLite route chain.
 * Every identity/store/config is synthetic and private to this local harness. */
import {beforeAll,afterAll,it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createTestHarness,type TestHarness,type WorkerHandle} from 'wrangler';
import example from '../../examples/config/deployment.example.json';
import bundleExample from '../../examples/config/r1-bootstrap.example.json';
import {parseDeployment} from '../../src/config/deployment';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import type {VerificationBundle} from '../../src/config/generated/validators.js';
import {ProtectedCredentialProvider} from '../../packages/cli/src/secret-store';
import {createNativeClient} from '../../packages/client/src/native-client';
import {createOwnerTransport} from '../../packages/observation-adapter/src/owner-transport';
import {freezeIntent,type FrozenBinding,type OwnerTransport} from '../../packages/observation-adapter/src/contract';
import {runHook} from '../../packages/observation-adapter/src/main';
import {withStateLock} from '../../packages/observation-adapter/src/state-file';
import {Deadline} from '../../packages/client/src/transport';
import {binding,record} from './helpers';
let harness:TestHarness,worker:WorkerHandle,provider:ProtectedCredentialProvider,directory:string,frozen:FrozenBinding,transport:OwnerTransport,sessionId:string,storage:Awaited<ReturnType<WorkerHandle['getDurableObjectStorage']>>;
let config= parseDeployment(structuredClone(example)),bundle=structuredClone(bundleExample) as VerificationBundle;
const token=Buffer.alloc(32,83).toString('base64url'),name='b2-adapter-parity';
const operator=(expectedEpoch=0,expectedInstallationDigest:string|null=null)=>({principalId:'synthetic_operator',workspaceId:'ws_example',requestId:'req_adapter',operation:'install' as const,expectedEpoch,expectedInstallationDigest});
const run=async<T>(fn:(d:Deadline)=>Promise<T>)=>{const d=new Deadline(2000);try{return await fn(d);}finally{d.dispose();}};
const fetcher:typeof fetch=async(url,init)=>{
 const request=new Request(url,init);const response=await worker.fetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),...(request.body?{body:await request.text()}:{}),redirect:'manual'});
 return new Response(await response.arrayBuffer(),{status:response.status,headers:Object.fromEntries(response.headers)});
};
const establish=()=>freezeIntent(frozen,{kind:'establish',body:{run_id:frozen.runId,fence:1,adapter_id:frozen.adapterId,adapter_version:frozen.adapterVersion}});
beforeAll(async()=>{
 directory=mkdtempSync(join(dirname(process.cwd()),'b2-real-provider-'));provider=new ProtectedCredentialProvider({directory,create:true});provider.importCredential(token);
 config.workspace_catalog[0].object_name=name;config.static_credential_refs[0].expires_at=new Date(Date.now()+86400000).toISOString();config.static_credential_refs[0].scopes.push('runtimes:manage','tasks:read','tasks:claim','tasks:execute');
 config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:1,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research','agent_second']}],replay_safety_rules:[]};
 config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_second',display_name:'Second synthetic'});
 config.workspace_policies[0].observation_pilot={enabled:true,repository_id:'repository_fixture',adapter_id:'synthetic-adapter',adapter_version:'1',supported_events:['read-observed','write-observed'],slots:[{agent_id:'agent_research',checkout_slot_id:'checkout_a'},{agent_id:'agent_second',checkout_slot_id:'checkout_b'}]};
 config.static_credential_refs.push({...config.static_credential_refs[0],credential_id:'credential_second',agent_id:'agent_second'});bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_second',token_sha256:await sha256(Buffer.alloc(32,84).toString('base64url'))});
 bundle.credentials[0].token_sha256=await sha256(token);bundle.config_digest=await sha256(canonicalJson(config));const prepared=await prepareBootstrap(config,bundle,'ws_example');
 harness=createTestHarness({workers:[{configPath:'./wrangler.jsonc',vars:{DEPLOYMENT_CONFIG:JSON.stringify(config)}},{configPath:'./workers/recovery-anchor/wrangler.jsonc'}]});const listening=await harness.listen();expect(['127.0.0.1','localhost','[::1]']).toContain(listening.url.hostname);worker=harness.getWorker('cf-agent-hub');
 const env=await worker.getEnv();await env.WORKSPACE.getByName(name).reconcileConfiguration(operator(),prepared);storage=await worker.getDurableObjectStorage('WORKSPACE',{name});
 const client=createNativeClient({origin:binding.origin,workspaceId:'ws_example',credentialProvider:provider,fetch:fetcher});const enrolled=await client.enrollRuntime({body:{label:'Synthetic actual Workerd'}},{idempotencyKey:'synthetic-runtime',captureRuntime:c=>provider.captureRuntime(c)});expect(enrolled.ok?null:enrolled.error.code).toBe(null);if(!enrolled.ok)throw Error('SYNTHETIC_ENROLLMENT_FAILED');
 frozen={...binding,principal:provider.binding()!,runtimeId:enrolled.data.id,taskId:'task_adapter',runId:'run_adapter',repositoryId:'repository_fixture',checkoutSlotId:'checkout_a',adapterId:'synthetic-adapter',expectedConfigIdentity:bundle.config_digest};provider.close();provider=new ProtectedCredentialProvider({directory,create:false});transport=createOwnerTransport(provider,fetcher,()=>frozen);
 const now=Date.now();await storage.exec(`INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,assigned_agent_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES('task_adapter','ws_example','Synthetic adapter','','ready',1,0,'agent_research',0,2,'[]',${now},${now})`);
 await storage.exec(`INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at) VALUES('run_adapter','ws_example','task_adapter','agent_research','${enrolled.data.id}','credential_research_1',1,'active',1,1,${now+60000},${now})`);
 await storage.exec("UPDATE tasks SET state='doing',active_run_id='run_adapter',latest_run_id='run_adapter' WHERE id='task_adapter'");
},30000);
afterAll(async()=>{provider?.close();await harness?.close();if(directory)rmSync(directory,{recursive:true,force:true});});
it('real_flock_durable_reporter_protected_provider_and_Workerd_form_one_chain',async()=>{
 const directory=mkdtempSync(join(dirname(process.cwd()),'b2-chain-state-')),state={directory,worktreeRoot:process.cwd(),flock:testFlock};
 const read=()=>JSON.parse(readFileSync(join(directory,'state.json'),'utf8'));let sends=0;
 try{await run(d=>withStateLock({...state,purpose:'initialize'},d,async store=>store.initialize(frozen)));
 for(let index=0;index<3;index++){
 const before=sends;await run(d=>runHook({binding:frozen,state,deadline:d,root:'/private/checkout',profile:'claude-posttooluse-path-docs-20261101-v1',observedAt:record.observed_at,currentBinding:()=>frozen,transportFactory:()=>{
 expect(read().phase).toBe(index===1?'awaiting-owner-status':'pending');return createOwnerTransport(provider,async(u,i)=>{sends++;return fetcher(u,i);},()=>frozen);
 }},new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({hook_event_name:'PostToolUse',cwd:'/private/checkout',tool_name:'Read',tool_input:{file_path:'/private/checkout/source.ts'}})));c.close();}})));expect(sends-before).toBe(1);
 if(index===0)expect(read().session.highWater).toBeNull();
 }
 expect(read()).toMatchObject({phase:'ready',pending:null,queue:[],session:{highWater:3},completeness:'unknown'});
 expect((await storage.exec('SELECT COUNT(*) AS n FROM observation_records'))[0].n).toBe(3);
 }finally{rmSync(directory,{recursive:true,force:true});}
},15000);
it('genuine_protected_provider_four_routes_match_real_B1_fingerprints_receipts_without_domain_effects',async()=>{
 const domain=async()=>Object.fromEntries(await Promise.all(['tasks','runs','runtimes','events','task_history','idempotency_outcomes','outbox'].map(async t=>[t,await storage.exec('SELECT * FROM '+t)]))),before=await domain();
 const established=await run(d=>transport.dispatch(establish(),d));expect(established.kind).toBe('established');if(established.kind!=='established')throw Error('establish');sessionId=established.data.session_id;
 const status=await run(d=>transport.status(frozen,sessionId,d));expect(status).toMatchObject({kind:'status',data:{high_water:3,session_epoch:1}});
 const append=freezeIntent(frozen,{kind:'append',sessionId,body:{run_id:frozen.runId,fence:1,first_sequence:4,records:[record]}}),first=await run(d=>transport.dispatch(append,d)),replay=await run(d=>transport.dispatch(append,d));expect(first).toMatchObject({kind:'appended',data:{request_fingerprint:append.fingerprint,first_sequence:4,last_sequence:4,record_count:1}});expect(replay).toEqual(first);
 const replace=freezeIntent(frozen,{kind:'replace',body:{run_id:frozen.runId,fence:1,expected_session_id:sessionId,expected_high_water:4,replacement_request_id:'00000000-0000-4000-8000-000000000001',reason:'coverage_loss'}}),replaced=await run(d=>transport.dispatch(replace,d));expect(replaced).toMatchObject({kind:'replaced',data:{request_fingerprint:replace.fingerprint,new_epoch:2}});if(replaced.kind!=='replaced')throw Error('replace');sessionId=replaced.data.new_session_id;expect(await run(d=>transport.status(frozen,sessionId,d))).toMatchObject({kind:'status',data:{high_water:0,session_epoch:2}});expect(await domain()).toEqual(before);
},15000);
it('actual_server_cross_task_and_stale_owner_denials_do_not_invent_new_authority',async()=>{
 const foreign={...frozen,taskId:'task_foreign'},other=createOwnerTransport(provider,fetcher,()=>foreign);expect(await run(d=>other.dispatch(freezeIntent(foreign,{kind:'establish',body:{run_id:foreign.runId,fence:1,adapter_id:foreign.adapterId,adapter_version:foreign.adapterVersion}}),d))).toEqual({kind:'blocked'});
 await storage.exec("UPDATE runs SET fence=2 WHERE id='run_adapter'");try{expect(await run(d=>transport.dispatch(establish(),d))).toEqual({kind:'blocked'});}finally{await storage.exec("UPDATE runs SET fence=1 WHERE id='run_adapter'");}
});
it('second_synthetic_checkout_owner_is_separate_and_unsupported_existing_context_is_inert',async()=>{
 const directory=mkdtempSync(join(dirname(process.cwd()),'b2-second-provider-')),stateDirectory=mkdtempSync(join(dirname(process.cwd()),'b2-second-state-'));let second=new ProtectedCredentialProvider({directory,create:true});
 try{
 second.importCredential(Buffer.alloc(32,84).toString('base64url'));const client=createNativeClient({origin:frozen.origin,workspaceId:frozen.workspaceId,credentialProvider:second,fetch:fetcher});const enrolled=await client.enrollRuntime({body:{label:'Synthetic second checkout'}},{idempotencyKey:'second-runtime',captureRuntime:c=>second.captureRuntime(c)});expect(enrolled.ok).toBe(true);if(!enrolled.ok)throw Error('SECOND_ENROLLMENT');
 const b={...frozen,principal:second.binding()!,runtimeId:enrolled.data.id,taskId:'task_second',runId:'run_second',checkoutSlotId:'checkout_b',launchGeneration:'second-launch'};second.close();second=new ProtectedCredentialProvider({directory,create:false});const now=Date.now();
 await storage.exec(`INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,assigned_agent_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES('task_second','ws_example','Second synthetic','','ready',1,0,'agent_second',0,2,'[]',${now},${now})`);
 await storage.exec(`INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at) VALUES('run_second','ws_example','task_second','agent_second','${b.runtimeId}','credential_second',1,'active',1,1,${now+60000},${now})`);await storage.exec("UPDATE tasks SET state='doing',active_run_id='run_second',latest_run_id='run_second' WHERE id='task_second'");
 const state={directory:stateDirectory,worktreeRoot:process.cwd(),flock:testFlock};await run(d=>withStateLock({...state,purpose:'initialize'},d,async store=>store.initialize(b)));let calls=0;
 for(const profile of ['claude-posttooluse-path-docs-20261101-v1','claude-posttooluse-path-docs-20261101-v1','claude-posttooluse-path-docs-20261101-v1','unsupported-existing-context']){
 const before=calls;await run(d=>runHook({binding:b,state,deadline:d,root:'/private/second-checkout',profile,observedAt:record.observed_at,currentBinding:()=>b,transportFactory:()=>createOwnerTransport(second,async(u,i)=>{calls++;return fetcher(u,i);},()=>b)},new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({hook_event_name:'PostToolUse',cwd:'/private/second-checkout',tool_name:'Write',tool_input:{file_path:'/private/second-checkout/second.ts',content:'DISCARDED'}})));c.close();}})));expect({calls:calls-before,phase:JSON.parse(readFileSync(join(stateDirectory,'state.json'),'utf8')).phase}).toMatchObject({calls:profile==='unsupported-existing-context'?0:1});
 }
 const rows=await storage.exec('SELECT agent_id,task_id,runtime_instance_id,metadata_json FROM observation_slots ORDER BY agent_id');expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({agent_id:'agent_research',task_id:frozen.taskId,runtime_instance_id:frozen.runtimeId});expect(rows[1]).toMatchObject({agent_id:'agent_second',task_id:b.taskId,runtime_instance_id:b.runtimeId});expect(JSON.parse(String(rows[0].metadata_json)).checkout_slot_id).toBe('checkout_a');expect(JSON.parse(String(rows[1].metadata_json))).toMatchObject({checkout_slot_id:'checkout_b',coverage:{completeness:'unknown'}});
 expect(JSON.parse(readFileSync(join(stateDirectory,'state.json'),'utf8')).session.highWater).toBe(3);
 }finally{second.close();rmSync(directory,{recursive:true,force:true});rmSync(stateDirectory,{recursive:true,force:true});}
},15000);
it('supported_config_install_invalidates_delayed_establish_with_old_frozen_runtime',async()=>{
 const old=establish(),rows=await storage.exec('SELECT config_epoch,installation_digest FROM workspace_metadata');config=structuredClone(config);config.config_epoch=2;bundle=structuredClone(bundle);bundle.config_epoch=2;bundle.config_digest=await sha256(canonicalJson(config));const prepared=await prepareBootstrap(config,bundle,'ws_example');const env=await worker.getEnv();await env.WORKSPACE.getByName(name).reconcileConfiguration(operator(Number(rows[0].config_epoch),String(rows[0].installation_digest)),prepared);
 expect(await run(d=>transport.dispatch(old,d))).toEqual({kind:'blocked'});expect(await run(d=>transport.status(frozen,sessionId,d))).toEqual({kind:'blocked'});expect((await storage.exec('SELECT COUNT(*) AS n FROM observation_slots'))[0].n).toBe(0);
});
