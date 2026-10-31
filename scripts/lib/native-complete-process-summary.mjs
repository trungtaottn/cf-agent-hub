/** Fourteen required-profile supporting summaries, not recorder observations or
 * provenance. Fixed service must supply its admitted phase and issued scan.
 * Host-only exit/artifact/journal remain unobserved: final host joins are required. */
import {createHash} from 'node:crypto';
import app from '../../workers/native-fixture/required-application-plan.json' with {type:'json'};
import catalog from '../../workers/native-fixture/complete-selectors.json' with {type:'json'};
import caps from './native-complete-original-caps.json' with {type:'json'};
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {selectCompleteProfile} from './native-profile-selection.mjs';
import {completeClientFields as fields} from './native-complete-client-proof.mjs';
import {validateCompletePolicy,snapshotCompleteValue as snapshot,freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
import {validateCompletePreparation} from './native-complete-preparation.mjs';
import {validateCompleteRequest} from './native-complete-request.mjs';
import {requiredCommitTuple,validateRequiredDenialProjection,validateRequiredFixtureExpected} from './native-complete-service-sources.mjs';
import {completeApplicationRequestDigest} from './native-complete-key-plan.mjs';
freeze(app);freeze(catalog);freeze(caps);
const tag='native-r2-required-prepared-v1',selected=selectCompleteProfile(tag),steps=selected.scenario.steps.filter(s=>s.kind!=='control'&&!s.caseId&&!['prepare/fail-create','prepare/revoke-own-positive'].includes(s.id));
const hash=v=>createHash('sha256').update(v).digest('hex'),sha=v=>hash(canonical(v)),equal=(a,b)=>canonical(a)===canonical(b);
const check=v=>{if(!v)throw Error('NATIVE_COMPLETE_PROCESS_SUMMARY_REJECTED');},keys=(v,k)=>fields(v,k.split(' '));
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v),integer=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
function state(v){keys(v,'record_count canonical_bytes sha256 selectors');check(integer(v.record_count)&&v.record_count<=61&&integer(v.canonical_bytes)&&v.canonical_bytes<=7888422&&digest(v.sha256)&&Array.isArray(v.selectors)&&v.selectors.length<=34&&new Set(v.selectors).size===v.selectors.length&&v.selectors.every(s=>Object.hasOwn(catalog.catalog,s))&&v.record_count>=v.selectors.length);}
function privateRef(name,family,value,cap){const text=canonical(value),size=Buffer.byteLength(text);check(size<=cap);return {record_id:'private_'+name+'_'+hash(text),family,sha256:hash(text),byte_size:size};}
export function composeCompleteProcessSummary(input){try{
 const a=keys(input,'policy validationOptions preparation terminal phase scan expected'),options=snapshot(a.validationOptions,4096),policy=validateCompletePolicy(a.policy,options);check(policy.profile===tag&&steps.length===14);const expected=validateRequiredFixtureExpected(a.expected);
 const raw=snapshot(a.preparation,16384),step=steps.find(s=>s.id===raw.step_id);check(step);const slot={kind:'process',id:step.id},p=validateCompletePreparation(raw,slot,tag),prep=sha(p),terminal=validateCompleteRequest(a.terminal,policy,options),t=terminal.payload;
 check(terminal.operation==='complete-process'&&equal(t.slot,slot)&&t.invocation_id===p.invocation_id&&t.preparation_sha256===prep);
 const phase=snapshot(a.phase,11033);check(Buffer.byteLength(canonical(phase))<=11033);keys(phase,'type version scope installedAuthority native_conformance subject workspace_id before_at after_at state grant runtimes transport reconciliation commit'+(step.id==='probe/server-foreign-workspace'?' denial':''));if(step.id==='probe/server-foreign-workspace')validateRequiredDenialProjection(phase,step.id);
 check(phase.type==='required-phase-source'&&phase.version===1&&phase.scope==='source-only'&&phase.installedAuthority===false&&phase.native_conformance===false);
 const s=keys(phase.subject,'owner_kind run_id step_id invocation_id terminal_owner_sha256 preparation_sha256 request_body_sha256 idempotency_key_sha256 process_final_sha256 ingress_window_sha256');
 check(s.owner_kind==='process'&&s.run_id===policy.run_id&&s.step_id===step.id&&s.invocation_id===p.invocation_id&&s.preparation_sha256===prep&&s.process_final_sha256===t.custody.final.sha256&&digest(s.terminal_owner_sha256)&&digest(s.ingress_window_sha256));
 for(const k of ['request_body_sha256','idempotency_key_sha256'])check(s[k]===null||digest(s[k]));
 const foreignRoute=step.id==='probe/server-foreign-workspace';if(foreignRoute){const b=p.store_binding,actor=expected.actors.S;check(b.workspace_id===expected.workspaces.primary.id&&b.principal_id===actor.agent_id&&b.agent_id===actor.agent_id&&b.credential_id===actor.credential_id&&b.authority_epoch===expected.epoch&&b.runtime_id===null&&b.proof_sha256===null);}
 check(phase.workspace_id===(foreignRoute?expected.workspaces.foreign.id:p.store_binding.workspace_id)&&integer(phase.before_at)&&integer(phase.after_at)&&phase.before_at<=phase.after_at);
 keys(phase.state,'before after');state(phase.state.before);state(phase.state.after);keys(phase.grant,'before after');keys(phase.runtimes,'before after');
 for(const when of ['before','after']){
  const g=phase.grant[when];if(g!==null){keys(g,'workspace_id credential_id agent_id credential_version config_epoch enabled revoked_at record_sha256');check(id(g.workspace_id)&&id(g.credential_id)&&id(g.agent_id)&&integer(g.credential_version)&&g.credential_version>=1&&integer(g.config_epoch)&&g.config_epoch>=1&&typeof g.enabled==='boolean'&&(g.revoked_at===null||integer(g.revoked_at))&&digest(g.record_sha256));}
  check(Array.isArray(phase.runtimes[when])&&phase.runtimes[when].length<=3);for(const r of phase.runtimes[when]){keys(r,'id credential_id agent_id authority_epoch runtime_version proof_sha256 presence_expires_at revoked_at status');check(id(r.id)&&id(r.credential_id)&&id(r.agent_id)&&integer(r.authority_epoch)&&r.authority_epoch>=1&&integer(r.runtime_version)&&r.runtime_version>=1&&digest(r.proof_sha256)&&integer(r.presence_expires_at)&&(r.revoked_at===null||integer(r.revoked_at))&&['online','expired'].includes(r.status));}
 }
 const plan=app.find(r=>r.step_id===step.id);check(plan?.owner_kind==='process');keys(phase.transport,'requests');const requests=phase.transport.requests;check(Array.isArray(requests)&&requests.length===plan.ordinals.length&&requests.length===step.expectedRequests);
 for(const [i,r]of requests.entries()){
  keys(r,'ordinal operation method origin path query request_metadata_sha256 request_body_sha256 request_body_bytes response_status response_body_sha256 response_body_bytes delivery');const o=plan.ordinals[i];
  check(r.ordinal===i+1&&r.operation===o.operation&&r.method===o.method&&r.response_status===o.response_status&&r.delivery==='returned'&&digest(r.request_metadata_sha256)&&digest(r.response_body_sha256));
  completeApplicationRequestDigest(Object.fromEntries('operation method origin path query request_body_sha256'.split(' ').map(k=>[k,r[k]])));
  check(r.path.startsWith('/v2/workspaces/'+phase.workspace_id+'/')||r.path==='/v2/workspaces/'+phase.workspace_id);
  check(integer(r.request_body_bytes)&&r.request_body_bytes<=o.capture_limits.requestBodyBytes&&integer(r.response_body_bytes)&&r.response_body_bytes<=o.capture_limits.responseBodyBytes);
  check(r.request_body_bytes===0?r.request_body_sha256===hash(''):r.request_body_sha256===s.request_body_sha256);
 }
 const local=step.id==='prepare/retain-artifact',family=local?'host-artifact-only':!requests.length?'source-no-effect-only':plan.expected_status===401?'server-denial':plan.process_operation;
 keys(phase.reconciliation,'family resource_ids source');const ids=phase.reconciliation.resource_ids;check(phase.reconciliation.family===family&&phase.reconciliation.source==='dto-selected-sql'&&Array.isArray(ids)&&ids.length<=20&&ids.every(x=>typeof x==='string'&&/^(workspace|task|run|result-run|agent|runtime|message|artifact|event):[A-Za-z0-9_-]{1,96}$/.test(x))&&equal(ids,[...new Set(ids)].sort()));
 const needsCommit=requests.length>0&&plan.ordinals.at(-1).idempotency&&plan.expected_status!==401;check((phase.commit!==null)===!!needsCommit);
 if(phase.commit!==null){keys(phase.commit,'operation target key_sha256 fingerprint status event_id original_request_id outcome_sha256');check(requests.length>0&&plan.ordinals.at(-1).idempotency&&plan.expected_status!==401&&digest(phase.commit.key_sha256)&&digest(phase.commit.fingerprint)&&digest(phase.commit.outcome_sha256)&&typeof phase.commit.operation==='string'&&phase.commit.operation.length<=32&&/^domain\.[a-z]+:[a-z]+$/.test(phase.commit.operation)&&typeof phase.commit.target==='string'&&phase.commit.target.length<=192&&integer(phase.commit.status)&&phase.commit.status>=200&&phase.commit.status<400&&id(phase.commit.event_id)&&id(phase.commit.original_request_id));
  const template=plan.ordinals.at(-1).path,names=[...template.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]),pattern=template.split(/(\{[a-z_]+\})/).map(part=>/^\{/.test(part)?'([A-Za-z0-9_-]{1,96})':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join(''),match=new RegExp('^'+pattern+'$').exec(requests.at(-1).path);check(match);
  const params=Object.fromEntries(names.map((name,i)=>[name,match[i+1]])),bindings=Object.fromEntries('task_id run_id runtime_id artifact_id thread_id message_id reviewer_agent_id'.split(' ').map(k=>[k,k==='runtime_id'?(params.runtime_instance_id??null):k==='reviewer_agent_id'?(params.agent_id??null):(params[k]??null)]));
  const [operation,target]=requiredCommitTuple(plan.process_operation,bindings,p.store_binding.credential_id);
  check(phase.commit.operation===operation&&phase.commit.target===target&&phase.commit.key_sha256===s.idempotency_key_sha256&&phase.commit.status===requests.at(-1).response_status);
 }
 if(!requests.length||plan.expected_status===401){check(phase.commit===null&&ids.length===0&&equal(phase.state.before,phase.state.after));}
 if(local)for(const when of ['before','after'])check(phase.state[when].record_count===0&&phase.state[when].canonical_bytes===0&&phase.state[when].selectors.length===0&&phase.state[when].sha256===hash('[]')&&phase.grant[when]===null&&phase.runtimes[when].length===0);
 const scan=keys(snapshot(a.scan,4096),'payload reference'),v=scan.payload,ref=scan.reference;
 keys(v,'type version profile run_id slot invocation_id preparation_sha256 pass final_original_sha256 stdout stderr secret_inventory_sha256 foreign_inventory_sha256 secret_provenance_sha256 foreign_provenance_sha256 secret_pattern_count foreign_pattern_count inventory_generation inventory_sha256 secret_match_count foreign_match_count encoding_profile started_at ended_at');
 check(v.type==='native-complete-output-scan'&&v.version===2&&v.profile===tag&&v.run_id===policy.run_id&&equal(v.slot,slot)&&v.invocation_id===p.invocation_id&&v.preparation_sha256===prep&&v.pass==='immediate'&&v.final_original_sha256===t.custody.final.sha256&&equal(v.stdout,t.output.stdout)&&equal(v.stderr,t.output.stderr)&&v.secret_match_count===0&&v.foreign_match_count===0&&v.encoding_profile==='literal-json-escaped-v1');
 for(const k of ['secret_inventory_sha256','foreign_inventory_sha256','secret_provenance_sha256','foreign_provenance_sha256','inventory_sha256'])check(digest(v[k]));
 check(integer(v.secret_pattern_count)&&v.secret_pattern_count>=5&&v.secret_pattern_count<=10&&integer(v.foreign_pattern_count)&&v.foreign_pattern_count>=3&&v.foreign_pattern_count<=5&&v.inventory_generation===v.secret_pattern_count+v.foreign_pattern_count&&integer(v.started_at)&&integer(v.ended_at)&&v.started_at<=v.ended_at);
 keys(ref,'record_id family sha256 byte_size');check(id(ref.record_id)&&ref.family==='secret-inventory-scan'&&ref.sha256===sha(v)&&ref.byte_size===Buffer.byteLength(canonical(v))&&ref.byte_size<=1557);
 // Only the scanner and options share this fixed service owner clock. Worker
 // phase timestamps are checked internally, never compared across hosts.
 const now=Date.now();check(integer(now)&&now>=v.ended_at&&now>=options.now&&now<policy.expires_at&&now<options.now+options.operationalMs);
 const payload={type:'native-complete-process-observation',version:2,profile:tag,run_id:policy.run_id,step_id:step.id,invocation_id:p.invocation_id,preparation_sha256:prep,process_final_sha256:t.custody.final.sha256,observed_at:now,binding_sha256:sha(p.store_binding),process_exit:null,request_count:requests.length,http_status:requests.at(-1)?.response_status??null,
  transport_ref:local?null:privateRef('transport','transport-response',{subject:s,transport:phase.transport},32768),
  state_ref:local?null:privateRef('state','selected-state',{subject:s,state:phase.state,reconciliation:phase.reconciliation,phase_sha256:sha(phase)},16384),journal_ref:null,artifact_ref:null,scan_ref:ref,supporting_disposition:'validated-then-released'};
 check(Buffer.byteLength(canonical(payload))<=caps.summary_records[step.id]);
 return freeze({scope:'source-core-composed',installedAuthority:false,native_conformance:false,payload,required_host_joins:['actual-final-custody-and-exit',...(local?['actual-retained-artifact']:step.id==='probe/wrong-runtime'?['actual-journal']:[])]});
 }catch{throw Error('NATIVE_COMPLETE_PROCESS_SUMMARY_REJECTED');}}
