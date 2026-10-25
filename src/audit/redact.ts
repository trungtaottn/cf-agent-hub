import {describeError} from '../http/envelopes';
import type {ActorContext} from '../workspace/context';
const safeId=(value:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(value)?value:undefined;
/** Fixed category/correlation/verified actor only; one record is bounded, never a request or error dump. */
export function securityLog(error:unknown,requestId:string,actor?:ActorContext):void{
 console.warn(JSON.stringify({category:describeError(error).code,request_id:safeId(requestId),...(actor?{actor:{kind:actor.kind,principal_id:safeId(actor.principalId),agent_id:actor.agentId===null?null:safeId(actor.agentId)}}:{})}));
}
export function replayLog(requestId:string,originalRequestId:string,eventId:string|null):void{
 console.info(JSON.stringify({category:'COMMAND_REPLAY',request_id:safeId(requestId),original_request_id:safeId(originalRequestId),event_id:eventId===null?null:safeId(eventId)}));
}
