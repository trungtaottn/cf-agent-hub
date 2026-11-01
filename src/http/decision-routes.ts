import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {withTransaction} from '../storage/transaction';
import {dispatchCommand} from './router';
import {dispatchDecisionRead} from './decision-read-routes';
import {prepareRequestTaskDecision} from '../approvals/commands';
import {hashRuntimeProof} from '../auth/runtime-proof';
import type {TaskRequestDecisionRequest} from './dto';
import {HttpError,toHttpError,securityHeaders} from './envelopes';
/** Generic request/read ingress only; production action registry remains empty. */
export const decisionPath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/(?:tasks\/([^/:]+):request-decision|approvals(?:\/([^/:]+))?)$/;
function noQuery(params:URLSearchParams):Record<string,never>{if(params.size)throw new HttpError('INVALID_REQUEST',400);return {};}
function opaqueId(workspace:AuthWorkspace,prefix:string):string{const bytes=workspace.entropy.bytes(24);if(bytes.length!==24)throw new HttpError('INTERNAL_ERROR',500);return prefix+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');}
/** Trusted DO composition supplies bucket; no request field selects storage. */
export async function decisionRoutes(request:Request,workspace:AuthWorkspace,bucket?:R2Bucket):Promise<Response>{
 try{
  workspace={...workspace,secrets:{...workspace.secrets},clock:{nowMs:workspace.clock.nowMs.bind(workspace.clock)},entropy:{bytes:workspace.entropy.bytes.bind(workspace.entropy)}};
  const runtimeProof=request.headers.get('x-runtime-token');
  const url=new URL(request.url),match=decisionPath.exec(url.pathname);
  if(!match||match[1]!==workspace.workspaceId)throw new HttpError('NOT_FOUND',404);
  let id:string|null=null;try{id=match[2]||match[3]?decodeURIComponent(match[2]??match[3]):null;}catch{throw new HttpError('INVALID_REQUEST',400);}
  if(id!==null&&!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new HttpError('INVALID_REQUEST',400);
  const write=match[2]!==undefined,method=write?'POST':'GET';
  if(request.method==='OPTIONS'){
   noQuery(url.searchParams);const {config}=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace)),auth=config.authentication,redirect=auth.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);
   if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
   const origin=new URL(redirect.redirect_uri).origin,allowed=write?['content-type','idempotency-key','x-csrf-token','authorization','x-runtime-token']:['authorization'];
   if(url.origin!==origin||request.headers.get('origin')!==origin||!auth.allowed_origins.includes(origin)||request.headers.get('access-control-request-method')!==method||(request.headers.get('access-control-request-headers')??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).some(x=>!allowed.includes(x)))throw new HttpError('FORBIDDEN',403);
   return new Response(null,{status:204,headers:{...securityHeaders,'access-control-allow-origin':origin,'access-control-allow-credentials':'true',vary:'Origin','access-control-allow-methods':method,'access-control-allow-headers':allowed.join(', ')}});
  }
  if(request.method!==method)throw new HttpError('NOT_FOUND',404);
  if(!write)return dispatchDecisionRead(request,workspace,{operation:id===null?'approvals':'approval',approvalId:id});
  const taskId=id!;
  return dispatchCommand(request,workspace,{method,path:url.pathname,schema:'TaskRequestDecisionRequest',query:noQuery,command:async(body:TaskRequestDecisionRequest,ctx)=>({command:await prepareRequestTaskDecision({workspace,identity:ctx.identity,admission:ctx.fence,idempotencyKey:ctx.idempotencyKey,bucket,requestId:crypto.randomUUID(),signal:request.signal},taskId,body,await hashRuntimeProof(runtimeProof),{approvalId:opaqueId(workspace,'approval_'),checkpointId:opaqueId(workspace,'checkpoint_'),proposalId:opaqueId(workspace,'proposal_')})})});
 }catch(error){return toHttpError(error,crypto.randomUUID());}
}
