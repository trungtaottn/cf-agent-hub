/** Actual captured bytes/final joins. Not installed authority or a leak scan. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {PROCESS_LIMITS} from './native-r2-process.mjs';
import {getNativeScenario} from './native-r2-scenario.mjs';
import {parseNativeCliOutput} from './native-cli-output.mjs';
const reject=()=>{throw Error('NATIVE_OUTPUT_VERIFICATION_REJECTED');},check=v=>{if(!v)reject();};
const sha=v=>createHash('sha256').update(v).digest('hex');
const subjects=['config_sha256','candidate_sha','candidate_tree_sha','composition_sha256','node_sha256','build_sha256','authority_record_sha256','scenario_sha256','actors_sha256','workspaces_sha256'];
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
function closed(v,keys){check(v&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype);const ds=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(ds).length===keys.length);return Object.fromEntries(keys.map(k=>{check(ds[k]?.enumerable&&Object.hasOwn(ds[k],'value'));return[k,ds[k].value];}));}
const proto=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(proto,'byteLength').get,backing=Object.getOwnPropertyDescriptor(proto,'buffer').get;
function byteSize(v,max){check(v&&!types.isProxy(v)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(v)));const size=length.call(v);check(Object.getPrototypeOf(backing.call(v))===ArrayBuffer.prototype&&size<=max&&Reflect.ownKeys(v).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)));return size;}
const copy=v=>{const out=new Uint8Array(length.call(v));Uint8Array.prototype.set.call(out,v);return Buffer.from(out.buffer);};
function digest(v,n=64){check(typeof v==='string'&&v.length===n&&/^[a-f0-9]+$/.test(v));}
function integer(v,max=Number.MAX_SAFE_INTEGER){check(Number.isSafeInteger(v)&&v>=0&&v<=max);}
export function nativeOutputVerificationPlan(){
 const steps=getNativeScenario().steps,caseSteps=steps.filter(s=>s.caseId),aux=['prepare/fail-create','prepare/revoke-own-positive'];check(caseSteps.length===37&&aux.every(id=>steps.some(s=>s.id===id&&s.caseId===null&&s.kind!=='control')));
 const stepIds=steps.filter(s=>s.caseId||aux.includes(s.id)).map(s=>s.id);check(stepIds.length===39&&new Set(stepIds).size===39);
 return Object.freeze({stepIds:Object.freeze(stepIds),cost:Object.freeze({commands:0,mutations:0,artifact_bytes:0,output_bytes:39*4096}),perRecordBytes:4096});
}
export function verifyNativeCapturedOutput(input){
 try{
  const c=closed(input,['stepId','invocationId','runId','finalOriginal','expectedSubjects','stdout','stderr','maxOutputBytes']);
  check(typeof c.invocationId==='string'&&/^inv_[a-z0-9]{1,64}$/.test(c.invocationId)&&typeof c.runId==='string'&&/^run_[a-z0-9]{1,64}$/.test(c.runId));
  const step=getNativeScenario().steps.find(s=>s.id===c.stepId);check(step&&step.kind!=='control');integer(c.maxOutputBytes,PROCESS_LIMITS.outputBytes);check(c.maxOutputBytes>0);
  const original=closed(c.finalOriginal,['id','sha256','bytes']);check(original.id===c.invocationId+'_final');digest(original.sha256);
  const stdoutSize=byteSize(c.stdout,c.maxOutputBytes),stderrSize=byteSize(c.stderr,c.maxOutputBytes),finalSize=byteSize(original.bytes,PROCESS_LIMITS.receiptBytes);check(stdoutSize+stderrSize<=c.maxOutputBytes&&finalSize>0);
  const expected=closed(c.expectedSubjects,subjects);for(const key of subjects)digest(expected[key],['candidate_sha','candidate_tree_sha'].includes(key)?40:64);
  const stdout=copy(c.stdout),stderr=copy(c.stderr),finalBytes=copy(original.bytes);check(sha(finalBytes)===original.sha256);
  const f=closed(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(finalBytes)),['version','invocationId','subjects','status','reason','startedAt','endedAt','closeObserved','exitCode','signal','observedBytes','retainedBytes','truncated','prepared','spawned','transcripts','retryAllowed','effectOutcome','descendants']);
  const bound=closed(f.subjects,subjects);for(const key of subjects)check(bound[key]===expected[key]);
  check(f.version===1&&f.invocationId===c.invocationId&&f.status==='terminal'&&f.reason==='exit'&&f.closeObserved===true&&f.exitCode===step.expectedExit&&f.signal===null&&f.truncated===false&&f.retryAllowed===false&&f.effectOutcome==='unknown'&&f.descendants==='unverified');
  integer(f.startedAt);integer(f.endedAt);check(f.startedAt<=f.endedAt&&f.endedAt<=Date.now());check(f.observedBytes===stdoutSize+stderrSize&&f.retainedBytes===f.observedBytes);
  for(const kind of ['prepared','spawned']){const r=closed(f[kind],['name','sha256','byteSize']);check(r.name===c.invocationId+'.'+kind+'.json');digest(r.sha256);integer(r.byteSize,PROCESS_LIMITS.receiptBytes);check(r.byteSize>0);}
  const transcripts=closed(f.transcripts,['stdout','stderr']);for(const[name,bytes]of[['stdout',stdout],['stderr',stderr]]){const r=closed(transcripts[name],['name','sha256','byteSize','complete']);check(r.name===c.invocationId+'.'+name&&r.complete===true&&r.byteSize===bytes.length&&r.sha256===sha(bytes));}
  let parsed=null,parse={kind:'invalid',schema_status:'failed',runtime_token_output_count:null,error_codes:['OUTPUT_SYNTAX_REJECTED']};
  try{const result=parseNativeCliOutput({stepId:c.stepId,stdout,stderr,mode:'full'});parsed=result.parsed;parse={kind:result.kind,schema_status:result.schemaStatus,runtime_token_output_count:result.runtimeTokenOutputCount,error_codes:[]};}catch{/* Only a fixed failure code is retained; never an exception or stream. */}
  const value={type:'native-output-verification-original',version:1,scope:'source-byte-consistency',native_conformance:false,run_id:c.runId,step_id:c.stepId,invocation_id:c.invocationId,process_final_sha256:original.sha256,subjects:expected,observed_at:Date.now(),stdout_sha256:sha(stdout),stderr_sha256:sha(stderr),stdout_bytes:stdoutSize,stderr_bytes:stderrSize,parse,checks:{secret_inventory:'not-evaluated',foreign_identifiers:'not-evaluated',artifact_bytes:'not-evaluated',transport:'not-evaluated',prepared_invocation:'not-evaluated'}};
  const bytes=Buffer.from(canonical(value));check(bytes.length<=4096);const record=Object.freeze({id:'output_'+c.invocationId.slice(4),sha256:sha(bytes)}),result={status:parse.schema_status==='failed'?'syntax-invalid':'syntax-verified',scope:'source-byte-consistency',schemaStatus:parse.schema_status,leakChecks:'not-evaluated',originalSha256:record.sha256};
  Object.defineProperties(result,{readParsedResult:{value:()=>structuredClone(parsed)},readVerificationOriginal:{value:()=>({...record,bytes:Buffer.from(bytes)})}});return Object.freeze(result);
 }catch{reject();}
}
