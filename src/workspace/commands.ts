import {maintenanceClosed} from '../recovery/maintenance';
import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {authorize,resolveActor} from '../auth/authorize';
import type {CommandContext,VerifiedIdentity,ResourceAccess} from './context';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {appendEvent} from '../audit/events';
import {replayLog,securityLog} from '../audit/redact';
import {findOutcome,readOutcome,storeOutcome,canonicalJsonValue} from './idempotency';
import {HttpError} from '../http/envelopes';
export interface CommandOutcome<T>{status:number;data:T;}
/** Internal owned context; never construct from HTTP JSON or serialize caller authority. */
export interface CommandExecutionContext{workspace:AuthWorkspace;requestId:string;idempotencyKey:string;fingerprint:string;admissionEpoch:number;admissionGeneration:number;}
export interface EventDraft{type:'catalog.previewed'|'catalog.applied'|'message.accepted'|'message.acknowledged'|'profile.updated'|'preferences.updated'|'agent.created'|'agent.updated'|'agent.archived'|'credential.issued'|'credential.revoked'|'runtime.enrolled'|'runtime.heartbeat'|'task.created'|'task.updated'|'task.ready';resourceType:'message'|'profile'|'preferences'|'agent'|'credential'|'runtime'|'task';resourceId:string;resourceVersion:number|null;threadId:string|null;}
export interface CommandDescriptor<B,T>{
 operation:string;target:string;
 resource(tx:WorkspaceTransaction,ctx:CommandContext,body:B):ResourceAccess|undefined;
 /** Current resource/owner checks only. Must remain valid for an original authorized replay. */
 checkAccess(tx:WorkspaceTransaction,ctx:CommandContext,body:B):undefined;
 /** Checks visibility of the original returned resource; never current revision/preconditions. */
 checkReplay(tx:WorkspaceTransaction,ctx:CommandContext,body:B,outcome:CommandOutcome<T>):undefined;
 /** First execution owns domain/outbox writes and business preconditions. Wrapper owns event/outcome. */
 execute(tx:WorkspaceTransaction,ctx:CommandContext,body:B,acceptedEventId:string):{outcome:CommandOutcome<T>;event:EventDraft};
}
/** Fail closed on any async descriptor result, consuming rejection without awaiting inside SQL. */
function synchronousResult<T>(result:T):T{
 if(result!==null&&(typeof result==='object'||typeof result==='function')&&typeof (result as {then?:unknown}).then==='function'){
  void Promise.resolve(result).catch(()=>{});
  throw new HttpError('INTERNAL_ERROR',500);
 }
 return result;
}
function synchronousGuard(result:undefined):void{
 if(synchronousResult(result)!==undefined)throw new HttpError('INTERNAL_ERROR',500);
}
export function executeCommand<B,T>(ctx:CommandExecutionContext,identity:VerifiedIdentity,command:CommandDescriptor<B,T>,body:B):CommandOutcome<T>{
 return executeCommandDetailed(ctx,identity,command,body).outcome;
}
/** Private first-attempt signal; never retained in SQL or inferred from a cached outcome. */
export function executeCommandDetailed<B,T>(ctx:CommandExecutionContext,identity:VerifiedIdentity,command:CommandDescriptor<B,T>,body:B):{outcome:CommandOutcome<T>;firstExecution:boolean}{
 if(!Number.isSafeInteger(ctx.admissionGeneration)||ctx.admissionGeneration<0||!Number.isSafeInteger(ctx.admissionEpoch)||ctx.admissionEpoch<=0||identity.workspaceId!==ctx.workspace.workspaceId||!ctx.idempotencyKey||!/^[a-f0-9]{64}$/.test(ctx.fingerprint)||!/^[a-z]+:[a-z]+$/.test(command.operation)||!command.target)throw new HttpError('INVALID_REQUEST',400);
 // Entropy and all async proof/fingerprint work complete before SQL. Command time is sampled inside entry.
 const eventId='event_'+Array.from(ctx.workspace.entropy.bytes(24),b=>b.toString(16).padStart(2,'0')).join('');
 let verifiedActor:CommandContext['actor']|undefined;
 let replay:{requestId:string;eventId:string|null}|undefined;
 try{
  const result=withTransaction(ctx.workspace.storage,tx=>{
   const nowMs=ctx.workspace.clock.nowMs();
   if(maintenanceClosed(tx))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
   currentConfiguration(tx,ctx.workspace,{authorityEpoch:ctx.admissionEpoch,maintenanceGeneration:ctx.admissionGeneration});
   const actor=resolveActor(tx,identity,nowMs);verifiedActor=actor;
   const context:CommandContext={actor,requestId:ctx.requestId,idempotencyKey:ctx.idempotencyKey,nowMs};
   authorize(tx,actor,command.operation,synchronousResult(command.resource(tx,context,body)),nowMs);
   synchronousGuard(command.checkAccess(tx,context,body));
   const prior=findOutcome(tx,actor.principalId,command.operation,command.target,ctx.idempotencyKey,actor.workspaceId);
   if(prior){
    const outcome=readOutcome<T>(prior,ctx.fingerprint);
    synchronousGuard(command.checkReplay(tx,context,body,outcome));
    replay={requestId:prior.original_request_id,eventId:prior.event_id};
    return outcome;
   }
   const effect=synchronousResult(command.execute(tx,context,body,eventId));
   if(!effect||!effect.outcome||!Number.isInteger(effect.outcome.status)||effect.outcome.status<200||effect.outcome.status>299)throw new HttpError('INTERNAL_ERROR',500);
   // Only JSON domain output is retained. No headers, raw requests, proof, or per-attempt response envelope.
   const outcome:CommandOutcome<T>={status:effect.outcome.status,data:JSON.parse(canonicalJsonValue(effect.outcome.data)) as T};
   const event=appendEvent(tx,{...effect.event,id:eventId,workspaceId:actor.workspaceId,actor,requestId:ctx.requestId,nowMs});
   storeOutcome(tx,{principalId:actor.principalId,operation:command.operation,target:command.target,key:ctx.idempotencyKey,workspaceId:actor.workspaceId,fingerprint:ctx.fingerprint,outcome,requestId:ctx.requestId,eventId:event.id,nowMs});
   return outcome;
  });
  if(replay)replayLog(ctx.requestId,replay.requestId,replay.eventId);
  return {outcome:result,firstExecution:replay===undefined};
 }catch(error){securityLog(error,ctx.requestId,verifiedActor);throw error;}
}
