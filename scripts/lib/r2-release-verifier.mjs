import {createHash} from 'node:crypto';
import {createR2Reader,R2_LIMITS,safeR2Path} from './r2-evidence-loader.mjs';
import {validVersionedR2Root,validR2Command,receiptPolicies,receiptPoliciesV3} from './r2-schema-registry.mjs';
import {R2_FEATURES,R2_ROLES,R2_CONFIG_PATHS,R2_COMPOSITION,R2_KINDS,R2_LIVE_KINDS,componentNames} from './r2-release-policy.mjs';
import {ALL_FEATURES} from './release-policy.mjs';
import {validatePreparations,validateCaseFamily,validatePreparationsV2,validateCaseFamilyV2,canonicalCaseSubject} from './r2-case-policy.mjs';
import {validateRecovery,validateResultGraph,references as recoveryReferences} from './r2-recovery-evidence.mjs';
import {validatePlatform,references as platformReferences} from './r2-platform-evidence.mjs';
export const canonicalR2=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonicalR2).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalR2(value[key])).join(',')+'}';
export const hashR2=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>canonicalR2(a)===canonicalR2(b);
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(x=>b.includes(x));
const by=key=>(a,b)=>a[key]<b[key]?-1:a[key]>b[key]?1:0;
const sensitive=text=>/\bBearer\s+[A-Za-z0-9_-]{20,}|cfhub_(?:session|login)=[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i.test(text);
const privateOrigin=text=>[...text.matchAll(/https?:\/\/[^\s"<>]+/g)].some(([value])=>{try{const host=new URL(value).hostname;return !host.endsWith('.invalid')&&!['nodejs.org','github.com','registry.npmjs.org','developers.cloudflare.com','playwright.dev'].includes(host);}catch{return true;}});
const ROOT_RECEIPTS=Object.freeze({review:'r2-review',audit:'r2-audit',deployment:'r2-deployment',preparations:'r2-case-preparations',isolation:'r2-isolation',gates:'r2-gates',native:'r2-native',browser:'r2-browser',recovery:'r2-recovery',result_graph:'r2-result-graph',platform:'r2-platform'});

/** Byte/structural verification only. Protected original records require independent inspection. */
export function verifyR2Release(input,options){
 const findings=[];const fail=(code,path='/')=>findings.push({code,path,message:'R2 evidence does not satisfy the closed verification policy.'});
 const done=()=>({passed:findings.length===0,scope:'structural-only',acceptance:'pending-external-inspection',findings});
 let serialized;try{serialized=JSON.stringify(input);}catch{fail('R2_SCHEMA_INVALID');return done();}
 if(typeof serialized!=='string'||Buffer.byteLength(serialized)>R2_LIMITS.root){fail('R2_BUDGET');return done();}
 if(!validVersionedR2Root(input)){fail('R2_SCHEMA_INVALID');return done();}
 const policies=input.format_version===3?receiptPoliciesV3:receiptPolicies;
 const rootReceipts=input.format_version===3?{...ROOT_RECEIPTS,preparations:'r2-case-preparations-v2'}:ROOT_RECEIPTS;
 const evidenceReservation=(ref,type)=>({ref,category:'evidence',type,bound:policies[type]?.bound??0});
 if(sensitive(serialized)||privateOrigin(serialized))fail('R2_SENSITIVE_EVIDENCE');
 try{
  const reader=createR2Reader({...options,releaseId:input.release_id});
  const prefix='validation/releases/'+input.release_id+'/',sources=new Map(input.files.map(x=>[x.path,x]));
  if(sources.size!==input.files.length)fail('R2_DUPLICATE_SOURCE','/files');
  if(options.files)for(const path of options.files.keys())if(!path.startsWith(prefix)&&!sources.has(path))fail('R2_UNREVIEWED_FILE','/files');
  if(hashR2(canonicalR2([...input.files].sort(by('path'))))!==input.tree_sha256)fail('R2_TREE_DIGEST');
  if(!sameSet(input.features,R2_FEATURES)||!sameSet(input.disabled_features,ALL_FEATURES.filter(x=>!R2_FEATURES.includes(x))))fail('R2_FEATURE_SCOPE');
  if(!sameSet(input.components.map(x=>x.role),R2_ROLES))fail('R2_COMPONENT_ROLES');
  const batch=input.files.map(ref=>({ref,category:'source',type:'source'}));
  for(const component of input.components)for(const file of component.files)batch.push({ref:file.artifact,category:component.role==='operator-cli-source'?'source':'component',type:component.role==='operator-cli-source'?'source':component.role});
  for(const command of input.commands)batch.push({ref:command.artifact,category:'evidence',type:'command',bound:R2_LIMITS.command});
  for(const [key,type]of Object.entries(rootReceipts))batch.push(evidenceReservation(input[key],type));
  // Whole known root batch admitted before any payload read. Nested typed batches
  // are admitted after bounded parent parsing, before reading their children.
  reader.reserveAll(batch);
  for(const entry of input.files)reader.bytes(entry,'source','source');
  if(sources.get('package-lock.json')?.sha256!==input.toolchain.lock_sha256)fail('R2_LOCK_DIGEST');
  const components=[...input.components].map(x=>({...x,files:[...x.files].sort(by('name'))})).sort(by('role'));
  const composition=hashR2(canonicalR2(components));
  for(const component of components){
   if(!sameSet(component.files.map(x=>x.name),componentNames(component.role)))fail('R2_COMPONENT_INVENTORY');
   const config=sources.get(component.configuration_path);
   if(component.configuration_path!==R2_CONFIG_PATHS[component.role]||config?.sha256!==component.configuration_sha256)fail('R2_COMPONENT_CONFIGURATION');
   for(const file of component.files){
    if(component.role==='operator-cli-source'){
     const source=sources.get(file.name);
     if(!source||file.artifact.path!==file.name||source.sha256!==file.artifact.sha256||source.byte_size!==file.artifact.byte_size)fail('R2_SOURCE_COMPONENT');
     reader.bytes(file.artifact,'source','source');
    }else reader.bytes(file.artifact,'component',component.role);
    if(component.role==='application-worker'&&file.name!=='index.js'){
     const sql=R2_COMPOSITION.application_sql.find(x=>x.name===file.name);
     if(!sql||file.artifact.sha256!==sql.sha256||sources.get(sql.source)?.sha256!==sql.sha256)fail('R2_SQL_MODULE');
    }
   }
  }
  const commands=new Map(),kinds=new Set(),ownership=new Map(),commandRecords=new Set();
  for(const metadata of input.commands){
   const command=reader.json(metadata.artifact,'evidence','command',R2_LIMITS.command);
   if(!validR2Command(command)){fail('R2_COMMAND_SCHEMA');continue;}
   const commandText=JSON.stringify(command);
   if(sensitive(commandText)||privateOrigin(commandText))fail('R2_SENSITIVE_EVIDENCE');
   if(commands.has(command.id))fail('R2_DUPLICATE_COMMAND');
   if(commandRecords.has(command.record_sha256))fail('R2_DUPLICATE_COMMAND_RECORD');commandRecords.add(command.record_sha256);
   for(const key of ['id','kind','revision','tree_sha256','environment_id','started_at','ended_at','exit_code','record_sha256'])if(metadata[key]!==command[key])fail('R2_COMMAND_METADATA');
   if(command.revision!==input.revision||command.tree_sha256!==input.tree_sha256||command.environment_id!==input.environment.id||command.composition_sha256!==composition)fail('R2_COMMAND_CANDIDATE');
   if(command.exit_code!==0||command.ended_at<command.started_at)fail('R2_COMMAND_OUTCOME');
   if(command.invocation!=='r2-'+command.kind+'-v1')fail('R2_COMMAND_INVOCATION');
   if(command.provenance==='synthetic'||R2_LIVE_KINDS.includes(command.kind)&&command.provenance!=='real-run')fail('R2_PROVENANCE');
   if(!sameSet(command.case_ids,command.subjects.cases.map(x=>x.case_id)))fail('R2_COMMAND_CASES');
   commands.set(command.id,{...command,prepared_subjects:command.subjects});kinds.add(command.kind);
   for(const result of command.results){
    if(!policies[result.type]||ownership.has(result.artifact.path))fail('R2_RESULT_OWNERSHIP');
    ownership.set(result.artifact.path,{command_id:command.id,...result});
   }
  }
  for(const kind of R2_KINDS)if(!kinds.has(kind))fail('R2_MISSING_COMMAND_KIND');
  const receipts=new Map(),records=new Set();
  const readReceipt=(ref,type)=>{
   const policy=policies[type];if(!policy){fail('R2_RECEIPT_TYPE');return null;}
   const value=reader.json(ref,'evidence',type,policy.bound);
   if(!policy.validate(value)){fail('R2_RECEIPT_SCHEMA');return null;}
   const receiptText=JSON.stringify(value);
   if(sensitive(receiptText)||privateOrigin(receiptText))fail('R2_SENSITIVE_EVIDENCE');
   const command=commands.get(value.command_id),owner=ownership.get(ref.path);
   if(!owner||owner.command_id!==value.command_id||owner.type!==type||!equal(owner.artifact,ref))fail('R2_RESULT_OWNERSHIP');
   if(value.revision!==input.revision||value.tree_sha256!==input.tree_sha256||value.composition_sha256!==composition||value.environment_id!==input.environment.id)fail('R2_RECEIPT_CANDIDATE');
   if(!command||!policy.kinds.includes(command.kind)||value.observed_at<command.started_at||value.observed_at>command.ended_at)fail('R2_RECEIPT_COMMAND');
   if(records.has(value.record_sha256))fail('R2_DUPLICATE_RECORD');records.add(value.record_sha256);
   receipts.set(ref.path,value);return value;
  };
  const values={};for(const [key,type]of Object.entries(rootReceipts))values[key]=readReceipt(input[key],type);
  const nested=[...recoveryReferences(values.recovery),...platformReferences(values.platform)];
  reader.reserveAll(nested.map(({ref,type,maxBytes})=>({...evidenceReservation(ref,type),bound:maxBytes})));
  for(const {ref,type}of nested)readReceipt(ref,type);
  for(const [path]of ownership)if(!receipts.has(path))fail('R2_DISCONNECTED_RESULT');
  const context={candidate:{revision:input.revision,tree_sha256:input.tree_sha256,composition_sha256:composition,author_id:input.author_id},environment:{...input.environment,config_epoch:input.config_epoch},commands,receipts,configuration_sha256:sources.get('wrangler.jsonc')?.sha256};
  const review=values.review;
  if(review&&(review.author_id!==input.author_id||review.reviewer_id===input.author_id||review.observer_id!==review.reviewer_id||review.verdict!=='pass'||review.open_findings.some(x=>['critical','important'].includes(x.severity))))fail('R2_INDEPENDENT_REVIEW');
  const audit=values.audit;
  if(audit&&(audit.node!==input.toolchain.node||audit.npm!==input.toolchain.npm||audit.lock_sha256!==input.toolchain.lock_sha256||!audit.embedded_inventory_complete||audit.advisories.length||audit.packages.some(x=>!safeR2Path(x.path))))fail('R2_DEPENDENCY_AUDIT');
  if(values.deployment)verifyDeployment(values.deployment,input,components,fail);
  if(values.recovery)findings.push(...validateRecovery(values.recovery,context));
  if(values.result_graph)findings.push(...validateResultGraph(values.result_graph,context));
  if(values.platform)findings.push(...validatePlatform(values.platform,context));
  if(values.preparations){
   const caseContext={commands,preparations:values.preparations,subjectDigests:new Map(values.preparations.subjects.map(x=>[x.case_id,hashR2(canonicalCaseSubject(x.subject))])),workspaceId:input.environment.workspace_id,configEpoch:input.config_epoch,nativeExecutableSha256:components.find(x=>x.role==='native-cli')?.files[0]?.artifact.sha256,uiAssetsSha256:hashR2(canonicalR2(components.find(x=>x.role==='ui-assets')?.files??[])),resultGraphSha256:input.result_graph.sha256};
   findings.push(...(input.format_version===3?validatePreparationsV2:validatePreparations)(values.preparations,caseContext));
   for(const family of ['isolation','gates','native','browser'])if(values[family])findings.push(...(input.format_version===3?validateCaseFamilyV2:validateCaseFamily)(values[family],caseContext));
  }
 }catch(error){fail(typeof error?.message==='string'&&/^R2_[A-Z_]+$/.test(error.message)?error.message:'R2_EVIDENCE_UNAVAILABLE');}
 for(const finding of findings)if(typeof finding.path!=='string')finding.path='/typed-evidence';
 return done();
}
function verifyDeployment(value,input,components,fail){
 if(value.workspace_id!==input.environment.workspace_id||value.object_name!==input.environment.object_name||value.config_epoch!==input.config_epoch||value.schema_version!==16||value.previous_revision===input.revision||value.isolation_record_sha256!==input.environment.isolation_record_sha256||!sameSet(value.components.map(x=>x.role),R2_ROLES))fail('R2_DEPLOYMENT_IDENTITY');
 const app=value.components.find(x=>x.role==='application-worker'),provider=value.components.find(x=>x.role==='anchor-provider');
 if(!app?.namespace_id||!provider?.namespace_id||app.namespace_id===provider.namespace_id)fail('R2_DEPLOYMENT_NAMESPACE');
 for(const record of value.components){
  const component=components.find(x=>x.role===record.role),role=record.role;
  if(!component||record.configuration_sha256!==component.configuration_sha256||record.artifact_inventory_sha256!==hashR2(canonicalR2(component.files))||record.environment_id!==input.environment.id)fail('R2_DEPLOYMENT_COMPONENT');
  if(['application-worker','operator-worker','anchor-provider'].includes(role)){
   if(!record.deployment_id||!record.worker_version)fail('R2_DEPLOYMENT_APPLICABILITY');
  }else if(role==='ui-assets'){
   if(record.deployment_id!==input.environment.deployment_id||record.worker_version!==input.environment.worker_version)fail('R2_DEPLOYMENT_APPLICABILITY');
  }else if(record.deployment_id!==null||record.worker_version!==null)fail('R2_DEPLOYMENT_APPLICABILITY');
  if(role==='application-worker'&&(record.deployment_id!==input.environment.deployment_id||record.worker_version!==input.environment.worker_version))fail('R2_DEPLOYMENT_IDENTITY');
  if(!['application-worker','anchor-provider'].includes(role)&&record.namespace_id!==null)fail('R2_DEPLOYMENT_APPLICABILITY');
  const bindings=role==='application-worker'?[{kind:'service',name:'RECOVERY_ANCHOR',target_role:'anchor-provider',entrypoint:'default'}]:role==='operator-worker'?[{kind:'durable-object',name:'WORKSPACE',target_role:'application-worker',entrypoint:'WorkspaceDO'}]:[];
  if(!equal(record.bindings,bindings))fail('R2_DEPLOYMENT_BINDINGS');
 }
}
