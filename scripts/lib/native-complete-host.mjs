/** Fixed complete-profile orchestration. Configuration never selects executable
 * owners. Source-core injection is explicitly non-authoritative test plumbing. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {join} from 'node:path';
import {COMPLETE_HOST_SOURCE_INVENTORY} from '#native-complete-source-inventory';
import {resolveCompleteHostContext,assertCompleteInstallationCurrent} from './native-host-v2-custody.mjs';
import {deriveInstalledCompletePolicy,createCompletePolicyFraming} from './native-complete-policy-bootstrap.mjs';
import {createCompleteHttpsClient} from './native-complete-https.mjs';
import {createCompleteBootstrap} from '../../packages/cli/src/complete-bootstrap.ts';
import {readCompleteStoreObservation} from '../../packages/cli/src/complete-store-observation.ts';
import {observeCompleteHostJournal,observeCompleteUploadSource,observeCompleteUnsentJournal} from '../../packages/cli/src/complete-host-observation.ts';
import {executeCompleteNativeScenario} from './native-r2-controller.mjs';
import {readNativeProcessOriginals} from './native-r2-original-reader.mjs';
import {validateCompleteConfig} from './native-complete-config.mjs';
import {selectCompleteProfile} from './native-profile-selection.mjs';
import {requireCompleteCapabilities} from './native-complete-profile.mjs';
import {createCompletePreparationOwner} from './native-complete-preparation-builder.mjs';
import {createSourceCompleteHostTwinOwner} from './native-complete-host-twins.mjs';
import {deriveCompleteFixtureContext} from './native-complete-fixture-context.mjs';
import {createCompleteNativeRunContext} from './native-r2-session.mjs';
import {completeCallSchedule} from './native-complete-call-owner.mjs';
import {completeSlotRegistry,completePolicyDigest,snapshotCompleteValue,freezeCompleteValue} from './native-complete-protocol.mjs';
import {completeClientFields as fields} from './native-complete-client-proof.mjs';
import {verifyCompleteOriginal} from './native-complete-original-wire.mjs';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {parseNativeCliOutput} from './native-cli-output.mjs';
import {assembleCompleteNativeReport} from './native-complete-report.mjs';
import {nativeOutputVerificationPlan} from './native-r2-projection.mjs';
import {nativeSourceInventoryDigest} from './native-r2-evidence.mjs';
const reject=()=>{throw Error('NATIVE_COMPLETE_HOST_REJECTED');};
const check=v=>{if(!v)reject();};
const hash=v=>createHash('sha256').update(v).digest('hex');
const sha=v=>hash(canonical(v));
const same=(a,b)=>canonical(a)===canonical(b);
const costKeys=['commands','mutations','artifact_bytes','output_bytes'];
const zero=()=>({commands:0,mutations:0,artifact_bytes:0,output_bytes:0});
const snapshot=(v,max=65536)=>freezeCompleteValue(snapshotCompleteValue(v,max));
const typed=s=>Boolean(s.caseId)||['prepare/fail-create','prepare/revoke-own-positive'].includes(s.id);
const artifactSteps=new Set(['stageArtifact','uploadArtifactContent','commitArtifact','downloadArtifactContent']);
const bytePrototype=Object.getPrototypeOf(Uint8Array.prototype),byteSize=Object.getOwnPropertyDescriptor(bytePrototype,'byteLength').get,byteBacking=Object.getOwnPropertyDescriptor(bytePrototype,'buffer').get,byteOffset=Object.getOwnPropertyDescriptor(bytePrototype,'byteOffset').get;
function originalBytes(value,remaining){
 check(value&&!types.isProxy(value)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(value)));
 const size=byteSize.call(value),backing=byteBacking.call(value);check(size>0&&size<=65536&&size<=remaining&&Object.getPrototypeOf(backing)===ArrayBuffer.prototype);
 check(Reflect.ownKeys(value).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)));
 return Buffer.from(new Uint8Array(backing,byteOffset.call(value),size));
}
function evidenceSnapshot(value){
 const v=fields(value,['environment_id','config_epoch','observer_id','source_inventory']),rows=v.source_inventory;check(rows&&!types.isProxy(rows)&&Array.isArray(rows)&&Object.getPrototypeOf(rows)===Array.prototype);
 const ds=Object.getOwnPropertyDescriptors(rows),n=ds.length?.value;check(Number.isSafeInteger(n)&&n>0&&n<=2048&&Reflect.ownKeys(ds).length===n+1);
 const inventory=[];let bytes=2;for(let i=0;i<n;i++){check(ds[i]?.enumerable&&Object.hasOwn(ds[i],'value'));const row=snapshot(fields(ds[i].value,['path','sha256','byte_size','mode']),2048);bytes+=Buffer.byteLength(canonical(row))+(i?1:0);check(bytes<=4194304);inventory.push(row);}
 nativeSourceInventoryDigest(inventory);return Object.freeze({...snapshot({environment_id:v.environment_id,config_epoch:v.config_epoch,observer_id:v.observer_id},2048),source_inventory:Object.freeze(inventory)});
}
function functions(value,names){const result=fields(value,names);for(const fn of Object.values(result))check(typeof fn==='function'&&!types.isProxy(fn));return Object.freeze(result);}
const ownerNames=['assertCurrent','derivePolicy','createClient','createBootstrap','readStore','readProcessOriginals','readJournal','readUpload','readUnsent','runScenario'];

/** Public bundle boundary: invalid config fails before any protected access.
 * The exact-byte-verified bundle owns both the resolver and its WeakMap brand. */
export async function executeFixedCompleteHost(input){
 try{
  const config=validateCompleteConfig(input);if(config.profile==='native-r2-complete-prepared-v1')requireCompleteCapabilities();
  const context=resolveCompleteHostContext({config,sourceInventory:COMPLETE_HOST_SOURCE_INVENTORY});
  const current=()=>assertCompleteInstallationCurrent(context.binding);
  return await executeSourceCompleteHostCore({config,context},{
   assertCurrent:current,
   derivePolicy:runId=>deriveInstalledCompletePolicy({binding:context.binding,runId}),
   createClient:(policy,validationOptions)=>createCompleteHttpsClient({binding:context.binding,policy,validationOptions}),
   createBootstrap:(plan,wiring)=>createCompleteBootstrap(plan,wiring),
   readStore:input=>readCompleteStoreObservation(input,{assertCurrent:current}),
   readProcessOriginals:input=>readNativeProcessOriginals(input),
   readJournal:input=>observeCompleteHostJournal(input),
   readUpload:input=>observeCompleteUploadSource(input),
   readUnsent:input=>observeCompleteUnsentJournal(input),
   runScenario:(config,adapter,evidenceContext)=>executeCompleteNativeScenario(config,adapter,evidenceContext),
  });
 }catch{reject();}
}

/** Source-only owner injection; not exported by the fixed bundle entry. A caller
 * supplied context is NOT an installed binding. No source success upgrades the
 * existing structural-only report or exposes private transcripts/materials. */
export async function executeSourceCompleteHostCore(input,ownerInput){
 const a=fields(input,['config','context']),owners=fields(ownerInput,ownerNames);
 for(const name of ownerNames)check(typeof owners[name]==='function'&&!types.isProxy(owners[name]));
 const config=validateCompleteConfig(a.config);if(config.profile==='native-r2-complete-prepared-v1')requireCompleteCapabilities();
 const selected=selectCompleteProfile(config.profile),scenario=selected.scenario;
 const context=fields(a.context,['binding','materials','evidenceContext','hostSha256']);
 const m=fields(context.materials,['statement','config','subjects','inputs','clientAuth','credentials','human','humanSha256','anchorBase64','descriptorBase64','authority']);
 const materials={...m,statement:snapshot(m.statement,16384),inputs:snapshot(m.inputs,3446),credentials:snapshot(m.credentials,1024),human:snapshot(m.human,128),authority:snapshot(fields(m.authority,['authorityRecordSha256','configSha256','expiresAt']),512)};
 check(same(snapshot(m.config),config)&&materials.authority.authorityRecordSha256===config.authority_record_sha256&&materials.authority.configSha256===sha(config)&&Number.isSafeInteger(materials.authority.expiresAt)&&materials.authority.expiresAt<=materials.statement.payload.expires_at);const evidenceContext=evidenceSnapshot(context.evidenceContext);
 const started=Date.now(),monotonic=performance.now(),deadline=started+config.budgets.duration_ms;
 let lastTime=started,poisoned=false,finished=false,policy=null,validationOptions=null,client=null,runContext=null,fixtureContext=null,bootstrapPlan=null,bootstrap=null,preparations=null,twins=null;
 let serviceClose=null,transportClose=null,cleanupPromise=null,report=null,fragment=null,controllerResult=null,sequence=0,remoteClosed=false;
 const pending=new Set(),originals=new Map(),processes=new Map(),controlRecords=new Map(),cachedPreparations=[],bootstrapActions=[];
 const schedule=completeCallSchedule(config.profile),publicKey=Buffer.from(materials.statement.payload.service_key_spki_base64,'base64');
 let retainedArtifact=null,unsentJournal=null;
 function live(signal=null){const now=Date.now();check(!finished&&!poisoned&&now>=lastTime&&now<deadline&&performance.now()-monotonic<config.budgets.duration_ms&&!(signal?.aborted));lastTime=now;}
 function track(p){const actual=Promise.resolve(p);pending.add(actual);actual.then(()=>pending.delete(actual),()=>pending.delete(actual));return actual;}
 async function current(signal=null){live(signal);check(await track(Promise.resolve().then(()=>owners.assertCurrent()))===undefined);live(signal);}
 async function owned(fn,signal=null){await current(signal);const result=await track(Promise.resolve().then(fn));await current(signal);return result;}
 function retain(row){
  const r=fields(row,['id','sha256','bytes']);
  check(typeof r.id==='string'&&r.id.length>=1&&r.id.length<=128&&!/[^A-Za-z0-9_-]/.test(r.id)&&typeof r.sha256==='string'&&r.sha256.length===64&&!/[^a-f0-9]/.test(r.sha256));
  const old=originals.get(r.id);check(old||originals.size<selected.profile.release.records);
  const remaining=old?65536:selected.profile.release.joint_cap-[...originals.values()].reduce((n,x)=>n+x.bytes.length,0);
  const bytes=originalBytes(r.bytes,remaining);check(hash(bytes)===r.sha256);
  if(old){check(old.sha256===r.sha256&&old.bytes.equals(bytes));return old;}
  check(originals.size<selected.profile.release.records&&[...originals.values()].reduce((n,x)=>n+x.bytes.length,0)+bytes.length<=selected.profile.release.joint_cap);
  const out={id:r.id,sha256:r.sha256,bytes};originals.set(r.id,out);return out;
 }
 function record(id,value){const bytes=Buffer.from(canonical(value));return retain({id,sha256:hash(bytes),bytes});}
 function ref(row,family){return {record_id:row.id,family,sha256:row.sha256,byte_size:row.bytes.length};}
 function sessionReceipt(status){return {version:2,runId:runContext.runId,contextSha256:sha(runContext),status};}
 function subject(cp){return {invocation_id:cp.kind==='process'?cp.invocation_id:null,preparation_sha256:sha(cp)};}
 function signed(value,slot,family,issuance){
  const {type,version,payload_base64,signature_base64,...metadata}=value;
  const cp=slot?cachedPreparations.find(p=>(p.step_id??p.requirement_id)===slot.id):null;
  const expected={...metadata,invocation_id:cp?.kind==='process'?cp.invocation_id:null,preparation_sha256:cp?sha(cp):null,profile:config.profile,service_id:policy.service_id,instance_id:policy.instance_id,run_id:policy.run_id,descriptor_sha256:policy.descriptor_sha256,policy_sha256:completePolicyDigest(policy),slot,family,sequence:issuance.sequence,request_id:issuance.request_id};
  const wire=Buffer.from(canonical(value));const verified=verifyCompleteOriginal({expected,wire,publicKeyDer:publicKey});
  // Control ACKs are retained privately and later embedded in the existing
  // control roster, not added as nine unbudgeted release originals.
  const candidate={id:metadata.record_id,sha256:hash(wire),bytes:wire};
  const row=family==='control-acknowledgment'?candidate:retain(candidate);
  return {row,wire,metadata,ref:{record_id:metadata.record_id,family,sha256:metadata.sha256,byte_size:metadata.byte_size},value:JSON.parse(verified.bytes)};
 }
 async function send(operation,payload,signal,cp=null){
  live(signal);const expected=schedule[sequence];check(expected&&expected.operation===operation&&same(expected.slot,payload.slot??null)&&expected.pass===(payload.pass??null));
  const request={type:'native-complete-request',version:2,profile:config.profile,service_id:policy.service_id,instance_id:policy.instance_id,run_id:policy.run_id,descriptor_sha256:policy.descriptor_sha256,policy_sha256:completePolicyDigest(policy),sequence:++sequence,request_id:'request_'+sequence,operation,payload};
  const response=await owned(()=>client.send(request,{signal,slotSubject:cp?subject(cp):null}),signal);check(response.scope==='structural-response-only'&&response.signature_verified===false);
  return {value:response.value,request};
 }
 async function prepareSlot(cp,signal){const slot={kind:cp.kind,id:cp.kind==='external'?cp.requirement_id:cp.step_id};const response=await send('prepare-slot',{slot,preparation:cp},signal,cp);cachedPreparations.push(cp);return response.value.data;}
 function artifactPlan(){const path=join(config.fixture_directory,'native-artifact-source.bin'),compiled=selected.profile.artifact;return {path,descriptor_sha256:sha({type:'native-complete-artifact-source',version:1,fixture_directory:config.fixture_directory,source_file:path,byte_size:29,sha256:compiled.sha256}),byte_size:29,sha256:compiled.sha256};}
 function makeBootstrapPlan(){
  const roles=['primary-submitter','primary-reviewer','server-foreign-submitter'];
  const stores=materials.inputs.stores.map((s,i)=>{const actor=i===2?config.fixture_stores.find(x=>x.fixture==='server-foreign-workspace'):config.actors[i],credential=materials.inputs.credentials[i===1?1:0],secret=materials.credentials[i===1?1:0];return {role:roles[i],directory:actor.state_directory,store_descriptor_sha256:s.store_descriptor_sha256,credential_role:i===1?'reviewer':'submitter',credential_sha256:secret.sha256,expected_credential_id:credential.credential_id,expected_principal_id:credential.principal_id,expected_agent_id:credential.agent_id,expected_workspace_id:config.workspaces.primary};});
  return snapshot({run_id:policy.run_id,profile:config.profile,expires_at:Math.min(deadline,policy.expires_at),stores,artifact:artifactPlan()});
 }
 const processOffers=new Map(selected.profile.processes.map(p=>[p.step_id,p.output_bytes]));
 const mutations=s=>s.kind==='control'?(s.id==='control/revoke-submitter'?selected.profile.ledger.mutation_attempts.human_revoke:0):s.budget.mutations;
 const descriptions=scenario.steps.map(s=>({id:s.id,commands:1,mutations:mutations(s),artifact_bytes:s.requires?.includes('nonempty-artifact-source-at-most-10MiB')||artifactSteps.has(s.operation)?29:0,output_bytes:s.kind==='control'?0:processOffers.get(s.id)}));
 const evidenceDescriptions=[...scenario.steps.filter(s=>typed(s)||s.id==='control/revoke-submitter').map(s=>({id:s.id,...zero(),output_bytes:65536})),{id:'evidence/assembly',commands:1,mutations:0,artifact_bytes:0,output_bytes:selected.profile.ledger.logical_output_bytes.assembly_structural_fragment}];
 // Existing logical command ledger charges forty evidence observations and one
 // assembly separately from native62, service346 and bootstrap10.
 for(const row of evidenceDescriptions)row.commands=1;
 const sessionCost={...selected.profile.reservation};
 for(const row of [...descriptions,...evidenceDescriptions,nativeOutputVerificationPlan().cost])for(const k of costKeys){sessionCost[k]-=row[k];check(Number.isSafeInteger(sessionCost[k])&&sessionCost[k]>=0);}
 function stateRecord(stepId){const p=processes.get(stepId);check(p);return p;}
 function journalExpected(p){return preparations.journalPlanFromCapture(p.step.id,{carrier:p.carrier,terminal:p.terminal,finalOriginal:p.final});}
 function journalReadInput(p,controlId){const expected=preparations.readJournalPlan(controlId);
  return {stateDirectory:p.refs.state_directory,expected,context:{run_id:policy.run_id,step_id:controlId==='control/observe-settled-intent'?controlId:p.step.id,invocation_id:p.cp.invocation_id,original_invocation_id:p.cp.invocation_id,config_sha256:runContext.configSha256,scenario_sha256:runContext.scenarioSha256,authority_record_sha256:config.authority_record_sha256,process_final_sha256:p.final.sha256,prepared_subject_sha256:sha(p.cp.subject)},subject:p.cp.subject,storeBinding:p.cp.store_binding};
 }
 async function scan(p,pass,inventory,signal){const stream=b=>({sha256:hash(b),byte_size:b.length,payload_base64:b.toString('base64')});const result=await send('scan-process-output',{slot:{kind:'process',id:p.step.id},invocation_id:p.cp.invocation_id,preparation_sha256:sha(p.cp),pass,final_original_ref:ref(p.final,'process-custody'),inventory_sha256:inventory,stdout:stream(p.carrier.stdout),stderr:stream(p.carrier.stderr)},signal,p.cp);const checked=signed(result.value,{kind:'process',id:p.step.id},'secret-inventory-scan',result.request);check(checked.value.secret_match_count===0&&checked.value.foreign_match_count===0);return checked;}
 async function observeSlot(cp,signal,issued=null){
  const slot={kind:cp.kind,id:cp.step_id??cp.requirement_id},observation=await send('observe-slot',{slot,preparation_sha256:sha(cp)},signal,cp),data=observation.value.data,reference=data.manifest.records[0];
  let value;
  if(data.original)value=signed(data.original,slot,reference.family,observation.request);
  else if(slot.kind==='control'&&slot.id!=='control/revoke-submitter'){check(issued&&same(issued.ref,reference));value=issued;}
  else{const read=await send('read-original',{slot,...reference},signal,cp);value=signed(read.value,slot,reference.family,slot.kind==='external'?issued.request:observation.request);check(same(value.ref,reference));}
  return {manifest:data.manifest,issued:value};
 }
 async function externalAfter(stepId,signal){const id=stepId==='prepare/server-foreign-own-positive'?'server-foreign-workspace-denial':stepId==='prepare/runtime-own-after'?'server-wrong-runtime-proof-denial':null;if(!id)return;
  const cp=preparations.prepareExternal(id);await prepareSlot(cp,signal);const slot={kind:'external',id},effect=await send('execute-external',{slot,preparation_sha256:sha(cp)},signal,cp),observed=await observeSlot(cp,signal,{request:effect.request});check(same(effect.value.data.effect_original,observed.issued.ref));preparations.finishExternal(id,observed.issued.value);
 }
 async function finishService(signal){
  check(sequence===schedule.findIndex(r=>r.operation==='seal-scan-inventory'));
  const seal=await send('seal-scan-inventory',{expected_inventory_generation:15},signal),inventory=seal.value.data.inventory_sha256;
  for(const step of scenario.steps.filter(s=>s.kind!=='control'))await scan(stateRecord(step.id),'final',inventory,signal);
  const final=await send('finalize-run-scan',{inventory_sha256:inventory},signal);signed(final.value.data.control_roster,null,'control-roster',final.request);signed(final.value.data.coverage_roster,null,'slot-coverage-roster',final.request);
  const read=await send('read-run-original',final.value.data.scan_ref,signal);signed(read.value,null,'final-output-scan',final.request);
  const close=await send('close-run',{},signal);serviceClose=close.value.data;check(serviceClose.status==='closed');remoteClosed=true;
 }
 async function cleanup(){
  if(cleanupPromise)return cleanupPromise;
  cleanupPromise=Promise.resolve().then(async()=>{let unknown=false;
   if(!client&&!bootstrap)return sessionReceipt(pending.size?'cleanup-unknown':'not-opened');
   if(client&&!remoteClosed){
    try{check(!client.snapshot().pending);const request={type:'native-complete-request',version:2,profile:config.profile,service_id:policy.service_id,instance_id:policy.instance_id,run_id:policy.run_id,descriptor_sha256:policy.descriptor_sha256,policy_sha256:completePolicyDigest(policy),sequence:++sequence,request_id:'request_'+sequence,operation:'close-run',payload:{}};const response=await track(client.send(request,{signal:null,slotSubject:null}));serviceClose=response.value.data;remoteClosed=serviceClose.status==='closed';if(!remoteClosed)unknown=true;}catch{unknown=true;}
   }
   if(client){try{transportClose=await client.close();if(transportClose.status!=='closed')unknown=true;}catch{unknown=true;}}
   if(pending.size||bootstrap?.snapshot().pending)unknown=true;
   return sessionReceipt(unknown?'cleanup-unknown':'closed');
  });return cleanupPromise;
 }
 async function genericObservation(step,options){
  live(options.signal);
  const p=stateRecord(step.id);p.options=options;
  const capture=options.processResult.readCapturedOutput();p.carrier={invocationId:options.invocationId,exitCode:options.processResult.exitCode,stdout:Buffer.from(capture.stdout),stderr:Buffer.from(capture.stderr),custody:snapshot(capture.custody,32768),maxOutputBytes:processOffers.get(step.id)};
  const read=await owned(()=>owners.readProcessOriginals({outputDirectory:config.output_directory,invocationId:options.invocationId,custody:Object.fromEntries(['prepared','spawned','final'].map(k=>[k,p.carrier.custody[k]])),remainingBytes:24576}),options.signal);
  const records=read.readProtectedRecords();check(records.length===3);p.processRecords=records.map(retain);p.final=p.processRecords.find(r=>r.id===options.invocationId+'_final');check(p.final);
  const output=typed(step)?options.readOutputVerification():null;if(output)retain(output);
  const stream=b=>({sha256:hash(b),byte_size:b.length});
  const payload={slot:{kind:'process',id:step.id},invocation_id:options.invocationId,preparation_sha256:sha(p.cp),custody:Object.fromEntries(['prepared','spawned','final'].map(k=>{const row=p.processRecords.find(r=>r.id===options.invocationId+'_'+k);check(row);return[k,ref(row,'process-custody')];})),output:{stdout:stream(p.carrier.stdout),stderr:stream(p.carrier.stderr),verification_ref:output?ref(output,'process-output-verification'):null}};
  const terminal=await send('complete-process',payload,options.signal,p.cp);p.terminal=terminal.request;
  await scan(p,'immediate',null,options.signal);const observation=await observeSlot(p.cp,options.signal);p.serviceObservation=observation;
  check(observation.manifest.effect_record_sha256===p.final.sha256);
  if(step.id==='prepare/retain-artifact'){
   const parsed=parseNativeCliOutput({stepId:step.id,stdout:p.carrier.stdout,stderr:p.carrier.stderr,mode:'full'});check(parsed.kind==='local-retained');
   p.retained=await owned(()=>owners.readUpload({stateDirectory:p.refs.state_directory,contentId:parsed.parsed.id,expectedSha256:selected.profile.artifact.sha256,expectedBytes:29}),options.signal);
   retainedArtifact={step_id:step.id,invocation_id:p.cp.invocation_id,process_final_sha256:p.final.sha256,observation:p.retained};
  }
  if(step.id==='probe/wrong-runtime'){
   const {state:unusedState,...expected}=journalExpected(p);check(unusedState==='unsent');
   unsentJournal=await owned(()=>owners.readUnsent({stateDirectory:p.refs.state_directory,expected,context:{run_id:policy.run_id,step_id:step.id,invocation_id:p.cp.invocation_id,config_sha256:runContext.configSha256,scenario_sha256:runContext.scenarioSha256,authority_record_sha256:config.authority_record_sha256,process_final_sha256:p.final.sha256,preparation_sha256:sha(p.cp)},storeBinding:p.cp.store_binding}),options.signal);
  }
  let local=observation.issued.ref;
  if(typed(step)){
   const token=twins.bindHostCapture({captureFacts:options.captureFacts,completePreparation:p.cp,nativePreparationRecord:p.nativePreparationRecord,processRecords:p.processRecords,processPreparedId:options.invocationId+'_prepared',processSpawnedId:options.invocationId+'_spawned',processFinalId:p.final.id,expected:observation.issued.metadata});
   if(['uploadArtifactContent','downloadArtifactContent'].includes(step.operation))await owned(()=>twins.readHostArtifact(token,{refs:p.refs}),options.signal);
   if(['case/lost-response-retained','case/settled-no-send','case/restart-no-send'].includes(step.id))await owned(()=>twins.readHostJournal(token,{expected:journalExpected(p)}),options.signal);
   p.twin=twins.receiveSigned(token,observation.issued.wire);retain(p.twin.record);local={record_id:p.twin.record.id,sha256:p.twin.record.sha256};
  }
  preparations.finishProcess(step.id,{carrier:p.carrier,terminal:p.terminal,finalOriginal:p.final,observationRef:observation.issued.ref,retainedArtifact:p.retained??null});
  await externalAfter(step.id,options.signal);
  return {stepId:step.id,invocationId:options.invocationId,processExit:p.carrier.exitCode,executableSha256:config.build.sha256,requestCount:step.expectedRequests,httpStatus:step.expectedStatus??null,configSha256:runContext.configSha256,scenarioSha256:runContext.scenarioSha256,authorityRecordSha256:config.authority_record_sha256,principalId:p.cp.store_binding.principal_id,agentId:p.cp.store_binding.agent_id,workspaceId:p.refs.workspace??config.workspaces.primary,processRecordSha256:p.final.sha256,secretCount:0,recordSha256:local.sha256,usage:{commands:1,mutations:mutations(step),artifact_bytes:0,output_bytes:p.carrier.stdout.length+p.carrier.stderr.length}};
 }
 async function typedObservation(step,options){live(options.signal);const p=stateRecord(step.id);check(p.twin&&p.twin.record.sha256===options.expectedRecordSha256);if(step.id===scenario.steps.at(-1).id)await finishService(options.signal);return {record:{...p.twin.record,bytes:Buffer.from(p.twin.record.bytes)},usage:{commands:1,mutations:0,artifact_bytes:0,output_bytes:p.twin.record.bytes.length}};}
 async function control(step,options){
  live(options.signal);
  let input={};
  const reads=[];for(const descriptor of preparations.storeReadInputs(step.id))reads.push(await owned(()=>owners.readStore(descriptor),options.signal));
  if(step.id==='control/observe-server-foreign-fixture')input={storeRead:reads[0]};
  if(step.id==='control/observe-other-runtime')input={submitterRead:reads[0],reviewerRead:reads[1]};
  if(step.id==='control/observe-success-coverage')input={caseRecords:options.readProtectedCaseRecords()};
  if(step.id==='control/observe-settled-intent'||step.id==='control/disarm-and-observe-lost'){
   const previous=stateRecord(step.id==='control/observe-settled-intent'?'prepare/fail-create':'case/lost-response-retained');
   const journal=await owned(()=>owners.readJournal(journalReadInput(previous,step.id)),options.signal);input={journal};
  }
  if(step.id==='control/arm-lost-response')input=preparations.armLostInputs();
  if(step.id==='control/revoke-submitter')input={positiveObservationRef:stateRecord('prepare/revoke-own-positive').serviceObservation.issued.ref};
  const cp=preparations.prepareControl(step.id,input);await prepareSlot(cp,options.signal);const slot={kind:'control',id:step.id};
  const payload={slot,preparation_sha256:sha(cp)};
  if(step.id==='control/provision')payload.private_inputs={credentials:materials.credentials.map(c=>({role:c.role,token:c.token})),human:materials.human};
  const effect=await send('execute-control',payload,options.signal,cp),issued=signed(effect.value,slot,'control-acknowledgment',effect.request),observation=await observeSlot(cp,options.signal,issued);
  check(observation.manifest.effect_record_sha256===issued.ref.sha256);let local=issued.ref,twin=null;
  if(step.id==='control/revoke-submitter'){
   const token=twins.bindHostDisable({captureFacts:options.captureFacts,completePreparation:cp,expected:observation.issued.metadata});twin=twins.receiveSigned(token,observation.issued.wire);retain(twin.record);local={sha256:twin.record.sha256};
  }
  const receipt={authorityRecordSha256:config.authority_record_sha256,configSha256:runContext.configSha256,recordSha256:local.sha256,scenarioSha256:runContext.scenarioSha256,status:'observed',stepId:step.id,usage:{commands:1,mutations:mutations(step),artifact_bytes:0,output_bytes:0}};
  preparations.finishControl(step.id,{receipt});controlRecords.set(step.id,{cp,issued,observation,twin,receipt});return receipt;
 }
 const adapter={
  hostVersion:2,
  async planSession(actualContext,{scenario:actualScenario,signal}){
   check(runContext===null&&same(actualScenario,scenario));runContext=snapshot(actualContext,4096);check(same(runContext,createCompleteNativeRunContext(config,runContext.runId)));
   const derived=fields(await owned(()=>owners.derivePolicy(runContext.runId),signal),['scope','installedAuthority','native_conformance','policy','policy_sha256']);
   check(derived.scope==='structural-policy-only'&&derived.installedAuthority===false&&derived.native_conformance===false);
   policy=snapshot(derived.policy);validationOptions=createCompletePolicyFraming({config,policy,now:started});check(completePolicyDigest(policy)===derived.policy_sha256);
   fixtureContext=deriveCompleteFixtureContext({config,inputs:materials.inputs,credentials:materials.credentials,human:materials.human,installation:materials.statement,runId:runContext.runId});
   bootstrapPlan=makeBootstrapPlan();await owned(async()=>{client=functions(await owners.createClient(policy,validationOptions),['send','close','snapshot']);return client;},signal);
   twins=createSourceCompleteHostTwinOwner({config,context:{run_id:runContext.runId,...evidenceContext},policy,trustAnchorBytes:Buffer.from(materials.anchorBase64,'base64'),installationBytes:Buffer.from(materials.descriptorBase64,'base64'),hostSha256:context.hostSha256});
   return {version:2,runId:runContext.runId,contextSha256:sha(runContext),coverage:[...scenario.steps.map(s=>({kind:'step',id:s.id,requirements:s.requires??[],supported:true})),...scenario.externalRequirements.map(s=>({kind:'external',id:s.id,requirements:s.requires??[],supported:true}))],reservation:sessionCost};
  },
  async authorize({configSha256,config:actualConfig},{signal}){await current(signal);check(same(config,actualConfig)&&configSha256===sha(config));check(materials.authority.expiresAt>Date.now());return {...materials.authority};},
  describe:async()=>structuredClone(descriptions),
  describeEvidence:async()=>structuredClone(evidenceDescriptions),
  async openSession(actualContext,{signal}){
   check(same(actualContext,runContext));
   let reserved=false;await owned(async()=>{bootstrap=functions(await owners.createBootstrap(bootstrapPlan,{
    reserve:offer=>{check(!reserved&&same(offer,{actions:10,mutations:6,artifact_bytes:29,cli_output_bytes:510,receipt_bytes:11091}));reserved=true;},
    assertCurrent:()=>current(signal),
    resolveCredential:role=>{live(signal);check(['submitter','reviewer'].includes(role));return materials.credentials[role==='reviewer'?1:0].token;},
   }),['run','snapshot']);return bootstrap;},signal);
   const result=await owned(()=>bootstrap.run(),signal);check(reserved&&result.status==='completed'&&result.failed_ordinal===null&&result.actions.length===10);
   for(const value of result.actions)bootstrapActions.push(record('bootstrap_'+value.ordinal,value));
   preparations=createCompletePreparationOwner({config,policy,validationOptions,fixtureContext,bootstrapPlan,bootstrapActions});
   const ready=await send('preflight',{policy_sha256:completePolicyDigest(policy),family_ledger_sha256:selected.commitments.family_ledger_sha256,slot_roster_sha256:sha(completeSlotRegistry(config.profile))},signal);check(ready.value.data.status==='ready');await send('bind-run',{policy_sha256:completePolicyDigest(policy)},signal);return sessionReceipt('opened');
  },
  closeSession:async()=>cleanup(),
  async prepare(step,{requestInput,signal}){
   live(signal);check(!processes.has(step.id));check(same(preparations.planRequestInput(step.id),requestInput));
   const base=runContext.runId+'_'+step.id.replaceAll('/','_'),paths={input_file:step.refKeys.includes('input_file')?join(config.fixture_directory,base+'.json'):null,source_file:step.refKeys.includes('source_file')?bootstrapPlan.artifact.path:null,output_file:step.refKeys.includes('output_file')?join(config.fixture_directory,base+'.bin'):null};
   const refs=preparations.resolveReferences(step.id,paths);processes.set(step.id,{step,refs,requestInput:snapshot(requestInput),storeRead:null,cp:null});return {refs,artifactBytes:descriptions.find(r=>r.id===step.id).artifact_bytes};
  },
  async prepareEvidence(step,{refs,signal}){
   const p=stateRecord(step.id);check(same(p.refs,refs));const descriptors=preparations.storeReadInputs(step.id);check(descriptors.length===1);p.storeRead=await owned(()=>owners.readStore(descriptors[0]),signal);return preparations.prepareSubject(step.id,{refs:p.refs,requestInput:p.requestInput,storeRead:p.storeRead});
  },
  async beforeNativeProcess(step,handoff){
   live(handoff.signal);
   const p=stateRecord(step.id);check(same(handoff.refs,p.refs)&&same(handoff.requestInput,p.requestInput));
   if(!typed(step)){const descriptors=preparations.storeReadInputs(step.id);check(descriptors.length===1);p.storeRead=await owned(()=>owners.readStore(descriptors[0]),handoff.signal);}
   p.nativePreparationRecord=handoff.nativePreparationRecord?{...handoff.nativePreparationRecord,bytes:Buffer.from(handoff.nativePreparationRecord.bytes)}:null;
   p.cp=preparations.prepareProcess(step.id,{handoff:Object.fromEntries(['invocationId','invocation','refs','pin','requestInput','inputPublication','inputAdmission','nativePreparationRecord'].map(k=>[k,k==='nativePreparationRecord'?p.nativePreparationRecord:handoff[k]])),storeRead:typed(step)?null:p.storeRead});
   const ack=await prepareSlot(p.cp,handoff.signal);return {runId:runContext.runId,invocationId:handoff.invocationId,configSha256:runContext.configSha256,scenarioSha256:runContext.scenarioSha256,completePreparation:p.cp,ack};
  },
  control,
  observe:genericObservation,
  observeEvidence:typedObservation,
  observeAuxiliaryEvidence:typedObservation,
  async observeDisableEvidence(step,options){live(options.signal);const row=controlRecords.get(step.id);check(row?.twin&&row.twin.record.sha256===options.expectedRecordSha256);return {record:{...row.twin.record,bytes:Buffer.from(row.twin.record.bytes)},usage:{commands:1,mutations:0,artifact_bytes:0,output_bytes:row.twin.record.bytes.length}};},
 };
 let cleanupResult=null,executionStatus='incomplete';
 try{
  // The enclosing controller promise owns this session: counting it among
  // child I/O would make closeSession await/count its own caller. Retain it
  // separately; the controller owns its deadline and cleanup boundary.
  await current();const actualRun=Promise.resolve().then(()=>owners.runScenario(config,adapter,evidenceContext));
  controllerResult=await actualRun;await current();
  executionStatus=controllerResult.executionStatus??controllerResult.status;
  check(controllerResult.runId===runContext.runId&&controllerResult.plannedSteps===scenario.steps.length);
  const native=controllerResult.readProtectedEvidence();for(const row of native.records)retain(row);
  check(controllerResult.status==='observed'&&controllerResult.cleanup==='closed'&&controllerResult.completedSteps===scenario.steps.length&&remoteClosed&&sequence===schedule.length&&pending.size===0);
  const actualBindings=controllerResult.readProtectedBindings(),derived=preparations.readSummary();check(derived.status==='complete'&&derived.completed_slots===64&&same(actualBindings.bindings,derived.bindings)&&same(actualBindings.provenance,derived.provenance));
  const sessionClose=controllerResult.readSessionCleanup();check(sessionClose.status==='closed'&&transportClose?.status==='closed');
  const pairs=twins.readSignedTwins().map(({wire,...pair})=>pair);
  report=assembleCompleteNativeReport({protectedEvidence:native,originals:[...originals.values()],serviceBinding:{profile:config.profile,service_id:policy.service_id,instance_id:policy.instance_id,run_id:policy.run_id,descriptor_sha256:policy.descriptor_sha256,policy_sha256:completePolicyDigest(policy)},publicKeyDer:publicKey,twins:pairs,closure:{serviceClose,sessionClose,transportClose,transportState:client.snapshot(),installation:materials.statement,fixtureInputs:materials.inputs,preparations:cachedPreparations,policy,validationOptions,bootstrapPlan,retainedArtifact,unsentJournal}});
  fragment=snapshot(native.assembly.result,selected.profile.ledger.logical_output_bytes.assembly_structural_fragment);check(hash(canonical(fragment))===report.native_fragment.sha256);
  cleanupResult=sessionClose;
 }catch{
  poisoned=true;report=null;fragment=null;
  // Preserve acquired originals and the actual terminal owner result. Unknown
  // cleanup cannot be converted into a successful report by a later retry.
  try{if(controllerResult?.readProtectedEvidence)for(const row of controllerResult.readProtectedEvidence().records)retain(row);}catch{}
  if(runContext)try{cleanupResult=await cleanup();}catch{cleanupResult=sessionReceipt('cleanup-unknown');}
 }
 finished=true;
 if(!runContext)reject();
 const cleanupStatus=cleanupResult?.status??'cleanup-unknown',ready=report!==null&&cleanupStatus==='closed';
 const result={status:ready?'observed':'incomplete',executionStatus:executionStatus==='observed'?'observed':'incomplete',scope:'producer-fragment',issue48Complete:false,native_conformance:false,acceptance:'pending-external-inspection',completedSteps:Math.min(scenario.steps.length,Math.max(0,Number.isSafeInteger(controllerResult?.completedSteps)?controllerResult.completedSteps:0)),plannedSteps:scenario.steps.length,runId:runContext.runId,retryAllowed:false,cleanup:cleanupStatus,durability:'memory-only',reportReady:ready,externalRequirements:scenario.externalRequirements.map(x=>x.id)};
 Object.defineProperties(result,{
  readCompleteReport:{value:()=>report?structuredClone(report):null,enumerable:false},
  readCompleteOriginals:{value:()=>[...originals.values()].map(r=>({...r,bytes:Buffer.from(r.bytes)})),enumerable:false},
  readCompleteNativeFragment:{value:()=>fragment?structuredClone(fragment):null,enumerable:false},
 });return Object.freeze(result);
}
