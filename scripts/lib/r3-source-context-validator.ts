/** Source-only comparison. Pre-command bytes are supplied separately, never inferred from outcomes. */
import {createHash} from 'node:crypto';
import {canonicalJson} from '../../src/config/bootstrap';
import {assertR3LocalObservation} from '../../test/helpers/r3-journey-observation';
import {assertJ1PrecommandContext} from '../../test/helpers/r3-precommand-context';
const typed=Object.getPrototypeOf(Uint8Array.prototype),size=Object.getOwnPropertyDescriptor(typed,'byteLength')!.get!,backing=Object.getOwnPropertyDescriptor(typed,'buffer')!.get!,abSize=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!,resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
function bad(code='R3_CONTEXT_JOIN_INVALID'):never{throw Error(code);}
function copy(value:unknown,cap:number,allowEmpty=false):Uint8Array<ArrayBuffer>{if(!ArrayBuffer.isView(value)||Object.getPrototypeOf(value)!==Uint8Array.prototype&&Object.getPrototypeOf(value)!==Buffer.prototype)bad('R3_CONTEXT_BYTES');const b=backing.call(value);try{abSize.call(b);if(resizable?.call(b))bad('R3_CONTEXT_BYTES');}catch{bad('R3_CONTEXT_BYTES');}const n=size.call(value);if(n<(allowEmpty?0:1)||n>cap)bad('R3_CONTEXT_BUDGET');const out=new Uint8Array(n);Uint8Array.prototype.set.call(out,value as Uint8Array);return out;}
function parse(bytes:Uint8Array){try{if(bytes[0]===239&&bytes[1]===187&&bytes[2]===191)bad();const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text);if(canonicalJson(value)!==text)bad();return value;}catch{bad();}}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
export function joinJ1PrecommandObservation(observationBytes:unknown,contextBytes:unknown){
 const observationCopy=copy(observationBytes,262144),contextCopy=copy(contextBytes,8192),observation=parse(observationCopy),context=parse(contextCopy);
 try{
  assertR3LocalObservation(observation);assertJ1PrecommandContext(context);
  if(observation.case_id!==context.case_id||observation.workspace_id!==context.source.workspace_id||observation.source_id!==context.source.object_name||observation.target_id!==(context.target?.object_name??null)||!same(observation.descriptor,context.descriptor))bad();
  if(!same(observation.policy,{version:context.policy.version,sha256:context.policy.sha256,config_epoch:context.source.config_epoch,installation_sha256:context.source.installation_sha256})||!same(observation.principals,{requester:context.configured_principals.requester,human:context.configured_principals.planned_human})||!same(observation.reviewer_ids,context.policy.configured_reviewer_ids))bad();
  if(context.target){if(!observation.recovery||observation.recovery.source_epoch!==context.source.config_epoch||observation.recovery.target_epoch!==context.target.config_epoch||context.target.decision_policy_sha256!==context.policy.sha256)bad();}else if(observation.recovery!==null)bad();
  return {case_id:context.case_id,observation_sha256:sha(observationCopy),context_sha256:sha(contextCopy),source_policy_joined:true as const,target_epoch_joined:context.target!==null,configured_principals_joined:true as const,configured_reviewers_joined:true as const,acceptance_eligible:false as const,provenance_authenticated:false as const};
 }catch{bad();}
}

import Ajv2020 from 'ajv/dist/2020.js';
import producerSchema from '../../validation/r3-source-context-producer.schema.json' with {type:'json'};
import {safeR2Path} from './r2-evidence-loader.mjs';
import {J1_CASES,J1_TESTS} from './r3-source-producer-policy.mjs';
import {J1_CONTEXT_LIMITS as L,J1_CONTEXT_MISSING,J1_CONTEXT_BINDINGS} from './r3-source-context-policy';
const ajv=new Ajv2020({strict:true,allErrors:false});ajv.addSchema(producerSchema);
const validExecution=ajv.compile<any>({$ref:producerSchema.$id+'#/$defs/execution'}),validContext=ajv.compile<any>({$ref:producerSchema.$id+'#/$defs/context'}),validManifest=ajv.compile<any>({$ref:producerSchema.$id+'#/$defs/manifest'});
const intrinsicMapSize=Object.getOwnPropertyDescriptor(Map.prototype,'size')!.get!;
type Ref={path:string;sha256:string;byte_size:number};
/** Bounded serialized inputs, not a filesystem root. No async boundary or caller getters. */
export function validateJ1ContextSource(executionBytes:unknown,configuration:unknown){
 const findings:{code:string;path:string}[]=[],observed:string[]=[];
 const finish=()=>({format_version:2 as const,stage:'j1-precommand-source-consistency' as const,source_profile_complete:findings.length===0,precommand_context_join_complete:findings.length===0,local_execution_record_consistent:findings.length===0,acceptance_eligible:false as const,provenance_authenticated:false as const,observed_cases:observed,missing_stages:[...J1_CONTEXT_MISSING],findings});
 try{
  if(!configuration||Object.getPrototypeOf(configuration)!==Object.prototype)bad();
  const descriptors=Object.getOwnPropertyDescriptors(configuration),keys=Reflect.ownKeys(descriptors);
  if(keys.length!==2||!keys.includes('files')||!keys.includes('expectedSourceBytes')||keys.some(k=>!Object.hasOwn(descriptors[k as string],'value')))bad();
  const files:unknown=descriptors.files.value,count=intrinsicMapSize.call(files);
  if(count>L.sourceCount+L.stagedInputs)bad();
  const rootBytes=copy(executionBytes,L.envelope),expectedBytes=copy(descriptors.expectedSourceBytes.value,L.envelope);
  const root:any=parse(rootBytes),expected:any=parse(expectedBytes);
  if(!validExecution(root)||!validContext(expected)||!same(root.source_context,expected)||root.source_context_sha256!==sha(expectedBytes))bad();
  const source:Ref[]=expected.source_files,sorted=[...source].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if(!same(source,sorted)||sha(new TextEncoder().encode(canonicalJson(source)))!==expected.inventory_sha256)bad();
  const declared=new Map<string,Ref>();let sourceTotal=0;
  const declare=(r:Ref,cap:number,allowEmpty=false)=>{if(!safeR2Path(r.path)||declared.has(r.path)||!Number.isSafeInteger(r.byte_size)||r.byte_size<(allowEmpty?0:1)||r.byte_size>cap)bad();declared.set(r.path,r);};
  for(const r of source){declare(r,L.sourceFile,true);sourceTotal+=r.byte_size;if(sourceTotal>L.sourceTotal)bad();}
  if(source.length>L.sourceCount||J1_CONTEXT_BINDINGS.some(path=>!declared.has(path))||declared.get('package-lock.json')!.sha256!==expected.lock_sha256||declared.get(expected.configuration.file)?.sha256!==expected.configuration.sha256)bad();
  const packages=['vitest','vite','@cloudflare/vitest-plugin','wrangler','esbuild','typescript'];
  if(!same(expected.runtime.package_entries.map((x:any)=>x.name).sort(),[...packages].sort())||expected.runtime.package_entries.some((x:any)=>!safeR2Path(x.entry_path)))bad();
  const prefix='validation/releases/'+root.run_id+'/source-fixture-context/';
  if(root.reporter_manifest.path!==prefix+'reporter.json')bad();declare(root.reporter_manifest,L.manifest);
  const read=(r:Ref,cap:number)=>{const bytes=copy(Map.prototype.get.call(files,r.path),cap);if(bytes.length!==r.byte_size||sha(bytes)!==r.sha256)bad();return bytes;};
  // Read only the bounded manifest first; reserve the entire remaining batch before traversal.
  const manifestBytes=read(root.reporter_manifest,L.manifest),manifest:any=parse(manifestBytes);
  if(!validManifest(manifest)||manifest.run_id!==root.run_id||manifest.nonce_sha256!==root.nonce_sha256||manifest.source_context_sha256!==root.source_context_sha256||!same(manifest.tests.map((x:any)=>x.name),J1_TESTS)||new Set(manifest.tests.map((x:any)=>x.id)).size!==8)bad();
  if(!same(manifest.observations.map((x:any)=>x.case_id),J1_CASES)||!same(manifest.contexts.map((x:any)=>x.case_id),J1_CASES)||!same(manifest.joins.map((x:any)=>x.case_id),J1_CASES))bad();
  let observationsTotal=0,contextsTotal=0;const claims=new Set<string>();
  for(let i=0;i<6;i++){
   const observation:Ref=manifest.observations[i].artifact,context:Ref=manifest.contexts[i].artifact;
   if(observation.path!==prefix+J1_CASES[i]+'.observation.json'||context.path!==prefix+J1_CASES[i]+'.precommand.json')bad();
   for(const r of [observation,context]){if(claims.has(r.sha256))bad();claims.add(r.sha256);}
   declare(observation,L.observation);declare(context,L.context);observationsTotal+=observation.byte_size;contextsTotal+=context.byte_size;
  }
  if(observationsTotal>L.observationsTotal||contextsTotal>L.contextsTotal||observationsTotal+contextsTotal+manifestBytes.length+rootBytes.length>L.outputTotal||count!==declared.size)bad();
  const detached=new Map<string,Uint8Array>();
  for(const [path,value] of Map.prototype.entries.call(files) as MapIterator<[unknown,unknown]>){if(typeof path!=='string'||!declared.has(path))bad();const r=declared.get(path)!,bytes=copy(value,r.byte_size,source.some(x=>x.path===path));if(bytes.length!==r.byte_size||sha(bytes)!==r.sha256)bad();detached.set(path,bytes);}
  for(let i=0;i<6;i++){const joined=joinJ1PrecommandObservation(detached.get(manifest.observations[i].artifact.path),detached.get(manifest.contexts[i].artifact.path));if(!same(joined,manifest.joins[i]))bad();observed.push(J1_CASES[i]);}
 }catch{findings.push({code:'R3_CONTEXT_SOURCE_INVALID',path:'/'});}
 return finish();
}
