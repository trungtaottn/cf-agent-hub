import Ajv from 'ajv';
import schema from '../../validation/r2-recovery-evidence.schema.json' with {type:'json'};
export {schema};
export const RECOVERY_LIMITS = Object.freeze({recovery:2097152, result_graph:16384, restore_input:8192, expected_transform:65536, control:6144});
export const RECOVERY_TABLES = Object.freeze([...schema.$defs.table.enum]);
export const PRESERVED_TABLES = Object.freeze(['profiles','preferences','threads','thread_participants','messages','inbox','task_results','task_acceptances','result_artifacts','artifact_associations','message_artifacts','import_mappings']);
const ajv = new Ajv({allErrors:false, strict:true});
ajv.addSchema(schema);
const shapes = Object.fromEntries(['recovery','result_graph','restore_input','expected_transform','prepared_recovery_subject'].map(name=>[name,ajv.compile({$ref:schema.$id+'#/$defs/'+name})]));
const same = (a,b) => canonical(a)===canonical(b);
function canonical(value) {
 if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
 if(value && typeof value==='object') return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const unique = values => new Set(values).size===values.length;
// Inventory environment names the evidence execution environment; remote routing
// is independently bound by recovery identity, controls and fresh anchor reads.
const boundCommand = (command,ctx,kind) => !!command && command.kind===kind && command.exit_code===0 && command.revision===ctx.candidate?.revision && command.tree_sha256===ctx.candidate?.tree_sha256 && command.composition_sha256===ctx.candidate?.composition_sha256 && command.environment_id===ctx.environment?.id;
const within = (time,command) => !!command && time>=command.started_at && time<=command.ended_at;
const safeSum = numbers => numbers.reduce((total,n)=>Number.isSafeInteger(total+n)?total+n:Infinity,0);
function report() {
 const findings=[];
 return {findings,check(ok,code,path){if(!ok)findings.push({code,path,message:'Recovery evidence predicate failed.'});}};
}
function shape(value,name,out) {
 if(!shapes[name](value)) {out.check(false,'R2_RECOVERY_SCHEMA',name);return false;}
 if(bytes(value)>RECOVERY_LIMITS[name]) {out.check(false,'R2_RECOVERY_BUDGET',name);return false;}
 return true;
}
function common(value,ctx,out,kinds) {
 const c=ctx.candidate,e=ctx.environment,command=ctx.commands?.get(value.command_id);
 out.check(!!c && value.revision===c.revision && value.tree_sha256===c.tree_sha256 && value.composition_sha256===c.composition_sha256,'R2_RECOVERY_CANDIDATE',value.type);
 out.check(!!e && value.environment_id===e.id,'R2_RECOVERY_ENVIRONMENT',value.type);
 out.check(!!command && kinds.includes(command.kind) && command.exit_code===0 && command.revision===value.revision && command.tree_sha256===value.tree_sha256 && command.composition_sha256===value.composition_sha256 && command.environment_id===value.environment_id && within(value.observed_at,command),'R2_RECOVERY_COMMAND',value.type);
 return command;
}
/** Explicit typed references only; main reserves aggregate bytes before reading. */
export function references(value) {
 return value?.type==='r2-recovery' ? [
  {ref:value.restore_input,type:'r2-restore-input-context',maxBytes:RECOVERY_LIMITS.restore_input},
  {ref:value.expected_transform,type:'r2-expected-transform',maxBytes:RECOVERY_LIMITS.expected_transform}
 ] : [];
}
function subjectFor(command,recovery,out) {
 const subject=command?.prepared_subjects?.recovery;
 if(!shapes.prepared_recovery_subject(subject)){out.check(false,'R2_RECOVERY_SUBJECT','prepared_subjects.recovery');return null;}
 out.check(same(subject.identity,recovery.identity) && ['original_manifest_sha256','source_ledger_sha256','current_ledger_sha256','restore_job_created_at'].every(key=>subject[key]===recovery[key]),'R2_RECOVERY_SUBJECT','prepared_subjects.recovery');
 for(const side of ['source','target']) {
  const provider=subject[side+'_provider'],id=recovery.identity;
  out.check(provider.environment_id===id[side+'_environment_id'] && provider.object_name===id[side+'_object_name'] && provider.binding_id===recovery[side+'_anchor'].binding_id,'R2_RECOVERY_PROVIDER','prepared_subjects.recovery.'+side+'_provider');
 }
 out.check(subject.source_provider.record_sha256!==subject.target_provider.record_sha256,'R2_RECOVERY_PROVIDER','prepared_subjects.recovery');
 return subject;
}
function anchorMatches(anchor,side,value) {
 const i=value.identity;
 return anchor.workspace_id===i.workspace_id && anchor.environment_id===i[side+'_environment_id'] && anchor.object_name===i[side+'_object_name'] && anchor.authority_epoch===i[side+'_epoch'] && anchor.ledger_sha256===value[side==='source'?'source_ledger_sha256':'current_ledger_sha256'] && anchor.binding_id===value[side+'_anchor'].binding_id;
}
/** Structural/semantic checks do not authenticate an observer or establish live eligibility. */
export function validateRecovery(value,ctx={}) {
 const out=report();
 if(!shape(value,'recovery',out))return out.findings;
 const mainCommand=common(value,ctx,out,['deployed-recovery']);
 const subject=subjectFor(mainCommand,value,out),i=value.identity,env=ctx.environment;
 out.check(!!env && i.workspace_id===env.workspace_id && i.target_environment_id===env.id && i.target_object_name===env.object_name && i.target_epoch===env.config_epoch && i.target_epoch>i.source_epoch && i.target_environment_id!==i.source_environment_id,'R2_RECOVERY_IDENTITY','identity');
 const input=ctx.receipts?.get(value.restore_input.path),expected=ctx.receipts?.get(value.expected_transform.path);
 if(!shape(input,'restore_input',out)||!shape(expected,'expected_transform',out))return out.findings;
 const inputCommand=common(input,ctx,out,['operator-tests','deployed-recovery']),expectedCommand=common(expected,ctx,out,['operator-tests','deployed-recovery']);
 subjectFor(inputCommand,value,out);subjectFor(expectedCommand,value,out);
 out.check(unique([value.command_id,input.command_id,expected.command_id]) && unique([value.record_sha256,input.record_sha256,expected.record_sha256]) && input.prepared_input_record_sha256!==input.original_job_record_sha256,'R2_RECOVERY_PREPARATION','restore_input');
 for(const record of [input,expected])out.check(record.workspace_id===i.workspace_id && record.capture_id===i.capture_id && record.target_job_id===i.target_job_id && record.original_manifest_sha256===value.original_manifest_sha256 && record.current_ledger_sha256===value.current_ledger_sha256 && record.restore_job_created_at===value.restore_job_created_at,'R2_RECOVERY_TRANSFORM_BINDING',record.type);
 out.check(input.target_environment_id===i.target_environment_id && input.target_object_name===i.target_object_name && input.target_epoch===i.target_epoch && expected.source_checkpoint_sha256===value.source_checkpoint_sha256 && expected.target_checkpoint_sha256===value.target_checkpoint_sha256 && expected.restore_input_sha256===value.restore_input.sha256,'R2_RECOVERY_TRANSFORM_BINDING','expected_transform');
 out.check(same(value.tables.map(x=>x.name),RECOVERY_TABLES) && same(expected.tables.map(x=>x.name),RECOVERY_TABLES),'R2_RECOVERY_TABLE_SET','tables');
 for(let n=0;n<value.tables.length;n++) {
  const table=value.tables[n],projection=expected.tables[n];
  const preserved=PRESERVED_TABLES.includes(table.name);
  out.check(bytes(table)<=512 && bytes(projection)<=1024,'R2_RECOVERY_BUDGET','tables');
  out.check(table.source.rows<=1000000 && same(table.source,projection.source) && same(table.target,projection.expected) && projection.disposition===(preserved?'preserve':'current-transform') && (!preserved||same(table.source,table.target)),'R2_RECOVERY_TABLE_TRANSFORM','tables');
 }
 const manifest=value.manifest,artifacts=manifest.artifacts,chunks=manifest.chunks;
 out.check(chunks.every((chunk,index)=>index===0||RECOVERY_TABLES.indexOf(chunks[index-1].table)<=RECOVERY_TABLES.indexOf(chunk.table)),'R2_RECOVERY_CHUNK_ORDER','manifest.chunks');
 out.check([['schema_migrations',16],['workspace_metadata',1],['maintenance_state',1]].every(([name,count])=>value.tables.find(table=>table.name===name)?.source.rows===count),'R2_RECOVERY_SYSTEM_COUNTS','tables');
 out.check(safeSum(chunks.map(x=>x.byte_size))===manifest.database_byte_size && safeSum(chunks.map(x=>x.row_count))===manifest.rows && chunks.every((x,n)=>x.index===n && bytes(x)<=512),'R2_RECOVERY_CHUNKS','manifest.chunks');
 out.check(safeSum(value.tables.map(x=>x.source.rows))===manifest.rows && Number.isSafeInteger(safeSum(value.tables.map(x=>x.target.rows))),'R2_RECOVERY_ROWS','tables');
 for(const table of value.tables)out.check(safeSum(chunks.filter(x=>x.table===table.name).map(x=>x.row_count))===table.source.rows,'R2_RECOVERY_CHUNK_TABLE','manifest.chunks');
 out.check(unique(artifacts.map(x=>x.artifact_id)) && unique(artifacts.map(x=>x.generation_id)) && unique(manifest.unfinished_artifact_ids) && manifest.unfinished_artifact_ids.every(id=>!artifacts.some(x=>x.artifact_id===id)),'R2_RECOVERY_ARTIFACT_SET','manifest.artifacts');
 out.check(artifacts.some(x=>x.declared.byte_size>0) && artifacts.every(x=>bytes(x)<=1536 && (x.declared.byte_size!==0 || x.declared.sha256==='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') && same(x.declared,x.source_verified) && same(x.declared,x.target_verified)),'R2_RECOVERY_ARTIFACT_BYTES','manifest.artifacts');
 out.check(safeSum([manifest.database_byte_size,...artifacts.map(x=>x.declared.byte_size)])<=268435456,'R2_RECOVERY_TOTAL_BYTES','manifest');
 out.check(value.tables.find(x=>x.name==='artifacts')?.source.rows===artifacts.length+manifest.unfinished_artifact_ids.length && value.tables.find(x=>x.name==='artifact_generations')?.source.rows>=artifacts.length,'R2_RECOVERY_ARTIFACT_PARTITION','tables');
 const controls=value.controls,ops=['capture','restore','probe','resolve-delivery','retire','resume'];
 out.check(same(controls.map(x=>x.operation),ops),'R2_RECOVERY_CONTROL_SET','controls');
 out.check(unique(controls.map(x=>x.command_id)) && unique(controls.map(x=>x.record_sha256)) && unique(controls.map(x=>x.receipt_id)) && unique(controls.map(x=>x.current_read.record_sha256)),'R2_RECOVERY_CONTROL_IDENTITY','controls');
 const byOperation=new Map(controls.map(x=>[x.operation,x]));
 // Fixed positional lookups are safe only after the exact stage-set check.
 if(!same(controls.map(x=>x.operation),ops))return out.findings;
 for(let n=0;n<controls.length;n++) {
  const control=controls[n],side=['capture','retire'].includes(control.operation)?'source':'target';
  const command=ctx.commands?.get(control.command_id);
  subjectFor(command,value,out);
  out.check(bytes(control)<=RECOVERY_LIMITS.control,'R2_RECOVERY_BUDGET','controls');
  out.check(boundCommand(command,ctx,'deployed-recovery') && within(control.started_at,command) && within(control.ended_at,command) && control.started_at<=control.current_read.observed_at && control.current_read.observed_at<=control.admitted_at && control.admitted_at<=control.ended_at && (n===0 || controls[n-1].ended_at<=control.started_at),'R2_RECOVERY_CONTROL_TIME','controls');
  out.check(control.workspace_id===i.workspace_id && control.capture_id===i.capture_id && control.job_id===i[side+'_job_id'] && control.environment_id===i[side+'_environment_id'] && control.object_name===i[side+'_object_name'] && control.authority_epoch===i[side+'_epoch'] && control.manifest_sha256===value.original_manifest_sha256 && control.ledger_sha256===value[side==='source'?'source_ledger_sha256':'current_ledger_sha256'],'R2_RECOVERY_CONTROL_BINDING','controls');
  out.check(anchorMatches(control.current_read,side,value) && control.anchor_generation===control.current_read.generation,'R2_RECOVERY_CURRENT_ANCHOR','controls');
  out.check(control.operation==='probe'?control.probe_checked_at!==null && control.probe_checked_at>=control.started_at && control.probe_checked_at<=control.ended_at:control.probe_checked_at===null,'R2_RECOVERY_PROBE_TIME','controls');
  const replayKeys=Object.keys(control).filter(key=>key.startsWith('replay_'));
  if(['retire','resume'].includes(control.operation)) {
   const replay=ctx.commands?.get(control.replay_command_id),anchor=control.replay_current_read;
   subjectFor(replay,value,out);
   out.check(replayKeys.every(key=>control[key]!==null),'R2_RECOVERY_REPLAY_REQUIRED','controls');
   if(anchor) {
    out.check(boundCommand(replay,ctx,'deployed-recovery') && control.replay_command_id!==control.command_id && control.ended_at<=anchor.observed_at && anchor.observed_at<=control.replay_observed_at && within(anchor.observed_at,replay) && within(control.replay_observed_at,replay),'R2_RECOVERY_REPLAY_TIME','controls');
    out.check(anchorMatches(anchor,side,value) && anchor.generation===control.current_read.generation && anchor.record_sha256!==control.current_read.record_sha256,'R2_RECOVERY_REPLAY_ANCHOR','controls');
   }
   out.check(control.record_sha256!==control.replay_record_sha256 && control.original_outcome_sha256===control.replay_outcome_sha256 && control.replay_before_state_sha256===control.replay_after_state_sha256,'R2_RECOVERY_REPLAY_OUTCOME','controls');
  } else out.check(replayKeys.every(key=>control[key]===null),'R2_RECOVERY_REPLAY_UNSUPPORTED','controls');
 }
 const capture=byOperation.get('capture'),restore=byOperation.get('restore'),probe=byOperation.get('probe'),resolve=byOperation.get('resolve-delivery'),retire=byOperation.get('retire'),resume=byOperation.get('resume');
 out.check(same(value.source_anchor,capture.current_read) && same(value.target_anchor,restore.current_read),'R2_RECOVERY_INITIAL_ANCHOR','source_anchor');
 out.check(within(value.restore_job_created_at,ctx.commands?.get(restore.command_id)) && expected.observed_at>=restore.ended_at && expected.observed_at<=probe.started_at,'R2_RECOVERY_CHECKPOINT_TIME','expected_transform');
 const local=value.local_verification,localCommand=ctx.commands?.get(local.command_id);
 subjectFor(localCommand,value,out);
 out.check(boundCommand(localCommand,ctx,'operator-tests') && within(local.observed_at,localCommand) && capture.ended_at<=local.observed_at && local.observed_at<=restore.started_at && local.manifest_sha256===value.original_manifest_sha256,'R2_RECOVERY_LOCAL_VERIFY','local_verification');
 const final=value.capture_finalization,artifactIds=artifacts.map(x=>x.artifact_id);
 out.check(final.job_id===i.source_job_id && final.authority_epoch===i.source_epoch && final.anchor_generation===value.source_anchor.generation && final.total===artifactIds.length && final.index===final.total && final.artifact_ids.length===final.total && unique(final.artifact_ids) && same([...final.artifact_ids].sort(),[...artifactIds].sort()),'R2_RECOVERY_FINALIZATION','capture_finalization');
 const holds=value.holds;
 out.check(holds.unresolved_effect_count===0 && holds.unresolved_effect_ids.length===0 && holds.unresolved_effect_ids_complete && holds.unresolved_artifact_copy_count===0 && holds.unresolved_artifact_copy_ids.length===0 && holds.unresolved_artifact_copy_ids_complete && resolve.ended_at<=holds.observed_at && holds.observed_at<=resume.started_at,'R2_RECOVERY_HOLDS','holds');
 const cut=value.cutover;
 out.check(retire.source_retirement_sha256===retire.protocol_receipt_sha256 && resume.source_retirement_sha256===retire.source_retirement_sha256 && resume.probe_receipt_sha256===probe.protocol_receipt_sha256 && cut.capture_id===i.capture_id && cut.workspace_id===i.workspace_id && cut.source_environment_id===i.source_environment_id && cut.target_environment_id===i.target_environment_id && cut.source_epoch===i.source_epoch && cut.target_epoch===i.target_epoch && cut.target_object_name===i.target_object_name && cut.source_retirement_receipt_id===retire.receipt_id && retire.ended_at<=cut.cutover_at && cut.cutover_at<=resume.started_at,'R2_RECOVERY_CUTOVER','cutover');
 out.check(capture.after_generation===retire.before_generation && restore.after_generation===probe.before_generation && probe.after_generation===resolve.before_generation && resolve.after_generation===resume.before_generation && resume.after_generation===resume.before_generation+1 && retire.after_generation===retire.before_generation+1 && probe.after_generation===probe.before_generation && resolve.after_generation===resolve.before_generation && probe.after_generation===resume.before_generation && resume.started_at>=probe.probe_checked_at && resume.started_at-probe.probe_checked_at<=300000,'R2_RECOVERY_GENERATION_PROBE','controls');
 const authority=value.authority;
 out.check(authority.old_credential_attempts>0 && authority.old_credential_attempts===authority.old_credential_denials && authority.old_proof_attempts>0 && authority.old_proof_attempts===authority.old_proof_denials && authority.archived_identities_resurrected===0 && authority.fresh_credential_issued_at>=resume.ended_at && authority.fresh_runtime_created_at>=authority.fresh_credential_issued_at && authority.observed_at>=authority.fresh_runtime_created_at,'R2_RECOVERY_AUTHORITY','authority');
 const restartCommand=ctx.commands?.get(value.restart.command_id);
 subjectFor(restartCommand,value,out);
 out.check(boundCommand(restartCommand,ctx,'deployed-recovery') && within(value.restart.observed_at,restartCommand) && value.restart.observed_at>=resume.ended_at && value.restart.target_epoch===i.target_epoch,'R2_RECOVERY_RESTART','restart');
 out.check(value.observed_at>=Math.max(authority.observed_at,value.restart.observed_at,...controls.map(c=>c.replay_observed_at??c.ended_at)),'R2_RECOVERY_COMPLETENESS_TIME','observed_at');
 return out.findings;
}

export function validateResultGraph(value,ctx={}) {
 const out=report();if(!shape(value,'result_graph',out))return out.findings;
 const command=common(value,ctx,out,['native-live','workers-tests','node-tests']);
 const subject=command?.prepared_subjects?.graph,env=ctx.environment;
 out.check(!!subject && subject.workspace_id===value.workspace_id && subject.task_id===value.task.id && subject.run_id===value.run.id && env?.workspace_id===value.workspace_id,'R2_RESULT_SUBJECT','result_graph');
 const {task,run,result,acceptance,submit,accept,replay}=value;
 const executionKeys=['submit_original_record_sha256','submit_replay_record_sha256','accept_original_record_sha256','accept_replay_record_sha256'];
 out.check(!!subject?.execution_records && executionKeys.every(key=>subject.execution_records[key]===replay[key]),'R2_RESULT_EXECUTION_MANIFEST','prepared_subjects.graph.execution_records');
 out.check([task,run,result,acceptance].every(x=>x.workspace_id===value.workspace_id) && [submit,accept].every(x=>['event_workspace_id','outcome_workspace_id','history_workspace_id'].every(key=>x[key]===value.workspace_id)),'R2_RESULT_WORKSPACE','result_graph');
 out.check(task.latest_run_id===run.id && result.run_id===run.id && acceptance.run_id===run.id && task.current_result_id===result.id && acceptance.result_id===result.id && [run,result,acceptance].every(x=>x.task_id===task.id),'R2_RESULT_GRAPH','result_graph');
 out.check(result.submitted_principal_id===result.submitted_agent_id && result.submitted_agent_id===run.agent_id && acceptance.reviewer_principal_id===acceptance.reviewer_agent_id && acceptance.reviewer_principal_id!==result.submitted_principal_id && acceptance.reviewer_agent_id!==result.submitted_agent_id && acceptance.count===1,'R2_RESULT_INDEPENDENCE','acceptance');
 for(const [name,edge,principal] of [['submit',submit,result.submitted_principal_id],['accept',accept,acceptance.reviewer_principal_id]]) {
  const event=name==='submit'?'task.result_submitted':'task.result_accepted';
  out.check(edge.event_type===event && edge.history_kind===event && edge.outcome_event_id===edge.event_id && edge.history_event_id===edge.event_id && edge.resource_id===task.id && edge.history_task_id===task.id && edge.history_run_id===run.id && edge.actor_principal_id===principal && edge.outcome_principal_id===principal && edge.history_count===1,'R2_RESULT_EDGE',name);
  out.check(edge.outcome_data_sha256===replay[name+'_original_outcome_sha256'] && edge.outcome_data_sha256===replay[name+'_replay_outcome_sha256'],'R2_RESULT_REPLAY_DATA',name);
 }
 out.check(submit.event_id!==accept.event_id && replay.before_sha256===replay.after_sha256 && unique(['submit_original_record_sha256','submit_replay_record_sha256','accept_original_record_sha256','accept_replay_record_sha256'].map(key=>replay[key])),'R2_RESULT_REPLAY_STATE','replay');
 return out.findings;
}
