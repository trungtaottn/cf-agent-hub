import {it,expect,beforeEach,afterEach} from 'vitest';
import {env,exports} from 'cloudflare:workers';
import example from '../../examples/config/deployment.example.json';
import {canonicalJson,sha256} from '../../src/config/bootstrap';
let fixtureIndex=0,workspace='ws_gateway_0';
beforeEach(()=>{workspace='ws_gateway_'+fixtureIndex++;});
afterEach(async()=>{await fetch('https://operator-fixture.example.invalid/control',{method:'POST',body:'normal'});});
const fixtureEnv=env as unknown as {BOOTSTRAP_INTEGRITY_KEY:string};
async function assertion(claims:Record<string,unknown>={},forged=false){return (await fetch('https://operator-fixture.example.invalid/assertion',{method:'POST',body:JSON.stringify({claims,forged})})).text();}
async function material(epoch:number){
 const config=JSON.parse(JSON.stringify(example).replaceAll('ws_example',workspace)) as typeof example;config.config_epoch=epoch;config.workspace_catalog[0].object_name='operator-fixture-'+workspace;
 config.static_credential_refs[0].expires_at=new Date(Date.now()+30*86400000).toISOString();
 const bundle={contract_revision:'0.1',config_epoch:epoch,config_digest:await sha256(canonicalJson(config)),credentials:[{workspace_id:workspace,credential_id:'credential_research_1',token_sha256:await sha256('A'.repeat(43))}],retired_credentials:[],auth:{key_id:'fixture_key',algorithm:'HMAC-SHA256',tag:''}};
 await sign(bundle);return {config,verification_bundle:bundle};
}
async function sign(bundle:any){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(fixtureEnv.BOOTSTRAP_INTEGRITY_KEY),x=>x.charCodeAt(0)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const {tag:_,...auth}=bundle.auth;
 bundle.auth.tag=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(canonicalJson({...bundle,auth})))),x=>x.toString(16).padStart(2,'0')).join('');
}
async function call(body:unknown,jwt?:string,extra:Record<string,string>={}){
 const headers={'content-type':'application/json',...extra,...(jwt?{'cf-access-jwt-assertion':jwt}:{})};
 return exports.default.fetch(new Request('https://operator.example.invalid/operator/recovery',{method:'POST',headers,body:JSON.stringify(body)}));
}
const envelope=(payload:Awaited<ReturnType<typeof material>>,operation_id:string,expected_authority_epoch:number)=>({operation:'install',workspace_id:workspace,capture_id:null,expected_authority_epoch,operation_id,reason:'Synthetic lifecycle verification',payload});
async function initial(){const response=await call(envelope(await material(3),'baseline',0),await assertion());expect(response.status).toBe(200);await response.text();}
it('empty_sub_signed_service_common_name_allowed',async()=>{
 const body=envelope(await material(3),'initial',0),response=await call(body,await assertion());
 expect(response.status).toBe(200);
 const receipt=await response.json() as any;
 expect(receipt.data.epoch).toBe(3);
 const canonical=(x:any):string=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
 const {config,verification_bundle:b}=body.payload;
 const expected=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical({config,credentials:b.credentials,retired_credentials:[]})))),x=>x.toString(16).padStart(2,'0')).join('');
 expect(receipt.data.installation_digest===expected).toBe(true);expect(receipt.data.operator_principal_id).toBe('operator_fixture');
});
it('human_jwt_or_unsigned_common_name_denied',async()=>{
 const body=envelope(await material(4),'denied-human',3);
 for(const jwt of [undefined,await assertion({sub:'human_subject',email:'operator@example.invalid'}),await assertion({common_name:'unknown-client.access'}),await assertion({},true)])
  expect((await call(body,jwt,{'cf-access-client-id':'fixture-client.access','x-operator':'operator_fixture'})).status).toBe(401);
});
it('install_discriminant_requires_service_authority_and_matches_target_epoch',async()=>{
 const payload=await material(4),jwt=await assertion();
 for(const mutation of [{operation:'capture'},{workspace_id:'ws_second'},{capture_id:'not_null'},{operator_principal_id:'forged'}]){
  const response=await call({...envelope(payload,'bad-envelope',3),...mutation},jwt);expect(response.status>=400).toBe(true);
 }
 const altered=structuredClone(payload);altered.config.config_epoch=5;
 expect((await call(envelope(altered,'bad-binding',3),jwt)).status>=400).toBe(true);
});
it('forged_or_missing_bundle_hmac_rejected_before_install',async()=>{
 const payload=await material(4),jwt=await assertion();
 payload.verification_bundle.auth.tag='0'.repeat(64);
 expect((await call(envelope(payload,'forged-bundle',3),jwt)).status).toBe(401);
 delete (payload.verification_bundle as any).auth;
 expect((await call(envelope(payload,'missing-bundle',3),jwt)).status>=400).toBe(true);
});
it('identical_install_replay_reauthorizes_before_stale_cas',async()=>{
 await initial();
 const payload=await material(4),body=envelope(payload,'replay',3),jwt=await assertion();
 const first=await call(body,jwt);expect(first.status).toBe(200);const receipt=await first.json() as any;
 const second=await call(body,jwt);expect(second.status).toBe(200);const repeated=await second.json() as any;
 expect(JSON.stringify(receipt.data)===JSON.stringify(repeated.data)).toBe(true);
 expect(receipt.request_id===repeated.request_id).toBe(false);
 expect((await call(body,await assertion({common_name:'revoked-client.access'}))).status).toBe(401);
 const changed=await call({...body,reason:'Changed request'},jwt);expect(changed.status).toBe(409);
 const newOperation=await call({...body,operation_id:'nonadvancing',expected_authority_epoch:4},jwt);expect(newOperation.status).toBe(409);
});
it('stale_install_cas_denied_and_install_skipped_epoch_advances_monotonically',async()=>{
 await initial();
 const payload=await material(9),jwt=await assertion();
 expect((await call(envelope(payload,'stale',2),jwt)).status).toBe(409);
 const response=await call(envelope(payload,'skip',3),jwt);expect(response.status).toBe(200);expect((await response.json() as any).data.epoch).toBe(9);
});
it('existing_id_hash_change_denied',async()=>{
 await initial();
 const payload=await material(10);payload.verification_bundle.credentials[0].token_sha256='f'.repeat(64);await sign(payload.verification_bundle);
 expect((await call(envelope(payload,'changed-hash',3),await assertion())).status).toBe(409);
 expect((await call(envelope(await material(10),'unchanged-after-denial',3),await assertion())).status).toBe(200);
});
it('wrong_issuer_audience_algorithm_and_expiry_denied',async()=>{
 const body=envelope(await material(10),'claims-denied',9);
 for(const claims of [{iss:'https://foreign.example.invalid'},{aud:['foreign']},{exp:0},{iat:Math.floor(Date.now()/1000)+1000},{type:'service'},{sub:null},{common_name:null}]){
  expect((await call(body,await assertion(claims))).status).toBe(401);
 }
});

it('configured_operation_environment_workspace_allowlists_are_required',async()=>{
 const body=envelope(await material(3),'allowlists',0);
 for(const common_name of ['wrong-environment.access','wrong-workspace.access','no-install.access'])
  expect((await call(body,await assertion({common_name}))).status).toBe(401);
 expect((await call({...body,workspace_id:'unknown_workspace'},await assertion())).status).toBe(401);
});
it('operator_jwks_unavailable_redirected_oversize_and_wrong_algorithm_fail_closed',async()=>{
 const body=envelope(await material(3),'keys',0),jwt=await assertion();
 for(const mode of ['redirect','oversize','unavailable']){
  await fetch('https://operator-fixture.example.invalid/control',{method:'POST',body:mode});
  expect((await call(body,jwt)).status).toBe(401);
 }
 await fetch('https://operator-fixture.example.invalid/control',{method:'POST',body:'normal'});
 const wrong=await (await fetch('https://operator-fixture.example.invalid/assertion',{method:'POST',body:JSON.stringify({algorithm:'HS256'})})).text();
 expect((await call(body,wrong)).status).toBe(401);
 expect((await call(body,jwt)).status).toBe(200);
});
it('public_do_fetch_cannot_dispatch_operator_rpc_and_request_envelope_is_bounded',async()=>{
 const body=envelope(await material(3),'closed-ingress',0);
 const target=env.WORKSPACE.getByName('operator-fixture-'+workspace);
 for(const method of ['installOperation','reconcileConfiguration','authoritySnapshot']){
  const response=await target.fetch(new Request('https://hub.example.invalid/'+method,{method:'POST',headers:{'cf-access-jwt-assertion':await assertion(),'content-type':'application/json'},body:JSON.stringify(body)}));
  expect(response.status).toBe(404);
 }
 expect((await call({...body,expected_installation_digest:'0'.repeat(64)},await assertion())).status).toBe(400);
 expect((await call({...body,reason:'x'.repeat(66000)},await assertion())).status).toBe(413);
 expect((await call(body,await assertion(),{authorization:'Bearer '+ 'A'.repeat(43)})).status).toBe(401);
});
