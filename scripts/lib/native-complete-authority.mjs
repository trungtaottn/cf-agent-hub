/** Canonical private authority-record CONTENT verification only.
 * Root signature/custody provenance belongs to the fixed guarded caller. A
 * lookalike installation object never becomes authenticated by this reducer.
 * Initial admission framing preserves the original signed lease; current guards
 * must reread the actual admitted bytes, not renew a full duration here.
 */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {validateCompleteConfig} from './native-complete-config.mjs';
import {snapshotCompleteValue as snapshot,completeKeys as keys} from './native-complete-protocol.mjs';
import {COMPLETE_INSTALLATION_CAPABILITIES} from './native-complete-installation.mjs';
export const COMPLETE_AUTHORITY_RECORD_LIMIT=1024;
const domain='AGENTHUB_NATIVE_COMPLETE_AUTHORITY_CONFIG_SUBJECT_V2\n';
const fail=()=>{throw Error('NATIVE_COMPLETE_AUTHORITY_REJECTED');},check=v=>{if(!v)fail();},hash=v=>createHash('sha256').update(v).digest('hex');
const integer=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0),id=v=>typeof v==='string'&&v.length>=1&&v.length<=128&&!/[^A-Za-z0-9_-]/.test(v),digest=v=>typeof v==='string'&&v.length===64&&!/[^a-f0-9]/.test(v);
const typed=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(typed,'byteLength').get,backing=Object.getOwnPropertyDescriptor(typed,'buffer').get;
function fields(input,names){check(input&&!types.isProxy(input)&&Object.getPrototypeOf(input)===Object.prototype);const d=Object.getOwnPropertyDescriptors(input);check(Reflect.ownKeys(d).length===names.length);return Object.fromEntries(names.map(k=>{check(d[k]?.enumerable&&Object.hasOwn(d[k],'value'));return[k,d[k].value];}));}
function subject(config){const {authority_record_sha256,...rest}=config;return hash(domain+canonical(rest));}
export function completeAuthorityConfigSubject(input){try{return subject(validateCompleteConfig(input));}catch{fail();}}
export function verifyCompleteAuthorityRecord(input){try{
 const a=fields(input,['bytes','config','installation','now','operationalMs']);check(integer(a.now)&&integer(a.operationalMs)&&a.operationalMs>=1&&a.operationalMs<=300000);
 const b=a.bytes;check(b&&!types.isProxy(b)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(b)));const n=length.call(b);check(n>0&&n<=COMPLETE_AUTHORITY_RECORD_LIMIT&&Object.getPrototypeOf(backing.call(b))===ArrayBuffer.prototype&&Reflect.ownKeys(b).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)));
 const bytes=Buffer.from(b),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(bytes),r=snapshot(JSON.parse(text),COMPLETE_AUTHORITY_RECORD_LIMIT);check(canonical(r)===text);keys(r,'type version profile config_subject_sha256 environment_id namespace_id service_id capabilities not_before expires_at');
 const config=validateCompleteConfig(a.config),installation=snapshot(a.installation,16384);keys(installation,'version scope installedAuthority descriptorSha256 anchorSha256 payload');check(installation.version===2&&installation.scope==='signed-installation-statement'&&installation.installedAuthority===false&&digest(installation.descriptorSha256)&&digest(installation.anchorSha256));const p=installation.payload;
 check(r.type==='native-complete-authority'&&r.version===2&&r.profile===config.profile&&digest(r.config_subject_sha256)&&r.config_subject_sha256===subject(config));for(const k of ['environment_id','namespace_id','service_id'])check(id(r[k])&&r[k]===p[k]);
 check(Array.isArray(r.capabilities)&&canonical(r.capabilities)===canonical(COMPLETE_INSTALLATION_CAPABILITIES)&&canonical(p.capabilities)===canonical(r.capabilities));
 check(integer(r.not_before)&&integer(r.expires_at)&&r.not_before<=a.now&&r.expires_at>a.now&&r.expires_at-r.not_before<=300000&&r.expires_at-a.now>=a.operationalMs+1000&&integer(p.not_before)&&integer(p.expires_at)&&p.not_before<=r.not_before&&p.expires_at>=r.expires_at&&p.profile===r.profile);
 const authorityRecordSha256=hash(bytes),configSha256=hash(canonical(config));check(authorityRecordSha256===config.authority_record_sha256&&p.config_sha256===configSha256);
 return Object.freeze({authorityRecordSha256,configSha256,expiresAt:r.expires_at});
 }catch{fail();}}
