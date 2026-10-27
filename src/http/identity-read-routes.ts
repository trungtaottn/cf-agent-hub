import {AuthError,currentConfiguration,secret,type AuthWorkspace} from '../auth/context';
import {verifyNativeCredential} from '../auth/native';
import {verifyHumanSession} from '../auth/sessions';
import {resolveActor} from '../auth/authorize';
import {withTransaction} from '../storage/transaction';
import {sha256,canonicalJson} from '../config/bootstrap';
import type {VerifiedIdentity} from '../workspace/context';
import {createCursorCodec,type CursorBinding} from './cursors';
import {getAgent} from '../agents/commands';
import {listAgents,listCredentials} from '../agents/reads';
import {HttpError,securityHeaders,toHttpError} from './envelopes';
export interface IdentityReadTarget{operation:'agents'|'credentials'|'agent';agentId:string|null;}
function parseQuery(params:URLSearchParams,single:boolean){
 for(const [key]of params)if(single||!['cursor','limit'].includes(key)||params.getAll(key).length!==1)throw new HttpError('INVALID_REQUEST',400);
 const raw=params.get('limit'),limit=raw===null?50:Number(raw),token=params.get('cursor');
 if(raw!==null&&!/^[0-9]+$/.test(raw)||!Number.isSafeInteger(limit)||limit<1||limit>200||token!==null&&(token.length===0||token.length>2048))throw new HttpError('INVALID_REQUEST',400);
 return {limit,token};
}
/** Read-only identity ingress. Every async boundary retains the original verified proof. */
export async function dispatchIdentityRead(request:Request,workspace:AuthWorkspace,target:IdentityReadTarget):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);
 try{
  if(request.method!=='GET')throw new HttpError('NOT_FOUND',404);
  const url=new URL(request.url),query=parseQuery(url.searchParams,target.operation==='agent'),bearer=request.headers.get('authorization'),cookie=request.headers.get('cookie');
  if(bearer&&cookie?.split(';').some(x=>x.trim().startsWith('cfhub_session=')))throw new HttpError('INVALID_REQUEST',400);
  const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace));
  const redirect=installed.config.authentication.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const origin=new URL(redirect.redirect_uri).origin;
  if(url.origin!==origin||request.headers.has('origin')&&(request.headers.get('origin')!==origin||!installed.config.authentication.allowed_origins.includes(origin)))throw new HttpError('FORBIDDEN',403);
  if(request.headers.has('origin')){headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');}
  let identity:VerifiedIdentity;
  if(bearer){const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(bearer);if(!match)throw new AuthError('UNAUTHENTICATED',401);identity=await verifyNativeCredential(workspace,match[1],workspace.clock.nowMs());}
  else identity=await verifyHumanSession(workspace,cookie,workspace.clock.nowMs());
  const current=(tx:Parameters<typeof resolveActor>[0])=>{currentConfiguration(tx,workspace,installed.fence);const nowMs=workspace.clock.nowMs();return {actor:resolveActor(tx,identity,nowMs),nowMs};};
  const bounded=(value:unknown)=>{const json=JSON.stringify(value);if(new TextEncoder().encode(json).byteLength>1048576)throw new HttpError('LIMIT_EXCEEDED',413);return new Response(json,{headers:new Headers({...Object.fromEntries(headers),'content-type':'application/json'})});};
  if(target.operation==='agent'){
   if(!target.agentId)throw new HttpError('INVALID_REQUEST',400);
   const data=withTransaction(workspace.storage,tx=>{const {actor,nowMs}=current(tx);return getAgent(tx,actor,target.agentId!,nowMs);});return bounded({data,request_id:requestId});
  }
  const queryHash=await sha256(canonicalJson({limit:query.limit,sort:'created_at,id:asc',authorityEpoch:installed.epoch,maintenanceGeneration:installed.fence.maintenanceGeneration}));
  const {actor}=withTransaction(workspace.storage,current);
  const binding:CursorBinding={workspaceId:workspace.workspaceId,principalId:actor.principalId,lane:actor.kind,credentialId:actor.credentialId,sessionId:actor.sessionId,operation:target.operation,queryHash};
  const codec=createCursorCodec(secret(workspace,'CURSOR_ENCRYPTION_KEY'),workspace.entropy),cursor=query.token?await codec.decodeCursor(query.token,binding,workspace.clock.nowMs()):undefined;
  const read=()=>withTransaction(workspace.storage,tx=>{
   const {actor:live,nowMs}=current(tx);
   if(live.principalId!==binding.principalId||live.kind!==binding.lane||live.sessionId!==binding.sessionId||live.credentialId!==binding.credentialId)throw new AuthError('UNAUTHENTICATED',401);
   const options={limit:query.limit,nowMs,binding,cursor};return target.operation==='agents'?listAgents(tx,live,options):listCredentials(tx,live,options);
  });
  const prepared=read(),nextCursor=prepared.next?await codec.encodeCursor(prepared.next):null;
  if(nextCursor&&nextCursor.length>2048)throw new HttpError('LIMIT_EXCEEDED',413);
  // Re-read after cursor encryption: do not publish a stale row or hidden continuation.
  // A concurrent metadata/visibility change fails the whole request, not a partial page.
  const verified=read();
  const comparable=(p:typeof prepared)=>({items:p.items,hasMore:p.hasMore,next:p.next?{...p.next,expiresAt:0}:null});
  if(canonicalJson(comparable(prepared))!==canonicalJson(comparable(verified)))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  if(prepared.next&&prepared.next.expiresAt<=workspace.clock.nowMs())throw new HttpError('CURSOR_EXPIRED',410);
  return bounded({data:verified.items,page:{next_cursor:nextCursor,has_more:verified.hasMore},request_id:requestId});
 }catch(error){return toHttpError(error,requestId,headers);}
}
