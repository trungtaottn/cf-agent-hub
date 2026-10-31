/** Closed source selection only; never producer readiness or installed authority. */
import {createHash} from 'node:crypto';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import fixture17 from './native-complete-fixture-schema17.json' with {type:'json'};
import witness17 from '../../workers/native-fixture/selected-state-schema17-profile.json' with {type:'json'};
import {getNativeScenario} from './native-r2-scenario.mjs';
import {getCompleteProfile,getCompleteCommitments} from './native-complete-profile.mjs';
import {getRequiredProfile,getRequiredScenario,getRequiredCommitments} from './native-required-profile.mjs';
const full=Object.freeze({profile:getCompleteProfile(),scenario:getNativeScenario(),commitments:getCompleteCommitments()});
const required=Object.freeze({profile:getRequiredProfile(),scenario:getRequiredScenario(),commitments:getRequiredCommitments()});
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const sha=v=>createHash('sha256').update(canonical(v)).digest('hex');
function current17(base,tag){
 const marker={selected_state_profile:witness17.profile,selected_state_catalog_sha256:witness17.catalog_sha256};
 const ledger=freeze({...base.profile.ledger,profile:tag,...marker});
 const profile=freeze({...base.profile,profile:tag,...marker,fixture:fixture17,ledger});
 return freeze({profile,scenario:base.scenario,commitments:{...base.commitments,fixture_sha256:sha(fixture17),family_ledger_sha256:sha(ledger)}});
}
const full17=current17(full,'native-r2-complete-schema17-v1');
const required17=current17(required,'native-r2-required-schema17-v1');
export function selectCompleteProfile(tag='native-r2-complete-prepared-v1'){
 if(tag==='native-r2-complete-schema17-v1')return full17;
 if(tag==='native-r2-required-schema17-v1')return required17;
 if(tag==='native-r2-complete-prepared-v1')return full;
 if(tag==='native-r2-required-prepared-v1')return required;
 throw Error('NATIVE_COMPLETE_PROFILE_REJECTED');
}
