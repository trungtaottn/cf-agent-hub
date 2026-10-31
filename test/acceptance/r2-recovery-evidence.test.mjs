import {test} from 'vitest';
import assert from 'node:assert/strict';
import {schema,validateRecovery,validateResultGraph,references} from '../../scripts/lib/r2-recovery-evidence.mjs';

test('recovery rejects absent structural evidence without throwing',()=>{
 for(const value of [null,{}, {type:'r2-recovery',version:1}]) assert.notEqual(validateRecovery(value,{}).length,0);
});
test('result graph rejects absent structural evidence without throwing',()=>{
 for(const value of [null,{}, {type:'r2-result-graph',version:1}]) assert.notEqual(validateResultGraph(value,{}).length,0);
});
test('recovery references are explicit typed whitelist only',()=>{
 const a={path:'input.json',sha256:'a'.repeat(64),byte_size:10},b={...a,path:'expected.json'};
 assert.deepEqual(references({type:'r2-recovery',restore_input:a,expected_transform:b,ignored:{ref:a}}),[
  {ref:a,type:'r2-restore-input-context',maxBytes:8192},{ref:b,type:'r2-expected-transform',maxBytes:65536}]);
 assert.deepEqual(references({type:'unknown',restore_input:a}),[]);
});
test('standalone schema exposes closed root and independently prepared subject types',()=>{
 for(const name of ['recovery','result_graph','restore_input','expected_transform','prepared_recovery_subject']) assert.equal(schema.$defs[name].additionalProperties,false);
});
import {recoveryFixture,graphFixture,hash} from './r2-recovery-fixtures.mjs';
test('synthetic recovery projection satisfies structure without claiming authenticated live evidence',()=>{
 const f=recoveryFixture();assert.deepEqual(validateRecovery(f.value,f.ctx),[]);
});
test('synthetic result graph checks exact domain graph and outcome commitments',()=>{
 const f=graphFixture();assert.deepEqual(validateResultGraph(f.value,f.ctx),[]);
});
const recoveryMutations={
 'candidate revision':f=>{f.value.revision='b'.repeat(40);},
 'unknown closed field':f=>{f.value.claimed_live=true;},
 'missing expected projection':f=>{f.ctx.receipts.delete(f.value.expected_transform.path);},
 'typed projection substitution':f=>{f.expected.type='r2-restore-input-context';},
 'independent job time':f=>{f.value.restore_job_created_at++;f.input.restore_job_created_at++;f.expected.restore_job_created_at++;},
 'independent transform command':f=>{f.expected.command_id=f.input.command_id;},
 'unrelated input digest':f=>{f.expected.restore_input_sha256=hash('other');},
 'source current ledger conflation':f=>{f.value.source_ledger_sha256=f.value.current_ledger_sha256;},
 'unrelated original manifest':f=>{f.input.original_manifest_sha256=hash('other');},
 'missing source provider binding':f=>{f.ctx.commands.get(f.value.command_id).prepared_subjects.recovery.source_provider.binding_id='other_binding';},
 'reordered table registry':f=>{f.value.tables.reverse();},
 'missing preserved table equality':f=>{const r=f.value.tables.find(x=>x.name==='messages'),e=f.expected.tables.find(x=>x.name==='messages');r.target.sha256=e.expected.sha256=hash('changed');},
 'arbitrary caller chosen disposition':f=>{f.expected.tables.find(x=>x.name==='tasks').disposition='preserve';},
 'wrong target bytes':f=>{f.value.tables.find(x=>x.name==='tasks').target.sha256=hash('changed');},
 'wrong target checkpoint':f=>{f.expected.target_checkpoint_sha256=hash('changed');},
 'source rows overflow':f=>{f.value.tables[0].source.rows=1000001;},
 'unsafe target row total':f=>{f.value.tables[0].target.rows=Number.MAX_SAFE_INTEGER;f.value.tables[1].target.rows=Number.MAX_SAFE_INTEGER;},
 'noncontiguous chunks':f=>{f.value.manifest.chunks[0].index=1;},
 'chunk bytes exceed 1MiB':f=>{f.value.manifest.chunks[0].byte_size=1048577;},
 'chunk row count exceeds200':f=>{f.value.manifest.chunks[0].row_count=201;},
 'database bytes disagree':f=>{f.value.manifest.database_byte_size++;},
 'source row count disagreement':f=>{f.value.manifest.rows++;},
 'artifact source digest corruption':f=>{f.value.manifest.artifacts[0].source_verified.sha256=hash('bad');},
 'artifact target digest corruption':f=>{f.value.manifest.artifacts[0].target_verified.sha256=hash('bad');},
 'artifact target size corruption':f=>{f.value.manifest.artifacts[0].target_verified.byte_size++;},
 'artifact bytes exceed10MiB':f=>{f.value.manifest.artifacts[0].declared.byte_size=10485761;},
 'all artifacts empty':f=>{for(const k of ['declared','source_verified','target_verified'])f.value.manifest.artifacts[0][k].byte_size=0;},
 'unfinished intersects committed':f=>{f.value.manifest.unfinished_artifact_ids=['artifact_a'];},
 'invented artifact generations':f=>{f.value.manifest.artifacts[0].generation_id='generation_abc';},
 'capture finalization incomplete':f=>{f.value.capture_finalization.index=0;},
 'capture finalization wrong original job':f=>{f.value.capture_finalization.job_id='other_job';},
 'local verify masquerades as deployed remote':f=>{f.ctx.commands.get('local_verify').kind='deployed-recovery';},
 'local verify sends transport':f=>{f.value.local_verification.transport_requests=1;},
 'stage order':f=>{f.value.controls.reverse();},
 'same original current read reused':f=>{f.value.controls[4].current_read.record_sha256=f.value.controls[0].current_read.record_sha256;},
 'source retire selects target anchor':f=>{f.value.controls[4].current_read=structuredClone(f.value.target_anchor);},
 'capture anchor historical time':f=>{f.value.controls[0].current_read.observed_at=1;},
 'capture anchor wrong epoch':f=>{f.value.controls[0].current_read.authority_epoch=2;},
 'missing retire replay':f=>{f.value.controls[4].replay_record_sha256=null;},
 'missing resume replay':f=>{f.value.controls[5].replay_record_sha256=null;},
 'replay original execution alias':f=>{f.value.controls[5].replay_record_sha256=f.value.controls[5].record_sha256;},
 'replay domain data changed':f=>{f.value.controls[5].replay_outcome_sha256=hash('changed');},
 'replay changes state':f=>{f.value.controls[5].replay_after_state_sha256=hash('changed');},
 'replay stale anchor original record':f=>{f.value.controls[5].replay_current_read.record_sha256=f.value.controls[5].current_read.record_sha256;},
 'replay unbound time':f=>{f.value.controls[5].replay_observed_at=100000;},
 'unsupported successful capture replay':f=>{f.value.controls[0].replay_record_sha256=hash('invented');},
 'holds incomplete list':f=>{f.value.holds.unresolved_effect_ids_complete=false;},
 'artifact copy hold unresolved':f=>{f.value.holds.unresolved_artifact_copy_count=1;},
 'outbox hold unresolved':f=>{f.value.holds.unresolved_effect_count=1;},
 'cutover wrong workspace':f=>{f.value.cutover.workspace_id='other_workspace';},
 'cutover wrong source retirement ID':f=>{f.value.cutover.source_retirement_receipt_id='other_retirement';},
 'resume wrong probe':f=>{f.value.controls[5].probe_receipt_sha256=hash('other');},
 'resume generation unchanged':f=>{f.value.controls[5].after_generation=f.value.controls[5].before_generation;},
 'old credential no attempted denial':f=>{f.value.authority.old_credential_attempts=0;f.value.authority.old_credential_denials=0;},
 'old proof admitted':f=>{f.value.authority.old_proof_denials=0;},
 'archived identity resurrected':f=>{f.value.authority.archived_identities_resurrected=1;},
 'fresh authority before resume':f=>{f.value.authority.fresh_credential_issued_at=1;},
 'restart wrong epoch':f=>{f.value.restart.target_epoch=1;},
 'record observed before complete':f=>{f.value.observed_at=100;},
 'original control command wrong candidate':f=>{f.ctx.commands.get(f.value.controls[0].command_id).revision='b'.repeat(40);},
 'replay command wrong candidate':f=>{f.ctx.commands.get(f.value.controls[5].replay_command_id).tree_sha256=hash('other');},
 'local verify command wrong candidate':f=>{f.ctx.commands.get('local_verify').revision='b'.repeat(40);},
 'restart command wrong candidate':f=>{f.ctx.commands.get('restart_observer').environment_id='unrelated';}
};
for(const [label,mutate] of Object.entries(recoveryMutations))test('recovery rejects '+label,()=>{const f=recoveryFixture();mutate(f);assert.notEqual(validateRecovery(f.value,f.ctx).length,0);});
const graphMutations={
 'prepared wrong run':f=>{f.ctx.commands.get('graph').prepared_subjects.graph.run_id='other_run';},
 'cross workspace result':f=>{f.value.result.workspace_id='other_workspace';},
 'cross workspace outcome':f=>{f.value.submit.outcome_workspace_id='other_workspace';},
 'cross workspace history':f=>{f.value.accept.history_workspace_id='other_workspace';},
 'accept original run mismatch':f=>{f.value.acceptance.run_id='other_run';},
 'accept wrong result':f=>{f.value.acceptance.result_id='other_result';},
 'latest run mismatch':f=>{f.value.task.latest_run_id='other_run';},
 'self acceptance':f=>{f.value.acceptance.reviewer_principal_id='agent_a';f.value.acceptance.reviewer_agent_id='agent_a';},
 'reviewer native principal agent divergence':f=>{f.value.acceptance.reviewer_agent_id='agent_c';},
 'submitter native principal agent divergence':f=>{f.value.result.submitted_agent_id='agent_c';},
 'duplicate acceptance':f=>{f.value.acceptance.count=2;},
 'duplicate history':f=>{f.value.submit.history_count=2;},
 'wrong event type':f=>{f.value.submit.event_type='task.result_accepted';},
 'orphan outcome event':f=>{f.value.accept.outcome_event_id='other_event';},
 'orphan history event':f=>{f.value.accept.history_event_id='other_event';},
 'wrong outcome principal':f=>{f.value.accept.outcome_principal_id='agent_c';},
 'replay data mutation':f=>{f.value.replay.accept_replay_outcome_sha256=hash('other');},
 'outcome status changed':f=>{f.value.accept.outcome_status=202;},
 'outcome original data mutation':f=>{f.value.accept.outcome_data_sha256=hash('other');},
 'replay graph state mutation':f=>{f.value.replay.after_sha256=hash('other');},
 'original execution duplicated':f=>{f.value.replay.submit_replay_record_sha256=f.value.replay.submit_original_record_sha256;}
};
for(const [label,mutate] of Object.entries(graphMutations))test('result graph rejects '+label,()=>{const f=graphFixture();mutate(f);assert.notEqual(validateResultGraph(f.value,f.ctx).length,0);});
test('result graph permits separate per-attempt transport correlation commitments',()=>{const f=graphFixture();f.value.replay.submit_transport_correlation_sha256=hash('new_transport');assert.deepEqual(validateResultGraph(f.value,f.ctx),[]);});
import Ajv from 'ajv';
import {readFileSync} from 'node:fs';
import {RECOVERY_LIMITS,RECOVERY_TABLES} from '../../scripts/lib/r2-recovery-evidence.mjs';
const ajv=new Ajv({strict:true});ajv.addSchema(schema);
const validateShape=ajv.compile({$ref:schema.$id+'#/$defs/recovery'});
test('frozen table enum is independently exact against source registry',()=>{
 const source=readFileSync(new URL('../../src/recovery/table-registry.ts',import.meta.url),'utf8');
 const registry=JSON.parse(source.split('export const SCHEMA16_TABLE_REGISTRY = ')[1].split(' as const')[0].trim().replace(/;$/,''));
 assert.deepEqual(RECOVERY_TABLES,registry.map(x=>x.name));
});
test('committed empty peer remains valid while workload retains nonempty artifact',()=>{
 const f=recoveryFixture(),peer=structuredClone(f.value.manifest.artifacts[0]);
 peer.artifact_id='artifact_empty';peer.generation_id='generation_'+'b'.repeat(48);
 for(const key of ['declared','source_verified','target_verified'])peer[key]={sha256:hash(''),byte_size:0};
 f.value.manifest.artifacts.push(peer);
 for(const name of ['artifacts','artifact_generations']){
  const table=f.value.tables.find(x=>x.name===name),expected=f.expected.tables.find(x=>x.name===name);
  table.source.rows=table.target.rows=expected.source.rows=expected.expected.rows=2;
  f.value.manifest.chunks.find(x=>x.table===name).row_count=2;
 }
 f.value.manifest.rows=22;
 Object.assign(f.value.capture_finalization,{index:2,total:2,artifact_ids:['artifact_a','artifact_empty']});
 assert.deepEqual(validateRecovery(f.value,f.ctx),[]);
});
test('10MiB artifact exact bound accepted, oneover rejected',()=>{
 const f=recoveryFixture();for(const key of ['declared','source_verified','target_verified'])f.value.manifest.artifacts[0][key].byte_size=10485760;
 assert.deepEqual(validateRecovery(f.value,f.ctx),[]);
 for(const key of ['declared','source_verified','target_verified'])f.value.manifest.artifacts[0][key].byte_size++;
 assert.notEqual(validateRecovery(f.value,f.ctx).length,0);
});
test('combined original artifact and SQL bytes exact256MiB accepted, oneover rejected',()=>{
 const f=recoveryFixture(),table=f.value.tables.find(x=>x.name==='tasks'),projection=f.expected.tables.find(x=>x.name==='tasks');
 table.source.rows=table.target.rows=projection.source.rows=projection.expected.rows=251;
 f.value.manifest.chunks=Array.from({length:256},(_,index)=>({index,table:index===0?'schema_migrations':index===1?'workspace_metadata':index===2?'maintenance_state':index===254?'artifacts':index===255?'artifact_generations':'tasks',row_count:index===0?16:1,byte_size:1048576-(index===255?1:0),sha256:hash('chunk_'+index)}));
 f.value.manifest.rows=271;f.value.manifest.database_byte_size=268435455;
 assert.deepEqual(validateRecovery(f.value,f.ctx),[]);
 for(const key of ['declared','source_verified','target_verified'])f.value.manifest.artifacts[0][key].byte_size=2;
 assert.ok(validateRecovery(f.value,f.ctx).some(x=>x.code==='R2_RECOVERY_TOTAL_BYTES'));
});
for(const [field,max] of [['artifacts',1000],['unfinished_artifact_ids',1000],['chunks',256]])test('schema '+field+' exact bound and oneover (shape only)',()=>{
 const f=recoveryFixture();const item=field==='unfinished_artifact_ids'?'unfinished':f.value.manifest[field][0];
 f.value.manifest[field]=Array.from({length:max},()=>structuredClone(item));assert.equal(validateShape(f.value),true);
 f.value.manifest[field].push(structuredClone(item));assert.equal(validateShape(f.value),false);
});
test('chunk row200 and byte1MiB exact shape bounds versus oneover',()=>{
 const f=recoveryFixture(),chunk=f.value.manifest.chunks[0];chunk.row_count=200;chunk.byte_size=1048576;
 assert.equal(validateShape(f.value),true);chunk.row_count++;assert.equal(validateShape(f.value),false);chunk.row_count--;chunk.byte_size++;assert.equal(validateShape(f.value),false);
});
test('manifest canonical65536 exact shape bound versus oneover',()=>{
 const f=recoveryFixture();f.value.manifest.canonical_byte_size=65536;assert.equal(validateShape(f.value),true);f.value.manifest.canonical_byte_size++;assert.equal(validateShape(f.value),false);
});
test('closed schemas reject unrelated secrets without copying values to findings',()=>{
 const f=recoveryFixture();f.value.controls[0].token='synthetic-secret';const found=validateRecovery(f.value,f.ctx);
 assert.ok(found.length);assert.equal(JSON.stringify(found).includes('synthetic-secret'),false);
});
test('full primitive max control includes escaping and remains below6144 bytes',()=>{
 const f=recoveryFixture(),c=f.value.controls[5],defs=schema.$defs;
 const max=def=>{
  if(def.$ref)return max(defs[def.$ref.split('/').at(-1)]);
  if(def.anyOf)return max(def.anyOf[0]);if('const'in def)return def.const;
  if(def.enum)return [...def.enum].sort((a,b)=>b.length-a.length)[0];
  if(def.type==='object')return Object.fromEntries(Object.entries(def.properties).map(([key,value])=>[key,max(value)]));
  if(def.type==='integer')return def.maximum;
  if(def.pattern?.includes('{64}'))return 'f'.repeat(64);
  return def.pattern?.includes('[ -~]')?'"'.repeat(128):'a'.repeat(128);
 };
 const specimen=max(defs.control);specimen.operation='resume';specimen.probe_checked_at=null;
 assert.equal(Buffer.byteLength(JSON.stringify(specimen)),4672);
 assert.ok(Buffer.byteLength(JSON.stringify(specimen))<RECOVERY_LIMITS.control);
 // This is primitive allocation arithmetic, not a positive live fixture.
});
test('independently inspected source and target mappings may share namespace without aliasing their tuple',()=>{
 const f=recoveryFixture();for(const c of f.ctx.commands.values())if(c.prepared_subjects.recovery)c.prepared_subjects.recovery.target_provider.namespace_id=c.prepared_subjects.recovery.source_provider.namespace_id;
 assert.deepEqual(validateRecovery(f.value,f.ctx),[]);
});
for(const op of ['capture','restore','probe','resolve-delivery','retire','resume'])test('control '+op+' requires its own inspected recovery subject',()=>{
 const f=recoveryFixture();delete f.ctx.commands.get('control_'+op).prepared_subjects.recovery;assert.ok(validateRecovery(f.value,f.ctx).length);
});
for(const op of ['retire','resume'])test('replay '+op+' requires its own inspected recovery subject',()=>{
 const f=recoveryFixture();f.ctx.commands.get('replay_'+op).prepared_subjects.recovery.identity.capture_id='other_capture';assert.ok(validateRecovery(f.value,f.ctx).length);
});
test('protocol receipt commitments remain distinct from execution wrappers',()=>{
 const f=recoveryFixture();assert.notEqual(f.value.controls[2].protocol_receipt_sha256,f.value.controls[2].record_sha256);
 assert.deepEqual(validateRecovery(f.value,f.ctx),[]);
});
test('resume rejects execution wrapper digest substituted for probe protocol receipt',()=>{
 const f=recoveryFixture();f.value.controls[5].probe_receipt_sha256=f.value.controls[2].record_sha256;assert.ok(validateRecovery(f.value,f.ctx).length);
});
test('retire protocol receipt binds retirement references',()=>{
 const f=recoveryFixture();f.value.controls[4].protocol_receipt_sha256=hash('unrelated_protocol');assert.ok(validateRecovery(f.value,f.ctx).length);
});
test('graph execution records require controller-inspected manifest not self-declared unique hashes',()=>{
 const f=graphFixture();f.value.replay.submit_original_record_sha256=hash('unrelated_record');assert.ok(validateResultGraph(f.value,f.ctx).length);
});
test('graph fails closed without controller execution manifest',()=>{
 const f=graphFixture();delete f.ctx.commands.get('graph').prepared_subjects.graph.execution_records;assert.ok(validateResultGraph(f.value,f.ctx).length);
});
for(const id of ['recovery_summary','input_context','expected_transform','control_capture','replay_resume','local_verify','restart_observer'])test('command '+id+' rejects swapped composition',()=>{
 const f=recoveryFixture();f.ctx.commands.get(id).composition_sha256=hash('other_composition');assert.ok(validateRecovery(f.value,f.ctx).length);
});
for(const id of ['local_verify','restart_observer'])test('command '+id+' requires inspected recovery subject',()=>{
 const f=recoveryFixture();delete f.ctx.commands.get(id).prepared_subjects.recovery;assert.ok(validateRecovery(f.value,f.ctx).length);
});
test('result graph command rejects swapped composition',()=>{
 const f=graphFixture();f.ctx.commands.get('graph').composition_sha256=hash('other_composition');assert.ok(validateResultGraph(f.value,f.ctx).length);
});
test('target restore probe resolution and resume generation chain cannot be disconnected',()=>{
 for(const operation of ['restore','probe','resolve-delivery']){
  const f=recoveryFixture(),c=f.value.controls.find(x=>x.operation===operation);c.before_generation=100;c.after_generation=100;
  assert.ok(validateRecovery(f.value,f.ctx).length);
 }
});
test('source capture final generation joins retire initial generation without imposing capture increment',()=>{
 const f=recoveryFixture();f.value.controls[0].after_generation=100;assert.ok(validateRecovery(f.value,f.ctx).length);
});
for(const [name,count] of [['schema_migrations',16],['workspace_metadata',1],['maintenance_state',1]])test('manifest requires exact source '+name+' count from current protocol',()=>{
 const f=recoveryFixture(),table=f.value.tables.find(x=>x.name===name),expected=f.expected.tables.find(x=>x.name===name),chunk=f.value.manifest.chunks.find(x=>x.table===name);
 table.source.rows=expected.source.rows=count+1;chunk.row_count++;f.value.manifest.rows++;
 assert.ok(validateRecovery(f.value,f.ctx).length);
});
test('manifest chunk tables require registry order independent of indices and per-table totals',()=>{
 const f=recoveryFixture();[f.value.manifest.chunks[0],f.value.manifest.chunks[1]]=[f.value.manifest.chunks[1],f.value.manifest.chunks[0]];
 f.value.manifest.chunks.forEach((chunk,index)=>{chunk.index=index;});assert.ok(validateRecovery(f.value,f.ctx).length);
});
test('empty artifact digest must equal SHA256 of empty bytes, not merely three matching claims',()=>{
 const f=recoveryFixture(),peer=structuredClone(f.value.manifest.artifacts[0]);
 peer.artifact_id='artifact_empty';peer.generation_id='generation_'+'b'.repeat(48);
 for(const key of ['declared','source_verified','target_verified'])peer[key]={sha256:hash(''),byte_size:0};
 f.value.manifest.artifacts.push(peer);
 for(const name of ['artifacts','artifact_generations']){
  const table=f.value.tables.find(x=>x.name===name),expected=f.expected.tables.find(x=>x.name===name);
  table.source.rows=table.target.rows=expected.source.rows=expected.expected.rows=2;
  f.value.manifest.chunks.find(x=>x.table===name).row_count=2;
 }
 f.value.manifest.rows=22;Object.assign(f.value.capture_finalization,{index:2,total:2,artifact_ids:['artifact_a','artifact_empty']});
 assert.deepEqual(validateRecovery(f.value,f.ctx),[]);
 for(const key of ['declared','source_verified','target_verified'])peer[key].sha256=hash('not_empty');
 assert.ok(validateRecovery(f.value,f.ctx).length);
});
