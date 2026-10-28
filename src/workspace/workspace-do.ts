import {searchPath,searchRoutes} from '../http/search-routes';
import {artifactPath,artifactRoutes} from '../http/artifact-routes';
import {productArtifactBucket} from '../artifacts/binding';
import {catalogPath,catalogRoutes} from '../http/catalog-routes';
import {taskPath,taskRoutes} from '../http/task-routes';
import {r2Routes,identityPath} from '../http/r2-routes';
import {advanceCapture,readRecoveryChunk,readRecoveryStatus} from '../recovery/capture';
import {beginRestore,writeRestoreChunk,advanceVerify} from '../recovery/restore';
import {recordProbe} from '../recovery/probes';
import {resolveDelivery,retireWorkspace,resumeWorkspace} from '../recovery/controls';
import {assertRecoveryContext,validateRecoveryContext,recoveryError,type RecoveryContext,type RecoveryWorkspace,type RecoveryRpcResult,type RecoveryRequest,type ChunkMetadata} from '../recovery/protocol';
import {validateRecoveryCommand} from '../recovery/generated/recovery-validators.js';
import {canonicalBytes,digestBytes,CONTROL_LIMIT} from '../recovery/encoding';
import {maintenanceClosed,readAdmissionFence,assertFence} from '../recovery/maintenance';
import {operationsPath,operationsRoutes} from '../http/operations-routes';
import {readinessPath,readinessRoutes} from '../http/readiness-routes';
import {workspacePath,workspaceRoutes} from '../http/workspace-routes';
import {OutboxScheduler} from '../outbox/scheduler';
import {DeliveryDispatcher} from '../outbox/dispatcher';
import type {AuthWorkspace} from '../auth/context';
import {messagePath,messageRoutes} from '../http/message-routes';
import {settingsPath,settingsRoutes} from '../http/settings-routes';
import { authRoutes,authFailure,securityHeaders } from '../http/auth-routes';
import { AuthError,cookieHeader } from '../auth/context';
import { DurableObject } from 'cloudflare:workers';
import { migrate } from '../storage/migrations';
import { withTransaction } from '../storage/transaction';
import { installConfiguration, prepareBootstrap, canonicalJson, type ValidatedBootstrap } from '../config/bootstrap';
import { resolveWorkspace } from '../config/deployment';
import { systemClock, systemEntropy, type InstallReceipt, type InternalRequest, type InternalResponse, type RecoveryOperatorContext,type InstallOperationContext,type OperatorInstallReceipt,type WorkspaceEnvironment,type InstallOperationResult } from './context';
const identifier=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
function closed(value:unknown,keys:readonly string[]):value is Record<string,unknown> {
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
}
/** Only the authenticated operator Worker receives a production binding to this method.
 * Neither a structural context nor a TypeScript type is authentication on public HTTP. */
export class WorkspaceDO extends DurableObject<WorkspaceEnvironment> {
 constructor(ctx:DurableObjectState,env:WorkspaceEnvironment) {super(ctx,env);migrate(ctx.storage);}
 async reconcileConfiguration(operator:RecoveryOperatorContext,input:ValidatedBootstrap):Promise<InstallReceipt> {
  if(!closed(operator,['principalId','workspaceId','requestId','operation','expectedEpoch','expectedInstallationDigest'])||
   !identifier(operator.principalId)||!identifier(operator.workspaceId)||!identifier(operator.requestId)||operator.operation!=='install'||
   !Number.isSafeInteger(operator.expectedEpoch)||operator.expectedEpoch<0||
   !(operator.expectedInstallationDigest===null||typeof operator.expectedInstallationDigest==='string'&&/^[a-f0-9]{64}$/.test(operator.expectedInstallationDigest)))throw Error('INVALID_OPERATOR_CONTEXT');
  if(!closed(input,['config','bundle','workspaceId','installationDigest'])||input.workspaceId!==operator.workspaceId)throw Error('WORKSPACE_IDENTITY_MISMATCH');
  // All schema, cloning and cryptography happen before entering transactionSync.
  const fence=withTransaction(this.ctx.storage,readAdmissionFence);
  const validated=await prepareBootstrap(input.config,input.bundle,input.workspaceId);
  if(validated.installationDigest!==input.installationDigest)throw Error('INSTALLATION_DIGEST_MISMATCH');
  const mapping=resolveWorkspace(validated.config,validated.workspaceId);
  if(this.env.WORKSPACE.idFromName(mapping.objectName).toString()!==this.ctx.id.toString())throw Error('WORKSPACE_IDENTITY_MISMATCH');
  const nowMs=systemClock.nowMs();
  return withTransaction(this.ctx.storage,tx=>{
   assertFence(tx,fence);
   const current=tx.one<{config_epoch:number;installation_digest:string}>('SELECT config_epoch,installation_digest FROM workspace_metadata WHERE id=1');
   if((current?.config_epoch??0)!==operator.expectedEpoch||(current?.installation_digest??null)!==operator.expectedInstallationDigest)throw Error('CAS_CONFLICT');
   const receipt=installConfiguration(tx,validated.config,validated,nowMs);
   if(current?.config_epoch!==receipt.epoch)
    tx.exec('INSERT INTO events (id,workspace_id,type,actor_json,resource_type,resource_id,resource_version,thread_id,request_id,occurred_at,summary) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[
     'configuration_'+receipt.epoch,validated.workspaceId,'configuration.installed',canonicalJson({kind:'system',principal_id:operator.principalId,agent_id:null}),
     'configuration',validated.workspaceId,receipt.epoch,null,operator.requestId,nowMs,'Workspace configuration installed.'
    ]);
   return {...receipt,...mapping};
  });
 }
 /** Trusted binding snapshot. Never gates stale expected epochs ahead of original replay. */
 async authoritySnapshot(target:{workspaceId:string;objectName:string}):Promise<{epoch:number;installationDigest:string|null;recoveryIntegrityKeyId:string|null}> {
  if(!closed(target,['workspaceId','objectName'])||!identifier(target.workspaceId)||!identifier(target.objectName)||
   this.env.WORKSPACE.idFromName(target.objectName).toString()!==this.ctx.id.toString())throw Error('WORKSPACE_IDENTITY_MISMATCH');
  return withTransaction(this.ctx.storage,tx=>{
   const row=tx.one<{workspace_id:string;object_name:string;config_epoch:number;installation_digest:string}>('SELECT workspace_id,object_name,config_epoch,installation_digest FROM workspace_metadata WHERE id=1');
   if(row&&(row.workspace_id!==target.workspaceId||row.object_name!==target.objectName))throw Error('WORKSPACE_IDENTITY_MISMATCH');
   return {epoch:row?.config_epoch??0,installationDigest:row?.installation_digest??null,recoveryIntegrityKeyId:this.env.RECOVERY_INTEGRITY_KEY_ID??null};
  });
 }
 /** Only the authenticated operator gateway calls this strict public-operator adapter.
  * The receipt namespace is permanent control state, never restored domain idempotency. */
 async installOperation(operator:InstallOperationContext,input:ValidatedBootstrap):Promise<InstallOperationResult> {
  try{return {ok:true,receipt:await this.#executeInstallOperation(operator,input)};}
  catch(error){
   const message=error instanceof Error?error.message:'';
   const conflicts=['CAS_CONFLICT','STALE_EPOCH','EPOCH_CONFLICT','OPERATION_CONFLICT','CREDENTIAL_IMMUTABLE','RETIREMENT_REQUIRED','ADMISSION_CLOSED','NONADVANCING_INSTALL','PRINCIPAL_IMMUTABLE'];
   const invalid=['INVALID_OPERATOR_CONTEXT','WORKSPACE_IDENTITY_MISMATCH','INSTALLATION_DIGEST_MISMATCH','INVALID_BUNDLE','CONFIG_DIGEST_MISMATCH','DUPLICATE_CREDENTIAL','CREDENTIAL_SET_MISMATCH','INVALID_RETIREMENT','CREDENTIAL_EXPIRY'];
   return {ok:false,code:message==='OPERATOR_PROOF_EXPIRED'?'UNAUTHENTICATED':conflicts.includes(message)?'CONFLICT':invalid.includes(message)||message.startsWith('INVALID_CONFIGURATION:')?'INVALID_INSTALL':'INSTALL_UNAVAILABLE'};
  }
 }
 async #executeInstallOperation(operator:InstallOperationContext,input:ValidatedBootstrap):Promise<OperatorInstallReceipt> {
  if(!closed(operator,['principalId','workspaceId','requestId','operation','expectedEpoch','expectedInstallationDigest','operationId','requestFingerprint','proofExpiresAt'])||
   !identifier(operator.principalId)||!identifier(operator.workspaceId)||!identifier(operator.requestId)||operator.operation!=='install'||
   !Number.isSafeInteger(operator.proofExpiresAt)||operator.proofExpiresAt<=0||!identifier(operator.operationId)||typeof operator.requestFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(operator.requestFingerprint)||
   !Number.isSafeInteger(operator.expectedEpoch)||operator.expectedEpoch<0||
   !(operator.expectedInstallationDigest===null||typeof operator.expectedInstallationDigest==='string'&&/^[a-f0-9]{64}$/.test(operator.expectedInstallationDigest)))throw Error('INVALID_OPERATOR_CONTEXT');
  if(!closed(input,['config','bundle','workspaceId','installationDigest'])||input.workspaceId!==operator.workspaceId)throw Error('WORKSPACE_IDENTITY_MISMATCH');
  const fence=withTransaction(this.ctx.storage,readAdmissionFence);
  const validated=await prepareBootstrap(input.config,input.bundle,input.workspaceId);
  if(validated.installationDigest!==input.installationDigest)throw Error('INSTALLATION_DIGEST_MISMATCH');
  const mapping=resolveWorkspace(validated.config,validated.workspaceId);
  if(this.env.WORKSPACE.idFromName(mapping.objectName).toString()!==this.ctx.id.toString())throw Error('WORKSPACE_IDENTITY_MISMATCH');
  const now=systemClock.nowMs();
  return withTransaction(this.ctx.storage,tx=>{
   if(operator.proofExpiresAt<=systemClock.nowMs())throw Error('OPERATOR_PROOF_EXPIRED');
   assertFence(tx,fence);
   const current=tx.one<{workspace_id:string;object_name:string;config_epoch:number;installation_digest:string;admission_state:string}>('SELECT workspace_id,object_name,config_epoch,installation_digest,admission_state FROM workspace_metadata WHERE id=1');
   if(current&&(current.workspace_id!==operator.workspaceId||current.object_name!==mapping.objectName))throw Error('WORKSPACE_IDENTITY_MISMATCH');
   if(current&&current.admission_state!=='installed'||maintenanceClosed(tx))throw Error('ADMISSION_CLOSED');
   const prior=tx.one<{fingerprint:string;outcome_json:string}>("SELECT fingerprint,outcome_json FROM idempotency_outcomes WHERE principal_id=? AND operation='operator.install' AND target=? AND key=? AND workspace_id=?",[operator.principalId,operator.workspaceId,operator.operationId,operator.workspaceId]);
   if(prior){
    if(prior.fingerprint!==operator.requestFingerprint)throw Error('OPERATION_CONFLICT');
    return JSON.parse(prior.outcome_json) as OperatorInstallReceipt;
   }
   if((current?.config_epoch??0)!==operator.expectedEpoch||(current?.installation_digest??null)!==operator.expectedInstallationDigest)throw Error('CAS_CONFLICT');
   if(validated.config.config_epoch<=(current?.config_epoch??0))throw Error('NONADVANCING_INSTALL');
   const installed=installConfiguration(tx,validated.config,validated,now);
   const receipt:OperatorInstallReceipt={...installed,...mapping,operatorPrincipalId:operator.principalId,operationId:operator.operationId,originalRequestId:operator.requestId};
   const eventId='configuration_'+receipt.epoch;
   tx.exec('INSERT INTO events (id,workspace_id,type,actor_json,resource_type,resource_id,resource_version,thread_id,request_id,occurred_at,summary) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[
    eventId,operator.workspaceId,'configuration.installed',canonicalJson({kind:'system',principal_id:operator.principalId,agent_id:null}),
    'configuration',operator.workspaceId,receipt.epoch,null,operator.requestId,now,'Workspace configuration installed.'
   ]);
   tx.exec('INSERT INTO idempotency_outcomes (principal_id,operation,target,key,workspace_id,fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[
    operator.principalId,'operator.install',operator.workspaceId,operator.operationId,operator.workspaceId,operator.requestFingerprint,200,canonicalJson(receipt),operator.requestId,eventId,now,Number.MAX_SAFE_INTEGER
   ]);
   return receipt;
  });
 }
 #recoveryWorkspace(operator:RecoveryContext):RecoveryWorkspace {
  validateRecoveryContext(operator);
  if(this.env.WORKSPACE.idFromName(operator.objectName).toString()!==this.ctx.id.toString()||this.env.RECOVERY_ENVIRONMENT_ID!==operator.environmentId||!this.env.RECOVERY_INTEGRITY_KEY_ID||!this.env.RECOVERY_INTEGRITY_KEY||!this.env.RECOVERY_RELEASE)throw Error('RECOVERY_CONFIGURATION_UNAVAILABLE');
  let release:unknown;try{release=JSON.parse(this.env.RECOVERY_RELEASE);}catch{throw Error('RECOVERY_CONFIGURATION_UNAVAILABLE');}
  if(!closed(release,['revision','worker_version','binding_ids'])||typeof release.revision!=='string'||typeof release.worker_version!=='string'||!Array.isArray(release.binding_ids))throw Error('RECOVERY_CONFIGURATION_UNAVAILABLE');
  return {storage:this.ctx.storage,bucket:this.env.RECOVERY_BUCKET,workspaceId:operator.workspaceId,objectName:operator.objectName,environmentId:operator.environmentId,clock:systemClock,entropy:systemEntropy,integrity:{keyId:this.env.RECOVERY_INTEGRITY_KEY_ID,key:this.env.RECOVERY_INTEGRITY_KEY},release:{revision:release.revision,worker_version:this.env.CF_VERSION_METADATA?.id??release.worker_version,binding_ids:release.binding_ids as string[],catalog_mapping:{workspace_id:operator.workspaceId,object_name:operator.objectName}},repairSchedule:()=>this.repairSchedule()};
 }
 /** Binding-only finite recovery adapter. The public HTTP router never dispatches these methods. */
 async recoveryOperation(operator:RecoveryContext,body:RecoveryRequest,binary?:ArrayBuffer):Promise<RecoveryRpcResult|{ok:true;chunk:{metadata:ChunkMetadata;bytes:ArrayBuffer}}> {
  try{
   const workspace=this.#recoveryWorkspace(operator),fence=withTransaction(this.ctx.storage,tx=>assertRecoveryContext(tx,workspace,operator));
   if(!validateRecoveryCommand(body)||body.operation!==operator.operation||body.workspace_id!==operator.workspaceId||body.capture_id!==operator.captureId||body.operation_id!==operator.operationId||body.expected_authority_epoch!==operator.expectedEpoch||canonicalBytes(body).length>CONTROL_LIMIT||body.operation!=='write-chunk'&&binary!==undefined)throw Error('INVALID_RECOVERY_COMMAND');
   if(await digestBytes(canonicalBytes(body))!==operator.requestFingerprint)throw Error('RECOVERY_OPERATION_CONFLICT');withTransaction(this.ctx.storage,tx=>assertRecoveryContext(tx,workspace,operator,fence));
   switch(body.operation){
    case 'capture':return {ok:true,data:await advanceCapture(workspace,operator,body.payload.budget)};
    case 'read-chunk':return {ok:true,chunk:await readRecoveryChunk(workspace,operator,body.payload.index)};
    case 'restore':return {ok:true,data:await beginRestore(workspace,operator,body.payload.manifest,body.payload.ledger)};
    case 'write-chunk':if(!(binary instanceof ArrayBuffer))throw Error('INVALID_RECOVERY_CHUNK');return {ok:true,data:await writeRestoreChunk(workspace,operator,body.payload,new Uint8Array(binary))};
    case 'verify':return {ok:true,data:await advanceVerify(workspace,operator,body.payload.manifest)};
    case 'probe':return {ok:true,data:await recordProbe(workspace,operator)};
    case 'resolve-delivery':return {ok:true,data:await resolveDelivery(workspace,operator,body.payload)};
    case 'retire':return {ok:true,data:await retireWorkspace(workspace,operator)};
    case 'resume':return {ok:true,data:await resumeWorkspace(workspace,operator,body.payload)};
    case 'status':return {ok:true,data:readRecoveryStatus(workspace,operator,body.payload.job_id)};
   }
  }catch(error){return recoveryError(error);}
 }
 #outboxWorkspace():AuthWorkspace|null{
  const metadata=withTransaction(this.ctx.storage,tx=>tx.one<{workspace_id:string;object_name:string}>('SELECT workspace_id,object_name FROM workspace_metadata WHERE id=1'));
  if(!metadata||this.env.WORKSPACE.idFromName(metadata.object_name).toString()!==this.ctx.id.toString())return null;
  return {storage:this.ctx.storage,workspaceId:metadata.workspace_id,objectName:metadata.object_name,secrets:this.env as unknown as Record<string,unknown>,clock:systemClock,entropy:systemEntropy};
 }
 async repairSchedule(){const workspace=this.#outboxWorkspace();if(!workspace)throw Error('WORKSPACE_IDENTITY_MISMATCH');return new OutboxScheduler(workspace,new DeliveryDispatcher(workspace),undefined,productArtifactBucket(this.env)).repairSchedule();}
 async runDueWork(nowMs:number):Promise<void>{const workspace=this.#outboxWorkspace();if(!workspace)return;await new OutboxScheduler(workspace,new DeliveryDispatcher(workspace),undefined,productArtifactBucket(this.env)).runDueWork(nowMs);}
 async alarm():Promise<void>{await this.runDueWork(systemClock.nowMs());}
 async #repairDirty():Promise<void>{try{if(withTransaction(this.ctx.storage,tx=>tx.one<{dirty:number}>('SELECT dirty FROM scheduler_state WHERE id=1')?.dirty===1))await this.repairSchedule();}catch{/* Persisted work and catalog sweep remain authoritative. */}}
 async fetch(request:Request):Promise<Response> {
  const match=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/auth\/(start|callback|session|logout)$/.exec(new URL(request.url).pathname);
  const path=new URL(request.url).pathname;
  const settings=settingsPath.exec(path),message=messagePath.exec(path),operations=operationsPath.exec(path),readiness=readinessPath.exec(path),base=workspacePath.exec(path);
  const identity=identityPath.exec(path),task=taskPath.exec(path),catalog=catalogPath.exec(path);
  const search=searchPath.exec(path);
  const bucket=productArtifactBucket(this.env),artifact=bucket?artifactPath.exec(path):null;
  const selected=match??settings??message??operations??readiness??base??identity??task??catalog??artifact??search;
  if(!selected)return r2Routes(request);
  // Protected diagnostics observe persisted scheduler/probe state. A GET must
  // not repair that state or manufacture a fresh health observation.
  // Identity lifecycle emits only local audit/outcome rows, never outbox work.
  // Do not await unrelated alarm repair after its final authority/secret projection.
  const diagnostic=Boolean(operations||readiness||identity||task||catalog||artifact||search);
  if(!diagnostic)await this.#repairDirty();
  const metadata=withTransaction(this.ctx.storage,tx=>tx.one<{workspace_id:string;object_name:string}>('SELECT workspace_id,object_name FROM workspace_metadata WHERE id=1'));
  if(!metadata||metadata.workspace_id!==selected[1]||this.env.WORKSPACE.idFromName(metadata.object_name).toString()!==this.ctx.id.toString()){const headers=new Headers(securityHeaders);if(match?.[2]==='callback')headers.append('set-cookie',cookieHeader('cfhub_login','',0));return authFailure(new AuthError('UNAUTHENTICATED',401),crypto.randomUUID(),headers);}
  const workspace={storage:this.ctx.storage,workspaceId:metadata.workspace_id,objectName:metadata.object_name,secrets:this.env as unknown as Record<string,unknown>,clock:systemClock,entropy:systemEntropy};
  const response=await (artifact?artifactRoutes(request,workspace,bucket):(search?searchRoutes:catalog?catalogRoutes:task?taskRoutes:identity?r2Routes:operations?operationsRoutes:readiness?readinessRoutes:base?workspaceRoutes:message?messageRoutes:settings?settingsRoutes:authRoutes)(request,workspace));
  // Ownership commands commit a durable generation. Schedule its shared repair
  // within the DO lifetime without awaiting after the final authorized projection.
  // Failure remains dirty for the existing scheduled catalog sweep/restart repair.
  if(task&&request.method==='POST'&&/:(claim|fail|cancel|submit-result|heartbeat)$/.test(path)&&response.ok)this.ctx.waitUntil(this.#repairDirty());
  if(message&&request.method==='POST'&&response.ok)this.ctx.waitUntil(this.#repairDirty());
  if(artifact&&request.method!=='GET'&&request.method!=='OPTIONS'&&response.ok)this.ctx.waitUntil(this.#repairDirty());
  // Message/event startup repair stays before authentication; never await it after projection.
  if(!diagnostic&&!message)await this.#repairDirty();return response;
 }
 async command(request:InternalRequest):Promise<InternalResponse> {
  if(!closed(request,['workspaceId','objectName','requestId','operation'])||!identifier(request.workspaceId)||!identifier(request.objectName)||!identifier(request.requestId)||typeof request.operation!=='string'||request.operation.length>128)throw Error('INVALID_INTERNAL_REQUEST');
  return withTransaction(this.ctx.storage,tx=>{
   const current=tx.one<{workspace_id:string;object_name:string;admission_state:string}>('SELECT workspace_id,object_name,admission_state FROM workspace_metadata WHERE id=1');
   if(!current)return {status:503,code:'NOT_INSTALLED'};
   if(current.workspace_id!==request.workspaceId||current.object_name!==request.objectName||this.env.WORKSPACE.idFromName(request.objectName).toString()!==this.ctx.id.toString())throw Error('WORKSPACE_IDENTITY_MISMATCH');
   // Authentication and domain command dispatch are implemented by later owners.
   return {status:403,code:current.admission_state==='installed'?'AUTHENTICATION_REQUIRED':'ADMISSION_CLOSED'};
  });
 }
}
