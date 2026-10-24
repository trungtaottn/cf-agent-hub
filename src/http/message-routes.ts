import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {withTransaction} from '../storage/transaction';
import {messageCommand} from '../messages/commands';
import {dispatchCommand} from './router';
import {HttpError,toHttpError,securityHeaders} from './envelopes';
export const messagePath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/messages$/;
export async function messageRoutes(request:Request,workspace:AuthWorkspace):Promise<Response>{
 try{
  const url=new URL(request.url),match=messagePath.exec(url.pathname);
  if(!match||match[1]!==workspace.workspaceId)throw new HttpError('NOT_FOUND',404);
  if(request.method==='OPTIONS'){
   const {config}=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace)),auth=config.authentication;
   const redirect=auth.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
   const origin=new URL(redirect.redirect_uri).origin,allowed=['content-type','idempotency-key','x-csrf-token','authorization'];
   if(url.origin!==origin||request.headers.get('origin')!==origin||!auth.allowed_origins.includes(origin)||request.headers.get('access-control-request-method')!=='POST'||url.searchParams.size||
    (request.headers.get('access-control-request-headers')??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).some(x=>!allowed.includes(x)))throw new HttpError('FORBIDDEN',403);
   return new Response(null,{status:204,headers:{...securityHeaders,'access-control-allow-origin':origin,'access-control-allow-credentials':'true',vary:'Origin','access-control-allow-methods':'POST','access-control-allow-headers':allowed.join(', ')}});
  }
  if(request.method!=='POST')throw new HttpError('NOT_FOUND',404);
  return await dispatchCommand(request,workspace,{method:'POST',path:url.pathname,schema:'MessageCreateRequest',query(params){if(params.size)throw new HttpError('INVALID_REQUEST',400);return {};},command:messageCommand(workspace)});
 }catch(error){return toHttpError(error,crypto.randomUUID());}
}
