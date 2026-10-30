/** Fixed service installation content verification. Only trusted operator bindings
 * feed this boundary; incoming HTTP can never supply roots, keys or config. */
import {createHash} from 'node:crypto';
import {importOwnedEd25519PrivateKey} from './native-owned-ed25519-key.mjs';
import {types} from 'node:util';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {validateCompleteConfig} from './native-complete-config.mjs';
import {completeHostSubjects} from './native-complete-bundle.mjs';
import {verifyCompleteInstallationStatement} from './native-complete-installation.mjs';
import {verifyCompleteAuthorityRecord} from './native-complete-authority.mjs';
import {parseCompleteFixtureInputs,parseCompleteCredential,parseCompleteHuman} from './native-complete-installed-inputs.mjs';
import {buildCompletePolicyFromStatement,createCompletePolicyFraming} from './native-complete-policy-bootstrap.mjs';
import {deriveCompleteFixtureContext} from './native-complete-fixture-context.mjs';
import {validateCompletePolicy,completePolicyDigest,freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
const reject=()=>{throw Error('NATIVE_COMPLETE_SERVICE_CONFIGURATION_REJECTED');};
const check=v=>{if(!v)reject();},hash=b=>createHash('sha256').update(b).digest('hex'),bindings=new WeakMap();
const typed=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(typed,'byteLength').get,backing=Object.getOwnPropertyDescriptor(typed,'buffer').get;
function fields(v,names){check(v&&typeof v==='object'&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype);const ds=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(ds).length===names.length);return Object.fromEntries(names.map(k=>{check(ds[k]?.enumerable&&Object.hasOwn(ds[k],'value'));return[k,ds[k].value];}));}
function copy(v,cap){check(v&&!types.isProxy(v)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(v)));const size=length.call(v);check(size>0&&size<=cap&&Object.getPrototypeOf(backing.call(v))===ArrayBuffer.prototype);const b=new Uint8Array(size);Uint8Array.prototype.set.call(b,v);return Buffer.from(b.buffer);}
const json=b=>JSON.parse(new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(b));
export function verifyCompleteServiceConfiguration(input){try{
 const a=fields(input,['configBytes','anchorBytes','descriptorBytes','authorityBytes','privateInputsBytes','credentials','humanBytes','serviceKeyBytes','now']);check(Number.isSafeInteger(a.now)&&a.now>=0);
 const configBytes=copy(a.configBytes,65536),anchorBytes=copy(a.anchorBytes,4096),descriptorBytes=copy(a.descriptorBytes,16384),authorityBytes=copy(a.authorityBytes,1024),privateInputsBytes=copy(a.privateInputsBytes,3446),humanBytes=copy(a.humanBytes,123),serviceKeyBytes=copy(a.serviceKeyBytes,48);check(serviceKeyBytes.length===48);
 const config=freeze(validateCompleteConfig(json(configBytes)));check(config.profile==='native-r2-required-prepared-v1');
 // Host code/source commitments are authenticated by the operator's root here;
 // the actual host separately matches them to its consumed immutable artifact.
 const preliminary=json(descriptorBytes)?.payload,subjects=completeHostSubjects(config,preliminary?.host_sha256,preliminary?.source_inventory_sha256),installation=verifyCompleteInstallationStatement({anchorBytes,descriptorBytes,subjects,now:a.now,operationalMs:config.budgets.duration_ms});
 const authority=verifyCompleteAuthorityRecord({bytes:authorityBytes,config,installation,now:a.now,operationalMs:config.budgets.duration_ms});
 check(hash(privateInputsBytes)===installation.payload.private_inputs_sha256);const inputs=parseCompleteFixtureInputs({wire:privateInputsBytes,config,authRef:installation.payload.auth_ref}),human=parseCompleteHuman(humanBytes),raw=fields(a.credentials,['S','R','X']);
 const credentials=['S','R','X'].map(role=>{check(typeof raw[role]==='string'&&raw[role].length===43);const token=parseCompleteCredential(Buffer.from(raw[role]));return {role,token,sha256:hash(token)};});
 check(installation.payload.service_key_spki_base64!==installation.payload.client_key_spki_base64);
 const privateKey=importOwnedEd25519PrivateKey({pkcs8:serviceKeyBytes,publicKeyDer:Buffer.from(installation.payload.service_key_spki_base64,'base64')});
 const binding=Object.freeze({scope:'verified-operator-service-content',installedAuthority:false,native_conformance:false,descriptorSha256:installation.descriptorSha256,authorityRecordSha256:authority.authorityRecordSha256});
 bindings.set(binding,{config,installation,authority,inputs,credentials:freeze(credentials),human,privateKey,descriptorBytes,now:a.now,lastNow:a.now,deadline:a.now+config.budgets.duration_ms,run:null,failed:false});serviceKeyBytes.fill(0);humanBytes.fill(0);return binding;
}catch{reject();}}
function current(binding,now){const b=bindings.get(binding);try{check(b&&!b.failed&&Number.isSafeInteger(now)&&now>=b.lastNow&&now<b.deadline+1000&&now<b.authority.expiresAt&&now<b.installation.payload.expires_at);b.lastNow=now;return b;}catch{if(b)b.failed=true;reject();}}
export function readCompleteServiceConfiguration(binding){const b=bindings.get(binding);check(b&&!b.failed);return Object.freeze({serviceOrigin:b.installation.payload.service_origin,targetOrigin:b.config.origin,configSha256:b.authority.configSha256,descriptorSha256:b.installation.descriptorSha256,deadline:b.deadline});}
export function assertCompleteServiceConfigurationCurrent(binding,now){current(binding,now);return true;}
export function deriveCompleteServiceRun(binding,runId,now){try{
 const b=current(binding,now);check(b.run===null&&typeof runId==='string'&&/^run_[a-f0-9]{32}$/.test(runId)&&runId.length===36&&now<b.deadline);
 const structural=buildCompletePolicyFromStatement({config:b.config,installation:b.installation,runId});
 // Only the private brand minted above can select installed assurance. This
 // records verified operator content, not a completed service or native run.
 const candidate={...structural.policy,assurance:'installed'},options=createCompletePolicyFraming({config:b.config,policy:candidate,now:b.now}),policy=validateCompletePolicy(candidate,options),fixture=deriveCompleteFixtureContext({config:b.config,inputs:b.inputs,credentials:b.credentials,human:b.human,installation:b.installation,runId});
 const result=Object.freeze({policy,policySha256:completePolicyDigest(policy),validationOptions:options,installation:b.installation,privateKey:b.privateKey,expected:fixture.expected,initialGrantSha256:Object.freeze(Object.fromEntries(fixture.initial_grants.map(g=>[g.role,g.sha256]))),descriptorBytes:Buffer.from(b.descriptorBytes),authorization:b.authority});b.run=runId;return result;
}catch{const b=bindings.get(binding);if(b)b.failed=true;reject();}}
