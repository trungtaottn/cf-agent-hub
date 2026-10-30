/** Fixed private file syntax only. No file access, credentials creation, installed
 * authority or logging. The guarded resolver separately verifies signed digests. */
import {createHash,createPrivateKey,createPublicKey} from 'node:crypto';
import {types} from 'node:util';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {validateCompleteConfig} from './native-complete-config.mjs';
import {snapshotCompleteValue as snapshot,completeKeys as keys,completeCheck as check,completeDigest as digest,freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
export const COMPLETE_PRIVATE_LIMITS=Object.freeze({inputs:2280,client:220,human:123,credential:43});
const hash=b=>createHash('sha256').update(b).digest('hex');
const reject=()=>{throw Error('NATIVE_COMPLETE_PRIVATE_INPUT_REJECTED');};
const id=v=>check(typeof v==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(v));
const proto=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(proto,'byteLength').get,backing=Object.getOwnPropertyDescriptor(proto,'buffer').get;
function owned(value,cap){check(value&&!types.isProxy(value)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(value)));const n=length.call(value);check(n>0&&n<=cap&&Object.getPrototypeOf(backing.call(value))===ArrayBuffer.prototype);check(Reflect.ownKeys(value).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)));return Buffer.from(value);}
function args(value,names){check(value&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype);const d=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(d).length===names.length);return Object.fromEntries(names.map(k=>{check(d[k]?.enumerable&&Object.hasOwn(d[k],'value'));return[k,d[k].value];}));}
function parsed(wire,cap){const bytes=owned(wire,cap),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(bytes),value=JSON.parse(text);check(canonical(value)===text);return {bytes,value:snapshot(value,cap)};}
function token(value){check(typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value));const b=Buffer.from(value,'base64url');check(b.length===32&&b.toString('base64url')===value);return value;}
export function parseCompleteCredential(wire){try{const bytes=owned(wire,43);check(bytes.length===43);return token(new TextDecoder('utf8',{fatal:true}).decode(bytes));}catch{reject();}}
export function parseCompleteHuman(wire){try{const {value}=parsed(wire,123);keys(value,'session_cookie csrf_token');token(value.session_cookie);token(value.csrf_token);return freeze(value);}catch{reject();}}
export function parseCompletePrivateInputs(input){try{
 const a=args(input,['wire','config','authRef']);id(a.authRef);const config=validateCompleteConfig(a.config),{value:v}=parsed(a.wire,2280);
 keys(v,'type version profile credentials stores human');check(v.type==='native-complete-inputs'&&v.version===2&&v.profile===config.profile);
 check(Array.isArray(v.credentials)&&v.credentials.length===3&&Array.isArray(v.stores)&&v.stores.length===3);
 const refs=new Set([a.authRef]),credentials=new Set(),actors=new Set();
 for(const [i,role] of ['S','R','X'].entries()){
  const c=v.credentials[i];keys(c,'role credential_ref credential_id principal_id agent_id workspace_id');check(c.role===role);
  for(const k of ['credential_ref','credential_id','principal_id','agent_id','workspace_id'])id(c[k]);
  check(c.principal_id===c.agent_id&&!refs.has(c.credential_ref)&&!credentials.has(c.credential_id)&&!actors.has(c.agent_id));refs.add(c.credential_ref);credentials.add(c.credential_id);actors.add(c.agent_id);
  check(c.workspace_id===(i===2?config.workspaces.foreign:config.workspaces.primary));if(i<2)check(c.agent_id===config.actors[i].agent_id&&c.principal_id===config.actors[i].principal_id);
 }
 const expected=[['primary-S','submitter','primary','S'],['primary-R','reviewer','primary','R'],['server-foreign-S','submitter','server-foreign-workspace','S']];
 for(let i=0;i<3;i++){const s=v.stores[i];keys(s,'role actor_slot fixture credential_role store_descriptor_sha256');check([s.role,s.actor_slot,s.fixture,s.credential_role].every((x,j)=>x===expected[i][j]));digest(s.store_descriptor_sha256);}
 keys(v.human,'human_ref principal_id session_id workspace_id');for(const k of Object.keys(v.human))id(v.human[k]);check(!refs.has(v.human.human_ref)&&v.human.workspace_id===config.workspaces.primary);return freeze(v);
 }catch{reject();}}
function canonicalBase64(value,size){check(typeof value==='string'&&value.length===4*Math.ceil(size/3));const b=Buffer.from(value,'base64');check(b.length===size&&b.toString('base64')===value);return b;}
export function parseCompleteClientAuth(input){try{
 const a=args(input,['wire','publicKeySpkiBase64','sha256']);digest(a.sha256);const {bytes,value:v}=parsed(a.wire,220);check(hash(bytes)===a.sha256);keys(v,'type version key_id private_key_pkcs8_base64');check(v.type==='native-complete-client-auth'&&v.version===2);digest(v.key_id);
 const der=canonicalBase64(v.private_key_pkcs8_base64,48),privateKey=createPrivateKey({key:der,format:'der',type:'pkcs8'});check(privateKey.asymmetricKeyType==='ed25519'&&privateKey.export({type:'pkcs8',format:'der'}).equals(der));
 const spki=createPublicKey(privateKey).export({type:'spki',format:'der'}),pinned=canonicalBase64(a.publicKeySpkiBase64,44);check(spki.equals(pinned)&&hash(spki)===v.key_id);
 return Object.freeze({key_id:v.key_id,privateKey});
 }catch{reject();}}
