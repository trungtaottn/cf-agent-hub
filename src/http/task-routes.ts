import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {withTransaction} from '../storage/transaction';
import {dispatchCommand} from './router';
import {dispatchTaskRead} from './task-read-routes';
import {createTaskCommand,patchTaskCommand,readyTaskCommand} from '../tasks/commands';
import {HttpError,toHttpError,securityHeaders} from './envelopes';
/** Closed to this issue only. A schema for a successor operation never enables its route. */
export const taskPath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/(tasks(?:\/[^/:]+(?::ready|\/results)?)?)$/;
function noQuery(params:URLSearchParams):Record<string,never>{if(params.size)throw new HttpError('INVALID_REQUEST',400);return {};}
export async function taskRoutes(request:Request,workspace?:AuthWorkspace):Promise<Response>{
 try{
  const url=new URL(request.url),match=taskPath.exec(url.pathname);
  if(!workspace||!match||match[1]!==workspace.workspaceId)throw new HttpError('NOT_FOUND',404);
  const path=match[2],collection=path==='tasks',ready=path.endsWith(':ready'),results=/^tasks\/[^/]+\/results$/.test(path);
  let id:string|null=null;
  if(!collection){try{id=decodeURIComponent(path.slice('tasks/'.length).replace(/(:ready|\/results)$/, ''));}catch{throw new HttpError('INVALID_REQUEST',400);}if(!id)throw new HttpError('INVALID_REQUEST',400);}
  const methods=collection?['GET','POST']:ready?['POST']:results?['GET']:['GET','PATCH'];
  if(request.method==='OPTIONS'){
   noQuery(url.searchParams);const {config}=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace)),auth=config.authentication;
   const redirect=auth.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
   const origin=new URL(redirect.redirect_uri).origin,allowed=['content-type','idempotency-key','x-csrf-token','authorization'];
   if(url.origin!==origin||request.headers.get('origin')!==origin||!auth.allowed_origins.includes(origin)||!methods.includes(request.headers.get('access-control-request-method')??'')||(request.headers.get('access-control-request-headers')??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).some(x=>!allowed.includes(x)))throw new HttpError('FORBIDDEN',403);
   return new Response(null,{status:204,headers:{...securityHeaders,'access-control-allow-origin':origin,'access-control-allow-credentials':'true',vary:'Origin','access-control-allow-methods':methods.join(', '),'access-control-allow-headers':allowed.join(', ')}});
  }
  if(!methods.includes(request.method))throw new HttpError('NOT_FOUND',404);
  if(request.method==='GET')return dispatchTaskRead(request,workspace,{operation:collection?'tasks':results?'task-results':'task',taskId:id});
  const common={method:request.method,path:url.pathname,query:noQuery};
  if(collection){const bytes=workspace.entropy.bytes(24);if(bytes.length!==24)throw new HttpError('INTERNAL_ERROR',500);const taskId='task_'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');return dispatchCommand(request,workspace,{...common,schema:'TaskCreateRequest',command:createTaskCommand(taskId)});}
  if(ready)return dispatchCommand(request,workspace,{...common,schema:'TaskVersionRequest',command:readyTaskCommand(id!)});
  return dispatchCommand(request,workspace,{...common,schema:'TaskPatchRequest',command:patchTaskCommand(id!)});
 }catch(error){return toHttpError(error,crypto.randomUUID());}
}
