import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {login,request as authRequest} from '../helpers/auth';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import manifest from '../../scripts/lib/native-complete-fixture.json';
import {NativeFixtureAttachment,readAttachmentCapture,assertFreshTaskProjection} from '../../workers/native-fixture/attachment';
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

const steps=[
 {id:'prepare/submitter-enrollment',actor:'S' as const,path:'runtimes',body:{label:'Native scenario submitter'}},
 {id:'prepare/reviewer-enrollment',actor:'R' as const,path:'runtimes',body:{label:'Native scenario reviewer'}},
 {id:'success/createTask',actor:'S' as const,path:'tasks',body:{title:'Native scenario main',description:'Synthetic isolated conformance fixture'}}
];
async function registration(index:number){return {run_id:'run_source_fixture',step_id:steps[index].id,invocation_id:'invocation_'+index,preparation_sha256:'d'.repeat(64),idempotency_key:'r2_'+String(index+1).repeat(32),request_body_sha256:await sha256(JSON.stringify(steps[index].body))};}
function product(index:number,key:string,overrides:Record<string,string>={}){const s=steps[index];return new Request('https://hub.example.invalid/v2/workspaces/'+P+'/'+s.path,{method:'POST',headers:{authorization:'Bearer '+tokens[s.actor],'content-type':'application/json','idempotency-key':key,...overrides},body:JSON.stringify(s.body)});}
it('runs genuine S/R enrollment then task through normal source fetch with private before/after captures',async()=>{
 const {p,expected}=await installed('attachment-three-real');
 await runInDurableObject(p,async(_i,state)=>{
  const attachment=new NativeFixtureAttachment(state,env);
  const deadline=Date.now()+60000;await attachment.bindFixture({run_id:'run_source_fixture',run_deadline:deadline,expires_at:deadline,expected});
  const ids:string[]=[];
  for(let i=0;i<3;i++){
   const r=await registration(i),originalPreparation=r.preparation_sha256;attachment.registerProductSlot(r);r.preparation_sha256='e'.repeat(64);
   const response=await attachment.fetch(product(i,r.idempotency_key));expect(response.status).toBe(201);
   const dto=await response.json() as {data:{id?:string;runtime?:{id:string};runtime_token?:string}};ids.push((dto.data.runtime?.id??dto.data.id)!);
   const capture=readAttachmentCapture(attachment,r.invocation_id);expect(capture.subject).toEqual({run_id:r.run_id,step_id:r.step_id,invocation_id:r.invocation_id,preparation_sha256:originalPreparation,request_body_sha256:r.request_body_sha256,idempotency_key_sha256:await sha256(r.idempotency_key)});expect(Object.isFrozen(capture.subject)).toBe(true);expect(new TextEncoder().encode(canonicalJson(capture.subject)).length).toBeLessThanOrEqual(1024);expect(()=>Object.assign(capture.subject,{invocation_id:'changed'})).toThrow();
   expect(capture.before.length).toBe(i===2?11:7);expect(capture.after.length).toBe(i===2?11:7);
   if(i===2){const task=JSON.parse(capture.after.find(x=>x.selector==='T')!.canonical)[0];assertFreshTaskProjection(dto.data,task);for(const [key,value] of [['workspace_id','wrong_workspace'],['title','wrong_title'],['state','ready'],['task_version',2],['created_at','2000-01-01T00:00:00.000Z']])expect(()=>assertFreshTaskProjection({...dto.data,[String(key)]:value},task)).toThrow();}
   expect(capture.requestBody).toEqual(new TextEncoder().encode(JSON.stringify(steps[i].body)));
   expect(()=>readAttachmentCapture(attachment,r.invocation_id)).toThrow();
  }
  expect(new Set(ids).size).toBe(3);expect(attachment.snapshot().reserved.metadataBytes).toBe(3072);expect(attachment.snapshot()).toMatchObject({completed:3,dispatches:3,failed:false,scope:'source-fixture-attachment',installedAuthority:false});
  expect(JSON.stringify(attachment.snapshot())).not.toContain(tokens.S);expect(await attachment.closeAttachment()).toMatchObject({status:'closed'});
 });
});
async function bound(p:Awaited<ReturnType<typeof installed>>['p'],expected:Awaited<ReturnType<typeof installed>>['expected'],run:(a:NativeFixtureAttachment)=>Promise<void>){await runInDurableObject(p,async(_i,state)=>{const a=new NativeFixtureAttachment(state,env),deadline=Date.now()+60000;await a.bindFixture({run_id:'run_source_fixture',run_deadline:deadline,expires_at:deadline,expected});try{await run(a);}finally{await a.closeAttachment();}});}
it('rejects wrong role, object identity and expired/oversized run windows before effects',async()=>{
 const {p,expected}=await installed('attachment-bind-negative');
 await runInDurableObject(p,async(_i,state)=>{
  const now=Date.now();for(const change of [{expected:{...expected,role:'foreign'}},{expected:{...expected,workspaces:{...expected.workspaces,primary:{...expected.workspaces.primary,object_name:'wrong_object'}}}},{run_deadline:now-1,expires_at:now-1},{run_deadline:now+400000,expires_at:now+400000}]){
   const a=new NativeFixtureAttachment(state,env);await expect(a.bindFixture({run_id:'run_source_fixture',run_deadline:now+60000,expires_at:now+60000,expected,...change})).rejects.toThrow();expect(a.snapshot()).toMatchObject({dispatches:0,failed:true});await a.closeAttachment();
  }
 });
});
it('registration is closed, source ordered, unique and poison-on-duplicate',async()=>{
 const {p,expected}=await installed('attachment-registration-negative');
 for(const mode of ['future','wrongrun','extra','duplicate'])await bound(p,expected,async a=>{
  const r=await registration(0);const bad=mode==='future'?{...r,step_id:steps[1].id}:mode==='wrongrun'?{...r,run_id:'other'}:mode==='extra'?{...r,actor:{kind:'agent'}}:r;
  if(mode==='duplicate')a.registerProductSlot(r);expect(()=>a.registerProductSlot(bad)).toThrow();expect(a.snapshot()).toMatchObject({failed:true,dispatches:0});
 });
});
it('rejects actual route/key/body/credential substitutions without product effects',async()=>{
 const {p,expected}=await installed('attachment-request-negative');
 for(const mode of ['query','key','actor','body'])await bound(p,expected,async a=>{
  const r=await registration(0);a.registerProductSlot(r);let request=product(0,mode==='key'?'r2_'+'9'.repeat(32):r.idempotency_key,mode==='actor'?{authorization:'Bearer '+tokens.R}:{});
  if(mode==='query')request=new Request(request.url+'?unexpected=1',request);
  if(mode==='body')request=new Request(request.url,{method:'POST',headers:request.headers,body:'{"label":"Native scenario reviewer"}'});
  await expect(a.fetch(request)).rejects.toThrow();expect(a.snapshot()).toMatchObject({failed:true,dispatches:0});expect(a.snapshot().reserved.queries).toBe(14);
 });
});
it('poisons a concurrent registration and keeps actual unread request ownership through close',async()=>{
 const {p,expected}=await installed('attachment-concurrent');
 await bound(p,expected,async a=>{
  const r=await registration(0);a.registerProductSlot(r);let release!:()=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const body=new ReadableStream<Uint8Array>({async pull(controller){entered();await gate;controller.enqueue(new TextEncoder().encode(JSON.stringify(steps[0].body)));controller.close();}});
  const request=new Request(product(0,r.idempotency_key).url,{method:'POST',headers:product(0,r.idempotency_key).headers,body});
  const pending=a.fetch(request);await started;expect(()=>a.registerProductSlot(r)).toThrow();expect(a.snapshot()).toMatchObject({failed:true,active:true,dispatches:0});release();await expect(pending).rejects.toThrow();
 });
});
it('does not claim closed when an unowned locked request cannot be cleaned up',async()=>{
 const {p,expected}=await installed('attachment-locked-request');
 await bound(p,expected,async a=>{
  const r=await registration(0);a.registerProductSlot(r);const request=product(0,r.idempotency_key);const owner=request.body!.getReader();
  try{await expect(a.fetch(request)).rejects.toThrow();expect(await a.closeAttachment()).toMatchObject({status:'cleanup-unknown'});}
  finally{await owner.cancel();owner.releaseLock();}
 });
});
it('owns cancellation of a request rejected after close rather than silently abandoning it',async()=>{
 const {p,expected}=await installed('attachment-closed-request');
 await bound(p,expected,async a=>{
  await a.closeAttachment();let cancelled=0;const request=new Request('https://hub.example.invalid/v2/workspaces/'+P+'/runtimes',{method:'POST',body:new ReadableStream<Uint8Array>({cancel(){cancelled++;}})});
  await expect(a.fetch(request)).rejects.toThrow();expect(cancelled).toBe(1);
 });
});
it('rejects zero-progress stream chunks and owns their cancellation',async()=>{
 const {p,expected}=await installed('attachment-zero-progress');
 await bound(p,expected,async a=>{
  const r=await registration(0);a.registerProductSlot(r);let count=0,cancelled=0;
  const body=new ReadableStream<Uint8Array>({pull(controller){if(count++===0)controller.enqueue(new Uint8Array());else if(count===2)controller.enqueue(new TextEncoder().encode(JSON.stringify(steps[0].body)));else controller.close();},cancel(){cancelled++;}});
  const base=product(0,r.idempotency_key);await expect(a.fetch(new Request(base.url,{method:'POST',headers:base.headers,body}))).rejects.toThrow();expect(a.snapshot().dispatches).toBe(0);expect(cancelled).toBe(1);
 });
});
it('does not release a prior successful private capture after later owner poison',async()=>{
 const {p,expected}=await installed('attachment-capture-poison');
 await bound(p,expected,async a=>{
  const r=await registration(0);a.registerProductSlot(r);const response=await a.fetch(product(0,r.idempotency_key));expect(response.status).toBe(201);await response.text();
  expect(()=>a.registerProductSlot(r)).toThrow();expect(()=>readAttachmentCapture(a,r.invocation_id)).toThrow();
 });
});

it('bounds expected snapshot cumulatively before touching a later source-fake sentinel',async()=>{
 const {p,expected}=await installed('attachment-snapshot-budget');
 await runInDurableObject(p,async(_i,state)=>{
  let touched=0;const sentinel=new Proxy({}, {getPrototypeOf(){touched++;return Object.prototype;}});
  const tree=(depth:number):unknown=>depth?Object.fromEntries(Array.from({length:8},(_,i)=>['branch'+i,tree(depth-1)])):'x'.repeat(128);
  const a=new NativeFixtureAttachment(state,env),deadline=Date.now()+60000;
  await expect(a.bindFixture({run_id:'run_source_fixture',run_deadline:deadline,expires_at:deadline,expected:{oversized:tree(3),...expected,sentinel}})).rejects.toThrow();
  expect(touched).toBe(0);expect(a.snapshot()).toMatchObject({failed:true,dispatches:0});await a.closeAttachment();
 });
});
