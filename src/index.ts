import {taskPath} from './http/task-routes';
import {r2Routes,identityPath} from './http/r2-routes';
import {isUiRequest,serveUi} from './http/ui-routes';
import {operationsPath} from './http/operations-routes';
import {readinessPath} from './http/readiness-routes';
import {workspacePath} from './http/workspace-routes';
import {sweepCatalog} from './outbox/scheduler';
import {messagePath} from './http/message-routes';
import {settingsPath} from './http/settings-routes';
import { parseDeployment,resolveWorkspace } from './config/deployment';
import { authFailure,securityHeaders } from './http/auth-routes';
import { AuthError,cookieHeader } from './auth/context';
export { WorkspaceDO } from './workspace/workspace-do';
export default {
 async scheduled(_controller:ScheduledController,env:Env):Promise<void>{
  const raw=(env as unknown as Record<string,unknown>).DEPLOYMENT_CONFIG;if(typeof raw!=='string')return;
  try{const config=parseDeployment(JSON.parse(raw));await sweepCatalog(config.workspace_catalog,env.WORKSPACE);}catch{/* Missing operator configuration cannot discover or create tenants. */}
 },
 async fetch(request:Request,env:Env):Promise<Response> {
  const url=new URL(request.url);
  if(isUiRequest(request))return serveUi(request,env);
  if(request.method==='GET'&&url.pathname==='/health/live')return Response.json({status:'alive'},{headers:securityHeaders});
  const match=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/auth\/(start|callback|session|logout)$/.exec(url.pathname);
  const settings=settingsPath.exec(url.pathname),message=messagePath.exec(url.pathname),operations=operationsPath.exec(url.pathname),readiness=readinessPath.exec(url.pathname),base=workspacePath.exec(url.pathname);
  const identity=identityPath.exec(url.pathname),task=taskPath.exec(url.pathname);
  const selected=match??settings??message??operations??readiness??base??identity??task;
  if(selected) {
   try {
    const raw=(env as unknown as Record<string,unknown>).DEPLOYMENT_CONFIG;
    if(typeof raw!=='string')throw new AuthError('AUTH_UNAVAILABLE',503);
    const config=parseDeployment(JSON.parse(raw));
    if(!config.workspace_catalog.some(x=>x.workspace_id===selected[1]))throw new AuthError('UNAUTHENTICATED',401);
    const workspace=resolveWorkspace(config,selected[1]);return await env.WORKSPACE.getByName(workspace.objectName).fetch(request);
   }catch(error){const headers=new Headers(securityHeaders);if(match?.[2]==='callback')headers.append('set-cookie',cookieHeader('cfhub_login','',0));return authFailure(match?.[2]==='callback'&&(!(error instanceof AuthError)||error.status===503)?new AuthError('UNAUTHENTICATED',401):error,crypto.randomUUID(),headers);}
  }
  return r2Routes(request);
 }
};
