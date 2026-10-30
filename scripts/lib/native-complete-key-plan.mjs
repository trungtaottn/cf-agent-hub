/** Fixed required-profile recipes only. Neither planned keys nor a supplied body
 * digest proves emitted traffic, header integrity, journal identity or authority. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {isIP} from 'node:net';
import rawPlan from '../../workers/native-fixture/required-application-plan.json' with {type:'json'};
import operations from './r2-policy-data/operations.json' with {type:'json'};
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
freeze(rawPlan);freeze(operations);
const check=v=>{if(!v)throw Error('NATIVE_COMPLETE_KEY_PLAN_REJECTED');};
const hash=v=>createHash('sha256').update(v).digest('hex');
function fields(v,names){
 check(v&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype);
 const d=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(d).length===names.length);
 return Object.fromEntries(names.map(k=>{check(d[k]?.enumerable&&Object.hasOwn(d[k],'value'));return[k,d[k].value];}));
}
const aliases=freeze([['case/settled-no-send','prepare/fail-create'],['case/restart-no-send','case/lost-response-retained']]);
export function buildCompleteKeyPlan(input){
 const {profile,runId}=fields(input,['profile','runId']);
 check(profile==='native-r2-required-prepared-v1'&&typeof runId==='string'&&/^run_[A-Za-z0-9_-]{1,124}$/.test(runId));
 const entries=[],owners=new Set(),keys=new Set();
 for(const p of rawPlan){
  const mutations=p.ordinals.filter(o=>o.idempotency);check(mutations.length<=1);
  for(const o of mutations){
   const meta=operations[o.operation];check(meta&&meta.idempotency&&meta.method===o.method&&meta.path===o.path&&!owners.has(p.step_id));
   owners.add(p.step_id);
   const key='r2_'+hash('AGENTHUB_NATIVE_COMPLETE_IDEMPOTENCY_V2\n'+canonical({run_id:runId,original_step_id:p.step_id})).slice(0,32);
   // Check all distinct source mutation owners before exposing any usable plan.
   check(!keys.has(key));keys.add(key);
   entries.push({step_id:p.step_id,ordinal:o.ordinal,operation:o.operation,original_step_id:p.step_id,key,key_sha256:hash(key)});
  }
 }
 const replays=aliases.map(([step_id,original_step_id])=>{
  const row=rawPlan.find(p=>p.step_id===step_id),original=entries.find(r=>r.step_id===original_step_id);
  check(row&&row.ordinals.length===0&&original);
  return {step_id,original_step_id,key:original.key,key_sha256:original.key_sha256};
 });
 // Fixed local unsent intent: no application ordinal, transport request or effect.
 const localStep='probe/wrong-runtime',localRow=rawPlan.find(p=>p.step_id===localStep);
 check(localRow&&localRow.ordinals.length===0&&localRow.process_operation==='heartbeatRuntime'&&operations.heartbeatRuntime.idempotency&&!owners.has(localStep));
 const localKey='r2_'+hash('AGENTHUB_NATIVE_COMPLETE_IDEMPOTENCY_V2\n'+canonical({run_id:runId,original_step_id:localStep})).slice(0,32);
 check(!keys.has(localKey));keys.add(localKey);owners.add(localStep);
 const local_intents=[{step_id:localStep,operation:'heartbeatRuntime',original_step_id:localStep,key:localKey,key_sha256:hash(localKey)}];
 return freeze({scope:'source-plan-only',installedAuthority:false,profile,run_id:runId,entries,replays,local_intents});
}
/** Hash the exact source-owned transport tuple. Owners must derive body SHA from
 * actual bytes (including empty bytes), and compare planned vs actual emission.
 * This intentionally does not use or replace the product journal fingerprint. */
export function completeApplicationRequestDigest(input){
 const r=fields(input,['operation','method','origin','path','query','request_body_sha256']);
 check(typeof r.operation==='string'&&Object.hasOwn(operations,r.operation));const meta=operations[r.operation];
 check(rawPlan.some(p=>p.ordinals.some(o=>o.operation===r.operation&&o.method===r.method&&o.path===meta.path))&&r.method===meta.method);
 check(typeof r.origin==='string'&&r.origin.length<=128);const u=new URL(r.origin),host=u.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'');
 check(u.protocol==='https:'&&u.origin===r.origin&&!u.username&&!u.password&&!isIP(host)&&host!=='localhost'&&!host.endsWith('.localhost'));
 check(typeof r.path==='string'&&r.path.length<=192);
 const pattern=meta.path.split(/(\{[a-z_]+\})/).map(part=>/^\{/.test(part)?'[A-Za-z0-9_-]{1,96}':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('');
 check(new RegExp('^'+pattern+'$').test(r.path));
 const query=r.operation==='searchWorkspace'?'limit=20&q=conformance':['listAgents','listTasks','listTaskResults','listArtifacts','getInbox','getThread','listEvents'].includes(r.operation)?'limit=20':'';
 check(r.query===query&&typeof r.request_body_sha256==='string'&&/^[a-f0-9]{64}$/.test(r.request_body_sha256));
 return hash('AGENTHUB_NATIVE_COMPLETE_APPLICATION_REQUEST_V2\n'+canonical(r));
}
