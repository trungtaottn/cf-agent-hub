export interface Finding {code:string;path:string;message:string;}
export interface Dimensions {sql_bytes:number;chunks:number;artifact_bytes:number;artifact_count:number;canonical_manifest_bytes:number;}
export type WorkloadId='sql-boundary'|'artifact-boundary'|'combined-boundary'|'over-limit';
export type Layer='controller-full-flow'|'manifest-validator';
export type PlatformSubject=
 |{kind:'resolution';runtime_version:string;configuration_sha256:string;plan_record_sha256:string;applicability_record_sha256:string}
 |{kind:'plan';resolution_sha256:string;review_record_sha256:string}
 |{kind:'workload';id:WorkloadId;input_sha256:string;dimensions:Dimensions;observation_layer:Layer};
export interface PlatformContext {
 candidate?:{revision:string;tree_sha256:string;composition_sha256:string;author_id?:string};
 environment?:{id:string;workspace_id?:string;object_name?:string;config_epoch?:number};
 configuration_sha256?:string;
 commands?:Map<string,{id:string;kind:string;revision:string;tree_sha256:string;composition_sha256:string;environment_id:string;started_at:number;ended_at:number;exit_code:number;prepared_subjects?:{platform?:PlatformSubject|null}}>;
 receipts?:Map<string,unknown>;
}
export const schema:Record<string,unknown>;
export const PLATFORM_LIMITS:Readonly<{platform:16384;resolution:8192;plan:32768;workload:8192}>;
export const PLATFORM_WORKLOADS:readonly WorkloadId[];
export function references(value:unknown):Array<{ref:{path:string;sha256:string;byte_size:number};type:string;maxBytes:number}>;
export function validatePlatform(value:unknown,context?:PlatformContext):Finding[];
