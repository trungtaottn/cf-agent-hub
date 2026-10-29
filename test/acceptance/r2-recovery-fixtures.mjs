// Synthetic structural fixtures only. No live provenance or acceptance claim.
import {createHash} from 'node:crypto';
import {schema,RECOVERY_TABLES,PRESERVED_TABLES} from '../../scripts/lib/r2-recovery-evidence.mjs';
export const hash = label => createHash('sha256').update(label).digest('hex');
const h=hash('state');
function fill(def) {
 if(def.$ref)return fill(schema.$defs[def.$ref.split('/').at(-1)]);
 if('const' in def)return def.const;
 if(def.enum)return def.enum[0];
 if(def.anyOf)return null;
 if(def.type==='object')return Object.fromEntries(Object.entries(def.properties).map(([key,value])=>[key,fill(value)]));
 if(def.type==='array')return Array.from({length:def.minItems??0},()=>fill(def.items));
 if(def.type==='integer')return def.minimum??0;
 if(def.type==='boolean')return true;
 if(def.pattern?.includes('{64}'))return h;
 if(def.pattern?.includes('{40}'))return 'a'.repeat(40);
 if(def.pattern?.includes('generation_'))return 'generation_'+'a'.repeat(48);
 return 'id';
}
export function recoveryFixture() {
 const value=fill(schema.$defs.recovery),input=fill(schema.$defs.restore_input),expected=fill(schema.$defs.expected_transform);
 const candidate={revision:'a'.repeat(40),tree_sha256:hash('tree'),composition_sha256:hash('composition'),author_id:'author'};
 const environment={id:'target_env',workspace_id:'workspace_a',object_name:'target_object',config_epoch:2};
 const commands=new Map(),receipts=new Map(),ctx={candidate,environment,commands,receipts};
 const identity={workspace_id:environment.workspace_id,capture_id:'capture_a',source_job_id:'capture_job',target_job_id:'restore_job',source_environment_id:'source_env',target_environment_id:'target_env',source_object_name:'source_object',target_object_name:'target_object',source_epoch:1,target_epoch:2,schema_version:16};
 Object.assign(value,{identity,original_manifest_sha256:hash('manifest'),source_ledger_sha256:hash('sourceledger'),current_ledger_sha256:hash('targetledger'),source_checkpoint_sha256:hash('sourcecheckpoint'),target_checkpoint_sha256:hash('targetcheckpoint'),restore_job_created_at:210});
 function command(id,kind='deployed-recovery',start=0,end=2000){const c={id,kind,revision:candidate.revision,tree_sha256:candidate.tree_sha256,composition_sha256:candidate.composition_sha256,environment_id:environment.id,exit_code:0,started_at:start,ended_at:end,prepared_subjects:{}};commands.set(id,c);return c;}
 function common(record,id,time,kind='deployed-recovery'){Object.assign(record,{...candidate,environment_id:environment.id,command_id:id,observed_at:time,observer_id:'controller',record_sha256:hash(id),composition_sha256:candidate.composition_sha256});delete record.author_id;command(id,kind);}
 common(value,'recovery_summary',1500);common(input,'input_context',215,'operator-tests');common(expected,'expected_transform',295,'operator-tests');
 const anchor=(side,id,time)=>({binding_id:side+'_binding',workspace_id:identity.workspace_id,environment_id:identity[side+'_environment_id'],object_name:identity[side+'_object_name'],authority_epoch:identity[side+'_epoch'],ledger_sha256:value[side==='source'?'source_ledger_sha256':'current_ledger_sha256'],generation:5,observed_at:time,record_sha256:hash(id)});
 const ops=['capture','restore','probe','resolve-delivery','retire','resume'];
 value.controls=ops.map((operation,n)=>{
  const c=fill(schema.$defs.control),start=(n+1)*100,end=start+90,side=['capture','retire'].includes(operation)?'source':'target';
  Object.assign(c,{operation,command_id:'control_'+operation,record_sha256:hash('control_'+operation),protocol_receipt_sha256:hash('protocol_'+operation),receipt_id:'receipt_'+operation.replace('-','_'),started_at:start,ended_at:end,probe_checked_at:operation==='probe'?start+50:null,workspace_id:identity.workspace_id,capture_id:identity.capture_id,job_id:identity[side+'_job_id'],environment_id:identity[side+'_environment_id'],object_name:identity[side+'_object_name'],authority_epoch:identity[side+'_epoch'],manifest_sha256:value.original_manifest_sha256,anchor_generation:5,ledger_sha256:value[side==='source'?'source_ledger_sha256':'current_ledger_sha256'],current_read:anchor(side,'anchor_'+operation,start+5),admitted_at:start+10,before_generation:3,after_generation:['retire','resume'].includes(operation)?4:3,original_outcome_sha256:hash('outcome_'+operation),original_transport_correlation_sha256:hash('transport_'+operation)});
  command(c.command_id,'deployed-recovery',start,end);
  if(['retire','resume'].includes(operation)) {
   Object.assign(c,{replay_command_id:'replay_'+operation,replay_observed_at:end+8,replay_current_read:anchor(side,'replay_anchor_'+operation,end+4),replay_record_sha256:hash('replay_'+operation),replay_outcome_sha256:c.original_outcome_sha256,replay_before_state_sha256:hash('replay_state_'+operation),replay_after_state_sha256:hash('replay_state_'+operation),replay_transport_correlation_sha256:hash('replay_transport_'+operation)});
   command(c.replay_command_id,'deployed-recovery',end,end+9);
  }
  return c;
 });
 value.source_anchor=structuredClone(value.controls[0].current_read);value.target_anchor=structuredClone(value.controls[1].current_read);
 const provider=side=>({environment_id:identity[side+'_environment_id'],object_name:identity[side+'_object_name'],deployment_id:side+'_deployment',namespace_id:side+'_namespace',binding_id:side+'_binding',record_sha256:hash(side+'_provider')});
 const subject={identity:structuredClone(identity),original_manifest_sha256:value.original_manifest_sha256,source_ledger_sha256:value.source_ledger_sha256,current_ledger_sha256:value.current_ledger_sha256,restore_job_created_at:value.restore_job_created_at,source_provider:provider('source'),target_provider:provider('target')};
 for(const c of commands.values())c.prepared_subjects.recovery=structuredClone(subject);
 value.restore_input={path:'validation/releases/synthetic/input.json',sha256:hash('input_file'),byte_size:1000};
 value.expected_transform={path:'validation/releases/synthetic/expected.json',sha256:hash('expected_file'),byte_size:1000};
 for(const r of [input,expected])Object.assign(r,{workspace_id:identity.workspace_id,capture_id:identity.capture_id,target_job_id:identity.target_job_id,original_manifest_sha256:value.original_manifest_sha256,current_ledger_sha256:value.current_ledger_sha256,restore_job_created_at:value.restore_job_created_at});
 Object.assign(input,{target_environment_id:identity.target_environment_id,target_object_name:identity.target_object_name,target_epoch:identity.target_epoch,original_job_record_sha256:hash('job_original'),prepared_input_record_sha256:hash('prepared_input')});
 Object.assign(expected,{source_checkpoint_sha256:value.source_checkpoint_sha256,target_checkpoint_sha256:value.target_checkpoint_sha256,restore_input_sha256:value.restore_input.sha256,schema_version:16});
 const rowsFor=name=>name==='schema_migrations'?16:['workspace_metadata','maintenance_state','artifacts','artifact_generations'].includes(name)?1:0;
 value.tables=RECOVERY_TABLES.map(name=>({name,source:{rows:rowsFor(name),sha256:hash('source_'+name)},target:{rows:rowsFor(name),sha256:hash((PRESERVED_TABLES.includes(name)?'source_':'target_')+name)}}));
 expected.tables=value.tables.map(row=>({name:row.name,source:structuredClone(row.source),expected:structuredClone(row.target),disposition:PRESERVED_TABLES.includes(row.name)?'preserve':'current-transform'}));
 value.manifest={format_version:2,contract_revision:'0.2',schema_version:16,canonical_byte_size:1000,database_sha256:hash('database'),database_byte_size:5,rows:20,event_sequence:1,barrier_id:'barrier_a',chunks:['schema_migrations','workspace_metadata','maintenance_state','artifacts','artifact_generations'].map((table,index)=>({index,table,row_count:rowsFor(table),byte_size:1,sha256:hash('chunk_'+table)})),artifacts:[{artifact_id:'artifact_a',generation_id:'generation_'+'a'.repeat(48),artifact_version:1,source_object_key_sha256:hash('source_key'),recovery_object_key_sha256:hash('recovery_key'),declared:{sha256:hash('artifact_bytes'),byte_size:1},source_verified:{sha256:hash('artifact_bytes'),byte_size:1},target_verified:{sha256:hash('artifact_bytes'),byte_size:1}}],unfinished_artifact_ids:[]};
 value.capture_finalization={original_record_sha256:hash('finalization'),job_id:identity.source_job_id,draft_sha256:hash('draft'),authority_epoch:1,maintenance_generation:3,anchor_generation:5,index:1,total:1,artifact_ids:['artifact_a']};
 value.local_verification={command_id:'local_verify',record_sha256:hash('localverify'),observed_at:195,manifest_sha256:value.original_manifest_sha256,outcome:'verified_local',transport_requests:0};command('local_verify','operator-tests',190,200);
 value.controls[4].source_retirement_sha256=value.controls[4].protocol_receipt_sha256;value.controls[5].source_retirement_sha256=value.controls[4].protocol_receipt_sha256;value.controls[5].probe_receipt_sha256=value.controls[2].protocol_receipt_sha256;
 value.cutover={original_record_sha256:hash('cutover'),capture_id:identity.capture_id,workspace_id:identity.workspace_id,source_environment_id:identity.source_environment_id,target_environment_id:identity.target_environment_id,source_epoch:1,target_epoch:2,source_retirement_receipt_id:value.controls[4].receipt_id,target_object_name:identity.target_object_name,cutover_at:599};
 value.holds={observer_record_sha256:hash('holds'),observed_at:595,unresolved_effect_count:0,unresolved_effect_ids:[],unresolved_effect_ids_complete:true,unresolved_artifact_copy_count:0,unresolved_artifact_copy_ids:[],unresolved_artifact_copy_ids_complete:true};
 value.authority={observer_record_sha256:hash('authority'),observed_at:900,old_credential_attempts:1,old_credential_denials:1,old_proof_attempts:1,old_proof_denials:1,archived_identities_resurrected:0,fresh_credential_issued_at:800,fresh_runtime_created_at:850,fresh_native_command_record_sha256:hash('fresh_native')};
 value.restart={command_id:'restart_observer',observed_at:1000,original_record_sha256:hash('restart'),source_state:'retired',target_admission:'installed',target_epoch:2};command('restart_observer');
 commands.get('local_verify').prepared_subjects.recovery=structuredClone(subject);commands.get('restart_observer').prepared_subjects.recovery=structuredClone(subject);
 receipts.set(value.restore_input.path,input);receipts.set(value.expected_transform.path,expected);
 return {value,input,expected,ctx};
}
export function graphFixture() {
 const {ctx}=recoveryFixture(),value=fill(schema.$defs.result_graph),workspace=ctx.environment.workspace_id;
 Object.assign(value,{revision:ctx.candidate.revision,tree_sha256:ctx.candidate.tree_sha256,composition_sha256:ctx.candidate.composition_sha256,environment_id:ctx.environment.id,command_id:'graph',observed_at:100,observer_id:'controller',record_sha256:hash('graph'),workspace_id:workspace});
 value.task={id:'task_a',workspace_id:workspace,state:'done',latest_run_id:'run_a',current_result_id:'result_a'};
 value.run={id:'run_a',workspace_id:workspace,task_id:'task_a',status:'submitted',agent_id:'agent_a'};
 value.result={id:'result_a',workspace_id:workspace,task_id:'task_a',run_id:'run_a',submitted_principal_id:'agent_a',submitted_agent_id:'agent_a'};
 value.acceptance={id:'acceptance_a',workspace_id:workspace,task_id:'task_a',result_id:'result_a',run_id:'run_a',reviewer_principal_id:'agent_b',reviewer_agent_id:'agent_b',count:1};
 for(const name of ['submit','accept']){
  const event=name==='submit'?'task.result_submitted':'task.result_accepted',principal=name==='submit'?'agent_a':'agent_b';
  value[name]={event_id:'event_'+name,event_workspace_id:workspace,event_type:event,resource_id:'task_a',actor_principal_id:principal,outcome_event_id:'event_'+name,outcome_workspace_id:workspace,outcome_principal_id:principal,outcome_status:200,outcome_data_sha256:hash('data_'+name),outcome_request_fingerprint:hash('fingerprint_'+name),outcome_key_sha256:hash('key_'+name),history_event_id:'event_'+name,history_workspace_id:workspace,history_kind:event,history_task_id:'task_a',history_run_id:'run_a',history_count:1};
  value.replay[name+'_original_outcome_sha256']=value.replay[name+'_replay_outcome_sha256']=value[name].outcome_data_sha256;
  value.replay[name+'_original_record_sha256']=hash(name+'_original');value.replay[name+'_replay_record_sha256']=hash(name+'_replay');
 }
 ctx.commands.set('graph',{id:'graph',kind:'native-live',revision:ctx.candidate.revision,tree_sha256:ctx.candidate.tree_sha256,composition_sha256:ctx.candidate.composition_sha256,environment_id:ctx.environment.id,exit_code:0,started_at:0,ended_at:200,prepared_subjects:{graph:{workspace_id:workspace,task_id:'task_a',run_id:'run_a',execution_records:Object.fromEntries(['submit_original_record_sha256','submit_replay_record_sha256','accept_original_record_sha256','accept_replay_record_sha256'].map(key=>[key,value.replay[key]]))}}});
 return {value,ctx};
}
