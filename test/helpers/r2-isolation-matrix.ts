import spec from '../../spec/openapi.json';
import {clientOperations,type EnabledOperationId} from '../../src/http/generated/client-operations';
export type IsolationLane='human'|'native'|'public';
export interface IsolationOperation {operation:EnabledOperationId;lanes:readonly IsolationLane[];authority:string;condition:'installed'|'artifact-binding';}
const group=(operations:readonly EnabledOperationId[],lanes:readonly IsolationLane[],authority:string,condition:IsolationOperation['condition']='installed'):IsolationOperation[]=>operations.map(operation=>({operation,lanes,authority,condition}));
/** Independently enumerated cases. Never derive this list from the source inventory under test. */
export const isolationOperations:IsolationOperation[]=[
 ...group(['getWorkspace','getConfiguration','getProfile'],['human','native'],'workspace:read'),
 ...group(['listTasks','getTask','getRun','listTaskResults'],['human','native'],'tasks:read + current resource graph'),
 ...group(['createTask'],['human','native'],'tasks:create'),
 ...group(['patchTask'],['human','native'],'tasks:edit'),
 ...group(['readyTask','requeueTask'],['human','native'],'tasks:schedule'),
 ...group(['cancelTask'],['human','native'],'tasks:cancel'),
 ...group(['claimTask'],['native'],'tasks:claim + tasks:execute + installed policy + exact runtime proof'),
 ...group(['submitTaskResult','failTask','heartbeatRun'],['native'],'tasks:execute + current lease/fence/runtime'),
 ...group(['acceptTaskResult'],['human','native'],'tasks:review + independent principal'),
 ...group(['listAgents','getAgent'],['human','native'],'agents:read'),
 ...group(['createAgent','patchAgent','archiveAgent'],['human'],'agents:manage + human-only'),
 ...group(['listCredentials','createCredential','revokeCredential'],['human'],'credentials:manage + human-only/delegation ceiling'),
 ...group(['createRuntime','heartbeatRuntime'],['native'],'runtimes:manage + credential-bound runtime'),
 ...group(['createMessage'],['human','native'],'messages:send + fixed participants/current reference graph'),
 ...group(['getInbox'],['native'],'messages:read + own recipient'),
 ...group(['getThread'],['human','native'],'messages:read + participant or current human review'),
 ...group(['ackMessages'],['native'],'messages:ack + own recipient'),
 ...group(['listArtifacts','getArtifact','downloadArtifactContent'],['human','native'],'artifacts:read + current graph','artifact-binding'),
 ...group(['stageArtifact','uploadArtifactContent','commitArtifact'],['human','native'],'artifacts:write + owner, native exact runtime','artifact-binding'),
 ...group(['searchWorkspace'],['human','native'],'search:read + each underlying scope/current graph'),
 ...group(['listEvents'],['human','native'],'events:read + current referenced resource rights'),
 ...group(['startAuth'],['public'],'verified configured origin + bounded login'),
 ...group(['getAuthSession','logoutAuth'],['human'],'current original session; logout CSRF'),
 ...group(['putProfile','previewProfile','exportProfile','previewCatalogChange','applyCatalogChange'],['human'],'profile:edit + human-only'),
 ...group(['getPreferences','putPreferences'],['human'],'workspace:read + original human'),
 ...group(['getOperations','getReadiness'],['human'],'operations:read + human-only'),
 ...group(['previewImport','applyImport','getImport'],['human'],'imports:manage + tasks:read; apply also tasks:create; owner/current reference graph'),
];
// These two R3 browser-only reads have executable isolation/nonmutation coverage in
// test/workspace/creation-reconciliation.test.ts. They must not expand frozen R2
// acceptance receipts. Any other new operation still fails this exact split.
const r3RecoveryOperations=group(['reconcileMessageCreation','reconcileTaskCreation'],['human'],'current creation authority + retained resource replay visibility');
export function assertIsolationCoverage(cases:readonly IsolationOperation[]):void{
 for(const row of r3RecoveryOperations){const operation=clientOperations[row.operation];if(!operation||operation.native||operation.runtimeProof||operation.method!=='POST'||operation.status!==200)throw Error('R3 recovery operation boundary mismatch: '+row.operation);}
 const expected=Object.keys(clientOperations).filter(name=>!r3RecoveryOperations.some(row=>row.operation===name)).sort(),actual=cases.map(x=>x.operation).sort();
 if(new Set(actual).size!==actual.length||JSON.stringify(expected)!==JSON.stringify(actual))throw Error('Isolation operation coverage mismatch: missing '+expected.filter(x=>!actual.includes(x as EnabledOperationId)).join(',')+' extra '+actual.filter(x=>!expected.includes(x)).join(','));
 const canonical=new Map(Object.values(spec.paths).flatMap(item=>Object.values(item).filter(value=>value&&typeof value==='object'&&'operationId' in value).map(value=>{const op=value as {operationId:string;security?:Record<string,unknown>[]};return [op.operationId,op.security??[]] as const;})));
 for(const row of [...cases,...r3RecoveryOperations]){const security=canonical.get(row.operation)!;const lanes: IsolationLane[]=security.length===0?['public']:[...(security.some(x=>'HumanSession'in x)?['human' as const]:[]),...(security.some(x=>'NativeBearer'in x)?['native' as const]:[])];if(JSON.stringify([...row.lanes].sort())!==JSON.stringify(lanes.sort()))throw Error('Isolation lane coverage mismatch: '+row.operation);if(!row.lanes.length||new Set(row.lanes).size!==row.lanes.length||!row.authority)throw Error('Isolation lane coverage missing: '+row.operation);if(clientOperations[row.operation].native!==row.lanes.includes('native'))throw Error('Native lane mismatch: '+row.operation);}
}
export const isolationCells=()=>isolationOperations.flatMap(row=>row.lanes.map(lane=>({...row,lane})));
/** Receipts are written only after real assertions finish; metadata/collection alone never counts. */
export const isolationEvidence=new Set<string>();
export const recordIsolationEvidence=(operation:string,lane:string,phase:string)=>isolationEvidence.add(operation+'/'+lane+'/'+phase);
export function requiredIsolationEvidence():string[]{
 const keys:string[]=[];
 for(const row of isolationOperations){
  for(const lane of row.lanes)for(const phase of ['authorized','foreign-workspace'])keys.push(row.operation+'/'+lane+'/'+phase);
  if(!row.lanes.includes('public'))for(const lane of ['human','native'] as const)if(!row.lanes.includes(lane))keys.push(row.operation+'/'+lane+'/forbidden');
  if(row.lanes.includes('native'))for(const phase of ['native-facade','native-revoked-after-eviction'])keys.push(row.operation+'/native/'+phase);
  if(row.condition==='artifact-binding')for(const lane of row.lanes)for(const phase of ['missing-binding','aliased-binding'])keys.push(row.operation+'/'+lane+'/'+phase);
 }
 for(const operation of ['requestTaskDecision','listApprovals','getApproval','approveApproval','rejectApproval'])for(const lane of ['human','native'])keys.push(operation+'/'+lane+'/unavailable');
 return [...keys,...isolationBoundaryKeys].sort();
}

/** Cross-operation phases have independently named receipts, not inferred operation support. */
export const isolationBoundaryKeys=[
 ...['human','native'].flatMap(lane=>[
  'resources/'+lane+'/foreign-graph','createTask/'+lane+'/missing-policy','workspace/'+lane+'/maintenance',
  ...['revoke','expire'].map(change=>'authority/'+lane+'/'+change+'-after-eviction'),
  ...['encrypt','decrypt'].map(phase=>'listTasks/'+lane+'/cursor-'+phase),
  ...['fresh','retained-replay'].map(mode=>'createTask/'+lane+'/fingerprint-'+mode),
  ...['commitArtifact','downloadArtifactContent'].map(op=>op+'/'+lane+'/after-r2-read'),
 ]),
 'imports/human/same-workspace-other-owner','tasks/native/foreign-task-own-run','catalog/human/remap-scope','receipts/native/result-acceptance','runtime/native/different-proof',
 'grants/native/no-union','idempotency/human/namespace','dispatcher/native/post-signing',
 'routing/public/no-fallback','auth/public/callback-workspace',
 ...['native-profile','human-session','native-maintenance'].map(name=>'publication/'+name+'/no-final-await'),
 'scheduler/system/failed-arm-restart-retry',
];
export function assertIsolationEvidence(actual:ReadonlySet<string>):void{
 const expected=requiredIsolationEvidence();const missing=expected.filter(key=>!actual.has(key)),extra=[...actual].filter(key=>!expected.includes(key));
 if(missing.length||extra.length)throw Error('Isolation phase coverage mismatch: missing '+missing.join(',')+' extra '+extra.join(','));
}
