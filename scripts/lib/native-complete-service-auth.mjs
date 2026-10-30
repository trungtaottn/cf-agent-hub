/** Public-key request authentication only. Installation custody and service effects
 * are owned by the fixed composition; this reducer grants neither authority. */
import {createHash,createPublicKey,verify} from 'node:crypto';
import {types} from 'node:util';
import {isIP} from 'node:net';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {completeClientFields as fields} from './native-complete-client-proof.mjs';
import {selectCompleteProfile} from './native-profile-selection.mjs';
import {validateCompletePolicy,snapshotCompleteValue as snapshot,freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
import {validateCompleteRequest} from './native-complete-request.mjs';
const fail=()=>{throw Error('NATIVE_COMPLETE_SERVICE_AUTH_REJECTED');},check=v=>{if(!v)fail();},hash=b=>createHash('sha256').update(b).digest('hex');
const typed=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(typed,'byteLength').get,backing=Object.getOwnPropertyDescriptor(typed,'buffer').get;
export function createCompleteServiceAuthenticator(input){try{
 const a=fields(input,['policy','validationOptions','installation']),options=freeze(snapshot(a.validationOptions,4096)),policy=validateCompletePolicy(a.policy,options),statement=freeze(snapshot(a.installation,16384)),p=statement.payload,c=policy.run_context;
 check(statement.version===2&&statement.scope==='signed-installation-statement'&&statement.installedAuthority===false&&statement.descriptorSha256===policy.descriptor_sha256);
 check(p&&p.profile===policy.profile&&p.service_id===policy.service_id&&p.family_ledger_sha256===policy.family_ledger_sha256&&p.source_inventory_sha256===policy.source_inventory_sha256);
 check(p.fixture_sha256===selectCompleteProfile(policy.profile).commitments.fixture_sha256);
 for(const [left,right] of Object.entries({candidate_sha:'candidateSha',candidate_tree_sha:'candidateTreeSha',composition_sha256:'compositionSha256',config_sha256:'configSha256',scenario_sha256:'scenarioSha256',cli_sha256:'buildSha256'}))check(p[left]===c[right]);
 check(Number.isSafeInteger(p.not_before)&&Number.isSafeInteger(p.expires_at)&&p.not_before<=options.now&&p.expires_at>=policy.expires_at);
 const url=new URL(p.service_origin),host=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'');check(url.protocol==='https:'&&url.origin===p.service_origin&&!url.username&&!url.password&&!isIP(host)&&host!=='localhost'&&!host.endsWith('.localhost'));
 check(typeof p.client_key_spki_base64==='string'&&p.client_key_spki_base64.length===60);const der=Buffer.from(p.client_key_spki_base64,'base64');check(der.length===44&&der.toString('base64')===p.client_key_spki_base64);const key=createPublicKey({key:der,format:'der',type:'spki'});check(key.asymmetricKeyType==='ed25519'&&key.export({format:'der',type:'spki'}).equals(der));const keyId=hash(der);
 return Object.freeze({origin:p.service_origin,scope:'authenticated-statement-only',installedAuthority:false,native_conformance:false,
 verify(inputBytes,inputHeaders){try{
  check(inputBytes&&!types.isProxy(inputBytes)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(inputBytes)));const size=length.call(inputBytes);check(size>0&&size<=45543&&Object.getPrototypeOf(backing.call(inputBytes))===ArrayBuffer.prototype);check(Reflect.ownKeys(inputBytes).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)));
  const bytes=Buffer.from(inputBytes),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(bytes),r=validateCompleteRequest(JSON.parse(text),policy,options);check(canonical(r)===text);
  const h=fields(inputHeaders,['x-native-client-key-id','x-native-client-signature']);check(h['x-native-client-key-id']===keyId&&typeof h['x-native-client-signature']==='string'&&h['x-native-client-signature'].length===88);const sig=Buffer.from(h['x-native-client-signature'],'base64');check(sig.length===64&&sig.toString('base64')===h['x-native-client-signature']&&Buffer.byteLength(canonical(h))===212);check(verify(null,Buffer.concat([Buffer.from('AGENTHUB_NATIVE_COMPLETE_REQUEST_V2\n'),bytes]),key,sig));
  return freeze({scope:'authenticated-statement-only',installedAuthority:false,native_conformance:false,request:r,request_sha256:hash(bytes),byte_size:size});
 }catch{fail();}}
 });
}catch{fail();}}
