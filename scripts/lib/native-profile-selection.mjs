/** Closed source selection only; never producer readiness or installed authority. */
import {getNativeScenario} from './native-r2-scenario.mjs';
import {getCompleteProfile,getCompleteCommitments} from './native-complete-profile.mjs';
import {getRequiredProfile,getRequiredScenario,getRequiredCommitments} from './native-required-profile.mjs';
const full=Object.freeze({profile:getCompleteProfile(),scenario:getNativeScenario(),commitments:getCompleteCommitments()});
const required=Object.freeze({profile:getRequiredProfile(),scenario:getRequiredScenario(),commitments:getRequiredCommitments()});
export function selectCompleteProfile(tag='native-r2-complete-prepared-v1'){
 if(tag==='native-r2-complete-prepared-v1')return full;
 if(tag==='native-r2-required-prepared-v1')return required;
 throw Error('NATIVE_COMPLETE_PROFILE_REJECTED');
}
