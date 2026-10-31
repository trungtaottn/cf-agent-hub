import {currentConfiguration,type AuthWorkspace,AuthError} from '../auth/context';
import {verifyNativeCredential} from '../auth/native';
import {verifyHumanSession} from '../auth/sessions';
import {resolveActor,authorize} from '../auth/authorize';
import {storedProfile} from '../config/profile';
import {withTransaction} from '../storage/transaction';
import type {Workspace,Scope} from './dto';
import {validateWorkspace} from './generated/auth-validators.js';
import {HttpError,securityHeaders,toHttpError,toHttpResponse} from './envelopes';
export const workspacePath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})$/;
const implementedDisplayScopes=new Set<string>(['workspace:read','agents:read','profile:edit','messages:send','messages:read','messages:ack','messages:review','events:read','operations:read','tasks:read','tasks:schedule','tasks:cancel','tasks:review','artifacts:read']);
export async function workspaceRoutes(request:Request,workspace:AuthWorkspace):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);
 try{
  const url=new URL(request.url),match=workspacePath.exec(url.pathname);
  if(request.method!=='GET'||!match||match[1]!==workspace.workspaceId)throw new HttpError('NOT_FOUND',404);
  if(url.searchParams.size)throw new HttpError('INVALID_REQUEST',400);
  const bearer=request.headers.get('authorization'),cookie=request.headers.get('cookie');
  if(request.headers.has('authorization')&&cookie?.split(';').some(x=>x.trim().startsWith('cfhub_session=')))throw new HttpError('INVALID_REQUEST',400);
  const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace));
  const redirect=installed.config.authentication.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const origin=new URL(redirect.redirect_uri).origin;
  if(url.origin!==origin||request.headers.has('origin')&&(request.headers.get('origin')!==origin||!installed.config.authentication.allowed_origins.includes(origin)))throw new AuthError('FORBIDDEN',403);
  if(request.headers.has('origin')){headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');}
  let identity;
  if(request.headers.has('authorization')){const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(bearer??'');if(!token)throw new AuthError('UNAUTHENTICATED',401);identity=await verifyNativeCredential(workspace,token[1],workspace.clock.nowMs());}
  else identity=await verifyHumanSession(workspace,cookie,workspace.clock.nowMs());
  const data=withTransaction(workspace.storage,tx=>{
   currentConfiguration(tx,workspace,installed.fence);
   const nowMs=workspace.clock.nowMs(),actor=resolveActor(tx,identity,nowMs);
   authorize(tx,actor,'workspace:read',undefined,nowMs);
   const profile=storedProfile(tx,actor).profile;
   const data:Workspace={id:workspace.workspaceId,display_name:profile.display_name,contract_revision:'0.1',actor:{kind:actor.kind,principal_id:actor.principalId,agent_id:actor.agentId},effective_scopes:[...actor.scopes].filter(scope=>implementedDisplayScopes.has(scope)&&(actor.kind==='human'?scope!=='messages:ack':!['profile:edit','messages:review','operations:read'].includes(scope))).sort() as Scope[]};
   if(!validateWorkspace(data))throw new HttpError('INTERNAL_ERROR',500);return data;
  });
  return toHttpResponse({status:200,data},requestId,headers);
 }catch(error){return toHttpError(error,requestId,headers);}
}
