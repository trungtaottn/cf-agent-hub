import { sha256 } from '../config/bootstrap';
import { withTransaction } from '../storage/transaction';
import type { VerifiedIdentity } from '../workspace/context';
import { type AuthWorkspace,currentConfiguration,deny } from './context';
import { resolveActor } from './authorize';
import {uniqueNativeCredential} from './native-token-lookup';

/** Trusted DO workspace only. No proof, grant or digest is accepted from public JSON. */
export async function verifyNativeCredential(workspace:AuthWorkspace,bearer:string,nowMs:number):Promise<VerifiedIdentity> {
 if(typeof bearer!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(bearer))deny();
 const decoded=atob(bearer.replace(/-/g,'+').replace(/_/g,'/')+'=');
 if(decoded.length!==32||btoa(decoded).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==bearer)deny();
 // Only the hash enters the query; safe fixed-length comparison occurs in resolveActor.
 const admission=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace));
 const tokenDigest=await sha256(bearer);
 return withTransaction(workspace.storage,tx=>{
  currentConfiguration(tx,workspace,admission.fence);
  const credentialId=uniqueNativeCredential(tx,workspace.workspaceId,tokenDigest);
  if(credentialId===null)deny();
  const identity:VerifiedIdentity={kind:'agent',workspaceId:workspace.workspaceId,credentialId:credentialId!,tokenDigest};
  resolveActor(tx,identity,Math.max(nowMs,workspace.clock.nowMs()));
  return identity;
 });
}
