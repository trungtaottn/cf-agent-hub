import {currentConfiguration,type AuthWorkspace,AuthError} from '../auth/context';
import {verifyNativeCredential} from '../auth/native';
import {verifyHumanSession} from '../auth/sessions';
import {csrfToken,assertCsrf} from '../auth/csrf';
import {resolveActor,type SessionRecord} from '../auth/authorize';
import {withTransaction} from '../storage/transaction';
import type {VerifiedIdentity} from '../workspace/context';
import type {ProfileWriteRequest} from './dto';
import {dispatchCommand} from './router';
import {parseBoundedJson} from './bounds';
import {HttpError,securityHeaders,toHttpError,toHttpResponse} from './envelopes';
import {readConfiguration,readProfile,previewProfile,readPreferences,exportProfile,profileCommand,preferencesCommand} from '../config/settings-service';
import {securityLog} from '../audit/redact';
export const settingsPath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/(configuration|profile|profile:preview|profile:export|preferences)$/;
function noQuery(params:URLSearchParams):Record<string,never>{if(params.size)throw new HttpError('INVALID_REQUEST',400);return {};}
/** Only the mapped owning Durable Object constructs AuthWorkspace. */
export async function settingsRoutes(request:Request,workspace:AuthWorkspace):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);
 try{
  const url=new URL(request.url),match=settingsPath.exec(url.pathname);
  if(!match||match[1]!==workspace.workspaceId)throw new HttpError('NOT_FOUND',404);
  noQuery(url.searchParams);
  const endpoint=match[2],method=endpoint==='profile:preview'?'POST':endpoint==='profile:export'||endpoint==='configuration'?'GET':request.method==='PUT'?'PUT':'GET';
  if(request.method!==method&&request.method!=='OPTIONS')throw new HttpError('NOT_FOUND',404);
  if(request.method==='PUT'){
   if(endpoint==='profile')return dispatchCommand(request,workspace,{method:'PUT',path:url.pathname,schema:'ProfileWriteRequest',query:noQuery,command:profileCommand()});
   if(endpoint==='preferences'){
    // Entropy is prepared outside transactionSync, including a discarded allocation on replay.
    const recordId='pref_'+Array.from(workspace.entropy.bytes(16),x=>x.toString(16).padStart(2,'0')).join('');
    return dispatchCommand(request,workspace,{method:'PUT',path:url.pathname,schema:'PreferencesWriteRequest',query:noQuery,command:preferencesCommand(recordId)});
   }
  }
  const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace)),auth=installed.config.authentication,redirect=auth.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);
  if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const origin=new URL(redirect.redirect_uri).origin;
  if(url.origin!==origin||request.headers.has('origin')&&request.headers.get('origin')!==origin)throw new HttpError('FORBIDDEN',403);
  if(request.headers.has('origin')){
   if(!auth.allowed_origins.includes(origin))throw new HttpError('FORBIDDEN',403);
   headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');
  }
  if(request.method==='OPTIONS'){
   const methods=endpoint==='profile'||endpoint==='preferences'?['GET','PUT']:endpoint==='profile:preview'?['POST']:['GET'];
   if(!request.headers.has('origin')||!methods.includes(request.headers.get('access-control-request-method')??''))throw new HttpError('FORBIDDEN',403);
   const allowed=['content-type','idempotency-key','x-csrf-token','authorization'];
   if((request.headers.get('access-control-request-headers')??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).some(x=>!allowed.includes(x)))throw new HttpError('FORBIDDEN',403);
   headers.set('access-control-allow-methods',methods.join(', '));headers.set('access-control-allow-headers',allowed.join(', '));return new Response(null,{status:204,headers});
  }
  const bearer=request.headers.get('authorization'),cookie=request.headers.get('cookie');
  if(bearer&&cookie?.split(';').some(x=>x.trim().startsWith('cfhub_session=')))throw new HttpError('INVALID_REQUEST',400);
  let identity:VerifiedIdentity;
  if(bearer){const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(bearer);if(!token)throw new AuthError('UNAUTHENTICATED',401);identity=await verifyNativeCredential(workspace,token[1],workspace.clock.nowMs());}
  else identity=await verifyHumanSession(workspace,cookie,workspace.clock.nowMs());
  let body:ProfileWriteRequest|undefined;
  if(endpoint==='profile:preview'){
   if(identity.kind!=='human')throw new HttpError('FORBIDDEN',403);
   if(!request.headers.get('idempotency-key'))throw new HttpError('INVALID_REQUEST',400);
   body=await parseBoundedJson(request,'ProfileWriteRequest') as ProfileWriteRequest;
   const session=withTransaction(workspace.storage,tx=>{currentConfiguration(tx,workspace,installed.fence);resolveActor(tx,identity,workspace.clock.nowMs());return tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=?',[(identity as Extract<VerifiedIdentity,{kind:'human'}>).sessionId])!;});
   assertCsrf(request,{origin,csrfToken:await csrfToken(workspace,session)});
  }
  const data=withTransaction(workspace.storage,tx=>{
   currentConfiguration(tx,workspace,installed.fence);const nowMs=workspace.clock.nowMs(),actor=resolveActor(tx,identity,nowMs);
   if(endpoint==='configuration')return readConfiguration(tx,actor);
   if(endpoint==='profile')return readProfile(tx,actor);
   if(endpoint==='profile:export')return exportProfile(tx,actor);
   if(endpoint==='preferences')return readPreferences(tx,actor,nowMs);
   return previewProfile(tx,{actor,requestId,idempotencyKey:request.headers.get('idempotency-key')!,nowMs},body!);
  });
  return toHttpResponse({status:200,data},requestId,headers);
 }catch(error){securityLog(error,requestId);return toHttpError(error,requestId,headers);}
}
