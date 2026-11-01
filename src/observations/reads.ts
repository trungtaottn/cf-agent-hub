import type {WorkspaceTransaction} from '../storage/transaction';
import type {CommandContext,ActorContext} from '../workspace/context';
import type {ObservationView} from '../http/dto';
import type {CursorPayload,CursorBinding} from '../http/cursors';
import {taskAccess} from '../tasks/repository';
import {observationSlots,observationMetadata,observationRecords,reportedRecord,type ObservationSlotRow} from './repository';
import {HttpError} from '../http/envelopes';
const visible=(actor:ActorContext,row:ObservationSlotRow)=>actor.projectIds===null||row.project_id!==null&&actor.projectIds.includes(row.project_id);
export function selectedObservation(tx:WorkspaceTransaction,ctx:Pick<CommandContext,'actor'|'nowMs'>,taskId:string):ObservationSlotRow|null{
 const actor=taskAccess(tx,ctx.actor,'tasks:read',taskId,ctx.nowMs);taskAccess(tx,actor,'events:read',taskId,ctx.nowMs);
 // Selection uses only authorized rows. Hidden session existence is indistinguishable from absence.
 return observationSlots(tx).filter(s=>s.workspace_id===actor.workspaceId&&s.task_id===taskId&&visible(actor,s)).sort((a,b)=>b.created_at-a.created_at||b.session_epoch-a.session_epoch||a.session_id.localeCompare(b.session_id))[0]??null;
}
export function readObservations(tx:WorkspaceTransaction,ctx:Pick<CommandContext,'actor'|'nowMs'>,taskId:string,options:{expectedSessionId?:string;selectedSessionId:string|null;limit:number;binding:CursorBinding;cursor?:CursorPayload}):{data:ObservationView;hasMore:boolean;next:CursorPayload|null}{
 const slot=selectedObservation(tx,ctx,taskId),empty:ObservationView={status:'no_retained_data',binding:null,coverage:null,retained_range:null,truncated:false,records:[],read_at:new Date(ctx.nowMs).toISOString()};
 if(!slot){if(options.selectedSessionId!==null)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);return {data:empty,hasMore:false,next:null};}
 if(options.expectedSessionId!==undefined&&slot.session_id!==options.expectedSessionId)throw new HttpError('VERSION_CONFLICT',409);
 if(slot.session_id!==options.selectedSessionId)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 const metadata=observationMetadata(slot),cursor=options.cursor,high=cursor?cursor.highWater:slot.high_water,last=cursor?cursor.lastScanned:0;
 if(typeof high!=='number'||typeof last!=='number'||high>slot.high_water)throw new HttpError('INVALID_REQUEST',400);
 const retained=observationRecords(tx,slot.session_id),first=retained[0]?.sequence;
 if(cursor&&last<high&&(first===undefined||first>last+1))throw new HttpError('VERSION_CONFLICT',409);
 const rows=retained.filter(r=>r.sequence>last&&r.sequence<=high),page=rows.slice(0,options.limit),hasMore=rows.length>page.length;
 const run=tx.one<{fence:number}>('SELECT fence FROM runs WHERE workspace_id=? AND id=?',[slot.workspace_id,slot.run_id]);if(!run)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 const range=retained.filter(r=>r.sequence<=high),data:ObservationView={status:'retained',binding:{task_id:slot.task_id,run_id:slot.run_id,agent_id:slot.agent_id,runtime_instance_id:slot.runtime_instance_id,repository_id:metadata.repository_id,checkout_slot_id:metadata.checkout_slot_id,fence:run.fence,session_id:slot.session_id,session_epoch:slot.session_epoch},coverage:metadata.coverage,retained_range:range.length?{first_sequence:range[0].sequence,last_sequence:range.at(-1)!.sequence}:null,truncated:metadata.truncated,records:page.map(r=>({sequence:r.sequence,server_received_at:new Date(r.received_at).toISOString(),reported:reportedRecord(r)})),read_at:new Date(ctx.nowMs).toISOString()};
 return {data,hasMore,next:hasMore?{version:1,binding:options.binding,highWater:high,lastScanned:page.at(-1)!.sequence,expiresAt:cursor?.expiresAt??ctx.nowMs+900000}:null};
}
