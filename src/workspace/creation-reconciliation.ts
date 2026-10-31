import {maintenanceClosed} from '../recovery/maintenance';
import {currentConfiguration} from '../auth/context';
import {authorize,resolveActor} from '../auth/authorize';
import {withTransaction} from '../storage/transaction';
import type {VerifiedIdentity,CommandContext} from './context';
import {synchronousGuard,synchronousResult,type CommandAccessDescriptor,type CommandExecutionContext} from './commands';
import {findOutcome} from './idempotency';
import {HttpError} from '../http/envelopes';
export type RetainedCreation<T>={status:'unknown'}|{status:'confirmed';data:T};
/** Retained-positive read only. A miss never executes, proves absence or renews retention. */
export function reconcileCreation<B,T>(ctx:CommandExecutionContext,identity:VerifiedIdentity,access:CommandAccessDescriptor<B,T>,body:B):RetainedCreation<T>{
 if(identity.kind!=='human'||identity.workspaceId!==ctx.workspace.workspaceId||!Number.isSafeInteger(ctx.admissionEpoch)||ctx.admissionEpoch<=0||!Number.isSafeInteger(ctx.admissionGeneration)||ctx.admissionGeneration<0||!ctx.idempotencyKey||!/^[a-f0-9]{64}$/.test(ctx.fingerprint))throw new HttpError('INVALID_REQUEST',400);
 return withTransaction(ctx.workspace.storage,tx=>{
  const nowMs=ctx.workspace.clock.nowMs();if(maintenanceClosed(tx))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  currentConfiguration(tx,ctx.workspace,{authorityEpoch:ctx.admissionEpoch,maintenanceGeneration:ctx.admissionGeneration});
  const actor=resolveActor(tx,identity,nowMs),context:CommandContext={actor,requestId:ctx.requestId,idempotencyKey:ctx.idempotencyKey,nowMs};
  authorize(tx,actor,access.operation,synchronousResult(access.resource(tx,context,body)),nowMs);
  synchronousGuard(access.checkAccess(tx,context,body));
  const prior=findOutcome(tx,actor.principalId,access.operation,access.target,ctx.idempotencyKey,actor.workspaceId);
  if(!prior||prior.fingerprint!==ctx.fingerprint)return {status:'unknown'};
  if(prior.status!==201)throw new HttpError('INTERNAL_ERROR',500);
  let data:T;try{data=JSON.parse(prior.outcome_json) as T;}catch{throw new HttpError('INTERNAL_ERROR',500);}
  // Owning guards validate the canonical DTO and current original-result visibility.
  synchronousGuard(access.checkReplay(tx,context,body,{status:201,data}));
  return {status:'confirmed',data};
 });
}
