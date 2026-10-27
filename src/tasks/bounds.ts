import {canonicalJson} from '../config/bootstrap';
import {HttpError} from '../http/envelopes';
/** Existing ADR envelope/codec bounds; no per-identifier cap is introduced. */
export const TASK_RESPONSE_BYTES=1048576;
export const TASK_CURSOR_BYTES=2048;
export const TASK_REQUEST_ID_BYTES=36;
const encoder=new TextEncoder();
export const jsonBytes=(value:unknown):number=>encoder.encode(JSON.stringify(value)).byteLength;
export const PAGE_OVERHEAD_BYTES=jsonBytes({data:[],page:{next_cursor:'x'.repeat(TASK_CURSOR_BYTES),has_more:false},request_id:'x'.repeat(TASK_REQUEST_ID_BYTES)});
/** Producer/restore owners must use this same guard before persisting result projections. */
export const MAX_TASK_ITEM_BYTES=TASK_RESPONSE_BYTES-PAGE_OVERHEAD_BYTES;
export function assertTaskItemFits(value:unknown):number {
 const bytes=jsonBytes(value);if(bytes>MAX_TASK_ITEM_BYTES)throw new HttpError('INTERNAL_ERROR',500);return bytes;
}
export function assertStoredScalarBytes(bytes:number|null|undefined):void {
 if(bytes===null||bytes===undefined||!Number.isSafeInteger(bytes)||bytes<0||bytes>MAX_TASK_ITEM_BYTES)throw new HttpError('INTERNAL_ERROR',500);
}
/** Submission/restore must prove BOTH standalone history and embedded current Task fit.
 * Query guards do not claim that later-round mutation/restore owners already call this. */
export function assertTaskResultAdmissionFits(result:import('../http/dto').TaskResult,resultingTask:import('../http/dto').Task):void {
 if(resultingTask.result===null||canonicalJson(resultingTask.result)!==canonicalJson(result))throw new HttpError('INTERNAL_ERROR',500);
 assertTaskItemFits(result);assertTaskItemFits(resultingTask);
}
