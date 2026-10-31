import {describe,it,expect,beforeAll} from 'vitest';
import {CASE_POLICY,canonicalCaseSubject,validatePreparations,validateCaseFamily} from '../../scripts/lib/r2-case-policy.mjs';
describe('R2 closed typed case policy',()=>{
 it('freezes fresh exact family roster, not lost historical counts',()=>{expect(CASE_POLICY.filter((c:any)=>c.family==='isolation')).toHaveLength(322);expect(new Set(CASE_POLICY.map((c:any)=>c.id)).size).toBe(380);});
 it('canonical subject digest input ignores object key insertion order',()=>{expect(canonicalCaseSubject({z:1,a:{z:2,a:3}})).toBe('{"a":{"a":3,"z":2},"z":1}');});
 it('missing prepared subjects and independent hash context fail closed',()=>{expect(validatePreparations({subjects:[]},{}).length).toBeGreaterThan(0);});
 it('an empty isolated command fragment cannot stand in for all322 phases',()=>{expect(validateCaseFamily({type:'r2-isolation',records:[]},{}).length).toBeGreaterThan(0);});
});

import Ajv,{type ValidateFunction} from 'ajv';
import {createHash} from 'node:crypto';
import {caseSchemas,CASE_LIMITS,CASE_OPERATIONS} from '../../scripts/lib/r2-case-policy.mjs';
import {makeCaseEvidence,caseHash} from './r2-case-fixtures';
import {assertIsolationCoverage,isolationOperations,requiredIsolationEvidence} from '../helpers/r2-isolation-matrix';
import {clientOperations} from '../../src/http/generated/client-operations';
const ajv=new Ajv({strict:true,allErrors:false,inlineRefs:false});ajv.addSchema(caseSchemas);
const shapeNames=['r2-case-preparations','r2-isolation','r2-gates','r2-native','r2-browser'] as const;
const compiledShapes=new Map<string,ValidateFunction>();
// Compilation is fixture setup, not the first validation assertion. This does
// not warm validation paths or establish a production compilation benchmark.
beforeAll(()=>{
 const started=performance.now();
 for(const name of shapeNames){const validate=ajv.getSchema(caseSchemas.$id+'#/$defs/'+name);if(typeof validate!=='function')throw Error('Missing fixture schema: '+name);compiledShapes.set(name,validate);}
 console.info(JSON.stringify({scope:'R2 fixture schema compilation only',schemas:compiledShapes.size,elapsed_ms:performance.now()-started,setup_budget_ms:10000}));
},10000);
const shape=(name:string)=>{const validate=compiledShapes.get(name);if(!validate)throw Error('Unknown or uncompiled fixture schema: '+name);return validate;};
it('compiles exactly the five fixture validators in bounded setup',()=>{expect([...compiledShapes.keys()]).toEqual(shapeNames);for(const name of shapeNames)expect(typeof shape(name)).toBe('function');expect(()=>shape('unreviewed-schema')).toThrow('Unknown or uncompiled');});
const familyNames=['isolation','gates','native','browser'];
function validateAll(f:any){return [validatePreparations(f.preparations,f.context),...familyNames.map(k=>validateCaseFamily(f.receipts[k],f.context))].flat();}
function record(f:any,id:string){return Object.values(f.receipts).flatMap((r:any)=>r.records).find((r:any)=>r.id===id) as any;}
describe('typed policy source parity and fixed predicates',()=>{
 it('source matrix independently enumerates exactly322 identical phase IDs',()=>{expect(CASE_POLICY.filter(c=>c.family==='isolation').map(c=>c.id).sort()).toEqual(requiredIsolationEvidence());});
 it('native success roster matches33 actual native operation descriptors',()=>{expect(CASE_POLICY.filter(c=>c.family==='native'&&c.id.endsWith('/success')).map(c=>c.operation).sort()).toEqual(Object.entries(clientOperations).filter(([,v])=>v.native).map(([k])=>k).sort());});
 it('accepts complete synthetic structural fixture while not claiming real evidence',()=>{const f=makeCaseEvidence();expect(f.synthetic).toBe(true);expect(validateAll(f)).toEqual([]);expect(shape('r2-case-preparations')(f.preparations)).toBe(true);for(const family of familyNames){const validate=shape('r2-'+family);expect(validate(f.receipts[family]),JSON.stringify(validate.errors)).toBe(true);}});
 it('native artifact metadata preflights are2requests, not sourcefacade1',()=>{for(const op of ['uploadArtifactContent','downloadArtifactContent','commitArtifact']){const f=makeCaseEvidence();record(f,'native/'+op+'/success').observations.request_count=1;expect(validateCaseFamily(f.receipts.native,f.context).some(x=>x.code==='R2_CASE_PREDICATE')).toBe(true);}});
 it('does not invent native positive restart or pending journal state',()=>{const f=makeCaseEvidence();record(f,'native/restart-no-send').observations.request_count=1;expect(validateAll(f).length).toBeGreaterThan(0);const g=makeCaseEvidence();record(g,'native/lost-response-retained').observations.journal_state='pending';expect(shape('r2-native')(g.receipts.native)).toBe(false);});
 it('retained replay compares full data not variable transport request_id',()=>{const f=makeCaseEvidence(),r=record(f,'task/server-retained-replay');r.observations.replayed_data_sha256=caseHash('different outcome');expect(validateAll(f).length).toBeGreaterThan(0);});
 it('required mutation tables use inclusion but denial/read snapshots are exact',()=>{const f=makeCaseEvidence();record(f,'createTask/human/authorized').observations.changed_tables.push('scheduler_state');expect(validateAll(f)).toEqual([]);record(f,'createTask/human/foreign-workspace').observations.after_a_sha256=caseHash('partial mutation');expect(validateAll(f).length).toBeGreaterThan(0);});
 it('empty artifact is valid separately from nonempty fixture requirement',()=>{const f=makeCaseEvidence();expect(record(f,'artifact/empty-lifecycle').observations.source_bytes).toBe(0);expect(validateAll(f)).toEqual([]);record(f,'artifact/nonempty-lifecycle').observations.source_bytes=0;record(f,'artifact/nonempty-lifecycle').observations.download_bytes=0;expect(validateAll(f).length).toBeGreaterThan(0);});
 it('rejects caller supplied expected/operator/pass claims',()=>{const f=makeCaseEvidence();record(f,'getTask/native/authorized').observations.passed=true;expect(shape('r2-isolation')(f.receipts.isolation)).toBe(false);});
 it.each(['revision','tree_sha256','environment_id','composition_sha256'])('binds actual executing command %s',key=>{const f=makeCaseEvidence(),r=record(f,'getTask/native/authorized');f.commands.get(r.command_id)[key]='other';expect(validateAll(f).length).toBeGreaterThan(0);});
 it('rejects missing/duplicate family cases and source facade masquerading as live',()=>{const f=makeCaseEvidence();f.receipts.isolation.records.pop();expect(validateAll(f).length).toBeGreaterThan(0);const g=makeCaseEvidence(),r=record(g,'native/getTask/success');g.commands.get(r.command_id).kind='workers-tests';g.commands.get(r.command_id).provenance='source';expect(validateAll(g).length).toBeGreaterThan(0);});
 it('all command fragments must have matching prepared subject commitments',()=>{const f=makeCaseEvidence(),r=record(f,'getTask/native/authorized');f.commands.get(r.command_id).subjects.cases[0].subject_sha256=caseHash('unrelated');expect(validateAll(f).length).toBeGreaterThan(0);});
 it('prepared subjects cannot self-certify substituted digest',()=>{const f=makeCaseEvidence();f.preparations.subjects[0].subject_sha256=caseHash('invented');expect(validatePreparations(f.preparations,f.context).length).toBeGreaterThan(0);});
 it('native principal==agent plus current grant cannot be swapped',()=>{const f=makeCaseEvidence(),s=f.preparations.subjects.find((x:any)=>x.case_id==='getTask/native/authorized');s.subject.agent_id='other';f.context.subjectDigests.set(s.case_id,caseHash(s.subject));s.subject_sha256=caseHash(s.subject);expect(validatePreparations(f.preparations,f.context).some(x=>x.code==='R2_CASE_SUBJECT')).toBe(true);});
 it('revoked negative needs ordered positive/acknowledged disable/same exact proof',()=>{const f=makeCaseEvidence(),r=record(f,'claimTask/native/native-revoked-after-eviction');r.observations.disable_seq=r.observations.positive_seq;expect(validateAll(f).length).toBeGreaterThan(0);const g=makeCaseEvidence();record(g,r.id).observations.negative_proof_sha256=caseHash('wrong proof confounder');expect(validateAll(g).length).toBeGreaterThan(0);});
 it('foreign-run negative and positive cannot swap run, proof, grant or task fixture',()=>{for(const key of ['submit_negative_run_id','submit_positive_run_id','submit_negative_task_id','submit_positive_task_id','submit_observed_grant_sha256']){const f=makeCaseEvidence();record(f,'tasks/native/foreign-task-own-run').observations[key]=key.endsWith('sha256')?caseHash('wrong'):'wrong';expect(validateAll(f).length,key).toBeGreaterThan(0);}});
 it('browser reviewers and replay cannot satisfy checks with unrelated self-consistent pairs',()=>{for(const [id,keys] of [['browser/independent-accept',['submit_run_id','accept_run_id']],['browser/lost-response-same-intent',['first_key_sha256','retry_key_sha256']],['task/server-retained-replay',['original_run_id','replayed_run_id']]] as const){const f=makeCaseEvidence(),r=record(f,id);for(const k of keys)r.observations[k]=k.endsWith('sha256')?caseHash('unrelated'):'unrelated';expect(validateAll(f).length).toBeGreaterThan(0);}});
 it('bounded closed schema rejects control IDs, extra subject fields and array overflow',()=>{const f=makeCaseEvidence();f.preparations.subjects[0].subject.workspace_id='bad\n';expect(shape('r2-case-preparations')(f.preparations)).toBe(false);const g=makeCaseEvidence();g.preparations.subjects[0].subject.expected=true;expect(shape('r2-case-preparations')(g.preparations)).toBe(false);});
 it('percase observation must fall in its process interval and before assembly',()=>{const f=makeCaseEvidence();f.receipts.native.records[0].observed_at=35;expect(validateAll(f).length).toBeGreaterThan(0);});
 it('independently measures escaped maximum schema fixture bounds',()=>{const f=makeCaseEvidence();let max=0,total=Buffer.byteLength(canonicalCaseSubject(f.preparations));for(const receipt of Object.values(f.receipts) as any[]){const size=Buffer.byteLength(canonicalCaseSubject(receipt));expect(size).toBeLessThanOrEqual(CASE_LIMITS.family);total+=size;for(const r of receipt.records)max=Math.max(max,Buffer.byteLength(canonicalCaseSubject(r)));}expect(max).toBeLessThan(CASE_LIMITS.record);expect(total).toBeLessThan(16*1024*1024);expect(Buffer.byteLength(canonicalCaseSubject({id:'"'.repeat(128)}))).toBe(265);});
});

describe('prepared request applicability',()=>{
 it('a read-only getWorkspace cannot claim an idempotency key',()=>{const f=makeCaseEvidence(),entry=f.preparations.subjects.find((x:any)=>x.case_id==='getWorkspace/native/authorized');entry.subject.key_sha256=caseHash('inapplicable-key');entry.subject_sha256=caseHash(entry.subject);f.subjectDigests.set(entry.case_id,entry.subject_sha256);expect(validatePreparations(f.preparations,f.context).some(x=>x.code==='R2_CASE_SUBJECT')).toBe(true);});
 it('a no-runtime-proof getWorkspace cannot claim a proof hash',()=>{const f=makeCaseEvidence(),entry=f.preparations.subjects.find((x:any)=>x.case_id==='native/revoked-after-disable');entry.subject.proof_sha256=caseHash('inapplicable-proof');entry.subject_sha256=caseHash(entry.subject);f.subjectDigests.set(entry.case_id,entry.subject_sha256);expect(validatePreparations(f.preparations,f.context).some(x=>x.code==='R2_CASE_SUBJECT')).toBe(true);});
});

it('frozen54-operation R2 catalog excludes exactly the two reviewed R3 browser recovery reads',()=>{
 const r3Only=['reconcileMessageCreation','reconcileTaskCreation'];
 expect(Object.keys(CASE_OPERATIONS)).toHaveLength(54);
 for(const name of r3Only){expect(Object.hasOwn(CASE_OPERATIONS,name)).toBe(false);const actual=clientOperations[name as keyof typeof clientOperations];expect(actual).toMatchObject({native:false,runtimeProof:false,method:'POST',status:200});}
 const r2=Object.entries(clientOperations).filter(([name])=>!r3Only.includes(name));
 expect(r2.map(([name])=>name).sort()).toEqual(Object.keys(CASE_OPERATIONS).sort());
 for(const [name,actual] of r2){const {validateRequest,validateResponse,byteRules,...descriptor}=actual;expect(CASE_OPERATIONS[name]).toEqual(descriptor);}
});

describe('closed bounds and independent negative controls',()=>{
 it('128 escaped ID characters are admitted by shape,129 are not',()=>{const f=makeCaseEvidence(),entry=f.preparations.subjects[0];entry.subject.fixture_record_sha256=caseHash('fixture');entry.subject.task_id='"'.repeat(128);expect(shape('r2-case-preparations')(f.preparations)).toBe(true);entry.subject.task_id+='"';expect(shape('r2-case-preparations')(f.preparations)).toBe(false);});
 it('a valid per-case maximum does not promise the simultaneous4MiBfamily maximum fits',()=>{const f=makeCaseEvidence(),ids=Array.from({length:64},(_,i)=>'"'.repeat(125)+String(i).padStart(3,'0'));for(const r of f.receipts.isolation.records){if(r.observations.response_resource_ids){r.observations.response_resource_ids=ids;r.observations.observer_resource_ids=ids;}}expect(shape('r2-isolation')(f.receipts.isolation)).toBe(true);expect(Buffer.byteLength(canonicalCaseSubject(f.receipts.isolation))).toBeGreaterThan(CASE_LIMITS.family);expect(validateCaseFamily(f.receipts.isolation,f.context).some(x=>x.code==='R2_CASE_BUDGET')).toBe(true);});
 it('resource projection64ids allowed,65 denied before semantic acceptance',()=>{const f=makeCaseEvidence(),r=record(f,'getTask/native/authorized');r.observations.response_resource_ids=Array.from({length:64},(_,i)=>'id'+i);r.observations.observer_resource_ids=r.observations.response_resource_ids;expect(shape('r2-isolation')(f.receipts.isolation)).toBe(true);r.observations.response_resource_ids.push('extra');expect(shape('r2-isolation')(f.receipts.isolation)).toBe(false);});
 it('cannot omit protected producer projection or original outcome record',()=>{for(const key of ['projection_verifier_record_sha256','outcome_record_sha256','observer_record_sha256']){const f=makeCaseEvidence();delete record(f,'getTask/native/authorized').observations[key];expect(shape('r2-isolation')(f.receipts.isolation),key).toBe(false);}});
 it('does not accept partial actual mutationtable evidence',()=>{const f=makeCaseEvidence();record(f,'createTask/human/authorized').observations.changed_tables=['tasks'];expect(validateAll(f).length).toBeGreaterThan(0);});
 it('no-union and foreign snapshots cannot use counts alone',()=>{const f=makeCaseEvidence();record(f,'grants/native/no-union').observations.split_default_after_b_sha256=caseHash('foreign mutation');expect(validateAll(f).length).toBeGreaterThan(0);});
 it('review requires distinct principal and agent relationships',()=>{const f=makeCaseEvidence(),r=record(f,'browser/independent-accept');r.observations.submitter_principal_id=r.observations.reviewer_principal_id;expect(validateAll(f).length).toBeGreaterThan(0);const g=makeCaseEvidence(),s=record(g,r.id);s.observations.submitter_agent_id=s.observations.reviewer_agent_id;expect(validateAll(g).length).toBeGreaterThan(0);});
 it('command partition is capped128 even when all subject hashes match',()=>{const f=makeCaseEvidence(),r=f.receipts.isolation.records[0],c=f.commands.get(r.command_id);c.subjects.cases.push({...c.subjects.cases[0]});c.case_ids.push(c.case_ids[0]);expect(validateAll(f).length).toBeGreaterThan(0);});
 it('another unused command cannot claim already consumed cases',()=>{const f=makeCaseEvidence(),r=f.receipts.isolation.records[0],c=structuredClone(f.commands.get(r.command_id));c.id='alias-command';f.commands.set(c.id,c);expect(validateAll(f).some(x=>x.code==='R2_CASE_COMMAND_COVERAGE')).toBe(true);});
 it('missing graph/UI/executable context fails instead of defaulting true',()=>{for(const key of ['resultGraphSha256','uiAssetsSha256','nativeExecutableSha256']){const f=makeCaseEvidence();delete f.context[key];expect(validateAll(f).length,key).toBeGreaterThan(0);}});
 it('policy and schema nested objects are immutable',()=>{expect(Object.isFrozen(CASE_POLICY[0].rules[0])).toBe(true);expect(Object.isFrozen(caseSchemas.$defs['r2-native'])).toBe(true);});
});

describe('evidence harness exit is distinct from expected native process denial',()=>{
 it('rejects a failed actual evidence-producing command',()=>{const f=makeCaseEvidence(),r=record(f,'native/restart-no-send');f.commands.get(r.command_id).exit_code=1;expect(validateCaseFamily(f.receipts.native,f.context).some(x=>x.code==='R2_CASE_PRODUCER')).toBe(true);});
 it('rejects a failed evidence assembly command',()=>{const f=makeCaseEvidence();f.commands.get(f.receipts.native.command_id).exit_code=1;expect(validateCaseFamily(f.receipts.native,f.context).some(x=>x.code==='R2_CASE_ASSEMBLY')).toBe(true);});
 it('keeps real process exits3/5 valid inside successful harness evidence',()=>{const f=makeCaseEvidence();expect(record(f,'native/restart-no-send').observations.process_exit).toBe(5);expect(record(f,'native/revoked-after-disable').observations.process_exit).toBe(3);expect(validateCaseFamily(f.receipts.native,f.context)).toEqual([]);});
});
it('assembly cannot start before its evidence execution command finishes',()=>{const f=makeCaseEvidence();f.commands.get(f.receipts.native.command_id).started_at=26;expect(validateCaseFamily(f.receipts.native,f.context).some(x=>x.code==='R2_CASE_TIME')).toBe(true);});

describe('zero-byte digests retain their actual SHA256 meaning',()=>{
 it('empty lifecycle rejects arbitrary equal source/download hashes',()=>{const f=makeCaseEvidence(),r=record(f,'artifact/empty-lifecycle');r.observations.source_sha256=r.observations.download_sha256=caseHash('not empty');expect(validateCaseFamily(f.receipts.gates,f.context).length).toBeGreaterThan(0);});
 it('native zero-byte source/target pair cannot carry a nonempty hash',()=>{const f=makeCaseEvidence(),r=record(f,'native/downloadArtifactContent/success');r.observations.source_bytes=r.observations.target_bytes=0;r.observations.source_sha256=r.observations.target_sha256=caseHash('not empty');expect(validateCaseFamily(f.receipts.native,f.context).length).toBeGreaterThan(0);});
 it('source facade zero-byte expected/actual pair cannot carry a nonempty hash',()=>{const f=makeCaseEvidence(),r=record(f,'downloadArtifactContent/native/native-facade');r.observations.artifact_expected_bytes=r.observations.artifact_actual_bytes=0;r.observations.artifact_expected_sha256=r.observations.artifact_actual_sha256=caseHash('not empty');expect(validateCaseFamily(f.receipts.isolation,f.context).length).toBeGreaterThan(0);});
});

// Run the same coverage guards independently of the Workers suite's all-executed receipt hook.
it('R2 isolation coverage keeps exactly54 cases alongside reviewed R3 recovery reads',()=>{expect(isolationOperations).toHaveLength(54);expect(()=>assertIsolationCoverage(isolationOperations)).not.toThrow();});
it('R2 isolation coverage still rejects omitted operations and empty actor lanes',()=>{expect(()=>assertIsolationCoverage(isolationOperations.filter(x=>x.operation!=='searchWorkspace'))).toThrow('missing searchWorkspace');expect(()=>assertIsolationCoverage(isolationOperations.map(x=>x.operation==='getWorkspace'?{...x,lanes:[]}:x))).toThrow('lane coverage');});
