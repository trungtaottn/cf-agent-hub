/** Fixed source-backed R2 evidence predicates. This module never reads files,
 * executes commands, authenticates original records, or promotes source to live. */
import operations from './r2-policy-data/operations.json' with {type:'json'};
import policy from './r2-policy-data/cases.json' with {type:'json'};
import schema from '../../validation/r2-case-evidence.schema.json' with {type:'json'};
function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
export const CASE_POLICY=freeze(policy.cases);
export const CASE_OPERATIONS=freeze(operations);
export const caseSchemas=freeze(schema);
export const CASE_LIMITS=Object.freeze({record:65536,family:4194304,commandCases:128});
const byId=new Map(CASE_POLICY.map(row=>[row.id,row]));
const families=['isolation','gates','native','browser'];
const EMPTY_SHA256='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const BYTE_DIGEST_PAIRS=Object.freeze([['source_sha256','source_bytes'],['target_sha256','target_bytes'],['download_sha256','download_bytes'],['artifact_expected_sha256','artifact_expected_bytes'],['artifact_actual_sha256','artifact_actual_bytes']]);
export const references=()=>[];
export function canonicalCaseSubject(value){
 if(Array.isArray(value))return '['+value.map(canonicalCaseSubject).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalCaseSubject(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
const same=(a,b)=>a!==undefined&&b!==undefined&&canonicalCaseSubject(a)===canonicalCaseSubject(b);
const bytes=value=>new TextEncoder().encode(canonicalCaseSubject(value)).byteLength;
const at=(value,path)=>path.split('.').reduce((v,key)=>v&&typeof v==='object'&&Object.hasOwn(v,key)?v[key]:undefined,value);
const equalSet=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&new Set(a).size===a.length&&a.length===b.length&&a.every(x=>b.includes(x));
const add=(findings,code,id)=>findings.push({code:'R2_CASE_'+code,message:id});
function actorKind(row){
 if(row.lane)return row.lane;
 if(row.family==='browser')return 'human';
 if(row.family==='native'||row.family==='gates')return 'native';
 if(row.id.includes('/native/')||row.id.includes('/native-'))return 'native';
 if(row.id.includes('/human/')||row.id.includes('/human-'))return 'human';
 return row.id==='scheduler/system/failed-arm-restart-retry'?'system':'public';
}
function subjectChecks(row,s,ctx,findings){
 const fail=reason=>add(findings,'SUBJECT',row.id+': '+reason);
 if(!s||s.workspace_id!==ctx.workspaceId||s.authority_epoch!==ctx.configEpoch){fail('workspace/epoch mismatch');return;}
 if(s.actor_kind!==actorKind(row))fail('actor kind mismatch');
 const operation=CASE_OPERATIONS[row.operation];
 if(operation&&!operation.idempotency&&s.key_sha256!==null)fail('inapplicable idempotency key');
 if(operation&&!operation.runtimeProof&&s.proof_sha256!==null)fail('inapplicable runtime proof');
 if(s.actor_kind==='native'){
  if(typeof s.principal_id!=='string'||s.principal_id!==s.agent_id||typeof s.credential_id!=='string')fail('native principal/agent/credential');
  if(row.runtime_proof&&row.phase!=='forbidden'&&(typeof s.runtime_id!=='string'||typeof s.proof_sha256!=='string'))fail('missing runtime proof binding');
 }else{
  for(const key of ['agent_id','credential_id','runtime_id','proof_sha256'])if(s[key]!==null)fail('inapplicable '+key);
  if(s.actor_kind==='human'&&typeof s.principal_id!=='string'||['public','system'].includes(s.actor_kind)&&s.principal_id!==null)fail('principal applicability');
 }
 const taskOps=['getTask','patchTask','readyTask','cancelTask','requeueTask','claimTask','submitTaskResult','acceptTaskResult','failTask','listTaskResults'];
 if(taskOps.includes(row.operation)&&typeof s.task_id!=='string')fail('missing task');
 if(['getRun','heartbeatRun','submitTaskResult','acceptTaskResult','failTask'].includes(row.operation)&&typeof s.run_id!=='string')fail('missing run');
 if(row.id==='browser/independent-accept'||row.id==='task/server-retained-replay')if(typeof s.run_id!=='string')fail('missing retained run');
 if(row.id==='tasks/native/foreign-task-own-run'){
  if(!s.foreign_runs){fail('missing foreign subfixtures');return;}
  for(const name of ['submit','fail']){const f=s.foreign_runs[name];if(!f||f.foreign_workspace_id===s.workspace_id||f.own_task_id===f.foreign_task_id)fail('foreign subfixture mismatch');}
  if(s.foreign_runs.submit?.run_id===s.foreign_runs.fail?.run_id)fail('terminalizing fixtures reuse run');
 }else if(s.foreign_runs!==null)fail('unexpected foreign subfixtures');
}
export function validatePreparations(value,ctx={}){
 const findings=[];
 if(!value||!Array.isArray(value.subjects)||!equalSet(value.subjects.map(x=>x?.case_id),CASE_POLICY.map(x=>x.id))){add(findings,'PREPARATION_COVERAGE','Exact fresh prepared case roster required');return findings;}
 if(bytes(value)>CASE_LIMITS.family)add(findings,'BUDGET','Preparations exceed4MiB');
 if(!(ctx.subjectDigests instanceof Map))add(findings,'PREPARATION_HASH','Independent canonical subject digests required');
 for(const entry of value.subjects){
  const row=byId.get(entry.case_id);if(!row)continue;
  if(!ctx.subjectDigests?.has(entry.case_id)||ctx.subjectDigests.get(entry.case_id)!==entry.subject_sha256)add(findings,'PREPARATION_HASH',entry.case_id);
  subjectChecks(row,entry.subject,ctx,findings);
 }
 return findings;
}
function rulePass(rule,o,s,ctx){
 const [op,a,b]=rule,x=o[a],y=o[b];
 switch(op){
 case 'eq':return same(x,b);
 case 'same':return same(x,y);
 case 'different':return x!==undefined&&y!==undefined&&!same(x,y);
 case 'subject':return same(x,at(s,b));
 case 'context':return same(x,ctx[b]);
 case 'includes':return Array.isArray(x)&&b.every(v=>x.includes(v));
 case 'excludes':return Array.isArray(x)&&b.every(v=>!x.includes(v));
 case 'lt':return typeof x==='number'&&typeof y==='number'&&x<y;
 case 'ge_field':return typeof x==='number'&&typeof y==='number'&&x>=y;
 case 'le_field':return typeof x==='number'&&typeof y==='number'&&x<=y;
 case 'gte':return typeof x==='number'&&x>=b;
 default:return false;
 }
}
export function validateCaseFamily(value,ctx={}){
 const findings=[],family=value?.type?.slice(3);
 if(!families.includes(family)||!Array.isArray(value.records)){add(findings,'FAMILY','Unknown or missing case family');return findings;}
 const roster=CASE_POLICY.filter(c=>c.family===family);
 if(!equalSet(value.records.map(r=>r?.id),roster.map(r=>r.id))){add(findings,'COVERAGE','Exact '+family+' roster required');return findings;}
 if(bytes(value)>CASE_LIMITS.family)add(findings,'BUDGET',family+' exceeds4MiB');
 if(!(ctx.commands instanceof Map)||!ctx.preparations?.subjects){add(findings,'CONTEXT','Commands and independently validated preparations required');return findings;}
 const prep=new Map(ctx.preparations.subjects.map(e=>[e.case_id,e]));
 const assembly=ctx.commands.get(value.command_id);
 if(!assembly||assembly.kind!=='contract'||assembly.provenance!=='source'||assembly.exit_code!==0){add(findings,'ASSEMBLY','Evidence assembly must be source contract command');return findings;}
 const records=new Map(value.records.map(r=>[r.id,r]));
 for(const record of value.records){
  const row=byId.get(record.id);if(!row)continue;
  const command=ctx.commands.get(record.command_id),entry=prep.get(record.id),s=entry?.subject;
  if(bytes(record)>CASE_LIMITS.record)add(findings,'BUDGET',record.id+' exceeds64KiB');
  if(!command||!entry){add(findings,'CONTEXT',record.id);continue;}
  const expectedKind=row.producer==='native-live'?'native-live':row.producer==='browser-tests'?'browser-tests':'workers-tests';
  const expectedProvenance=expectedKind==='workers-tests'?'source':'real-run';
  if(command.kind!==expectedKind||command.provenance!==expectedProvenance||command.exit_code!==0)add(findings,'PRODUCER',record.id);
  for(const key of ['revision','tree_sha256','environment_id','composition_sha256'])if(command[key]!==value[key])add(findings,'CANDIDATE',record.id+': '+key);
  if(!Number.isSafeInteger(record.observed_at)||record.observed_at<command.started_at||record.observed_at>command.ended_at||record.observed_at>assembly.started_at||command.ended_at>assembly.started_at||ctx.preparations.observed_at>command.started_at)add(findings,'TIME',record.id);
  const commitments=command.subjects?.cases;
  if(!Array.isArray(commitments)||commitments.length>CASE_LIMITS.commandCases||!equalSet(command.case_ids,commitments.map(x=>x.case_id))){add(findings,'COMMAND_CASES',record.id);continue;}
  const commitment=commitments.find(x=>x.case_id===record.id);
  if(!commitment||entry.subject_sha256!==record.subject_sha256||commitment.subject_sha256!==record.subject_sha256||ctx.subjectDigests?.get(record.id)!==record.subject_sha256)add(findings,'SUBJECT_HASH',record.id);
  subjectChecks(row,s,ctx,findings);
  if(!record.observations||typeof record.observations!=='object'){add(findings,'OBSERVATIONS',record.id);continue;}
  for(const [digest,size] of BYTE_DIGEST_PAIRS)if(Object.hasOwn(row.fields,size)&&record.observations[size]===0&&record.observations[digest]!==EMPTY_SHA256)add(findings,'EMPTY_DIGEST',record.id+': '+digest);
  for(const rule of row.rules)if(!rulePass(rule,record.observations,s,ctx))add(findings,'PREDICATE',record.id+': '+rule[0]+' '+rule[1]);
 }
 // Commands cannot claim duplicate cases, unconsumed family fragments or aliases.
 for(const [id,command] of ctx.commands){
  for(const caseId of command.case_ids??[]){if(byId.get(caseId)?.family===family&&records.get(caseId)?.command_id!==id)add(findings,'COMMAND_COVERAGE',caseId);}
 }
 return findings;
}
