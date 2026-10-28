import {parseDeployment} from '../config/deployment';
import {HttpError,toHttpError,securityHeaders} from './envelopes';
const documents=new Set(['/','/overview','/activity','/inbox','/settings','/tasks']);
const assets=new Set(['/ui/app.js','/ui/styles.css']);
export function isUiRequest(request:Request):boolean{
 const path=new URL(request.url).pathname;return (request.method==='GET'||request.method==='HEAD')&&(documents.has(path)||assets.has(path));
}
/** Only public static assets and a non-secret configured workspace ID enter the shell. */
export async function serveUi(request:Request,env:Env):Promise<Response>{
 try{
  const bindings=env as unknown as {ASSETS?:{fetch(request:Request):Promise<Response>};DEPLOYMENT_CONFIG?:string},url=new URL(request.url);
  if(!bindings.ASSETS)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  let workspace='';
  if(documents.has(url.pathname)){
   if(typeof bindings.DEPLOYMENT_CONFIG!=='string')throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
   const config=parseDeployment(JSON.parse(bindings.DEPLOYMENT_CONFIG));
   const candidates=config.workspace_catalog.filter(item=>config.authentication.redirect_uris.some(redirect=>redirect.workspace_id===item.workspace_id&&new URL(redirect.redirect_uri).origin===url.origin));
   const selected=url.searchParams.get('workspace');
   if(selected!==null){
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(selected)||!candidates.some(item=>item.workspace_id===selected))throw new HttpError('NOT_FOUND',404);
    workspace=selected;
   }else if(candidates.length===1)workspace=candidates[0]!.workspace_id;
   url.pathname='/ui/index.html';url.search='';
  }
  const response=await bindings.ASSETS.fetch(new Request(url,request));
  if(!response.ok)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const headers=new Headers(response.headers);for(const [key,value]of Object.entries(securityHeaders))headers.set(key,value);
  if(documents.has(new URL(request.url).pathname)){
   headers.set('content-type','text/html; charset=utf-8');
   const html=await response.text();return new Response(request.method==='HEAD'?null:html.replace('{{WORKSPACE_ID}}',workspace),{status:200,headers});
  }
  return new Response(response.body,{status:response.status,headers});
 }catch(error){return toHttpError(error,crypto.randomUUID());}
}
