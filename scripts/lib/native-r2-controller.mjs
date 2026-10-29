import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,lstatSync} from 'node:fs';
import {join,dirname,relative,isAbsolute} from 'node:path';
import {admitNativeRun,inspectNativeDirectory} from './native-r2-admission.mjs';
import {createNativeBudget,withNativeDeadline} from './native-r2-budget.mjs';
import {validateNativeConfig} from './native-r2-config.mjs';
import {getNativeScenario,buildNativeInvocation} from './native-r2-scenario.mjs';
import {runOwnedProcess} from './native-r2-process.mjs';
import {canonicalCaseSubject} from './r2-case-policy.mjs';
const sha=value=>createHash('sha256').update(canonicalCaseSubject(value)).digest('hex');
const fail=()=>{throw Error('NATIVE_PLAN_REJECTED');};
const accounted=(usage,cost)=>usage&&Object.keys(usage).sort().join(',')===[...costKeys].sort().join(',')&&costKeys.every(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0&&usage[key]<=cost[key]);
const costKeys=['commands','mutations','artifact_bytes','output_bytes'];
/** Whole-plan admission. Adapter-declared costs rely on the trusted adapter's
 * enforcement: arbitrary host JavaScript cannot be sandboxed by a counter. */
export function prepareNativeExecution(scenario,budgets,reservations){
 if(!scenario||!Array.isArray(scenario.steps)||scenario.steps.length<1||scenario.steps.length>128||!Array.isArray(reservations)||reservations.length!==scenario.steps.length)fail();
 const ids=new Set(),costs=[],totals=Object.fromEntries(costKeys.map(k=>[k,0]));
 for(let index=0;index<scenario.steps.length;index++){
  const step=scenario.steps[index],cost=reservations[index];
  if(!step||typeof step.id!=='string'||ids.has(step.id)||!Array.isArray(step.dependsOn)||step.dependsOn.some(id=>!ids.has(id)))fail();ids.add(step.id);
  if(!cost||Object.keys(cost).sort().join(',')!==['id',...costKeys].sort().join(',')||cost.id!==step.id)fail();
  for(const key of costKeys)if(!Number.isSafeInteger(cost[key])||cost[key]<0)fail();
  if(cost.commands<1||step.budget&&(cost.commands<step.budget.processes||cost.mutations<step.budget.mutations))fail();
  if(step.kind!=='control'&&cost.output_bytes<1)fail();
  if(step.requires?.includes('nonempty-artifact-source-at-most-10MiB')&&cost.artifact_bytes<1)fail();
  const value=Object.fromEntries(costKeys.map(key=>[key,cost[key]]));costs.push({id:cost.id,...value});for(const key of costKeys){totals[key]+=value[key];if(!Number.isSafeInteger(totals[key]))fail();}
 }
 createNativeBudget(budgets,()=>0).reserve(totals);
 return {costs,totals,scenarioSha256:sha(scenario)};
}
const OBSERVATION_BINDINGS=['stepId','invocationId','processExit','executableSha256','requestCount','httpStatus','configSha256','scenarioSha256','authorityRecordSha256','principalId','agentId','workspaceId','processRecordSha256'];
export function validateNativeObservation(value,expected,cost){
 const keys=[...OBSERVATION_BINDINGS,'secretCount','recordSha256','usage'];
 return Boolean(value&&Object.keys(value).sort().join(',')===keys.sort().join(',')&&OBSERVATION_BINDINGS.every(key=>value[key]===expected[key])&&value.secretCount===0&&typeof value.recordSha256==='string'&&/^[a-f0-9]{64}$/.test(value.recordSha256)&&accounted(value.usage,cost));
}
const within=(parent,path)=>{const rel=relative(parent,path);return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../');};
/** Explicit trusted-host composition API. No adapter is bundled or config-loaded.
 * Adapter methods authorize/describe/prepare are pure; control/observe are the
 * only adapter effect boundaries and must enforce all declared upper bounds.
 * Full live acceptance and complete 380-case root assembly remain downstream. */
export async function executeNativeScenario(input,adapter){
 const methods=['authorize','describe','prepare','control','observe'];
 if(!adapter||methods.some(name=>typeof adapter[name]!=='function'))throw Error('NATIVE_AUTHORITY_UNAVAILABLE');
 const initial=validateNativeConfig(input),budget=createNativeBudget(initial.budgets);
 if(!['submitter','reviewer'].every(role=>initial.actors.some(actor=>actor.id===role)))throw Error('NATIVE_SUBJECT_REJECTED');
 const bounded=work=>withNativeDeadline(work,budget.remainingMs());
 let admitted,description;const scenario=getNativeScenario();
 if(scenario.steps.some(step=>step.requires?.includes('separate-explicit-fixture-store-authorization')&&!initial.fixture_stores.some(item=>item.fixture===step.fixture&&item.actor_slot===step.actor)))throw Error('NATIVE_FIXTURE_BINDINGS_UNAVAILABLE');
 try{admitted=await bounded(signal=>admitNativeRun(initial,{authorize:value=>adapter.authorize(value,{signal})}));description=await bounded(signal=>adapter.describe(structuredClone({config:initial,scenario}),{signal}));}
 catch{throw Error('NATIVE_ADMISSION_REJECTED');}
 const {config,configSha256}=admitted;const plan=prepareNativeExecution(scenario,config.budgets,description);budget.reserve(plan.totals);
 const subjects={config_sha256:configSha256,candidate_sha:config.candidate_sha,candidate_tree_sha:config.candidate_tree_sha,composition_sha256:config.composition_sha256,node_sha256:config.node.sha256,build_sha256:config.build.sha256,authority_record_sha256:config.authority_record_sha256,scenario_sha256:plan.scenarioSha256,actors_sha256:sha({actors:config.actors,fixture_stores:config.fixture_stores}),workspaces_sha256:sha(config.workspaces)};
 const runId='run_'+randomUUID().replaceAll('-',''),completed=[],protectedResults=[];let retainedArtifactBytes=null;
 const currentAuthority=async()=>{
  budget.remainingMs();const auth=await bounded(signal=>adapter.authorize(structuredClone({configSha256,config}),{signal}));
  if(!auth||Object.keys(auth).sort().join(',')!=='authorityRecordSha256,configSha256,expiresAt'||auth.configSha256!==configSha256||auth.authorityRecordSha256!==config.authority_record_sha256||!Number.isSafeInteger(auth.expiresAt)||auth.expiresAt<=Date.now()||auth.expiresAt>Date.now()+300000)throw Error('NATIVE_AUTHORITY_REJECTED');
  budget.remainingMs();return auth;
 };
 try{
  for(let i=0;i<scenario.steps.length;i++){
   const step=scenario.steps[i],cost=plan.costs[i];await currentAuthority();
   if(step.kind==='control'){
    const result=await bounded(signal=>adapter.control(structuredClone(step),{runId,cost:structuredClone(cost),remainingMs:budget.remainingMs(),completed:[...completed],signal}));
    // A host receipt is custody input, not a generic boolean proof of isolation.
    if(!result||Object.keys(result).sort().join(',')!=='authorityRecordSha256,configSha256,recordSha256,scenarioSha256,status,stepId,usage'||result.status!=='observed'||!accounted(result.usage,cost)||result.stepId!==step.id||result.configSha256!==configSha256||result.scenarioSha256!==plan.scenarioSha256||result.authorityRecordSha256!==config.authority_record_sha256||typeof result.recordSha256!=='string'||!/^[a-f0-9]{64}$/.test(result.recordSha256))throw Error('NATIVE_OBSERVER_INCOMPLETE');
    protectedResults.push({stepId:step.id,control:structuredClone(result)});completed.push(step.id);continue;
   }
   const prepared=await bounded(signal=>adapter.prepare(structuredClone(step),{completed:[...completed],signal,readPriorOutput(id){const prior=protectedResults.find(item=>item.stepId===id);if(!prior?.process||!completed.includes(id))throw Error('NATIVE_SUBJECT_REJECTED');const output=prior.process.readCapturedOutput();return {stdout:Buffer.from(output.stdout),stderr:Buffer.from(output.stderr)};}}));
   if(!prepared||Object.keys(prepared).sort().join(',')!=='artifactBytes,refs'||!Number.isSafeInteger(prepared.artifactBytes)||prepared.artifactBytes<0||prepared.artifactBytes>cost.artifact_bytes)throw Error('NATIVE_SUBJECT_REJECTED');
   const refs=prepared.refs;
   const actor=config.fixture_stores.find(item=>item.fixture===step.fixture&&item.actor_slot===step.actor)??config.actors.find(item=>item.id===step.actor);
   if(!actor||refs?.state_directory!==actor.state_directory||refs.origin!==undefined&&refs.origin!==config.origin||refs.workspace!==undefined&&refs.workspace!==(['probe/wrong-workspace','probe/server-foreign-workspace'].includes(step.id)?config.workspaces.foreign:config.workspaces.primary))throw Error('NATIVE_SUBJECT_REJECTED');
   for(const key of ['input_file','source_file','output_file'])if(refs[key]&&!within(config.fixture_directory,refs[key]))throw Error('NATIVE_SUBJECT_REJECTED');
   const args=buildNativeInvocation(step.id,refs);
   if(step.requires?.includes('nonempty-artifact-source-at-most-10MiB')){const st=lstatSync(refs.source_file);if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size!==prepared.artifactBytes)throw Error('NATIVE_SUBJECT_REJECTED');retainedArtifactBytes=st.size;}
   else if(['stageArtifact','uploadArtifactContent','commitArtifact','downloadArtifactContent'].includes(step.operation)){if(retainedArtifactBytes===null||prepared.artifactBytes!==retainedArtifactBytes||cost.artifact_bytes<retainedArtifactBytes)throw Error('NATIVE_SUBJECT_REJECTED');}
   else if(prepared.artifactBytes!==0)throw Error('NATIVE_SUBJECT_REJECTED');
   await currentAuthority();
   inspectNativeDirectory(config.output_directory);inspectNativeDirectory(actor.state_directory);
   const invocationId='inv_'+randomUUID().replaceAll('-',''),directory=join(config.output_directory,invocationId);mkdirSync(directory,{mode:0o700});
   const processResult=await runOwnedProcess({nodePath:config.node.path,entryPath:config.build.path,args:[...args],cwd:dirname(config.build.path),env:{TZ:'UTC',LANG:'C.UTF-8'},receiptDirectory:directory,timeoutMs:Math.max(1,Math.floor(Math.min(300000,budget.remainingMs()))),maxOutputBytes:cost.output_bytes,invocationId,nodeSha256:config.node.sha256,entrySha256:config.build.sha256,subjects});
   protectedResults.push({stepId:step.id,invocationId,process:processResult});
   if(processResult.status!=='terminal'||processResult.reason!=='exit'||processResult.exitCode!==step.expectedExit||processResult.truncated)throw Error('NATIVE_PROCESS_UNCERTAIN');
   const capture=processResult.readCapturedOutput();
   if(!capture.custody.final||Object.values(capture.custody.transcripts).some(item=>!item.complete))throw Error('NATIVE_PROCESS_UNCERTAIN');
   const processRecordSha256=capture.custody.final.sha256;
   const expected={stepId:step.id,invocationId,processExit:processResult.exitCode,executableSha256:config.build.sha256,requestCount:step.expectedRequests,httpStatus:step.expectedStatus??null,configSha256,scenarioSha256:plan.scenarioSha256,authorityRecordSha256:config.authority_record_sha256,principalId:actor.principal_id,agentId:actor.agent_id,workspaceId:refs.workspace??config.workspaces.primary,processRecordSha256};
   await currentAuthority();
   const observation=await bounded(signal=>adapter.observe(structuredClone(step),{invocationId,processResult,refs:structuredClone(refs),subjects:structuredClone(subjects),remainingMs:budget.remainingMs(),cost:structuredClone(cost),signal}));
   if(!validateNativeObservation(observation,expected,cost))throw Error('NATIVE_OBSERVER_INCOMPLETE');
   protectedResults.at(-1).observation=structuredClone(observation);completed.push(step.id);
  }
  budget.remainingMs();
 }catch{
  const result={status:'incomplete',scope:'producer-fragment',issue48Complete:false,externalRequirements:scenario.externalRequirements.map(item=>item.id),acceptance:'pending-external-inspection',completedSteps:completed.length,plannedSteps:scenario.steps.length,runId,retryAllowed:false,cleanup:'not-attempted'};
  Object.defineProperty(result,'readProtectedResults',{enumerable:false,value:()=>protectedResults});return result;
 }
 const result={status:'observed',scope:'producer-fragment',issue48Complete:false,externalRequirements:scenario.externalRequirements.map(item=>item.id),acceptance:'pending-external-inspection',completedSteps:completed.length,plannedSteps:scenario.steps.length,runId,retryAllowed:false,cleanup:'not-attempted'};
 Object.defineProperty(result,'readProtectedResults',{enumerable:false,value:()=>protectedResults});return result;
}
