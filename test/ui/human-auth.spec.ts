import type {AuthStartDataResponse,AuthSessionResponse} from '../../src/http/dto';
import { test,expect,appOrigin } from '../helpers/browser';
test('verified_https_login_keeps_provider_tokens_out_of_browser_storage_and_logout_revokes',async({page,context})=>{
 await page.goto(appOrigin+'/health/live');
 const authorizationUrl=await page.evaluate(async()=>{
  const response=await fetch('/v2/workspaces/ws_example/auth/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({return_path:'/overview'})});
  if(response.status!==200)throw Error('AUTH_START_DENIED');
  const value=await response.json() as AuthStartDataResponse;return value.data.authorization_url as string;
 });
 const transient=(await context.cookies()).find(item=>item.name==='cfhub_login');
 expect(Boolean(transient?.secure&&transient.httpOnly&&transient.sameSite==='Lax'&&transient.path==='/')).toBe(true);
 await page.goto(authorizationUrl);
 expect(new URL(page.url()).origin+new URL(page.url()).pathname).toBe(appOrigin+'/overview');
 expect(new URL(page.url()).search).toBe('');
 const cookies=await context.cookies();const session=cookies.find(item=>item.name==='cfhub_session');
 expect(Boolean(session?.secure&&session.httpOnly&&session.sameSite==='Lax'&&session.path==='/')).toBe(true);
 expect(cookies.some(item=>item.name==='cfhub_login')).toBe(false);
 const result=await page.evaluate(async()=>{
  const endpoint='/v2/workspaces/ws_example/auth/';
  const current=await fetch(endpoint+'session'),payload=await current.json() as AuthSessionResponse;
  const denied=await fetch(endpoint+'logout',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':'wrong'},body:'{}'});
  const loggedOut=await fetch(endpoint+'logout',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':payload.data.csrf_token},body:'{}'});
  const revoked=await fetch(endpoint+'session');
  return {status:current.status,principal:payload.data.actor.principal_id,noStore:current.headers.get('cache-control'),csp:current.headers.get('content-security-policy'),denied:denied.status,logout:loggedOut.status,revoked:revoked.status,visibleCookie:document.cookie,localKeys:Object.keys(localStorage),sessionKeys:Object.keys(sessionStorage)};
 });
 expect(result).toEqual({status:200,principal:'human_operator',noStore:'no-store',csp:"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",denied:403,logout:200,revoked:401,visibleCookie:'',localKeys:[],sessionKeys:[]});
 expect((await context.cookies()).some(item=>item.name==='cfhub_session')).toBe(false);
});
