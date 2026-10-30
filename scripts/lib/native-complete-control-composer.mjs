/** Closed control-role payload composition only. Fixed service owners must resolve
 * genuine source records before using this reducer; hashes are not custody proof.
 * Host-required roles remain mandatory in the final owner-separated report. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import roleMap from './native-complete-control-roles.json' with {type:'json'};
import caps from './native-complete-original-caps.json' with {type:'json'};
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {selectCompleteProfile} from './native-profile-selection.mjs';
const fail=()=>{throw Error('NATIVE_COMPLETE_CONTROL_COMPOSITION_REJECTED');},check=v=>{if(!v)fail();};
function fields(v,names){check(v&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype);const ds=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(ds).length===names.length);return Object.fromEntries(names.map(k=>{check(ds[k]?.enumerable&&Object.hasOwn(ds[k],'value'));return[k,ds[k].value];}));}
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
freeze(roleMap);freeze(caps);
export function completeControlHostRoles(step){check(typeof step==='string'&&Object.hasOwn(roleMap,step));return Object.freeze([...roleMap[step].host]);}
export function composeCompleteControlAcknowledgment(input){try{
 const v=fields(input,['profile','run_id','step_id','preparation_sha256','roles']),selected=selectCompleteProfile(v.profile);check(typeof v.step_id==='string'&&Object.hasOwn(roleMap,v.step_id)&&selected.scenario.steps.some(s=>s.kind==='control'&&s.id===v.step_id));check(typeof v.run_id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v.run_id)&&typeof v.preparation_sha256==='string'&&/^[a-f0-9]{64}$/.test(v.preparation_sha256));
 const expected=roleMap[v.step_id].service,raw=fields(v.roles,Object.keys(expected)),roles={};
 for(const [role,family]of Object.entries(expected)){const r=fields(raw[role],['record_id','family','sha256','byte_size']);check(typeof r.record_id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(r.record_id)&&r.family===family&&typeof r.sha256==='string'&&/^[a-f0-9]{64}$/.test(r.sha256)&&Number.isSafeInteger(r.byte_size)&&r.byte_size>=1&&r.byte_size<=65536);roles[role]=r;}
 const observed_at=Date.now();check(Number.isSafeInteger(observed_at)&&observed_at>=0);
 const payload={type:'native-complete-control-ack',version:2,profile:v.profile,run_id:v.run_id,step_id:v.step_id,preparation_sha256:v.preparation_sha256,observed_at,status:'acknowledged',roles},bytes=Buffer.from(canonical(payload));check(bytes.length<=caps.control_records[v.step_id]);
 return freeze({scope:'control-role-content-only',installedAuthority:false,native_conformance:false,payload,sha256:createHash('sha256').update(bytes).digest('hex'),byte_size:bytes.length});
}catch{fail();}}
