import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {selectCompleteProfile} from '../../scripts/lib/native-profile-selection.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
for(const roster of ['complete','required'])test(`explicit ${roster} schema17 profile preserves frozen16 capabilities and binds exact catalog`,()=>{
 const old=selectCompleteProfile(`native-r2-${roster}-prepared-v1`),current=selectCompleteProfile(`native-r2-${roster}-schema17-v1`);
 assert.equal(Buffer.byteLength(current.profile.profile),Buffer.byteLength(old.profile.profile));
 assert.deepEqual(current.profile.steps,old.profile.steps);
 assert.deepEqual(current.profile.unavailable,old.profile.unavailable);
 assert.deepEqual(current.profile.reservation,old.profile.reservation);
 assert.deepEqual(current.scenario,old.scenario);
 assert.equal(current.profile.selected_state_profile,'native-selected-state-schema17-v1');
 assert.equal(current.profile.selected_state_catalog_sha256,sha(readFileSync(new URL('../../workers/native-fixture/complete-selectors-schema17.json',import.meta.url))));
 assert.notEqual(current.commitments.fixture_sha256,old.commitments.fixture_sha256);
 assert.equal(old.profile.fixture.selected_state.source,'workers/native-fixture/complete-selectors.json');
 assert.equal(old.profile.fixture.selected_state.sha256,sha(readFileSync(new URL('../../workers/native-fixture/complete-selectors.json',import.meta.url))));
 assert.equal(old.profile.selected_state_profile,undefined);
});
test('unknown schema profiles and implicit current aliases remain closed',()=>{
 for(const tag of ['native-r2-required-prepared-schema18-v1','current','17'])assert.throws(()=>selectCompleteProfile(tag));
 assert.equal(selectCompleteProfile().profile.profile,'native-r2-complete-prepared-v1');
});
test('selected decoder catalog is exact and never silently downgraded',async()=>{
 const {selectNativeSelectedState}=await import('../../scripts/lib/native-selected-state-profile.mjs');
 const old=selectNativeSelectedState('native-r2-required-prepared-v1'),current=selectNativeSelectedState('native-r2-required-schema17-v1');
 assert.equal(old.catalog.catalog.S.acceptedRows,16);assert.equal(current.catalog.catalog.S.acceptedRows,17);
 assert.equal(current.catalog.catalog.S.bridgeRows,18);assert.ok(Object.isFrozen(current.catalog.catalog.S));
 assert.deepEqual(old.marker,{});assert.equal(current.marker.selected_state_profile,'native-selected-state-schema17-v1');
});
