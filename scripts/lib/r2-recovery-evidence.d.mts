/** Closed JSON Schema owns receipt fields; unknown inputs fail closed. */
export interface Finding { code:string; path:string; message:string; }
export interface RecoveryIdentity {
 workspace_id:string; capture_id:string; source_job_id:string; target_job_id:string;
 source_environment_id:string; target_environment_id:string;
 source_object_name:string; target_object_name:string;
 source_epoch:number; target_epoch:number; schema_version:16;
}
export interface ProviderMapping {
 environment_id:string; object_name:string; deployment_id:string;
 namespace_id:string; binding_id:string; record_sha256:string;
}
export interface PreparedRecoverySubject {
 identity:RecoveryIdentity; original_manifest_sha256:string;
 source_ledger_sha256:string; current_ledger_sha256:string;
 restore_job_created_at:number; source_provider:ProviderMapping; target_provider:ProviderMapping;
}
export interface PreparedGraphSubject {
 workspace_id:string; task_id:string; run_id:string;
 /** Independently controller-inspected post-run execution manifest, not pre-run hashes. */
 execution_records:{submit_original_record_sha256:string;submit_replay_record_sha256:string;accept_original_record_sha256:string;accept_replay_record_sha256:string};
}
export interface EvidenceCommand {
 id:string; kind:string; revision:string; tree_sha256:string; composition_sha256:string; environment_id:string;
 started_at:number; ended_at:number; exit_code:number;
 prepared_subjects?:{recovery?:PreparedRecoverySubject|null; graph?:PreparedGraphSubject|null};
}
export interface RecoveryContext {
 candidate?:{revision:string; tree_sha256:string; composition_sha256:string; author_id?:string};
 environment?:{id:string; workspace_id:string; object_name:string; config_epoch:number};
 commands?:Map<string,EvidenceCommand>;
 /** Preloaded/hash checked/aggregate-budgeted receipts only; helpers never read files. */
 receipts?:Map<string,unknown>;
}
export interface ArtifactRef {path:string; sha256:string; byte_size:number;}
export const schema:Record<string,unknown>;
export const RECOVERY_LIMITS:Readonly<{recovery:2097152; result_graph:16384; restore_input:8192; expected_transform:65536; control:6144}>;
export const RECOVERY_TABLES:readonly string[];
export const PRESERVED_TABLES:readonly string[];
export function references(value:unknown):Array<{ref:ArtifactRef; type:'r2-restore-input-context'|'r2-expected-transform'; maxBytes:number}>;
export function validateRecovery(value:unknown,context?:RecoveryContext):Finding[];
export function validateResultGraph(value:unknown,context?:RecoveryContext):Finding[];
