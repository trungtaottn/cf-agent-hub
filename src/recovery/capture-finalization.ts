import {canonicalJson} from '../config/bootstrap';
import type {WorkspaceTransaction} from '../storage/transaction';
import {canonicalBytes,closed,isSlug} from './encoding';
import {controlTarget,type RecoveryContext,type RecoveryWorkspace} from './protocol';
import type {CurrentCaptureJob} from './jobs';
import {parseCaptureAnchor,readCaptureAnchor} from './capture-anchor';
import type {TrustedAnchorSnapshot} from './trusted-anchor';
interface Finalization {version:1;jobId:string;draftSha256:string;anchor:TrustedAnchorSnapshot;fence:{authorityEpoch:number;maintenanceGeneration:number};index:number;total:number;}
const operation='operator.recovery.capture-finalization',principal='system_recovery';
const bindings=(ctx:RecoveryContext,id:string)=>[principal,operation,controlTarget(ctx.captureId),id,ctx.workspaceId];
export function parseFinalization(value:unknown):Finalization {
 if(canonicalBytes(value).length>4096||!closed(value,['version','jobId','draftSha256','anchor','fence','index','total'])||value.version!==1||!isSlug(value.jobId)||typeof value.draftSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.draftSha256)||!closed(value.fence,['authorityEpoch','maintenanceGeneration'])||!Number.isSafeInteger(value.fence.authorityEpoch)||Number(value.fence.authorityEpoch)<1||!Number.isSafeInteger(value.fence.maintenanceGeneration)||Number(value.fence.maintenanceGeneration)<0||!Number.isInteger(value.index)||!Number.isInteger(value.total)||Number(value.index)<0||Number(value.total)>1000||Number(value.index)>Number(value.total))throw Error('RECOVERY_FINALIZATION_INVALID');
 const anchor=parseCaptureAnchor(value.anchor);if(anchor.authorityEpoch!==value.fence.authorityEpoch)throw Error('RECOVERY_FINALIZATION_INVALID');return structuredClone(value) as unknown as Finalization;
}
function row(tx:WorkspaceTransaction,ctx:RecoveryContext,id:string){return tx.one<{status:number;fingerprint:string;outcome_json:string}>('SELECT status,fingerprint,outcome_json FROM idempotency_outcomes WHERE principal_id=? AND operation=? AND target=? AND key=? AND workspace_id=?',bindings(ctx,id));}
export function initializeFinalization(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentCaptureJob,draftSha256:string):void {
 if(row(tx,ctx,job.id))throw Error('RECOVERY_FINALIZATION_CONFLICT');const anchor=readCaptureAnchor(tx,w,ctx,job.id);if(!anchor)throw Error('RECOVERY_CAPTURE_ANCHOR_REQUIRED');
 const record=parseFinalization({version:1,jobId:job.id,draftSha256,anchor,fence:job.details.fence,index:0,total:job.details.draft!.artifacts.length});
 tx.exec('INSERT INTO idempotency_outcomes (principal_id,operation,target,key,workspace_id,fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at) VALUES (?,?,?,?,?,?,202,?,?,NULL,?,?)',[...bindings(ctx,job.id),draftSha256,canonicalJson(record),ctx.requestId,w.clock.nowMs(),Number.MAX_SAFE_INTEGER]);
}
export function readFinalization(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentCaptureJob,draftSha256:string):Finalization {
 const stored=row(tx,ctx,job.id);if(!stored||stored.status!==202||stored.fingerprint!==draftSha256||new TextEncoder().encode(stored.outcome_json).length>4096)throw Error('RECOVERY_FINALIZATION_REQUIRED');
 const record=parseFinalization(JSON.parse(stored.outcome_json));
 if(record.jobId!==job.id||record.draftSha256!==draftSha256||record.total!==job.details.draft!.artifacts.length||canonicalJson(record.fence)!==canonicalJson(job.details.fence)||canonicalJson(record.anchor)!==canonicalJson(readCaptureAnchor(tx,w,ctx,job.id)))throw Error('RECOVERY_FINALIZATION_CONFLICT');return record;
}
export function advanceFinalization(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,job:CurrentCaptureJob,expected:Finalization):void {
 const current=readFinalization(tx,w,ctx,job,expected.draftSha256);if(canonicalJson(current)!==canonicalJson(expected)||current.index>=current.total)throw Error('RECOVERY_FINALIZATION_CONFLICT');
 tx.exec('UPDATE idempotency_outcomes SET outcome_json=? WHERE principal_id=? AND operation=? AND target=? AND key=? AND workspace_id=?',[canonicalJson(parseFinalization({...current,index:current.index+1})),...bindings(ctx,job.id)]);
}
