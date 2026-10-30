import {AuthError,currentConfiguration,secret,type AuthWorkspace} from '../auth/context';
import {verifyNativeCredential} from '../auth/native';
import {verifyHumanSession} from '../auth/sessions';
import {resolveActor,type SessionRecord} from '../auth/authorize';
import {csrfToken,assertCsrf} from '../auth/csrf';
import {hashRuntimeProof} from '../auth/runtime-proof';
import {withTransaction} from '../storage/transaction';
import {fingerprintRequest} from '../workspace/idempotency';
import {executeCommand} from '../workspace/commands';
import type {VerifiedIdentity} from '../workspace/context';
import type {ArtifactStageRequest,ArtifactCommitRequest} from './dto';
import {parseBoundedJson} from './bounds';
import {HttpError,securityHeaders,toHttpError,toHttpResponse} from './envelopes';
import {createCursorCodec,type CursorBinding} from './cursors';
import {canonicalJson,sha256} from '../config/bootstrap';
import {stageArtifactCommand} from '../artifacts/commands';
import {getArtifact} from '../artifacts/repository';
import {listArtifacts} from '../artifacts/reads';
import {uploadArtifactContent,commitArtifact,downloadArtifactContent,currentArtifactContext,type ArtifactOperationContext} from '../artifacts/content';
import {jsonBytes,TASK_RESPONSE_BYTES,TASK_CURSOR_BYTES} from '../tasks/bounds';
/** Internal composition seam only. Worker/DO do not register it until cleanup exclusion is reviewed. */
export async function artifactRoutes(request:Request,workspace:AuthWorkspace,bucket?:R2Bucket):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);
 try{
  const url=new URL(request.url),match=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/artifacts(?:\/([^/:]+)(\/content|:commit)?)?$/.exec(url.pathname);
  if(!match||match[1]!==workspace.workspaceId)throw new HttpError('NOT_FOUND',404);
  let id:string|null=null;try{id=match[2]?decodeURIComponent(match[2]):null;}catch{throw new HttpError('INVALID_REQUEST',400);}
  const content=match[3]==='/content',commit=match[3]===':commit',list=request.method==='GET'&&id===null,read=request.method==='GET';
  const methods=id===null?['GET','POST']:content?['GET','PUT']:commit?['POST']:['GET'];
  if(request.method==='OPTIONS'){
   if(url.search)throw new HttpError('INVALID_REQUEST',400);
   const {config}=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace)),auth=config.authentication,redirect=auth.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);
   if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
   const origin=new URL(redirect.redirect_uri).origin,allowed=['content-type','idempotency-key','x-csrf-token','authorization','x-runtime-token'];
   if(url.origin!==origin||request.headers.get('origin')!==origin||!auth.allowed_origins.includes(origin)||!methods.includes(request.headers.get('access-control-request-method')??'')||(request.headers.get('access-control-request-headers')??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).some(x=>!allowed.includes(x)))throw new HttpError('FORBIDDEN',403);
   return new Response(null,{status:204,headers:{...securityHeaders,'access-control-allow-origin':origin,'access-control-allow-credentials':'true',vary:'Origin','access-control-allow-methods':methods.join(', '),'access-control-allow-headers':allowed.join(', ')}});
  }
  if(!methods.includes(request.method))throw new HttpError('NOT_FOUND',404);
  const allowed=list?['limit','cursor','task_id']:[];for(const [key]of url.searchParams)if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)throw new HttpError('INVALID_REQUEST',400);
  const bearer=request.headers.get('authorization'),cookie=request.headers.get('cookie');if(bearer&&cookie?.split(';').some(x=>x.trim().startsWith('cfhub_session=')))throw new HttpError('INVALID_REQUEST',400);
  const key=read?'read':request.headers.get('idempotency-key');if(!key)throw new HttpError('INVALID_REQUEST',400);
  const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace));
  const auth=installed.config.authentication,redirect=auth.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);const origin=new URL(redirect.redirect_uri).origin;
  if(url.origin!==origin||request.headers.has('origin')&&(request.headers.get('origin')!==origin||!auth.allowed_origins.includes(origin)))throw new HttpError('FORBIDDEN',403);
  if(request.headers.has('origin')){headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');}
  let identity:VerifiedIdentity;
  if(bearer){const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(bearer);if(!token)throw new AuthError('UNAUTHENTICATED',401);identity=await verifyNativeCredential(workspace,token[1],workspace.clock.nowMs());}
  else{identity=await verifyHumanSession(workspace,cookie,workspace.clock.nowMs());if(identity.kind!=='human')throw new AuthError('UNAUTHENTICATED',401);if(!read){const sessionId=identity.sessionId,session=withTransaction(workspace.storage,tx=>{currentConfiguration(tx,workspace,installed.fence);resolveActor(tx,identity,workspace.clock.nowMs());return tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=?',[sessionId])!;});assertCsrf(request,{csrfToken:await csrfToken(workspace,session),origin});}}
  const ctx:ArtifactOperationContext={workspace,identity,requestId,idempotencyKey:key,admission:installed.fence,runtimeId:null,proofHash:null,bucket};
  if(!read){
   if(!bucket)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
   if(identity.kind==='agent'){
    ctx.proofHash=await hashRuntimeProof(request.headers.get('x-runtime-token'));
    ctx.runtimeId=withTransaction(workspace.storage,tx=>{const c=currentArtifactContext(tx,ctx);const rows=tx.all<{id:string}>('SELECT id FROM runtimes WHERE workspace_id=? AND credential_id=? AND proof_sha256=? LIMIT 2',[c.actor.workspaceId,c.actor.credentialId,ctx.proofHash]);if(rows.length!==1)throw new AuthError('UNAUTHENTICATED',401);return rows[0].id;});
   }else if(request.headers.has('x-runtime-token'))throw new HttpError('INVALID_REQUEST',400);
  }
  if(!read&&id===null){
   const body=await parseBoundedJson(request,'ArtifactStageRequest') as ArtifactStageRequest,random=workspace.entropy.bytes(24);if(random.length!==24)throw new HttpError('INTERNAL_ERROR',500);
   const artifactId='artifact_'+Array.from(random,x=>x.toString(16).padStart(2,'0')).join(''),fingerprint=await fingerprintRequest('POST',url.pathname,{},body);
   const outcome=executeCommand({workspace,requestId,idempotencyKey:key,fingerprint,admissionEpoch:ctx.admission.authorityEpoch,admissionGeneration:ctx.admission.maintenanceGeneration},identity,stageArtifactCommand(artifactId,ctx.runtimeId,ctx.proofHash),body);return toHttpResponse(outcome,requestId,headers);
  }
  if(!read&&content){
   if(request.headers.get('content-type')?.trim().toLowerCase()!=='application/octet-stream')throw new HttpError('INVALID_REQUEST',400);
   const length=request.headers.get('content-length');if(length!==null){if(!/^[0-9]+$/.test(length)||!Number.isSafeInteger(Number(length)))throw new HttpError('INVALID_REQUEST',400);ctx.declaredByteSize=Number(length);}
   const body=request.body??new ReadableStream<Uint8Array>({start(c){c.close();}});
   return toHttpResponse({status:200,data:await uploadArtifactContent(ctx,id!,body,key)},requestId,headers);
  }
  if(commit){const body=await parseBoundedJson(request,'ArtifactCommitRequest') as ArtifactCommitRequest;return toHttpResponse({status:200,data:await commitArtifact(ctx,id!,body)},requestId,headers);}
  if(content){const response=await downloadArtifactContent(ctx,id!);for(const [name,value]of headers)response.headers.set(name,value);return response;}
  const response=(data:unknown)=>{if(jsonBytes(data)>TASK_RESPONSE_BYTES)throw new HttpError('INTERNAL_ERROR',500);return Response.json(data,{headers});};
  if(!list)return response({data:withTransaction(workspace.storage,tx=>getArtifact(tx,currentArtifactContext(tx,ctx),id!)),request_id:requestId});
  const raw=url.searchParams.get('limit'),limit=raw===null?50:Number(raw),taskId=url.searchParams.get('task_id'),token=url.searchParams.get('cursor');
  if(raw!==null&&!/^[0-9]+$/.test(raw)||!Number.isSafeInteger(limit)||limit<1||limit>200||taskId===''||token!==null&&(!token||token.length>TASK_CURSOR_BYTES))throw new HttpError('INVALID_REQUEST',400);
  const queryHash=await sha256(canonicalJson({task_id:taskId,limit,order:'created_at,id:asc',epoch:ctx.admission.authorityEpoch,generation:ctx.admission.maintenanceGeneration}));
  const actor=withTransaction(workspace.storage,tx=>currentArtifactContext(tx,ctx).actor),binding:CursorBinding={workspaceId:actor.workspaceId,principalId:actor.principalId,lane:actor.kind,credentialId:actor.credentialId,sessionId:actor.sessionId,operation:'artifacts',queryHash};
  const codec=createCursorCodec(secret(workspace,'CURSOR_ENCRYPTION_KEY'),workspace.entropy),cursor=token?await codec.decodeCursor(token,binding,workspace.clock.nowMs()):undefined;
  const page=()=>withTransaction(workspace.storage,tx=>listArtifacts(tx,currentArtifactContext(tx,ctx),{limit,binding,cursor,...(taskId===null?{}:{task_id:taskId})}));
  const prepared=page(),next=prepared.next?await codec.encodeCursor(prepared.next):null,verified=page();
  const comparable=(p:typeof prepared)=>({...p,next:p.next?{...p.next,expiresAt:0}:null});
  if(canonicalJson(comparable(prepared))!==canonicalJson(comparable(verified)))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  if(prepared.next&&prepared.next.expiresAt<=workspace.clock.nowMs())throw new HttpError('CURSOR_EXPIRED',410);
  return response({data:verified.items,page:{has_more:verified.hasMore,next_cursor:next},request_id:requestId});
 }catch(error){return toHttpError(error,requestId,headers);}
}
