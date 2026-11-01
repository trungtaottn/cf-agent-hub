/** Local source consistency only. Caller comparisons and digests never authenticate execution. */
import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../validation/r3-source-observation.schema.json';
import {createR2Reader,safeR2Path} from './r2-evidence-loader.mjs';
import {assertR3LocalObservation} from '../../test/helpers/r3-journey-observation';
import {R3_SOURCE_CASES,R3_SOURCE_MISSING,R3_SOURCE_LIMITS as L,R3_SOURCE_BINDINGS} from './r3-source-observation-policy';
const ajv=new Ajv2020({strict:true,allErrors:false});ajv.addSchema(schema);
const rootValid=ajv.compile({$ref:schema.$id+'#/$defs/root'}),contextValid=ajv.compile({$ref:schema.$id+'#/$defs/context'});
const mapSize=Object.getOwnPropertyDescriptor(Map.prototype,'size')!.get!;
const ta=Object.getPrototypeOf(Uint8Array.prototype),byteLength=Object.getOwnPropertyDescriptor(ta,'byteLength')!.get!,buffer=Object.getOwnPropertyDescriptor(ta,'buffer')!.get!;
const abLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!,abResizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
const hash=(x:Uint8Array|string)=>createHash('sha256').update(x).digest('hex');
const canonical=(x:any):string=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const knownFailures=new WeakMap<object,string>();
const reject=(code:string):never=>{const error=new Error('R3_SOURCE_INVALID');knownFailures.set(error,code);throw error;};
function length(value:unknown):number{
 if(!ArrayBuffer.isView(value)||Object.getPrototypeOf(value)!==Uint8Array.prototype&&Object.getPrototypeOf(value)!==Buffer.prototype)reject('R3_SOURCE_BYTES');
 const backing=buffer.call(value);try{abLength.call(backing);if(abResizable?.call(backing))reject('R3_SOURCE_BYTES');}catch{reject('R3_SOURCE_BYTES');}
 return byteLength.call(value);
}
function copy(value:unknown,cap:number):Uint8Array{const size=length(value);if(size>cap)reject('R3_SOURCE_BUDGET');const result=new Uint8Array(size);Uint8Array.prototype.set.call(result,value);return result;}
function parse(value:Uint8Array):any{if(value[0]===239&&value[1]===187&&value[2]===191)reject('R3_SOURCE_ENCODING');try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value));}catch{reject('R3_SOURCE_ENCODING');}}
function options(value:unknown):{files:unknown;expectedContextBytes:unknown}{
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)reject('R3_SOURCE_OPTIONS');const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);if(keys.length!==2||!keys.includes('files')||!keys.includes('expectedContextBytes')||keys.some(k=>!Object.hasOwn(d[k as string],'value')))reject('R3_SOURCE_OPTIONS');return {files:d.files.value,expectedContextBytes:d.expectedContextBytes.value};
}
/** No await: all caller bytes are bounded/detached before predicates and comparisons. */
export function validateR3SourceObservations(envelopeBytes:unknown,configuration:unknown){
 const findings:{code:string;path:string}[]=[],observed:string[]=[];
 const done=()=>({structurally_valid:findings.length===0,source_profile_complete:findings.length===0,acceptance_eligible:false as const,scope:'local-source-observation-consistency' as const,provenance_authenticated:false as const,observed_case_ids:observed,missing_stages:[...R3_SOURCE_MISSING],findings});
 try{
  const opt=options(configuration);let size:number;try{size=mapSize.call(opt.files);}catch{reject('R3_SOURCE_FILES');}if(size!>L.sourceCount+L.referenceCount)reject('R3_SOURCE_BUDGET');
  const root=parse(copy(envelopeBytes,L.envelope)),context=parse(copy(opt.expectedContextBytes,L.context));
  if(!rootValid(root)||!contextValid(context))reject('R3_SOURCE_SCHEMA');
  if(root.run_id!==context.run_id||!same(root.source,context.source)||!same(root.environment,context.environment))reject('R3_SOURCE_CONTEXT');
  if(!same(root.observations.map((x:any)=>x.case_id),R3_SOURCE_CASES)||!same(context.cases.map((x:any)=>x.case_id),R3_SOURCE_CASES))reject('R3_SOURCE_INVENTORY');
  if(!same(root.source.bindings,R3_SOURCE_BINDINGS))reject('R3_SOURCE_BINDINGS');
  const sorted=[...root.sources].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if(hash(canonical(sorted))!==root.source.inventory_sha256)reject('R3_SOURCE_TREE');
  const sourceMap=new Map(root.sources.map((r:any)=>[r.path,r]));if(sourceMap.size!==root.sources.length)reject('R3_SOURCE_INVENTORY');
  for(const path of Object.values(R3_SOURCE_BINDINGS))if(!sourceMap.has(path))reject('R3_SOURCE_BINDINGS');
  if((sourceMap.get('package-lock.json') as any).sha256!==root.source.lock_sha256)reject('R3_SOURCE_BINDINGS');
  const artifacts=root.observations.map((x:any)=>x.artifact),prefix='validation/releases/'+root.run_id+'/source-fixture/';
  if(new Set(artifacts.map((r:any)=>r.sha256)).size!==artifacts.length)reject('R3_SOURCE_ALIAS');
  const refs=[...root.sources,...artifacts,...(root.source.build?[root.source.build]:[])];
  if(new Set(refs.map(r=>r.path)).size!==refs.length||size!==refs.length||refs.some(r=>!safeR2Path(r.path)))reject('R3_SOURCE_INVENTORY');
  if(artifacts.some((r:any)=>!r.path.startsWith(prefix))||root.source.build&&!root.source.build.path.startsWith(prefix))reject('R3_SOURCE_PATH');
  const reader=createR2Reader({files:new Map(),releaseId:root.run_id});
  const batch=[...root.sources.map((ref:any)=>({ref,category:'source' as const,type:'source',bound:L.sourceFile})),...artifacts.map((ref:any)=>({ref,category:'evidence' as const,type:'r3-j1-observation',bound:L.observation})),...(root.source.build?[{ref:root.source.build,category:'component' as const,type:'r3-source-build',bound:16777216}]:[])];
  reader.reserveAll(batch);if(artifacts.reduce((n:number,r:any)=>n+r.byte_size,0)>L.observationsTotal)reject('R3_SOURCE_BUDGET');
  const declared=new Map(refs.map(r=>[r.path,r])),detached=new Map<string,Uint8Array>();
  for(const [key,value]of Map.prototype.entries.call(opt.files)){
   if(typeof key!=='string'||!declared.has(key))reject('R3_SOURCE_INVENTORY');const ref=declared.get(key)!;if(length(value)!==ref.byte_size)reject('R3_SOURCE_SIZE');
   detached.set(key,copy(value,ref.byte_size));
  }
  const bounded=createR2Reader({files:detached,releaseId:root.run_id});bounded.reserveAll(batch);
  for(const ref of root.sources)bounded.bytes(ref,'source','source',L.sourceFile);
  if(root.source.build)bounded.bytes(root.source.build,'component','r3-source-build',16777216);
  for(let i=0;i<root.observations.length;i++){
   const metadata=root.observations[i],value=bounded.json(metadata.artifact,'evidence','r3-j1-observation',L.observation);
   try{assertR3LocalObservation(value);}catch{reject('R3_SOURCE_PREDICATE');}
   const actual={case_id:value.case_id,workspace_id:value.workspace_id,source_id:value.source_id,target_id:value.target_id,descriptor:value.descriptor,policy:value.policy,principals:value.principals,reviewer_ids:value.reviewer_ids};
   if(value.case_id!==metadata.case_id||!same(actual,context.cases[i]))reject('R3_SOURCE_CONTEXT');observed.push(value.case_id);
  }
 }catch(error){const code=(typeof error==='object'&&error!==null||typeof error==='function')?knownFailures.get(error as object):undefined;findings.push({code:code??'R3_SOURCE_INVALID',path:'/'});}
 return done();
}
