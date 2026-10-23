import { parseDeployment,resolveWorkspace } from './config/deployment';
import { authFailure,securityHeaders } from './http/auth-routes';
import { AuthError,cookieHeader } from './auth/context';
export { WorkspaceDO } from './workspace/workspace-do';
export default {
 async fetch(request:Request,env:Env):Promise<Response> {
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/health/live')return new Response('alive',{headers:{...securityHeaders,'content-type':'text/plain'}});
  const match=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/auth\/(start|callback|session|logout)$/.exec(url.pathname);
  if(match) {
   try {
    const raw=(env as unknown as Record<string,unknown>).DEPLOYMENT_CONFIG;
    if(typeof raw!=='string')throw new AuthError('AUTH_UNAVAILABLE',503);
    const config=parseDeployment(JSON.parse(raw));
    if(!config.workspace_catalog.some(x=>x.workspace_id===match[1]))throw new AuthError('UNAUTHENTICATED',401);
    const workspace=resolveWorkspace(config,match[1]);return await env.WORKSPACE.getByName(workspace.objectName).fetch(request);
   }catch(error){const headers=new Headers(securityHeaders);if(match[2]==='callback')headers.append('set-cookie',cookieHeader('cfhub_login','',0));return authFailure(match[2]==='callback'&&(!(error instanceof AuthError)||error.status===503)?new AuthError('UNAUTHENTICATED',401):error,crypto.randomUUID(),headers);}
  }
  return Response.json({error:{code:'NOT_FOUND',message:'Route unavailable',retryable:false,request_id:crypto.randomUUID()}},{status:404,headers:securityHeaders});
 }
};
