/** Fixed private synthetic control sequence, not deployed authority evidence. */
import {canonicalJson,sha256} from '../../src/config/bootstrap';
import {signRecord} from '../../src/recovery/manifest';
import {canonicalBytes,digestBytes} from '../../src/recovery/encoding';
import {retireWorkspace,resumeWorkspace} from '../../src/recovery/controls';
import {recordProbe} from '../../src/recovery/probes';
import {parseControlAdmission} from '../../src/recovery/current-control-admission';
import type {CurrentLedger,CutoverRecord,RecoveryContext} from '../../src/recovery/protocol';
import {fixtureIntegrity,recoveryContext} from './recovery-fixture';
import {withCurrentRecoveryWorkspace,type CurrentRestoreFixture} from '../recovery/current-restore-fixture';
import {assertR3PrivateUnchanged} from './r3-journey-fixture';
import {captureR3ConsumedSnapshot} from './r3-consumed-private-snapshot';
type Snapshot=ReturnType<typeof captureR3ConsumedSnapshot>;
interface ControlObservation {operation:'retire'|'resume-no-probe-denial'|'probe'|'resume'|'resume-replay';before:Snapshot;after:Snapshot;context:RecoveryContext;status:number|null;code:string|null;}
const snap=(f:CurrentRestoreFixture,lane:'source'|'target')=>withCurrentRecoveryWorkspace(f,lane,w=>captureR3ConsumedSnapshot(w.storage));
function invalid():never{throw Error('J2_EXCLUSIVE_CONTROL_INVALID');}
/** Canonical source outcome status, explicitly not an observed HTTP response. */
function canonicalStatus(snapshot:Snapshot,context:RecoveryContext,receipt:unknown){
 const rows=snapshot.idempotency_outcomes.filter(r=>r.principal_id===context.principalId&&r.operation==='operator.recovery.'+context.operation&&r.key===context.operationId&&r.target==='recovery:'+String(context.captureId??'probe')&&r.workspace_id===context.workspaceId);
 if(rows.length!==1||rows[0].fingerprint!==context.requestFingerprint||rows[0].original_request_id!==context.requestId||canonicalJson(JSON.parse(String(rows[0].outcome_json)))!==canonicalJson(receipt)||rows[0].status!==200)invalid();return Number(rows[0].status);
}
/** Returns bounded PRIVATE snapshots to the fixed producer, never serialized as evidence. */
export async function exclusiveControls(f:CurrentRestoreFixture,restoreReceiptId:string){
 const observations:ControlObservation[]=[];
 const sourceLedger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_source',authority_epoch:f.sourceInput.config.config_epoch,config:f.sourceInput.config,verification_bundle:f.sourceInput.bundle,installation_digest:f.sourceInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 f.resolver.anchor={authorityEpoch:sourceLedger.authority_epoch,sha256:await digestBytes(canonicalBytes(sourceLedger))};
 const retireBefore=await snap(f,'source');
 const retired=await withCurrentRecoveryWorkspace(f,'source',async w=>{const context=await recoveryContext(w,'retire',{},f.captureId,{anchor:f.resolver.anchor,operationId:'j2_retire'});return {context,receipt:await retireWorkspace(w,context)};});
 const retireAfter=await snap(f,'source');
 if(retireAfter.maintenance_state[0].state!=='retired'||retireAfter.workspace_metadata[0].admission_state!=='retired')invalid();
 observations.push({operation:'retire',before:retireBefore,after:retireAfter,context:retired.context,status:canonicalStatus(retireAfter,retired.context,retired.receipt),code:null});
 f.resolver.anchor={...f.anchor};
 const cutover=await signRecord<CutoverRecord>({id:'j2_cutover',capture_id:f.captureId,workspace_id:'ws_example',source_environment_id:'current_source',source_authority_epoch:sourceLedger.authority_epoch,target_environment_id:'current_target',target_authority_epoch:f.ledger.authority_epoch,source_retirement_receipt_id:retired.receipt.id,target_catalog_mapping:{workspace_id:'ws_example',object_name:f.targetName},cutover_at:new Date().toISOString(),auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 const body={receipt_id:restoreReceiptId,ledger:f.ledger,source_retirement_receipt:retired.receipt,cutover_record:cutover};
 const context=await withCurrentRecoveryWorkspace(f,'target',w=>recoveryContext(w,'resume',body,f.captureId,{anchor:f.anchor,operationId:'j2_resume'}));
 const before=await snap(f,'target');
 if(before.maintenance_state[0].state!=='restored'||before.probe_receipts.length!==0)invalid();
 let denied=false;try{await withCurrentRecoveryWorkspace(f,'target',w=>resumeWorkspace(w,context,body));}catch(e){if(!(e instanceof Error)||e.message!=='RECOVERY_PROBE_REQUIRED')throw e;denied=true;}
 if(!denied)invalid();
 const pending=await snap(f,'target'),matches=pending.idempotency_outcomes.filter(r=>r.operation==='operator.recovery.admission.resume'&&r.key===context.operationId&&r.principal_id===context.principalId);
 if(matches.length!==1||matches[0].status!==202||matches[0].fingerprint!==context.requestFingerprint||matches[0].original_request_id!==context.requestId)invalid();
 const admission=parseControlAdmission(JSON.parse(String(matches[0].outcome_json)));
 if(admission.status!=='pending'||admission.local.state!=='restored'||admission.local.epoch!==f.ledger.authority_epoch||admission.local.installationDigest!==f.targetInput.installationDigest||admission.outcomeDigest!==null)invalid();
 const withoutPending={...pending,idempotency_outcomes:pending.idempotency_outcomes.filter(r=>r!==matches[0])};assertR3PrivateUnchanged(before,withoutPending);
 // Retry the same genuine pending operation; neither a duplicate reservation nor fake completion is allowed.
 denied=false;try{await withCurrentRecoveryWorkspace(f,'target',w=>resumeWorkspace(w,context,body));}catch(e){if(!(e instanceof Error)||e.message!=='RECOVERY_PROBE_REQUIRED')throw e;denied=true;}
 if(!denied)invalid();assertR3PrivateUnchanged(pending,await snap(f,'target'));
 observations.push({operation:'resume-no-probe-denial',before,after:pending,context,status:null,code:'RECOVERY_PROBE_REQUIRED'});
 const probeBefore=await snap(f,'target');
 const probe=await withCurrentRecoveryWorkspace(f,'target',async w=>{const probeContext=await recoveryContext(w,'probe',{},null,{anchor:f.anchor,operationId:'j2_probe'});return {context:probeContext,receipt:await recordProbe(w,probeContext)};});
 const probeAfter=await snap(f,'target');observations.push({operation:'probe',before:probeBefore,after:probeAfter,context:probe.context,status:canonicalStatus(probeAfter,probe.context,probe.receipt),code:null});
 const resumeBefore=await snap(f,'target'),resumed=await withCurrentRecoveryWorkspace(f,'target',w=>resumeWorkspace(w,context,body)),resumeAfter=await snap(f,'target');
 if(resumeAfter.maintenance_state[0].state!=='open'||resumeAfter.workspace_metadata[0].admission_state!=='installed'||resumed.old_generation!==admission.local.generation||resumed.new_generation!==resumed.old_generation+1||resumed.probe_id!==probe.receipt.id)invalid();
 observations.push({operation:'resume',before:resumeBefore,after:resumeAfter,context,status:canonicalStatus(resumeAfter,context,resumed),code:null});
 const replay=await withCurrentRecoveryWorkspace(f,'target',w=>resumeWorkspace(w,context,body)),replayAfter=await snap(f,'target');
 if(canonicalJson(replay)!==canonicalJson(resumed))invalid();assertR3PrivateUnchanged(resumeAfter,replayAfter);
 observations.push({operation:'resume-replay',before:resumeAfter,after:replayAfter,context,status:canonicalStatus(replayAfter,context,replay),code:null});
 const source=await snap(f,'source');if(source.maintenance_state[0].state!=='retired')invalid();
 return {observations,retirement:retired.receipt,cutover,probe:probe.receipt,resumed,pendingKeySha256:await sha256(context.operationId)};
}
