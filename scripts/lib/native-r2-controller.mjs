import {selectNativeExecutionProfile} from './native-execution-profile.mjs';
import {requireCompleteCapabilities} from './native-complete-profile.mjs';
import {snapshotNativeSessionAdapter,createNativeRunContext,createCompleteNativeRunContext,validateNativeSessionPlan,reserveNativeCombinedBudget,createNativeSessionOwner} from './native-r2-session.mjs';
import {createNativeInputWriter} from './native-r2-input-writer.mjs';
import {createNativeInputAdmission} from './native-r2-input.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,lstatSync} from 'node:fs';
import {join,dirname,relative,isAbsolute} from 'node:path';
import {admitNativeRun,admitCompleteNativeRun,inspectNativeDirectory} from './native-r2-admission.mjs';
import {createNativeBudget,withNativeDeadline} from './native-r2-budget.mjs';
import {validateNativeConfig} from './native-r2-config.mjs';
import {getNativeScenario,buildNativeInvocation,buildPinnedNativeInvocation} from './native-r2-scenario.mjs';
import {runOwnedProcess} from './native-r2-process.mjs';
import {createNativeBindingRegistry,createCompleteNativeBindingRegistry} from './native-r2-bindings.mjs';
import {nativeOutputVerificationPlan,verifyNativeCapturedOutput} from './native-r2-projection.mjs';
import {readNativeProcessOriginals} from './native-r2-original-reader.mjs';
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
const auxiliarySteps=['prepare/fail-create','prepare/revoke-own-positive'];
const typedSteps=()=>getNativeScenario().steps.filter(s=>s.caseId||auxiliarySteps.includes(s.id)||s.id==='control/revoke-submitter').map(s=>s.id);
function dataObject(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype)fail();const ds=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!Object.hasOwn(ds,k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))fail();return Object.fromEntries(keys.map(k=>[k,ds[k].value]));}
/** Detach the originally committed generic receipt before later awaited host work. */
export function snapshotNativeGenericReceipt(kind,value){
 const keys=kind==='control'?['authorityRecordSha256','configSha256','recordSha256','scenarioSha256','status','stepId','usage']:kind==='observation'?['stepId','invocationId','processExit','executableSha256','requestCount','httpStatus','configSha256','scenarioSha256','authorityRecordSha256','principalId','agentId','workspaceId','processRecordSha256','secretCount','recordSha256','usage']:null;
 if(!keys)fail();const row=dataObject(value,keys),usage=dataObject(row.usage,costKeys);
 for(const key of keys)if(key!=='usage'&&row[key]!==null&&!['string','number','boolean'].includes(typeof row[key]))fail();
 for(const key of costKeys)if(!Number.isSafeInteger(usage[key])||usage[key]<0)fail();
 return Object.freeze({...row,usage:Object.freeze(usage)});
}
/** Compare an actual controller reader receipt to its private source plan; not host authority. */
export function validateNativePlannedInput(plan,input){
 if(plan===null){if(input!==null)throw Error('NATIVE_INPUT_PLAN_REJECTED');return;}
 const p=dataObject(plan,['body','json','sha256','byteSize']),v=dataObject(input,['body','sha256','byteSize']);
 if(typeof p.json!=='string'||p.json.length>65536||!Number.isSafeInteger(p.byteSize)||p.byteSize<1||p.byteSize>65536||Buffer.byteLength(p.json)!==p.byteSize||typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256)||createHash('sha256').update(p.json).digest('hex')!==p.sha256||v.sha256!==p.sha256||v.byteSize!==p.byteSize)throw Error('NATIVE_INPUT_PLAN_REJECTED');
}
/** Explicit evidence-only costs. No fallback zeros or inferred host cost. */
export function prepareNativeEvidenceExecution(budgets,reservations){
 const ids=[...typedSteps(),'evidence/assembly'];if(ids.length!==41||!Array.isArray(reservations)||Object.getPrototypeOf(reservations)!==Array.prototype||reservations.length!==ids.length)fail();
 const ds=Object.getOwnPropertyDescriptors(reservations);if(Reflect.ownKeys(ds).length!==ids.length+1)fail();const totals=Object.fromEntries(costKeys.map(k=>[k,0]));
 const costs=ids.map((id,index)=>{if(!ds[index]||!Object.hasOwn(ds[index],'value'))fail();const row=dataObject(ds[index].value,['id',...costKeys]);if(row.id!==id||costKeys.some(k=>!Number.isSafeInteger(row[k])||row[k]<0)||row.output_bytes<1)fail();if(id==='evidence/assembly'&&(row.commands!==1||row.mutations!==0||row.artifact_bytes!==0))fail();for(const k of costKeys){totals[k]+=row[k];if(!Number.isSafeInteger(totals[k]))fail();}return {...row};});
 createNativeBudget(budgets,()=>0).reserve(totals);return {costs,totals};
}
/** Actual returned original bytes must fit the specifically assigned evidence cost. */
export function validateNativeTypedReturn(value,cost,maxBytes){
 const outer=dataObject(value,['record','usage']),record=dataObject(outer.record,['id','sha256','bytes']),usage=dataObject(outer.usage,costKeys);
 if(!accounted(usage,cost)||typeof record.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(record.id)||typeof record.sha256!=='string'||!/^[a-f0-9]{64}$/.test(record.sha256)||!(record.bytes instanceof Uint8Array)||![Uint8Array.prototype,Buffer.prototype].includes(Object.getPrototypeOf(record.bytes)))fail();
 const proto=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(proto,'byteLength').get.call(record.bytes),buffer=Object.getOwnPropertyDescriptor(proto,'buffer').get.call(record.bytes);
 if(Object.getPrototypeOf(buffer)!==ArrayBuffer.prototype||Reflect.ownKeys(record.bytes).some(k=>typeof k!=='string'||!/^\d+$/.test(k))||!Number.isSafeInteger(maxBytes)||length<1||length>65536||length>maxBytes||usage.output_bytes<length)fail();
 const bytes=new Uint8Array(length);Uint8Array.prototype.set.call(bytes,record.bytes);return {record:{id:record.id,sha256:record.sha256,bytes:Buffer.from(bytes.buffer)},usage};
}
export {validateNativeObservation} from './native-r2-observation.mjs';
import {validateNativeObservation} from './native-r2-observation.mjs';
/** Capture only validated data descriptors before any awaited host work. */
export function snapshotNativeRefs(stepId,value){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)throw Error('NATIVE_SUBJECT_REJECTED');
 const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);
 if(keys.length>32||keys.some(k=>typeof k!=='string'||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))throw Error('NATIVE_SUBJECT_REJECTED');
 const copy=Object.fromEntries(keys.map(k=>[k,ds[k].value]));buildNativeInvocation(stepId,copy);return Object.freeze(copy);
}
const within=(parent,path)=>{const rel=relative(parent,path);return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../');};
/** Explicit trusted-host composition API. No adapter is bundled or config-loaded.
 * Adapter methods authorize/describe/prepare are pure. Explicit hostVersion2
 * adds pure full-roster planning and owned open/close boundaries after combined
 * reservation and existing custody admission. Control/observe retain their bounds.
 * Full live acceptance and complete 380-case root assembly remain downstream. */
export function executeNativeScenario(input,adapter,evidenceContext=null){return executeScenario(input,adapter,evidenceContext,false);}
export function executeCompleteNativeScenario(input,adapter,evidenceContext=null){return executeScenario(input,adapter,evidenceContext,true);}
async function executeScenario(input,adapter,evidenceContext,complete){
 const lifetime={owner:null};let result,failure,didThrow=false;
 try{result=await executeNativeScenarioOwned(input,adapter,evidenceContext,lifetime,complete);}catch(error){didThrow=true;failure=error;}
 if(lifetime.owner){
  const cleanup=await lifetime.owner.close();
  if(didThrow){try{if(failure&&(typeof failure==='object'||typeof failure==='function')&&Object.isExtensible(failure))Object.defineProperty(failure,'readSessionCleanup',{value:()=>({...cleanup}),enumerable:false});}catch{/* Preserve the original rejection even when its object cannot carry diagnostics. */}}
  else{result.executionStatus=result.status;result.cleanup=cleanup.status;if(cleanup.status!=='closed'&&cleanup.status!=='not-opened')result.status='incomplete';Object.defineProperty(result,'readSessionCleanup',{value:()=>({...cleanup}),enumerable:false});}
 }
 if(didThrow)throw failure;return result;
}
async function executeNativeScenarioOwned(input,adapter,evidenceContext,lifetime,complete){
 const selected=complete?selectNativeExecutionProfile(input):null;
 if(complete){if(selected.config.version!==2)fail();if(selected.profile.unavailable.length)requireCompleteCapabilities();}
 const methods=['authorize','describe','prepare','control','observe'];
 if(!adapter||(typeof adapter!=='object'&&typeof adapter!=='function'))throw Error('NATIVE_AUTHORITY_UNAVAILABLE');
 const sessionAdapter=snapshotNativeSessionAdapter(adapter);
 if(complete&&!sessionAdapter)throw Error('NATIVE_SESSION_REJECTED');
 if(methods.some(name=>typeof adapter[name]!=='function'))throw Error('NATIVE_AUTHORITY_UNAVAILABLE');
 const initial=complete?selected.config:validateNativeConfig(input),budget=createNativeBudget(initial.budgets);
 const runId='run_'+randomUUID().replaceAll('-','');let recorder=null;
 if(evidenceContext!==null){
  try{
   if(!evidenceContext||Object.getPrototypeOf(evidenceContext)!==Object.prototype)throw Error();
   const keys=['environment_id','config_epoch','observer_id','source_inventory'],ds=Object.getOwnPropertyDescriptors(evidenceContext);
   if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!Object.hasOwn(ds,k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))throw Error();
   const {createNativeCaseRecorder,createCompleteNativeCaseRecorder}=await import('./native-r2-recorder.mjs');
   recorder=(complete?createCompleteNativeCaseRecorder:createNativeCaseRecorder)({config:initial,context:{run_id:runId,...Object.fromEntries(keys.map(k=>[k,ds[k].value]))}});
  }catch{throw Error('NATIVE_EVIDENCE_CONTEXT_REJECTED');}
  if(['prepareEvidence','observeEvidence','observeAuxiliaryEvidence','observeDisableEvidence','describeEvidence'].some(name=>typeof adapter[name]!=='function'))throw Error('NATIVE_EVIDENCE_AUTHORITY_UNAVAILABLE');
 }

 if(!['submitter','reviewer'].every(role=>initial.actors.some(actor=>actor.id===role)))throw Error('NATIVE_SUBJECT_REJECTED');
 const bounded=work=>withNativeDeadline(work,budget.remainingMs());
 let admitted,description,evidenceDescription;const scenario=complete?selected.scenario:getNativeScenario();
 const runContext=sessionAdapter?(complete?createCompleteNativeRunContext(initial,runId):createNativeRunContext(initial,runId,scenario)):null;
 const hostOptions=signal=>({signal,...(runContext?{runContext}: {})});
 if(scenario.steps.some(step=>step.requires?.includes('separate-explicit-fixture-store-authorization')&&!initial.fixture_stores.some(item=>item.fixture===step.fixture&&item.actor_slot===step.actor)))throw Error('NATIVE_FIXTURE_BINDINGS_UNAVAILABLE');
 let plan,evidencePlan;
 if(sessionAdapter){
  const proposed=await bounded(signal=>sessionAdapter.planSession(runContext,{scenario:structuredClone(scenario),signal}));
  const sessionCost=validateNativeSessionPlan(proposed,runContext,scenario);
  description=await bounded(signal=>adapter.describe(structuredClone({config:initial,scenario}),hostOptions(signal)));
  if(recorder)evidenceDescription=await bounded(signal=>adapter.describeEvidence(structuredClone({config:initial,scenario}),hostOptions(signal)));
  plan=prepareNativeExecution(scenario,initial.budgets,description);evidencePlan=recorder?prepareNativeEvidenceExecution(initial.budgets,evidenceDescription):null;
  reserveNativeCombinedBudget(budget,[plan.totals,...(evidencePlan?[evidencePlan.totals]:[]),...(recorder?[nativeOutputVerificationPlan().cost]:[]),sessionCost]);
  try{admitted=await bounded(signal=>(complete?admitCompleteNativeRun:admitNativeRun)(initial,{authorize:value=>adapter.authorize(value,hostOptions(signal))}));}catch{throw Error('NATIVE_ADMISSION_REJECTED');}
  lifetime.owner=createNativeSessionOwner(runContext,sessionAdapter);
 }else{
  try{admitted=await bounded(signal=>(complete?admitCompleteNativeRun:admitNativeRun)(initial,{authorize:value=>adapter.authorize(value,{signal})}));description=await bounded(signal=>adapter.describe(structuredClone({config:initial,scenario}),{signal}));if(recorder)evidenceDescription=await bounded(signal=>adapter.describeEvidence(structuredClone({config:initial,scenario}),{signal}));}
  catch{throw Error('NATIVE_ADMISSION_REJECTED');}
  plan=prepareNativeExecution(scenario,admitted.config.budgets,description);evidencePlan=recorder?prepareNativeEvidenceExecution(admitted.config.budgets,evidenceDescription):null;budget.reserve(plan.totals);if(evidencePlan)budget.reserve(evidencePlan.totals);if(recorder)budget.reserve(nativeOutputVerificationPlan().cost);
 }
 const {config,configSha256}=admitted;const evidenceCosts=new Map(evidencePlan?.costs.map(row=>[row.id,Object.fromEntries(costKeys.map(k=>[k,row[k]]))])??[]);
 const subjects={config_sha256:configSha256,candidate_sha:config.candidate_sha,candidate_tree_sha:config.candidate_tree_sha,composition_sha256:config.composition_sha256,node_sha256:config.node.sha256,build_sha256:config.build.sha256,authority_record_sha256:config.authority_record_sha256,scenario_sha256:plan.scenarioSha256,actors_sha256:sha({actors:config.actors,fixture_stores:config.fixture_stores}),workspaces_sha256:sha(config.workspaces)};
 const bindingActor=role=>{const actor=config.actors.find(item=>item.id===role);return {principalId:actor.principal_id,agentId:actor.agent_id};};
 const bindings=complete?createCompleteNativeBindingRegistry({config}):createNativeBindingRegistry({workspaceId:config.workspaces.primary,submitter:bindingActor('submitter'),reviewer:bindingActor('reviewer')});
 const inputs=createNativeInputAdmission(),writer=createNativeInputWriter({fixtureDirectory:config.fixture_directory});budget.remainingMs();
 const completed=[],protectedResults=[];let retainedArtifactBytes=null,assembled=null;
 const attachEvidence=result=>{Object.defineProperty(result,'readProtectedInputPublications',{enumerable:false,value:()=>writer.readProtectedSummary()});Object.defineProperty(result,'readProtectedInputAdmissions',{enumerable:false,value:()=>inputs.readProtectedSummary()});Object.defineProperty(result,'readProtectedBindings',{enumerable:false,value:()=>bindings.readSummary()});if(recorder)Object.defineProperty(result,'readProtectedEvidence',{enumerable:false,value:()=>({durability:'memory-only',status:assembled?.result.status??'partial-originals-pending',context:recorder.readProtectedContext(),records:recorder.readProtectedRecords(),assembly:assembled?structuredClone(assembled):null})});return result;};
 const currentAuthority=async()=>{
  budget.remainingMs();const auth=await bounded(signal=>adapter.authorize(structuredClone({configSha256,config}),hostOptions(signal)));
  if(!auth||Object.keys(auth).sort().join(',')!=='authorityRecordSha256,configSha256,expiresAt'||auth.configSha256!==configSha256||auth.authorityRecordSha256!==config.authority_record_sha256||!Number.isSafeInteger(auth.expiresAt)||auth.expiresAt<=Date.now()||auth.expiresAt>Date.now()+300000)throw Error('NATIVE_AUTHORITY_REJECTED');
  budget.remainingMs();return auth;
 };
 try{
  if(lifetime.owner)await lifetime.owner.open(budget.remainingMs());
  for(let i=0;i<scenario.steps.length;i++){
   const step=scenario.steps[i],cost=plan.costs[i];await currentAuthority();
   if(step.kind==='control'){
    const bindingToken=bindings.prepare(step.id);
    const disableToken=recorder&&step.id==='control/revoke-submitter'?recorder.beginDisable():null;
    const result=snapshotNativeGenericReceipt('control',await bounded(signal=>adapter.control(structuredClone(step),{runId,cost:structuredClone(cost),remainingMs:budget.remainingMs(),completed:[...completed],...(disableToken?{captureFacts:recorder.captureFacts(disableToken)}:{}),signal})));
    // A host receipt is custody input, not a generic boolean proof of isolation.
    if(!result||Object.keys(result).sort().join(',')!=='authorityRecordSha256,configSha256,recordSha256,scenarioSha256,status,stepId,usage'||result.status!=='observed'||!accounted(result.usage,cost)||result.stepId!==step.id||result.configSha256!==configSha256||result.scenarioSha256!==plan.scenarioSha256||result.authorityRecordSha256!==config.authority_record_sha256||typeof result.recordSha256!=='string'||!/^[a-f0-9]{64}$/.test(result.recordSha256))throw Error('NATIVE_OBSERVER_INCOMPLETE');
    if(disableToken){
     await currentAuthority();const extra=evidenceCosts.get(step.id),maxBytes=Math.min(65536,extra.output_bytes,recorder.remainingBytes());if(maxBytes<1)throw Error('NATIVE_OBSERVER_INCOMPLETE');
     const supplied=await bounded(signal=>adapter.observeDisableEvidence(structuredClone(step),{runId,captureFacts:recorder.captureFacts(disableToken),expectedRecordSha256:result.recordSha256,cost:structuredClone(extra),maxBytes,signal}));
     const typed=validateNativeTypedReturn(supplied,extra,maxBytes);recorder.captureAcknowledgedDisable(disableToken,{record:typed.record,genericControl:result,cost});
    }
    bindings.completeControl(bindingToken,result);
    protectedResults.push({stepId:step.id,control:structuredClone(result)});completed.push(step.id);continue;
   }
   const requestInput=bindings.planRequestInput(step.id);
   const prepared=await bounded(signal=>adapter.prepare(structuredClone(step),{...(runContext?{runContext}:{}),completed:[...completed],requestInput:structuredClone(requestInput),signal,readPriorOutput(id){const prior=protectedResults.find(item=>item.stepId===id);if(!prior?.process||!completed.includes(id))throw Error('NATIVE_SUBJECT_REJECTED');const output=prior.process.readCapturedOutput();return {stdout:Buffer.from(output.stdout),stderr:Buffer.from(output.stderr)};}}));
   if(!prepared||Object.keys(prepared).sort().join(',')!=='artifactBytes,refs'||!Number.isSafeInteger(prepared.artifactBytes)||prepared.artifactBytes<0||prepared.artifactBytes>cost.artifact_bytes)throw Error('NATIVE_SUBJECT_REJECTED');
   const refs=snapshotNativeRefs(step.id,prepared.refs);
   const actor=config.fixture_stores.find(item=>item.fixture===step.fixture&&item.actor_slot===step.actor)??config.actors.find(item=>item.id===step.actor);
   if(!actor||refs?.state_directory!==actor.state_directory||refs.origin!==undefined&&refs.origin!==config.origin||refs.workspace!==undefined&&refs.workspace!==(['probe/wrong-workspace','probe/server-foreign-workspace'].includes(step.id)?config.workspaces.foreign:config.workspaces.primary))throw Error('NATIVE_SUBJECT_REJECTED');
   for(const key of ['input_file','source_file','output_file'])if(refs[key]&&!within(config.fixture_directory,refs[key]))throw Error('NATIVE_SUBJECT_REJECTED');
   budget.remainingMs();
   if(requestInput){await currentAuthority();writer.write(step.id,refs.input_file,requestInput);}
   let input=step.refKeys.includes('input_file')?inputs.read(step.id,refs.input_file):null;
   validateNativePlannedInput(requestInput,input);
   budget.remainingMs();
   const pin=input===null?null:Object.freeze({sha256:input.sha256,byteSize:input.byteSize});
   const bindingToken=bindings.prepareWithInput(step.id,refs,input);input=null;
   const args=buildPinnedNativeInvocation(step.id,refs,pin);let casePreparation=null,caseToken=null,ownedInvocation=null;
   if(step.requires?.includes('nonempty-artifact-source-at-most-10MiB')){const st=lstatSync(refs.source_file);if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size!==prepared.artifactBytes)throw Error('NATIVE_SUBJECT_REJECTED');retainedArtifactBytes=st.size;}
   else if(['stageArtifact','uploadArtifactContent','commitArtifact','downloadArtifactContent'].includes(step.operation)){if(retainedArtifactBytes===null||prepared.artifactBytes!==retainedArtifactBytes||cost.artifact_bytes<retainedArtifactBytes)throw Error('NATIVE_SUBJECT_REJECTED');}
   else if(prepared.artifactBytes!==0)throw Error('NATIVE_SUBJECT_REJECTED');
   await currentAuthority();
   inspectNativeDirectory(config.output_directory);inspectNativeDirectory(actor.state_directory);
   if(recorder&&(step.caseId||auxiliarySteps.includes(step.id))){
    const supplied=await bounded(signal=>adapter.prepareEvidence(structuredClone(step),{refs:structuredClone(refs),runId,context:recorder.readProtectedContext(),signal}));
    if(!supplied||Object.getPrototypeOf(supplied)!==Object.prototype)throw Error('NATIVE_OBSERVER_INCOMPLETE');
    const ds=Object.getOwnPropertyDescriptors(supplied);if(Reflect.ownKeys(ds).length!==2||['subject','record_source_id'].some(k=>!Object.hasOwn(ds,k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))throw Error('NATIVE_OBSERVER_INCOMPLETE');
    casePreparation=recorder.preparePinned(step.id,{subject:ds.subject.value,record_source_id:ds.record_source_id.value,refs,pin});ownedInvocation=casePreparation.readInvocation();if(canonicalCaseSubject(ownedInvocation.args)!==canonicalCaseSubject(args))throw Error('NATIVE_INVOCATION_PIN_REJECTED');
    await currentAuthority();
   }
   const invocationId='inv_'+randomUUID().replaceAll('-',''),directory=join(config.output_directory,invocationId);mkdirSync(directory,{mode:0o700});
   if(casePreparation)caseToken=step.caseId?recorder.begin(step.id):recorder.beginAuxiliary(step.id);
   const processResult=await runOwnedProcess({nodePath:config.node.path,entryPath:config.build.path,args:[...args],cwd:ownedInvocation?.cwd??dirname(config.build.path),env:ownedInvocation?.env??{TZ:'UTC',LANG:'C.UTF-8'},receiptDirectory:directory,timeoutMs:Math.max(1,Math.floor(Math.min(300000,budget.remainingMs()))),maxOutputBytes:cost.output_bytes,invocationId,nodeSha256:config.node.sha256,entrySha256:config.build.sha256,subjects});
   protectedResults.push({stepId:step.id,invocationId,process:processResult});
   if(processResult.status!=='terminal'||processResult.reason!=='exit'||processResult.exitCode!==step.expectedExit||processResult.truncated)throw Error('NATIVE_PROCESS_UNCERTAIN');
   // Detach owned bytes and custody before awaited host observers can inspect the process accessor.
   const ownedCapture=processResult.readCapturedOutput();
   const capture={stdout:Buffer.from(ownedCapture.stdout),stderr:Buffer.from(ownedCapture.stderr),custody:structuredClone(ownedCapture.custody)};
   if(!capture.custody.final||Object.values(capture.custody.transcripts).some(item=>!item.complete))throw Error('NATIVE_PROCESS_UNCERTAIN');
   const processRecordSha256=capture.custody.final.sha256;
   const expected={stepId:step.id,invocationId,processExit:processResult.exitCode,executableSha256:config.build.sha256,requestCount:step.expectedRequests,httpStatus:step.expectedStatus??null,configSha256,scenarioSha256:plan.scenarioSha256,authorityRecordSha256:config.authority_record_sha256,principalId:actor.principal_id,agentId:actor.agent_id,workspaceId:refs.workspace??config.workspaces.primary,processRecordSha256};
   await currentAuthority();
   let processOriginals=null,outputVerification=null;
   if(caseToken){
    const custody={prepared:capture.custody.prepared,spawned:capture.custody.spawned,final:capture.custody.final};
    const allowance=recorder.reserveProcessRead(caseToken,invocationId,custody);
    const read=readNativeProcessOriginals({outputDirectory:config.output_directory,invocationId,custody:allowance.custody,remainingBytes:allowance.totalBytes});
    processOriginals=read.readProtectedRecords().map(({id,sha256,bytes})=>({id,sha256,bytes}));
    outputVerification=verifyNativeCapturedOutput({stepId:step.id,invocationId,runId,finalOriginal:processOriginals.find(record=>record.id===invocationId+'_final'),expectedSubjects:subjects,stdout:capture.stdout,stderr:capture.stderr,maxOutputBytes:cost.output_bytes});
    protectedResults.at(-1).outputVerification=outputVerification;
    if(outputVerification.status!=='syntax-verified')throw Error('NATIVE_OUTPUT_SYNTAX_REJECTED');
    await currentAuthority();
   }
   const observation=snapshotNativeGenericReceipt('observation',await bounded(signal=>adapter.observe(structuredClone(step),{invocationId,processResult,refs:structuredClone(refs),subjects:structuredClone(subjects),remainingMs:budget.remainingMs(),cost:structuredClone(cost),...(caseToken?{captureFacts:recorder.captureFacts(caseToken),readOutputVerification:()=>outputVerification.readVerificationOriginal()}:{}),signal})));
   if(!validateNativeObservation(observation,expected,cost))throw Error('NATIVE_OBSERVER_INCOMPLETE');
   if(caseToken){
    await currentAuthority();
    const extra=evidenceCosts.get(step.id),maxBytes=Math.min(65536,extra.output_bytes,recorder.remainingBytes());if(maxBytes<1)throw Error('NATIVE_OBSERVER_INCOMPLETE');
    const evidenceOptions={readOutputVerification:()=>outputVerification.readVerificationOriginal(),runId,context:recorder.readProtectedContext(),captureFacts:recorder.captureFacts(caseToken),expectedRecordSha256:observation.recordSha256,preparation:{recordId:casePreparation.recordId,sha256:casePreparation.sha256},invocationId,processRecordSha256,genericObservation:structuredClone(observation),cost:structuredClone(extra),maxBytes};
    const supplied=await bounded(signal=>step.caseId?adapter.observeEvidence(structuredClone(step),{...evidenceOptions,signal}):adapter.observeAuxiliaryEvidence(structuredClone(step),{...evidenceOptions,signal}));
    const typed=validateNativeTypedReturn(supplied,extra,maxBytes),original=typed.record;
    const originals=processOriginals;
    const completion={records:[...originals,original],processPreparedId:invocationId+'_prepared',processSpawnedId:invocationId+'_spawned',processFinalId:invocationId+'_final',observerId:original.id,genericObservation:observation,cost};
    const recorded=step.caseId?recorder.finish(caseToken,completion):recorder.finishAuxiliary(caseToken,completion);
    protectedResults.at(-1).evidence=recorded;
   }
   bindings.completeProcess(bindingToken,{invocationId,exitCode:processResult.exitCode,stdout:capture.stdout,stderr:capture.stderr,custody:capture.custody,maxOutputBytes:cost.output_bytes});
   protectedResults.at(-1).observation=structuredClone(observation);completed.push(step.id);
  }
  budget.remainingMs();
  if(recorder){await currentAuthority();const cost=evidenceCosts.get('evidence/assembly'),candidate=recorder.assemble({outputBytes:cost.output_bytes});budget.remainingMs();if(!accounted(candidate.usage,cost)||candidate.result.status!=='structural-fragment')throw Error('NATIVE_OBSERVER_INCOMPLETE');assembled=candidate;}
 }catch{
  const result={status:'incomplete',scope:'producer-fragment',issue48Complete:false,externalRequirements:scenario.externalRequirements.map(item=>item.id),acceptance:'pending-external-inspection',completedSteps:completed.length,plannedSteps:scenario.steps.length,runId,retryAllowed:false,cleanup:'not-attempted'};
  Object.defineProperty(result,'readProtectedResults',{enumerable:false,value:()=>protectedResults});return attachEvidence(result);
 }
 const result={status:'observed',scope:'producer-fragment',issue48Complete:false,externalRequirements:scenario.externalRequirements.map(item=>item.id),acceptance:'pending-external-inspection',completedSteps:completed.length,plannedSteps:scenario.steps.length,runId,retryAllowed:false,cleanup:'not-attempted'};
 Object.defineProperty(result,'readProtectedResults',{enumerable:false,value:()=>protectedResults});return attachEvidence(result);
}
