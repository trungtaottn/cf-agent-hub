import {referenceBudget} from '../auth/resource-visibility';
import {admissionOpen} from '../recovery/maintenance';
import type {AuthWorkspace} from '../auth/context';
import {currentConfiguration,secret} from '../auth/context';
import {parseDeployment} from '../config/deployment';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {participantCanReadMessages,threadParticipants,type Participant} from '../messages/references';
import {liveAttempt,validateIntent,type DeliveryAttempt,type DeliveryResult} from './repository';
import {egressAllowed,classifyResponse} from './egress';
const utf8=new TextEncoder();
const base64url=(bytes:Uint8Array)=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
export async function signNotification(deliveryId:string,payloadJson:string,keyBinding:string,nowMs:number):Promise<Headers>{
 const keyBytes=utf8.encode(keyBinding),timestamp=Math.floor(nowMs/1000);
 if(keyBytes.byteLength<32||!Number.isSafeInteger(timestamp)||timestamp<0)throw Error('INVALID_SIGNING_CONFIGURATION');
 const encodedId=base64url(utf8.encode(JSON.stringify(deliveryId)));
 const prefix=utf8.encode('cf-agent-hub-notification-v1\n'+encodedId+'\n'+timestamp+'\n'),body=utf8.encode(payloadJson);
 const preimage=new Uint8Array(prefix.length+body.length);preimage.set(prefix);preimage.set(body,prefix.length);
 const key=await crypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const tag=await crypto.subtle.sign('HMAC',key,preimage);
 return new Headers({'Content-Type':'application/json','X-CF-Agent-Hub-Delivery-Id':encodedId,'X-CF-Agent-Hub-Timestamp':String(timestamp),'X-CF-Agent-Hub-Signature':'v1='+base64url(new Uint8Array(tag))});
}
interface PreparedDestination{url:string;signingKeyRef:string;}
type Checked={ok:true;destination:PreparedDestination}|{ok:false;result:DeliveryResult};
/** All mutable authority and the exact claim are read synchronously immediately before fetch. */
function check(tx:WorkspaceTransaction,workspace:AuthWorkspace,attempt:DeliveryAttempt,nowMs:number):Checked{
 if(!admissionOpen(tx,attempt.admissionFence)||tx.one<{admission_state:string}>('SELECT admission_state FROM workspace_metadata WHERE id=1')?.admission_state!=='installed')return {ok:false,result:{kind:'paused'}};
 const row=liveAttempt(tx,attempt,nowMs);if(!row)return {ok:false,result:{kind:'obsolete'}};
 const intent=validateIntent(tx,row);if(!intent)return {ok:false,result:{kind:'permanent',category:'invalid_intent'}};
 try{
  const installed=currentConfiguration(tx,workspace),config=parseDeployment(installed.config);
  if(config.config_epoch!==installed.epoch||!config.workspace_catalog.some(x=>x.workspace_id===workspace.workspaceId&&x.object_name===workspace.objectName))return {ok:false,result:{kind:'permanent',category:'authority_revoked'}};
  const policy=config.workspace_policies.find(x=>x.workspace_id===workspace.workspaceId);
  const destination=policy?.notification_destinations.find(d=>d.destination_id===attempt.destinationId);
  if(!destination||!destination.enabled)return {ok:false,result:{kind:'permanent',category:'destination_disabled'}};
  if(destination.agent_id!==intent.destination.agent_id||destination.url!==intent.destination.url||destination.signing_key_ref!==intent.destination.signing_key_ref)return {ok:false,result:{kind:'permanent',category:'destination_changed'}};
  if(!egressAllowed(destination.url,policy!.notification_destinations.filter(d=>d.enabled).map(d=>d.url)))return {ok:false,result:{kind:'permanent',category:'egress_denied'}};
  const message=tx.one<{sender_kind:'human'|'agent';sender_principal_id:string;sender_agent_id:string|null;refs_json:string}>('SELECT sender_kind,sender_principal_id,sender_agent_id,refs_json FROM messages WHERE id=? AND workspace_id=?',[attempt.notification.message_id,workspace.workspaceId])!;
  if(message.sender_kind!=='human'&&message.sender_kind!=='agent'||message.sender_kind==='agent'&&(message.sender_agent_id===null||message.sender_principal_id!==message.sender_agent_id)||message.sender_kind==='human'&&message.sender_agent_id!==null)return {ok:false,result:{kind:'permanent',category:'invalid_intent'}};
  const sender:Participant={kind:message.sender_kind,id:message.sender_kind==='agent'?message.sender_agent_id!:message.sender_principal_id};
  const recipient:Participant={kind:'agent',id:intent.notification.recipient_agent_id};
  const participants=threadParticipants(tx,workspace.workspaceId,intent.notification.thread_id);
  const member=(p:Participant)=>participants.some(x=>x.kind===p.kind&&x.id===p.id);
  const refs:unknown=JSON.parse(message.refs_json);
  if(!Array.isArray(refs)||refs.some(r=>!r||typeof r!=='object'||Object.keys(r).length!==2||!['message','task','artifact'].includes(r.kind)||typeof r.id!=='string'||!r.id))return {ok:false,result:{kind:'permanent',category:'invalid_intent'}};
  const resources=[intent.notification.message_id],budget=referenceBudget();
  if(!member(sender)||!member(recipient)||!participants.every(participant=>participantCanReadMessages(tx,workspace.workspaceId,participant,resources,nowMs,participant.kind===sender.kind&&participant.id===sender.id?'messages:send':undefined,budget)))return {ok:false,result:{kind:'permanent',category:'authority_revoked'}};
  return {ok:true,destination:{url:destination.url,signingKeyRef:destination.signing_key_ref}};
 }catch{return {ok:false,result:{kind:'permanent',category:'authority_revoked'}};}
}
export interface DispatcherOptions{fetch?:typeof fetch;sign?:typeof signNotification;}
export class DeliveryDispatcher{
 constructor(readonly workspace:AuthWorkspace,private readonly options:DispatcherOptions={}){}
 async dispatchAttempt(attempt:DeliveryAttempt):Promise<DeliveryResult>{
  const {workspace}=this;
  const before=withTransaction(workspace.storage,tx=>check(tx,workspace,attempt,workspace.clock.nowMs()));
  if(!before.ok)return before.result;
  let headers:Headers;
  try{headers=await (this.options.sign??signNotification)(attempt.deliveryId,attempt.payloadJson,secret(workspace,before.destination.signingKeyRef),workspace.clock.nowMs());}
  catch{return {kind:'permanent',category:'signing_unavailable'};}
  const final=withTransaction(workspace.storage,tx=>check(tx,workspace,attempt,workspace.clock.nowMs()));
  if(!final.ok)return final.result;
  // No await between the authoritative check and invoking fetch. No caller headers are forwarded.
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await (this.options.fetch??fetch)(final.destination.url,{method:'POST',headers,body:utf8.encode(attempt.payloadJson),redirect:'manual',signal:controller.signal});
   const result=classifyResponse(response,workspace.clock.nowMs());void response.body?.cancel().catch(()=>{});return result;
  }catch{return {kind:'transient',category:controller.signal.aborted?'timeout':'network'};}
  finally{clearTimeout(timer);}
 }
}
