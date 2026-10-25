import { AuthError,secret,type AuthWorkspace } from './context';
import type { SessionRecord } from './authorize';
const encoder=new TextEncoder();
export async function csrfToken(workspace:AuthWorkspace,session:SessionRecord):Promise<string> {
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret(workspace,'CSRF_SECRET',32)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const material=JSON.stringify(['cfhub-csrf-v1',session.workspace_id,session.id,session.expires_at]);
 const mac=await crypto.subtle.sign('HMAC',key,encoder.encode(material));return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function assertCsrf(request:Request,session:{csrfToken:string;origin:string}):void {
 const actual=request.headers.get('x-csrf-token')??'',expected=session.csrfToken;
 // Constant work for the fixed-length secret; length is not confidential.
 let difference=actual.length^expected.length;for(let i=0;i<expected.length;i++)difference|=(actual.charCodeAt(i)||0)^expected.charCodeAt(i);
 if(request.headers.get('origin')!==session.origin||new URL(request.url).origin!==session.origin||difference!==0)throw new AuthError('FORBIDDEN',403);
}
