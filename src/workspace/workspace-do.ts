import { DurableObject } from 'cloudflare:workers';
import { migrate } from '../storage/migrations';
import { withTransaction } from '../storage/transaction';
import { installConfiguration, prepareBootstrap, canonicalJson, type ValidatedBootstrap } from '../config/bootstrap';
import { resolveWorkspace } from '../config/deployment';
import { systemClock, type InstallReceipt, type InternalRequest, type InternalResponse, type RecoveryOperatorContext } from './context';
const identifier=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
function closed(value:unknown,keys:readonly string[]):value is Record<string,unknown> {
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
}
/** Only the authenticated operator Worker receives a production binding to this method.
 * Neither a structural context nor a TypeScript type is authentication on public HTTP. */
export class WorkspaceDO extends DurableObject<Env> {
 constructor(ctx:DurableObjectState,env:Env) {super(ctx,env);migrate(ctx.storage);}
 async reconcileConfiguration(operator:RecoveryOperatorContext,input:ValidatedBootstrap):Promise<InstallReceipt> {
  if(!closed(operator,['principalId','workspaceId','requestId','operation','expectedEpoch','expectedInstallationDigest'])||
   !identifier(operator.principalId)||!identifier(operator.workspaceId)||!identifier(operator.requestId)||operator.operation!=='install'||
   !Number.isSafeInteger(operator.expectedEpoch)||operator.expectedEpoch<0||
   !(operator.expectedInstallationDigest===null||typeof operator.expectedInstallationDigest==='string'&&/^[a-f0-9]{64}$/.test(operator.expectedInstallationDigest)))throw Error('INVALID_OPERATOR_CONTEXT');
  if(!closed(input,['config','bundle','workspaceId','installationDigest'])||input.workspaceId!==operator.workspaceId)throw Error('WORKSPACE_IDENTITY_MISMATCH');
  // All schema, cloning and cryptography happen before entering transactionSync.
  const validated=await prepareBootstrap(input.config,input.bundle,input.workspaceId);
  if(validated.installationDigest!==input.installationDigest)throw Error('INSTALLATION_DIGEST_MISMATCH');
  const mapping=resolveWorkspace(validated.config,validated.workspaceId);
  if(this.env.WORKSPACE.idFromName(mapping.objectName).toString()!==this.ctx.id.toString())throw Error('WORKSPACE_IDENTITY_MISMATCH');
  const nowMs=systemClock.nowMs();
  return withTransaction(this.ctx.storage,tx=>{
   const current=tx.one<{config_epoch:number;installation_digest:string}>('SELECT config_epoch,installation_digest FROM workspace_metadata WHERE id=1');
   if((current?.config_epoch??0)!==operator.expectedEpoch||(current?.installation_digest??null)!==operator.expectedInstallationDigest)throw Error('CAS_CONFLICT');
   const receipt=installConfiguration(tx,validated.config,validated,nowMs);
   if(current?.config_epoch!==receipt.epoch)
    tx.exec('INSERT INTO events (id,workspace_id,type,actor_json,resource_type,resource_id,resource_version,thread_id,request_id,occurred_at,summary) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[
     'configuration_'+receipt.epoch,validated.workspaceId,'configuration.installed',canonicalJson({kind:'system',principal_id:operator.principalId,agent_id:null}),
     'configuration',validated.workspaceId,receipt.epoch,null,operator.requestId,nowMs,'Configuration installed'
    ]);
   return {...receipt,...mapping};
  });
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
