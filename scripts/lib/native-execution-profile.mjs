/** Source selection only; no installation or execution authority. */
import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {canonicalCaseSubject} from './r2-case-policy.mjs';
import {validateNativeConfig} from './native-r2-config.mjs';
import {validateCompleteConfig} from './native-complete-config.mjs';
import {getNativeScenario} from './native-r2-scenario.mjs';
import {selectCompleteProfile} from './native-profile-selection.mjs';
const digest=value=>createHash('sha256').update(canonicalCaseSubject(value)).digest('hex');
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export function selectNativeExecutionProfile(input){
 if(!input||typeof input!=='object'||types.isProxy(input))throw Error('NATIVE_EXECUTION_PROFILE_REJECTED');
 const version=Object.getOwnPropertyDescriptor(input,'version');
 if(!version?.enumerable||!Object.hasOwn(version,'value')||![1,2].includes(version.value))throw Error('NATIVE_EXECUTION_PROFILE_REJECTED');
 const config=freeze(version.value===1?validateNativeConfig(input):validateCompleteConfig(input));
 const selected=config.version===2?selectCompleteProfile(config.profile):{scenario:getNativeScenario(),profile:null,commitments:null};
 const budgets=Object.freeze(Object.fromEntries(['commands','mutations','artifact_bytes','output_bytes','duration_ms'].map(k=>[k,config.budgets[k]])));
 return Object.freeze({config,configSha256:digest(config),scenario:selected.scenario,scenarioSha256:digest(selected.scenario),profile:selected.profile,commitments:selected.commitments,budgets});
}
