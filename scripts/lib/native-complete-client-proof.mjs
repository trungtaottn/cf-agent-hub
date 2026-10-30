/** Delegated request proof only. Signed statements do not establish file custody. */
import {createHash,createPublicKey,KeyObject,sign,verify} from 'node:crypto';
import {types} from 'node:util';
import {isIP} from 'node:net';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {selectCompleteProfile} from './native-profile-selection.mjs';
import {validateCompletePolicy,snapshotCompleteValue as snapshot,freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
import {validateCompleteConfig} from './native-complete-config.mjs';
import {validateCompleteRequest} from './native-complete-request.mjs';
const domain='AGENTHUB_NATIVE_COMPLETE_REQUEST_V2\n';
const fail=()=>{throw Error('NATIVE_COMPLETE_CLIENT_PROOF_REJECTED');},check=v=>{if(!v)fail();},hash=b=>createHash('sha256').update(b).digest('hex');
export function completeClientFields(input,names){check(input&&!types.isProxy(input)&&Object.getPrototypeOf(input)===Object.prototype);const d=Object.getOwnPropertyDescriptors(input);check(Reflect.ownKeys(d).length===names.length);return Object.fromEntries(names.map(k=>{check(d[k]?.enumerable&&Object.hasOwn(d[k],'value'));return[k,d[k].value];}));}
export function createCompleteClientProof(input){try{
 const a=completeClientFields(input,['policy','validationOptions','installation','privateKey']);
 const options=freeze(snapshot(a.validationOptions,4096)),policy=validateCompletePolicy(a.policy,options),installation=freeze(snapshot(a.installation,16384)),p=installation.payload,c=policy.run_context;
 check(installation.version===2&&installation.scope==='signed-installation-statement'&&installation.installedAuthority===false&&installation.descriptorSha256===policy.descriptor_sha256);
 check(p&&p.profile===policy.profile&&p.service_id===policy.service_id&&p.family_ledger_sha256===policy.family_ledger_sha256&&p.source_inventory_sha256===policy.source_inventory_sha256);
 const selected=selectCompleteProfile(policy.profile);check(p.fixture_sha256===selected.commitments.fixture_sha256);
 for(const [left,right] of Object.entries({candidate_sha:'candidateSha',candidate_tree_sha:'candidateTreeSha',composition_sha256:'compositionSha256',config_sha256:'configSha256',scenario_sha256:'scenarioSha256',cli_sha256:'buildSha256'}))check(p[left]===c[right]);
 check(Number.isSafeInteger(p.not_before)&&Number.isSafeInteger(p.expires_at)&&p.not_before<=options.now&&p.expires_at>=policy.expires_at);
 const url=new URL(p.service_origin),host=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'');check(url.protocol==='https:'&&url.origin===p.service_origin&&!url.username&&!url.password&&!isIP(host)&&host!=='localhost'&&!host.endsWith('.localhost'));
 check(a.privateKey instanceof KeyObject&&!types.isProxy(a.privateKey)&&a.privateKey.type==='private'&&a.privateKey.asymmetricKeyType==='ed25519');
 const publicKey=createPublicKey(a.privateKey),spki=publicKey.export({format:'der',type:'spki'});check(spki.length===44&&spki.toString('base64')===p.client_key_spki_base64);const keyId=hash(spki);
 const validated=request=>validateCompleteRequest(request,policy,options);
 function headers(input){const h=completeClientFields(input,['x-native-client-key-id','x-native-client-signature']);check(h['x-native-client-key-id']===keyId&&typeof h['x-native-client-signature']==='string'&&h['x-native-client-signature'].length===88);const sig=Buffer.from(h['x-native-client-signature'],'base64');check(sig.length===64&&sig.toString('base64')===h['x-native-client-signature']&&Buffer.byteLength(canonical(h))===212);return {h,sig};}
 return Object.freeze({scope:'signed-statement-only',installedAuthority:false,policy,validationOptions:options,origin:p.service_origin,expires_at:p.expires_at,
  sign(request){try{const r=validated(request),body=canonical(r),signature=sign(null,Buffer.from(domain+body),a.privateKey).toString('base64'),h={'x-native-client-key-id':keyId,'x-native-client-signature':signature};headers(h);return freeze({body,headers:h});}catch{fail();}},
  verify(request,input){try{const r=validated(request),{sig}=headers(input);check(verify(null,Buffer.from(domain+canonical(r)),publicKey,sig));return true;}catch{fail();}}
 });
 }catch{fail();}}

/** Pure join of existing config/policy conventions. Never an authority grant. */
export function assertCompleteClientConfigBinding(configInput,policyInput,options){try{
 const c=validateCompleteConfig(configInput),p=validateCompletePolicy(policyInput,options),context=p.run_context;
 check(c.profile===p.profile&&c.family_ledger_sha256===p.family_ledger_sha256&&c.budgets.duration_ms===options.operationalMs);
 for(const [configKey,contextKey] of Object.entries({candidate_sha:'candidateSha',candidate_tree_sha:'candidateTreeSha',composition_sha256:'compositionSha256',authority_record_sha256:'authorityRecordSha256'}))check(c[configKey]===context[contextKey]);
 check(c.node.sha256===context.nodeSha256&&c.build.sha256===context.buildSha256&&hash(canonical(c))===context.configSha256);
 check(hash(canonical({actors:c.actors,fixture_stores:c.fixture_stores}))===p.actors_sha256);
 check(hash(canonical(c.workspaces))===p.workspaces_sha256&&hash(canonical(c.fixture_stores))===p.fixture_stores_sha256);
 }catch{fail();}}
