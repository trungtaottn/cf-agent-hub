/** Closed source selection only; never producer readiness or installed authority. */
import {createHash} from 'node:crypto';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {nativeSchema19Catalog} from './native-schema19-catalog.mjs';
import fixture19 from './native-complete-fixture-schema19.json' with {type:'json'};
import witness19 from '../../workers/native-fixture/selected-state-schema19-profile.json' with {type:'json'};
import fixture18 from './native-complete-fixture-schema18.json' with {type:'json'};
import witness18 from '../../workers/native-fixture/selected-state-schema18-profile.json' with {type:'json'};
import fixture17 from './native-complete-fixture-schema17.json' with {type:'json'};
import witness17 from '../../workers/native-fixture/selected-state-schema17-profile.json' with {type:'json'};
import {getNativeScenario} from './native-r2-scenario.mjs';
import {getCompleteProfile,getCompleteCommitments} from './native-complete-profile.mjs';
import {getRequiredProfile,getRequiredScenario,getRequiredCommitments} from './native-required-profile.mjs';
const full=Object.freeze({profile:getCompleteProfile(),scenario:getNativeScenario(),commitments:getCompleteCommitments()});
const required=Object.freeze({profile:getRequiredProfile(),scenario:getRequiredScenario(),commitments:getRequiredCommitments()});
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const sha=v=>createHash('sha256').update(canonical(v)).digest('hex');
function currentWitness(base,tag,fixture,witness){
 const marker={selected_state_profile:witness.profile,selected_state_catalog_sha256:witness.catalog_sha256};
 const ledger=freeze({...base.profile.ledger,profile:tag,...marker});
 const profile=freeze({...base.profile,profile:tag,...marker,fixture,ledger});
 return freeze({profile,scenario:base.scenario,commitments:{...base.commitments,fixture_sha256:sha(fixture),family_ledger_sha256:sha(ledger)}});
}
const full17=currentWitness(full,'native-r2-complete-schema17-v1',fixture17,witness17);
const required17=currentWitness(required,'native-r2-required-schema17-v1',fixture17,witness17);
const full18=currentWitness(full,'native-r2-complete-schema18-v1',fixture18,witness18);
const required18=currentWitness(required,'native-r2-required-schema18-v1',fixture18,witness18);
// Only the new19 profile adds its exact private witness bytes. Historical
// ledgers, capability rosters, release caps and executable cap are immutable.
function schema19Witness(base,tag){
 const current=currentWitness(base,tag,fixture19,witness19),bytes=nativeSchema19Catalog.totals.canonicalAdmissionBytes;
 const delta=bytes-base.profile.limits.private_canonical_bytes;
 const ledger=freeze({...current.profile.ledger,logical_output_bytes:{...current.profile.ledger.logical_output_bytes,private_sql_canonical:bytes}});
 const profile=freeze({...current.profile,ledger,limits:{...current.profile.limits,private_canonical_bytes:bytes},reservation:{...current.profile.reservation,output_bytes:current.profile.reservation.output_bytes+delta}});
 return freeze({...current,profile,commitments:{...current.commitments,family_ledger_sha256:sha(ledger)}});
}
const full19=schema19Witness(full,'native-r2-complete-schema19-v1');
const required19=schema19Witness(required,'native-r2-required-schema19-v1');
export function selectCompleteProfile(tag='native-r2-complete-prepared-v1'){
 if(tag==='native-r2-complete-schema19-v1')return full19;
 if(tag==='native-r2-required-schema19-v1')return required19;
 if(tag==='native-r2-complete-schema18-v1')return full18;
 if(tag==='native-r2-required-schema18-v1')return required18;
 if(tag==='native-r2-complete-schema17-v1')return full17;
 if(tag==='native-r2-required-schema17-v1')return required17;
 if(tag==='native-r2-complete-prepared-v1')return full;
 if(tag==='native-r2-required-prepared-v1')return required;
 throw Error('NATIVE_COMPLETE_PROFILE_REJECTED');
}
