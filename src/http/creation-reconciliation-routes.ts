import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {verifyHumanSession} from '../auth/sessions';
import {csrfToken,assertCsrf} from '../auth/csrf';
import {resolveActor,type SessionRecord} from '../auth/authorize';
import {withTransaction} from '../storage/transaction';
import {fingerprintRequest} from '../workspace/idempotency';
import {prepareCreation,reconcilePreparedCreation} from '../workspace/creation-admissions';
import {reconcileCreation} from '../workspace/creation-reconciliation';
import {messageCreationAccess} from '../messages/commands';
import {taskCreationAccess,taskPreparationAccess} from '../tasks/commands';
import type {MessageCreateRequest,TaskCreateRequest} from './dto';
import {parseBoundedJson} from './bounds';
import {HttpError,securityHeaders,toHttpError,toHttpResponse} from './envelopes';
import {securityLog} from '../audit/redact';
/** Separate route owner: never admitted to mutation routing or scheduler repair. */
export const creationReconciliationPath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/(messages|tasks):(reconcile|prepare)$/;
export async function creationReconciliationRoutes(request:Request,workspace:AuthWorkspace):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);
 try{
  const url=new URL(request.url),match=creationReconciliationPath.exec(url.pathname);
  if(!match||match[1]!==workspace.workspaceId||!['POST','OPTIONS'].includes(request.method))throw new HttpError('NOT_FOUND',404);
  if(url.searchParams.size)throw new HttpError('INVALID_REQUEST',400);
  if(request.headers.has('authorization')||request.headers.has('x-runtime-token'))throw new HttpError('INVALID_REQUEST',400);
  const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace)),auth=installed.config.authentication;
  const redirect=auth.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const origin=new URL(redirect.redirect_uri).origin;
  if(url.origin!==origin||request.headers.get('origin')!==origin||!auth.allowed_origins.includes(origin))throw new HttpError('FORBIDDEN',403);
  headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');
  if(request.method==='OPTIONS'){
   const allowed=['content-type','idempotency-key','x-csrf-token','x-creation-admission'];
   if(request.headers.get('access-control-request-method')!=='POST'||(request.headers.get('access-control-request-headers')??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).some(x=>!allowed.includes(x)))throw new HttpError('FORBIDDEN',403);
   headers.set('access-control-allow-methods','POST');headers.set('access-control-allow-headers',allowed.join(', '));return new Response(null,{status:204,headers});
  }
  const admissionId=request.headers.get('x-creation-admission');
  if(request.headers.has('x-creation-admission')&&(!admissionId||!/^event_[a-f0-9]{48}$/.test(admissionId)||match[3]==='prepare'))throw new HttpError('INVALID_REQUEST',400);
  const key=request.headers.get('idempotency-key');if(!key)throw new HttpError('INVALID_REQUEST',400);
  const isMessage=match[2]==='messages',body=await parseBoundedJson(request,isMessage?'MessageCreateRequest':'TaskCreateRequest');
  const identity=await verifyHumanSession(workspace,request.headers.get('cookie'),workspace.clock.nowMs());
  if(identity.kind!=='human')throw new HttpError('UNAUTHENTICATED',401);
  const session=withTransaction(workspace.storage,tx=>{currentConfiguration(tx,workspace,installed.fence);resolveActor(tx,identity,workspace.clock.nowMs());return tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=?',[identity.sessionId])!;});
  assertCsrf(request,{csrfToken:await csrfToken(workspace,session),origin});
  // Fingerprint the original creation request, not this read route or a wrapper.
  const fingerprint=await fingerprintRequest('POST','/v2/workspaces/'+workspace.workspaceId+'/'+match[2],{},body);
  const context={workspace,requestId,idempotencyKey:key,fingerprint,admissionEpoch:installed.epoch,admissionGeneration:installed.fence.maintenanceGeneration};
  if(match[3]==='prepare'){const data=isMessage?await prepareCreation(context,identity,messageCreationAccess(),body as MessageCreateRequest):await prepareCreation(context,identity,taskPreparationAccess(),body as TaskCreateRequest);return toHttpResponse({status:200,data},requestId,headers);}
  if(admissionId){const data=isMessage?await reconcilePreparedCreation(context,identity,messageCreationAccess(),body as MessageCreateRequest,admissionId):await reconcilePreparedCreation(context,identity,taskCreationAccess(),body as TaskCreateRequest,admissionId);return toHttpResponse({status:200,data},requestId,headers);}
  if(isMessage){const result=reconcileCreation(context,identity,messageCreationAccess(),body as MessageCreateRequest);return toHttpResponse({status:200,data:result.status==='unknown'?result:{status:'confirmed',message:result.data}},requestId,headers);}
  const result=reconcileCreation(context,identity,taskCreationAccess(),body as TaskCreateRequest);return toHttpResponse({status:200,data:result.status==='unknown'?result:{status:'confirmed',task:result.data}},requestId,headers);
 }catch(error){securityLog(error,requestId);return toHttpError(error,requestId,headers);}
}
