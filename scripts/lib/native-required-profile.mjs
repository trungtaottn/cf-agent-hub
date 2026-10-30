/** Fixed owner-approved R2 execution plan. No authority or acceptance construction.
 * Original full acceptance roster remains unchanged for R4. No caller skip list.
 */
import {createHash} from 'node:crypto';
import {canonicalCaseSubject} from './r2-case-policy.mjs';
import {getNativeScenario} from './native-r2-scenario.mjs';
import {getCompleteProfile} from './native-complete-profile.mjs';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const sha=v=>createHash('sha256').update(canonicalCaseSubject(v)).digest('hex');
const full=getNativeScenario(),base=getCompleteProfile();
const deferred=freeze(['slot','generation','principal'].map(mode=>({decision_date:'2026-10-30',status:'unverified',acceptance:'R4',control_id:'control/prepare-swap-'+mode,probe_id:'probe/swapped-'+mode})));
const omitted=new Set(deferred.flatMap(row=>[row.control_id,row.probe_id]));
const steps=full.steps.filter(s=>!omitted.has(s.id)).map(s=>s.id==='control/observe-settled-intent'?{...s,dependsOn:['prepare/runtime-own-after']}:s);
const executionBudget=steps.filter(s=>s.budget!==null).reduce((sum,s)=>{for(const key of Object.keys(sum))sum[key]+=s.budget[key];return sum;},{processes:0,mutations:0,httpRequests:0});
const scenario=freeze({...full,steps,executionBudget});
const ledger=freeze({...base.ledger,profile:'native-r2-required-prepared-v1',full_scenario_sha256:sha(full),execution_scenario_sha256:sha(scenario),deferred,
 logical_commands:{scenario:62,evidence:41,service:346,bootstrap:10},
 mutation_attempts:{scenario:31,bootstrap:6,external:5,human_revoke:1},
 logical_output_bytes:{...base.ledger.logical_output_bytes,deferred_report_metadata:2048},
 byte_reservation_semantics:'Conservative full-profile ceilings plus bounded report-only deferred metadata; not exact emitted bytes.',
 report_original_families:base.ledger.report_original_families.map(row=>({...row,count:row.kind==='additional process custody'?42:row.kind==='nonrecorder signed summaries'?14:row.kind==='signed process scans'?106:row.count})),
 service_calls:{...base.ledger.service_calls,'prepare-slot':64,'complete-process':53,'execute-control':9,'observe-slot':64,scanner:109},
});
const profile=freeze({...base,profile:ledger.profile,implementation_status:'required-contract-only',steps:steps.map(s=>s.id),processes:base.processes.filter(p=>!omitted.has(p.step_id)),
 reservation:{commands:459,mutations:43,artifact_bytes:174,output_bytes:22892715},
 limits:{...base.limits,service_calls:346,private_select_admissions:2201},
 release:{...base.release,records:491,total_bytes:11021644,headroom:5755572},
 // Empty unsupported set is not a producer-readiness or authority admission.
 unavailable:[],deferred,deferred_metadata_cap:2048,ledger,
});
const sum=o=>Object.values(o).reduce((a,b)=>a+b,0);
if(steps.length!==62||profile.processes.length!==53||profile.inputs.length!==27||scenario.caseIds.length!==37||executionBudget.processes!==53||executionBudget.mutations!==31||sum(ledger.service_calls)!==346||sum(ledger.logical_commands)!==459||sum(ledger.logical_output_bytes)!==22892715||ledger.report_original_families.reduce((a,r)=>a+r.count,0)!==491||Buffer.byteLength(JSON.stringify({deferred}))+1>2048)throw Error('NATIVE_REQUIRED_PROFILE_SOURCE_MISMATCH');
for(const step of steps)if(step.dependsOn.some(id=>!steps.some(s=>s.id===id)))throw Error('NATIVE_REQUIRED_PROFILE_SOURCE_MISMATCH');
export function getRequiredProfile(){return profile;}
export function getRequiredScenario(){return scenario;}
export function getRequiredCommitments(){return freeze({fixture_sha256:sha(profile.fixture),family_ledger_sha256:sha(ledger),scenario_sha256:sha(scenario),full_scenario_sha256:sha(full)});}
