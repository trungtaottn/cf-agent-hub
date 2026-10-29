/** Source-owned planning only. No IO, spawn, secrets or authority construction.
 * Host integration must authenticate every actual reference and reserve controls. */
import {isAbsolute,normalize} from 'node:path';
import {isIP} from 'node:net';
import operations from './r2-policy-data/operations.json' with {type:'json'};
const commands={
 getWorkspace:['workspace show'],getConfiguration:['workspace configuration'],getProfile:['workspace profile'],
 listTasks:['tasks list'],createTask:['tasks create',null,true],getTask:['tasks show','main_task_id'],patchTask:['tasks update','main_task_id',true],
 readyTask:['tasks ready','main_task_id',true],claimTask:['tasks claim','main_task_id',true],submitTaskResult:['tasks submit-result','main_task_id',true],acceptTaskResult:['tasks accept-result','main_task_id',true],failTask:['tasks fail','fail_task_id',true],cancelTask:['tasks cancel','cancel_task_id',true],requeueTask:['tasks requeue','requeue_task_id',true],listTaskResults:['tasks results','main_task_id'],
 getRun:['runs show','main_run_id'],heartbeatRun:['runs heartbeat','main_run_id',true],listAgents:['agents list'],getAgent:['agents show','reviewer_agent_id'],createRuntime:['runtime register',null,true],heartbeatRuntime:['runtime heartbeat','main_runtime_id',true],
 createMessage:['messages send',null,true],ackMessages:['messages ack',null,true],getInbox:['inbox list'],getThread:['threads show','thread_id'],
 listArtifacts:['artifacts list'],stageArtifact:['artifacts stage',null,true],getArtifact:['artifacts show','main_artifact_id'],uploadArtifactContent:['artifacts upload','main_artifact_id'],downloadArtifactContent:['artifacts download','main_artifact_id'],commitArtifact:['artifacts commit','main_artifact_id',true],listEvents:['events list'],searchWorkspace:['search']
};
const steps=[];
const observers=['independent-current-grants-and-proof','independent-before-after-state','independent-transport','candidate-and-store-binding','owned-process-terminal-record'];
function control(id,dependsOn,requires,produces=[],actor='submitter',fixture='primary'){
 steps.push({id,kind:'control',caseId:null,operation:null,actor,fixture,dependsOn,requires,produces,expectedExit:null,expectedRequests:null,budget:null,control:id,command:null,refKeys:[]});return id;
}
function native(id,operation,dependsOn,{actor='submitter',fixture='main',resource,caseId='native/'+operation+'/success',requires=[],produces=[],exit=0,requests,status}={}){
 const spec=commands[operation],meta=operations[operation];if(!spec||!meta?.native)throw Error('NATIVE_SCENARIO_POLICY_INVALID');
 const pathKey=resource??spec[1]??null,refs=['actor_slot','fixture','state_directory','origin','workspace'];
 if(pathKey)refs.push(pathKey);if(spec[2])refs.push('input_file');if(meta.idempotency)refs.push('idempotency_key');
 if(['stageArtifact','uploadArtifactContent'].includes(operation))refs.push('content_id');if(operation==='downloadArtifactContent')refs.push('output_file');
 const count=requests??(['uploadArtifactContent','downloadArtifactContent','commitArtifact'].includes(operation)?2:1);
 steps.push({id,kind:'native',caseId,operation,actor,fixture,dependsOn,requires:[...observers,...requires],produces,expectedExit:exit,expectedRequests:count,expectedStatus:status??(exit===0?meta.status:null),budget:{processes:1,mutations:meta.idempotency?1:0,httpRequests:count},control:null,command:spec[0],resourceKey:pathKey,refKeys:refs});return id;
}
function dispatch(id,caseId,intentKey,dependsOn,requires,fixture=intentKey==='lost_intent_id'?'lost-response':'main'){steps.push({id,kind:'local',caseId,operation:null,actor:'submitter',fixture,dependsOn,requires:[...observers,...requires],produces:[],expectedExit:5,expectedRequests:0,expectedStatus:null,budget:{processes:1,mutations:1,httpRequests:0},control:null,command:'intent dispatch',resourceKey:intentKey,refKeys:['actor_slot','fixture','state_directory','origin','workspace',intentKey]});return id;}
const authority=control('control/authorize',[],['externally-installed-authority','exact-candidate-deployment-namespace','bounded-observer-and-control-reservations'],['authorized-scenario-capability']);
const provision=control('control/provision',[authority],['authorized-scenario-capability','current-execution-policy','distinct-submitter-reviewer-principals-and-agents','prequalified-protected-stores','primary-and-foreign-isolation','required-operation-grants','nonempty-artifact-source-at-most-10MiB'],['primary-fixture','submitter-store','reviewer-store','artifact-source']);
const ws=native('success/getWorkspace','getWorkspace',[provision],{fixture:'primary'});
native('success/getConfiguration','getConfiguration',[ws],{fixture:'primary'});native('success/getProfile','getProfile',[ws],{fixture:'primary'});
const reviewer=native('prepare/reviewer-binding','getWorkspace',[provision],{actor:'reviewer',fixture:'primary',caseId:null,requires:['current-reviewer-workspace-read-and-tasks-review']});
const agents=native('success/listAgents','listAgents',[ws],{fixture:'primary'});native('success/getAgent','getAgent',[agents],{fixture:'primary'});
const bootstrap=native('prepare/submitter-enrollment','createRuntime',[ws],{caseId:null,fixture:'primary',requires:['current-submitter-runtimes-manage','no-pending-intent-before-bootstrap'],produces:['initial-submitter-protected-binding']});
const reviewerEnrollment=native('prepare/reviewer-enrollment','createRuntime',[reviewer],{caseId:null,actor:'reviewer',fixture:'primary',requires:['current-reviewer-runtimes-manage','no-pending-reviewer-intent-before-bootstrap'],produces:['reviewer-protected-binding']});
const create=native('success/createTask','createTask',[bootstrap],{produces:['main-task-backlog'],requires:['fresh-main-task-body']});
const get=native('success/getTask','getTask',[create]);const patch=native('success/patchTask','patchTask',[get],{requires:['current-main-task-version'],produces:['patched-main-task-backlog']});
const ready=native('success/readyTask','readyTask',[patch],{requires:['current-main-task-version','execution-policy-admits-main-task'],produces:['main-task-ready']});
const enroll=native('success/createRuntime','createRuntime',[ready],{requires:['no-pending-unsent-or-uncertain-intent-for-replaced-binding','old-runtime-has-no-active-run','observe-new-provenance-and-protected-proof'],produces:['main-runtime-binding-and-protected-proof']});
const claim=native('success/claimTask','claimTask',[enroll],{requires:['main-task-ready','current-main-runtime-proof','claim-and-execute-grants','available-wip-slot'],produces:['main-run-and-fence','main-task-doing']});
const run=native('success/getRun','getRun',[claim]);const runHeartbeat=native('success/heartbeatRun','heartbeatRun',[run],{requires:['current-main-run-version-and-fence','unexpired-main-run-and-proof']});
const runtimeHeartbeat=native('success/heartbeatRuntime','heartbeatRuntime',[runHeartbeat],{requires:['current-runtime-version-and-proof']});
steps.push({id:'prepare/retain-artifact',kind:'local',caseId:null,operation:null,actor:'submitter',fixture:'main',dependsOn:[runtimeHeartbeat],requires:['artifact-source','qualified-protected-source-file','nonempty-artifact-source-at-most-10MiB'],produces:['retained-content-id-and-sealed-digest'],expectedExit:0,expectedRequests:0,expectedStatus:null,budget:{processes:1,mutations:1,httpRequests:0},control:null,command:'artifacts retain',resourceKey:null,refKeys:['actor_slot','fixture','state_directory','source_file']});
const stage=native('success/stageArtifact','stageArtifact',['prepare/retain-artifact'],{requires:['retained-content-id-and-sealed-digest','stage-body-binds-main-task-run-and-exact-content','current-main-runtime-proof'],produces:['main-artifact-staged']});
const upload=native('success/uploadArtifactContent','uploadArtifactContent',[stage],{requires:['same-retained-content-id','current-main-runtime-proof'],produces:['main-artifact-uploaded']});
const commit=native('success/commitArtifact','commitArtifact',[upload],{requires:['current-artifact-version','current-main-runtime-proof'],produces:['main-artifact-committed']});
const artifact=native('success/getArtifact','getArtifact',[commit]);const download=native('success/downloadArtifactContent','downloadArtifactContent',[artifact],{requires:['new-qualified-download-destination','exact-committed-source-digest-and-size']});
const artifacts=native('success/listArtifacts','listArtifacts',[download]);
const submit=native('success/submitTaskResult','submitTaskResult',[artifacts],{requires:['main-artifact-committed','current-main-task-run-version-fence-and-proof','result-body-references-main-committed-artifact'],produces:['main-task-review','main-result-original-run']});
const results=native('success/listTaskResults','listTaskResults',[submit]);
const accept=native('success/acceptTaskResult','acceptTaskResult',[results,reviewerEnrollment],{actor:'reviewer',requires:['reviewer-current-tasks-review','reviewer-distinct-principal-and-agent','accept-current-result-original-run-and-task-version'],produces:['main-task-done']});
// Separate task fixtures: cancel cannot be requeued; fail holds are not cleared.
const failCreate=native('prepare/fail-create','createTask',[accept],{fixture:'fail',caseId:null,produces:['fail-task-backlog','settled-create-intent']});
const failReady=native('prepare/fail-ready','readyTask',[failCreate],{fixture:'fail',resource:'fail_task_id',caseId:null});
const failClaim=native('prepare/fail-claim','claimTask',[failReady],{fixture:'fail',resource:'fail_task_id',caseId:null,requires:['current-main-runtime-proof','available-wip-slot'],produces:['fail-run-and-fence']});
const fail=native('success/failTask','failTask',[failClaim],{fixture:'fail',requires:['current-fail-run-fence-and-proof','failure-body-declares-outcome-unknown','retain-resulting-hold-no-auto-requeue']});
const cancelCreate=native('prepare/cancel-create','createTask',[fail],{fixture:'cancel',caseId:null});
const cancel=native('success/cancelTask','cancelTask',[cancelCreate],{fixture:'cancel',requires:['current-cancel-task-version'],produces:['cancel-task-cancelled']});
const requeueCreate=native('prepare/requeue-create','createTask',[cancel],{fixture:'requeue',caseId:null,produces:['requeue-task-backlog']});
const requeue=native('success/requeueTask','requeueTask',[requeueCreate],{fixture:'requeue',requires:['requeue-task-backlog','no-active-run-or-unresolved-external-effect'],produces:['requeue-task-ready']});
const message=native('success/createMessage','createMessage',[accept],{fixture:'message',requires:['reviewer-recipient-has-current-message-grants','message-body-references-current-visible-main-task'],produces:['message-id-and-thread-id']});
const inbox=native('success/getInbox','getInbox',[message],{actor:'reviewer',fixture:'message',requires:['reviewer-own-recipient']});
const ack=native('success/ackMessages','ackMessages',[inbox],{actor:'reviewer',fixture:'message',requires:['ack-body-contains-own-observed-message-only']});
const thread=native('success/getThread','getThread',[ack],{actor:'reviewer',fixture:'message',requires:['reviewer-current-thread-participant']});
const tasks=native('success/listTasks','listTasks',[requeue]);const events=native('success/listEvents','listEvents',[tasks,thread]);const search=native('success/searchWorkspace','searchWorkspace',[events]);
const complete=control('control/observe-success-coverage',steps.filter(s=>s.caseId?.endsWith('/success')).map(s=>s.id),['all-33-successful-native-case-records','all-auxiliary-invocations-terminal'],['successful-native-coverage-observed']);
// Separately authorized imported-but-unenrolled store: GET reaches the server without bypassing a client guard.
const serverForeignFixture=control('control/observe-server-foreign-fixture',[complete],['separate-explicit-fixture-store-authorization','null-binding-and-no-runtime-proof-before-both-reads','same-exact-credential-slot-generation-principal','current-primary-workspace-read-grant','foreign-workspace-exists-token-not-admitted','no-existing-main-store-mutation'],['server-foreign-fixture-current'],'submitter','server-foreign-workspace');
const serverForeign=native('probe/server-foreign-workspace','getWorkspace',[serverForeignFixture],{caseId:null,fixture:'server-foreign-workspace',exit:3,requests:1,status:401,requires:['server-foreign-fixture-current','null-binding-and-no-runtime-proof','independent-server-401-no-leak-no-effect-observation']});
const serverOwn=native('prepare/server-foreign-own-positive','getWorkspace',[serverForeign],{caseId:null,fixture:'server-foreign-workspace',requires:['independent-negative-no-effect-no-leak-before-positive','same-exact-credential-slot-generation-principal','null-binding-and-no-runtime-proof','unchanged-current-primary-workspace-read-grant']});
// These probes establish local binding guards only, not server authorization denial.
const wrongWorkspace=native('probe/wrong-workspace','getWorkspace',[serverOwn],{caseId:null,fixture:'foreign-workspace',exit:5,requests:0,requires:['primary-store-bound-to-primary-workspace','foreign-target-differs-from-primary-binding','local-binding-denial-not-server-authorization-proof']});
const ownBefore=native('prepare/runtime-own-before','heartbeatRuntime',[wrongWorkspace],{caseId:null,fixture:'runtime-probe',requires:['current-own-runtime-version-and-proof','current-runtimes-manage-grant']});
const runtimeFixture=control('control/observe-other-runtime',[ownBefore],['distinct-runtime-exists-with-current-independent-record','own-proofstore-unchanged','current-runtimes-manage-grant'],['other-runtime-binding'],'submitter','runtime-probe');
const wrongRuntime=native('probe/wrong-runtime','heartbeatRuntime',[runtimeFixture],{caseId:null,fixture:'runtime-probe',resource:'wrong_runtime_id',exit:5,requests:0,requires:['other-runtime-binding','path-runtime-differs-from-stored-proof-runtime','local-binding-denial-not-server-authorization-proof','original-unsent-intent-retained']});
let auxiliaryTail=native('prepare/runtime-own-after','heartbeatRuntime',[wrongRuntime],{caseId:null,fixture:'runtime-probe',requires:['independently-observed-no-send-before-first-dispatch','same-current-own-proof-and-grant','current-own-runtime-version']});
for(const mode of ['slot','generation','principal']){
 const fixture='swap-'+mode;
 const prepare=control('control/prepare-swap-'+mode,[auxiliaryTail],['separate-explicit-fixture-store-authorization','isolated-internally-valid-provider-fixture','original-unsent-journal-old-tuple','no-existing-main-store-mutation','current-tuple-differs-only-in-reviewed-'+mode,'trusted-original-and-current-tuple-observations'],['isolated-swap-intent-binding'],'submitter',fixture);
 auxiliaryTail=dispatch('probe/swapped-'+mode,null,'swap_intent_id',[prepare],['isolated-swap-intent-binding','original-unsent-journal-old-tuple','no-first-dispatch-no-clock-confounder','expected-original-tuple-mismatch-before-transport','no-cleanup-or-automatic-replacement'],fixture);
}
const settledObserve=control('control/observe-settled-intent',[auxiliaryTail],['same-submitter-store','original-successful-create-retained-intent','exact-prepare-fail-create-intent-after-latest-enrollment','protected-journal-settled-record'],['settled-intent-binding']);
const settled=dispatch('case/settled-no-send','native/settled-no-send','settled_intent_id',[settledObserve],['settled-intent-binding','fresh-process-same-store','settled-state-preserved']);
const arm=control('control/arm-lost-response',[settled],['authorized-commit-before-publication-fault','exact-fresh-create-request-key-and-store','one-scoped-fault-only'],['acknowledged-scoped-fault'], 'submitter','lost-response');
const lost=native('case/lost-response-retained','createTask',[arm],{fixture:'lost-response',caseId:'native/lost-response-retained',exit:5,requests:1,requires:['acknowledged-scoped-fault','independent-server-commit-record','protected-retained-journal-within-window'],produces:['lost-intent-binding']});
const disarm=control('control/disarm-and-observe-lost',[lost],['authorized-fault-disarm','independent-server-commit-record','protected-original-request-key-proof-store-binding','journal-within-window-not-settled'],['fault-disarmed','lost-intent-binding'],'submitter','lost-response');
const restart=dispatch('case/restart-no-send','native/restart-no-send','lost_intent_id',[disarm],['fault-disarmed','lost-intent-binding','new-process-unknown-clock-continuity','journal-reconciliation-required-not-settled']);
const ownRead=native('prepare/revoke-own-positive','getWorkspace',[restart],{fixture:'revocation',caseId:null,requires:['same-submitter-current-workspace-read','all-earlier-scenario-invocations-terminal'],produces:['positive-samecredential-read-record']});
const revoke=control('control/revoke-submitter',[ownRead],['positive-samecredential-read-record','all-earlier-scenario-invocations-terminal','explicit-samecredential-revoke-authority'],['acknowledged-samecredential-disable'],'submitter','revocation');
native('case/revoked-after-disable','getWorkspace',[revoke],{fixture:'revocation',caseId:'native/revoked-after-disable',exit:3,status:401,requests:1,requires:['acknowledged-samecredential-disable','fresh-process-same-store-and-credential','current-grant-positive-control-record']});
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const caseIds=steps.flatMap(s=>s.caseId?[s.caseId]:[]).sort();
const executionBudget=steps.filter(s=>s.budget!==null).reduce((sum,s)=>{for(const key of Object.keys(sum))sum[key]+=s.budget[key];return sum;},{processes:0,mutations:0,httpRequests:0});
const externalRequirements=['server-foreign-workspace-denial','server-wrong-runtime-proof-denial'].map(id=>({id,status:id==='server-foreign-workspace-denial'?'source-producer-defined-live-pending':'unimplemented-external-producer',satisfiedByLocalNoSend:false,requires:['separately-authorized-intentionally-bound-fixture','current-relevant-grants-and-causal-positive-control','independent-real-transport-and-server-state-observer','no-existing-protected-store-manipulation','no-native-client-guard-bypass']}));
const scenario=freeze({version:1,caseIds,steps,executionBudget,controlBudget:'external-reservation-required',externalRequirements});
const byId=new Map(steps.map(s=>[s.id,s]));
export function getNativeScenario(){return freeze(structuredClone(scenario));}
const reject=()=>{throw Error('NATIVE_SCENARIO_REJECTED');};
function validPath(value){return typeof value==='string'&&value.length<=4096&&value!=='/'&&isAbsolute(value)&&normalize(value)===value&&!/[\x00-\x1f\x7f]/.test(value);}
function validOrigin(value){try{if(typeof value!=='string'||value.length>2048)return false;const u=new URL(value);return u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&!isIP(u.hostname.replace(/^\[|\]$/g,''))&&u.hostname!=='localhost'&&!u.hostname.endsWith('.localhost');}catch{return false;}}
/** Only syntax and static reference-role checks. This is not authorization. */
export function buildNativeInvocation(stepId,refs){
 try{
  const step=byId.get(stepId);if(!step||step.kind==='control'||!refs||Object.getPrototypeOf(refs)!==Object.prototype)reject();
  const descriptors=Object.getOwnPropertyDescriptors(refs),values=Object.create(null);
  const keys=Reflect.ownKeys(descriptors);if(keys.some(k=>typeof k!=='string')||keys.length!==step.refKeys.length||keys.some(k=>!step.refKeys.includes(k)))reject();
  for(const [key,d] of Object.entries(descriptors)){if(!Object.hasOwn(d,'value')||!d.enumerable||typeof d.value!=='string')reject();const v=d.value;
   if(key==='actor_slot'){if(v!==step.actor)reject();}
   else if(key==='fixture'){if(v!==step.fixture)reject();}
   else if(key==='origin'){if(!validOrigin(v))reject();}
   else if(key.endsWith('_file')||key==='state_directory'){if(!validPath(v))reject();}
   else if(key==='idempotency_key'){if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v))reject();}
   else if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v))reject();
   values[key]=v;
  }
  const args=step.command.split(' ');if(step.resourceKey)args.push(values[step.resourceKey]);args.push('--json','--state-dir='+values.state_directory);
  const flags={origin:'origin',workspace:'workspace',input_file:'input',idempotency_key:'idempotency-key',content_id:'content-id',source_file:'file',output_file:'output'};
  for(const [key,flag] of Object.entries(flags))if(Object.hasOwn(values,key))args.push('--'+flag+'='+values[key]);
  if(step.operation==='searchWorkspace')args.push('--query=conformance','--limit=20');
  else if(operations[step.operation]?.page)args.push('--limit=20');
  return Object.freeze(args);
 }catch{return reject();}
}

/** Additive exact-file pin; historical projections above remain explicitly unpinned. */
export function buildPinnedNativeInvocation(stepId,refs,pin){
 try{
  const args=[...buildNativeInvocation(stepId,refs)],step=byId.get(stepId);
  if(step.refKeys.includes('input_file')){
   if(!pin||Object.getPrototypeOf(pin)!==Object.prototype)reject();
   const d=Object.getOwnPropertyDescriptors(pin);
   if(Reflect.ownKeys(d).length!==2||['sha256','byteSize'].some(k=>!Object.hasOwn(d,k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))reject();
   const sha=d.sha256.value,size=d.byteSize.value;
   if(typeof sha!=='string'||!/^[a-f0-9]{64}$/.test(sha)||!Number.isSafeInteger(size)||size<1||size>65536)reject();
   args.push('--input-sha256='+sha);
  }else if(pin!==null)reject();
  if(args.length>128||args.some(v=>Buffer.byteLength(v,'utf8')>8192)||Buffer.byteLength(JSON.stringify(args),'utf8')>65536)reject();
  return Object.freeze(args);
 }catch{return reject();}
}
