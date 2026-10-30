import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {withTransaction} from '../storage/transaction';
import {dispatchCommand} from './router';
import {previewCatalogCommand,applyCatalogCommand} from '../config/catalog-commands';
import {HttpError,toHttpError,securityHeaders} from './envelopes';
export const catalogPath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/catalog:(preview|apply)$/;
function noQuery(params:URLSearchParams):Record<string,never>{if(params.size)throw new HttpError('INVALID_REQUEST',400);return {};}
export async function catalogRoutes(request:Request,workspace?:AuthWorkspace):Promise<Response>{
 try{
  const url=new URL(request.url),match=catalogPath.exec(url.pathname);
  if(!workspace||!match||match[1]!==workspace.workspaceId)throw new HttpError('NOT_FOUND',404);
  if(request.method==='OPTIONS'){
   noQuery(url.searchParams);const {config}=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace)),auth=config.authentication;
   const redirect=auth.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
   const origin=new URL(redirect.redirect_uri).origin,allowed=['content-type','idempotency-key','x-csrf-token'];
   if(url.origin!==origin||request.headers.get('origin')!==origin||!auth.allowed_origins.includes(origin)||request.headers.get('access-control-request-method')!=='POST'||(request.headers.get('access-control-request-headers')??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).some(x=>!allowed.includes(x)))throw new HttpError('FORBIDDEN',403);
   return new Response(null,{status:204,headers:{...securityHeaders,'access-control-allow-origin':origin,'access-control-allow-credentials':'true',vary:'Origin','access-control-allow-methods':'POST','access-control-allow-headers':allowed.join(', ')}});
  }
  if(request.method!=='POST')throw new HttpError('NOT_FOUND',404);
  const common={method:'POST',path:url.pathname,query:noQuery};
  if(match[2]==='apply')return dispatchCommand(request,workspace,{...common,schema:'CatalogApplyRequest',command:applyCatalogCommand()});
  const bytes=workspace.entropy.bytes(24);if(bytes.length!==24)throw new HttpError('INTERNAL_ERROR',500);
  return dispatchCommand(request,workspace,{...common,schema:'CatalogPreviewRequest',command:previewCatalogCommand('plan_'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join(''))});
 }catch(error){return toHttpError(error,crypto.randomUUID());}
}
