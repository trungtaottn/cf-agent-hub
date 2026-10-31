import Ajv from 'ajv';
import schema from '../../validation/r2-platform-evidence.schema.json' with {type:'json'};
export {schema};
export const PLATFORM_LIMITS=Object.freeze({platform:16384,resolution:8192,plan:32768,workload:8192});
export const PLATFORM_WORKLOADS=Object.freeze(['sql-boundary','artifact-boundary','combined-boundary','over-limit']);
const ajv=new Ajv({strict:true,allErrors:false});ajv.addSchema(schema);
const validators=Object.fromEntries(['platform','resolution','plan','workload','platform_subject'].map(name=>[name,ajv.compile({$ref:schema.$id+'#/$defs/'+name})]));
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
const equal=(a,b)=>canonical(a)===canonical(b);
const unique=values=>new Set(values).size===values.length;
function report(){const findings=[];return {findings,check(ok,code,path){if(!ok)findings.push({code,path,message:'Platform evidence predicate failed.'});}};}
function shape(value,name,out){
 if(!validators[name](value)){out.check(false,'R2_PLATFORM_SCHEMA',name);return false;}
 if(Buffer.byteLength(JSON.stringify(value))>PLATFORM_LIMITS[name]){out.check(false,'R2_PLATFORM_BUDGET',name);return false;}
 return true;
}
function common(value,ctx,out,kinds){
 const candidate=ctx.candidate,environment=ctx.environment,command=ctx.commands?.get(value.command_id);
 out.check(!!candidate&&value.revision===candidate.revision&&value.tree_sha256===candidate.tree_sha256&&value.composition_sha256===candidate.composition_sha256,'R2_PLATFORM_CANDIDATE',value.type);
 out.check(!!environment&&value.environment_id===environment.id,'R2_PLATFORM_ENVIRONMENT',value.type);
 out.check(!!command&&kinds.includes(command.kind)&&command.exit_code===0&&command.revision===value.revision&&command.tree_sha256===value.tree_sha256&&command.composition_sha256===value.composition_sha256&&command.environment_id===value.environment_id&&value.observed_at>=command.started_at&&value.observed_at<=command.ended_at,'R2_PLATFORM_COMMAND',value.type);
 return command;
}
function subject(command,expected,out){
 const actual=command?.prepared_subjects?.platform;
 out.check(validators.platform_subject(actual)&&equal(actual,expected),'R2_PLATFORM_SUBJECT','prepared_subjects.platform');
}
/** Main reserves these explicit refs together before filesystem reads. */
export function references(value){
 return value?.type==='r2-platform'?[{ref:value.resolution,type:'r2-platform-resolution',maxBytes:PLATFORM_LIMITS.resolution},{ref:value.plan,type:'r2-platform-plan',maxBytes:PLATFORM_LIMITS.plan},...(Array.isArray(value.workloads)?value.workloads:[]).map(ref=>({ref,type:'r2-platform-workload',maxBytes:PLATFORM_LIMITS.workload}))]:[];
}
/** Structural source checks never prove real runtime entitlement or observer authenticity. */
export function validatePlatform(value,ctx={}){
 const out=report();if(!shape(value,'platform',out))return out.findings;
 common(value,ctx,out,['contract']);
 const resolution=ctx.receipts?.get(value.resolution.path),plan=ctx.receipts?.get(value.plan.path),workloads=value.workloads.map(ref=>ctx.receipts?.get(ref.path));
 if(!shape(resolution,'resolution',out)||!shape(plan,'plan',out))return out.findings;
 if(workloads.some(row=>!shape(row,'workload',out)))return out.findings;
 const resolutionCommand=common(resolution,ctx,out,['deployed-recovery']);
 subject(resolutionCommand,{kind:'resolution',runtime_version:resolution.runtime_version,configuration_sha256:resolution.configuration_sha256,plan_record_sha256:resolution.plan_record_sha256,applicability_record_sha256:resolution.applicability_record_sha256},out);
 out.check(resolution.status==='qualified'&&resolution.configuration_sha256===ctx.configuration_sha256,'R2_PLATFORM_QUALIFICATION','resolution');
 const planCommand=common(plan,ctx,out,['contract']);
 out.check(!!planCommand&&resolution.observed_at<=planCommand.started_at,'R2_PLATFORM_RESOLUTION_TIME','plan');
 subject(planCommand,{kind:'plan',resolution_sha256:plan.resolution_sha256,review_record_sha256:plan.record_sha256},out);
 out.check(typeof ctx.candidate?.author_id==='string'&&plan.reviewer_id!==ctx.candidate.author_id&&plan.observer_id===plan.reviewer_id&&plan.resolution_sha256===value.resolution.sha256,'R2_PLATFORM_INDEPENDENT_PLAN','plan');
 out.check(equal(plan.workloads.map(x=>x.id),PLATFORM_WORKLOADS)&&equal(workloads.map(x=>x.id),PLATFORM_WORKLOADS),'R2_PLATFORM_WORKLOAD_SET','workloads');
 out.check(unique(workloads.map(x=>x.command_id))&&unique(workloads.map(x=>x.record_sha256))&&unique(value.workloads.map(x=>x.path)),'R2_PLATFORM_WORKLOAD_IDENTITY','workloads');
 for(const row of workloads){
  const over=row.id==='over-limit',command=common(row,ctx,out,over?['operator-tests','deployed-recovery']:['deployed-recovery']);
  out.check(!!command&&plan.observed_at<=command.started_at,'R2_PLATFORM_PLAN_TIME','workloads');
  subject(command,{kind:'workload',id:row.id,input_sha256:row.input_sha256,dimensions:row.dimensions,observation_layer:row.observation_layer},out);
  const planned=plan.workloads.find(x=>x.id===row.id);
  out.check(!!planned&&planned.input_sha256===row.input_sha256&&equal(planned.dimensions,row.dimensions)&&planned.observation_layer===row.observation_layer&&planned.expected_outcome===row.outcome,'R2_PLATFORM_REVIEWED_INPUT','workloads');
  const d=row.dimensions,total=d.sql_bytes+d.artifact_bytes;
  const safe=Number.isSafeInteger(total)&&Number.isSafeInteger(d.chunks*1048576)&&Number.isSafeInteger(d.artifact_count*10485760);
  out.check(safe&&d.sql_bytes>0&&d.chunks>0&&d.canonical_manifest_bytes>0&&d.sql_bytes>=d.chunks&&d.sql_bytes<=d.chunks*1048576&&d.artifact_count<=1000&&d.artifact_bytes<=d.artifact_count*10485760,'R2_PLATFORM_DIMENSIONS','workloads');
  if(over){
   const exceeded=[total>268435456,d.chunks>256,d.canonical_manifest_bytes>65536];
   const code=exceeded[1]||exceeded[2]?'INVALID_RECOVERY_MANIFEST':'RECOVERY_TOTAL_BYTES_LIMIT';
   out.check(exceeded.filter(Boolean).length===1&&row.outcome==='rejected'&&row.observation_layer==='manifest-validator'&&row.stages.length===0&&row.peak_worker_invocations===0&&row.peak_subrequests===0&&row.peak_depth===0&&row.external_effects===0&&row.rejection_code===code,'R2_PLATFORM_OVER_LIMIT','workloads');
  }else{
   out.check(total<=268435456&&d.chunks<=256&&d.canonical_manifest_bytes<=65536&&row.outcome==='completed'&&row.observation_layer==='controller-full-flow'&&equal(row.stages,['capture','restore','remote-verify'])&&row.rejection_code===null,'R2_PLATFORM_FULL_FLOW','workloads');
   out.check(row.id==='sql-boundary'||(d.artifact_bytes>0&&d.artifact_count>0),'R2_PLATFORM_ARTIFACT_WORKLOAD','workloads');
   out.check(row.peak_worker_invocations>0&&row.peak_depth>0&&row.peak_depth<=row.peak_worker_invocations&&row.peak_subrequests>0&&row.peak_subrequests<=resolution.subrequest_limit&&(resolution.limit_kind==='aggregate-chain'?row.peak_worker_invocations:row.peak_depth)<=resolution.worker_invocation_limit,'R2_PLATFORM_RUNTIME_LIMIT','workloads');
  }
 }
 out.check(value.observed_at>=Math.max(resolution.observed_at,plan.observed_at,...workloads.map(x=>x.observed_at)),'R2_PLATFORM_ASSEMBLY_TIME','observed_at');
 return out.findings;
}
