import {validateRecoveryCommand,type RecoveryCommand} from './generated/recovery-validators.js';
import {boundedBytes,decodeHeader,digestBytes,CHUNK_LIMIT,CONTROL_LIMIT} from './encoding';
import {assertRecoveryEnvelope,assertProvisionalRawEnvelope,isCurrent16Manifest,OPERATOR_RAW_LIMIT} from './operator-envelope';
import type {RecoveryContext} from './protocol';
import {jwtVerify,createRemoteJWKSet,customFetch} from 'jose';
import {approvedHttpsUrl} from '../config/deployment';
import {canonicalJson,prepareBootstrap,sha256,type ValidatedBootstrap} from '../config/bootstrap';
import {validateInstall,type OperatorInstallRequest} from './generated/install-validator.js';
import {providerJson} from '../auth/oidc';
import {AuthError,deny} from '../auth/context';
import type {WorkspaceDO} from '../workspace/workspace-do';
import type {InstallOperationContext} from '../workspace/context';

export interface OperatorBindings {
 WORKSPACE:DurableObjectNamespace;
 OPERATOR_POLICY:string;
 BOOTSTRAP_INTEGRITY_KEY:string;
}
export interface OperatorPolicy {
 environment_id:string;origin:string;access_issuer:string;access_audience:string;bundle_key_id:string;
 recovery?:{integrity_key_id:string;current_ledgers:Array<{workspace_id:string;authority_epoch:number;sha256:string}>};
 workspace_catalog:Array<{workspace_id:string;object_name:string}>;
 services:Array<{client_id:string;principal_id:string;environment_id:string;workspace_ids:string[];operations:Array<RecoveryCommand['operation']>}>;
}
const identifier=(x:unknown):x is string=>typeof x==='string'&&/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(x)&&x.length<=128;
function closed(x:unknown,keys:string[]):x is Record<string,unknown>{
 return !!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
}
export function parseOperatorPolicy(raw:string):OperatorPolicy {
 try{
  const p:unknown=JSON.parse(raw);
  if(!closed(p,['environment_id','origin','access_issuer','access_audience','bundle_key_id','workspace_catalog','services',...(p&&typeof p==='object'&&Object.hasOwn(p,'recovery')?['recovery']:[])])||!identifier(p.environment_id)||!identifier(p.bundle_key_id)||
   typeof p.origin!=='string'||new URL(p.origin).origin!==p.origin||!approvedHttpsUrl(p.origin+'/')||
   typeof p.access_issuer!=='string'||new URL(p.access_issuer).origin!==p.access_issuer||!approvedHttpsUrl(p.access_issuer+'/')||
   typeof p.access_audience!=='string'||p.access_audience.length<1||p.access_audience.length>2048||
   !Array.isArray(p.workspace_catalog)||p.workspace_catalog.length<1||p.workspace_catalog.length>1000||!Array.isArray(p.services)||p.services.length>1000)throw Error();
  const workspaces=new Set<string>(),objects=new Set<string>(),clients=new Set<string>(),principals=new Set<string>();
  for(const entry of p.workspace_catalog){
   if(!closed(entry,['workspace_id','object_name'])||!identifier(entry.workspace_id)||!identifier(entry.object_name)||workspaces.has(entry.workspace_id)||objects.has(entry.object_name))throw Error();
   workspaces.add(entry.workspace_id);objects.add(entry.object_name);
  }
  for(const service of p.services){
   if(!closed(service,['client_id','principal_id','environment_id','workspace_ids','operations'])||typeof service.client_id!=='string'||service.client_id.length<1||service.client_id.length>2048||
    !identifier(service.principal_id)||!identifier(service.environment_id)||clients.has(service.client_id)||principals.has(service.principal_id)||
    !Array.isArray(service.workspace_ids)||service.workspace_ids.length>1000||service.workspace_ids.some(x=>typeof x!=='string'||!workspaces.has(x))||new Set(service.workspace_ids).size!==service.workspace_ids.length||
    !Array.isArray(service.operations)||service.operations.some(x=>!['install','capture','read-chunk','restore','write-chunk','verify','probe','resolve-delivery','retire','resume','status'].includes(x))||new Set(service.operations).size!==service.operations.length)throw Error();
   clients.add(service.client_id);principals.add(service.principal_id);
  }
  if(p.recovery!==undefined){
   const recovery=p.recovery;if(!closed(recovery,['integrity_key_id','current_ledgers'])||!identifier(recovery.integrity_key_id)||!Array.isArray(recovery.current_ledgers)||recovery.current_ledgers.length>1000)throw Error();
   const anchors=new Set<string>();for(const entry of recovery.current_ledgers){if(!closed(entry,['workspace_id','authority_epoch','sha256'])||!identifier(entry.workspace_id)||!workspaces.has(entry.workspace_id)||anchors.has(entry.workspace_id)||!Number.isSafeInteger(entry.authority_epoch)||Number(entry.authority_epoch)<1||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error();anchors.add(entry.workspace_id);}
  }else if(p.services.some(service=>(service as {operations:string[]}).operations.some(operation=>operation!=='install')))throw Error();
  return p as unknown as OperatorPolicy;
 }catch{throw new AuthError('AUTH_UNAVAILABLE',503);}
}
export async function verifyOperatorIdentity(request:Request,policy:OperatorPolicy,workspaceId:string,operation:RecoveryCommand['operation']='install'):Promise<{principalId:string;expiresAt:number}>{
 const assertion=request.headers.get('cf-access-jwt-assertion');
 if(!assertion||assertion.length>65536||request.headers.has('authorization')||request.headers.has('cookie'))deny();
 try{
  const url=policy.access_issuer+'/cdn-cgi/access/certs';
  const jwks=createRemoteJWKSet(new URL(url),{cooldownDuration:0,[customFetch]:async(target,options)=>{
   if(String(target)!==url)throw Error();return providerJson(url,{method:'GET',headers:options.headers});
  }});
  const {payload}=await jwtVerify(assertion!,jwks,{algorithms:['RS256'],issuer:policy.access_issuer,audience:policy.access_audience,requiredClaims:['iss','aud','exp','iat','sub','type','common_name'],currentDate:new Date(),clockTolerance:0});
  const now=Date.now()/1000,aud=typeof payload.aud==='string'?[payload.aud]:payload.aud;
  if(payload.type!=='app'||payload.sub!==''||typeof payload.common_name!=='string'||!aud?.length||aud.some(x=>x!==policy.access_audience)||
   typeof payload.iat!=='number'||!Number.isFinite(payload.iat)||payload.iat>now||typeof payload.exp!=='number'||!Number.isFinite(payload.exp)||payload.exp<=now||payload.exp<=payload.iat)throw Error();
  const service=policy.services.find(x=>x.client_id===payload.common_name);
  if(!service||service.environment_id!==policy.environment_id||!service.workspace_ids.includes(workspaceId)||!service.operations.includes(operation))throw Error();
  return {principalId:service.principal_id,expiresAt:Math.floor(payload.exp*1000)};
 }catch{return deny();}
}
export async function verifyInstallation(body:OperatorInstallRequest,env:OperatorBindings,policy:OperatorPolicy):Promise<ValidatedBootstrap>{
 const input=await prepareBootstrap(body.payload.config,body.payload.verification_bundle,body.workspace_id),bundle=input.bundle;
 const mapping=policy.workspace_catalog.find(x=>x.workspace_id===body.workspace_id);
 if(!mapping||!input.config.workspace_catalog.some(x=>x.workspace_id===mapping.workspace_id&&x.object_name===mapping.object_name))throw new AuthError('FORBIDDEN',403);
 // Every catalog reference must remain in this explicitly configured deployment environment.
 if(input.config.workspace_catalog.some(x=>!policy.workspace_catalog.some(y=>x.workspace_id===y.workspace_id&&x.object_name===y.object_name)))throw new AuthError('FORBIDDEN',403);
 if(bundle.auth.key_id!==policy.bundle_key_id)deny();
 try{
  const bytes=Uint8Array.from(atob(env.BOOTSTRAP_INTEGRITY_KEY),x=>x.charCodeAt(0));
  if(bytes.length<32||bytes.length>128||btoa(String.fromCharCode(...bytes))!==env.BOOTSTRAP_INTEGRITY_KEY)deny();
  const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const {tag,...auth}=bundle.auth,signature=Uint8Array.from(tag.match(/../g)!,x=>parseInt(x,16));
  if(!await crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(canonicalJson({...bundle,auth}))))deny();
 }catch{deny();}
 return input;
}
export async function readInstallRequest(request:Request):Promise<OperatorInstallRequest>{
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new AuthError('INVALID_REQUEST',400);
 const reader=request.body?.getReader();if(!reader)throw new AuthError('INVALID_REQUEST',400);
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536)throw new AuthError('INVALID_REQUEST',413);chunks.push(part.value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{throw new AuthError('INVALID_REQUEST',400);}
 if(!validateInstall(body))throw new AuthError('INVALID_REQUEST',400);return body;
}
export async function installOperation(request:Request,env:OperatorBindings,policy:OperatorPolicy,requestId:string,parsed?:OperatorInstallRequest){
 const body=parsed??await readInstallRequest(request),proof=await verifyOperatorIdentity(request,policy,body.workspace_id);
 const input=await verifyInstallation(body,env,policy),mapping=policy.workspace_catalog.find(x=>x.workspace_id===body.workspace_id)!;
 const target=env.WORKSPACE.getByName(mapping.object_name) as DurableObjectStub<WorkspaceDO>;
 const fingerprint=await sha256(canonicalJson(body));
 const current=await target.authoritySnapshot({workspaceId:body.workspace_id,objectName:mapping.object_name});
 const operator:InstallOperationContext={principalId:proof.principalId,proofExpiresAt:proof.expiresAt,workspaceId:body.workspace_id,requestId,operation:'install',expectedEpoch:body.expected_authority_epoch,expectedInstallationDigest:current.installationDigest,operationId:body.operation_id,requestFingerprint:fingerprint};
 const outcome=await target.installOperation(operator,input);
 if(!outcome.ok){
  if(outcome.code==='UNAUTHENTICATED')throw new AuthError('UNAUTHENTICATED',401);
  if(outcome.code==='CONFLICT')throw Error('OPERATION_CONFLICT');
  throw new AuthError(outcome.code==='INSTALL_UNAVAILABLE'?'AUTH_UNAVAILABLE':'INVALID_REQUEST',outcome.code==='INSTALL_UNAVAILABLE'?503:400);
 }
 return outcome.receipt;
}

// Parser-owned metadata cannot be supplied in a command or request header.
const parsedRawBytes=new WeakMap<object,number>();
export async function readOperatorRequest(request:Request):Promise<RecoveryCommand>{
 const contentType=request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();let body:unknown;
 try{
  if(contentType==='application/octet-stream'){body=decodeHeader(request.headers.get('X-CFHub-Recovery-Control'));if(!validateRecoveryCommand(body)||body.operation!=='write-chunk')throw Error('INVALID_RECOVERY_HEADER');return body;}
  if(contentType!=='application/json')throw Error('INVALID_RECOVERY_CONTENT_TYPE');
  const bytes=await boundedBytes(request.body,OPERATOR_RAW_LIMIT);
  try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}
  catch(error){if(bytes.length>CONTROL_LIMIT)throw Error('RECOVERY_BYTES_LIMIT');throw error;}
  assertProvisionalRawEnvelope(body,bytes.length);
  if(!validateRecoveryCommand(body)||body.operation==='write-chunk')throw Error('INVALID_RECOVERY_COMMAND');
  assertRecoveryEnvelope(body,{rawBytes:bytes.length,provisional:true});parsedRawBytes.set(body,bytes.length);return body;
 }catch(error){throw new AuthError('INVALID_REQUEST',error instanceof Error&&error.message==='RECOVERY_BYTES_LIMIT'?413:400);}
}
/** Authenticates binary metadata and current target epoch before touching the upload stream. */
export async function operatorOperation(request:Request,env:OperatorBindings,policy:OperatorPolicy,requestId:string){
 const body=await readOperatorRequest(request);
 if(body.operation==='install'){
  const receipt=await installOperation(request,env,policy,requestId,body);return {data:{workspace_id:receipt.workspaceId,object_name:receipt.objectName,epoch:receipt.epoch,installation_digest:receipt.installationDigest,operator_principal_id:receipt.operatorPrincipalId,operation_id:receipt.operationId,original_request_id:receipt.originalRequestId}};
 }
 const proof=await verifyOperatorIdentity(request,policy,body.workspace_id,body.operation),mapping=policy.workspace_catalog.find(x=>x.workspace_id===body.workspace_id);
 if(!mapping||!policy.recovery)throw new AuthError('FORBIDDEN',403);
 const target=env.WORKSPACE.getByName(mapping.object_name) as DurableObjectStub<WorkspaceDO>,current=await target.authoritySnapshot({workspaceId:body.workspace_id,objectName:mapping.object_name});
 // Only exact current restore admission may delegate an epoch mismatch to the DO.
 // It can return a matching prior receipt, never grant generic stale-epoch authority.
 if(current.epoch!==body.expected_authority_epoch&&!(body.operation==='restore'&&isCurrent16Manifest(body.payload.manifest)))throw Error('OPERATION_CONFLICT');
 if(current.recoveryIntegrityKeyId!==policy.recovery.integrity_key_id)throw new AuthError('AUTH_UNAVAILABLE',503);
 const fingerprint=await sha256(canonicalJson(body)),anchor=policy.recovery.current_ledgers.find(x=>x.workspace_id===body.workspace_id);
 const context:RecoveryContext={principalId:proof.principalId,workspaceId:body.workspace_id,objectName:mapping.object_name,environmentId:policy.environment_id,requestId,operationId:body.operation_id,operation:body.operation,captureId:body.capture_id,expectedEpoch:body.expected_authority_epoch,expectedInstallationDigest:current.installationDigest,proofExpiresAt:proof.expiresAt,requestFingerprint:fingerprint,ledgerAnchor:anchor?{authorityEpoch:anchor.authority_epoch,sha256:anchor.sha256}:null};
 let binary:ArrayBuffer|undefined;
 if(body.operation==='write-chunk'){
  if(proof.expiresAt<=Date.now())throw new AuthError('UNAUTHENTICATED',401);
  let bytes:Uint8Array;try{bytes=await boundedBytes(request.body,CHUNK_LIMIT);}catch(error){throw new AuthError('INVALID_REQUEST',error instanceof Error&&error.message==='RECOVERY_BYTES_LIMIT'?413:400);}
  if(bytes.length!==body.payload.byte_size||await digestBytes(bytes)!==body.payload.sha256)throw new AuthError('INVALID_REQUEST',400);binary=bytes.slice().buffer;
 }
 const result=await target.recoveryOperation(context,body,binary,parsedRawBytes.get(body));
 if(!result.ok){if(result.code==='UNAUTHENTICATED')throw new AuthError('UNAUTHENTICATED',401);if(result.code==='CONFLICT')throw Error('OPERATION_CONFLICT');throw new AuthError(result.code==='RECOVERY_UNAVAILABLE'?'AUTH_UNAVAILABLE':'INVALID_REQUEST',result.code==='RECOVERY_UNAVAILABLE'?503:400);}
 if('chunk' in result)return {chunk:result.chunk};return {data:result.data};
}
