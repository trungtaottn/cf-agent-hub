import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalCaseSubject} from '../../scripts/lib/r2-case-policy.mjs';
import {getNativeScenario} from '../../scripts/lib/native-r2-scenario.mjs';
import {getCompleteProfile,getCompleteCommitments} from '../../scripts/lib/native-complete-profile.mjs';
import {completeSlotRegistry,completePolicyDigest,validateCompletePolicy} from '../../scripts/lib/native-complete-protocol.mjs';
const sha='a'.repeat(64),now=1700000000000;
const context=()=>({version:2,runId:'run_actual',configSha256:sha,scenarioSha256:createHash('sha256').update(canonicalCaseSubject(getNativeScenario())).digest('hex'),candidateSha:'b'.repeat(40),candidateTreeSha:'c'.repeat(40),compositionSha256:sha,nodeSha256:sha,buildSha256:sha,authorityRecordSha256:sha});
const policy=()=>({type:'native-complete-run-policy',version:2,profile:getCompleteProfile().profile,assurance:'source-test-only',service_id:'service',instance_id:'instance',run_id:'run_actual',descriptor_sha256:sha,run_context:context(),actors_sha256:sha,workspaces_sha256:sha,fixture_stores_sha256:sha,source_inventory_sha256:sha,family_ledger_sha256:getCompleteCommitments().family_ledger_sha256,coverage:completeSlotRegistry().map(row=>({...row,supported:false,producer_id:null})),expires_at:now+61000});
const options=()=>({context:context(),now,operationalMs:60000});
test('complete slot registry is all68 source steps and2 external obligations, never execution order invention',()=>{
 const r=completeSlotRegistry(),s=getNativeScenario();assert.equal(r.length,70);
 assert.deepEqual(r.slice(0,68).map(x=>x.id),s.steps.map(x=>x.id));
 assert.deepEqual(r.slice(68).map(x=>x.id),s.externalRequirements.map(x=>x.id));
 assert.ok(Object.isFrozen(r)&&Object.isFrozen(r[0].requirements));
});
test('source-only structural policy remains explicitly unsupported without authority',()=>{
 const p=policy(),v=validateCompletePolicy(p,options());assert.deepEqual(v,p);assert.notEqual(v,p);assert.ok(Object.isFrozen(v));
 assert.match(completePolicyDigest(v),/^[a-f0-9]{64}$/);assert.equal(v.coverage.filter(x=>x.supported).length,0);
});
for(const [name,change] of Object.entries({missing:p=>p.coverage.pop(),duplicate:p=>p.coverage[1]=p.coverage[0],wrongKind:p=>p.coverage[0].kind='process',wrongRequirement:p=>p.coverage[0].requirements=[],unknown:p=>p.trusted=true,wrongRun:p=>p.run_id='run_other',wrongContext:p=>p.run_context.configSha256='f'.repeat(64),wrongTree:p=>p.run_context.candidateTreeSha='f'.repeat(64),wrongLedger:p=>p.family_ledger_sha256='f'.repeat(64),tooShort:p=>p.expires_at--,tooLong:p=>p.expires_at=now+300001,unknownAssurance:p=>p.assurance='owner-approved'}))test(`complete policy rejects ${name}`,()=>{const p=policy();change(p);assert.throws(()=>validateCompletePolicy(p,options()),/NATIVE_COMPLETE_PROTOCOL_REJECTED/);});
for(const id of ['control/prepare-swap-slot','control/prepare-swap-generation','control/prepare-swap-principal','probe/swapped-slot','probe/swapped-generation','probe/swapped-principal'])test(`caller cannot mark unavailable tuple ${id} supported`,()=>{
 const p=policy(),row=p.coverage.find(x=>x.id===id);assert.ok(row);row.supported=true;row.producer_id='native-complete-'+row.kind;assert.throws(()=>validateCompletePolicy(p,options()));
});
test('policy snapshots reject accessors and proxies before invocation',()=>{
 let calls=0;const p=policy();Object.defineProperty(p,'coverage',{enumerable:true,get(){calls++;return [];}});assert.throws(()=>validateCompletePolicy(p,options()));assert.equal(calls,0);
 assert.throws(()=>validateCompletePolicy(new Proxy(policy(),{get(){calls++;}}),options()));assert.equal(calls,0);
});

test('supported non-tuple enum is structurally accepted without manufacturing producer authority',()=>{
 const p=policy(),row=p.coverage.find(x=>x.id==='success/getWorkspace');row.supported=true;row.producer_id='native-complete-process';
 const parsed=validateCompletePolicy(p,options());assert.equal(parsed.coverage.find(x=>x.id===row.id).supported,true);assert.equal(parsed.authorized,undefined);
});

test('required policy binds exact reduced DAG and rejects full-policy substitution',async()=>{
 const {getRequiredProfile,getRequiredCommitments}=await import('../../scripts/lib/native-required-profile.mjs');
 const tag=getRequiredProfile().profile,c=getRequiredCommitments(),p=policy(),o=options();
 p.profile=tag;p.family_ledger_sha256=c.family_ledger_sha256;p.run_context.scenarioSha256=c.scenario_sha256;o.context.scenarioSha256=c.scenario_sha256;
 p.coverage=completeSlotRegistry(tag).map(row=>({...row,supported:false,producer_id:null}));
 assert.equal(p.coverage.length,64);assert.deepEqual(validateCompletePolicy(p,o),p);
 const full=policy();assert.throws(()=>validateCompletePolicy({...p,coverage:full.coverage},o));
 assert.throws(()=>validateCompletePolicy({...p,run_context:full.run_context},o));
 assert.throws(()=>validateCompletePolicy({...p,profile:full.profile},o));
 assert.throws(()=>completeSlotRegistry('unknown'));
});
