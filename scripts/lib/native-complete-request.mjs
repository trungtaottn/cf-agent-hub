/** Closed wire requests. Parsing never authenticates a caller or executes a step. */
import {createHash} from 'node:crypto';
import {selectCompleteProfile} from './native-profile-selection.mjs';
import {canonicalCaseSubject} from './r2-case-policy.mjs';
import {getCompleteProfile} from './native-complete-profile.mjs';
import {completeSlotRegistry,completePolicyDigest,validateCompletePolicy,snapshotCompleteValue as snapshot,completeKeys as keys,completeCheck as check,completeId as id,completeDigest as digest,completeInteger as integer,freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
import {validateCompletePreparation} from './native-complete-preparation.mjs';
import wireRows from './native-complete-request-limits.json' with {type:'json'};
const profile=getCompleteProfile();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=value=>sha(canonicalCaseSubject(value));
const empty=sha('');
const offer=new Map(profile.processes.map(row=>[row.step_id,row.output_bytes]));
const wire=new Map();
for(const row of wireRows){const key=[row.operation,row.slot,row.pass??''].join('\0');check(!wire.has(key));wire.set(key,row.request_bytes);}
check(wire.size===370&&wireRows.reduce((sum,row)=>sum+row.request_bytes,0)===profile.ledger.logical_output_bytes.service_request);
const typed=s=>!!s?.caseId||['prepare/fail-create','prepare/revoke-own-positive'].includes(s?.id);
const familyCaps={'process-custody':8192,'process-output-verification':4096,'independent-observation':9960,'disable-acknowledgment':9960,'external-observation':16384,'final-output-scan':1188};
function ref(value,family){keys(value,'record_id family sha256 byte_size');check(value.family===family);id(value.record_id);digest(value.sha256);integer(value.byte_size,1,familyCaps[family]);}
function profileSlot(value,kind,tag){
 keys(value,'kind id');const fixed=completeSlotRegistry(tag).find(row=>row.kind===value.kind&&row.id===value.id);check(fixed&&(!kind||fixed.kind===kind));
 check(!profile.unavailable.includes(fixed.id)&&!fixed.id.startsWith('probe/swapped-'));return fixed;
}
function stream(value,cap,raw){
 keys(value,'sha256 byte_size'+(raw?' payload_base64':''));digest(value.sha256);integer(value.byte_size,0,cap);if(value.byte_size===0)check(value.sha256===empty);
 if(raw){
  check(typeof value.payload_base64==='string'&&value.payload_base64.length<=4*Math.ceil(cap/3)&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.payload_base64));
  const bytes=Buffer.from(value.payload_base64,'base64');check(bytes.length===value.byte_size&&bytes.toString('base64')===value.payload_base64&&sha(bytes)===value.sha256);
 }
}
function privateProvision(value){
 keys(value,'credentials human');check(Array.isArray(value.credentials)&&value.credentials.length===3);
 const token=v=>{check(typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v));const b=Buffer.from(v,'base64url');check(b.length===32&&b.toString('base64url')===v);};
 for(const [i,role] of ['S','R','X'].entries()){const row=value.credentials[i];keys(row,'role token');check(row.role===role);token(row.token);}
 keys(value.human,'session_cookie csrf_token');token(value.human.session_cookie);token(value.human.csrf_token);
 // Private authenticated handoff only: callers must never log this parsed value.
}
/** options carries the originally admitted framing lifetime context. The service
 * separately enforces current expiry/deadline for every actual operation. */
export function validateCompleteRequest(input,policy,options){
 try{
  const p=validateCompletePolicy(policy,options),r=snapshot(input,45543),selection=selectCompleteProfile(p.profile),profile=selection.profile,scenario=selection.scenario;
  const slot=(value,kind)=>profileSlot(value,kind,p.profile);
  keys(r,'type version profile service_id instance_id run_id descriptor_sha256 policy_sha256 sequence request_id operation payload');
  check(r.type==='native-complete-request'&&r.version===2&&r.profile===profile.profile);
  for(const key of ['service_id','instance_id','run_id','descriptor_sha256'])check(r[key]===p[key]);
  check(r.policy_sha256===completePolicyDigest(p));integer(r.sequence,1,profile.limits.service_calls);id(r.request_id);
  const v=r.payload;let selected=null,pass=null;
  // Bound the selected wire before allocating any decoded private/stream bytes.
  check(typeof r.operation==='string'&&v&&typeof v==='object'&&!Array.isArray(v));
  const offeredSlot=v.slot===undefined?'run':v.slot?.id;
  const offeredPass=r.operation==='scan-process-output'?v.pass:null;
  check(typeof offeredSlot==='string'&&(offeredPass===null||typeof offeredPass==='string'));
  const wireCap=wire.get([r.operation,offeredSlot,offeredPass??''].join('\0'));
  check(Number.isSafeInteger(wireCap)&&Buffer.byteLength(canonicalCaseSubject(r))<=wireCap);
  switch(r.operation){
   case 'preflight':
    keys(v,'policy_sha256 family_ledger_sha256 slot_roster_sha256');check(v.policy_sha256===r.policy_sha256&&v.family_ledger_sha256===selection.commitments.family_ledger_sha256&&v.slot_roster_sha256===hash(completeSlotRegistry(p.profile)));break;
   case 'bind-run':keys(v,'policy_sha256');check(v.policy_sha256===r.policy_sha256);break;
   case 'prepare-slot':
    keys(v,'slot preparation');selected=slot(v.slot);v.preparation=validateCompletePreparation(v.preparation,v.slot,p.profile);break;
   case 'execute-control':
    selected=slot(v?.slot,'control');keys(v,selected.id==='control/provision'?'slot preparation_sha256 private_inputs':'slot preparation_sha256');digest(v.preparation_sha256);if(selected.id==='control/provision')privateProvision(v.private_inputs);break;
   case 'execute-external':keys(v,'slot preparation_sha256');selected=slot(v.slot,'external');digest(v.preparation_sha256);break;
   case 'observe-slot':keys(v,'slot preparation_sha256');selected=slot(v.slot);digest(v.preparation_sha256);break;
   case 'complete-process':{
    keys(v,'slot invocation_id preparation_sha256 custody output');selected=slot(v.slot,'process');id(v.invocation_id);digest(v.preparation_sha256);
    keys(v.custody,'prepared spawned final');const identities=new Set();for(const name of ['prepared','spawned','final']){ref(v.custody[name],'process-custody');check(!identities.has(v.custody[name].record_id));identities.add(v.custody[name].record_id);}
    keys(v.output,'stdout stderr verification_ref');const cap=offer.get(selected.id);stream(v.output.stdout,cap,false);stream(v.output.stderr,cap,false);check(v.output.stdout.byte_size+v.output.stderr.byte_size<=cap);
    const step=scenario.steps.find(s=>s.id===selected.id);if(typed(step))ref(v.output.verification_ref,'process-output-verification');else check(v.output.verification_ref===null);break;
   }
   case 'read-original':{
    keys(v,'slot record_id family sha256 byte_size');selected=slot(v.slot);
    const step=scenario.steps.find(s=>s.id===selected.id);let family;
    if(selected.kind==='external')family='external-observation';
    else if(selected.id==='control/revoke-submitter')family='disable-acknowledgment';
    else{check(selected.kind==='process'&&typed(step));family='independent-observation';}
    ref({record_id:v.record_id,family:v.family,sha256:v.sha256,byte_size:v.byte_size},family);break;
   }
   case 'scan-process-output':{
    keys(v,'slot invocation_id preparation_sha256 pass final_original_ref inventory_sha256 stdout stderr');selected=slot(v.slot,'process');id(v.invocation_id);digest(v.preparation_sha256);ref(v.final_original_ref,'process-custody');
    check(v.pass==='immediate'||v.pass==='final');pass=v.pass;if(pass==='immediate')check(v.inventory_sha256===null);else digest(v.inventory_sha256);
    const cap=offer.get(selected.id);
    keys(v.stdout,'sha256 byte_size payload_base64');keys(v.stderr,'sha256 byte_size payload_base64');
    integer(v.stdout.byte_size,0,cap);integer(v.stderr.byte_size,0,cap);check(v.stdout.byte_size+v.stderr.byte_size<=cap);
    stream(v.stdout,cap,true);stream(v.stderr,cap,true);break;
   }
   case 'seal-scan-inventory':keys(v,'expected_inventory_generation');integer(v.expected_inventory_generation,15,15);break;
   case 'finalize-run-scan':keys(v,'inventory_sha256');digest(v.inventory_sha256);break;
   case 'read-run-original':ref(v,'final-output-scan');break;
   case 'close-run':keys(v,'');break;
   default:check(false);
  }
  const cap=wire.get([r.operation,selected?.id??'run',pass??''].join('\0'));check(Number.isSafeInteger(cap)&&Buffer.byteLength(canonicalCaseSubject(r))<=cap);
  return freeze(r);
 }catch{throw Error('NATIVE_COMPLETE_REQUEST_REJECTED');}
}
