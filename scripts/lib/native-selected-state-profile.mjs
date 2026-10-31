/** Closed source-owned witness selection, not caller authority or SQL configuration.
 * Historical defaults are frozen16. Current17 must be explicit and hash-bound. */
import historical from '../../workers/native-fixture/complete-selectors.json' with {type:'json'};
import current from '../../workers/native-fixture/complete-selectors-schema17.json' with {type:'json'};
import witness from '../../workers/native-fixture/selected-state-schema17-profile.json' with {type:'json'};
import {selectCompleteProfile} from './native-profile-selection.mjs';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const old=freeze({catalog:historical,marker:{}});
const next=freeze({catalog:current,marker:{selected_state_profile:witness.profile,selected_state_catalog_sha256:witness.catalog_sha256}});
export function selectNativeSelectedState(tag){
 const p=selectCompleteProfile(tag).profile;
 if(p.selected_state_profile===undefined)return old;
 if(p.selected_state_profile!==witness.profile||p.selected_state_catalog_sha256!==witness.catalog_sha256)throw Error('NATIVE_SELECTED_STATE_PROFILE_REJECTED');
 return next;
}
