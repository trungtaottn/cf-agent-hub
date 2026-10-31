/** Fixed local bootstrap owner. Trusted installed composition supplies authority;
 * this library never establishes installation/service authority or mints tokens. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {constants,openSync,closeSync,readSync,lstatSync,fstatSync,realpathSync,type BigIntStats} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {runCliWithCleanup} from './main';
import {ProtectedCredentialProvider} from './secret-store';
import {trustedDirectory} from './artifact-files';
const fail=():never=>{throw Error('NATIVE_COMPLETE_BOOTSTRAP_REJECTED');};
const check=(v:unknown):void=>{if(!v)fail();};
const roles=['primary-submitter','primary-reviewer','server-foreign-submitter'] as const;
const artifactSha='eefb414947860e55eb533966c87bb64b6d38ea4514768cf10f4a16721ee876b2';
const caps=[1167,1174,1083,1166,1173,1082,1174,1181,1090,801];
const offer=Object.freeze({actions:10,mutations:6,artifact_bytes:29,cli_output_bytes:510,receipt_bytes:11091});
const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
function closed(value:any,names:string[]):any {
 check(value&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype);
 const descriptors=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(descriptors).length===names.length);
 const out:any={};for(const key of names){const d=descriptors[key];check(d?.enumerable&&Object.hasOwn(d,'value'));out[key]=d.value;}return out;
}
const digest=(v:any)=>check(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v));
const id=(v:any,max=64)=>check(typeof v==='string'&&new RegExp('^[A-Za-z0-9_-]{1,'+max+'}$').test(v));
const path=(v:any)=>check(typeof v==='string'&&v.length<=4096&&v!=='/'&&resolve(v)===v&&!/[\x00-\x1f\x7f]/.test(v));
const integer=(v:any)=>check(Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0));
function freeze(v:any):any{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
export interface BootstrapWiring {
 /** Fixed installed owner reserves the complete offer before any local effect. */
 reserve:(reservation:Readonly<typeof offer>)=>void|Promise<void>;
 assertCurrent:(action:Readonly<{run_id:string;profile:string;ordinal:number;action:string;role:string}>)=>void|Promise<void>;
 resolveCredential:(role:'submitter'|'reviewer')=>string|Promise<string>;
}
export interface BootstrapResult {status:'completed'|'failed'|'cleanup-unknown';failed_ordinal:number|null;actions:readonly any[];}
/** Canonical sorted JSON tuple, derived only from an actual current provider lease. */
export function bootstrapSlotDigest(value:unknown):string {
 const v=closed(value,['slotId','slotGeneration','token_sha256']);check(typeof v.slotId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v.slotId));integer(v.slotGeneration);digest(v.token_sha256);return sha(canonical(v));
}
function snapshot(input:any){
 const v=closed(input,['run_id','profile','expires_at','stores','artifact']);id(v.run_id,128);check(['native-r2-complete-prepared-v1','native-r2-required-prepared-v1'].includes(v.profile));integer(v.expires_at);
 check(Array.isArray(v.stores)&&!types.isProxy(v.stores)&&Object.getPrototypeOf(v.stores)===Array.prototype&&v.stores.length===3&&Reflect.ownKeys(v.stores).length===4);
 v.stores=roles.map((role,i)=>{const d=Object.getOwnPropertyDescriptor(v.stores,String(i));check(d?.enumerable&&Object.hasOwn(d,'value'));const s=closed(d!.value,['role','directory','store_descriptor_sha256','credential_role','credential_sha256','expected_credential_id','expected_principal_id','expected_agent_id','expected_workspace_id']);check(s.role===role&&s.credential_role===(i===1?'reviewer':'submitter'));path(s.directory);digest(s.store_descriptor_sha256);digest(s.credential_sha256);for(const k of ['expected_credential_id','expected_principal_id','expected_agent_id','expected_workspace_id'])id(s[k]);check(s.expected_principal_id===s.expected_agent_id);return s;});
 const [s,r,e]=v.stores;for(const key of ['credential_role','credential_sha256','expected_credential_id','expected_principal_id','expected_agent_id','expected_workspace_id'])check(s[key]===e[key]);check(r.expected_principal_id!==s.expected_principal_id&&r.expected_credential_id!==s.expected_credential_id&&r.credential_sha256!==s.credential_sha256&&r.expected_workspace_id===s.expected_workspace_id);
 v.artifact=closed(v.artifact,['path','descriptor_sha256','byte_size','sha256']);path(v.artifact.path);digest(v.artifact.descriptor_sha256);check(v.artifact.byte_size===29&&v.artifact.sha256===artifactSha);
 const paths=v.stores.map((x:any)=>x.directory);for(let i=0;i<3;i++){check(!v.artifact.path.startsWith(paths[i]+'/')&&v.artifact.path!==paths[i]);for(let j=i+1;j<3;j++)check(paths[i]!==paths[j]&&!paths[i].startsWith(paths[j]+'/')&&!paths[j].startsWith(paths[i]+'/'));}
 return freeze(v);
}
function same(a:BigIntStats,b:BigIntStats):boolean{return ['dev','ino','uid','mode','nlink','size','mtimeNs','ctimeNs'].every(k=>(a as any)[k]===(b as any)[k]);}
function readArtifact(file:any){
 trustedDirectory(dirname(file.path),false);check(realpathSync(file.path)===file.path);
 const parent=lstatSync(dirname(file.path),{bigint:true});let fd:number|undefined,cleanup=false,result:any;
 try{fd=openSync(file.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const before=fstatSync(fd,{bigint:true});check(before.isFile()&&before.nlink===1n&&before.uid===BigInt(process.getuid!())&&before.size===29n&&same(before,lstatSync(file.path,{bigint:true})));
  const bytes=Buffer.alloc(30);let at=0;while(at<30){const n=readSync(fd,bytes,at,30-at,null);if(n===0)break;at+=n;}check(at===29&&sha(bytes.subarray(0,29))===file.sha256&&same(before,fstatSync(fd,{bigint:true}))&&same(before,lstatSync(file.path,{bigint:true}))&&same(parent,lstatSync(dirname(file.path),{bigint:true})));trustedDirectory(dirname(file.path),false);result={kind:'artifact-source-check',sha256:file.sha256,byte_size:29};
 }finally{if(fd!==undefined)try{closeSync(fd);}catch{cleanup=true;}if(cleanup)throw Error('NATIVE_COMPLETE_BOOTSTRAP_CLEANUP_UNKNOWN');}
 return result;
}
async function bindingCheck(store:any,refresh:()=>Promise<void>){
 let provider:ProtectedCredentialProvider|undefined,lease:Awaited<ReturnType<ProtectedCredentialProvider['acquire']>>|undefined,result:any,cleanup=false;
 try{provider=new ProtectedCredentialProvider({directory:join(store.directory,'secrets'),create:false});check(provider.binding()===null&&provider.runtimeBinding()===null);lease=await provider.acquire(null);await refresh();check(lease.isCurrent());const token_sha256=lease.use(value=>sha(value));check(token_sha256===store.credential_sha256&&lease.isCurrent()&&provider.binding()===null&&provider.runtimeBinding()===null);result={kind:'unbound-store-check',slot_sha256:bootstrapSlotDigest({slotId:lease.slotId,slotGeneration:lease.slotGeneration,token_sha256}),binding:null,runtime_binding:null};
 }finally{/* A failed constructor can hide its own partial cleanup. */if(!provider)cleanup=true;if(lease)try{lease.release();}catch{cleanup=true;}if(provider)try{provider.close();}catch{cleanup=true;}if(cleanup)throw Error('NATIVE_COMPLETE_BOOTSTRAP_CLEANUP_UNKNOWN');}
 return result;
}
/** One-shot owner retains the real promise. Caller timeouts never cancel it or
 * permit retry; lifecycle code must keep ownership until run() actually settles. */
export function createCompleteBootstrap(input:unknown,trustedWiring:BootstrapWiring){
 const value=snapshot(input),w=closed(trustedWiring,['reserve','assertCurrent','resolveCredential']);for(const fn of Object.values(w))check(typeof fn==='function'&&!types.isProxy(fn));
 let started=false,pending=false;const actions:any[]=[];
 const live=()=>check(Date.now()<value.expires_at);
 const attempt=async(ordinal:number,action:string,role:string)=>{live();check(await w.assertCurrent(freeze({run_id:value.run_id,profile:value.profile,ordinal,action,role}))===undefined);live();};
 const run=async():Promise<BootstrapResult>=>{
  check(!started);started=true;pending=true;let current:number|null=null;
  try{
   live();check(await w.reserve(offer)===undefined);live();
   for(let ordinal=1;ordinal<=10;ordinal++){
    current=ordinal;const store=ordinal<=9?value.stores[Math.floor((ordinal-1)/3)]:null,action=ordinal===10?'artifact-read':['state-init','credential-import','binding-check'][(ordinal-1)%3],role=store?store.role:'artifact-source';
    await attempt(ordinal,action,role);const started_at=Date.now();let result:any,status:'completed'|'failed'|'cleanup-unknown'='completed';
    if(action==='state-init'||action==='credential-import'){
     const env:Record<string,string|undefined>={};
     try{if(action==='credential-import'){const token=await w.resolveCredential(store.credential_role);live();check(typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)&&Buffer.from(token,'base64url').byteLength===32&&Buffer.from(token,'base64url').toString('base64url')===token&&sha(token)===store.credential_sha256);env.CF_AGENT_HUB_TOKEN=token;await attempt(ordinal,action,role);}
      const observed=await runCliWithCleanup([...(action==='state-init'?['state','init']:['credential','import']),'--state-dir',store.directory],{env,fetch:async()=>{throw Error('NATIVE_BOOTSTRAP_NETWORK_DENIED');},stdinIsTTY:false,stderrIsTTY:false});
      const output=observed.output;check(Buffer.byteLength(output.stdout)+Buffer.byteLength(output.stderr)<=85);result={kind:'cli-return',exit_code:output.exitCode,stdout_sha256:sha(output.stdout),stdout_bytes:Buffer.byteLength(output.stdout),stderr_sha256:sha(output.stderr),stderr_bytes:Buffer.byteLength(output.stderr)};status=observed.cleanup==='cleanup-unknown'?'cleanup-unknown':output.exitCode===0?'completed':'cleanup-unknown';
     }finally{delete env.CF_AGENT_HUB_TOKEN;}
    }else if(action==='binding-check')result=await bindingCheck(store,()=>attempt(ordinal,action,role));else result=readArtifact(value.artifact);
    const ended_at=Date.now();check(ended_at>=started_at);
    const subject=store?{store_descriptor_sha256:store.store_descriptor_sha256,credential_role:store.credential_role,expected_credential_id:store.expected_credential_id,expected_principal_id:store.expected_principal_id,expected_agent_id:store.expected_agent_id,expected_workspace_id:store.expected_workspace_id,artifact_source_descriptor_sha256:null}:{store_descriptor_sha256:null,credential_role:null,expected_credential_id:null,expected_principal_id:null,expected_agent_id:null,expected_workspace_id:null,artifact_source_descriptor_sha256:value.artifact.descriptor_sha256};
    const receipt=freeze({type:'native-complete-bootstrap-action',version:2,profile:value.profile,run_id:value.run_id,ordinal,action,role,started_at,ended_at,status,subject,result});check(Buffer.byteLength(canonical(receipt))<=caps[ordinal-1]);actions.push(receipt);
    if(status!=='completed')return freeze({status,failed_ordinal:ordinal,actions:[...actions]});await attempt(ordinal,action,role);
   }
   return freeze({status:'completed',failed_ordinal:null,actions:[...actions]});
  }catch(error){return freeze({status:error instanceof Error&&error.message==='NATIVE_COMPLETE_BOOTSTRAP_CLEANUP_UNKNOWN'?'cleanup-unknown':'failed',failed_ordinal:current,actions:[...actions]});}
  finally{pending=false;}
 };
 return Object.freeze({run,snapshot:()=>Object.freeze({started,pending,completed_actions:actions.length})});
}
