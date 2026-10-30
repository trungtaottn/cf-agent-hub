import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getNativeScenario} from '../../scripts/lib/native-r2-scenario.mjs';
import {getCompleteProfile,validateCompleteBudget,requireCompleteCapabilities} from '../../scripts/lib/native-complete-profile.mjs';
const p=()=>getCompleteProfile();
const budget=()=>({...p().reservation,duration_ms:60000});
test('complete profile is one fixed full roster, not an offered reader subset',()=>{
 const profile=p(),scenario=getNativeScenario();
 assert.equal(profile.version,2);assert.equal(profile.profile,'native-r2-complete-prepared-v1');
 assert.deepEqual(profile.steps,scenario.steps.map(s=>s.id));
 assert.deepEqual(profile.external,scenario.externalRequirements.map(s=>s.id));
 assert.equal(profile.steps.length,68);assert.equal(profile.external.length,2);
 assert.equal(profile.processes.length,56);assert.equal(profile.inputs.length,27);
 assert.equal(profile.implementation_status,'contract-and-selected-state-only');
});
test('fixed artifact is actual nonempty29 bytes, not universal10MiB coverage',()=>{
 const a=p().artifact,bytes=Buffer.from(a.text,'utf8');assert.equal(bytes.length,29);
 assert.equal(a.byte_size,29);assert.equal(createHash('sha256').update(bytes).digest('hex'),a.sha256);
 assert.equal(p().reservation.artifact_bytes,6*29);
});
test('budget units and independent dimensions retain exact reviewed arithmetic',()=>{
 const v=p();assert.deepEqual(v.reservation,{commands:489,mutations:46,artifact_bytes:174,output_bytes:22890667});
 assert.equal(v.limits.service_calls,370);assert.equal(v.limits.application_requests,57);
 assert.equal(v.limits.private_select_admissions,2555);
 assert.equal(v.limits.private_canonical_bytes,7888422);
 assert.equal(v.limits.process_output_bytes,188416);
 assert.equal(v.limits.scanner_raw_bytes,376832);
 assert.equal(v.release.records,509);assert.equal(v.release.total_bytes,11019596);
 assert.equal(v.release.joint_cap,16777216);assert.equal(v.release.per_original_cap,65536);
 assert.equal(v.release.total_bytes+v.release.headroom,v.release.joint_cap);
});
test('profile and every nested collection are immutable',()=>{
 const v=p();assert.ok(Object.isFrozen(v)&&Object.isFrozen(v.reservation)&&Object.isFrozen(v.steps));
 assert.throws(()=>{v.steps.pop();});assert.throws(()=>{v.reservation.commands=0;});
 assert.equal(p().steps.length,68);
});
test('selected complete budget validates explicitly without invoking oldv1 limits',()=>{
 const input=budget(),value=validateCompleteBudget(input);assert.deepEqual(value,input);
 assert.notEqual(value,input);assert.ok(Object.isFrozen(value));
});
for(const k of ['commands','mutations','artifact_bytes','output_bytes'])for(const delta of [-1,1]){
 test(`complete budget rejects ${k} ${delta<0?'under':'over'} exact reservation`,()=>{
  const b=budget();b[k]+=delta;assert.throws(()=>validateCompleteBudget(b),/NATIVE_COMPLETE_BUDGET_REJECTED/);
 });
}
for(const duration of [0,-1,300001,NaN,Infinity,1.5])test(`duration rejects ${String(duration)}`,()=>{
 assert.throws(()=>validateCompleteBudget({...budget(),duration_ms:duration}),/NATIVE_COMPLETE_BUDGET_REJECTED/);
});
test('duration endpoints are structural only, not expiry or lease guarantees',()=>{
 for(const duration_ms of [1,300000])assert.equal(validateCompleteBudget({...budget(),duration_ms}).duration_ms,duration_ms);
});
test('unknown budget fields, prototypes, symbols, getters and proxies reject',()=>{
 assert.throws(()=>validateCompleteBudget({...budget(),allow:true}),/NATIVE_COMPLETE_BUDGET_REJECTED/);
 assert.throws(()=>validateCompleteBudget(Object.assign(Object.create({}),budget())),/NATIVE_COMPLETE_BUDGET_REJECTED/);
 const symbol=budget();symbol[Symbol('x')]=1;assert.throws(()=>validateCompleteBudget(symbol),/NATIVE_COMPLETE_BUDGET_REJECTED/);
 let calls=0;const getter=budget();Object.defineProperty(getter,'commands',{enumerable:true,get(){calls++;return 489;}});
 assert.throws(()=>validateCompleteBudget(getter),/NATIVE_COMPLETE_BUDGET_REJECTED/);assert.equal(calls,0);
 const proxy=new Proxy(budget(),{ownKeys(){calls++;return [];}});
 assert.throws(()=>validateCompleteBudget(proxy),/NATIVE_COMPLETE_BUDGET_REJECTED/);assert.equal(calls,0);
});
test('three actual unsupported tuple controls reject before any possible effect',()=>{
 let called=0;assert.throws(()=>requireCompleteCapabilities(),e=>{
  assert.equal(e.message,'NATIVE_COMPLETE_CAPABILITIES_UNAVAILABLE');
  assert.deepEqual(e.unavailable,['control/prepare-swap-slot','control/prepare-swap-generation','control/prepare-swap-principal']);return true;
 });
 assert.throws(()=>requireCompleteCapabilities({supported:true,execute(){called++;}}));assert.equal(called,0);
});

test('compiled allocation sums cannot silently omit or double-count a dimension',()=>{
 const v=p(),l=v.ledger,sum=o=>Object.values(o).reduce((a,b)=>a+b,0);
 assert.equal(sum(l.logical_commands),v.reservation.commands);
 assert.equal(sum(l.mutation_attempts),v.reservation.mutations);
 assert.equal(sum(l.logical_output_bytes),v.reservation.output_bytes);
 assert.equal(sum(l.service_calls),v.limits.service_calls);
 assert.equal(l.report_original_families.reduce((s,r)=>s+r.count,0),v.release.records);
 assert.equal(l.report_original_families.reduce((s,r)=>s+r.bytes,0)+l.logical_output_bytes.assembly_structural_fragment+l.logical_output_bytes.report2_reference_wrapper,v.release.total_bytes);
 assert.ok(Object.isFrozen(l.logical_output_bytes));
});
