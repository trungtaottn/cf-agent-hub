import test from 'node:test';
import assert from 'node:assert/strict';
import {getNativeScenario} from '../../scripts/lib/native-r2-scenario.mjs';
import {getCompleteProfile} from '../../scripts/lib/native-complete-profile.mjs';
import {getRequiredProfile,getRequiredScenario,getRequiredCommitments} from '../../scripts/lib/native-required-profile.mjs';
const removed=['slot','generation','principal'].flatMap(x=>['control/prepare-swap-'+x,'probe/swapped-'+x]);
test('required R2 profile removes only the six owner-deferred slots',()=>{
 const p=getRequiredProfile(),s=getRequiredScenario(),full=getNativeScenario();
 assert.equal(p.profile,'native-r2-required-prepared-v1');assert.equal(p.version,2);
 assert.equal(s.steps.length,62);assert.equal(p.processes.length,53);assert.equal(p.inputs.length,27);
 assert.deepEqual(s.caseIds,full.caseIds);assert.equal(s.caseIds.length,37);
 assert.deepEqual(s.externalRequirements,full.externalRequirements);
 assert.deepEqual(s.steps.map(x=>x.id),full.steps.filter(x=>!removed.includes(x.id)).map(x=>x.id));
 for(const step of s.steps){const old=full.steps.find(x=>x.id===step.id);assert.deepEqual(step,{...old,dependsOn:step.id==='control/observe-settled-intent'?['prepare/runtime-own-after']:old.dependsOn});}
 const ids=new Set(s.steps.map(x=>x.id));for(const step of s.steps)for(const d of step.dependsOn)assert.ok(ids.has(d));
 assert.equal(getCompleteProfile().steps.length,68);
});
test('required profile reservations distinguish exact actions and conservative bytes',()=>{
 const p=getRequiredProfile();assert.deepEqual(p.reservation,{commands:459,mutations:43,artifact_bytes:174,output_bytes:22892715});
 assert.equal(p.limits.service_calls,346);assert.equal(p.limits.private_select_admissions,2201);assert.equal(p.release.records,491);
 assert.equal(p.release.total_bytes,11021644);assert.equal(p.release.joint_cap,16777216);
 assert.equal(p.deferred_metadata_cap,2048);assert.equal(p.deferred.length,3);
 for(const row of p.deferred){assert.equal(row.status,'unverified');assert.equal(row.acceptance,'R4');assert.equal(row.decision_date,'2026-10-30');}
 assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.deferred));
});
test('selected DAG commitment is distinct and pins original full acceptance provenance',()=>{
 const c=getRequiredCommitments();assert.match(c.scenario_sha256,/^[a-f0-9]{64}$/);
 assert.notEqual(c.scenario_sha256,c.full_scenario_sha256);assert.match(c.family_ledger_sha256,/^[a-f0-9]{64}$/);
 assert.throws(()=>{getRequiredScenario().steps.pop();});
});

test('closed selection rejects arbitrary tags without reading caller objects',async()=>{
 const {selectCompleteProfile}=await import('../../scripts/lib/native-profile-selection.mjs');
 assert.equal(selectCompleteProfile().profile.profile,'native-r2-complete-prepared-v1');
 const r=selectCompleteProfile('native-r2-required-prepared-v1');assert.equal(r.scenario.steps.length,62);
 for(const x of [null,'',1,'native-readers',{profile:'native-r2-required-prepared-v1'}])assert.throws(()=>selectCompleteProfile(x),/NATIVE_COMPLETE_PROFILE_REJECTED/);
 let reads=0;assert.throws(()=>selectCompleteProfile(new Proxy({},{get(){reads++;}})));assert.equal(reads,0);
});
