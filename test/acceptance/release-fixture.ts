import {canonical,fileManifest,sha256} from '../../scripts/verify-release.mjs';
import {R1_FEATURES,ALL_FEATURES,REQUIRED_GATES,REQUIRED_KINDS,R1_OPERATIONS,AUTH_LANES,REQUIRED_RECOVERY_STEPS,REQUIRED_RECOVERY_CHECKS,routeExpectation} from '../../scripts/lib/release-policy.mjs';

/** Deliberately synthetic verifier unit input. Never exported as runtime evidence. */
export function evidenceFixture(){
 const files=new Map<string,string>([['src/index.ts','export default {};\n'],['package-lock.json','{"lockfileVersion":3}\n']]);
 const entries=fileManifest(files),tree=sha256(canonical(entries)),revision='a'.repeat(40);
 const artifact=(name:string,value:unknown)=>{
  const path='validation/releases/unit-only/'+name;
  const body=typeof value==='string'?value:JSON.stringify(value);
  files.set(path,body);return {path,sha256:sha256(body)};
 };
 const identity={format_version:1,revision,tree_sha256:tree};
 const log=artifact('commands.log','UNIT FIXTURE: no product execution is asserted.\n');
 const bundle='// UNIT FIXTURE: not a deployable application.\n';
 const build={artifact:{...artifact('worker-bundle.js',bundle),byte_size:Buffer.byteLength(bundle)},command_id:'command_all'};
 const review=artifact('review.json',{
  ...identity,reviewer_id:'independent_reviewer',author_id:'implementation_author',
  build_artifact_sha256:build.artifact.sha256,verdict:'pass',open_findings:[]
 });
 const audit=artifact('dependencies.json',{
  ...identity,node:'24.22.1',npm:'11.19.1',lock_sha256:sha256(files.get('package-lock.json')!),
  advisories:[],embedded_inventory_complete:true,
  packages:[{name:'synthetic_fixture',version:'0.0.0',kind:'installed',path:'node_modules/synthetic_fixture/package.json',sha256:sha256('unit-package')}]
 });
 const recoveryContext={
  workspace_id:'workspace_fixture',capture_id:'capture_fixture',source_job_id:'capture_job_fixture',target_job_id:'restore_job_fixture',
  source_environment_id:'isolated_source',target_environment_id:'isolated_target',
  source_object_name:'source_object_fixture',target_object_name:'target_object_fixture',
  source_epoch:3,target_epoch:4,schema_version:7
 };
 const steps=REQUIRED_RECOVERY_STEPS.map(operation=>{
  const receipt_id='receipt_'+operation;
  const receipt={format_version:1,...recoveryContext,operation,receipt_id,protocol_receipt_sha256:sha256('unit-protocol-'+operation),observations:Object.fromEntries(REQUIRED_RECOVERY_CHECKS[operation].map(key=>[key,true]))};
  return {operation,receipt_id,passed:true,command_id:'command_all',artifact:artifact('step-'+operation+'.json',receipt)};
 });
 const recovery=artifact('recovery.json',{format_version:1,environment_id:'isolated_target',...recoveryContext,unresolved_effect_ids:[],source_retired:true,target_resumed:true,steps});
 const deployment=artifact('deployment.json',{
  ...identity,environment_id:'isolated_target',deployment_id:'deployment_fixture',worker_version:'worker_fixture',
  workspace_id:'workspace_fixture',object_name:'target_object_fixture',artifact_sha256:build.artifact.sha256,
  schema_version:7,config_epoch:4,previous_revision:'b'.repeat(40),compatibility:'compatible'
 });
 const input:any={
  ...identity,round:'R1',release_id:'unit-only',author_id:'implementation_author',
  environment:{id:'isolated_target',class:'isolated-deployment',deployment_id:'deployment_fixture',worker_version:'worker_fixture',workspace_id:'workspace_fixture',object_name:'target_object_fixture'},
  toolchain:{node:'24.22.1',npm:'11.19.1',lock_sha256:sha256(files.get('package-lock.json')!),audit_status:'passed',audit_artifact:audit},
  schema_version:7,config_epoch:4,files:entries,build,
  commands:[{id:'command_all',command:'UNIT FIXTURE - never real evidence',kinds:[...REQUIRED_KINDS],exit_code:0,environment_id:'isolated_target',revision,tree_sha256:tree,started_at:'2026-10-25T04:00:00.000Z',ended_at:'2026-10-25T04:00:01.000Z',artifact:log}],
  assertions:Object.entries(REQUIRED_GATES).map(([id,gate])=>({id,feature_ids:gate.features,status:'passed',environment:gate.environment,command_id:'command_all',expected:'pass',observed:'pass'})),
  route_matrix:R1_OPERATIONS.flatMap(operation=>AUTH_LANES.map(lane=>{
   const expected=routeExpectation(operation,lane)!;
   const changes=Object.values(expected.mutations).some(value=>value!==0);
   return {operation,lane,status:'passed',command_id:'command_all',observed:{http_status:expected.status,error_code:expected.error_code,response_contract_valid:true,target_bound:true,sql_before_sha256:sha256('before'),sql_after_sha256:sha256(changes?'after':'before'),mutations:expected.mutations}};
  })),
  features:R1_FEATURES.map(id=>({id,status:'verified'})),disabled_features:ALL_FEATURES.filter(id=>!R1_FEATURES.includes(id)),
  review:{reviewer_id:'independent_reviewer',independent:true,artifact:review},
  recovery:{capture_id:recoveryContext.capture_id,source_job_id:recoveryContext.source_job_id,target_job_id:recoveryContext.target_job_id,source_environment_id:recoveryContext.source_environment_id,source_object_name:recoveryContext.source_object_name,source_epoch:recoveryContext.source_epoch,artifact:recovery},
  deployment:{artifact:deployment},known_exceptions:[]
 };
 return {input,files};
}
