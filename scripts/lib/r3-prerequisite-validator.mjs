import {createHash} from 'node:crypto';
import {createR2Reader,R2_LIMITS} from './r2-evidence-loader.mjs';
import {validR3PrerequisiteRoot,validR3PrerequisiteProducer,validR3ComparisonContext} from './r3-prerequisite-schema-registry.mjs';
import {R3_PREREQUISITE_FAMILIES,R3_TOOL_OPERATIONS,R3_INCOMPLETE_POLICY} from './r3-prerequisite-policy.mjs';
const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
const hash=x=>createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>canonical(a)===canonical(b);
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(x=>b.includes(x));
/** Partial #66. Checks consistency against separately supplied comparison context.
 * Context/digests/provenance labels do NOT authenticate an execution or reviewer.
 * No command is run, no release profile is enabled, and acceptance is always false.
 * fixtureMode is in-memory-only and cannot become an acceptance escape hatch. */
export function validateR3Prerequisites(input,options={}){
 options??={};
 const findings=[],fail=(code,path='/')=>findings.push({code,path});
 const fixtureMode=options.fixtureMode===true;
 const done=()=>({structurally_valid:findings.length===0,acceptance_eligible:false,scope:fixtureMode?'verifier-unit-only':'prerequisite-only',incomplete_policy:[...R3_INCOMPLETE_POLICY],findings});
 let serialized;try{serialized=JSON.stringify(input);}catch{fail('R3_SCHEMA_INVALID');return done();}
 if(typeof serialized!=='string'||Buffer.byteLength(serialized)>R2_LIMITS.root){fail('R3_BUDGET');return done();}
 if(!validR3PrerequisiteRoot(input)){fail('R3_SCHEMA_INVALID');return done();}
 const context=options.expectedContext;
 if(!validR3ComparisonContext(context)){fail('R3_CONTEXT_REQUIRED');return done();}
 if(!equal(input.identity,context.identity)||!equal(input.clients,context.clients))fail('R3_CONTEXT_MISMATCH');
 if(fixtureMode&&(!(options.files instanceof Map)||options.root!==undefined)){fail('R3_FIXTURE_MODE');return done();}
 if(!sameSet(input.tools.map(x=>x.name),Object.keys(R3_TOOL_OPERATIONS))||input.tools.some(x=>R3_TOOL_OPERATIONS[x.name]!==x.operation))fail('R3_TOOL_INVENTORY');
 if(!sameSet(input.producers.map(x=>x.family),R3_PREREQUISITE_FAMILIES)||!sameSet(context.producers.map(x=>x.family),R3_PREREQUISITE_FAMILIES)||!sameSet(input.producers.map(x=>x.id),context.producers.map(x=>x.id)))fail('R3_PRODUCER_INVENTORY');
 if(new Set(input.clients.map(x=>x.id)).size!==input.clients.length)fail('R3_CLIENT_INVENTORY');
 const sources=new Map(input.sources.map(x=>[x.path,x]));
 const prefix='validation/releases/'+input.release_id+'/';
 if(sources.size!==input.sources.length)fail('R3_SOURCE_INVENTORY');
 if(options.files instanceof Map){
  if(options.files.size>R2_LIMITS.sourceCount+R2_LIMITS.referenceCount){fail('R3_BUDGET');return done();}
  for(const path of options.files.keys()){
   if(typeof path!=='string'){fail('R3_SOURCE_INVENTORY');return done();}
   if(!path.startsWith(prefix)&&!sources.has(path))fail('R3_SOURCE_INVENTORY');
  }
 }
 const ordered=[...input.sources].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(hash(canonical(ordered))!==input.identity.tree_sha256)fail('R3_TREE_DIGEST');
 if(input.source_bindings.lock!=='package-lock.json'||sources.get(input.source_bindings.lock)?.sha256!==input.identity.lock_sha256||sources.get(input.source_bindings.policy)?.sha256!==input.identity.policy_sha256||sources.get(input.source_bindings.action_schema)?.sha256!==input.identity.action_schema_sha256||input.build.sha256!==input.identity.build_sha256)fail('R3_SOURCE_BINDING');
 const artifacts=[input.build,...input.producers.map(x=>x.artifact)];
 if(new Set(artifacts.map(x=>x.path)).size!==artifacts.length||new Set(input.producers.map(x=>x.artifact.sha256)).size!==input.producers.length)fail('R3_DUPLICATE_ARTIFACT');
 try{
  const reader=createR2Reader({files:options.files,root:options.root,releaseId:input.release_id});
  const batch=[...input.sources.map(ref=>({ref,category:'source',type:'source'})),{ref:input.build,category:'component',type:'r3-build'},...input.producers.map(p=>({ref:p.artifact,category:'evidence',type:'r3-prerequisite-producer',bound:R2_LIMITS.command}))];
  reader.reserveAll(batch); // Admit the WHOLE known batch before reading any bytes.
  for(const ref of input.sources)reader.bytes(ref,'source','source');
  reader.bytes(input.build,'component','r3-build');
  for(const metadata of input.producers){
   const value=reader.json(metadata.artifact,'evidence','r3-prerequisite-producer',R2_LIMITS.command);
   if(!validR3PrerequisiteProducer(value)){fail('R3_PRODUCER_SCHEMA',metadata.artifact.path);continue;}
   const expected=context.producers.find(x=>x.id===metadata.id);
   if(!expected||value.id!==metadata.id||value.family!==metadata.family||expected.family!==metadata.family)fail('R3_PRODUCER_INVENTORY');
   if(!equal(value.identity,input.identity)||value.client_inventory_sha256!==hash(canonical(input.clients)))fail('R3_PRODUCER_IDENTITY');
   if(!expected||!sameSet(value.case_ids,expected.case_ids)||!expected.case_ids.length)fail('R3_CASE_INVENTORY');
   if(value.exit_code!==0||value.ended_at<value.started_at||value.selected_count===0||value.selected_count!==value.case_ids.length||value.passed_count!==value.selected_count||value.failed_count!==0||value.skipped_count!==0)fail('R3_PRODUCER_OUTCOME');
   if(value.provenance==='synthetic'&&!fixtureMode)fail('R3_SYNTHETIC_PROVENANCE');
  }
 }catch(error){const code=typeof error?.message==='string'&&/^R2_[A-Z_]+$/.test(error.message)?error.message.replace(/^R2_/,'R3_'):'R3_EVIDENCE_UNAVAILABLE';fail(code);}
 return done();
}
