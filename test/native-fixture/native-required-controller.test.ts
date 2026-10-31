import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {RequiredFixtureController,requiredControllerPlan} from '../../workers/native-fixture/required-controller';
it('compiles the single required global schedule including both external slots',()=>{
 expect(requiredControllerPlan).toHaveLength(64);
 expect(new Set(requiredControllerPlan.map(r=>r.id)).size).toBe(64);
 expect(requiredControllerPlan.filter(r=>r.kind==='process')).toHaveLength(53);
 expect(requiredControllerPlan.some(r=>r.id.includes('swapped-'))).toBe(false);
});
it('rejects install on a different actual controller identity before writing a claim',async()=>{
 const stub=env.WORKSPACE.getByName('required-controller-wrong-identity');
 await runInDurableObject(stub,async(_instance,state)=>{
  const controller=new RequiredFixtureController(state,{...env,CONTROLLER:env.WORKSPACE});
  await expect(controller.installRequiredRun('{}')).rejects.toThrow();
  expect(await state.storage.get('required-run-claim')).toBeUndefined();
 });
});

import {fixture,operator} from '../helpers/environment';
import {login,request as authRequest} from '../helpers/auth';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import {WorkspaceDO as ProductWorkspaceDO} from '../../src/workspace/workspace-do';
import manifest from '../../scripts/lib/native-complete-fixture.json';
import application from '../../workers/native-fixture/required-application-plan.json';
import {requiredBody,type RequiredBindings} from '../../workers/native-fixture/required-family-reducers';
import entry from '../helpers/required-controller-worker';
const tokens={S:'A'.repeat(43),R:'B'.repeat(42)+'A',X:'C'.repeat(42)+'A'};
const P='ws_example',F='ws_foreign';
async function installed(name:string,modify?:(config:Awaited<ReturnType<typeof fixture>>['config'])=>void,humanLogin=true){
 const raw=await fixture(name+'-p'),config=raw.config,c=manifest.configuration_constraints;
 config.workspace_catalog.push({workspace_id:F,object_name:name+'-f'});
 config.authentication.redirect_uris.push({workspace_id:F,redirect_uri:'https://hub.example.invalid/v2/workspaces/'+F+'/auth/callback'});
 config.static_participants=[{workspace_id:P,agent_id:'agent_research',display_name:'Native submitter'},{workspace_id:P,agent_id:'agent_reviewer',display_name:'Native reviewer'},{workspace_id:F,agent_id:'agent_foreign',display_name:'Foreign proof actor'}];
 config.human_grants[0].scopes=['credentials:manage','workspace:read'];config.human_grants[0].project_ids=null;Object.assign(config.human_grants[0],{delegable_native_scopes:[...c.human_delegable_native_scopes]});
 const expiry=config.static_credential_refs[0].expires_at;
 config.static_credential_refs=[['S',P,'agent_research','cred_s'],['R',P,'agent_reviewer','cred_r'],['X',F,'agent_foreign','cred_x']].map(([role,workspace_id,agent_id,credential_id])=>({workspace_id,agent_id,credential_id,scopes:[...c.native_scopes[role as 'S'|'R'|'X']] as typeof config.static_credential_refs[0]['scopes'],project_ids:null,enabled:true,expires_at:expiry}));
 config.workspace_policies=[P,F].map(workspace_id=>({workspace_id,allowed_user_overrides:[],notification_destinations:[],retry_after_max_seconds:3600,execution_policy:{policy_version:1,agent_wip_limit:1,task_retry_limit:0,artifact_upload_ttl_seconds:900,eligibility_rules:workspace_id===P?[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}]:[],replay_safety_rules:[]}}));
 modify?.(config);raw.bundle.config_digest=await sha256(canonicalJson(config));
 const hashes=await Promise.all([tokens.S,tokens.R,tokens.X].map(v=>sha256(v)));
 raw.bundle.credentials=config.static_credential_refs.map((r,i)=>({workspace_id:r.workspace_id,credential_id:r.credential_id,token_sha256:hashes[i]}));
 const prepP=await prepareBootstrap(config,raw.bundle,P),prepF=await prepareBootstrap(config,raw.bundle,F);
 const p=env.WORKSPACE.getByName(name+'-p'),f=env.WORKSPACE.getByName(name+'-f');
 await p.reconcileConfiguration(operator(),prepP);await f.reconcileConfiguration({...operator(),workspaceId:F},prepF);
 const authStub={fetch:async(request:Request)=>{const spec={url:request.url,method:request.method,headers:[...request.headers],body:request.body?await request.text():null};const result=await runInDurableObject(p,async(instance)=>{const response=await ProductWorkspaceDO.prototype.fetch.call(instance,new Request(spec.url,{method:spec.method,headers:spec.headers,body:spec.body,redirect:'manual'}));return {status:response.status,headers:[...response.headers],body:await response.text()};});return new Response(result.body,{status:result.status,headers:result.headers});}};
 let sessionId='missing_session',tokenHash='0'.repeat(64),csrfHash='1'.repeat(64),humanCookie='',humanCsrf='';
 if(humanLogin){
  const session=await login(authStub as typeof p);expect(session.response.status).toBe(302);await session.response.text();
  const response=await authStub.fetch(authRequest('session','GET',undefined,session.cookie));expect(response.status).toBe(200);
  const data=await response.json() as {data:{csrf_token:string}};tokenHash=await sha256(session.cookie.slice('cfhub_session='.length));csrfHash=await sha256(data.data.csrf_token);
  humanCookie=session.cookie;humanCsrf=data.data.csrf_token;sessionId=await runInDurableObject(p,(_i,state)=>state.storage.sql.exec<{id:string}>('SELECT id FROM sessions').one().id);
 }
 const generation=async(stub:typeof p)=>runInDurableObject(stub,(_i,state)=>state.storage.sql.exec<{generation:number}>('SELECT generation FROM maintenance_state').one().generation);
 const expected={role:'primary' as 'primary'|'foreign',epoch:config.config_epoch,config_sha256:raw.bundle.config_digest,origin:'https://hub.example.invalid',audience:config.authentication.audience,
  workspaces:{primary:{id:P,object_name:name+'-p',installation_sha256:prepP.installationDigest,generation:await generation(p)},foreign:{id:F,object_name:name+'-f',installation_sha256:prepF.installationDigest,generation:await generation(f)}},
  actors:{S:{agent_id:'agent_research',credential_id:'cred_s',token_sha256:hashes[0]},R:{agent_id:'agent_reviewer',credential_id:'cred_r',token_sha256:hashes[1]},X:{agent_id:'agent_foreign',credential_id:'cred_x',token_sha256:hashes[2]}},
  human:{principal_id:config.human_grants[0].principal_id,issuer:config.authentication.issuer,subject:config.human_grants[0].subject,session_id:sessionId,token_sha256:tokenHash,csrf_sha256:csrfHash}};
 return {p,f,expected,humanCookie,humanCsrf};
}

it('runs one real P/F journey through the sole frontdoor, with source-test terminal correlations (not native custody)',async()=>{
 const f=await installed('required-joint-source'),{expected}=f,controller=(env as unknown as {CONTROLLER:DurableObjectNamespace}).CONTROLLER.getByName('required-fixture-controller') as any;
 const run='joint_source_run',owner='e'.repeat(64),prep='d'.repeat(64),final='f'.repeat(64),deadline=Date.now()+120000;
 let managementCalls=0;const call=async(method:string,value:unknown)=>{managementCalls++;let text:string;try{text=await controller[method](canonicalJson(value));}catch{throw Error('PRIVATE_CALL_FAILED '+method+' '+String((value as any).registration?.step_id??(value as any).registration?.phase_id??(value as any).control_id??(value as any).step_id??''));}expect(typeof text).toBe('string');const parsed=JSON.parse(text);expect(canonicalJson(parsed)).toBe(text);return {text,value:parsed};};
 const installation={run_id:run,service_id:'source_test_service',instance_id:'source_test_instance',descriptor_sha256:'a'.repeat(64),policy_sha256:'b'.repeat(64),native_config_sha256:'c'.repeat(64),fixture_config_sha256:expected.config_sha256,scenario_sha256:'1'.repeat(64),fixture_sha256:'2'.repeat(64),ledger_sha256:'3'.repeat(64),deadline,expected};await call('installRequiredRun',installation);
 let prior:any=null,requests=0,processes=0,auxiliaries=0,scannerReads=0,held:Promise<Response>|null=null;const causal:Record<string,string>={};
 const tasks:Record<string,string>={},runs:Record<string,string>={},runtime:Record<string,any>={},dtos:Record<string,Map<string,any>>={T:new Map(),R:new Map(),U:new Map(),AR:new Map()};let artifact:string|null=null,message:string|null=null,thread:string|null=null;
 const acknowledge=async(result:{text:string;value:any})=>{const sha=await sha256(result.text);prior={source_sha256:sha,record_id:'source_issued_'+processes+'_'+auxiliaries+'_'+requiredControllerPlan.findIndex(s=>s.id===result.value.subject?.step_id),family:'process-observation-summary',sha256:final,byte_size:1};if(result.value.subject?.step_id)causal[result.value.subject.step_id]=sha;return sha;};
 const binding=(step:any):RequiredBindings=>({task_id:tasks[step.fixture]??tasks.main??null,run_id:runs[step.fixture]??runs.main??null,runtime_id:runtime[step.actor==='reviewer'?'R':'S']?.id??null,artifact_id:artifact,thread_id:thread,message_id:message,reviewer_agent_id:expected.actors.R.agent_id});
 // These are response-derived request recipe inputs, never independent observation evidence.
 const recipeRows=()=>Object.entries(dtos).map(([selector,items],ordinal)=>({selector,ordinal,canonical:canonicalJson([...items.values()]),byteSize:0}));
 const all=application.filter(p=>p.owner_kind==='process'),key=(id:string)=>'r2_'+(all.findIndex(p=>p.step_id===id)+1).toString(16).padStart(32,'0'),lostKey=key('case/lost-response-retained'),lostBody=canonicalJson({title:'Native scenario lost-response',description:'Synthetic isolated conformance fixture'});
 const readScanner=async(slot:string,own:string,kind:string,sha:string)=>{const r=await call('readRequiredPrivateProjection',{run_id:run,slot_id:slot,owner_id:own,kind,sha256:sha});expect(r.value.type).toMatch(/^required-scanner-/);expect(new TextEncoder().encode(r.text).length).toBeLessThanOrEqual(kind==='scanner-provision'?11223:14967);const selections=r.value.selected??[...r.value.before,...r.value.after];for(const selected of selections){const bytes=Uint8Array.from(atob(selected.payload_base64),c=>c.charCodeAt(0)),canonical=new TextDecoder().decode(bytes);expect(bytes.length).toBe(selected.byte_size);expect(await sha256(canonical)).toBe(selected.sha256);if(selected.selector==='M'){expect(selected.kind).toBe('scanner-workspace-fence-v1');expect(Object.keys(JSON.parse(canonical)[0]).sort()).toEqual(['admission_state','config_digest','config_epoch','installation_digest','object_name','workspace_id']);expect(bytes.length).toBeLessThanOrEqual(464);expect(selected.source_byte_size).toBeLessThanOrEqual(7115);expect(selected.source_sha256).toMatch(/^[a-f0-9]{64}$/);}}scannerReads++;};
 const process=async(step:typeof application[number],aux=false)=>{
  const b=binding(step),role=step.actor==='reviewer'?'R':step.actor==='foreign'?'X':'S';if(step.step_id==='probe/wrong-runtime')b.runtime_id=runtime.R.id;
  let body:any=step.ordinals.length&&step.actor!=='human'?requiredBody(step.step_id,recipeRows(),b,expected.actors[role].agent_id):null;
  if(aux&&step.actor==='foreign'){const suffix=step.step_id.slice(-1);b.runtime_id=step.step_id.includes('enroll')?null:runtime['X'+suffix].id;body=step.step_id.includes('enroll')?{label:'Native external proof '+suffix}:{expected_runtime_version:1};}
  if(aux&&step.actor==='human')body={expected_credential_version:1,reason:'R2'};
  const bytes=body===null?null:typeof body==='string'?body:canonicalJson(body);
  const idem=aux?'r2_'+(100+auxiliaries).toString(16).padStart(32,'0'):step.step_id==='case/settled-no-send'?key('prepare/fail-create'):step.step_id==='case/restart-no-send'?lostKey:step.ordinals.some(o=>o.idempotency)||step.step_id==='probe/wrong-runtime'?key(step.step_id):null;
  const invocation='source_'+(aux?'action_'+auxiliaries:'process_'+processes),reg:any={run_id:run,[aux?'phase_id':'step_id']:step.step_id,[aux?'action_id':'invocation_id']:invocation,preparation_sha256:prep,request_body_sha256:bytes===null?null:await sha256(bytes),idempotency_key:idem,bindings:b,[aux?'action_owner_sha256':'terminal_owner_sha256']:owner};
  await call(aux?'openRequiredAuxiliary':'openRequiredPhase',{registration:reg,prior_issued:prior});prior=null;
  for(const ord of step.ordinals){const ids:Record<string,string|null>={workspace_id:step.actor==='foreign'||step.step_id==='probe/server-foreign-workspace'?F:P,task_id:b.task_id,run_id:b.run_id,runtime_instance_id:b.runtime_id,artifact_id:artifact,thread_id:thread,agent_id:b.reviewer_agent_id,credential_id:expected.actors.S.credential_id};const path=ord.path.replace(/\{([^}]+)\}/g,(_all,k)=>ids[k]!);const paged=['listAgents','listTasks','listTaskResults','listArtifacts','getInbox','getThread','listEvents','searchWorkspace'].includes(ord.operation),query=ord.operation==='searchWorkspace'?'?limit=20&q=conformance':paged?'?limit=20':'';
   const headers:Record<string,string>={accept:ord.operation==='downloadArtifactContent'?'*/*':'application/json'};
   if(step.actor==='human'){headers.origin=expected.origin;headers.cookie=f.humanCookie;headers['x-csrf-token']=f.humanCsrf;}else headers.authorization='Bearer '+tokens[role];
   if(ord.idempotency)headers['idempotency-key']=idem!;
   if(ord.runtime_proof)headers['x-runtime-token']=step.actor==='foreign'?runtime['X'+(step.step_id==='E2/negative-B'?'A':step.step_id.slice(-1))].proof:runtime[role].proof;
   const requestBody=ord.method==='GET'?null:bytes;if(requestBody!==null)headers['content-type']=ord.operation==='uploadArtifactContent'?'application/octet-stream':'application/json';if(ord.operation==='uploadArtifactContent')headers['content-length']='29';
   const promise=entry.fetch(new Request(expected.origin+path+query,{method:ord.method,headers,...(requestBody===null?{}:{body:requestBody})}),env as any);requests++;
   if(step.step_id==='case/lost-response-retained'){held=promise;void promise.catch(()=>{});await new Promise(resolve=>setTimeout(resolve,1000));continue;}
   const response=await promise;expect(response.status,step.step_id).toBe(ord.response_status);if(ord.operation==='downloadArtifactContent'){expect(await response.text()).toBe('Native conformance artifact.\n');continue;}const out=await response.json() as any;if(response.status>=400)continue;
   if(ord.operation==='createRuntime'){const r=out.data.runtime;runtime[role==='X'?'X'+step.step_id.slice(-1):role]={id:r.id,proof:out.data.runtime_token};dtos.U.set(r.id,r);}
   if(ord.operation==='heartbeatRuntime')dtos.U.set(out.data.id,out.data);
   if(ord.operation==='createTask'){tasks[step.fixture]=out.data.id;dtos.T.set(out.data.id,out.data);}
   if(['getTask','patchTask'].includes(ord.operation))dtos.T.set(out.data.id,out.data);
   if(out.data?.task){dtos.T.set(out.data.task.id,out.data.task);if(out.data.run){dtos.R.set(out.data.run.id,out.data.run);if(ord.operation==='claimTask')runs[step.fixture]=out.data.run.id;}}
   if(['getRun','heartbeatRun'].includes(ord.operation))dtos.R.set(out.data.id,out.data);
   if(['stageArtifact','uploadArtifactContent','commitArtifact','getArtifact'].includes(ord.operation)){artifact=out.data.id;dtos.AR.set(out.data.id,out.data);}
   if(ord.operation==='createMessage'){message=out.data.id;thread=out.data.thread_id;}
  }
  const terminal={run_id:run,[aux?'phase_id':'step_id']:step.step_id,[aux?'action_id':'invocation_id']:invocation,preparation_sha256:prep,[aux?'action_owner_sha256':'terminal_owner_sha256']:owner,[aux?'action_final_sha256':'process_final_sha256']:final};
  const observed=await call(aux?'closeRequiredAuxiliary':'closeRequiredPhase',terminal);expect(observed.value.type).toBe('required-phase-source');expect(observed.value.native_conformance).toBe(false);expect(observed.value.transport.requests).toHaveLength(step.ordinals.length);if(step.process_operation==='createMessage'){const reconciled=observed.value.reconciliation.resource_ids;expect(reconciled).toContain('message:'+message);expect(reconciled).toContain('thread:'+thread);thread=reconciled.find((id:string)=>id.startsWith('thread:')).slice(7);}
  const digest=await acknowledge(observed);
  if(step.process_operation==='createRuntime')await readScanner(step.step_id,invocation,'scanner-enrollment',digest);
  if(aux)auxiliaries++;else processes++;
 };
 try{for(const slot of requiredControllerPlan){
  if(slot.kind==='process'){await process(application.find(p=>p.step_id===slot.id)!);continue;}
  if(slot.id==='server-foreign-workspace-denial'){await call('completeRequiredExternalE1',{run_id:run,preparation_sha256:prep,negative_source_sha256:causal['probe/server-foreign-workspace'],positive_source_sha256:causal['prepare/server-foreign-own-positive'],prior_issued:prior});prior=null;continue;}
  if(slot.id==='server-wrong-runtime-proof-denial'){for(const phase of application.filter(p=>p.owner_kind==='auxiliary'&&p.actor==='foreign'))await process(phase,true);continue;}
  if(slot.id==='control/revoke-submitter'){await process(application.find(p=>p.step_id===slot.id)!,true);continue;}
  if(slot.id==='control/provision'){const r=await call('provisionRequiredRun',{run_id:run,preparation_sha256:prep,prior_issued:prior});prior=null;for(const ref of r.value.projections)await readScanner(ref.slot_id,ref.owner_id,ref.kind,ref.sha256);continue;}
  for(const role of slot.id==='control/observe-server-foreign-fixture'?['primary','foreign']:['primary']){const b=binding({fixture:'main',actor:'submitter'});if(slot.id==='control/observe-other-runtime')b.runtime_id=runtime.R.id;const outcome=slot.id==='control/observe-settled-intent'?key('prepare/fail-create'):['control/arm-lost-response','control/disarm-and-observe-lost'].includes(slot.id)?lostKey:null;const r=await call('observeRequiredControl',{run_id:run,control_id:slot.id,role,preparation_sha256:prep,idempotency_key:outcome,request_body_sha256:outcome===lostKey?await sha256(lostBody):null,bindings:b,prior_issued:prior});prior=null;if(slot.id!=='control/authorize')await acknowledge(r);}
  if(slot.id==='control/disarm-and-observe-lost'){const response=await held!;expect(response.status).toBe(201);await response.text();held=null;}
 }
 expect({requests,processes,auxiliaries,scannerReads}).toEqual({requests:57,processes:53,auxiliaries:6,scannerReads:7});
 }finally{const closed=await call('closeRequiredRun',{run_id:run});expect(closed.value.status).toBe('closed');if(held)await held.then(r=>r.body?.cancel()).catch(()=>{});}
 expect(managementCalls).toBe(137);
 const claim=await runInDurableObject(controller,async(_instance,state)=>state.storage.get<string>('required-run-claim'));expect(typeof claim).toBe('string');expect(new TextEncoder().encode(claim).length).toBeLessThanOrEqual(1024);expect(claim).not.toContain(tokens.S);
 await evictDurableObject(controller);const restarted=(env as unknown as {CONTROLLER:DurableObjectNamespace}).CONTROLLER.getByName('required-fixture-controller') as any;const blocked=await runInDurableObject(restarted,async(instance)=>{try{await (instance as unknown as RequiredFixtureController).installRequiredRun(canonicalJson(installation));return false;}catch{return true;}});expect(blocked).toBe(true);
},120000);

it('does not dispatch a later foreign bind after concurrent poison (controlled source-fake RPC, not actual admission)',async()=>{
 const {expected}=await installed('controller-late-bind');const ns=(env as unknown as {CONTROLLER:DurableObjectNamespace}).CONTROLLER,stub=ns.getByName('controlled-late-rpc');
 await runInDurableObject(stub,async(_instance,state)=>{
  let release!:()=>void,entered!:()=>void,foreign=0;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
  const fake={getByName:(name:string)=>({bindSourceCapture:async()=>{if(name===expected.workspaces.primary.object_name){entered();await gate;}else foreign++;return canonicalJson({projection:{}});},closeSourceRun:async()=>canonicalJson({status:'closed'})})};
  const a=new RequiredFixtureController(state,{...env,CONTROLLER:{idFromName:()=>stub.id},WORKSPACE:fake} as any),run='controlled_source_run';
  await a.installRequiredRun(canonicalJson({run_id:run,service_id:'s',instance_id:'i',descriptor_sha256:'a'.repeat(64),policy_sha256:'b'.repeat(64),native_config_sha256:'c'.repeat(64),fixture_config_sha256:expected.config_sha256,scenario_sha256:'1'.repeat(64),fixture_sha256:'2'.repeat(64),ledger_sha256:'3'.repeat(64),deadline:Date.now()+10000,expected}));
  const empty={task_id:null,run_id:null,runtime_id:null,artifact_id:null,thread_id:null,message_id:null,reviewer_agent_id:expected.actors.R.agent_id};
  await a.observeRequiredControl(canonicalJson({run_id:run,control_id:'control/authorize',role:'primary',preparation_sha256:'d'.repeat(64),idempotency_key:null,request_body_sha256:null,bindings:empty,prior_issued:null}));
  const pending=a.provisionRequiredRun(canonicalJson({run_id:run,preparation_sha256:'d'.repeat(64),prior_issued:null}));void pending.catch(()=>{});await started;
  await expect(a.openRequiredPhase('{}')).rejects.toThrow();release();await pending.catch(()=>{});expect(foreign).toBe(0);expect(JSON.parse(await a.closeRequiredRun(canonicalJson({run_id:run}))).status).toBe('closed');expect(JSON.parse(await a.closeRequiredRun(canonicalJson({run_id:run}))).status).toBe('closed');
 });
});

it('does not export full admission captures through the workspace RPC surface',async()=>{
 const {p,expected}=await installed('raw-admission-denied');const deadline=Date.now()+10000;
 await (p as any).bindRequiredFixture({run_id:'raw_rpc_negative',run_deadline:deadline,expires_at:deadline,expected});
 let exposed=false;try{const value=await (p as any).takePrivateAdmissionCapture();exposed=!!value;}catch{}
 expect(exposed).toBe(false);await (p as any).closeAttachment();
});
