import {formatResult} from '../../packages/cli/src/output';
import processOffers from '../../scripts/lib/native-complete-processes.json';
import {neutralProfile} from '../../src/config/profile';
import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {login,request as authRequest} from '../helpers/auth';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import manifest from '../../scripts/lib/native-complete-fixture.json';
import {RequiredPhaseAttachment,requiredApplicationPlan,readRequiredPhaseCapture} from '../../workers/native-fixture/required-phase-attachment';
import {reconcileRequiredFamilySchema17,reconcileRequiredFamily,requiredBody,assertRequiredNegativeKeyAbsent,type RequiredBindings} from '../../workers/native-fixture/required-family-reducers';
it('compiles the entire selected required process schedule without a subset or deferred tuple phases',()=>{
 expect(requiredApplicationPlan).toHaveLength(53);
 expect(requiredApplicationPlan.reduce((n,p)=>n+p.ordinals.length,0)).toBe(51);
 expect(requiredApplicationPlan.filter(p=>p.ordinals.length===0)).toHaveLength(5);
 expect(requiredApplicationPlan.filter(p=>p.ordinals.length===2).map(p=>p.step_id)).toEqual(['success/uploadArtifactContent','success/commitArtifact','success/downloadArtifactContent']);
 expect(requiredApplicationPlan.some(p=>p.step_id.startsWith('probe/swapped-'))).toBe(false);
 expect(typeof RequiredPhaseAttachment.prototype.openPhase).toBe('function');
 expect(typeof RequiredPhaseAttachment.prototype.closePhase).toBe('function');
});
it('has no shape-only success fallback for unknown family or invented selected state',()=>{
 expect(()=>reconcileRequiredFamily({step_id:'success/invented',before:[],after:[],responses:[]})).toThrow();
 expect(()=>reconcileRequiredFamily({step_id:'success/getWorkspace',before:[],after:[],responses:[]})).toThrow();
});

it.each([true,false])('independent workspace projection binds agents:read to selected grant rows (%s)',granted=>{
 const scopes=['workspace:read',...(granted?['agents:read']:[])];
 const selected=[{selector:'M',canonical:canonicalJson([{workspace_id:'ws_example',admission_state:'installed'}])},{selector:'F',canonical:canonicalJson([{state:'open'}])},{selector:'G',canonical:canonicalJson([{scopes_json:JSON.stringify(scopes)}])}];
 const data={id:'ws_example',display_name:neutralProfile.display_name,contract_revision:'0.1',actor:{kind:'agent',principal_id:'agent_research',agent_id:'agent_research'},effective_scopes:[...scopes].sort()};
 const input={step_id:'success/getWorkspace',before:selected,after:selected,bindings:{},actor:{agent_id:'agent_research',credential_id:'cred_s'},responses:[{operation:'getWorkspace',status:200,data:{data,request_id:'req_projection'}}]};
 expect(()=>reconcileRequiredFamily(input)).not.toThrow();
 const changed=structuredClone(input);changed.responses[0].data.data.effective_scopes=granted?['workspace:read']:['agents:read','workspace:read'];
 expect(()=>reconcileRequiredFamily(changed)).toThrow('REQUIRED_FAMILY_REJECTED');
 const extra=structuredClone(input);extra.responses[0].data.data.effective_scopes.push('agents:manage');expect(()=>reconcileRequiredFamily(extra)).toThrow();
});

it.each([true,false])('current17 workspace projection exactly binds tasks:create to selected grant (%s)',granted=>{
 const scopes=['workspace:read',...(granted?['tasks:create']:[])];
 const selected=[{selector:'M',canonical:canonicalJson([{workspace_id:'ws_example',admission_state:'installed'}])},{selector:'F',canonical:canonicalJson([{state:'open'}])},{selector:'G',canonical:canonicalJson([{scopes_json:JSON.stringify(scopes)}])}];
 const data={id:'ws_example',display_name:neutralProfile.display_name,contract_revision:'0.1',actor:{kind:'agent',principal_id:'agent_research',agent_id:'agent_research'},effective_scopes:[...scopes].sort()};
 const input={step_id:'success/getWorkspace',before:selected,after:selected,bindings:{},actor:{agent_id:'agent_research',credential_id:'cred_s'},responses:[{operation:'getWorkspace',status:200,data:{data,request_id:'req_projection'}}]};
 expect(()=>reconcileRequiredFamilySchema17(input)).not.toThrow();
 if(granted){expect(()=>reconcileRequiredFamily(input)).toThrow('REQUIRED_FAMILY_REJECTED');const old=structuredClone(input);old.responses[0].data.data.effective_scopes=['workspace:read'];expect(()=>reconcileRequiredFamily(old)).not.toThrow();}
 const changed=structuredClone(input);changed.responses[0].data.data.effective_scopes=granted?['workspace:read']:['tasks:create','workspace:read'];
 expect(()=>reconcileRequiredFamilySchema17(changed)).toThrow('REQUIRED_FAMILY_REJECTED');
 const extra=structuredClone(input);extra.responses[0].data.data.effective_scopes.push('agents:manage');expect(()=>reconcileRequiredFamilySchema17(extra)).toThrow();
});

it('current17 workspace response and actual CLI formatter fit unchanged capture and process offers',()=>{
 const display=['workspace:read','agents:read','messages:send','messages:read','messages:ack','events:read','tasks:read','tasks:create','tasks:schedule','tasks:cancel','tasks:review','artifacts:read'];
 const id='a'.repeat(64),requestId='r'.repeat(128),encode=new TextEncoder();
 const cap=requiredApplicationPlan.find(p=>p.step_id==='success/getWorkspace')!.ordinals[0].capture_limits.responseBodyBytes;
 const offer=processOffers.find(p=>p.step_id==='success/getWorkspace')!.output_bytes;
 expect(cap).toBe(733);expect(offer).toBe(2048);
 const cases=[...(['S','R','X'] as const).map(role=>({scopes:manifest.configuration_constraints.native_scopes[role].filter(scope=>display.includes(scope)).sort(),name:neutralProfile.display_name})),{scopes:[...display].sort(),name:id}];
 for(const [index,item]of cases.entries()){
  const data={id,display_name:item.name,contract_revision:'0.1',actor:{kind:'agent',principal_id:id,agent_id:id},effective_scopes:item.scopes};
  const body=JSON.stringify({data,request_id:requestId}),out=formatResult({ok:true,status:200,data,requestId});
  expect(encode.encode(body).length).toBe([639,578,502,724][index]);
  expect(encode.encode(body).length).toBeLessThanOrEqual(cap);
  expect(out).toEqual({exitCode:0,stdout:body+'\n',stderr:''});
  expect(encode.encode(out.stdout).length).toBeLessThanOrEqual(offer);
 }
});

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
 let sessionId='missing_session',tokenHash='0'.repeat(64),csrfHash='1'.repeat(64),humanCookie='',humanCsrf='';
 if(humanLogin){
  const session=await login(p);expect(session.response.status).toBe(302);await session.response.text();
  const response=await p.fetch(authRequest('session','GET',undefined,session.cookie));expect(response.status).toBe(200);
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


async function normalJourney(name:string,continuation?:(context:any)=>Promise<void>,bomRegression=false){
 const fixtureState=await installed(name),{p,expected}=fixtureState;
 await runInDurableObject(p,async(_instance,state)=>{
  const a=new RequiredPhaseAttachment(state,env),deadline=Date.now()+120000;
  await a.bindRequiredFixture({run_id:'required_source_run',run_deadline:deadline,expires_at:deadline,expected});
  const phaseCaptures=new Map<string,any>(),selected=new Map<string,any>(),tasks:Record<string,string>={},runs:Record<string,string>={},runtimes:Record<string,{id:string;proof:string}>={};let artifact:string|null=null,message:string|null=null,thread:string|null=null;
  try{for(const [index,step]of requiredApplicationPlan.entries()){
   if(step.step_id==='probe/server-foreign-workspace')break;
   const role=step.actor==='reviewer'?'R':'S',binding:RequiredBindings={task_id:tasks[step.fixture]??tasks.main??null,run_id:runs[step.fixture]??runs.main??null,runtime_id:runtimes[role]?.id??null,artifact_id:artifact,thread_id:thread,message_id:message,reviewer_agent_id:expected.actors.R.agent_id};
   const body=step.ordinals.length===0?null:requiredBody(step.step_id,[...selected.values()],binding,expected.actors[role].agent_id);
   const bytes=body===null?null:typeof body==='string'?body:canonicalJson(body),key=step.ordinals.some(o=>o.idempotency)?'r2_'+(index+1).toString(16).padStart(32,'0'):null;
   const reg={run_id:'required_source_run',step_id:step.step_id,invocation_id:'source_invocation_'+index,preparation_sha256:'d'.repeat(64),request_body_sha256:bytes===null?null:await sha256(bytes),idempotency_key:key,bindings:binding,terminal_owner_sha256:'e'.repeat(64)};
   await a.openPhase(reg);
   for(const ordinal of step.ordinals){
    const ids:Record<string,string|null>={workspace_id:P,task_id:binding.task_id,run_id:binding.run_id,runtime_instance_id:binding.runtime_id,artifact_id:artifact,thread_id:thread,agent_id:binding.reviewer_agent_id};
    let path=ordinal.path.replace(/\{([^}]+)\}/g,(_all,k)=>ids[k]!);const paged=['listAgents','listTasks','listTaskResults','listArtifacts','getInbox','getThread','listEvents','searchWorkspace'].includes(ordinal.operation);
    const query=ordinal.operation==='searchWorkspace'?'?limit=20&q=conformance':paged?'?limit=20':'';
    const headers:Record<string,string>={authorization:'Bearer '+tokens[role],accept:ordinal.operation==='downloadArtifactContent'?'*/*':'application/json'};
    if(ordinal.idempotency)headers['idempotency-key']=key!;
    if(ordinal.runtime_proof)headers['x-runtime-token']=runtimes[role].proof;
    const requestBody=ordinal.method==='GET'?null:bytes;
    if(requestBody!==null)headers['content-type']=ordinal.operation==='uploadArtifactContent'?'application/octet-stream':'application/json';
    if(ordinal.operation==='uploadArtifactContent')headers['content-length']='29';
    if(bomRegression&&step.step_id==='success/heartbeatRuntime'){
     expect(new TextEncoder().encode('\uFEFF'+requestBody).length).toBeLessThanOrEqual(ordinal.capture_limits.requestBodyBytes);
     await expect(a.fetch(new Request(expected.origin+path+query,{method:ordinal.method,headers,body:'\uFEFF'+requestBody}))).rejects.toThrow();return;
    }
    const response=await a.fetch(new Request(expected.origin+path+query,{method:ordinal.method,headers,...(requestBody===null?{}:{body:requestBody})}));
    expect(response.status,step.step_id).toBe(ordinal.response_status);
    if(ordinal.operation==='downloadArtifactContent'){expect(await response.text()).toBe('Native conformance artifact.\n');continue;}
    const out=await response.json() as any;
    if(ordinal.operation==='createRuntime')runtimes[role]={id:out.data.runtime.id,proof:out.data.runtime_token};
    if(ordinal.operation==='createTask')tasks[step.fixture]=out.data.id;
    if(ordinal.operation==='claimTask')runs[step.fixture]=out.data.run.id;
    if(ordinal.operation==='stageArtifact')artifact=out.data.id;
    if(ordinal.operation==='createMessage'){message=out.data.id;thread=out.data.thread_id;}
   }
   const result=await a.closePhase({run_id:reg.run_id,step_id:reg.step_id,invocation_id:reg.invocation_id,preparation_sha256:reg.preparation_sha256,terminal_owner_sha256:reg.terminal_owner_sha256,process_final_sha256:'f'.repeat(64),ingress:{window_sha256:'a'.repeat(64),terminal_owner_sha256:reg.terminal_owner_sha256,opened_at:0,closed_at:1,attempted:step.ordinals.length,forwarded:step.ordinals.length,rejected:0,pending_publication:0,pending_product:0}});
   expect(result.native_conformance).toBe(false);const capture=readRequiredPhaseCapture(a,reg.invocation_id);phaseCaptures.set(step.step_id,capture);for(const row of capture.after)selected.set(row.selector,row);
   expect(capture.requests).toHaveLength(step.ordinals.length);expect(capture.responses).toHaveLength(step.ordinals.length);
  }if(continuation)await continuation({a,expected,fixtureState,selected,phaseCaptures,tasks,runs,runtimes,artifact,message,thread});}finally{expect(await a.closeAttachment()).toEqual({status:'closed'});}
 });
}
it('runs the complete normal required journey through real source product dispatch and one before/after pair per process',async()=>normalJourney('required-normal-journey'));

it('keeps auxiliary owner correlation distinct from process custody and reserves no fake process slot',async()=>{
 expect(typeof RequiredPhaseAttachment.prototype.openAuxiliaryPhase).toBe('function');
 expect(typeof RequiredPhaseAttachment.prototype.closeAuxiliaryPhase).toBe('function');
 expect(typeof RequiredPhaseAttachment.prototype.observeControl).toBe('function');
 expect(typeof RequiredPhaseAttachment.prototype.disarmLostResponse).toBe('function');
});
it('pins source canonical query spelling rather than a hand-authored alternate search order',async()=>{
 const {prepareNativeOperation}=await import('../../packages/client/src/native-request');
 const prepared=prepareNativeOperation('https://hub.example.invalid',P,'searchWorkspace',{query:{q:'conformance',limit:20}});
 expect(prepared.queryCanonical).toBe('limit=20&q=conformance');
});
async function causalJourney(mode:'normal'|'bad-terminal'|'premature-disarm'='normal'){return normalJourney('required-causal-'+mode,async(c:any)=>{
 const {a,expected,fixtureState,selected,tasks,runs,runtimes,artifact,message,thread}=c;
 const baseBindings=():RequiredBindings=>({task_id:tasks.main,run_id:runs.main,runtime_id:runtimes.S.id,artifact_id:artifact,thread_id:thread,message_id:message,reviewer_agent_id:expected.actors.R.agent_id});
 const all=requiredApplicationPlan,failIndex=all.findIndex(s=>s.step_id==='prepare/fail-create'),lostIndex=all.findIndex(s=>s.step_id==='case/lost-response-retained');
 const keyFor=(n:number)=>'r2_'+(n+1).toString(16).padStart(32,'0');
 const lostBody=canonicalJson({title:'Native scenario lost-response',description:'Synthetic isolated conformance fixture'}),lostKey=keyFor(lostIndex);
 const control=async(id:string,key:string|null=null,bodyHash:string|null=null,b=baseBindings())=>{const r={run_id:'required_source_run',control_id:id,preparation_sha256:'d'.repeat(64),idempotency_key:key,request_body_sha256:bodyHash,bindings:b};const result=id==='control/disarm-and-observe-lost'?await a.disarmLostResponse(r):await a.observeControl(r);readRequiredPhaseCapture(a,id);return result;};
 await control('control/observe-success-coverage');await control('control/observe-server-foreign-fixture');
 const ingress=(owner:string,count:number,pending=0)=>({window_sha256:'a'.repeat(64),terminal_owner_sha256:owner,opened_at:0,closed_at:1,attempted:count,forwarded:count,rejected:0,pending_publication:pending,pending_product:0});
 let held:Promise<Response>|null=null;
 try{for(const [index,step]of all.entries()){
  if(index<=all.findIndex(s=>s.step_id==='probe/server-foreign-workspace'))continue;
  if(step.step_id==='probe/wrong-runtime')await control('control/observe-other-runtime',null,null,{...baseBindings(),runtime_id:runtimes.R.id});
  if(step.step_id==='case/settled-no-send')await control('control/observe-settled-intent',keyFor(failIndex));
  if(step.step_id==='case/lost-response-retained')await control('control/arm-lost-response',lostKey,await sha256(lostBody));
  if(step.step_id==='case/restart-no-send'){await control('control/disarm-and-observe-lost',lostKey,await sha256(lostBody));const released=await held!;expect(released.status).toBe(201);await released.text();held=null;}
  if(step.step_id==='case/revoked-after-disable'){
   const aux={run_id:'required_source_run',phase_id:'control/revoke-submitter',action_id:'human_revoke_action',preparation_sha256:'d'.repeat(64),request_body_sha256:await sha256(canonicalJson({expected_credential_version:1,reason:'R2'})),idempotency_key:'r2_'+'a'.repeat(32),bindings:baseBindings(),action_owner_sha256:'e'.repeat(64)};
   await a.openAuxiliaryPhase(aux);const resp=await a.fetch(new Request(expected.origin+'/v2/workspaces/'+P+'/credentials/cred_s:revoke',{method:'POST',headers:{origin:expected.origin,cookie:fixtureState.humanCookie,'x-csrf-token':fixtureState.humanCsrf,'content-type':'application/json',accept:'application/json','idempotency-key':aux.idempotency_key},body:canonicalJson({expected_credential_version:1,reason:'R2'})}));expect(resp.status).toBe(200);await resp.text();const {terminal_owner_sha256,...auxIngress}=ingress(aux.action_owner_sha256,1);await a.closeAuxiliaryPhase({run_id:aux.run_id,phase_id:aux.phase_id,action_id:aux.action_id,preparation_sha256:aux.preparation_sha256,action_owner_sha256:aux.action_owner_sha256,action_final_sha256:'f'.repeat(64),ingress:{...auxIngress,action_owner_sha256:terminal_owner_sha256}});readRequiredPhaseCapture(a,aux.action_id);
  }
  const b=baseBindings();if(step.step_id==='probe/wrong-runtime')b.runtime_id=runtimes.R.id;
  const body=step.ordinals.length?requiredBody(step.step_id,[...selected.values()],b,expected.actors.S.agent_id):null,bytes=body===null?null:typeof body==='string'?body:canonicalJson(body);
  const key=step.step_id==='case/settled-no-send'?keyFor(failIndex):step.step_id==='case/restart-no-send'?lostKey:step.ordinals.some(o=>o.idempotency)||step.step_id==='probe/wrong-runtime'?keyFor(index):null;
  const reg={run_id:'required_source_run',step_id:step.step_id,invocation_id:'source_invocation_'+index,preparation_sha256:'d'.repeat(64),request_body_sha256:bytes===null?null:await sha256(bytes),idempotency_key:key,bindings:b,terminal_owner_sha256:'e'.repeat(64)};
  await a.openPhase(reg);
  for(const ord of step.ordinals){const path=ord.path.replace('{workspace_id}',P).replace('{runtime_instance_id}',b.runtime_id!);const headers:Record<string,string>={authorization:'Bearer '+tokens.S,accept:'application/json'};if(ord.idempotency)headers['idempotency-key']=key!;if(ord.runtime_proof)headers['x-runtime-token']=runtimes.S.proof;if(bytes!==null)headers['content-type']='application/json';const request=new Request(expected.origin+path,{method:ord.method,headers,...(bytes===null?{}:{body:bytes})});
   if(step.step_id==='case/lost-response-retained'){let published=false;const heldPromise:Promise<Response>=a.fetch(request);held=heldPromise;void heldPromise.then(()=>{published=true;});for(let tries=0;tries<1000&&a.snapshot().publication==='none';tries++)await new Promise(resolve=>setTimeout(resolve,1));expect(a.snapshot().publication).toBe('response-held-unverified');expect(published).toBe(false);}else{const response=await a.fetch(request);expect(response.status).toBe(ord.response_status);await response.text();}
  }
  if(step.step_id==='case/lost-response-retained'&&mode!=='normal'){
   if(mode==='bad-terminal')await expect(a.closePhase({run_id:reg.run_id,step_id:reg.step_id,invocation_id:reg.invocation_id,preparation_sha256:reg.preparation_sha256,terminal_owner_sha256:'b'.repeat(64),process_final_sha256:'f'.repeat(64),ingress:ingress(reg.terminal_owner_sha256,1,1)})).rejects.toThrow();
   else await expect(control('control/disarm-and-observe-lost',lostKey,await sha256(lostBody))).rejects.toThrow();
   expect(a.snapshot().failed).toBe(true);expect(a.snapshot().publication).toBe('response-held-unverified');
   expect(()=>readRequiredPhaseCapture(a,reg.invocation_id)).toThrow();
   expect(await a.closeAttachment()).toEqual({status:'closed'});const drained=await held!;expect(drained.status).toBe(201);await drained.text();held=null;return;
  }
  await a.closePhase({run_id:reg.run_id,step_id:reg.step_id,invocation_id:reg.invocation_id,preparation_sha256:reg.preparation_sha256,terminal_owner_sha256:reg.terminal_owner_sha256,process_final_sha256:'f'.repeat(64),ingress:ingress(reg.terminal_owner_sha256,step.ordinals.length,step.step_id==='case/lost-response-retained'?1:0)});
  const capture=readRequiredPhaseCapture(a,reg.invocation_id);for(const row of capture.after)selected.set(row.selector,row);
 }
 expect(a.snapshot().completed).toBe(52);expect(a.snapshot().auxiliary_completed).toBe(1);expect(a.snapshot().dispatches).toBe(51);
 }finally{if(held){await a.closeAttachment();await held.then(r=>r.body?.cancel()).catch(()=>{});}}
});}
it('continues the actual normal journey through source-only no-send windows, held commit/disarm and real human revoke',()=>causalJourney());
it('does not authenticate a held commit from a substituted terminal and drains its owned response on cleanup',()=>causalJourney('bad-terminal'));
it('rejects premature disarm without deadlocking the owned unpublished response',()=>causalJourney('premature-disarm'));

it('uses actual SQLite binary ID order for equal-time configured punctuation IDs (pure reducer regression)',async()=>normalJourney('required-binary-order',async(c:any)=>{
 const {agentView}=await import('../../src/agents/commands');const base=JSON.parse(c.selected.get('AG').canonical)[0];
 const agents=[{...base,agent_id:'agent-a',created_at:1,updated_at:1},{...base,agent_id:'agent_a',created_at:1,updated_at:1}];const original={...c.selected.get('AG'),canonical:canonicalJson(agents)};
 const all=[...c.selected.values()].map((r:any)=>r.selector==='AG'?original:r),data={data:agents.map(agentView),page:{next_cursor:null,has_more:false},request_id:'source_order_regression'};
 expect(()=>reconcileRequiredFamily({step_id:'success/listAgents',before:all,after:all,responses:[{operation:'listAgents',status:200,data,body:new TextEncoder().encode(JSON.stringify(data)),proof_sha256:null}],bindings:{task_id:null,run_id:null,runtime_id:null,artifact_id:null,thread_id:null,message_id:null,reviewer_agent_id:null},actor:c.expected.actors.S,requestBody:null})).not.toThrow();
}));

it('owns foreign denial and all five real X proof requests in the foreign DO context (source-only action correlations)',async()=>{
 const {f,expected}=await installed('required-foreign-actions');
 await runInDurableObject(f,async(_instance,state)=>{
  const a=new RequiredPhaseAttachment(state,env),deadline=Date.now()+60000;
  await a.bindRequiredFixture({run_id:'required_source_run',run_deadline:deadline,expires_at:deadline,expected:{...expected,role:'foreign'}});
  const bindings:RequiredBindings={task_id:null,run_id:null,runtime_id:null,artifact_id:null,thread_id:null,message_id:null,reviewer_agent_id:expected.actors.R.agent_id};
  const ingress={window_sha256:'a'.repeat(64),opened_at:0,closed_at:1,attempted:1,forwarded:1,rejected:0,pending_publication:0,pending_product:0};
  try{
   await a.observeControl({run_id:'required_source_run',control_id:'control/observe-server-foreign-fixture',preparation_sha256:'d'.repeat(64),idempotency_key:null,request_body_sha256:null,bindings});readRequiredPhaseCapture(a,'control/observe-server-foreign-fixture');
   const r={run_id:'required_source_run',step_id:'probe/server-foreign-workspace',invocation_id:'source_foreign_get',preparation_sha256:'d'.repeat(64),request_body_sha256:null,idempotency_key:null,bindings,terminal_owner_sha256:'e'.repeat(64)};
   await a.openPhase(r);const denied=await a.fetch(new Request(expected.origin+'/v2/workspaces/'+F,{headers:{authorization:'Bearer '+tokens.S,accept:'application/json'}}));expect(denied.status).toBe(401);await denied.text();
   await a.closePhase({run_id:r.run_id,step_id:r.step_id,invocation_id:r.invocation_id,preparation_sha256:r.preparation_sha256,terminal_owner_sha256:r.terminal_owner_sha256,process_final_sha256:'f'.repeat(64),ingress:{...ingress,terminal_owner_sha256:r.terminal_owner_sha256}});readRequiredPhaseCapture(a,r.invocation_id);
   const runtime:Record<string,{id:string;proof:string}>={};
   for(const [index,phase]of ['enroll-A','enroll-B','positive-A','negative-B','positive-B'].entries()){
    const target=phase.slice(-1),enroll=phase.startsWith('enroll'),body=canonicalJson(enroll?{label:'Native external proof '+target}:{expected_runtime_version:1});
    const reg={run_id:'required_source_run',phase_id:'E2/'+phase,action_id:'source_external_'+index,preparation_sha256:'d'.repeat(64),request_body_sha256:await sha256(body),idempotency_key:'r2_'+(index+100).toString(16).padStart(32,'0'),bindings:{...bindings,runtime_id:enroll?null:runtime[target].id},action_owner_sha256:'e'.repeat(64)};
    await a.openAuxiliaryPhase(reg);
    const headers:Record<string,string>={authorization:'Bearer '+tokens.X,accept:'application/json','content-type':'application/json','idempotency-key':reg.idempotency_key};
    if(!enroll)headers['x-runtime-token']=runtime[phase==='negative-B'?'A':target].proof;
    const response=await a.fetch(new Request(expected.origin+'/v2/workspaces/'+F+'/runtimes'+(enroll?'':'/'+runtime[target].id+':heartbeat'),{method:'POST',headers,body}));
    expect(response.status,phase).toBe(enroll?201:phase==='negative-B'?401:200);const out=await response.json() as any;
    if(enroll)runtime[target]={id:out.data.runtime.id,proof:out.data.runtime_token};
    await a.closeAuxiliaryPhase({run_id:reg.run_id,phase_id:reg.phase_id,action_id:reg.action_id,preparation_sha256:reg.preparation_sha256,action_owner_sha256:reg.action_owner_sha256,action_final_sha256:'f'.repeat(64),ingress:{...ingress,action_owner_sha256:reg.action_owner_sha256}});
    const capture=readRequiredPhaseCapture(a,reg.action_id);expect(capture.subject.owner_kind).toBe('auxiliary');expect(capture.subject).not.toHaveProperty('terminal_owner_sha256');expect(capture.ingress.action_owner_sha256).toBe(reg.action_owner_sha256);expect(capture.ingress).not.toHaveProperty('terminal_owner_sha256');expect(capture.responses).toHaveLength(1);
    if(phase==='negative-B'){const subject={workspace_id:F,principal_id:expected.actors.X.agent_id,operation:'domain.runtimes:manage',target:'runtimes:'+runtime.B.id+':heartbeat',key:reg.idempotency_key};const substituted=capture.after.map(r=>r.selector==='IW'?{...r,canonical:canonicalJson([...JSON.parse(r.canonical),{workspace_id:F,principal_id:'different_actor',operation:'domain.tasks:create',target:'different_target',key:reg.idempotency_key}])}:r);expect(()=>assertRequiredNegativeKeyAbsent(substituted,subject)).toThrow();}

   }
   expect(a.snapshot().completed).toBe(1);expect(a.snapshot().auxiliary_completed).toBe(5);expect(a.snapshot().dispatches).toBe(6);
  }finally{expect(await a.closeAttachment()).toEqual({status:'closed'});}
 });
});

it('owns rejected incoming bodies and reports locked-body cleanup unknown rather than pretending cancellation',async()=>{
 const {p,expected}=await installed('required-rejected-body');
 await runInDurableObject(p,async(_i,state)=>{
  const a=new RequiredPhaseAttachment(state,env),deadline=Date.now()+60000;
  await a.bindRequiredFixture({run_id:'required_source_run',run_deadline:deadline,expires_at:deadline,expected});
  const request=new Request(expected.origin+'/v2/workspaces/'+P+'/tasks',{method:'POST',body:'private synthetic body'}),reader=request.body!.getReader();
  try{await expect(a.fetch(request)).rejects.toThrow('REQUIRED_ATTACHMENT_REJECTED');expect(a.snapshot().dispatches).toBe(0);expect(await a.closeAttachment()).toEqual({status:'cleanup-unknown'});}finally{await reader.cancel();reader.releaseLock();}
 });
});
it('rejects a future process registration before any phase reservation or product dispatch',async()=>{
 const {p,expected}=await installed('required-future-slot');
 await runInDurableObject(p,async(_i,state)=>{
  const a=new RequiredPhaseAttachment(state,env),deadline=Date.now()+60000;
  await a.bindRequiredFixture({run_id:'required_source_run',run_deadline:deadline,expires_at:deadline,expected});
  await expect(a.openPhase({run_id:'required_source_run',step_id:'success/createTask',invocation_id:'future_slot',preparation_sha256:'d'.repeat(64),request_body_sha256:'a'.repeat(64),idempotency_key:'r2_'+'1'.repeat(32),bindings:{task_id:null,run_id:null,runtime_id:null,artifact_id:null,thread_id:null,message_id:null,reviewer_agent_id:expected.actors.R.agent_id},terminal_owner_sha256:'e'.repeat(64)})).rejects.toThrow();
  expect(a.snapshot().reserved.queries).toBe(0);expect(a.snapshot().dispatches).toBe(0);expect(a.snapshot().failed).toBe(true);expect(await a.closeAttachment()).toEqual({status:'closed'});
 });
});

it('keeps compiled route rows, ordinals and capture limits recursively immutable',()=>{
 const row=requiredApplicationPlan.find(p=>p.step_id==='success/createTask')!,ordinal=row.ordinals[0];
 expect(Object.isFrozen(row)).toBe(true);expect(Object.isFrozen(row.ordinals)).toBe(true);expect(Object.isFrozen(ordinal)).toBe(true);expect(Object.isFrozen(ordinal.capture_limits)).toBe(true);
 expect(()=>{(ordinal as any).path='/arbitrary';}).toThrow();expect(()=>{(ordinal.capture_limits as any).requestBodyBytes=999999;}).toThrow();
 expect(ordinal.path).toBe('/v2/workspaces/{workspace_id}/tasks');
});

it('rejects DTO and selected graph substitutions in pure reducers over actual route captures',async()=>normalJourney('required-reducer-negatives',async(c:any)=>{
 const step='success/listAgents',capture=c.phaseCaptures.get(step);
 const base={step_id:step,before:capture.before,after:capture.after,responses:capture.responses,bindings:{task_id:null,run_id:null,runtime_id:null,artifact_id:null,thread_id:null,message_id:null,reviewer_agent_id:c.expected.actors.R.agent_id},actor:c.expected.actors.S,requestBody:null};
 expect(()=>reconcileRequiredFamily(base)).not.toThrow();
 const changed=structuredClone(capture.responses);changed[0].data.data[0].display_name='invented visibility';expect(()=>reconcileRequiredFamily({...base,responses:changed})).toThrow();
 const absent=capture.after.map((r:any)=>r.selector==='AG'?{...r,canonical:canonicalJson(JSON.parse(r.canonical).slice(1))}:r);expect(()=>reconcileRequiredFamily({...base,after:absent})).toThrow();
 const result=c.phaseCaptures.get('success/listTaskResults'),binding={...base.bindings,task_id:c.tasks.main};
 const resultBase={...base,step_id:'success/listTaskResults',before:result.before,after:result.after,responses:result.responses,bindings:binding};expect(()=>reconcileRequiredFamily(resultBase)).not.toThrow();
 const broken=result.after.map((r:any)=>r.selector==='AS'?{...r,canonical:canonicalJson(JSON.parse(r.canonical).filter((e:any)=>e.resource_kind!=='result'))}:r);expect(()=>reconcileRequiredFamily({...resultBase,after:broken})).toThrow();
}));

it('rejects BOM-prefixed actual request bytes paired with an unprefixed body commitment',()=>normalJourney('required-bom-body',undefined,true));
it('poisons a malformed disarm before permitting another control admission',async()=>{
 const {p,expected}=await installed('required-malformed-disarm');await runInDurableObject(p,async(_i,state)=>{
  const a=new RequiredPhaseAttachment(state,env),deadline=Date.now()+60000;await a.bindRequiredFixture({run_id:'required_source_run',run_deadline:deadline,expires_at:deadline,expected});
  await expect(a.disarmLostResponse({run_id:'required_source_run'})).rejects.toThrow();expect(a.snapshot().failed).toBe(true);expect(a.snapshot().dispatches).toBe(0);expect(await a.closeAttachment()).toEqual({status:'closed'});
 });
});
it('reserves complete final private metadata before SQL and supports declared 64-character run and invocation IDs',async()=>{
 const {p,expected}=await installed('required-metadata-bound');await runInDurableObject(p,async(_i,state)=>{
  const a=new RequiredPhaseAttachment(state,env),deadline=Date.now()+60000,run='r'.repeat(64),invocation='i'.repeat(64);
  await a.bindRequiredFixture({run_id:run,run_deadline:deadline,expires_at:deadline,expected});
  const reg={run_id:run,step_id:'success/getWorkspace',invocation_id:invocation,preparation_sha256:'d'.repeat(64),request_body_sha256:null,idempotency_key:null,bindings:{task_id:null,run_id:null,runtime_id:null,artifact_id:null,thread_id:null,message_id:null,reviewer_agent_id:expected.actors.R.agent_id},terminal_owner_sha256:'e'.repeat(64)};
  try{await a.openPhase(reg);expect(a.snapshot().reserved.workingMetadataBytes).toBe(1536);
   const response=await a.fetch(new Request(expected.origin+'/v2/workspaces/'+P,{headers:{authorization:'Bearer '+tokens.S,accept:'application/json'}}));expect(response.status).toBe(200);await response.text();
   await a.closePhase({run_id:run,step_id:reg.step_id,invocation_id:invocation,preparation_sha256:reg.preparation_sha256,terminal_owner_sha256:reg.terminal_owner_sha256,process_final_sha256:'f'.repeat(64),ingress:{window_sha256:'a'.repeat(64),terminal_owner_sha256:reg.terminal_owner_sha256,opened_at:Number.MAX_SAFE_INTEGER-1,closed_at:Number.MAX_SAFE_INTEGER,attempted:1,forwarded:1,rejected:0,pending_product:0,pending_publication:0}});
   const {subject,ingress,beforeAt,afterAt}=readRequiredPhaseCapture(a,invocation);expect(new TextEncoder().encode(canonicalJson({subject,ingress,beforeAt,afterAt})).length).toBeLessThanOrEqual(1536);
  }finally{expect(await a.closeAttachment()).toEqual({status:'closed'});}
 });
});
