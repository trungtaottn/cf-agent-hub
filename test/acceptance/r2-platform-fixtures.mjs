// Synthetic projection fixtures; never real qualification or a verified entitlement.
import {createHash} from 'node:crypto';
export const hash=label=>createHash('sha256').update(label).digest('hex');
export function makePlatformEvidence(options={}) {
 const candidate={revision:'a'.repeat(40),tree_sha256:hash('tree'),composition_sha256:hash('composition'),author_id:'author'};
 const environment={id:'target_env',workspace_id:'workspace_a',object_name:'target_object',config_epoch:2};
 const configuration_sha256=hash('application_configuration'),commands=new Map(),receipts=new Map(),ctx={candidate,environment,configuration_sha256,commands,receipts};
 const common=(type,id,time,kind)=>{
  commands.set(id,{id,kind,revision:candidate.revision,tree_sha256:candidate.tree_sha256,composition_sha256:candidate.composition_sha256,environment_id:environment.id,started_at:time-10,ended_at:time+10,exit_code:0,prepared_subjects:{platform:null}});
  return {type,version:1,revision:candidate.revision,tree_sha256:candidate.tree_sha256,composition_sha256:candidate.composition_sha256,environment_id:environment.id,command_id:id,observed_at:time,observer_id:'controller',record_sha256:hash('record_'+id)};
 };
 const store=(name,value)=>{const body=JSON.stringify(value),ref={path:'validation/releases/synthetic/'+name+'.json',sha256:hash(body),byte_size:Buffer.byteLength(body)};receipts.set(ref.path,value);return ref;};
 const resolution={...common('r2-platform-resolution','resolution',100,'deployed-recovery'),status:'qualified',source_id:'cloudflare-workers-limits',runtime_version:'runtime_a',configuration_sha256,plan_record_sha256:hash('plan_entitlement'),limit_kind:options.limit_kind??'aggregate-chain',worker_invocation_limit:32,subrequest_limit:1000,applicability_record_sha256:hash('applicability')};
 commands.get('resolution').prepared_subjects.platform={kind:'resolution',runtime_version:resolution.runtime_version,configuration_sha256,plan_record_sha256:resolution.plan_record_sha256,applicability_record_sha256:resolution.applicability_record_sha256};
 const resolutionRef=store('resolution',resolution);
 const dimensions=[{sql_bytes:1048576,chunks:1,artifact_bytes:0,artifact_count:0,canonical_manifest_bytes:1000},{sql_bytes:1024,chunks:1,artifact_bytes:10485760,artifact_count:1,canonical_manifest_bytes:1000},{sql_bytes:1048576,chunks:1,artifact_bytes:10485760,artifact_count:1,canonical_manifest_bytes:1000},{sql_bytes:268435456,chunks:256,artifact_bytes:1,artifact_count:1,canonical_manifest_bytes:1000}];
 const ids=['sql-boundary','artifact-boundary','combined-boundary','over-limit'];
 const workloads=ids.map((id,n)=>({ ...common('r2-platform-workload',id,300+n*10,n===3?'operator-tests':'deployed-recovery'),id,input_sha256:hash('input_'+id),dimensions:dimensions[n],observation_layer:n===3?'manifest-validator':'controller-full-flow',outcome:n===3?'rejected':'completed',stages:n===3?[]:['capture','restore','remote-verify'],peak_worker_invocations:n===3?0:8,peak_subrequests:n===3?0:12,peak_depth:n===3?0:4,external_effects:0,rejection_code:n===3?'RECOVERY_TOTAL_BYTES_LIMIT':null,http_status:null}));
 for(const row of workloads)commands.get(row.command_id).prepared_subjects.platform={kind:'workload',id:row.id,input_sha256:row.input_sha256,dimensions:structuredClone(row.dimensions),observation_layer:row.observation_layer};
 const plan={...common('r2-platform-plan','boundary_plan',200,'contract'),observer_id:'reviewer',reviewer_id:'reviewer',resolution_sha256:resolutionRef.sha256,workloads:workloads.map(row=>({id:row.id,input_sha256:row.input_sha256,dimensions:structuredClone(row.dimensions),observation_layer:row.observation_layer,expected_outcome:row.outcome}))};
 commands.get(plan.command_id).prepared_subjects.platform={kind:'plan',resolution_sha256:plan.resolution_sha256,review_record_sha256:plan.record_sha256};
 const value={...common('r2-platform','platform_assembly',1000,'contract'),resolution:resolutionRef,plan:store('boundary_plan',plan),workloads:workloads.map(row=>store(row.id,row))};
 return {value,resolution,plan,workloads,ctx};
}
export function changeWorkloadDimensions(f,index,changes){
 Object.assign(f.workloads[index].dimensions,changes);
 f.plan.workloads[index].dimensions=structuredClone(f.workloads[index].dimensions);
 f.ctx.commands.get(f.workloads[index].command_id).prepared_subjects.platform.dimensions=structuredClone(f.workloads[index].dimensions);
}
