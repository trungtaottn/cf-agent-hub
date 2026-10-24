import {AuthError,currentConfiguration,secret,type AuthWorkspace} from '../auth/context';
import {verifyNativeCredential} from '../auth/native';
import {verifyHumanSession} from '../auth/sessions';
import {resolveActor} from '../auth/authorize';
import {withTransaction} from '../storage/transaction';
import {sha256,canonicalJson} from '../config/bootstrap';
import type {Message,Event} from './dto';
import type {VerifiedIdentity} from '../workspace/context';
import {createCursorCodec,type CursorBinding} from './cursors';
import {readInbox,readThread,readEvents,projectMessage,assertReadAccess,assertCursorRetained} from '../messages/reads';
import {projectEvent,resourceEventVisibility} from '../audit/events';
import {HttpError,securityHeaders,toHttpError} from './envelopes';
export interface ReadTarget{operation:CursorBinding['operation'];threadId:string|null;}
export function parseReadQuery(params:URLSearchParams,operation:ReadTarget['operation']){
 const allowed=['cursor','limit',...(operation==='inbox'?['acknowledged']:operation==='events'?['after_sequence']:[])];
 for(const [key]of params)if(!allowed.includes(key)||params.getAll(key).length!==1)throw new HttpError('INVALID_REQUEST',400);
 const integer=(key:string,fallback:number,max:number,min:number)=>{
  const value=params.get(key);if(value===null)return fallback;
  if(!/^[0-9]+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max)throw new HttpError('INVALID_REQUEST',400);return Number(value);
 };
 const limit=integer('limit',operation==='thread'?100:50,operation==='thread'?500:200,1),afterSequence=integer('after_sequence',0,Number.MAX_SAFE_INTEGER,0);
 const ack=params.get('acknowledged');if(ack!==null&&ack!=='true'&&ack!=='false')throw new HttpError('INVALID_REQUEST',400);
 const token=params.get('cursor');if(token===''||token&&params.has('after_sequence'))throw new HttpError('INVALID_REQUEST',400);
 return {limit,afterSequence,acknowledged:ack==='true',token};
}
/** Crypto is outside SQL; the original verified proof survives every await until publication. */
export async function dispatchRead(request:Request,workspace:AuthWorkspace,target:ReadTarget):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);
 try{
  if(request.method!=='GET')throw new HttpError('NOT_FOUND',404);
  const url=new URL(request.url),query=parseReadQuery(url.searchParams,target.operation),bearer=request.headers.get('authorization'),cookie=request.headers.get('cookie');
  if(bearer&&cookie?.split(';').some(x=>x.trim().startsWith('cfhub_session=')))throw new HttpError('INVALID_REQUEST',400);
  const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace));
  const redirect=installed.config.authentication.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const origin=new URL(redirect.redirect_uri).origin;
  if(url.origin!==origin||request.headers.has('origin')&&(request.headers.get('origin')!==origin||!installed.config.authentication.allowed_origins.includes(origin)))throw new HttpError('FORBIDDEN',403);
  if(request.headers.has('origin')){headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');}
  let identity:VerifiedIdentity;
  if(bearer){const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(bearer);if(!match)throw new AuthError('UNAUTHENTICATED',401);identity=await verifyNativeCredential(workspace,match[1],workspace.clock.nowMs());}
  else identity=await verifyHumanSession(workspace,cookie,workspace.clock.nowMs());
  const queryHash=await sha256(canonicalJson({limit:query.limit,acknowledged:target.operation==='inbox'?query.acknowledged:null,threadId:target.threadId,sort:target.operation==='events'?'sequence:asc':'created_at,id:asc'}));
  const actor=withTransaction(workspace.storage,tx=>{currentConfiguration(tx,workspace,installed.epoch);return resolveActor(tx,identity,workspace.clock.nowMs());});
  const binding:CursorBinding={workspaceId:workspace.workspaceId,principalId:actor.principalId,lane:actor.kind,credentialId:actor.credentialId,sessionId:actor.sessionId,operation:target.operation,queryHash};
  const codec=createCursorCodec(secret(workspace,'CURSOR_ENCRYPTION_KEY'),workspace.entropy);
  const cursor=query.token?await codec.decodeCursor(query.token,binding,workspace.clock.nowMs()):undefined;
  const current=(tx:Parameters<typeof resolveActor>[0])=>{
   currentConfiguration(tx,workspace,installed.epoch);const nowMs=workspace.clock.nowMs(),live=resolveActor(tx,identity,nowMs);
   if(live.principalId!==binding.principalId||live.kind!==binding.lane||live.credentialId!==binding.credentialId||live.sessionId!==binding.sessionId)throw new AuthError('UNAUTHENTICATED',401);
   if(cursor&&cursor.expiresAt<=nowMs)throw new HttpError('CURSOR_EXPIRED',410);
   return {live,nowMs};
  };
  const prepared=withTransaction(workspace.storage,tx=>{
   const {live,nowMs}=current(tx),options={...query,binding,cursor,nowMs};
   return target.operation==='inbox'?readInbox(tx,live,options):target.operation==='thread'?readThread(tx,live,target.threadId!,options):readEvents(tx,live,options);
  });
  const nextCursor=prepared.cursor?await codec.encodeCursor(prepared.cursor):null;
  // No await follows this final actual-proof resolution and current resource projection.
  const data=withTransaction(workspace.storage,tx=>{
   const {live,nowMs}=current(tx);assertReadAccess(tx,live,target.operation,target.threadId,nowMs);assertCursorRetained(tx,cursor);assertCursorRetained(tx,prepared.cursor??undefined);
   if(prepared.cursor&&prepared.cursor.expiresAt<=nowMs)throw new HttpError('CURSOR_EXPIRED',410);
   return prepared.scannedIds.flatMap<Message|Event>(id=>{
    if(target.operation==='events'){const event=projectEvent(tx,live,id,nowMs,resourceEventVisibility);return event?[event]:[];}
    const message=projectMessage(tx,live,id,nowMs);if(!message||target.operation==='thread'&&message.thread_id!==target.threadId)return [];
    if(target.operation==='inbox'){
     const receipt=tx.one<{acknowledged_at:number|null}>('SELECT acknowledged_at FROM inbox WHERE message_id=? AND workspace_id=? AND recipient_agent_id=?',[id,live.workspaceId,live.agentId!]);
     if(!receipt||(receipt.acknowledged_at!==null)!==query.acknowledged)return [];
    }
    return [message];
   });
  });
  return Response.json({data,page:{next_cursor:nextCursor,has_more:nextCursor!==null},request_id:requestId},{headers});
 }catch(error){return toHttpError(error,requestId,headers);}
}
