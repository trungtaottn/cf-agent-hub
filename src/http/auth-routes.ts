import { validateAuthStartRequest,validateAuthLogoutRequest,validateAuthCallbackQuery } from './generated/auth-validators.js';
import type { AuthStartDataResponse,AuthSessionResponse,AuthLogoutDataResponse } from './dto';
import { beginLogin,completeLogin,verifyHumanSession,revokeSession } from '../auth/sessions';
import { csrfToken,assertCsrf } from '../auth/csrf';
import { resolveActor,type SessionRecord } from '../auth/authorize';
import { AuthError,currentConfiguration,cookieHeader,readCookie,type AuthWorkspace } from '../auth/context';
import { withTransaction } from '../storage/transaction';
import {parseBoundedJson} from './bounds';
import {HttpError,toHttpError,securityHeaders} from './envelopes';
import {securityLog} from '../audit/redact';
export {securityHeaders};
export function authFailure(error:unknown,requestId:string,headers:Headers):Response{
 const known=error instanceof AuthError||error instanceof HttpError?error:new AuthError('AUTH_UNAVAILABLE',503);
 securityLog(known,requestId);return toHttpError(known,requestId,headers);
}
export async function authRoutes(request:Request,workspace:AuthWorkspace):Promise<Response> {
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders),url=new URL(request.url),route=url.pathname.split('/').at(-1);
 if(route==='callback')headers.append('set-cookie',cookieHeader('cfhub_login','',0));
 try {
  if(request.headers.has('authorization')&&request.headers.get('cookie')?.split(';').some(x=>x.trim().startsWith('cfhub_session=')))throw new AuthError('INVALID_REQUEST',400);
  const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace)),auth=installed.config.authentication;
  const redirect=auth.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId)!.redirect_uri,origin=new URL(redirect).origin;
  if(url.origin!==origin)throw new AuthError('FORBIDDEN',403);
  if(request.headers.has('origin')) {
   if(request.headers.get('origin')!==origin||!auth.allowed_origins.includes(origin))throw new AuthError('FORBIDDEN',403);
   headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');
  }
  if(request.method==='OPTIONS') {
   if(request.headers.get('origin')!==origin||!['GET','POST'].includes(request.headers.get('access-control-request-method')??'')||
    (request.headers.get('access-control-request-headers')??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).some(x=>!['content-type','x-csrf-token'].includes(x)))throw new AuthError('FORBIDDEN',403);
   headers.set('access-control-allow-methods','GET, POST');headers.set('access-control-allow-headers','Content-Type, X-CSRF-Token');return new Response(null,{status:204,headers});
  }
  if(route==='start'&&request.method==='POST') {
   if(request.headers.get('origin')!==origin)throw new AuthError('FORBIDDEN',403);
   const input=await parseBoundedJson(request,'AuthStartRequest');if(!validateAuthStartRequest(input))throw new AuthError('INVALID_REQUEST',400);
   withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace,installed.fence));
   const started=await beginLogin(workspace,input.return_path,origin);withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace,installed.fence));headers.append('set-cookie',cookieHeader('cfhub_login',started.cookie,300));
   return Response.json({data:{authorization_url:started.authorizationUrl},request_id:requestId} satisfies AuthStartDataResponse,{headers});
  }
  if(route==='callback'&&request.method==='GET') {
   const entries=Array.from(url.searchParams.entries());if(entries.length!==2||entries.filter(([k])=>k==='code').length!==1||entries.filter(([k])=>k==='state').length!==1)throw new AuthError('INVALID_REQUEST',400);
   const code=url.searchParams.get('code')!,state=url.searchParams.get('state')!;
   if(!validateAuthCallbackQuery({code,state}))throw new AuthError('INVALID_REQUEST',400);
   if(url.origin+url.pathname!==redirect)throw new AuthError('INVALID_REQUEST',400);
   const issue=await completeLogin(workspace,code,state,readCookie(request.headers.get('cookie'),'cfhub_login'),readCookie(request.headers.get('cookie'),'cfhub_session'));
   withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace,installed.fence));
   headers.append('set-cookie',cookieHeader('cfhub_session',issue.cookie,(issue.expiresAt-workspace.clock.nowMs())/1000));headers.set('location',issue.returnPath);return new Response(null,{status:302,headers});
  }
  if((route==='session'&&request.method==='GET')||(route==='logout'&&request.method==='POST')) {
   if(url.search)throw new AuthError('INVALID_REQUEST',400);
   if(route==='logout'&&!validateAuthLogoutRequest(await parseBoundedJson(request,'AuthLogoutRequest')))throw new AuthError('INVALID_REQUEST',400);
   const identity=await verifyHumanSession(workspace,request.headers.get('cookie'),workspace.clock.nowMs());
   if(identity.kind!=='human')throw new AuthError('UNAUTHENTICATED',401);
   const session=withTransaction(workspace.storage,tx=>{resolveActor(tx,identity,workspace.clock.nowMs());return tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=?',[identity.sessionId])!;});
   const token=await csrfToken(workspace,session);
   if(route==='logout')assertCsrf(request,{csrfToken:token,origin});
   // HMAC is an external await: re-read config epoch, grant, and original session before response/effect.
   const actor=withTransaction(workspace.storage,tx=>{
    currentConfiguration(tx,workspace,installed.fence);const current=resolveActor(tx,identity,workspace.clock.nowMs());
    if(route==='logout')revokeSession(tx,identity.sessionId,workspace.clock.nowMs());return current;
   });
   if(route==='logout'){headers.append('set-cookie',cookieHeader('cfhub_session','',0));return Response.json({data:{logged_out:true},request_id:requestId} satisfies AuthLogoutDataResponse,{headers});}
   return Response.json({data:{actor:{kind:'human',principal_id:actor.principalId,agent_id:null},csrf_token:token,expires_at:new Date(session.expires_at).toISOString()},request_id:requestId} satisfies AuthSessionResponse,{headers});
  }
  throw new AuthError('INVALID_REQUEST',400);
 } catch(error){return authFailure(route==='callback'&&(!(error instanceof AuthError)||error.status===503)?new AuthError('UNAUTHENTICATED',401):error,requestId,headers);}
}
