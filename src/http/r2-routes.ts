import {createRuntimeCommand,heartbeatRuntimeCommand} from '../runtimes/commands';
import {hashRuntimeProof} from '../auth/runtime-proof';
import {HttpError,toHttpError,securityHeaders} from './envelopes';
import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {withTransaction} from '../storage/transaction';
import {sha256} from '../config/bootstrap';
import {dispatchCommand} from './router';
import {createAgentCommand,patchAgentCommand,archiveAgentCommand} from '../agents/commands';
import {issueCredentialCommand,revokeCredentialCommand} from '../auth/native-credentials';
import {dispatchIdentityRead} from './identity-read-routes';
export const identityPath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/(agents(?:\/[^/:]+(?::archive)?)?|credentials(?:\/[^/:]+:revoke)?|runtimes(?:\/[^/:]+:heartbeat)?)$/;
function noQuery(params:URLSearchParams):Record<string,never>{if(params.size)throw new HttpError('INVALID_REQUEST',400);return {};}
function opaqueId(workspace:AuthWorkspace,prefix:string):string{
 const bytes=workspace.entropy.bytes(24);if(bytes.length!==24)throw new HttpError('INTERNAL_ERROR',500);
 return prefix+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}
/** Only the owning mapped DO supplies workspace. All successor routes remain unavailable. */
export async function r2Routes(request:Request,workspace?:AuthWorkspace):Promise<Response>{
 try{
  const url=new URL(request.url),match=identityPath.exec(url.pathname);
  if(!workspace||!match||match[1]!==workspace.workspaceId)throw new HttpError('NOT_FOUND',404);
  const path=match[2],agent=path.startsWith('agents/'),credential=path.startsWith('credentials/');
  let id:string|null=null;
  if(agent||credential){try{id=decodeURIComponent(path.slice(path.indexOf('/')+1).replace(/:(archive|revoke)$/,''));}catch{throw new HttpError('INVALID_REQUEST',400);}if(!id)throw new HttpError('INVALID_REQUEST',400);}
  const read=path==='agents'||path==='credentials'||agent&&!path.endsWith(':archive');
  const method=path==='agents'||path==='credentials'?'POST':agent&&!path.endsWith(':archive')?'PATCH':'POST';
  if(request.method==='OPTIONS'){
   noQuery(url.searchParams);const {config}=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace)),auth=config.authentication;
   const redirect=auth.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
   const origin=new URL(redirect.redirect_uri).origin,methods=read?['GET',method]:[method],allowed=['content-type','idempotency-key','x-csrf-token','authorization','x-runtime-token'];
   if(url.origin!==origin||request.headers.get('origin')!==origin||!auth.allowed_origins.includes(origin)||!methods.includes(request.headers.get('access-control-request-method')??'')||(request.headers.get('access-control-request-headers')??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).some(x=>!allowed.includes(x)))throw new HttpError('FORBIDDEN',403);
   return new Response(null,{status:204,headers:{...securityHeaders,'access-control-allow-origin':origin,'access-control-allow-credentials':'true',vary:'Origin','access-control-allow-methods':methods.join(', '),'access-control-allow-headers':allowed.join(', ')}});
  }
  if(request.method==='GET'&&read)return dispatchIdentityRead(request,workspace,{operation:path==='agents'?'agents':path==='credentials'?'credentials':'agent',agentId:id});
  if(request.method!==method)throw new HttpError('NOT_FOUND',404);
  const common={method,path:url.pathname,query:noQuery};
  if(path==='runtimes')return dispatchCommand(request,workspace,{...common,schema:'RuntimeCreateRequest',command:async()=>{
   const bytes=workspace.entropy.bytes(32);if(bytes.length!==32)throw new HttpError('INTERNAL_ERROR',500);
   const token=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
   const prepared={runtimeId:opaqueId(workspace,'runtime_'),proofSha256:await sha256(token)};
   return {command:createRuntimeCommand(prepared),initialResponse:data=>({...data,runtime_token:token,revealed:true})};
  }});
  if(path.startsWith('runtimes/')){
   let runtimeId:string;try{runtimeId=decodeURIComponent(path.slice('runtimes/'.length,-':heartbeat'.length));}catch{throw new HttpError('INVALID_REQUEST',400);}
   return dispatchCommand(request,workspace,{...common,schema:'RuntimeHeartbeatRequest',command:async()=>({command:heartbeatRuntimeCommand(runtimeId,await hashRuntimeProof(request.headers.get('x-runtime-token')))})});
  }
  if(path==='agents')return dispatchCommand(request,workspace,{...common,schema:'AgentCreateRequest',command:createAgentCommand(opaqueId(workspace,'agent_'))});
  if(agent&&path.endsWith(':archive'))return dispatchCommand(request,workspace,{...common,schema:'AgentArchiveRequest',command:archiveAgentCommand(id!)});
  if(agent)return dispatchCommand(request,workspace,{...common,schema:'AgentPatchRequest',command:patchAgentCommand(id!)});
  if(credential)return dispatchCommand(request,workspace,{...common,schema:'CredentialRevokeRequest',command:revokeCredentialCommand(id!)});
  return dispatchCommand(request,workspace,{...common,schema:'CredentialCreateRequest',command:async()=>{
   // Preparation can race revocation; executeCommandDetailed resolves current proof after this await.
   const bytes=workspace.entropy.bytes(32);if(bytes.length!==32)throw new HttpError('INTERNAL_ERROR',500);
   const token=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
   const prepared={credentialId:opaqueId(workspace,'credential_'),tokenSha256:await sha256(token)};
   return {command:issueCredentialCommand(prepared),initialResponse:data=>({...data,token,revealed:true})};
  }});
 }catch(error){return toHttpError(error,crypto.randomUUID());}
}
