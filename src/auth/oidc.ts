import { jwtVerify,createRemoteJWKSet,customFetch } from 'jose';
import type { DeploymentConfig } from '../config/deployment';
import { AuthError } from './context';
type Authentication=DeploymentConfig['authentication'];
/** Fixed approved HTTPS requests, no redirects, bounded streamed body and time. */
export async function providerJson(url:string,init:RequestInit={}):Promise<Response> {
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try {
  const response=await fetch(url,{...init,redirect:'manual',signal:controller.signal});
  if(response.status!==200)throw Error('PROVIDER_STATUS');
  const reader=response.body?.getReader();if(!reader)throw Error('PROVIDER_BODY');
  let size=0;const chunks:Uint8Array[]=[];
  try {for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>262144)throw Error('PROVIDER_SIZE');chunks.push(part.value);}}finally{await reader.cancel();}
  const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
  return new Response(joined,{headers:{'content-type':'application/json'}});
 } catch {throw new AuthError('AUTH_UNAVAILABLE',503);} finally {clearTimeout(timer);}
}
function supports(value:unknown,item:string,optional=false):boolean {return optional&&value===undefined||Array.isArray(value)&&value.every(x=>typeof x==='string')&&value.includes(item);}
export async function discover(auth:Authentication):Promise<void> {
 const url=auth.issuer.replace(/\/$/,'')+'/.well-known/openid-configuration';
 let metadata:Record<string,unknown>;
 try {metadata=await (await providerJson(url)).json() as Record<string,unknown>;}catch{throw new AuthError('AUTH_UNAVAILABLE',503);}
 if(!metadata||metadata.issuer!==auth.issuer||Object.entries(auth.reviewed_oidc_endpoints).some(([key,value])=>metadata[key]!==value)||
  !supports(metadata.response_types_supported,'code')||!supports(metadata.response_modes_supported,'query',true)||
  !supports(metadata.id_token_signing_alg_values_supported,'RS256')||!supports(metadata.subject_types_supported,'public')&&!supports(metadata.subject_types_supported,'pairwise')||
  !supports(metadata.token_endpoint_auth_methods_supported,'client_secret_basic',true)||!supports(metadata.code_challenge_methods_supported,'S256')||!supports(metadata.grant_types_supported,'authorization_code',true))throw new AuthError('AUTH_UNAVAILABLE',503);
}
function formEncode(value:string):string {return new URLSearchParams({x:value}).toString().slice(2);}
export interface LoginAttempt {id:string;workspace_id:string;state_digest:string;nonce:string;pkce_verifier:string;cookie_digest:string;redirect_uri:string;created_at:number;expires_at:number;consumed_at:number|null;auth_epoch:number;return_path:string;}
export async function verifyCode(auth:Authentication,clientSecret:string,attempt:LoginAttempt,code:string,now:()=>number):Promise<{issuer:string;subject:string;expiresAt:number}> {
 try {
  await discover(auth);
  const response=await providerJson(auth.reviewed_oidc_endpoints.token_endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',authorization:'Basic '+btoa(formEncode(auth.client_id)+':'+formEncode(clientSecret))},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:attempt.redirect_uri,code_verifier:attempt.pkce_verifier}).toString()});
  const tokens=await response.json() as {id_token?:unknown};if(typeof tokens.id_token!=='string'||tokens.id_token.length>65536)throw Error('ID_TOKEN');
  // Per-proof resolver: no stale-key fallback, bounded unknown-key refresh, pinned transport only.
  const jwks=createRemoteJWKSet(new URL(auth.reviewed_oidc_endpoints.jwks_uri),{cooldownDuration:0,[customFetch]:async(url,options)=>{
   if(String(url)!==auth.reviewed_oidc_endpoints.jwks_uri)throw Error('KEY_URL');return providerJson(String(url),{method:'GET',headers:options.headers});
  }});
  const instant=now(),{payload}=await jwtVerify(tokens.id_token,jwks,{algorithms:auth.id_token_algorithms,issuer:auth.issuer,audience:auth.client_id,requiredClaims:['iss','sub','aud','exp','iat','nonce'],currentDate:new Date(instant),clockTolerance:0});
  const seconds=now()/1000,aud=typeof payload.aud==='string'?[payload.aud]:payload.aud;
  if(payload.iss!==auth.issuer||typeof payload.sub!=='string'||payload.sub.length===0||payload.sub.length>2048||!aud?.length||aud.some(x=>x!==auth.client_id)||
   aud.length>1&&payload.azp!==auth.client_id||payload.azp!==undefined&&payload.azp!==auth.client_id||payload.nonce!==attempt.nonce||
   typeof payload.exp!=='number'||!Number.isFinite(payload.exp)||typeof payload.iat!=='number'||!Number.isFinite(payload.iat)||payload.iat>seconds||payload.iat<Math.floor(attempt.created_at/1000)||payload.exp<=seconds||payload.exp<=payload.iat||
   payload.nbf!==undefined&&(typeof payload.nbf!=='number'||!Number.isFinite(payload.nbf)||payload.nbf>seconds))throw Error('CLAIMS');
  return {issuer:payload.iss,subject:payload.sub,expiresAt:payload.exp*1000};
 }catch {throw new AuthError('UNAUTHENTICATED',401);}
}
