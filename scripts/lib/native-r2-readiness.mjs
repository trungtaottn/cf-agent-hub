/** No IO or execution: source/config diagnosis is not native admission. */
import {createHash} from 'node:crypto';
import {validateNativeConfig} from './native-r2-config.mjs';
import {getNativeScenario} from './native-r2-scenario.mjs';
const reject=()=>{throw Error('NATIVE_READINESS_REJECTED');};
const expectedScenario='08cea014466b73dc67b534147ca8cc3b5939bee46a2b85a2ffc12ae02271bb25';
export function assertNativeReadinessScenarioDigest(value){if(typeof value!=='string'||value!==expectedScenario)reject();}
const controls=Object.freeze({
 'control/authorize':'installed-authority-unavailable',
 'control/provision':'native-fixture-integration-missing',
 'control/observe-success-coverage':'native-observer-integration-missing',
 'control/observe-server-foreign-fixture':'native-observer-integration-missing',
 'control/observe-other-runtime':'native-observer-integration-missing',
 'control/prepare-swap-slot':'unsupported-under-current-contract',
 'control/prepare-swap-generation':'unsupported-under-current-contract',
 'control/prepare-swap-principal':'unsupported-under-current-contract',
 'control/observe-settled-intent':'protected-journal-observer-missing',
 'control/arm-lost-response':'native-front-door-integration-missing',
 'control/disarm-and-observe-lost':'native-front-door-integration-missing',
 'control/revoke-submitter':'native-human-control-integration-missing'
});
export function diagnoseNativeReadiness(input){
 const config=validateNativeConfig(input),scenario=getNativeScenario();
 assertNativeReadinessScenarioDigest(createHash('sha256').update(JSON.stringify(scenario)).digest('hex'));
 const configuration_prerequisites=[];
 for(const actor of new Set(scenario.steps.map(s=>s.actor)))if(!config.actors.some(a=>a.id===actor))configuration_prerequisites.push('actor/'+actor);
 const fixtures=new Map();for(const step of scenario.steps)if(step.requires.includes('separate-explicit-fixture-store-authorization'))fixtures.set(step.fixture,step.actor);
 for(const[fixture,actor]of fixtures)if(!config.fixture_stores.some(f=>f.fixture===fixture&&f.actor_slot===actor))configuration_prerequisites.push('fixture/'+fixture);
 const necessary_budget_lower_bounds={commands:0,mutations:0,artifact_bytes:0,output_bytes:0};
 const capabilities=scenario.steps.map(step=>{
  necessary_budget_lower_bounds.commands+=Math.max(1,step.budget?.processes??0);
  necessary_budget_lower_bounds.mutations+=step.budget?.mutations??0;
  if(step.requires.includes('nonempty-artifact-source-at-most-10MiB'))necessary_budget_lower_bounds.artifact_bytes++;
  if(step.kind!=='control')necessary_budget_lower_bounds.output_bytes++;
  let status;if(step.kind==='control'){if(!Object.hasOwn(controls,step.id))reject();status=controls[step.id];}else if(step.kind==='native')status='native-adapter-unavailable';else if(step.kind==='local')status='protected-local-command-not-admitted';else reject();
  return{id:step.id,status};
 });
 for(const requirement of scenario.externalRequirements)capabilities.push({id:'external/'+requirement.id,status:'native-external-observer-integration-missing'});
 for(const[key,min]of Object.entries(necessary_budget_lower_bounds))if(config.budgets[key]<min)configuration_prerequisites.push('budget/'+key);
 const result={type:'native-r2-source-readiness',version:1,status:'blocked',scope:'source-config-readiness',configuration_prerequisites,capabilities,necessary_budget_lower_bounds,unperformed_checks:['executable-and-store-custody','installed-authority','native-transport-and-observers','subprocess-execution','full-budget-admission','native-acceptance'],nativeConformance:false,issue48Complete:false,acceptance:'not-evaluated'};
 if(Buffer.byteLength(JSON.stringify(result))>16384)reject();return result;
}
