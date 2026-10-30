import {verifyCompleteAuthorityRecord} from './native-complete-authority.mjs';
import {verifyCompleteHostBundle,verifyCompleteHostExports,copyCompleteHostInventory,completeHostSubjects,assertCompleteConsumedBundle} from './native-complete-bundle.mjs';
import {nativeSourceInventoryDigest} from './native-r2-evidence.mjs';
/** Fixed operator installation reads. No installer, path override or default authority. */
import {constants,openSync,closeSync,fstatSync,lstatSync,readSync} from 'node:fs';
import {dirname,join} from 'node:path';import {createHash} from 'node:crypto';import {types} from 'node:util';
import {verifyNativeInstallationStatement} from './native-host-v2-installation.mjs';
import {getNativeScenario} from './native-r2-scenario.mjs';
import {verifyCompleteInstallationStatement} from './native-complete-installation.mjs';
import {parseCompleteFixtureInputs,COMPLETE_FIXTURE_INPUT_LIMIT,parseCompleteCredential,parseCompleteHuman,parseCompleteClientAuth} from './native-complete-installed-inputs.mjs';
import {validateCompleteConfig} from './native-complete-config.mjs';
import {canonicalCaseSubject} from './r2-case-policy.mjs';
import {snapshotCompleteValue,freezeCompleteValue} from './native-complete-protocol.mjs';
const reject=()=>{throw Error('NATIVE_INSTALLATION_CUSTODY_REJECTED');},check=v=>{if(!v)reject();};
const caps={anchor:4096,descriptor:16384,bundle:4194304,auth:4096,'complete-authority':1024,'complete-inputs':2280,'complete-fixture-inputs':COMPLETE_FIXTURE_INPUT_LIMIT,'complete-client':220,'complete-human':123,'complete-token':43},bindings=new WeakMap();
function closed(v,keys){check(v&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype);const d=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(d).length===keys.length);return Object.fromEntries(keys.map(k=>{check(d[k]?.enumerable&&Object.hasOwn(d[k],'value'));return[k,d[k].value];}));}
export function installationRuntimeAllowed(value){try{const v=closed(value,['platform','uid','euid','status']);check(v.platform==='linux'&&Number.isSafeInteger(v.uid)&&v.uid>0&&v.uid<=4294967295&&v.uid===v.euid&&typeof v.status==='string'&&v.status.length<=65536&&Buffer.byteLength(v.status)<=65536);const needed=['Uid','CapInh','CapPrm','CapEff','CapAmb','NoNewPrivs'],found={};for(const line of v.status.split('\n')){const colon=line.indexOf(':');const k=line.slice(0,colon);if(needed.includes(k)){check(!Object.hasOwn(found,k));found[k]=line.slice(colon+1);}}check(needed.every(k=>Object.hasOwn(found,k)));check(/^[ \t]+\d+[ \t]+\d+[ \t]+\d+[ \t]+\d+$/.test(found.Uid));check(found.Uid.trim().split(/[ \t]+/).every(x=>Number(x)===v.uid));for(const k of ['CapInh','CapPrm','CapEff','CapAmb'])check(/^[ \t]+0{16}$/.test(found[k]));check(/^[ \t]+1$/.test(found.NoNewPrivs));return true;}catch{return false;}}
export function installationStatAllowed(kind,value){try{check(typeof kind==='string');const v=closed(value,['directory','regular','symlink','uid','mode','nlink','size']);check(v.symlink===false&&v.uid===0n&&typeof v.mode==='bigint'&&typeof v.nlink==='bigint'&&typeof v.size==='bigint'&&(v.mode&0o7022n)===0n);if(kind==='directory')return v.directory===true&&v.regular===false&&v.nlink>=1n;check(Object.hasOwn(caps,kind)&&v.directory===false&&v.regular===true&&v.nlink===1n&&(v.mode&0o111n)===0n&&v.size>0n&&v.size<=BigInt(caps[kind]));if(kind==='auth'||kind.startsWith('complete-'))check([0o600n,0o640n].includes(v.mode&0o777n)&&v.size>=16n);return true;}catch{return false;}}
const metadata=s=>({directory:s.isDirectory(),regular:s.isFile(),symlink:s.isSymbolicLink(),uid:s.uid,mode:s.mode,nlink:s.nlink,size:s.size});
const same=(a,b)=>['dev','ino','uid','mode','nlink','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
function boundedRead(fd,size){const bytes=Buffer.alloc(size);let at=0;while(at<size){const n=readSync(fd,bytes,at,size-at,at);check(n>0);at+=n;}check(readSync(fd,Buffer.alloc(1),0,1,size)===0);return bytes;}
function runtime(){let fd;try{fd=openSync('/proc/self/status',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const buf=Buffer.alloc(65537);let at=0;while(at<buf.length){const n=readSync(fd,buf,at,buf.length-at,null);if(!n)break;at+=n;}check(at<=65536);check(installationRuntimeAllowed({platform:process.platform,uid:process.getuid(),euid:process.geteuid(),status:new TextDecoder('utf8',{fatal:true}).decode(buf.subarray(0,at))}));}finally{if(fd!==undefined)closeSync(fd);}}
function readRootFile(path,kind){const handles=[];let fd;try{const dirs=[];for(let p=dirname(path);;p=dirname(p)){dirs.unshift(p);if(p==='/')break;}for(const p of dirs){const before=lstatSync(p,{bigint:true});check(installationStatAllowed('directory',metadata(before)));const d=openSync(p,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);handles.push({path:p,fd:d,stat:before});check(same(before,fstatSync(d,{bigint:true})));}const parent=handles.at(-1),name=path.slice(dirname(path).length+1),anchored=join('/proc/self/fd/'+parent.fd,name);const before=lstatSync(anchored,{bigint:true});check(installationStatAllowed(kind,metadata(before)));fd=openSync(anchored,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);check(same(before,fstatSync(fd,{bigint:true})));const bytes=boundedRead(fd,Number(before.size));check(same(before,fstatSync(fd,{bigint:true}))&&same(before,lstatSync(anchored,{bigint:true})));for(const h of handles)check(same(h.stat,fstatSync(h.fd,{bigint:true}))&&same(h.stat,lstatSync(h.path,{bigint:true})));return bytes;}finally{let failed=false;if(fd!==undefined)try{closeSync(fd);}catch{failed=true;}for(const h of handles.reverse())try{closeSync(h.fd);}catch{failed=true;}if(failed)reject();}}
/** Not invoked by source tests. Actual root files/launch conditions are operator inputs. */
export function resolveFixedNativeInstallation(subjects){try{runtime();const anchorBytes=readRootFile('/etc/agenthub-native/trust-v2.json','anchor'),descriptorBytes=readRootFile('/etc/agenthub-native/installation-v2.json','descriptor');const statement=verifyNativeInstallationStatement({anchorBytes,descriptorBytes,subjects,now:Date.now()});const result=Object.freeze({version:2,scope:'protected-installation-binding',authority:'pending-service-preflight',descriptorSha256:statement.descriptorSha256,anchorSha256:statement.anchorSha256});bindings.set(result,{statement,subjects:Object.freeze({...subjects})});return result;}catch{reject();}}
const scenarioPin='08cea014466b73dc67b534147ca8cc3b5939bee46a2b85a2ffc12ae02271bb25';
const incompleteSource=['fixed-host-composition','native-front-door-observer','native-state-producer','signed-service-grant','fixed-host-bundle-closure'];
export function unavailableNativeV2Capabilities(){const scenario=getNativeScenario();check(createHash('sha256').update(JSON.stringify(scenario)).digest('hex')===scenarioPin);return Object.freeze([...scenario.steps.filter(s=>['control/prepare-swap-slot','control/prepare-swap-generation','control/prepare-swap-principal'].includes(s.id)).map(s=>s.id),...incompleteSource]);}
/** Unsupported source controls stop before auth, bundle import or network. */
export async function loadFixedNativeHost(binding){try{const saved=bindings.get(binding);check(saved);check(unavailableNativeV2Capabilities().length===0);runtime();const current=resolveFixedNativeInstallation(saved.subjects);check(current.descriptorSha256===binding.descriptorSha256&&current.anchorSha256===binding.anchorSha256);const bytes=readRootFile('/opt/agenthub-native/host-v2.mjs','bundle');check(createHash('sha256').update(bytes).digest('hex')===saved.statement.payload.host_sha256);const url='data:text/javascript;base64,'+bytes.toString('base64');check(Buffer.byteLength(url)<=5592436);const module=await import(url);check(typeof module.createFixedNativeHost==='function');return module;}catch{reject();}}


// Complete-profile inputs are a separate fixed resolver. Nothing here installs
// files or makes pending service authority usable. Trusted host code alone imports
// the branded private accessor; it is not a configurable path/RPC/secret reader.
const completeBindings=new WeakMap();
const privateHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const completeReject=()=>{throw Error('NATIVE_COMPLETE_INSTALLATION_CUSTODY_REJECTED');};
/** Byte retention only, not trust verification or authority admission. */
export function encodeCompleteInstallationOriginals(input){try{
 const v=closed(input,['anchorBytes','descriptorBytes','anchorSha256','descriptorSha256']),out={};
 const proto=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(proto,'byteLength').get,backing=Object.getOwnPropertyDescriptor(proto,'buffer').get;
 for(const [name,max]of [['anchor',4096],['descriptor',16384]]){const b=v[name+'Bytes'];check(b&&!types.isProxy(b)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(b)));const n=length.call(b);check(n>0&&n<=max&&Object.getPrototypeOf(backing.call(b))===ArrayBuffer.prototype&&Reflect.ownKeys(b).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)));check(typeof v[name+'Sha256']==='string'&&/^[a-f0-9]{64}$/.test(v[name+'Sha256']));const copy=Buffer.from(b);check(privateHash(copy)===v[name+'Sha256']);const encoded=copy.toString('base64');check(encoded.length<=4*Math.ceil(max/3));out[name+'Base64']=encoded;}
 return Object.freeze(out);
 }catch{completeReject();}}
function collectComplete(config,subjects,operationalMs,now){
 runtime();
 const anchorBytes=readRootFile('/etc/agenthub-native/trust-v2.json','anchor');
 const descriptorBytes=readRootFile('/etc/agenthub-native/complete-v2.installation.json','descriptor');
 const statement=verifyCompleteInstallationStatement({anchorBytes,descriptorBytes,subjects,now,operationalMs}),p=statement.payload;
 const authorityBytes=readRootFile('/etc/agenthub-native/complete-authority.json','complete-authority');
 const authority=verifyCompleteAuthorityRecord({bytes:authorityBytes,config,installation:statement,now,operationalMs});
 const inputsBytes=readRootFile('/etc/agenthub-native/complete-v2.inputs.json','complete-fixture-inputs');check(privateHash(inputsBytes)===p.private_inputs_sha256);
 const inputs=parseCompleteFixtureInputs({wire:inputsBytes,config,authRef:p.auth_ref});
 const clientBytes=readRootFile('/etc/agenthub-native/auth/'+p.auth_ref,'complete-client');
 const clientAuth=parseCompleteClientAuth({wire:clientBytes,publicKeySpkiBase64:p.client_key_spki_base64,sha256:p.client_auth_sha256});
 const credentials=inputs.credentials.map(row=>{const bytes=readRootFile('/etc/agenthub-native/auth/'+row.credential_ref,'complete-token');return Object.freeze({role:row.role,token:parseCompleteCredential(bytes),sha256:privateHash(bytes)});});
 const humanBytes=readRootFile('/etc/agenthub-native/auth/'+inputs.human.human_ref,'complete-human'),human=parseCompleteHuman(humanBytes);
 const current=Date.now();check(current>=now&&current<p.expires_at&&p.expires_at>=now+operationalMs+1000);
 return Object.freeze({statement,authority,config,subjects,inputs,clientAuth,credentials:Object.freeze(credentials),human,humanSha256:privateHash(humanBytes),...encodeCompleteInstallationOriginals({anchorBytes,descriptorBytes,anchorSha256:statement.anchorSha256,descriptorSha256:statement.descriptorSha256})});
}
export function resolveFixedCompleteInstallation(input){try{
 const v=closed(input,['config','subjects','operationalMs']),config=freezeCompleteValue(validateCompleteConfig(v.config)),subjects=freezeCompleteValue(snapshotCompleteValue(v.subjects,4096));
 check(Number.isSafeInteger(v.operationalMs)&&v.operationalMs>=1&&v.operationalMs<=300000&&v.operationalMs===config.budgets.duration_ms);
 check(subjects.profile===config.profile&&subjects.fixture_sha256===config.fixture_sha256&&subjects.family_ledger_sha256===config.family_ledger_sha256&&subjects.target_origin===config.origin&&subjects.primary_workspace===config.workspaces.primary&&subjects.foreign_workspace===config.workspaces.foreign&&subjects.candidate_sha===config.candidate_sha&&subjects.candidate_tree_sha===config.candidate_tree_sha&&subjects.composition_sha256===config.composition_sha256&&subjects.cli_sha256===config.build.sha256&&subjects.config_sha256===privateHash(Buffer.from(canonicalCaseSubject(config))));
 const now=Date.now(),deadline=now+v.operationalMs;check(Number.isSafeInteger(deadline));
 const materials=collectComplete(config,subjects,v.operationalMs,now);const finished=Date.now();check(finished>=now&&finished<deadline);
 const binding=Object.freeze({version:2,profile:config.profile,scope:'protected-complete-installation-binding',authority:'pending-service-preflight',descriptorSha256:materials.statement.descriptorSha256,anchorSha256:materials.statement.anchorSha256,privateInputsSha256:materials.statement.payload.private_inputs_sha256,clientAuthSha256:materials.statement.payload.client_auth_sha256});
 completeBindings.set(binding,{materials,deadline,started:now,lastObserved:finished,failed:false});return binding;
 }catch{completeReject();}}
/** Private fixed-host seam, not authority. Each effect still needs the current
 * installation check and independently authenticated service/current grant. */
export function completeInstallationMaterials(binding){try{const saved=completeBindings.get(binding);check(saved&&!saved.failed&&Date.now()<saved.deadline);return saved.materials;}catch{completeReject();}}
export function assertCompleteInstallationCurrent(binding){
 const saved=completeBindings.get(binding);
 try{
  check(saved&&!saved.failed);const now=Date.now();check(now>=saved.lastObserved&&now<saved.deadline);
  const current=collectComplete(saved.materials.config,saved.materials.subjects,saved.deadline-now,now),prior=saved.materials;
  check(current.statement.descriptorSha256===prior.statement.descriptorSha256&&current.statement.anchorSha256===prior.statement.anchorSha256&&current.humanSha256===prior.humanSha256);
  // Existing current-authority boundary also checks the fixed installed code.
  // One bounded4MiB guarded read/hash, no new command or network operation.
  check(privateHash(readRootFile('/opt/agenthub-native/host-v2.mjs','bundle'))===prior.statement.payload.host_sha256);
  check(current.authority.authorityRecordSha256===prior.authority.authorityRecordSha256&&current.authority.configSha256===prior.authority.configSha256&&current.authority.expiresAt===prior.authority.expiresAt);
  check(current.credentials.every((row,i)=>row.role===prior.credentials[i].role&&row.sha256===prior.credentials[i].sha256));
  const finished=Date.now();check(finished>=now&&finished<saved.deadline);saved.lastObserved=finished; // No rolling lease, replacement inputs or recovery after mismatch.
 }catch{if(saved)saved.failed=true;completeReject();}
}

// Fixed source bundle packaging, separate from the legacy untagged loader.
// No installation, path override, callback provider or fabricated custody brand.
export async function loadFixedCompleteHost(configInput){try{
 const config=freezeCompleteValue(validateCompleteConfig(configInput));check(config.profile==='native-r2-required-prepared-v1');runtime();
 const anchorBytes=readRootFile('/etc/agenthub-native/trust-v2.json','anchor'),descriptorBytes=readRootFile('/etc/agenthub-native/complete-v2.installation.json','descriptor'),bundleBytes=readRootFile('/opt/agenthub-native/host-v2.mjs','bundle');
 const verified=verifyCompleteHostBundle({config,anchorBytes,descriptorBytes,bundleBytes,now:Date.now()});
 // Import executes the exact root-authenticated source bundle. It does not yet
 // invoke its factory or establish native/service authority.
 const module=await import(verified.dataUrl),execute=verifyCompleteHostExports(module,verified);
 let invoked=false;return Object.freeze({execute:async()=>{check(!invoked);invoked=true;return execute(config);}});
 }catch{completeReject();}}
/** Static-import private seam called inside the verified bundle module graph.
 * sourceInventory comes from its fixed build virtual module, not public config.
 */
export function resolveCompleteHostContext(input){try{
 const a=closed(input,['config','sourceInventory']),config=freezeCompleteValue(validateCompleteConfig(a.config));check(config.profile==='native-r2-required-prepared-v1');runtime();
 const sourceInventory=copyCompleteHostInventory(a.sourceInventory),bundleBytes=readRootFile('/opt/agenthub-native/host-v2.mjs','bundle'),hostSha256=privateHash(bundleBytes),subjects=completeHostSubjects(config,hostSha256,nativeSourceInventoryDigest(sourceInventory));
 assertCompleteConsumedBundle(import.meta.url,hostSha256);
 const binding=resolveFixedCompleteInstallation({config,subjects,operationalMs:config.budgets.duration_ms}),materials=completeInstallationMaterials(binding),evidenceContext=freezeCompleteValue({environment_id:materials.statement.payload.environment_id,config_epoch:materials.inputs.fixture_facts.config_epoch,observer_id:materials.statement.payload.service_id,source_inventory:sourceInventory});
 return Object.freeze({binding,materials,evidenceContext,hostSha256});
 }catch{completeReject();}}
