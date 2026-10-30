/** Exact fixed-bundle verification. Pure verification is not installed custody. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {selectNativeExecutionProfile} from './native-execution-profile.mjs';
import {verifyCompleteInstallationStatement} from './native-complete-installation.mjs';
import {nativeSourceInventoryDigest} from './native-r2-evidence.mjs';
import {completeClientFields as fields} from './native-complete-client-proof.mjs';
import {freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
const fail=()=>{throw Error('NATIVE_COMPLETE_BUNDLE_REJECTED');},check=v=>{if(!v)fail();},hash=v=>createHash('sha256').update(v).digest('hex'),verified=new WeakMap();
const proto=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(proto,'byteLength').get,backing=Object.getOwnPropertyDescriptor(proto,'buffer').get;
function copy(input,max){check(input&&!types.isProxy(input)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(input)));const n=length.call(input);check(n>0&&n<=max&&Object.getPrototypeOf(backing.call(input))===ArrayBuffer.prototype);const owned=new Uint8Array(n);Uint8Array.prototype.set.call(owned,input);return Buffer.from(owned.buffer);}
export function copyCompleteHostInventory(input){try{
 check(input&&!types.isProxy(input)&&Array.isArray(input)&&Object.getPrototypeOf(input)===Array.prototype);const ds=Object.getOwnPropertyDescriptors(input),n=ds.length?.value;check(Number.isSafeInteger(n)&&n>0&&n<=2048&&Reflect.ownKeys(ds).length===n+1);const rows=[];
 for(let i=0;i<n;i++){const d=ds[String(i)];check(d?.enumerable&&Object.hasOwn(d,'value'));const row=fields(d.value,['path','sha256','byte_size','mode']);check(typeof row.path==='string'&&row.path.length<=256&&typeof row.sha256==='string'&&row.sha256.length===64&&Number.isSafeInteger(row.byte_size)&&row.byte_size>=0&&typeof row.mode==='string'&&['100644','100755'].includes(row.mode));rows.push(row);}
 nativeSourceInventoryDigest(rows);return freeze(rows);
 }catch{fail();}}
export function completeHostSubjects(config,hostSha256,sourceInventorySha256){try{const selected=selectNativeExecutionProfile(config),c=selected.config;check(c.version===2&&c.profile==='native-r2-required-prepared-v1'&&typeof hostSha256==='string'&&hostSha256.length===64&&typeof sourceInventorySha256==='string'&&sourceInventorySha256.length===64&&/^[a-f0-9]{64}$/.test(hostSha256)&&/^[a-f0-9]{64}$/.test(sourceInventorySha256));return freeze({candidate_sha:c.candidate_sha,candidate_tree_sha:c.candidate_tree_sha,composition_sha256:c.composition_sha256,cli_sha256:c.build.sha256,host_sha256:hostSha256,config_sha256:selected.configSha256,scenario_sha256:selected.scenarioSha256,source_inventory_sha256:sourceInventorySha256,target_origin:c.origin,primary_workspace:c.workspaces.primary,foreign_workspace:c.workspaces.foreign,profile:c.profile,fixture_sha256:c.fixture_sha256,family_ledger_sha256:c.family_ledger_sha256});}catch{fail();}}
export function verifyCompleteHostBundle(input){try{
 const a=fields(input,['config','anchorBytes','descriptorBytes','bundleBytes','now']),selected=selectNativeExecutionProfile(a.config),bundle=copy(a.bundleBytes,4194304),anchor=copy(a.anchorBytes,4096),descriptor=copy(a.descriptorBytes,16384);check(Number.isSafeInteger(a.now)&&a.now>=0);
 // This value is provisional, never described as independently observed. The
 // actual exported inventory is compared after exact signed-code import.
 const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(descriptor)),inventorySha=raw?.payload?.source_inventory_sha256,hostSha256=hash(bundle),subjects=completeHostSubjects(selected.config,hostSha256,inventorySha),statement=verifyCompleteInstallationStatement({anchorBytes:anchor,descriptorBytes:descriptor,subjects,now:a.now,operationalMs:selected.config.budgets.duration_ms});
 const result=Object.freeze({scope:'root-signed-fixed-bundle-content',installedAuthority:false,hostSha256,sourceInventorySha256:inventorySha,dataUrl:'data:text/javascript;base64,'+bundle.toString('base64')});verified.set(result,{statement,subjects});return result;
 }catch{fail();}}
export function verifyCompleteHostExports(module,verification){try{
 const v=verified.get(verification);check(v&&module&&!types.isProxy(module)&&Object.getPrototypeOf(module)===null);const ds=Object.getOwnPropertyDescriptors(module),names=Reflect.ownKeys(ds);check(names.every(k=>typeof k==='string'||k===Symbol.toStringTag));const strings=names.filter(k=>typeof k==='string');check(strings.length===3&&['COMPLETE_HOST_BUNDLE_VERSION','COMPLETE_HOST_SOURCE_INVENTORY','executeFixedCompleteHost'].every(k=>ds[k]?.enumerable&&Object.hasOwn(ds[k],'value')));check(ds.COMPLETE_HOST_BUNDLE_VERSION.value===1);const fn=ds.executeFixedCompleteHost.value;check(typeof fn==='function'&&!types.isProxy(fn));const inventory=copyCompleteHostInventory(ds.COMPLETE_HOST_SOURCE_INVENTORY.value);check(nativeSourceInventoryDigest(inventory)===v.statement.payload.source_inventory_sha256);return fn;
 }catch{fail();}}

/** Runtime self-reference is the loader's exact immutable data URL, not a build
 * hash embedded into itself or a caller-supplied consumed-code claim. */
export function assertCompleteConsumedBundle(url,expectedSha256){try{
 const prefix='data:text/javascript;base64,';check(typeof url==='string'&&url.startsWith(prefix)&&url.length<=prefix.length+4*Math.ceil(4194304/3)&&typeof expectedSha256==='string'&&/^[a-f0-9]{64}$/.test(expectedSha256));const encoded=url.slice(prefix.length);check(encoded.length>0&&encoded.length%4===0&&!/[^A-Za-z0-9+/=]/.test(encoded));const bytes=Buffer.from(encoded,'base64');check(bytes.length>0&&bytes.length<=4194304&&bytes.toString('base64')===encoded&&hash(bytes)===expectedSha256);return true;
 }catch{fail();}}
