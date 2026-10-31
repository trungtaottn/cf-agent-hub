import {creationBindingDigest} from '../workspace/creation-admissions';
import {sha256} from '../config/bootstrap';
import {AuthError,currentConfiguration,type AuthWorkspace} from '../auth/context';
import {verifyNativeCredential} from '../auth/native';
import {verifyHumanSession} from '../auth/sessions';
import {csrfToken,assertCsrf} from '../auth/csrf';
import {resolveActor,type SessionRecord} from '../auth/authorize';
import {withTransaction} from '../storage/transaction';
import {executeCommandDetailed,type CommandDescriptor} from '../workspace/commands';
import {fingerprintRequest} from '../workspace/idempotency';
import type {AdmissionFence} from '../recovery/maintenance';
import type {VerifiedIdentity} from '../workspace/context';
import type {HttpSchemaName} from './generated/http-schemas';
import {parseBoundedJson} from './bounds';
import {HttpError,securityHeaders,toHttpError,toHttpResponse} from './envelopes';
import {securityLog} from '../audit/redact';
/** Private preparation result; raw secrets remain only in initialResponse closure. */
export interface PreparedCommand<B,T>{command:CommandDescriptor<B,T>;initialResponse?:(data:T)=>T;}
/** Original proof/fence only; preparation never receives cached authorization. */
export interface CommandPreparationContext{identity:VerifiedIdentity;fence:AdmissionFence;idempotencyKey:string;fingerprint:string;}
/** Constructed by the domain owner in the DO, never a public command descriptor. */
export interface CommandRoute<B,T>{method:string;path:string;schema:HttpSchemaName;schemaValidationValue?:(value:unknown)=>unknown;query(params:URLSearchParams):unknown;command:CommandDescriptor<B,T>|((body:B,context:CommandPreparationContext)=>Promise<PreparedCommand<B,T>>);}
/** Authenticated framework hook for domain owners. Does not register any public route. */
export async function dispatchCommand<B,T>(request:Request,workspace:AuthWorkspace,route:CommandRoute<B,T>):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);let executing=false;
 try{
  const url=new URL(request.url);
  if(request.method!==route.method||url.pathname!==route.path)throw new HttpError('NOT_FOUND',404);
  const bearer=request.headers.get('authorization'),cookie=request.headers.get('cookie');
  if(bearer&&cookie?.split(';').some(x=>x.trim().startsWith('cfhub_session=')))throw new HttpError('INVALID_REQUEST',400);
  const admissionId=request.headers.get('x-creation-admission');
  if(request.headers.has('x-creation-admission')&&(!admissionId||!/^event_[a-f0-9]{48}$/.test(admissionId)||request.headers.has('authorization')||request.headers.has('x-runtime-token')||!['MessageCreateRequest','TaskCreateRequest'].includes(route.schema)||!request.headers.has('origin')))throw new HttpError('INVALID_REQUEST',400);
  const key=request.headers.get('idempotency-key');if(!key)throw new HttpError('INVALID_REQUEST',400);
  const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace));
  const body=await parseBoundedJson(request,route.schema,route.schemaValidationValue) as B,query=route.query(url.searchParams);
  const auth=installed.config.authentication,redirect=auth.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId)!.redirect_uri,origin=new URL(redirect).origin;
  if(url.origin!==origin||request.headers.has('origin')&&request.headers.get('origin')!==origin)throw new HttpError('FORBIDDEN',403);
  if(request.headers.has('origin')){
   if(!auth.allowed_origins.includes(origin))throw new HttpError('FORBIDDEN',403);
   headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');
  }
  let identity:VerifiedIdentity;
  if(bearer){
   const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(bearer);if(!match)throw new AuthError('UNAUTHENTICATED',401);
   identity=await verifyNativeCredential(workspace,match[1],workspace.clock.nowMs());
  }else{
   identity=await verifyHumanSession(workspace,cookie,workspace.clock.nowMs());
   if(identity.kind!=='human')throw new AuthError('UNAUTHENTICATED',401);
   const sessionId=identity.sessionId;
   const session=withTransaction(workspace.storage,tx=>{currentConfiguration(tx,workspace,installed.fence);resolveActor(tx,identity,workspace.clock.nowMs());return tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=?',[sessionId])!;});
   assertCsrf(request,{csrfToken:await csrfToken(workspace,session),origin});
  }
  const fingerprint=await fingerprintRequest(route.method,route.path,query,body);
  const prepared=typeof route.command==='function'?await route.command(body,{identity,fence:installed.fence,idempotencyKey:key,fingerprint}):{command:route.command};
  let creationAdmission;
  if(admissionId){
   const principalId=withTransaction(workspace.storage,tx=>{currentConfiguration(tx,workspace,installed.fence);return resolveActor(tx,identity,workspace.clock.nowMs()).principalId;}),keyHash=await sha256(key);
   const bindingDigest=await creationBindingDigest({id:admissionId,workspaceId:workspace.workspaceId,principalId,operation:prepared.command.operation,target:prepared.command.target,keyHash,fingerprint});
   creationAdmission={id:admissionId,principalId,keyHash,bindingDigest};
  }
  executing=true;
  const result=executeCommandDetailed({workspace,requestId,idempotencyKey:key,fingerprint,admissionEpoch:installed.epoch,admissionGeneration:installed.fence.maintenanceGeneration,...(creationAdmission?{creationAdmission}:{})},identity,prepared.command,body);
  // No await follows commit. Projection is not passed to descriptors, persistence or logs.
  const outcome=result.firstExecution&&prepared.initialResponse?{...result.outcome,data:prepared.initialResponse(result.outcome.data)}:result.outcome;
  return toHttpResponse(outcome,requestId,headers);
 }catch(error){
  if(!executing)securityLog(error,requestId);
  return toHttpError(error,requestId,headers);
 }
}
