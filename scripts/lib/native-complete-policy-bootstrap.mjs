/** Deterministic config2/statement policy reconstruction, not producer readiness.
 * Both sides need actual identical public config bytes; a digest cannot replace
 * configuration provisioning. Source reducers never authenticate statement origin.
 */
import {createHash,createPublicKey} from 'node:crypto';
import {types} from 'node:util';
import {isIP} from 'node:net';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {validateCompleteConfig} from './native-complete-config.mjs';
import {selectCompleteProfile} from './native-profile-selection.mjs';
import {createCompleteNativeRunContext} from './native-r2-session.mjs';
import {COMPLETE_INSTALLATION_CAPABILITIES} from './native-complete-installation.mjs';
import {completeInstallationMaterials,assertCompleteInstallationCurrent} from './native-host-v2-custody.mjs';
import {assertCompleteClientConfigBinding} from './native-complete-client-proof.mjs';
import {completeSlotRegistry,completePolicyDigest,validateCompletePolicy,snapshotCompleteValue as snapshot,freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const reject=()=>{throw Error('NATIVE_COMPLETE_POLICY_BOOTSTRAP_REJECTED');};
const check=value=>{if(!value)reject();};
function fields(input,names){
 check(input&&!types.isProxy(input)&&Object.getPrototypeOf(input)===Object.prototype);
 const d=Object.getOwnPropertyDescriptors(input);check(Reflect.ownKeys(d).length===names.length);
 return Object.fromEntries(names.map(k=>{check(d[k]?.enumerable&&Object.hasOwn(d[k],'value'));return[k,d[k].value];}));
}
const keys=(input,names)=>fields(input,names.split(' '));
const digest=(v,n=64)=>check(typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v));
const id=(v,n=128)=>check(typeof v==='string'&&new RegExp('^[A-Za-z0-9_-]{1,'+n+'}$').test(v));
const integer=(v,min=0)=>check(Number.isSafeInteger(v)&&!Object.is(v,-0)&&v>=min);
function origin(v){
 check(typeof v==='string'&&v.length<=2048);const u=new URL(v),host=u.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'');
 check(u.protocol==='https:'&&u.origin===v&&!u.username&&!u.password&&!isIP(host)&&host!=='localhost'&&!host.endsWith('.localhost'));
}
function publicKey(v){
 check(typeof v==='string'&&v.length===60);const bytes=Buffer.from(v,'base64');check(bytes.length===44&&bytes.toString('base64')===v);
 const key=createPublicKey({key:bytes,format:'der',type:'spki'});check(key.asymmetricKeyType==='ed25519'&&key.export({format:'der',type:'spki'}).equals(bytes));
}
function statement(input){
 const s=freeze(snapshot(input,16384));keys(s,'version scope installedAuthority descriptorSha256 anchorSha256 payload');
 check(s.version===2&&s.scope==='signed-installation-statement'&&s.installedAuthority===false);digest(s.descriptorSha256);digest(s.anchorSha256);
 const p=keys(s.payload,'epoch installation_id issuer service_id service_origin service_key_spki_base64 auth_ref not_before expires_at candidate_sha candidate_tree_sha composition_sha256 cli_sha256 host_sha256 config_sha256 scenario_sha256 source_inventory_sha256 environment_id namespace_id target_origin primary_workspace foreign_workspace capabilities profile fixture_sha256 family_ledger_sha256 private_inputs_sha256 client_key_spki_base64 client_auth_sha256');
 integer(p.epoch,1);integer(p.not_before);integer(p.expires_at,p.not_before+1001);check(p.expires_at-p.not_before<=300000);
 for(const k of ['installation_id','service_id','environment_id','namespace_id','primary_workspace','foreign_workspace'])id(p[k]);id(p.auth_ref,64);
 for(const k of ['issuer','service_origin','target_origin'])origin(p[k]);
 for(const k of ['candidate_sha','candidate_tree_sha'])digest(p[k],40);
 for(const k of ['composition_sha256','cli_sha256','host_sha256','config_sha256','scenario_sha256','source_inventory_sha256','fixture_sha256','family_ledger_sha256','private_inputs_sha256','client_auth_sha256'])digest(p[k]);
 publicKey(p.service_key_spki_base64);publicKey(p.client_key_spki_base64);check(p.service_key_spki_base64!==p.client_key_spki_base64);
 check(canonical(p.capabilities)===canonical(COMPLETE_INSTALLATION_CAPABILITIES));
 return s;
}
function derive(configInput,installationInput,runId,assurance){
 const config=freeze(validateCompleteConfig(configInput)),installation=statement(installationInput),p=installation.payload;
 id(runId);const selected=selectCompleteProfile(config.profile),context=createCompleteNativeRunContext(config,runId);
 check(p.profile===config.profile&&p.fixture_sha256===selected.commitments.fixture_sha256&&p.family_ledger_sha256===selected.commitments.family_ledger_sha256);
 check(p.target_origin===config.origin&&p.primary_workspace===config.workspaces.primary&&p.foreign_workspace===config.workspaces.foreign);
 for(const [key,contextKey]of Object.entries({candidate_sha:'candidateSha',candidate_tree_sha:'candidateTreeSha',composition_sha256:'compositionSha256',cli_sha256:'buildSha256',config_sha256:'configSha256',scenario_sha256:'scenarioSha256'}))check(p[key]===context[contextKey]);
 const slots=completeSlotRegistry(config.profile),unsupported=new Set();
 // The source relation is control -> corresponding probe, not a caller skip list.
 for(const mode of ['slot','generation','principal']){
  const control='control/prepare-swap-'+mode,probe='probe/swapped-'+mode;
  if(selected.profile.unavailable.includes(control)){
   check(slots.some(s=>s.id===control)&&slots.some(s=>s.id===probe)&&selected.scenario.steps.find(s=>s.id===probe)?.dependsOn.includes(control));
   unsupported.add(control);unsupported.add(probe);
  }
 }
 check(unsupported.size===2*selected.profile.unavailable.length);
 const instance_id=hash(canonical({type:'native-complete-installation-binding',version:2,installation_id:p.installation_id,environment_id:p.environment_id,namespace_id:p.namespace_id,service_id:p.service_id,descriptor_sha256:installation.descriptorSha256}));
 const policy={type:'native-complete-run-policy',version:2,profile:config.profile,assurance,service_id:p.service_id,instance_id,run_id:runId,descriptor_sha256:installation.descriptorSha256,run_context:context,
  actors_sha256:hash(canonical({actors:config.actors,fixture_stores:config.fixture_stores})),workspaces_sha256:hash(canonical(config.workspaces)),fixture_stores_sha256:hash(canonical(config.fixture_stores)),source_inventory_sha256:p.source_inventory_sha256,family_ledger_sha256:selected.commitments.family_ledger_sha256,
  coverage:slots.map(row=>({...row,supported:!unsupported.has(row.id),producer_id:unsupported.has(row.id)?null:'native-complete-'+row.kind})),expires_at:p.expires_at};
 // Historical framing is ONLY a syntax/invariant check. It is not current
 // admission, does not use the configured duration, and is never returned.
 const validated=validateCompletePolicy(policy,{context,now:p.not_before,operationalMs:1});
 return freeze({scope:'structural-policy-only',installedAuthority:false,native_conformance:false,policy:validated,policy_sha256:completePolicyDigest(validated)});
}
/** Explicit source-test seam: a lookalike statement is not authenticated here. */
export function buildCompletePolicyFromStatement(input){try{
 const a=keys(input,'config installation runId');return derive(a.config,a.installation,a.runId,'source-test-only');
 }catch{reject();}}
/** Production derives only from the existing private branded binding. No new
 * resolver/start/deadline is created; repeated derives cannot renew that lease.
 * Installed assurance records guarded installation, not actual producer readiness.
 */
export function deriveInstalledCompletePolicy(input){try{
 const a=keys(input,'binding runId'),materials=completeInstallationMaterials(a.binding);
 assertCompleteInstallationCurrent(a.binding);
 return derive(materials.config,materials.statement,a.runId,'installed');
 }catch{reject();}}
/** Source framing utility only. Keep the ORIGINAL result for an owner's lifetime;
 * calling this again is not permission to refresh an operational deadline.
 * Every actual effect still requires its independently owned current guard.
 */
export function createCompletePolicyFraming(input){try{
 const a=keys(input,'config policy now'),config=freeze(validateCompleteConfig(a.config)),policy=freeze(snapshot(a.policy));integer(a.now);
 const options=freeze({context:createCompleteNativeRunContext(config,policy.run_id),now:a.now,operationalMs:config.budgets.duration_ms});
 assertCompleteClientConfigBinding(config,policy,options);
 return options;
 }catch{reject();}}
