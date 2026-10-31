import currentIdentity from '../../workers/native-fixture/selected-state-schema17-profile.json';
import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {login,request as authRequest} from '../helpers/auth';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import manifest from '../../scripts/lib/native-complete-fixture.json';
import selectorData from '../../workers/native-fixture/complete-selectors.json';
import {createCurrentCompleteSelectedState as createCompleteSelectedState,decodeCompleteRows} from '../../workers/native-fixture/selected-state';
import {admitCompleteFixture as admitSchema16Fixture,admitCurrentCompleteFixture as admitCompleteFixture,readCurrentFixtureAdmissionCapture as readFixtureAdmissionCapture} from '../../workers/native-fixture/fixture-admission';
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
 const hashes=await Promise.all(['A','B','C'].map(v=>sha256(v.repeat(43))));
 raw.bundle.credentials=config.static_credential_refs.map((r,i)=>({workspace_id:r.workspace_id,credential_id:r.credential_id,token_sha256:hashes[i]}));
 const prepP=await prepareBootstrap(config,raw.bundle,P),prepF=await prepareBootstrap(config,raw.bundle,F);
 const p=env.WORKSPACE.getByName(name+'-p'),f=env.WORKSPACE.getByName(name+'-f');
 await p.reconcileConfiguration(operator(),prepP);await f.reconcileConfiguration({...operator(),workspaceId:F},prepF);
 let sessionId='missing_session',tokenHash='0'.repeat(64),csrfHash='1'.repeat(64);
 if(humanLogin){
  const session=await login(p);expect(session.response.status).toBe(302);await session.response.text();
  const response=await p.fetch(authRequest('session','GET',undefined,session.cookie));expect(response.status).toBe(200);
  const data=await response.json() as {data:{csrf_token:string}};tokenHash=await sha256(session.cookie.slice('cfhub_session='.length));csrfHash=await sha256(data.data.csrf_token);
  sessionId=await runInDurableObject(p,(_i,state)=>state.storage.sql.exec<{id:string}>('SELECT id FROM sessions').one().id);
 }
 const generation=async(stub:typeof p)=>runInDurableObject(stub,(_i,state)=>state.storage.sql.exec<{generation:number}>('SELECT generation FROM maintenance_state').one().generation);
 const expected={role:'primary' as 'primary'|'foreign',epoch:config.config_epoch,config_sha256:raw.bundle.config_digest,origin:'https://hub.example.invalid',audience:config.authentication.audience,
  workspaces:{primary:{id:P,object_name:name+'-p',installation_sha256:prepP.installationDigest,generation:await generation(p)},foreign:{id:F,object_name:name+'-f',installation_sha256:prepF.installationDigest,generation:await generation(f)}},
  actors:{S:{agent_id:'agent_research',credential_id:'cred_s',token_sha256:hashes[0]},R:{agent_id:'agent_reviewer',credential_id:'cred_r',token_sha256:hashes[1]},X:{agent_id:'agent_foreign',credential_id:'cred_x',token_sha256:hashes[2]}},
  human:{principal_id:config.human_grants[0].principal_id,issuer:config.authentication.issuer,subject:config.human_grants[0].subject,session_id:sessionId,token_sha256:tokenHash,csrf_sha256:csrfHash}};
 return {p,f,expected};
}
it('admits genuine initial P/F source snapshots after real local login, without authenticating future requests',async()=>{
 const {p,f,expected}=await installed('fixture-admission-valid');
 for(const [role,stub]of [['primary',p],['foreign',f]] as const)await runInDurableObject(stub,async(_i,state)=>{
  const result=await admitCompleteFixture(state.storage,{...expected,role});
  expect(result.scope).toBe('source-fixture-baseline');expect(result.installedAuthority).toBe(false);expect(result.human_authentication).toBe('not-performed');
  expect(result.captureStartedAt).toBeLessThanOrEqual(result.captureEndedAt);expect(result.captureEndedAt).toBeLessThanOrEqual(result.validatedAt);
  const capture=readFixtureAdmissionCapture(result);expect(capture.originals).toHaveLength(31);expect(()=>readFixtureAdmissionCapture(result)).toThrow();
  const commitments=await Promise.all(capture.originals.map(async r=>({selector:r.selector,sha256:await sha256(r.canonical),byte_size:r.byteSize})));
  expect(result.selectedStateSha256).toBe(await sha256(canonicalJson({profile:currentIdentity.profile,catalog_sha256:currentIdentity.catalog_sha256,commitments})));
  expect(result.selectedStateSha256).not.toBe(await sha256(canonicalJson(commitments)));
  await expect(admitSchema16Fixture(state.storage,{...expected,role})).rejects.toThrow();
  expect(JSON.stringify(result)).not.toContain('token_sha256');expect(JSON.stringify(result)).not.toContain('config_json');
 });
});
it('requires actual existing primary human session rather than expected identity claims',async()=>{
 const {p,expected}=await installed('fixture-admission-missing-session',undefined,false);
 await runInDurableObject(p,async(_i,state)=>{await expect(admitCompleteFixture(state.storage,expected)).rejects.toThrow();});
});
it('rejects authentic installed extra native scopes even when config digest matches',async()=>{
 const {p,expected}=await installed('fixture-admission-extra-scope',config=>{config.static_credential_refs[0].scopes.push('tasks:review');});
 await runInDurableObject(p,async(_i,state)=>{await expect(admitCompleteFixture(state.storage,expected)).rejects.toThrow();});
});
it('rejects a genuine later runtime effect instead of pretending the fixture is still fresh',async()=>{
 const {p,expected}=await installed('fixture-admission-used');
 const response=await p.fetch(new Request('https://hub.example.invalid/v2/workspaces/'+P+'/runtimes',{method:'POST',headers:{authorization:'Bearer '+'A'.repeat(43),'content-type':'application/json','idempotency-key':'r2_'+'f'.repeat(32)},body:JSON.stringify({label:'Actual subsequent runtime'})}));
 expect(response.status).toBe(201);await response.text();
 await runInDurableObject(p,async(_i,state)=>{await expect(admitCompleteFixture(state.storage,expected)).rejects.toThrow();});
});
it('rejects every independently mismatched expected identity, fence and secret-state commitment',async()=>{
 const {p,expected}=await installed('fixture-admission-bindings');
 const variants:((v:typeof expected)=>void)[]=[v=>{v.epoch++;},v=>{v.config_sha256='f'.repeat(64);},v=>{v.workspaces.primary.installation_sha256='f'.repeat(64);},v=>{v.workspaces.primary.generation++;},v=>{v.workspaces.primary.object_name='another-object';},v=>{v.actors.S.token_sha256='f'.repeat(64);},v=>{v.actors.R.credential_id='another-credential';},v=>{v.human.token_sha256='f'.repeat(64);},v=>{v.human.csrf_sha256='f'.repeat(64);},v=>{v.human.session_id='another-session';},v=>{v.role='foreign';}];
 await runInDurableObject(p,async(_i,state)=>{await admitCompleteFixture(state.storage,structuredClone(expected));for(const mutate of variants){const v=structuredClone(expected);mutate(v);await expect(admitCompleteFixture(state.storage,v)).rejects.toThrow('COMPLETE_FIXTURE_ADMISSION_REJECTED');}});
});
it('rejects authentic initial delegation and role-label drift, not merely config digest mismatches',async()=>{
 for(const [name,modify] of [
  ['delegation',(config:Awaited<ReturnType<typeof fixture>>['config'])=>{Object.assign(config.human_grants[0],{delegable_native_scopes:['workspace:read']});}],
  ['label',(config:Awaited<ReturnType<typeof fixture>>['config'])=>{config.static_participants[1].display_name='Different reviewer';}],
 ] as const){
  const {p,expected}=await installed('fixture-admission-drift-'+name,modify);
  await runInDurableObject(p,async(_i,state)=>{await expect(admitCompleteFixture(state.storage,expected)).rejects.toThrow();});
 }
});
it('snapshots expected scalar bindings before the crypto await and keeps private captures unforgeable',async()=>{
 const {p,expected}=await installed('fixture-admission-snapshot');
 await runInDurableObject(p,async(_i,state)=>{
  const supplied=structuredClone(expected);expect(Object.getPrototypeOf(supplied)).toBe(Object.prototype);const pending=admitCompleteFixture(state.storage,supplied);
  supplied.human.csrf_sha256='f'.repeat(64);supplied.workspaces.primary.generation++;
  const result=await pending;expect(Object.isFrozen(result)).toBe(true);expect(result.maintenanceGeneration).toBe(expected.workspaces.primary.generation);
  expect(()=>readFixtureAdmissionCapture({...result})).toThrow();
  const capture=readFixtureAdmissionCapture(result);expect(Object.isFrozen(capture)).toBe(true);expect(Object.isFrozen(capture.originals)).toBe(true);
 });
});
it('rejects extra keys, unsafe origins and descriptor getters without invoking callbacks',async()=>{
 const {p,expected}=await installed('fixture-admission-closed');
 await runInDurableObject(p,async(_i,state)=>{
  await expect(admitCompleteFixture(state.storage,{...expected,clock:()=>Date.now()})).rejects.toThrow();
  for(const origin of ['https://localhost.','https://127.0.0.1','https://hub.example.invalid/path'])await expect(admitCompleteFixture(state.storage,{...expected,origin})).rejects.toThrow();
  let calls=0;const actor={...expected.actors.S,get token_sha256(){calls++;return expected.actors.S.token_sha256;}};
  await expect(admitCompleteFixture(state.storage,{...expected,actors:{...expected.actors,S:actor}})).rejects.toThrow();expect(calls).toBe(0);
 });
});
it('workspace-wide HG detects an actual second principal installed through normal configuration',async()=>{
 const {p,expected}=await installed('fixture-admission-extra-human',config=>{config.human_grants.push({...config.human_grants[0],principal_id:'human_other',subject:'other-subject'});});
 await runInDurableObject(p,(_i,state)=>{
  const d=selectorData.catalog.HG;const values:Record<string,string>={W:P,human:expected.human.principal_id};
  const rows=state.storage.sql.exec(d.sql,...d.parameters.map(k=>values[k])).toArray();
  expect(()=>decodeCompleteRows('HG',rows)).toThrow();
 });
});
it('workspace-wide HG observes a different foreign principal rather than claiming no grants',async()=>{
 const {f,expected}=await installed('fixture-admission-foreign-human',config=>{config.human_grants.push({...config.human_grants[0],workspace_id:F,principal_id:'human_foreign',subject:'foreign-subject'});});
 await runInDurableObject(f,(_i,state)=>{
  const a=expected.actors.X,reader=createCompleteSelectedState(state.storage,{W:F,C:a.credential_id,human:expected.human.principal_id,principal:a.agent_id,operation:'domain.tasks:create',target:'tasks:create',key:'r2_'+'0'.repeat(32)});
  const rows=reader.readPhase({stepId:'control/provision',phase:'foreign'}).originals.find(r=>r.selector==='HG')!;
  expect(JSON.parse(rows.canonical)).toHaveLength(1);expect(rows.canonical).toContain('human_foreign');
 });
});

it('keeps the source fixture recipe immutable across importing modules',()=>{
 expect(Object.isFrozen(manifest)).toBe(true);const scopes=manifest.configuration_constraints.native_scopes.S;expect(Object.isFrozen(scopes)).toBe(true);
 const before=[...scopes];expect(()=>scopes.push('workspace:write')).toThrow();expect(scopes).toEqual(before);
});
it('observes actual route-created prefixed runtime/task outcomes and their event/history joins',async()=>{
 const {p,expected}=await installed('fixture-real-domain-tuples');
 const requests=[
  {step:'prepare/submitter-enrollment',path:'runtimes',operation:'domain.runtimes:manage',target:'runtimes:create',body:{label:'Native scenario submitter'},key:'r2_'+'3'.repeat(32)},
  {step:'success/createTask',path:'tasks',operation:'domain.tasks:create',target:'tasks:create',body:{title:'Native scenario main',description:'Synthetic isolated conformance fixture'},key:'r2_'+'4'.repeat(32)}
 ];
 for(const r of requests){
  const response=await p.fetch(new Request('https://hub.example.invalid/v2/workspaces/'+P+'/'+r.path,{method:'POST',headers:{authorization:'Bearer '+'A'.repeat(43),'content-type':'application/json','idempotency-key':r.key},body:JSON.stringify(r.body)}));
  expect(response.status).toBe(201);await response.json();
 }
 await runInDurableObject(p,(_i,state)=>{
  for(const r of requests){
   const reader=createCompleteSelectedState(state.storage,{W:P,C:'cred_s',human:expected.human.principal_id,principal:'agent_research',operation:r.operation,target:r.target,key:r.key});
   const capture=reader.readPhase({stepId:r.step,phase:'after'});
   const rows=(selector:string)=>JSON.parse(capture.originals.find(x=>x.selector===selector)!.canonical);
   const outcome=rows('I');expect(outcome).toHaveLength(1);expect(outcome[0].operation).toBe(r.operation);expect(outcome[0].target).toBe(r.target);
   const events=rows('EK');expect(events).toHaveLength(1);expect(events[0].id).toBe(outcome[0].event_id);
   if(r.path==='tasks'){const history=rows('HK');expect(history).toHaveLength(1);expect(history[0].event_id).toBe(events[0].id);}
   reader.close();
  }
  const r=requests[0],reader=createCompleteSelectedState(state.storage,{W:P,C:'cred_s',human:expected.human.principal_id,principal:'agent_research',operation:r.operation,target:r.target,key:r.key});
  const capture=reader.readPhase({stepId:'control/provision',phase:'primary'});
  expect(JSON.parse(capture.originals.find(x=>x.selector==='IW')!.canonical)).toHaveLength(2);
  expect(capture.originals.filter(x=>x.selector==='I')).toHaveLength(2);reader.close();
 });
});
