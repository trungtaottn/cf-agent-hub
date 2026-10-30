import {AuthError,currentConfiguration,secret,type AuthWorkspace} from '../auth/context';
import {verifyNativeCredential} from '../auth/native';
import {verifyHumanSession} from '../auth/sessions';
import {resolveActor} from '../auth/authorize';
import {withTransaction} from '../storage/transaction';
import {sha256,canonicalJson} from '../config/bootstrap';
import type {VerifiedIdentity} from '../workspace/context';
import type {TaskState} from './dto';
import {createCursorCodec,type CursorBinding} from './cursors';
import {getTask} from '../tasks/repository';
import {listTasks,TASK_STATES} from '../tasks/reads';
import {listTaskResults} from '../tasks/history';
import {TASK_RESPONSE_BYTES,TASK_CURSOR_BYTES,jsonBytes} from '../tasks/bounds';
import {HttpError,securityHeaders,toHttpError} from './envelopes';
export interface TaskReadTarget {operation:'task'|'tasks'|'task-results';taskId:string|null;}
export function parseTaskQuery(params:URLSearchParams,operation:TaskReadTarget['operation']){
 const allowed=operation==='task'?[]:operation==='tasks'?['cursor','limit','state','project_id']:['cursor','limit'];
 for(const [key]of params)if(!allowed.includes(key)||params.getAll(key).length!==1)throw new HttpError('INVALID_REQUEST',400);
 const raw=params.get('limit'),limit=raw===null?50:Number(raw),token=params.get('cursor'),state=params.get('state'),project=params.get('project_id');
 if(raw!==null&&!/^[0-9]+$/.test(raw)||!Number.isSafeInteger(limit)||limit<1||limit>200||token!==null&&(token.length===0||token.length>TASK_CURSOR_BYTES)||state!==null&&!TASK_STATES.includes(state as TaskState)||project==='')throw new HttpError('INVALID_REQUEST',400);
 return {limit,token,...(state===null?{}:{state:state as TaskState}),...(project===null?{}:{project_id:project})};
}
/** Original verified proof is retained across crypto; no cached actor confers authority. */
export async function dispatchTaskRead(request:Request,workspace:AuthWorkspace,target:TaskReadTarget):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);
 try{
  if(request.method!=='GET')throw new HttpError('NOT_FOUND',404);
  const url=new URL(request.url),query=parseTaskQuery(url.searchParams,target.operation),bearer=request.headers.get('authorization'),cookie=request.headers.get('cookie');
  if(bearer&&cookie?.split(';').some(x=>x.trim().startsWith('cfhub_session=')))throw new HttpError('INVALID_REQUEST',400);
  const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace));
  const redirect=installed.config.authentication.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const origin=new URL(redirect.redirect_uri).origin;
  if(url.origin!==origin||request.headers.has('origin')&&(request.headers.get('origin')!==origin||!installed.config.authentication.allowed_origins.includes(origin)))throw new HttpError('FORBIDDEN',403);
  if(request.headers.has('origin')){headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');}
  let identity:VerifiedIdentity;
  if(bearer){const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(bearer);if(!match)throw new AuthError('UNAUTHENTICATED',401);identity=await verifyNativeCredential(workspace,match[1],workspace.clock.nowMs());}
  else identity=await verifyHumanSession(workspace,cookie,workspace.clock.nowMs());
  const current=(tx:Parameters<typeof resolveActor>[0])=>{currentConfiguration(tx,workspace,installed.fence);const nowMs=workspace.clock.nowMs();return {actor:resolveActor(tx,identity,nowMs),nowMs};};
  const response=(value:unknown)=>{if(jsonBytes(value)>TASK_RESPONSE_BYTES)throw new HttpError('INTERNAL_ERROR',500);return new Response(JSON.stringify(value),{headers:new Headers({...Object.fromEntries(headers),'content-type':'application/json'})});};
  if(target.operation==='task'){
   if(!target.taskId)throw new HttpError('INVALID_REQUEST',400);
   const data=withTransaction(workspace.storage,tx=>getTask(tx,current(tx),target.taskId!));return response({data,request_id:requestId});
  }
  if(target.operation==='task-results'&&!target.taskId)throw new HttpError('INVALID_REQUEST',400);
  const queryHash=await sha256(canonicalJson({operation:target.operation,taskId:target.taskId,limit:query.limit,state:query.state??null,projectId:query.project_id??null,order:target.operation==='tasks'?'created_at,id:asc':'submission_sequence:asc',authorityEpoch:installed.epoch,incarnation:installed.fence.maintenanceGeneration}));
  const {actor}=withTransaction(workspace.storage,current);
  const binding:CursorBinding={workspaceId:workspace.workspaceId,principalId:actor.principalId,lane:actor.kind,credentialId:actor.credentialId,sessionId:actor.sessionId,operation:target.operation,queryHash};
  const codec=createCursorCodec(secret(workspace,'CURSOR_ENCRYPTION_KEY'),workspace.entropy),cursor=query.token?await codec.decodeCursor(query.token,binding,workspace.clock.nowMs()):undefined;
  const read=()=>withTransaction(workspace.storage,tx=>{
   const ctx=current(tx),live=ctx.actor;
   if(live.principalId!==binding.principalId||live.kind!==binding.lane||live.sessionId!==binding.sessionId||live.credentialId!==binding.credentialId)throw new AuthError('UNAUTHENTICATED',401);
   const options={limit:query.limit,binding,cursor,...(query.state===undefined?{}:{state:query.state}),...(query.project_id===undefined?{}:{project_id:query.project_id})};
   return target.operation==='tasks'?listTasks(tx,ctx,options):listTaskResults(tx,ctx,target.taskId!,options);
  });
  const prepared=read(),token=prepared.next?await codec.encodeCursor(prepared.next):null;
  if(token&&token.length>TASK_CURSOR_BYTES)throw new HttpError('INTERNAL_ERROR',500);
  // Repeat from the ORIGINAL cursor after encryption. Hidden continuation and body
  // are checked together; never publish a partially reauthorized prepared page.
  const verified=read(),comparable=(page:typeof prepared)=>({items:page.items,hasMore:page.hasMore,next:page.next?{...page.next,expiresAt:0}:null});
  if(canonicalJson(comparable(prepared))!==canonicalJson(comparable(verified)))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  if(prepared.next&&prepared.next.expiresAt<=workspace.clock.nowMs())throw new HttpError('CURSOR_EXPIRED',410);
  return response({data:verified.items,page:{next_cursor:token,has_more:verified.hasMore},request_id:requestId});
 }catch(error){return toHttpError(error,requestId,headers);}
}
