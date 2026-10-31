/** Private observed-at store snapshot. This does not establish installation
 * authority or keep a lease alive across later CLI/controller dispatch. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {join,resolve} from 'node:path';
import {ProtectedCredentialProvider} from './secret-store';
const reject=():never=>{throw Error('NATIVE_COMPLETE_STORE_READ_REJECTED');};
const check=(v:unknown):void=>{if(!v)reject();};
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
function closed(v:any,keys:string[]):any{check(v&&typeof v==='object'&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype);const ds=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(ds).length===keys.length);const out:any={};for(const k of keys){const d=ds[k];check(d?.enumerable&&Object.hasOwn(d,'value'));out[k]=d.value;}return out;}
function freeze(v:any):any{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
const integer=(v:any)=>check(Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0));
const id=(v:any)=>check(typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!/[\r\n]/.test(v));
const digest=(v:any)=>check(typeof v==='string'&&v.length===64&&/^[a-f0-9]{64}$/.test(v));
function origin(v:any){check(typeof v==='string'&&v.length<=128&&/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(v));const u=new URL(v);check(u.origin===v&&!u.username&&!u.password);}
function binding(v:any,runtime=false):any{if(v===null)return null;const r=closed(v,['origin','workspaceId','principalId','slotId','slotGeneration','provenanceId',...(runtime?['runtimeId']:[])]);origin(r.origin);for(const k of ['workspaceId','principalId','slotId','provenanceId',...(runtime?['runtimeId']:[])])id(r[k]);integer(r.slotGeneration);return r;}
export interface CompleteStoreReadWiring {assertCurrent:()=>void|Promise<void>;}
/** The fixed host owner must retain this actual promise through timeout. There
 * is no injected provider, authority bypass, clock, or synthetic cleanup result. */
export async function readCompleteStoreObservation(input:unknown,wiring:CompleteStoreReadWiring){
 let provider:ProtectedCredentialProvider|undefined,lease:Awaited<ReturnType<ProtectedCredentialProvider['acquire']>>|undefined,attempted=false,cleanupUnknown=false,result:any,error=false;
 try{
  const v=closed(input,['directory','expected','deadline']);check(typeof v.directory==='string'&&v.directory.length<=4096&&v.directory!=='/'&&resolve(v.directory)===v.directory&&!/[\x00-\x1f\x7f]/.test(v.directory));v.expected=closed(v.expected,['origin','workspace_id','principal_id','token_sha256']);origin(v.expected.origin);id(v.expected.workspace_id);id(v.expected.principal_id);digest(v.expected.token_sha256);integer(v.deadline);
  const w=closed(wiring,['assertCurrent']);check(typeof w.assertCurrent==='function'&&!types.isProxy(w.assertCurrent));let last=-1;
  const clock=()=>{const n=Date.now();integer(n);check(n>=last&&n<v.deadline);last=n;return n;};
  const current=async()=>{clock();check(await w.assertCurrent()===undefined);clock();};
  clock();await current();attempted=true;provider=new ProtectedCredentialProvider({directory:join(v.directory,'secrets'),create:false});
  const initialBinding=binding(provider.binding()),initialRuntime=binding(provider.runtimeBinding(),true);check((initialBinding===null)===(initialRuntime===null));
  if(initialBinding!==null){check(initialBinding.origin===v.expected.origin&&initialBinding.workspaceId===v.expected.workspace_id&&initialBinding.principalId===v.expected.principal_id);for(const k of Object.keys(initialBinding))check(initialBinding[k]===initialRuntime[k]);}
  lease=await provider.acquire(initialBinding);clock();await current();
  const observe=()=>{check(lease!.isCurrent());const b=binding(provider!.binding()),r=binding(provider!.runtimeBinding(),true);check(canonical(b)===canonical(initialBinding)&&canonical(r)===canonical(initialRuntime));id(lease!.slotId);integer(lease!.slotGeneration);if(b!==null)check(b.slotId===lease!.slotId&&b.slotGeneration===lease!.slotGeneration);const token_sha256=lease!.use(value=>sha(value));check(token_sha256===v.expected.token_sha256);const proof_sha256=r===null?null:provider!.dispatchRuntimeProof(r,lease!,value=>sha(value));check(lease!.isCurrent());return {slot:{slotId:lease!.slotId,slotGeneration:lease!.slotGeneration,token_sha256},binding:b,runtime_binding:r,proof_sha256};};
  const first=observe();await current();const second=observe();check(canonical(first)===canonical(second));const observed_at=clock();
  result=freeze({type:'native-complete-store-read',version:2,scope:'protected-credential-provider-read',native_conformance:false,directory_sha256:sha(v.directory),...second,observed_at,cleanup:'closed'});check(Buffer.byteLength(canonical(result))<=2304);
 }catch{error=true;}
 finally{if(attempted&&!provider)cleanupUnknown=true;if(lease)try{lease.release();}catch{cleanupUnknown=true;}if(provider)try{provider.close();}catch{cleanupUnknown=true;}}
 if(cleanupUnknown)throw Error('NATIVE_COMPLETE_STORE_READ_CLEANUP_UNKNOWN');if(error)reject();return result;
}
