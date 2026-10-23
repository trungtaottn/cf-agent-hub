import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {randomBytes} from 'node:crypto';
export async function operatorFixture(){
 const key=await generateKeyPair('RS256',{extractable:true}),wrong=await generateKeyPair('RS256',{extractable:true});
 const jwk={...await exportJWK(key.publicKey),kid:'operator-fixture-key',alg:'RS256',use:'sig'};
 const integrity=randomBytes(32).toString('base64');
 const policy={environment_id:'fixture',origin:'https://operator.example.invalid',access_issuer:'https://access.example.invalid',access_audience:'fixture-operator-audience',bundle_key_id:'fixture_key',workspace_catalog:[{workspace_id:'ws_example',object_name:'operator-fixture-workspace'},{workspace_id:'ws_second',object_name:'operator-fixture-second'}],services:[{client_id:'fixture-client.access',principal_id:'operator_fixture',environment_id:'fixture',workspace_ids:['ws_example','ws_second'],operations:['install']}]};
 policy.workspace_catalog.push(...Array.from({length:32},(_,i)=>({workspace_id:'ws_gateway_'+i,object_name:'operator-fixture-ws_gateway_'+i})));
 policy.services[0].workspace_ids=policy.workspace_catalog.map(x=>x.workspace_id);
 policy.services.push(
  {client_id:'wrong-environment.access',principal_id:'operator_foreign',environment_id:'foreign',workspace_ids:['ws_example','ws_second',...policy.services[0].workspace_ids],operations:['install']},
  {client_id:'wrong-workspace.access',principal_id:'operator_other',environment_id:'fixture',workspace_ids:['ws_second'],operations:['install']},
  {client_id:'no-install.access',principal_id:'operator_readonly',environment_id:'fixture',workspace_ids:policy.services[0].workspace_ids,operations:[]}
 );
 // No duplicate workspace IDs in the closed policy.
 policy.services[1].workspace_ids=[...policy.services[0].workspace_ids];
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
 return {policy,bindings:{OPERATOR_POLICY:JSON.stringify(policy),BOOTSTRAP_INTEGRITY_KEY:integrity},handler};
}
