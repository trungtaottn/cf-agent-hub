import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {R1_FEATURES,ALL_FEATURES,R1_OPERATIONS,AUTH_LANES,REQUIRED_GATES,REQUIRED_KINDS,REQUIRED_RECOVERY_STEPS,REQUIRED_RECOVERY_CHECKS,ACCEPTED_GATE_OUTCOME,routeExpectation} from './lib/release-policy.mjs';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
export function fileManifest(files){return [...files].map(([path,value])=>({path,sha256:sha256(value),byte_size:Buffer.byteLength(value),mode:'100644'})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);}
const ajv=new Ajv2020({allErrors:true,strict:false});addFormats(ajv);
const evidenceSchema=JSON.parse(readFileSync(new URL('../validation/runtime-evidence.schema.json',import.meta.url),'utf8'));
const validate=ajv.compile(evidenceSchema);
const receiptValidators=Object.fromEntries(['review_receipt','audit_receipt','recovery_receipt','recovery_step','deployment_receipt'].map(name=>[name,ajv.compile({$ref:evidenceSchema.$id+'#/$defs/'+name})]));
const safePath=path=>typeof path==='string'&&path.length>0&&path.length<=512&&!path.includes('\\')&&!/[\u0000-\u001f\u007f]/.test(path)&&!path.startsWith('/')&&path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..')&&!/^[a-z]:/i.test(path);
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&b.every(x=>a.includes(x));
const hasSecret=text=>/\bBearer\s+[A-Za-z0-9_-]{20,}|cfhub_(?:session|login)=[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i.test(text);
const hasPrivateOrigin=text=>[...text.matchAll(/https?:\/\/[^\s"<>]+/g)].some(([url])=>{try{const host=new URL(url).hostname;return !host.endsWith('.invalid')&&!['nodejs.org','github.com','registry.npmjs.org','developers.cloudflare.com','playwright.dev'].includes(host);}catch{return true;}});
/** Structural/byte verification only. The controller must inspect the actual runs and independent review. */
export function verifyRelease(input,files){
 const findings=[];const fail=(code,path,message)=>findings.push({code,path,message});
 let serialized;try{serialized=JSON.stringify(input);}catch{fail('INVALID_EVIDENCE','/','Evidence must be finite JSON.');return {passed:false,findings};}
 if(typeof serialized!=='string'||Buffer.byteLength(serialized)>4*1024*1024){fail('EVIDENCE_LIMIT','/','Evidence exceeds its bounded representation.');return {passed:false,findings};}
 if(hasSecret(serialized)||hasPrivateOrigin(serialized))fail('SENSITIVE_EVIDENCE','/','Evidence contains a forbidden credential or private origin.');
 if(!validate(input)){for(const error of (validate.errors??[]).slice(0,40))fail('SCHEMA_INVALID',error.instancePath||'/','Evidence does not match the closed runtime schema.');return {passed:false,findings};}
 if(!(files instanceof Map)){fail('FILES_REQUIRED','/files','Reviewed bytes are required.');return {passed:false,findings};}
 const prefix='validation/releases/'+input.release_id+'/';
 const readArtifactBytes=(ref,label,bound=4*1024*1024)=>{
  if(!safePath(ref.path)||!ref.path.startsWith(prefix)){fail('ARTIFACT_PATH',label,'Artifact must be inside this release evidence directory.');return null;}
  const value=files.get(ref.path);if(value===undefined){fail('ARTIFACT_MISSING',label,'Required artifact bytes are absent.');return null;}
  const bytes=Buffer.from(value);if(bytes.byteLength>bound||sha256(bytes)!==ref.sha256){fail('ARTIFACT_DIGEST',label,'Artifact bytes differ from the recorded digest or exceed the bound.');return null;}
  return bytes;
 };
 const readArtifact=(ref,label,receiptType=null)=>{
  const bytes=readArtifactBytes(ref,label);if(!bytes)return null;
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('ARTIFACT_ENCODING',label,'Evidence artifact must be UTF-8.');return null;}
  if(hasSecret(text)||hasPrivateOrigin(text)){fail('SENSITIVE_ARTIFACT',label,'Artifact contains forbidden credential or private-origin material.');return null;}
  if(!receiptType)return text;
  let value;try{value=JSON.parse(text);}catch{fail('ARTIFACT_JSON',label,'Structured receipt is not valid JSON.');return null;}
  if(!receiptValidators[receiptType](value)){fail('RECEIPT_SCHEMA',label,'Receipt does not match its closed, versioned shape.');return null;}
  return value;
 };
 const paths=new Set();
 for(const entry of input.files){
  if(!safePath(entry.path)||entry.path.startsWith(prefix)||entry.path.split('/').some(x=>['.git','node_modules','.superpowers'].includes(x))){fail('SOURCE_PATH','/files','Source inventory contains an invalid path.');continue;}
  if(paths.has(entry.path))fail('DUPLICATE_PATH','/files','Each source path must occur exactly once.');paths.add(entry.path);
  const bytes=files.get(entry.path);if(bytes===undefined||Buffer.byteLength(bytes)!==entry.byte_size||sha256(bytes)!==entry.sha256)fail('UNREVIEWED_BYTES','/files/'+entry.path,'Source bytes differ from the reviewed inventory.');
 }
 for(const path of files.keys())if(!path.startsWith(prefix)&&!paths.has(path))fail('UNREVIEWED_FILE','/files','A source file is missing from the reviewed inventory.');
 const ordered=[...input.files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(sha256(canonical(ordered))!==input.tree_sha256)fail('TREE_DIGEST','/tree_sha256','Candidate tree digest does not match the file inventory.');
 const lock=files.get('package-lock.json');if(lock===undefined||sha256(lock)!==input.toolchain.lock_sha256)fail('LOCK_DIGEST','/toolchain/lock_sha256','Locked dependency bytes do not match.');
 const commands=new Map(),kinds=new Set();
 for(const command of input.commands){
  if(commands.has(command.id))fail('DUPLICATE_COMMAND','/commands','Command IDs must be unique.');commands.set(command.id,command);
  if(command.exit_code!==0)fail('FAILED_COMMAND','/commands/'+command.id,'A required command did not succeed.');
  if(command.revision!==input.revision||command.tree_sha256!==input.tree_sha256)fail('COMMAND_IDENTITY','/commands/'+command.id,'Command evidence belongs to different candidate bytes.');
  if(Date.parse(command.ended_at)<Date.parse(command.started_at))fail('COMMAND_TIME','/commands/'+command.id,'Command end precedes its start.');
  for(const kind of command.kinds)kinds.add(kind);readArtifact(command.artifact,'/commands/'+command.id);
 }
 for(const kind of REQUIRED_KINDS)if(!kinds.has(kind))fail('MISSING_COMMAND_GATE','/commands','Missing required gate: '+kind+'.');
 const build=readArtifactBytes(input.build.artifact,'/build',16*1024*1024);
 if(!build||build.byteLength!==input.build.artifact.byte_size||!commands.get(input.build.command_id)?.kinds.includes('build'))fail('BUILD_REQUIRED','/build','Exact reviewed build bytes and a successful build command are required.');
 const assertions=new Map();
 for(const assertion of input.assertions){
  if(assertions.has(assertion.id))fail('DUPLICATE_ASSERTION','/assertions','Assertion IDs must be unique.');assertions.set(assertion.id,assertion);
  const expected=REQUIRED_GATES[assertion.id];
  if(!expected){fail('UNKNOWN_GATE','/assertions/'+assertion.id,'Unknown R1 runtime gate.');continue;}
  const command=commands.get(assertion.command_id);
  if(!command)fail('ASSERTION_COMMAND','/assertions/'+assertion.id,'Assertion has no command evidence.');
  else{
   const required=assertion.environment==='workers'?'workers-tests':assertion.environment==='browser'?'browser-tests':assertion.environment==='node'?'node-tests':assertion.id==='isolated_recovery_roundtrip'?'deployed-recovery':'deployed-ingress';
   if(!command.kinds.includes(required))fail('ASSERTION_COMMAND_KIND','/assertions/'+assertion.id,'Assertion is unsupported by the recorded command gate.');
   if(assertion.environment==='isolated-deployment'&&command.environment_id!==input.environment.id)fail('ASSERTION_TARGET','/assertions/'+assertion.id,'Deployed assertion targets a different environment.');
  }
  if(assertion.status!=='passed'||assertion.expected!==ACCEPTED_GATE_OUTCOME||assertion.observed!==ACCEPTED_GATE_OUTCOME)fail('ASSERTION_NOT_PASSED','/assertions/'+assertion.id,'Aggregate outcome must satisfy the policy-owned pass predicate.');
  if(assertion.environment!==expected.environment||!sameSet(assertion.feature_ids,expected.features))fail('GATE_BINDING','/assertions/'+assertion.id,'Runtime gate environment or feature binding differs from R1 policy.');
 }
 for(const id of Object.keys(REQUIRED_GATES))if(!assertions.has(id))fail('MISSING_FEATURE_GATE','/assertions','Missing required assertion: '+id+'.');
 const matrix=new Set();
 for(const row of input.route_matrix){
  const key=row.operation+':'+row.lane;
  if(matrix.has(key)||!R1_OPERATIONS.includes(row.operation)||!AUTH_LANES.includes(row.lane)||row.status!=='passed'||!commands.get(row.command_id)?.kinds.includes('workers-tests'))fail('ROUTE_MATRIX_INVALID','/route_matrix','Route/lane scenario is duplicate, unknown, failed, or lacks runtime evidence.');
  const expected=routeExpectation(row.operation,row.lane),observed=row.observed;
  if(expected){
   const changes=Object.values(expected.mutations).some(value=>value!==0);
   if(observed.http_status!==expected.status||observed.error_code!==expected.error_code||!observed.response_contract_valid||!observed.target_bound||canonical(observed.mutations)!==canonical(expected.mutations)||(observed.sql_before_sha256!==observed.sql_after_sha256)!==changes)fail('ROUTE_OUTCOME','/route_matrix/'+key,'HTTP, response identity, and exact persistent effects must satisfy the policy-owned route scenario.');
  }
  matrix.add(key);
 }
 for(const operation of R1_OPERATIONS)for(const lane of AUTH_LANES)if(!matrix.has(operation+':'+lane))fail('MISSING_ROUTE_SCENARIO','/route_matrix','Missing route/lane scenario: '+operation+':'+lane+'.');
 if(!sameSet(input.features.map(x=>x.id),R1_FEATURES)||input.features.some(x=>x.status!=='verified'))fail('FEATURE_SCOPE','/features','R1 verification requires exactly its implemented capability set; publication is a separate gate.');
 if(!sameSet(input.disabled_features,ALL_FEATURES.filter(id=>!R1_FEATURES.includes(id))))fail('DISABLED_SCOPE','/disabled_features','Later-round capabilities must remain explicitly unavailable.');
 const sameCandidate=receipt=>receipt.revision===input.revision&&receipt.tree_sha256===input.tree_sha256;
 const review=readArtifact(input.review.artifact,'/review','review_receipt');
 if(!input.review.independent||input.review.reviewer_id===input.author_id||!review||review.reviewer_id!==input.review.reviewer_id||review.author_id!==input.author_id||review.reviewer_id===review.author_id||!sameCandidate(review)||review.build_artifact_sha256!==input.build.artifact.sha256||review.verdict!=='pass'||review.open_findings.some(x=>['critical','important'].includes(x.severity)))fail('REVIEW_REQUIRED','/review','Independent review of these source and build bytes with no blocking finding is required.');
 const audit=readArtifact(input.toolchain.audit_artifact,'/toolchain/audit_artifact','audit_receipt');
 if(input.toolchain.audit_status!=='passed'||!audit||!sameCandidate(audit)||audit.lock_sha256!==input.toolchain.lock_sha256||audit.node!==input.toolchain.node||audit.npm!==input.toolchain.npm||audit.advisories.length||audit.embedded_inventory_complete!==true||audit.packages.some(x=>!safePath(x.path)))fail('DEPENDENCY_GATE','/toolchain','Audit must cover the exact candidate lock, toolchain, and structured installed/embedded package inventory.');
 const recovery=readArtifact(input.recovery.artifact,'/recovery','recovery_receipt');
 const recoveryIdentity={
  workspace_id:input.environment.workspace_id,capture_id:input.recovery.capture_id,
  source_job_id:input.recovery.source_job_id,target_job_id:input.recovery.target_job_id,
  source_environment_id:input.recovery.source_environment_id,target_environment_id:input.environment.id,
  source_object_name:input.recovery.source_object_name,target_object_name:input.environment.object_name,
  source_epoch:input.recovery.source_epoch,target_epoch:input.config_epoch,schema_version:input.schema_version
 };
 const matchesRecovery=receipt=>Object.entries(recoveryIdentity).every(([key,value])=>receipt[key]===value);
 if(!recovery||!matchesRecovery(recovery)||recovery.environment_id!==input.environment.id||recovery.source_environment_id===recovery.target_environment_id||recovery.target_epoch<=recovery.source_epoch||recovery.source_retired!==true||recovery.target_resumed!==true||recovery.unresolved_effect_ids.length||!sameSet(recovery.steps.map(x=>x.operation),REQUIRED_RECOVERY_STEPS))fail('RECOVERY_REQUIRED','/recovery','Complete isolated recovery with matching workspace, capture, jobs and positive authority epochs is required.');
 if(recovery){
  const receiptIds=new Set();
  for(const step of recovery.steps){
   const label='/recovery/steps/'+step.operation;
   const receipt=readArtifact(step.artifact,label,'recovery_step');
   const command=commands.get(step.command_id),checks=REQUIRED_RECOVERY_CHECKS[step.operation];
   if(receiptIds.has(step.receipt_id)||!checks||!step.passed||!command?.kinds.includes('deployed-recovery')||command.environment_id!==input.environment.id||!receipt||!matchesRecovery(receipt)||receipt.operation!==step.operation||receipt.receipt_id!==step.receipt_id||!sameSet(Object.keys(receipt.observations),checks)||checks.some(key=>receipt.observations[key]!==true))fail('RECOVERY_STEP','/recovery/steps/'+step.operation,'A unique, operation-specific receipt with all policy observations and matching recovery identity is required.');
   receiptIds.add(step.receipt_id);
  }
 }
 const deployment=readArtifact(input.deployment.artifact,'/deployment','deployment_receipt');
 if(!deployment||!sameCandidate(deployment)||deployment.environment_id!==input.environment.id||deployment.deployment_id!==input.environment.deployment_id||deployment.worker_version!==input.environment.worker_version||deployment.workspace_id!==input.environment.workspace_id||deployment.object_name!==input.environment.object_name||deployment.schema_version!==input.schema_version||deployment.config_epoch!==input.config_epoch||deployment.artifact_sha256!==input.build.artifact.sha256||deployment.previous_revision===input.revision)fail('DEPLOYMENT_REQUIRED','/deployment','Deployment must match the reviewed build bytes, deployment identity and known recovery path.');
 return {passed:findings.length===0,findings};
}
function loadFile(root,path){
 if(!safePath(path))throw Error('INVALID_EVIDENCE_PATH');
 const absolute=resolve(root,path),relation=relative(root,absolute);
 const stat=lstatSync(absolute);
 if(isAbsolute(relation)||relation==='..'||relation.startsWith('..'+sep)||realpathSync(absolute)!==absolute||!stat.isFile()||stat.size>16*1024*1024)throw Error('INVALID_EVIDENCE_PATH');
 return readFileSync(absolute);
}
export function runCli(argv=process.argv.slice(2),root=process.cwd()){
 try{
  if(argv.length!==4||argv[0]!=='--round'||argv[1]!=='R1'||argv[2]!=='--evidence')throw Error('USAGE');
  const path=relative(root,resolve(root,argv[3])).split(sep).join('/'),input=JSON.parse(loadFile(root,path).toString('utf8'));
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  const names=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  const prefix='validation/releases/'+input.release_id+'/';
  const files=new Map();for(const name of new Set(names))if(!name.startsWith(prefix))files.set(name,loadFile(root,name));
  const refs=[...(input.commands??[]).map(x=>x.artifact),input.review?.artifact,input.recovery?.artifact,input.deployment?.artifact,input.toolchain?.audit_artifact,input.build?.artifact].filter(Boolean);
  for(const ref of refs)files.set(ref.path,loadFile(root,ref.path));
  const recoveryBytes=files.get(input.recovery?.artifact?.path);
  if(recoveryBytes&&recoveryBytes.byteLength<=4*1024*1024){
   const receipt=JSON.parse(recoveryBytes.toString('utf8'));
   if(receiptValidators.recovery_receipt(receipt))for(const step of receipt.steps)files.set(step.artifact.path,loadFile(root,step.artifact.path));
  }
  const result=verifyRelease(input,files);
  const staged=execFileSync('git',['ls-files','--stage','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  const modes=new Map(staged.map(line=>{const tab=line.indexOf('\t');return [line.slice(tab+1),line.slice(0,6)];}));
  for(const entry of input.files??[])if(modes.get(entry.path)!==entry.mode)result.findings.push({code:'FILE_MODE',path:'/files',message:'Recorded file mode differs from the committed candidate.'});
  if(head!==input.revision)result.findings.push({code:'REVISION_MISMATCH',path:'/revision',message:'Evidence revision does not match the checked-out commit.'});
  const dirty=execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}).split('\n').filter(Boolean).filter(line=>!line.slice(3).startsWith(prefix));
  if(dirty.length)result.findings.push({code:'UNCOMMITTED_CANDIDATE',path:'/',message:'A release candidate must be a committed, independently reviewed revision.'});
  result.passed=result.findings.length===0;process.stdout.write(JSON.stringify(result)+'\n');return result.passed?0:1;
 }catch{process.stdout.write(JSON.stringify({passed:false,findings:[{code:'EVIDENCE_UNAVAILABLE',path:'/',message:'Supply --round R1 --evidence with bounded, valid candidate/evidence paths in the intended Git checkout.'}]})+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=runCli();
