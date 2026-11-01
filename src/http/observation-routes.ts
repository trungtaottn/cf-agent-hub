import {AuthError,currentConfiguration,secret,type AuthWorkspace} from '../auth/context';
import {verifyNativeCredential} from '../auth/native';
import {verifyHumanSession} from '../auth/sessions';
import {resolveActor} from '../auth/authorize';
import {taskAccess} from '../tasks/repository';
import {hashRuntimeProof} from '../auth/runtime-proof';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {canonicalJson,sha256} from '../config/bootstrap';
import type {VerifiedIdentity} from '../workspace/context';
import type {ObservationEstablishRequest,ObservationBatchRequest,ObservationReplaceRequest} from './dto';
import {establishObservation,appendObservation,replaceObservation,observationOwnerStatus,observationOwner,type ObservationContext} from '../observations/service';
import {observationWorkPool,type ObservationWork} from '../observations/work';
import {validateObservationInput,jsonBytes,OBSERVATION_REQUEST_BYTES} from '../observations/validation';
import {selectedObservation,readObservations} from '../observations/reads';
import {observationSlots,clearObservations} from '../observations/repository';
import {createCursorCodec,type CursorBinding} from './cursors';
import {HttpError,toHttpError,securityHeaders} from './envelopes';
/** Native diagnostic transport, deliberately separate from domain commands. */
export const observationPath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/tasks\/([^/:]+)\/(observations(?::establish)?|observation-sessions:replace|observation-sessions\/([^/:]+)\/(records|owner-status))$/;
export function parseObservationQuery(params:URLSearchParams){
 for(const [key]of params)if(!['limit','cursor','expected_session_id'].includes(key)||params.getAll(key).length!==1)throw new HttpError('INVALID_REQUEST',400);
 const raw=params.get('limit'),limit=raw===null?50:Number(raw),token=params.get('cursor'),expected=params.get('expected_session_id');
 if(raw!==null&&!/^[0-9]+$/.test(raw)||!Number.isSafeInteger(limit)||limit<1||limit>50||expected!==null&&!/^obs_[a-f0-9]{48}$/.test(expected)||token!==null&&(!/^[A-Za-z0-9_-]{2048}$/.test(token)||expected===null))throw new HttpError('INVALID_REQUEST',400);
 return {limit,token,expectedSessionId:expected??undefined};
}
async function readBody(request:Request,work:ObservationWork):Promise<Uint8Array>{
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new HttpError('INVALID_REQUEST',400);
 const reader=request.body?.getReader();if(!reader)throw new HttpError('INVALID_REQUEST',400);const chunks:Uint8Array[]=[];let total=0,attempts=0;
 try{for(;;){work.check();if(++attempts>1024)throw new HttpError('LIMIT_EXCEEDED',413);const {done,value}=await work.wait(reader.read());if(done)break;if(!(value instanceof Uint8Array))throw new HttpError('INVALID_REQUEST',400);total+=value.byteLength;if(total>OBSERVATION_REQUEST_BYTES)throw new HttpError('LIMIT_EXCEEDED',413);chunks.push(new Uint8Array(value));}}
 finally{try{void reader.cancel().catch(()=>{});}catch{/* Never await an untrusted cancellation callback. */}try{reader.releaseLock();}catch{/* A timed-out pending read must not hold request admission. */}}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}work.check();return bytes;
}
export async function observationRoutes(request:Request,workspace:AuthWorkspace):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);let work:ObservationWork|undefined;let onAbort:(()=>void)|undefined;
 try{
  const url=new URL(request.url),match=observationPath.exec(url.pathname);if(!match||match[1]!==workspace.workspaceId)throw new HttpError('NOT_FOUND',404);
  let taskId:string;try{taskId=decodeURIComponent(match[2]);}catch{throw new HttpError('INVALID_REQUEST',400);}if(!taskId)throw new HttpError('INVALID_REQUEST',400);
  const action=match[3],read=action==='observations',status=match[5]==='owner-status',method=read||status?'GET':'POST';
  if(match[4]&&!/^obs_[a-f0-9]{48}$/.test(match[4]))throw new HttpError('INVALID_REQUEST',400);
  const query=read?parseObservationQuery(url.searchParams):undefined;if(!read&&url.searchParams.size)throw new HttpError('INVALID_REQUEST',400);
  const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace)),pilot=installed.config.workspace_policies.find(p=>p.workspace_id===workspace.workspaceId)?.observation_pilot;
  // No diagnostic table access, work allocation or body allocation when absent/disabled.
  if(!pilot?.enabled)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const auth=installed.config.authentication,redirect=auth.redirect_uris.find(r=>r.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const origin=new URL(redirect.redirect_uri).origin;if(url.origin!==origin||request.headers.has('origin')&&(request.headers.get('origin')!==origin||!auth.allowed_origins.includes(origin)))throw new HttpError('FORBIDDEN',403);
  if(request.headers.has('origin')){headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');}
  if(request.method==='OPTIONS'){
   if(request.headers.get('origin')!==origin||request.headers.get('access-control-request-method')!==method||(request.headers.get('access-control-request-headers')??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).some(s=>!['authorization','content-type','x-runtime-token'].includes(s)))throw new HttpError('FORBIDDEN',403);
   headers.set('access-control-allow-methods',method);headers.set('access-control-allow-headers','authorization, content-type, x-runtime-token');return new Response(null,{status:204,headers});
  }
  if(request.method!==method)throw new HttpError('NOT_FOUND',404);
  const bearer=request.headers.get('authorization'),cookie=request.headers.get('cookie');if(bearer&&cookie?.split(';').some(x=>x.trim().startsWith('cfhub_session=')))throw new HttpError('INVALID_REQUEST',400);
  let identity:VerifiedIdentity;if(bearer){const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(bearer);if(!token)throw new AuthError('UNAUTHENTICATED',401);identity=await verifyNativeCredential(workspace,token[1],workspace.clock.nowMs());}else identity=await verifyHumanSession(workspace,cookie,workspace.clock.nowMs());
  const pilotCanonical=canonicalJson(pilot);
  const current=(tx:WorkspaceTransaction):ObservationContext=>{
   const config=currentConfiguration(tx,workspace,installed.fence),livePilot=config.config.workspace_policies.find(p=>p.workspace_id===workspace.workspaceId)?.observation_pilot;
   if(!livePilot?.enabled||canonicalJson(livePilot)!==pilotCanonical)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
   const nowMs=workspace.clock.nowMs(),actor=resolveActor(tx,identity,nowMs);return {actor,nowMs,requestId,idempotencyKey:'diagnostic-only',pilot:livePilot,fence:config.fence,mappingDigest};
  };
  let mappingDigest='';withTransaction(workspace.storage,tx=>{const ctx=current(tx);if(!read&&ctx.actor.kind!=='agent')throw new HttpError('FORBIDDEN',403);});
  work=observationWorkPool(workspace.storage).acquire();const operation=work;onAbort=()=>operation.cancel();request.signal.addEventListener('abort',onAbort,{once:true});if(request.signal.aborted)operation.cancel();operation.check();
  mappingDigest=await operation.wait(sha256(pilotCanonical),true);withTransaction(workspace.storage,current);
  // Invalidation is itself a mutation: fresh resource/proof authority must precede it.
  const invalidate=(guard:(tx:WorkspaceTransaction,ctx:ObservationContext)=>void)=>{
   const stale=withTransaction(workspace.storage,tx=>{operation.check();const ctx=current(tx);guard(tx,ctx);const mismatch=observationSlots(tx).some(s=>s.authority_epoch!==ctx.fence.authorityEpoch||s.maintenance_generation!==ctx.fence.maintenanceGeneration||s.mapping_digest!==mappingDigest);if(mismatch)clearObservations(tx);return mismatch;});
   if(stale)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  };
  const serialize=(value:unknown)=>{const text=JSON.stringify(value);if(jsonBytes(value)>1048576)throw new HttpError('LIMIT_EXCEEDED',409);operation.check();return text;};
  if(read){
   invalidate((tx,ctx)=>{taskAccess(tx,ctx.actor,'tasks:read',taskId,ctx.nowMs);taskAccess(tx,ctx.actor,'events:read',taskId,ctx.nowMs);});
   const selection=withTransaction(workspace.storage,tx=>selectedObservation(tx,current(tx),taskId)),selectedSessionId=selection?.session_id??null;
   if(query!.expectedSessionId!==undefined&&selection&&query!.expectedSessionId!==selectedSessionId)throw new HttpError('VERSION_CONFLICT',409);
   const hash=await operation.wait(sha256(canonicalJson({taskId,sessionId:selectedSessionId,limit:query!.limit,order:'sequence:asc',authorityEpoch:installed.epoch,maintenanceGeneration:installed.fence.maintenanceGeneration})),true);
   const actor=withTransaction(workspace.storage,tx=>current(tx).actor),binding:CursorBinding={workspaceId:workspace.workspaceId,principalId:actor.principalId,lane:actor.kind,credentialId:actor.credentialId,sessionId:actor.sessionId,operation:'observation-records',queryHash:hash};
   const codec=createCursorCodec(secret(workspace,'CURSOR_ENCRYPTION_KEY'),workspace.entropy),cursor=query!.token?await operation.wait(codec.decodeCursor(query!.token,binding,workspace.clock.nowMs()),true):undefined;
   const get=()=>withTransaction(workspace.storage,tx=>{operation.check();const ctx=current(tx);if(ctx.actor.principalId!==binding.principalId||ctx.actor.kind!==binding.lane||ctx.actor.credentialId!==binding.credentialId||ctx.actor.sessionId!==binding.sessionId)throw new AuthError('UNAUTHENTICATED',401);return readObservations(tx,ctx,taskId,{expectedSessionId:query!.expectedSessionId,selectedSessionId,limit:query!.limit,binding,cursor});});
   const prepared=get(),token=prepared.next?await operation.wait(codec.encodeCursor(prepared.next),true):null,verified=get();
   const comparable=(page:typeof prepared)=>({...page,data:{...page.data,read_at:''},next:page.next?{...page.next,expiresAt:0}:null});if(canonicalJson(comparable(prepared))!==canonicalJson(comparable(verified)))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
   const text=serialize({data:verified.data,page:{next_cursor:token,has_more:verified.hasMore},request_id:requestId});
   const final=get();if(canonicalJson(comparable(final))!==canonicalJson(comparable(verified)))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
   if(prepared.next&&prepared.next.expiresAt<=workspace.clock.nowMs())throw new HttpError('CURSOR_EXPIRED',410);
   return new Response(text,{headers:{...Object.fromEntries(headers),'content-type':'application/json'}});
  }
  const proofHash=await operation.wait(hashRuntimeProof(request.headers.get('x-runtime-token')),true);withTransaction(workspace.storage,tx=>{const ctx=current(tx);for(const scope of ['tasks:execute','tasks:read','events:read'])taskAccess(tx,ctx.actor,scope,taskId,ctx.nowMs);});
  const kind=action==='observations:establish'?'establish':action==='observation-sessions:replace'?'replace':'append';
  const body=status?null:validateObservationInput(await readBody(request,operation),kind);operation.check();withTransaction(workspace.storage,current);
  const fingerprint=body?await operation.wait(sha256(canonicalJson({method,path:url.pathname,sessionId:match[4]??null,body})),true):'';
  invalidate((tx,ctx)=>{
   if(status){const slot=observationSlots(tx).find(s=>s.session_id===match[4]&&s.task_id===taskId&&s.workspace_id===ctx.actor.workspaceId&&s.agent_id===ctx.actor.agentId&&s.credential_id===ctx.actor.credentialId);if(!slot)throw new HttpError('FORBIDDEN',403);const run=tx.one<{fence:number}>('SELECT fence FROM runs WHERE workspace_id=? AND id=?',[ctx.actor.workspaceId,slot.run_id]);if(!run)throw new HttpError('FORBIDDEN',403);observationOwner(tx,ctx,taskId,slot.run_id,run.fence,proofHash);}
   else observationOwner(tx,ctx,taskId,(body as ObservationEstablishRequest).run_id,(body as ObservationEstablishRequest).fence,proofHash);
  });
  const bytes=workspace.entropy.bytes(24);if(bytes.length!==24)throw new HttpError('INTERNAL_ERROR',500);const newSessionId='obs_'+Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
  const text=withTransaction(workspace.storage,tx=>{
   operation.check();const ctx=current(tx);let data;
   if(status)data=observationOwnerStatus(tx,ctx,taskId,match[4],proofHash);
   else if(kind==='establish')data=establishObservation(tx,ctx,taskId,body as ObservationEstablishRequest,newSessionId,proofHash);
   else if(kind==='replace')data=replaceObservation(tx,ctx,taskId,body as ObservationReplaceRequest,newSessionId,fingerprint,proofHash);
   else data=appendObservation(tx,ctx,taskId,match[4],body as ObservationBatchRequest,fingerprint,proofHash);
   const serialized=serialize({data,request_id:requestId}),fresh=current(tx);if(status)observationOwnerStatus(tx,fresh,taskId,match[4],proofHash);else observationOwner(tx,fresh,taskId,(body as ObservationEstablishRequest).run_id,(body as ObservationEstablishRequest).fence,proofHash);operation.check();return serialized;
  });
  return new Response(text,{headers:{...Object.fromEntries(headers),'content-type':'application/json'}});
 }catch(error){return toHttpError(error,requestId,headers);}finally{if(onAbort)request.signal.removeEventListener('abort',onAbort);work?.finish();}
}
