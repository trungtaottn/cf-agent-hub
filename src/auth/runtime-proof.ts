import type {WorkspaceTransaction} from '../storage/transaction';
import type {CommandContext} from '../workspace/context';
import type {Runtime} from '../http/dto';
import {refreshActor} from './authorize';
import {deny} from './context';
import {sha256} from '../config/bootstrap';
import {validateRuntime} from '../http/generated/auth-validators.js';
import {HttpError} from '../http/envelopes';
export interface RuntimeRow {id:string;workspace_id:string;agent_id:string;credential_id:string;authority_epoch:number;proof_sha256:string;runtime_version:number;label:string;status:'online'|'expired';created_at:number;last_seen_at:number;presence_expires_at:number;revoked_at:number|null;}
/** Server-owned evidence, valid only within the synchronous transaction that produced it. */
export interface VerifiedRuntime {runtime:Runtime;credentialId:string;authorityEpoch:number;}
export function runtimeView(row:RuntimeRow):Runtime{
 const result:Runtime={id:row.id,workspace_id:row.workspace_id,agent_id:row.agent_id,runtime_version:row.runtime_version,label:row.label,status:row.status,created_at:new Date(row.created_at).toISOString(),last_seen_at:new Date(row.last_seen_at).toISOString(),presence_expires_at:new Date(row.presence_expires_at).toISOString()};
 if(!validateRuntime(result))throw new HttpError('INTERNAL_ERROR',500);return result;
}
/** Internal lifecycle predicate also used for sanitized enrollment replay (without proof recovery). */
export function currentRuntime(tx:WorkspaceTransaction,ctx:CommandContext,id:string):RuntimeRow{
 const actor=refreshActor(tx,ctx.actor,ctx.nowMs);if(actor.kind!=='agent'||!actor.credentialId)deny();
 const row=tx.one<RuntimeRow>('SELECT * FROM runtimes WHERE workspace_id=? AND id=?',[actor.workspaceId,id]);
 const metadata=tx.one<{config_epoch:number}>('SELECT config_epoch FROM workspace_metadata WHERE workspace_id=?',[actor.workspaceId]);
 if(!row||!metadata||row.agent_id!==actor.agentId||row.credential_id!==actor.credentialId||row.authority_epoch!==metadata.config_epoch||row.status!=='online'||row.revoked_at!==null||row.presence_expires_at<=ctx.nowMs)deny();
 return row!;
}
export function requireRuntimeProof(tx:WorkspaceTransaction,ctx:CommandContext,runtimeId:string,proofHash:string):VerifiedRuntime{
 const row=currentRuntime(tx,ctx,runtimeId);
 if(typeof proofHash!=='string'||!/^[a-f0-9]{64}$/.test(proofHash)||!/^[a-f0-9]{64}$/.test(row.proof_sha256))deny();
 const bytes=(s:string)=>Uint8Array.from(s.match(/../g)!,x=>parseInt(x,16));
 const subtle=crypto.subtle as SubtleCrypto&{timingSafeEqual(a:ArrayBufferView,b:ArrayBufferView):boolean};
 if(!subtle.timingSafeEqual(bytes(proofHash),bytes(row.proof_sha256)))deny();
 return {runtime:runtimeView(row),credentialId:row.credential_id,authorityEpoch:row.authority_epoch};
}
/** Called only after ingress admission capture; raw proof never enters CommandContext. */
export async function hashRuntimeProof(proof:string|null):Promise<string>{
 if(typeof proof!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(proof))deny();
 const decoded=atob(proof!.replace(/-/g,'+').replace(/_/g,'/')+'=');
 if(decoded.length!==32||btoa(decoded).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==proof)deny();
 return sha256(proof!);
}
