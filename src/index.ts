import {operationsPath} from './http/operations-routes';
import {sweepCatalog} from './outbox/scheduler';
import {messagePath} from './http/message-routes';
import {settingsPath} from './http/settings-routes';
import { parseDeployment,resolveWorkspace } from './config/deployment';
import { authFailure,securityHeaders } from './http/auth-routes';
import { AuthError,cookieHeader } from './auth/context';
import {HttpError,toHttpError} from './http/envelopes';
export { WorkspaceDO } from './workspace/workspace-do';
export default {
 async scheduled(_controller:ScheduledController,env:Env):Promise<void>{
  const raw=(env as unknown as Record<string,unknown>).DEPLOYMENT_CONFIG;if(typeof raw!=='string')return;
  try{const config=parseDeployment(JSON.parse(raw));await sweepCatalog(config.workspace_catalog,env.WORKSPACE);}catch{/* Missing operator configuration cannot discover or create tenants. */}
 },
 async fetch(request:Request,env:Env):Promise<Response> {
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/health/live')return new Response('alive',{headers:{...securityHeaders,'content-type':'text/plain'}});
  const match=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/auth\/(start|callback|session|logout)$/.exec(url.pathname);
  const settings=settingsPath.exec(url.pathname),message=messagePath.exec(url.pathname),operations=operationsPath.exec(url.pathname);
  if(match||settings||message||operations) {
   try {
    const raw=(env as unknown as Record<string,unknown>).DEPLOYMENT_CONFIG;
    if(typeof raw!=='string')throw new AuthError('AUTH_UNAVAILABLE',503);
    const config=parseDeployment(JSON.parse(raw));
    if(!config.workspace_catalog.some(x=>x.workspace_id===(match??settings??message??operations)![1]))throw new AuthError('UNAUTHENTICATED',401);
    const workspace=resolveWorkspace(config,(match??settings??message??operations)![1]);return await env.WORKSPACE.getByName(workspace.objectName).fetch(request);
   }catch(error){const headers=new Headers(securityHeaders);if(match?.[2]==='callback')headers.append('set-cookie',cookieHeader('cfhub_login','',0));return authFailure(match?.[2]==='callback'&&(!(error instanceof AuthError)||error.status===503)?new AuthError('UNAUTHENTICATED',401):error,crypto.randomUUID(),headers);}
  }
  return toHttpError(new HttpError('NOT_FOUND',404),crypto.randomUUID());
 }
};
