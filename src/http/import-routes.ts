import {prepareStoredImport,assertImportIntegrity} from '../imports/integrity';
import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {verifyHumanSession} from '../auth/sessions';
import {resolveActor} from '../auth/authorize';
import {withTransaction} from '../storage/transaction';
import {dispatchCommand} from './router';
import {prepareImportPreview,prepareImportApply,importApplyValidationValue} from '../imports/commands';
import {getImport,readImport,importHuman,bytes,IMPORT_STORED_BYTES} from '../imports/repository';
import type {ImportEnvelope,ImportPreview,ImportApplyRequest,ImportReport} from './dto';
import {HttpError,toHttpError,securityHeaders} from './envelopes';
export const importPath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/(imports:preview|imports\/[^/:]+(?::apply)?)$/;
function noQuery(params:URLSearchParams):Record<string,never>{if(params.size)throw new HttpError('INVALID_REQUEST',400);return {};}
function opaque(workspace:AuthWorkspace,prefix:string):string{const value=workspace.entropy.bytes(24);if(value.length!==24)throw new HttpError('INTERNAL_ERROR',500);return prefix+Array.from(value,x=>x.toString(16).padStart(2,'0')).join('');}
export async function importRoutes(request:Request,workspace?:AuthWorkspace):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);
 try{
  const url=new URL(request.url),match=importPath.exec(url.pathname);if(!workspace||!match||match[1]!==workspace.workspaceId)throw new HttpError('NOT_FOUND',404);
  noQuery(url.searchParams);const preview=match[2]==='imports:preview',apply=match[2].endsWith(':apply'),read=!preview&&!apply;
  let id='';if(!preview){try{id=decodeURIComponent(match[2].slice('imports/'.length,apply?-':apply'.length:undefined));}catch{throw new HttpError('INVALID_REQUEST',400);}if(!id)throw new HttpError('INVALID_REQUEST',400);}
  if(request.method==='OPTIONS'||request.method==='GET'&&read){
   const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace)),auth=installed.config.authentication,redirect=auth.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);
   if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);const origin=new URL(redirect.redirect_uri).origin;
   if(url.origin!==origin||request.headers.has('origin')&&(request.headers.get('origin')!==origin||!auth.allowed_origins.includes(origin)))throw new HttpError('FORBIDDEN',403);
   if(request.headers.has('origin')){headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');}
   if(request.method==='OPTIONS'){
    const method=read?'GET':'POST',allowed=read?[]:['content-type','idempotency-key','x-csrf-token'];
    if(request.headers.get('origin')!==origin||request.headers.get('access-control-request-method')!==method||(request.headers.get('access-control-request-headers')??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).some(x=>!allowed.includes(x)))throw new HttpError('FORBIDDEN',403);
    headers.set('access-control-allow-methods',method);headers.set('access-control-allow-headers',allowed.join(', '));return new Response(null,{status:204,headers});
   }
   if(request.headers.has('authorization'))throw new HttpError('FORBIDDEN',403);
   const identity=await verifyHumanSession(workspace,request.headers.get('cookie'),workspace.clock.nowMs());
   const verified=await prepareStoredImport(workspace,{identity,fence:installed.fence},id);
   const data=withTransaction(workspace.storage,tx=>{currentConfiguration(tx,workspace,installed.fence);const nowMs=workspace.clock.nowMs(),actor=importHuman(tx,{actor:resolveActor(tx,identity,nowMs),nowMs});assertImportIntegrity(readImport(tx,actor,id),verified);return getImport(tx,{actor,nowMs},id);});
   const result={data,request_id:requestId};if(bytes(result)>IMPORT_STORED_BYTES)throw new HttpError('INTERNAL_ERROR',500);
   return Response.json(result,{headers});
  }
  if(request.method!=='POST'||read)throw new HttpError('NOT_FOUND',404);
  const common={method:'POST',path:url.pathname,query:noQuery};
  if(apply)return dispatchCommand<ImportApplyRequest,ImportReport>(request,workspace,{...common,schema:'ImportApplyRequest',schemaValidationValue:importApplyValidationValue,command:async(_body,proof)=>({command:await prepareImportApply(workspace,proof,id,Array.from({length:100},()=>opaque(workspace,'task_')))})});
  return dispatchCommand<ImportEnvelope,ImportPreview>(request,workspace,{...common,schema:'ImportEnvelope',command:async(body,proof)=>({command:await prepareImportPreview(workspace,proof,body,opaque(workspace,'import_'))})});
 }catch(error){return toHttpError(error,requestId,headers);}
}
