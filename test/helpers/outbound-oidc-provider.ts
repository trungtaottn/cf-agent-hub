// Node-side synthetic issuer. Only the Vitest outbound service imports this module.
import {NotificationReceiver} from './notification-receiver';
import { randomBytes, createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import example from '../../examples/config/deployment.example.json';
export async function outboundProvider() {
 const secret=randomBytes(32).toString('base64url')+' :+/%',csrf=randomBytes(32).toString('base64url');
 const pair=await generateKeyPair('RS256'),rotated=await generateKeyPair('RS256'),rogue=await generateKeyPair('RS256');
 const jwk={...await exportJWK(pair.publicKey),kid:'original',alg:'RS256',use:'sig'};
 const second={...await exportJWK(rotated.publicKey),kid:'rotated',alg:'RS256',use:'sig'};
 const issuer=example.authentication.issuer;
 const metadata={issuer,...example.authentication.reviewed_oidc_endpoints,response_types_supported:['code'],response_modes_supported:['query'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['client_secret_basic']};
 const notificationKey='SYNTHETIC-ONLY-outbound-receiver-key-0123456789';
 const notificationReceiver=new NotificationReceiver(':memory:',{workspaceId:'ws_example',recipientAgentId:'agent_research',key:notificationKey,nowSeconds:()=>Math.floor(Date.now()/1000)});
 const notificationRequests:{body:string;headers:Record<string,string>}[]=[];
 const codes=new Map<string,{url:URL;mode:string;now:number}>();let behavior='normal',jwksMode='normal',jwksRequests=0,requests:string[]=[];
 let release:(()=>void)|undefined;let waiting=false;
 const json=(value:unknown,status=200)=>Response.json(value,{status});
 const handler=async(request:Request):Promise<Response>=>{
  const url=new URL(request.url);
  if(url.origin==='https://receiver.example.invalid'&&url.pathname==='/cfhub'){
   const body=await request.text();notificationRequests.push({body,headers:Object.fromEntries(request.headers)});
   return notificationReceiver.receive(new Request(request.url,{method:request.method,headers:request.headers,body}));
  }
  if(url.origin==='https://fixture-control.example.invalid') {
   if(url.pathname==='/notification-evidence')return json({requests:notificationRequests,ledger:notificationReceiver.evidence()});
   if(url.pathname==='/reset'){behavior='normal';jwksMode='normal';requests=[];release?.();release=undefined;waiting=false;return json({ok:true});}
   if(url.pathname==='/mode'){behavior=await request.text();return json({ok:true});}
   if(url.pathname==='/requests')return json({requests,waiting});
   if(url.pathname==='/release'){release?.();return json({ok:true});}
   if(url.pathname==='/issue') {const data=await request.json() as {authorization_url:string;mode?:string;now:number};const code=randomBytes(24).toString('base64url');codes.set(code,{url:new URL(data.authorization_url),mode:data.mode??'normal',now:data.now});return json({code});}
   return json({},404);
  }
  if(url.origin!==issuer)return json({error:'denied'},599);
  requests.push(url.pathname);
  if(url.pathname==='/.well-known/openid-configuration') {
   if(behavior==='discovery-redirect')return new Response(null,{status:302,headers:{location:'https://untrusted.example.invalid/discovery'}});
   if(behavior==='discovery-oversize')return new Response(' '.repeat(270000));
   if(behavior==='discovery-down')return json({},503);
   if(behavior==='hold-discovery'){waiting=true;await new Promise<void>(resolve=>{release=resolve;});waiting=false;}
   return json({...metadata,...(behavior==='pin-mismatch'?{token_endpoint:'https://untrusted.example.invalid/token'}:{}),...(behavior==='issuer-mismatch'?{issuer:issuer+'/other'}:{}),...(behavior==='unsupported-auth'?{token_endpoint_auth_methods_supported:['none']}:{}),...(behavior==='unsupported-mode'?{response_modes_supported:['form_post']}:{}),...(behavior==='default-basic'?{token_endpoint_auth_methods_supported:undefined}:{})});
  }
  if(url.pathname==='/jwks') {
   jwksRequests++;if(jwksMode==='unknown_refresh_failed'&&jwksRequests>1)return json({},503);
   if(jwksMode==='jwks-down')return json({},503);
   if(jwksMode==='jwks-redirect')return new Response(null,{status:302,headers:{location:'https://untrusted.example.invalid/jwks'}});
   if(jwksMode==='jwks-oversize')return new Response(' '.repeat(270000));
   return json({keys:jwksMode==='rotation'?[second]:[jwk]});
  }
  if(url.pathname==='/token'&&request.method==='POST') {
   if(behavior==='token-redirect')return new Response(null,{status:302,headers:{location:'https://untrusted.example.invalid/token'}});
   const form=new URLSearchParams(await request.text()),code=form.get('code')??'',entry=codes.get(code);codes.delete(code);
   const basic='Basic '+Buffer.from('cfhub-client:'+new URLSearchParams({x:secret}).toString().slice(2)).toString('base64');
   if(!entry||request.headers.get('authorization')!==basic||form.get('grant_type')!=='authorization_code'||form.get('redirect_uri')!==entry.url.searchParams.get('redirect_uri')||createHash('sha256').update(form.get('code_verifier')??'').digest('base64url')!==entry.url.searchParams.get('code_challenge'))return json({error:'invalid_grant'},400);
   if(behavior==='hold-token'){waiting=true;await new Promise<void>(resolve=>{release=resolve;});waiting=false;}
   const mode=entry.mode,now=Math.floor(entry.now/1000);
   const claims:Record<string,unknown>={iss:issuer,sub:'synthetic-subject',aud:'cfhub-client',nonce:entry.url.searchParams.get('nonce'),iat:now,exp:now+600};
   const overrides:Record<string,Record<string,unknown>>={issuer:{iss:issuer+'/wrong'},audience:{aud:'other'},extra_audience:{aud:['cfhub-client','other'],azp:'cfhub-client'},azp:{azp:'other'},nonce:{nonce:'wrong'},subject:{sub:''},ungranted:{sub:'ungranted-subject'},future_iat:{iat:now+1},old_iat:{iat:now-3600},invalid_iat:{iat:'invalid'},expired:{exp:now},equal_exp_iat:{exp:now,iat:now},future_nbf:{nbf:now+1},invalid_nbf:{nbf:'invalid'},short_proof:{exp:now+2}};
   Object.assign(claims,overrides[mode]);if(mode==='missing_iat')delete claims.iat;if(mode==='missing_exp')delete claims.exp;
   jwksMode=mode;jwksRequests=0;
   const header={alg:mode==='wrong_algorithm'?'HS256':'RS256',kid:mode==='rotation'?'rotated':['unknown_key','unknown_refresh_failed'].includes(mode)?'unknown':'original',...(mode==='token_key_url'?{jku:'https://untrusted.example.invalid/jwks',x5u:'https://untrusted.example.invalid/cert'}:{})};
   const token=await new SignJWT(claims).setProtectedHeader(header).sign(mode==='wrong_algorithm'?new TextEncoder().encode(secret):mode==='signature'?rogue.privateKey:mode==='rotation'?rotated.privateKey:pair.privateKey);
   return json({id_token:token,access_token:'fixture-only-unused',token_type:'Bearer',expires_in:86400});
  }
  return json({error:'denied'},599);
 };
 return {bindings:{NOTIFICATION_SIGNING_KEY:notificationKey,DEPLOYMENT_CONFIG:JSON.stringify(example),OIDC_CLIENT_SECRET:secret,CSRF_SECRET:csrf,CURSOR_ENCRYPTION_KEY:randomBytes(32).toString('hex')},handler};
}
