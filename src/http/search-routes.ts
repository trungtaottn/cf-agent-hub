import {AuthError,currentConfiguration,secret,type AuthWorkspace} from '../auth/context';
import {verifyNativeCredential} from '../auth/native';
import {verifyHumanSession} from '../auth/sessions';
import {resolveActor} from '../auth/authorize';
import {withTransaction} from '../storage/transaction';
import {sha256,canonicalJson} from '../config/bootstrap';
import type {VerifiedIdentity} from '../workspace/context';
import {createCursorCodec,type CursorBinding} from './cursors';
import {prepareSearchWorkspace,revalidateSearchWorkspace,normalizeSearchQuery,type SearchKind} from '../search/query';
import {TASK_RESPONSE_BYTES,TASK_CURSOR_BYTES,jsonBytes} from '../tasks/bounds';
import {HttpError,securityHeaders,toHttpError} from './envelopes';
export const searchPath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/search$/;
export function parseSearchQuery(params:URLSearchParams){
 for(const [key]of params)if(!['q','kind','limit','cursor'].includes(key)||params.getAll(key).length!==1)throw new HttpError('INVALID_REQUEST',400);
 const q=normalizeSearchQuery(params.get('q')),raw=params.get('limit'),limit=raw===null?50:Number(raw),token=params.get('cursor'),kind=params.get('kind');
 if(raw!==null&&!/^[0-9]+$/.test(raw)||!Number.isSafeInteger(limit)||limit<1||limit>200||token!==null&&(token.length===0||token.length>TASK_CURSOR_BYTES)||kind!==null&&!['task','message','artifact'].includes(kind))throw new HttpError('INVALID_REQUEST',400);
 return {q,limit,token,...(kind===null?{}:{kind:kind as SearchKind})};
}
export async function searchRoutes(request:Request,workspace:AuthWorkspace):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);
 try{
  const url=new URL(request.url),match=searchPath.exec(url.pathname);if(!match||match[1]!==workspace.workspaceId||!['GET','OPTIONS'].includes(request.method))throw new HttpError('NOT_FOUND',404);
  const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace));
  const redirect=installed.config.authentication.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const origin=new URL(redirect.redirect_uri).origin;
  if(url.origin!==origin||request.headers.has('origin')&&(request.headers.get('origin')!==origin||!installed.config.authentication.allowed_origins.includes(origin)))throw new HttpError('FORBIDDEN',403);
  if(request.headers.has('origin')){headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');}
  if(request.method==='OPTIONS'){
   if(url.searchParams.size||request.headers.get('origin')!==origin||request.headers.get('access-control-request-method')!=='GET'||(request.headers.get('access-control-request-headers')??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).some(x=>x!=='authorization'))throw new HttpError('FORBIDDEN',403);
   headers.set('access-control-allow-methods','GET');headers.set('access-control-allow-headers','authorization');return new Response(null,{status:204,headers});
  }
  const query=parseSearchQuery(url.searchParams),bearer=request.headers.get('authorization'),cookie=request.headers.get('cookie');
  if(bearer&&cookie?.split(';').some(x=>x.trim().startsWith('cfhub_session=')))throw new HttpError('INVALID_REQUEST',400);
  let identity:VerifiedIdentity;
  if(bearer){const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(bearer);if(!match)throw new AuthError('UNAUTHENTICATED',401);identity=await verifyNativeCredential(workspace,match[1],workspace.clock.nowMs());}
  else identity=await verifyHumanSession(workspace,cookie,workspace.clock.nowMs());
  const current=(tx:Parameters<typeof resolveActor>[0])=>{currentConfiguration(tx,workspace,installed.fence);const nowMs=workspace.clock.nowMs();return {actor:resolveActor(tx,identity,nowMs),nowMs};};
  const queryHash=await sha256(canonicalJson({q:query.q,kind:query.kind??null,limit:query.limit,sort:'created_at,id:asc',authorityEpoch:installed.epoch,incarnation:installed.fence.maintenanceGeneration}));
  const {actor}=withTransaction(workspace.storage,current);
  const binding:CursorBinding={workspaceId:workspace.workspaceId,principalId:actor.principalId,lane:actor.kind,credentialId:actor.credentialId,sessionId:actor.sessionId,operation:'search',queryHash};
  const codec=createCursorCodec(secret(workspace,'CURSOR_ENCRYPTION_KEY'),workspace.entropy),cursor=query.token?await codec.decodeCursor(query.token,binding,workspace.clock.nowMs()):undefined;
  const live=(tx:Parameters<typeof resolveActor>[0])=>{const ctx=current(tx),a=ctx.actor;if(a.principalId!==binding.principalId||a.kind!==binding.lane||a.sessionId!==binding.sessionId||a.credentialId!==binding.credentialId)throw new AuthError('UNAUTHENTICATED',401);return ctx;};
  const options={q:query.q,kind:query.kind,limit:query.limit,binding,cursor};
  const prepared=withTransaction(workspace.storage,tx=>prepareSearchWorkspace(tx,live(tx),options));
  const token=prepared.page.next?await codec.encodeCursor(prepared.page.next):null;
  // The final SQL proof/graph checks have no subsequent await or scheduler repair.
  const verified=withTransaction(workspace.storage,tx=>revalidateSearchWorkspace(tx,live(tx),options,prepared));
  const comparable=(p:typeof verified)=>({...p,next:p.next?{...p.next,expiresAt:0}:null});
  if(canonicalJson(comparable(prepared.page))!==canonicalJson(comparable(verified)))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const response={data:verified.items,page:{next_cursor:token,has_more:verified.hasMore},request_id:requestId};
  if(jsonBytes(response)>TASK_RESPONSE_BYTES)throw new HttpError('INTERNAL_ERROR',500);
  return Response.json(response,{headers});
 }catch(error){return toHttpError(error,requestId,headers);}
}
