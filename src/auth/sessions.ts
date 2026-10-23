import { authReturnPaths } from '../http/dto';
import { withTransaction,type WorkspaceTransaction } from '../storage/transaction';
import { sha256 } from '../config/bootstrap';
import type { VerifiedIdentity } from '../workspace/context';
import { currentConfiguration,opaque,readCookie,secret,deny,AuthError,type AuthWorkspace } from './context';
import { discover,verifyCode,type LoginAttempt } from './oidc';
import { resolveActor,type SessionRecord } from './authorize';
import { csrfToken } from './csrf';
export interface LoginStart {authorizationUrl:string;cookie:string;}
export interface SessionIssue {cookie:string;expiresAt:number;returnPath:string;}
export async function beginLogin(workspace:AuthWorkspace,returnPath:string,origin:string):Promise<LoginStart> {
 if(!(authReturnPaths as readonly string[]).includes(returnPath))throw new AuthError('INVALID_REQUEST',400);
 const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace)),auth=installed.config.authentication;
 const redirect=auth.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId)!.redirect_uri;
 if(!auth.allowed_origins.includes(origin)||new URL(redirect).origin!==origin)throw new AuthError('FORBIDDEN',403);
 secret(workspace,auth.client_secret_ref);secret(workspace,'CSRF_SECRET',32);
 await discover(auth);
 const state=opaque(workspace),nonce=opaque(workspace),verifier=opaque(workspace),cookie=opaque(workspace),id=opaque(workspace);
 const [stateDigest,cookieDigest,challengeBytes]=await Promise.all([sha256(state),sha256(cookie),crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))]);
 const challenge=btoa(String.fromCharCode(...new Uint8Array(challengeBytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const now=workspace.clock.nowMs();
 // No await from the same-configuration check through insertion/publication.
 withTransaction(workspace.storage,tx=>{
  currentConfiguration(tx,workspace,installed.epoch);
  tx.exec('DELETE FROM login_attempts WHERE expires_at<=?',[now]);
  tx.exec('INSERT INTO login_attempts (id,workspace_id,state_digest,nonce,pkce_verifier,cookie_digest,redirect_uri,created_at,expires_at,auth_epoch,return_path) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[id,workspace.workspaceId,stateDigest,nonce,verifier,cookieDigest,redirect,now,now+300000,installed.epoch,returnPath]);
 });
 const url=new URL(auth.reviewed_oidc_endpoints.authorization_endpoint);
 url.search=new URLSearchParams({response_type:'code',response_mode:'query',client_id:auth.client_id,scope:'openid',redirect_uri:redirect,state,nonce,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 return {authorizationUrl:url.href,cookie};
}
export async function completeLogin(workspace:AuthWorkspace,code:string,state:string,cookie:string|null,previousCookie:string|null=null):Promise<SessionIssue> {
 if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!cookie||!code||code.length>2048)deny();
 const [stateDigest,cookieDigest,previousDigest]=await Promise.all([sha256(state),sha256(cookie!),previousCookie?sha256(previousCookie):Promise.resolve(null)]);
 const {attempt,installed}=withTransaction(workspace.storage,tx=>{
  const installed=currentConfiguration(tx,workspace),attempt=tx.one<LoginAttempt>('SELECT * FROM login_attempts WHERE state_digest=?',[stateDigest]);
  validAttempt(attempt,workspace,installed.epoch,cookieDigest,workspace.clock.nowMs());return {attempt:attempt!,installed};
 });
 const auth=installed.config.authentication,proof=await verifyCode(auth,secret(workspace,auth.client_secret_ref),attempt,code,()=>workspace.clock.nowMs());
 const token=opaque(workspace),id=opaque(workspace),tokenDigest=await sha256(token);
 const now=workspace.clock.nowMs(),expiresAt=Math.min(now+auth.session_ttl_seconds*1000,proof.expiresAt);
 if(expiresAt<=now)deny();
 const candidate:SessionRecord={id,workspace_id:workspace.workspaceId,principal_id:'',issuer:proof.issuer,subject:proof.subject,expires_at:expiresAt,revoked_at:null,auth_epoch:installed.epoch};
 const csrfDigest=await sha256(await csrfToken(workspace,candidate));
 withTransaction(workspace.storage,tx=>{
  currentConfiguration(tx,workspace,installed.epoch);
  const current=tx.one<LoginAttempt>('SELECT * FROM login_attempts WHERE id=?',[attempt.id]);
  const instant=workspace.clock.nowMs();validAttempt(current,workspace,installed.epoch,cookieDigest,instant);if(expiresAt<=instant)deny();
  const grant=tx.one<{principal_id:string}>('SELECT principal_id FROM human_grants WHERE workspace_id=? AND issuer=? AND subject=? AND enabled=1 AND config_epoch=?',[workspace.workspaceId,proof.issuer,proof.subject,installed.epoch]);
  if(!grant)throw new AuthError('FORBIDDEN',403);
  tx.exec("UPDATE login_attempts SET consumed_at=?,pkce_verifier='',nonce='' WHERE id=?",[instant,attempt.id]);
  if(previousDigest)tx.exec('UPDATE sessions SET revoked_at=? WHERE token_digest=? AND workspace_id=? AND revoked_at IS NULL',[instant,previousDigest,workspace.workspaceId]);
  tx.exec('INSERT INTO sessions (id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,auth_epoch) VALUES (?,?,?,?,?,?,?,?,?,?)',[id,workspace.workspaceId,grant.principal_id,tokenDigest,csrfDigest,proof.issuer,proof.subject,instant,expiresAt,installed.epoch]);
 });
 return {cookie:token,expiresAt,returnPath:attempt.return_path};
}
function validAttempt(attempt:LoginAttempt|null,workspace:AuthWorkspace,epoch:number,cookieDigest:string,now:number):void {
 if(!attempt||attempt.workspace_id!==workspace.workspaceId||attempt.consumed_at!==null||attempt.expires_at<=now||attempt.auth_epoch<=0||attempt.auth_epoch!==epoch||attempt.cookie_digest!==cookieDigest)deny();
}
/** Hash outside SQL; the identity is internal and every effect must resolveActor again. */
export async function verifyHumanSession(workspace:AuthWorkspace,cookie:string|null,nowMs:number):Promise<VerifiedIdentity> {
 const value=readCookie(cookie,'cfhub_session');if(!value)deny();const digest=await sha256(value!);
 return withTransaction(workspace.storage,tx=>{
  currentConfiguration(tx,workspace);
  const session=tx.one<SessionRecord>('SELECT * FROM sessions WHERE token_digest=? AND workspace_id=?',[digest,workspace.workspaceId]);if(!session)deny();
  const identity:VerifiedIdentity={kind:'human',workspaceId:workspace.workspaceId,sessionId:session!.id,issuer:session!.issuer,subject:session!.subject};
  resolveActor(tx,identity,Math.max(nowMs,workspace.clock.nowMs()));return identity;
 });
}
export function revokeSession(tx:WorkspaceTransaction,sessionId:string,nowMs=Date.now()):void {tx.exec('UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL',[nowMs,sessionId]);}
