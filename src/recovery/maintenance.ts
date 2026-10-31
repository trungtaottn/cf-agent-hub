import {assertSchemaVersion,CURRENT_SCHEMA_VERSION} from '../storage/schema-version.ts';
import type {WorkspaceTransaction} from '../storage/transaction';
export interface AdmissionFence {authorityEpoch:number;maintenanceGeneration:number;}
export type MaintenanceState='open'|'capturing'|'captured'|'restoring'|'restored'|'retired';
export interface MaintenanceRow {id:1;state:MaintenanceState;barrier_id:string|null;authority_epoch:number;capture_id:string|null;updated_at:number;generation:number;}
const states:readonly string[]=['open','capturing','captured','restoring','restored','retired'];
export function maintenanceRow(tx:WorkspaceTransaction):MaintenanceRow|null {
 const row=tx.one<MaintenanceRow>('SELECT * FROM maintenance_state WHERE id=1');
 if(row&&(!states.includes(row.state)||!Number.isSafeInteger(row.generation)||row.generation<0||!Number.isSafeInteger(row.authority_epoch)||row.authority_epoch<0))throw Error('INVALID_MAINTENANCE_STATE');
 return row;
}
/** Missing pre-recovery row is the historical open generation zero. Unknown states fail closed. */
export function maintenanceClosed(tx:WorkspaceTransaction):boolean {
 try {const row=maintenanceRow(tx);return row!==null&&row.state!=='open';}catch{return true;}
}
export function readAdmissionFence(tx:WorkspaceTransaction,schemaVersion:7|8|9|10|11|12|13|14|15=CURRENT_SCHEMA_VERSION):AdmissionFence {
 assertSchemaVersion(tx,schemaVersion);
 const epoch=tx.one<{config_epoch:number}>('SELECT config_epoch FROM workspace_metadata WHERE id=1')?.config_epoch??0;
 const row=maintenanceRow(tx);
 if(!Number.isSafeInteger(epoch)||epoch<0||row&&row.authority_epoch!==epoch)throw Error('INVALID_MAINTENANCE_STATE');
 return {authorityEpoch:epoch,maintenanceGeneration:row?.generation??0};
}
export function sameFence(a:AdmissionFence,b:AdmissionFence):boolean {return a.authorityEpoch===b.authorityEpoch&&a.maintenanceGeneration===b.maintenanceGeneration;}
export function assertFence(tx:WorkspaceTransaction,expected:AdmissionFence,schemaVersion:7|8|9|10|11|12|13|14|15=CURRENT_SCHEMA_VERSION):AdmissionFence {
 const actual=readAdmissionFence(tx,schemaVersion);if(!sameFence(actual,expected))throw Error('STALE_ADMISSION_FENCE');return actual;
}
export function assertAdmissionOpen(tx:WorkspaceTransaction,expected?:AdmissionFence,schemaVersion:7|8|9|10|11|12|13|14|15=CURRENT_SCHEMA_VERSION):AdmissionFence {
 const actual=readAdmissionFence(tx,schemaVersion);
 if(tx.one<{admission_state:string}>('SELECT admission_state FROM workspace_metadata WHERE id=1')?.admission_state!=='installed'||maintenanceClosed(tx))throw Error('ADMISSION_CLOSED');
 if(expected&&!sameFence(actual,expected))throw Error('STALE_ADMISSION_FENCE');return actual;
}
export function admissionOpen(tx:WorkspaceTransaction,expected?:AdmissionFence,schemaVersion:7|8|9|10|11|12|13|14|15=CURRENT_SCHEMA_VERSION):boolean {try{assertAdmissionOpen(tx,expected,schemaVersion);return true;}catch{return false;}}
/** Called only by a guarded installation transaction. Never deletes or resets the generation. */
export function retainOpenMaintenance(tx:WorkspaceTransaction,epoch:number,nowMs:number):void {
 const row=maintenanceRow(tx);if(row&&row.state!=='open')throw Error('ADMISSION_CLOSED');
 tx.exec("INSERT INTO maintenance_state (id,state,barrier_id,authority_epoch,capture_id,updated_at,generation) VALUES (1,'open',NULL,?,NULL,?,0) ON CONFLICT(id) DO UPDATE SET authority_epoch=excluded.authority_epoch,updated_at=excluded.updated_at",[epoch,nowMs]);
}
/** Caller validates the finite transition and keeps metadata/job changes in the same transaction. */
export function transitionMaintenance(tx:WorkspaceTransaction,input:{state:MaintenanceState;epoch:number;barrierId:string;captureId:string;nowMs:number;advance:boolean}):AdmissionFence {
 const prior=maintenanceRow(tx);if(prior?.state==='retired')throw Error('AUTHORITY_RETIRED');
 if(['captured','restored','retired'].includes(input.state)||input.state==='open'&&prior?.state!=='open')assertArtifactEffectsDrained(tx);
 const generation=(prior?.generation??0)+Number(input.advance);
 if(!Number.isSafeInteger(generation))throw Error('MAINTENANCE_GENERATION_EXHAUSTED');
 tx.exec('INSERT INTO maintenance_state (id,state,barrier_id,authority_epoch,capture_id,updated_at,generation) VALUES (1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,barrier_id=excluded.barrier_id,authority_epoch=excluded.authority_epoch,capture_id=excluded.capture_id,updated_at=excluded.updated_at,generation=excluded.generation',[input.state,input.barrierId,input.epoch,input.captureId,input.nowMs,generation]);
 tx.exec('UPDATE workspace_metadata SET admission_state=? WHERE id=1',[input.state==='open'?'installed':input.state==='retired'?'retired':'maintenance']);
 return {authorityEpoch:input.epoch,maintenanceGeneration:generation};
}

/** Completion/resume is not safe while an earlier external effect can still materialize.
 * Reserved calls never dispatched and are invalidated by the barrier; unknown effects remain holds.
 * The shared transition reexport retains an explicit exact-schema7 policy; it cannot admit current-schema recovery. */
export function assertArtifactEffectsDrained(tx:WorkspaceTransaction):void {
 if(tx.one<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations')?.version===7){assertSchemaVersion(tx,7);return;}
 assertSchemaVersion(tx,CURRENT_SCHEMA_VERSION);
 if(tx.one("SELECT id FROM artifact_generations WHERE effect_state IN ('in_flight','uncertain') LIMIT 1"))throw Error('ARTIFACT_EFFECTS_NOT_DRAINED');
}
