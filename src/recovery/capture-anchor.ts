import {canonicalJson} from '../config/bootstrap';
import type {WorkspaceTransaction} from '../storage/transaction';
import {canonicalBytes,closed,isSlug} from './encoding';
import {controlTarget,type RecoveryContext,type RecoveryWorkspace} from './protocol';
import {readTrustedAnchor,type TrustedAnchorSnapshot} from './trusted-anchor';
const operation='operator.recovery.capture-anchor',principal='system_recovery';
const bindings=(ctx:RecoveryContext,id:string)=>[principal,operation,controlTarget(ctx.captureId),id,ctx.workspaceId];
export function parseCaptureAnchor(value:unknown):TrustedAnchorSnapshot {
 if(canonicalBytes(value).length>4096||!closed(value,['bindingId','workspaceId','environmentId','objectName','authorityEpoch','sha256','generation'])||![value.bindingId,value.workspaceId,value.environmentId,value.objectName].every(isSlug)||!Number.isSafeInteger(value.authorityEpoch)||Number(value.authorityEpoch)<1||!Number.isSafeInteger(value.generation)||Number(value.generation)<1||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))throw Error('RECOVERY_CAPTURE_ANCHOR_INVALID');
 return structuredClone(value) as unknown as TrustedAnchorSnapshot;
}
/** Non-executable, never imported as authority; projected out of this capture's SQL. */
export function readCaptureAnchor(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,id:string):TrustedAnchorSnapshot|null {
 const row=tx.one<{status:number;fingerprint:string;outcome_json:string}>('SELECT status,fingerprint,outcome_json FROM idempotency_outcomes WHERE principal_id=? AND operation=? AND target=? AND key=? AND workspace_id=?',bindings(ctx,id));
 if(!row)return null;
 if(row.status!==202||new TextEncoder().encode(row.outcome_json).length>4096)throw Error('RECOVERY_CAPTURE_ANCHOR_INVALID');
 const a=parseCaptureAnchor(JSON.parse(row.outcome_json));if(row.fingerprint!==a.sha256)throw Error('RECOVERY_CAPTURE_ANCHOR_INVALID');
 if(a.workspaceId!==w.workspaceId||a.environmentId!==w.environmentId||a.objectName!==w.objectName||a.authorityEpoch!==ctx.expectedEpoch)throw Error('RECOVERY_CAPTURE_ANCHOR_INVALID');return a;
}
export function saveCaptureAnchor(tx:WorkspaceTransaction,w:RecoveryWorkspace,ctx:RecoveryContext,id:string,anchor:TrustedAnchorSnapshot):void {
 const a=parseCaptureAnchor(anchor);if(readCaptureAnchor(tx,w,ctx,id))throw Error('RECOVERY_CAPTURE_ANCHOR_CONFLICT');
 tx.exec('INSERT INTO idempotency_outcomes (principal_id,operation,target,key,workspace_id,fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at) VALUES (?,?,?,?,?,?,202,?,?,NULL,?,?)',[...bindings(ctx,id),a.sha256,canonicalJson(a),ctx.requestId,w.clock.nowMs(),Number.MAX_SAFE_INTEGER]);
}
export async function freshCaptureAnchor(w:RecoveryWorkspace,ctx:RecoveryContext,anchor:TrustedAnchorSnapshot|undefined,local:()=>void):Promise<TrustedAnchorSnapshot>{return readTrustedAnchor(w,ctx,anchor,local);}
