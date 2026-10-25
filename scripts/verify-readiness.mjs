import {request as httpsRequest} from 'node:https';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readProtectedJson,readProtectedFdJson,descriptor} from './lib/protected-io.mjs';
import {approvedHttpsUrl} from '../src/config/deployment.ts';
import {readinessFromResponse} from '../src/health/promotion.ts';
import {validateWorkspaceResponse,validateOperationsResponse} from '../src/http/generated/auth-validators.js';
const slug=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const closed=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const positive=value=>Number.isSafeInteger(value)&&value>0;
export function parseReadinessConfig(value){
 const keys=['origin','environment_id','workspace_id','expected_actor_id','expected_config_epoch','expected_schema_version','credential_fd'];
 if(!closed(value,keys)||typeof value.origin!=='string'||!approvedHttpsUrl(value.origin+'/')||new URL(value.origin).origin!==value.origin||!['environment_id','workspace_id','expected_actor_id'].every(key=>slug(value[key]))||!positive(value.expected_config_epoch)||!positive(value.expected_schema_version)||typeof value.credential_fd!=='string')throw Error('READINESS_INPUT_INVALID');
 descriptor(value.credential_fd);return value;
}
export function readinessCredentials(value){
 const basic=closed(value,['session_cookie']),access=closed(value,['session_cookie','access_client_id','access_client_secret']);
 if(!(basic||access)||typeof value.session_cookie!=='string'||!/^cfhub_session=[A-Za-z0-9_-]{43}$/.test(value.session_cookie))throw Error('READINESS_CREDENTIAL_INVALID');
 if(access&&['access_client_id','access_client_secret'].some(key=>typeof value[key]!=='string'||!value[key].length||value[key].length>4096||/[\r\n]/.test(value[key])))throw Error('READINESS_CREDENTIAL_INVALID');
 return value;
}
/** HTTPS only, exact target, no redirects, fixed deadline and bounded response.
 * Credentials are never accepted as flags or copied into returned evidence. */
export async function requestJson(url,credentials){
 return new Promise((resolveResult,reject)=>{
  const headers={accept:'application/json',cookie:credentials.session_cookie};
  if(credentials.access_client_id){headers['CF-Access-Client-Id']=credentials.access_client_id;headers['CF-Access-Client-Secret']=credentials.access_client_secret;}
  const request=httpsRequest(url,{method:'GET',headers,agent:false},response=>{
   const chunks=[];let length=0;
   response.on('data',chunk=>{length+=chunk.length;if(length>65536){response.destroy(Error('READINESS_RESPONSE_LIMIT'));return;}chunks.push(chunk);});
   response.on('error',()=>reject(Error('READINESS_TRANSPORT_FAILED')));
   response.on('end',()=>{
    if(response.statusCode!==200){reject(Error('READINESS_HTTP_STATUS'));return;}
    if(!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type']??'')){reject(Error('READINESS_RESPONSE_INVALID'));return;}
    try{const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));resolveResult({status:response.statusCode,value:JSON.parse(text)});}catch{reject(Error('READINESS_RESPONSE_INVALID'));}
   });
  });
  const timeout=setTimeout(()=>request.destroy(Error('READINESS_TIMEOUT')),5000);
  request.on('close',()=>clearTimeout(timeout));request.on('error',()=>reject(Error('READINESS_TRANSPORT_FAILED')));request.end();
 });
}
export async function verifyReadiness(rawConfig,rawCredentials,transport=requestJson,clock=Date.now){
 const config=parseReadinessConfig(rawConfig),credentials=readinessCredentials(rawCredentials);
 const root=config.origin+'/v2/workspaces/'+config.workspace_id;
 const workspace=await transport(new URL(root),credentials);
 if(workspace.status!==200||!validateWorkspaceResponse(workspace.value)||workspace.value.data.id!==config.workspace_id||workspace.value.data.actor.kind!=='human'||workspace.value.data.actor.principal_id!==config.expected_actor_id||!workspace.value.data.effective_scopes.includes('operations:read'))throw Error('READINESS_IDENTITY_MISMATCH');
 const health=await transport(new URL(root+'/readiness'),credentials);
 readinessFromResponse(health.status,health.value,clock());
 // The final operations response atomically binds the probe report to the
 // current schema/authority epoch. A separate health request cannot do that.
 const operations=await transport(new URL(root+'/operations'),credentials);
 if(operations.status!==200||!validateOperationsResponse(operations.value)||operations.value.data.config_epoch!==config.expected_config_epoch||operations.value.data.schema_version!==config.expected_schema_version)throw Error('READINESS_AUTHORITY_MISMATCH');
 const readiness=readinessFromResponse(operations.status,{request_id:operations.value.request_id,data:operations.value.data.readiness},clock());
 const requestIds=[workspace.value.request_id,health.value.request_id,operations.value.request_id];
 if(!requestIds.every(slug))throw Error('READINESS_RESPONSE_INVALID');
 return {assurance:'authenticated-readiness-only',environment_id:config.environment_id,workspace_id:config.workspace_id,actor_id:config.expected_actor_id,config_epoch:operations.value.data.config_epoch,schema_version:operations.value.data.schema_version,ready:true,observed_at:readiness.observed_at,request_ids:requestIds};
}
export async function runCli(argv=process.argv.slice(2)){
 try{
  if(argv.length!==2||argv[0]!=='--input')throw Error('READINESS_INPUT_INVALID');
  const config=parseReadinessConfig(readProtectedJson(argv[1],65536));
  const result=await verifyReadiness(config,readProtectedFdJson(descriptor(config.credential_fd)));
  process.stdout.write(JSON.stringify(result)+'\n');return 0;
 }catch(error){
  const code=error instanceof Error&&/^READINESS_[A-Z_]+$/.test(error.message)?error.message:'READINESS_CHECK_FAILED';
  process.stdout.write(JSON.stringify({ready:false,code})+'\n');return 1;
 }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runCli();
