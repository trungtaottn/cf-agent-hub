import {constants,openSync,closeSync,readSync,fstatSync,writeSync,fsyncSync,readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {validateLiveness,validateWorkspaceResponse,validateAuthSession,validateOperationsResponse,validateError} from '../src/http/generated/auth-validators.js';
import {readinessFromResponse} from '../src/health/promotion.ts';

export const RESPONSE_LIMIT=262144,EVIDENCE_LIMIT=65536,INPUT_LIMIT=65536,RECEIPT_LIMIT=1048576;
const REQUEST_TIMEOUT_MS=5000;
const workflowNames=['oidc_provider_journey','acknowledged_next_request_revocation','actual_operator_recovery','deployed_bytes_provenance'];
const receiptKinds=['oidc_journey','revocation','operator_recovery','deployment_binding'];
const receiptWorkflow={oidc_journey:'oidc_provider_journey',revocation:'acknowledged_next_request_revocation',operator_recovery:'actual_operator_recovery',deployment_binding:'deployed_bytes_provenance'};
const sha=value=>createHash('sha256').update(value).digest('hex');
const producerSha=sha(readFileSync(fileURLToPath(import.meta.url)));
const contractSha=sha(readFileSync(new URL('../spec/openapi.json',import.meta.url)));
const slug=value=>typeof value==='string'&&/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(value)&&value.length<=128;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const closed=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const inputError=code=>Object.assign(new Error(code),{code});
// The shared validator covers AuthSession data; its canonical envelope is closed.
const validateAuthSessionResponse=value=>closed(value,['data','request_id'])&&typeof value.request_id==='string'&&[...value.request_id].length>=1&&[...value.request_id].length<=128&&validateAuthSession(value.data);
function httpsOrigin(value){
 try{const url=new URL(value);return typeof value==='string'&&url.origin===value&&url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.hostname.includes('.')&&!/^[\d.]+$|:|(^|\.)(localhost|local|internal|metadata|home|lan)$|^metadata\./.test(url.hostname);}catch{return false;}
}
function fd(value){return value===null||Number.isSafeInteger(value)&&value>=3&&value<=1048575;}
/** Closed protected configuration expresses intended target/bindings, never observed success. */
export function parseDeploymentConfig(value){
 if(!closed(value,['format_version','environment_class','environment_id','target','candidate','credentials','external_receipts'])||value.format_version!==1||value.environment_class!=='isolated'||!slug(value.environment_id))throw inputError('INVALID_DEPLOYMENT_CONFIG');
 const t=value.target,c=value.candidate,k=value.credentials;
 if(!closed(t,['origin','workspace_id','object_name','authority_epoch','human_principal_id','native_principal_id','native_agent_id','foreign_origin','alternative_origins'])||!httpsOrigin(t.origin)||!httpsOrigin(t.foreign_origin)||t.origin===t.foreign_origin||![t.workspace_id,t.object_name,t.human_principal_id,t.native_principal_id,t.native_agent_id].every(slug)||!positive(t.authority_epoch)||!Array.isArray(t.alternative_origins)||t.alternative_origins.length>8||t.alternative_origins.some(origin=>!httpsOrigin(origin)||origin===t.origin)||new Set(t.alternative_origins).size!==t.alternative_origins.length)throw inputError('INVALID_DEPLOYMENT_TARGET');
 if(!closed(c,['revision','tree_sha256','bundle_sha256','deployment_id','worker_version','schema_version'])||typeof c.revision!=='string'||!/^[a-f0-9]{40}$/.test(c.revision)||!hash(c.tree_sha256)||!hash(c.bundle_sha256)||![c.deployment_id,c.worker_version].every(id=>typeof id==='string'&&id.length>0&&id.length<=128&&!/[\x00-\x1f\x7f]/.test(id))||!positive(c.schema_version))throw inputError('INVALID_CANDIDATE_BINDING');
 if(!closed(k,['allowed_session_fd','forbidden_session_fd','native_bearer_fd'])||!Object.values(k).every(fd))throw inputError('INVALID_CREDENTIAL_FD');
 if(!Array.isArray(value.external_receipts)||value.external_receipts.length>4||new Set(value.external_receipts.map(x=>x?.kind)).size!==value.external_receipts.length||value.external_receipts.some(x=>!closed(x,['kind','fd','sha256'])||!receiptKinds.includes(x.kind)||!fd(x.fd)||x.fd===null||!hash(x.sha256)))throw inputError('INVALID_RECEIPT_REFERENCE');
 const descriptors=[...Object.values(k),...value.external_receipts.map(x=>x.fd)].filter(x=>x!==null);
 if(new Set(descriptors).size!==descriptors.length)throw inputError('DUPLICATE_INPUT_FD');
 return structuredClone(value);
}
/** FDs must refer to bounded owner-only regular files. No secret is accepted in argv/env. */
export function readProtectedFd(descriptor,limit){
 if(!fd(descriptor)||descriptor===null||!positive(limit))throw inputError('INVALID_INPUT_FD');
 let before;try{before=fstatSync(descriptor);}catch{throw inputError('INPUT_FD_UNAVAILABLE');}
 if(!before.isFile()||before.nlink!==1||typeof process.getuid!=='function'||before.uid!==process.getuid()||(before.mode&0o077)!==0||before.size>limit)throw inputError('INPUT_FILE_NOT_PROTECTED');
 const chunks=[];let total=0;
 for(;;){const buffer=Buffer.alloc(Math.min(4096,limit+1-total));const count=readSync(descriptor,buffer,0,buffer.length,total);if(count===0)break;chunks.push(buffer.subarray(0,count));total+=count;if(total>limit)throw inputError('INPUT_BYTES_LIMIT');}
 const after=fstatSync(descriptor);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino)throw inputError('INPUT_CHANGED');return Buffer.concat(chunks,total);
}
function jsonBytes(bytes){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw inputError('INPUT_JSON_INVALID');}}
function tokenBytes(bytes){const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!/^[A-Za-z0-9_-]{43}\n?$/.test(text))throw inputError('CREDENTIAL_FORMAT_INVALID');return text.endsWith('\n')?text.slice(0,-1):text;}
export function loadProtectedInputs(configFd){
 const config=parseDeploymentConfig(jsonBytes(readProtectedFd(configFd,INPUT_LIMIT)));
 const descriptors=[...Object.values(config.credentials),...config.external_receipts.map(x=>x.fd)];if(descriptors.includes(configFd))throw inputError('DUPLICATE_INPUT_FD');
 const credentials={},receiptBytes=new Map();
 for(const [field,key]of [['allowed_session_fd','allowedSession'],['forbidden_session_fd','forbiddenSession'],['native_bearer_fd','nativeBearer']])if(config.credentials[field]!==null)credentials[key]=tokenBytes(readProtectedFd(config.credentials[field],128));
 for(const entry of config.external_receipts)receiptBytes.set(entry.kind,readProtectedFd(entry.fd,RECEIPT_LIMIT));
 return {config,credentials,receiptBytes};
}
function baseEvidence(now){return {format_version:1,producer:'cf-agent-hub/r1-deployment-verifier',producer_sha256:producerSha,contract_sha256:contractSha,run_id:randomUUID(),observed_at:new Date(now).toISOString(),node_version:process.version,environment_class:'isolated',target_sha256:null,requested_candidate:null,status:'pending',exit_code:2,http_subset:'pending',gates:[],observations:[],receipt_refs:[],missing_inputs:[]};}
function complete(evidence){
 const http=evidence.gates.filter(g=>g.group==='http');evidence.http_subset=http.some(g=>g.status==='fail')?'fail':http.length&&http.every(g=>g.status==='pass')?'pass':'pending';
 evidence.status=evidence.gates.some(g=>g.status==='fail')?'failed':'pending';evidence.exit_code=evidence.status==='failed'?1:2;
 // This observer never attests external IdP/revocation/recovery/deployment workflows.
 if(!workflowNames.every(name=>evidence.gates.some(g=>g.name===name&&g.status==='pending')))throw inputError('WORKFLOW_PROOF_NOT_ESTABLISHED');
 if(Buffer.byteLength(JSON.stringify(evidence))>EVIDENCE_LIMIT)throw inputError('EVIDENCE_BYTES_LIMIT');return evidence;
}
export function blockedEvidence(code='CONFIG_FD_MISSING',now=Date.now()){
 const evidence=baseEvidence(now);evidence.gates.push({name:'protected_inputs',group:'input',status:code==='CONFIG_FD_MISSING'?'pending':'fail',code});
 evidence.missing_inputs.push('protected_config_fd');for(const name of workflowNames)evidence.gates.push({name,group:'workflow',status:'pending',code:'WORKFLOW_INPUT_MISSING'});return complete(evidence);
}
async function boundedResponse(response,signal){
 const reader=response.body?.getReader();if(!reader)return {bytes:Buffer.alloc(0),truncated:false};const chunks=[];let size=0;const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>RESPONSE_LIMIT)return {bytes:null,truncated:true,size};chunks.push(Buffer.from(item.value));}return {bytes:Buffer.concat(chunks,size),truncated:false};}
 finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});}
}
async function observeHttp(label,url,init,expectation,context){
 const controller=new AbortController();let timer;
 const observation={sequence:context.evidence.observations.length,name:label,method:init.method??'GET',url_sha256:sha(url),observed_at:new Date(context.now()).toISOString(),status:null,content_type:'unobserved',byte_size:0,sha256:null,truncated:false,outcome:'fail',code:'NETWORK_UNAVAILABLE'};
 const task=(async()=>{
  const response=await context.fetchImpl(url,{...init,redirect:'manual',signal:controller.signal});if(controller.signal.aborted)throw inputError('HTTP_TIMEOUT');
  observation.status=response.status;observation.content_type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase()==='application/json'?'json':'other';
  if(response.redirected||response.status>=300&&response.status<400||response.url&&response.url!==url){await response.body?.cancel().catch(()=>{});observation.code='REDIRECT_OR_TARGET_MISMATCH';return {value:null};}
  const body=await boundedResponse(response,controller.signal);if(controller.signal.aborted)throw inputError('HTTP_TIMEOUT');observation.truncated=body.truncated;observation.byte_size=body.truncated?RESPONSE_LIMIT+1:body.bytes.length;
  if(body.truncated){observation.code='RESPONSE_BYTES_LIMIT';return {value:null};}observation.sha256=sha(body.bytes);
  if(!expectation.statuses.includes(response.status)){observation.code='HTTP_STATUS_MISMATCH';return {value:null};}
  let value=null;
  if(expectation.validate){
   if(observation.content_type!=='json'){observation.code='RESPONSE_CONTENT_TYPE';return {value:null};}
   try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body.bytes));}catch{observation.code='RESPONSE_JSON_INVALID';return {value:null};}
   try{if(!expectation.validate(value,response.status)){observation.code='RESPONSE_DTO_OR_BINDING';return {value:null};}}catch{observation.code='RESPONSE_DTO_OR_BINDING';return {value:null};}
  }
  observation.outcome='pass';observation.code='OBSERVED_EXPECTED_HTTP';return {value};
 })();
 let value=null;
 try{({value}=await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(inputError('HTTP_TIMEOUT'));},REQUEST_TIMEOUT_MS);})]));}
 catch{controller.abort();observation.outcome='fail';observation.code='NETWORK_UNAVAILABLE';}
 finally{clearTimeout(timer);}
 context.evidence.observations.push(observation);
 context.evidence.gates.push({name:label,group:'http',status:observation.outcome,code:observation.code});return {ok:observation.outcome==='pass',value};
}
const denial=(codes)=>value=>validateError(value)&&codes.includes(value.error.code);
/** Exact finite HTTP observations. Missing external proof always remains pending. */
export async function verifyDeployment(input,credentials={},options={}){
 const config=parseDeploymentConfig(input),now=options.now??Date.now,fetchImpl=options.fetchImpl??fetch,evidence=baseEvidence(now());
 if(!closed(credentials,Object.keys(credentials))||Object.keys(credentials).some(k=>!['allowedSession','forbiddenSession','nativeBearer'].includes(k)))throw inputError('CREDENTIAL_FORMAT_INVALID');
 for(const [key,field]of [['allowedSession','allowed_session_fd'],['forbiddenSession','forbidden_session_fd'],['nativeBearer','native_bearer_fd']])if(credentials[key]!==undefined&&(config.credentials[field]===null||typeof credentials[key]!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(credentials[key])))throw inputError('CREDENTIAL_FORMAT_INVALID');
 const t=config.target,c=config.candidate,root='/v2/workspaces/'+t.workspace_id,context={now,fetchImpl,evidence};
 evidence.target_sha256=sha(JSON.stringify({environment_id:config.environment_id,target:t}));
 evidence.requested_candidate={revision:c.revision,tree_sha256:c.tree_sha256,bundle_sha256:c.bundle_sha256,deployment_id_sha256:sha(c.deployment_id),worker_version_sha256:sha(c.worker_version),schema_version:c.schema_version};
 const pending=(name,code)=>{evidence.gates.push({name,group:'http',status:'pending',code});evidence.missing_inputs.push(name+':'+code);};
 const request=(name,path,init,expectation,origin=t.origin)=>observeHttp(name,origin+path,init,expectation,context);
 const humanHeaders=credentials.allowedSession?{cookie:'cfhub_session='+credentials.allowedSession}:null;
 const nativeHeaders=credentials.nativeBearer?{authorization:'Bearer '+credentials.nativeBearer}:null;
 await request('liveness','/health/live',{}, {statuses:[200],validate:validateLiveness});
 await request('unauthenticated_workspace',root,{}, {statuses:[401],validate:denial(['UNAUTHENTICATED'])});
 const matchesWorkspace=(value,kind)=>validateWorkspaceResponse(value)&&value.data.id===t.workspace_id&&value.data.actor.kind===kind&&value.data.actor.principal_id===(kind==='human'?t.human_principal_id:t.native_principal_id)&&value.data.actor.agent_id===(kind==='human'?null:t.native_agent_id)&&value.data.effective_scopes.includes('workspace:read');
 let session=null;
 if(humanHeaders){
  const result=await request('supplied_human_session',root+'/auth/session',{headers:humanHeaders},{statuses:[200],validate:value=>validateAuthSessionResponse(value)&&value.data.actor.principal_id===t.human_principal_id&&Date.parse(value.data.expires_at)>now()});session=result.ok?result.value.data:null;
  await request('human_workspace',root,{headers:humanHeaders},{statuses:[200],validate:value=>matchesWorkspace(value,'human')});
  await request('human_readiness',root+'/readiness',{headers:humanHeaders},{statuses:[200],validate:(value,status)=>!!readinessFromResponse(status,value,now())});
  await request('human_operations',root+'/operations',{headers:humanHeaders},{statuses:[200],validate:(value,status)=>validateOperationsResponse(value)&&value.data.config_epoch===t.authority_epoch&&value.data.schema_version===c.schema_version&&!!readinessFromResponse(status,{request_id:value.request_id,data:value.data.readiness},now())});
  await request('missing_csrf_denied',root+'/auth/logout',{method:'POST',headers:{...humanHeaders,origin:t.origin,'content-type':'application/json'},body:'{}'},{statuses:[403],validate:denial(['FORBIDDEN'])});
  if(session)await request('foreign_origin_denied',root+'/auth/logout',{method:'POST',headers:{...humanHeaders,origin:t.foreign_origin,'content-type':'application/json','x-csrf-token':session.csrf_token},body:'{}'},{statuses:[403],validate:denial(['FORBIDDEN'])});
  else pending('foreign_origin_denied','VALID_SESSION_INPUT_MISSING');
  await request('session_after_denial_probes',root+'/auth/session',{headers:humanHeaders},{statuses:[200],validate:value=>validateAuthSessionResponse(value)&&value.data.actor.principal_id===t.human_principal_id&&Date.parse(value.data.expires_at)>now()});
 }else for(const name of ['supplied_human_session','human_workspace','human_readiness','human_operations','missing_csrf_denied','foreign_origin_denied','session_after_denial_probes'])pending(name,'ALLOWED_SESSION_FD_MISSING');
 if(credentials.forbiddenSession){
  const headers={cookie:'cfhub_session='+credentials.forbiddenSession};
  await request('supplied_forbidden_session_denied',root+'/auth/session',{headers},{statuses:[401,403],validate:denial(['UNAUTHENTICATED','FORBIDDEN'])});
  await request('forbidden_workspace_denied',root,{headers},{statuses:[401,403],validate:denial(['UNAUTHENTICATED','FORBIDDEN'])});
 }else for(const name of ['supplied_forbidden_session_denied','forbidden_workspace_denied'])pending(name,'FORBIDDEN_SESSION_FD_MISSING');
 if(nativeHeaders){
  await request('native_workspace',root,{headers:nativeHeaders},{statuses:[200],validate:value=>matchesWorkspace(value,'agent')});
  await request('native_readiness_denied',root+'/readiness',{headers:nativeHeaders},{statuses:[403],validate:denial(['FORBIDDEN'])});
  await request('native_foreign_origin_denied',root,{headers:{...nativeHeaders,origin:t.foreign_origin}},{statuses:[403],validate:denial(['FORBIDDEN'])});
 }else for(const name of ['native_workspace','native_readiness_denied','native_foreign_origin_denied'])pending(name,'NATIVE_BEARER_FD_MISSING');
 if(humanHeaders&&nativeHeaders)await request('cookie_bearer_conflict_denied',root,{headers:{...humanHeaders,...nativeHeaders}},{statuses:[400],validate:denial(['INVALID_REQUEST'])});else pending('cookie_bearer_conflict_denied','TWO_CREDENTIAL_LANES_REQUIRED');
 if(t.alternative_origins.length)for(const [index,origin]of t.alternative_origins.entries())await request('alternative_host_'+index,root,{}, {statuses:[401,403,404]},origin);else pending('alternative_hosts','ALTERNATIVE_ROUTE_INVENTORY_MISSING');
 for(const entry of config.external_receipts){
  const bytes=options.receiptBytes?.get(entry.kind);const valid=Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=RECEIPT_LIMIT&&sha(bytes)===entry.sha256;
  evidence.gates.push({name:'receipt_bytes_'+entry.kind,group:'receipt_binding',status:valid?'pass':'fail',code:valid?'ARTIFACT_BYTES_BOUND_ONLY':'RECEIPT_BYTES_MISMATCH'});
  if(valid)evidence.receipt_refs.push({kind:entry.kind,byte_size:bytes.length,sha256:sha(bytes),assurance:'bytes_only'});
 }
 for(const name of workflowNames){const referenced=evidence.receipt_refs.some(ref=>receiptWorkflow[ref.kind]===name);evidence.gates.push({name,group:'workflow',status:'pending',code:referenced?'EXTERNAL_WORKFLOW_REVIEW_REQUIRED':'WORKFLOW_INPUT_MISSING'});evidence.missing_inputs.push('verified_workflow:'+name);}
 return complete(evidence);
}
/** Exclusive owner-only output. Existing evidence is never replaced. */
export function writeEvidenceExclusive(path,evidence){
 const bytes=Buffer.from(JSON.stringify(evidence,null,2)+'\n');if(bytes.length>EVIDENCE_LIMIT)throw inputError('EVIDENCE_BYTES_LIMIT');
 let descriptor;try{descriptor=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);let offset=0;while(offset<bytes.length)offset+=writeSync(descriptor,bytes,offset,bytes.length-offset);fsyncSync(descriptor);}catch{throw inputError('EVIDENCE_WRITE_FAILED');}finally{if(descriptor!==undefined)closeSync(descriptor);}return sha(bytes);
}
export async function main(argv=process.argv.slice(2)){
 if(argv.length===1&&argv[0]==='--help'){process.stdout.write('Usage: node scripts/verify-r1-deployment.mjs --config-fd N --output PATH\nProtected owner-only regular files; missing config emits a blocked receipt. External workflows require independent verification.\n');return 0;}
 let configFd=null,output=null;
 try{for(let i=0;i<argv.length;i+=2){if(i+1>=argv.length)throw inputError('INVALID_ARGUMENTS');if(argv[i]==='--config-fd'&&configFd===null&&/^\d+$/.test(argv[i+1]))configFd=Number(argv[i+1]);else if(argv[i]==='--output'&&output===null&&argv[i+1])output=argv[i+1];else throw inputError('INVALID_ARGUMENTS');}if(output===null)throw inputError('OUTPUT_PATH_REQUIRED');}
 catch{process.stdout.write(JSON.stringify({status:'blocked',code:'INVALID_ARGUMENTS'})+'\n');return 2;}
 let evidence;
 try{if(configFd===null)evidence=blockedEvidence();else{const inputs=loadProtectedInputs(configFd);evidence=await verifyDeployment(inputs.config,inputs.credentials,{receiptBytes:inputs.receiptBytes});}}
 catch(error){evidence=blockedEvidence(typeof error?.code==='string'&&/^[A-Z_]{1,64}$/.test(error.code)?error.code:'INPUT_UNAVAILABLE');}
 try{const evidenceSha=writeEvidenceExclusive(output,evidence);process.stdout.write(JSON.stringify({status:evidence.status,exit_code:evidence.exit_code,evidence_sha256:evidenceSha,http_subset:evidence.http_subset,missing_inputs:evidence.missing_inputs})+'\n');return evidence.exit_code;}
 catch{process.stdout.write(JSON.stringify({status:'blocked',code:'EVIDENCE_WRITE_FAILED'})+'\n');return 2;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await main();
