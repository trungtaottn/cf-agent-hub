/** Closed public CLI metadata only. Never serialize private factory originals. */
import {types} from 'node:util';
const reject=()=>{throw Error('NATIVE_COMPLETE_RUNNER_RESULT_REJECTED');};
const check=v=>{if(!v)reject();};
const names=['status','executionStatus','scope','issue48Complete','native_conformance','acceptance','completedSteps','plannedSteps','runId','retryAllowed','cleanup','durability','reportReady','externalRequirements'];
const methods=['readCompleteReport','readCompleteOriginals','readCompleteNativeFragment'];
export function completeRunnerSummary(input){try{
 check(input&&typeof input==='object'&&!types.isProxy(input)&&Object.getPrototypeOf(input)===Object.prototype);
 const descriptors=Object.getOwnPropertyDescriptors(input);check(Reflect.ownKeys(descriptors).length===names.length+methods.length);
 const v={};for(const k of [...names,...methods]){const d=descriptors[k];check(d&&Object.hasOwn(d,'value'));v[k]=d.value;}
 for(const k of methods)check(typeof v[k]==='function'&&!types.isProxy(v[k]));
 check(['observed','incomplete'].includes(v.status)&&['observed','incomplete'].includes(v.executionStatus)&&v.scope==='producer-fragment'&&v.issue48Complete===false&&v.native_conformance===false&&v.acceptance==='pending-external-inspection'&&v.retryAllowed===false&&v.durability==='memory-only');
 check(Number.isSafeInteger(v.completedSteps)&&v.completedSteps>=0&&v.completedSteps<=62&&v.plannedSteps===62&&typeof v.runId==='string'&&v.runId.length===36&&/^run_[a-f0-9]{32}$/.test(v.runId));
 check(['closed','not-opened','cleanup-unknown'].includes(v.cleanup)&&typeof v.reportReady==='boolean');
 if(v.status==='observed')check(v.executionStatus==='observed'&&v.completedSteps===62&&v.cleanup==='closed'&&v.reportReady);else check(!v.reportReady);
 const a=v.externalRequirements;check(a&&!types.isProxy(a)&&Array.isArray(a)&&Object.getPrototypeOf(a)===Array.prototype);const ds=Object.getOwnPropertyDescriptors(a);check(Reflect.ownKeys(ds).length===3&&ds.length?.value===2);const expected=['server-foreign-workspace-denial','server-wrong-runtime-proof-denial'];for(let i=0;i<2;i++)check(ds[i]&&Object.hasOwn(ds[i],'value')&&ds[i].value===expected[i]);
 return Object.freeze({...Object.fromEntries(names.filter(k=>k!=='externalRequirements').map(k=>[k,v[k]])),externalRequirements:Object.freeze(expected)});
}catch{reject();}}
