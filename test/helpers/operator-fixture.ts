import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {randomBytes,createHmac,createHash} from 'node:crypto';
import example from '../../examples/config/deployment.example.json';
import {canonicalJson,prepareBootstrap,sha256} from '../../src/config/bootstrap';
import type {OperatorPolicy} from '../../src/recovery/operator';
export async function operatorFixture(){
 const key=await generateKeyPair('RS256',{extractable:true}),wrong=await generateKeyPair('RS256',{extractable:true});
 const jwk={...await exportJWK(key.publicKey),kid:'operator-fixture-key',alg:'RS256',use:'sig'};
 const integrity=randomBytes(32).toString('base64');
 const policy:OperatorPolicy={environment_id:'fixture',origin:'https://operator.example.invalid',access_issuer:'https://access.example.invalid',access_audience:'fixture-operator-audience',bundle_key_id:'fixture_key',workspace_catalog:[{workspace_id:'ws_example',object_name:'operator-fixture-workspace'},{workspace_id:'ws_second',object_name:'operator-fixture-second'}],services:[{client_id:'fixture-client.access',principal_id:'operator_fixture',environment_id:'fixture',workspace_ids:['ws_example','ws_second'],operations:['install']}]};
 policy.workspace_catalog.push(...Array.from({length:32},(_,i)=>({workspace_id:'ws_gateway_'+i,object_name:'operator-fixture-ws_gateway_'+i})));
 policy.services[0].workspace_ids=policy.workspace_catalog.map(x=>x.workspace_id);
 policy.services.push(
  {client_id:'wrong-environment.access',principal_id:'operator_foreign',environment_id:'foreign',workspace_ids:['ws_example','ws_second',...policy.services[0].workspace_ids],operations:['install']},
  {client_id:'wrong-workspace.access',principal_id:'operator_other',environment_id:'fixture',workspace_ids:['ws_second'],operations:['install']},
  {client_id:'no-install.access',principal_id:'operator_readonly',environment_id:'fixture',workspace_ids:policy.services[0].workspace_ids,operations:[]}
 );
 // No duplicate workspace IDs in the closed policy.
 policy.services[1].workspace_ids=[...policy.services[0].workspace_ids];
 const recoveryIntegrity=randomBytes(32).toString('base64'),recoveryWorkspace='ws_recovery_transport';
 policy.workspace_catalog.push({workspace_id:recoveryWorkspace,object_name:'operator-fixture-'+recoveryWorkspace},{workspace_id:'ws_transport_capture',object_name:'operator-fixture-ws_transport_capture'});
 policy.services[0].workspace_ids=policy.workspace_catalog.map(x=>x.workspace_id);
 policy.services[0].operations=['install','capture','read-chunk','restore','write-chunk','verify','probe','resolve-delivery','retire','resume','status'];
 policy.services.push({client_id:'install-only.access',principal_id:'operator_installer',environment_id:'fixture',workspace_ids:[...policy.services[0].workspace_ids],operations:['install']});
 const sign=(value:any,key:string)=>{const {tag,...auth}=value.auth;value.auth.tag=createHmac('sha256',Buffer.from(key,'base64')).update(canonicalJson({...value,auth})).digest('hex');};
 const targetConfig=JSON.parse(JSON.stringify(example).replaceAll('ws_example',recoveryWorkspace)) as typeof example;targetConfig.config_epoch=2;targetConfig.workspace_catalog[0].object_name='operator-fixture-'+recoveryWorkspace;targetConfig.static_credential_refs[0].expires_at=new Date(Date.now()+30*86400000).toISOString();targetConfig.static_credential_refs[0].enabled=false;
 const targetBundle={contract_revision:'0.1',config_epoch:2,config_digest:await sha256(canonicalJson(targetConfig)),credentials:[{workspace_id:recoveryWorkspace,credential_id:'credential_research_1',token_sha256:await sha256('A'.repeat(43))}],retired_credentials:[],auth:{key_id:'fixture_key',algorithm:'HMAC-SHA256',tag:''}};sign(targetBundle,integrity);
 const targetInput=await prepareBootstrap(targetConfig,targetBundle,recoveryWorkspace),ledger={workspace_id:recoveryWorkspace,environment_id:'fixture',authority_epoch:2,config:targetInput.config,verification_bundle:targetInput.bundle,installation_digest:targetInput.installationDigest,retired_authorities:[],auth:{key_id:'recovery_fixture',algorithm:'HMAC-SHA256',tag:''}};sign(ledger,recoveryIntegrity);
 policy.recovery={integrity_key_id:'recovery_fixture',current_ledgers:[{workspace_id:recoveryWorkspace,authority_epoch:2,sha256:createHash('sha256').update(canonicalJson(ledger)).digest('hex')}]};
 const sourceConfig=structuredClone(targetConfig);sourceConfig.config_epoch=1;sourceConfig.workspace_catalog[0].object_name='recovery-source-workspace';sourceConfig.static_credential_refs[0].enabled=true;
 const sourceBundle=structuredClone(targetBundle);sourceBundle.config_epoch=1;sourceBundle.config_digest=await sha256(canonicalJson(sourceConfig));sign(sourceBundle,integrity);
 const workspaceBindings={RECOVERY_ENVIRONMENT_ID:'fixture',RECOVERY_INTEGRITY_KEY_ID:'recovery_fixture',RECOVERY_INTEGRITY_KEY:recoveryIntegrity,RECOVERY_RELEASE:JSON.stringify({revision:'synthetic_transport',worker_version:'synthetic_transport',binding_ids:['workspace_fixture','recovery_fixture']})};
 let mode='normal';
 const handler=async(request:Request):Promise<Response>=>{
  const url=new URL(request.url);
  if(url.href==='https://operator-fixture.example.invalid/control'&&request.method==='POST'){mode=await request.text();return new Response('ok');}
  if(url.href==='https://access.example.invalid/cdn-cgi/access/certs'&&request.method==='GET'){
   if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://foreign.example.invalid/keys'}});
   if(mode==='oversize')return new Response(' '.repeat(270000));
   if(mode==='unavailable')return new Response(null,{status:503});
   return Response.json({keys:[jwk]});
  }
  if(url.href==='https://operator-fixture.example.invalid/assertion'&&request.method==='POST'){
   const input=await request.json() as Record<string,unknown>,now=Math.floor(Date.now()/1000);
   const payload={iss:policy.access_issuer,aud:[policy.access_audience],exp:now+300,iat:now,sub:'',type:'app',common_name:'fixture-client.access',...input.claims as object};
   if(input.algorithm==='HS256')return new Response(await new SignJWT(payload).setProtectedHeader({alg:'HS256'}).sign(randomBytes(32)));
   const jwt=await new SignJWT(payload).setProtectedHeader({alg:'RS256',kid:'operator-fixture-key'}).sign(input.forged?wrong.privateKey:key.privateKey);
   return new Response(jwt);
  }
  return new Response('Fixture URL denied',{status:403});
 };
 return {policy,bindings:{OPERATOR_POLICY:JSON.stringify(policy),BOOTSTRAP_INTEGRITY_KEY:integrity,RECOVERY_TRANSPORT_LEDGER:JSON.stringify(ledger),RECOVERY_TRANSPORT_SOURCE_CONFIG:JSON.stringify(sourceConfig),RECOVERY_TRANSPORT_SOURCE_BUNDLE:JSON.stringify(sourceBundle)},workspaceBindings,sourceBindings:{...workspaceBindings,RECOVERY_ENVIRONMENT_ID:'fixture_source'},handler};
}
