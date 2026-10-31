/** Actual local reads for the fixed complete host. These do not establish
 * installed authority; the private host owner binds inputs to its live capture. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {constants,openSync,closeSync,readSync,lstatSync,fstatSync,realpathSync,type BigIntStats} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {trustedDirectory,openSealedContent} from './artifact-files';
import {UploadStore} from './upload-store';
import {ProtectedCredentialProvider} from './secret-store';
import {observeNativeJournal} from './native-journal-observation';
import {Journal,requestFingerprint,type SemanticRequest} from './journal';
const artifactSha='eefb414947860e55eb533966c87bb64b6d38ea4514768cf10f4a16721ee876b2';
const fail=():never=>{throw Error('NATIVE_COMPLETE_HOST_READ_REJECTED');};
function check(v:unknown):asserts v{if(!v)fail();}
const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
function closed(v:unknown,keys:string[]):Record<string,any>{check(v&&typeof v==='object'&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype);const ds=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(ds).length===keys.length);return Object.fromEntries(keys.map(k=>{check(ds[k]?.enumerable&&Object.hasOwn(ds[k],'value'));return[k,ds[k].value];}));}
/** Small descriptor-only object snapshot; no arrays or arbitrary serialization hooks. */
function snapshot(v:unknown):any{let nodes=0,bytes=0;function copy(x:unknown,depth:number):any{check(++nodes<=256&&depth<=8);if(x===null||typeof x==='boolean'||typeof x==='number'&&Number.isSafeInteger(x)&&!Object.is(x,-0))return x;if(typeof x==='string'){bytes+=Buffer.byteLength(x);check(bytes<=32768);return x;}check(x&&typeof x==='object'&&!types.isProxy(x)&&Object.getPrototypeOf(x)===Object.prototype);const names=Reflect.ownKeys(x);check(names.length<=48&&names.every(k=>typeof k==='string'&&!['__proto__','constructor','prototype'].includes(k)));const row=closed(x,names as string[]),out:Record<string,any>={};for(const k of Object.keys(row)){bytes+=Buffer.byteLength(k);check(bytes<=32768);out[k]=copy(row[k],depth+1);}return out;}return copy(v,0);}
const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
function path(v:unknown):asserts v is string{check(typeof v==='string'&&v.length<=4096&&v!=='/'&&resolve(v)===v&&!/[\x00-\x1f\x7f]/.test(v));}
function artifact(v:Record<string,any>){check(v.expectedSha256===artifactSha&&v.expectedBytes===29);}
function same(a:BigIntStats,b:BigIntStats){return ['dev','ino','uid','mode','nlink','size','mtimeNs','ctimeNs'].every(k=>(a as any)[k]===(b as any)[k]);}
const observed=(kind:'upload-source'|'download-target')=>Object.freeze({scope:'protected-local-artifact-read',native_conformance:false,kind,sha256:artifactSha,byte_size:29});
export interface UploadSourceRead {stateDirectory:string;contentId:string;expectedSha256:string;expectedBytes:29;}
export interface DownloadTargetRead {fixtureDirectory:string;destination:string;expectedSha256:string;expectedBytes:29;}
export interface JournalRead {stateDirectory:string;expected:unknown;context:unknown;subject:unknown;storeBinding:unknown;}
/** Qualified destination read: same fd/path/parent checks as complete-bootstrap. */
export function observeCompleteDownloadTarget(input:DownloadTargetRead){
 const v=closed(input,['fixtureDirectory','destination','expectedSha256','expectedBytes']);path(v.fixtureDirectory);path(v.destination);artifact(v);check(dirname(v.destination)===v.fixtureDirectory);trustedDirectory(v.fixtureDirectory,false);check(realpathSync(v.destination)===v.destination);
 const parent=lstatSync(v.fixtureDirectory,{bigint:true});let fd:number|undefined,cleanup=false;
 try{fd=openSync(v.destination,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const before=fstatSync(fd,{bigint:true});check(before.isFile()&&before.nlink===1n&&before.uid===BigInt(process.getuid!())&&before.size===29n&&same(before,lstatSync(v.destination,{bigint:true})));
  const bytes=Buffer.alloc(30);let at=0;while(at<30){const n=readSync(fd,bytes,at,30-at,null);if(n===0)break;at+=n;}check(at===29&&sha(bytes.subarray(0,29))===artifactSha&&same(before,fstatSync(fd,{bigint:true}))&&same(before,lstatSync(v.destination,{bigint:true}))&&same(parent,lstatSync(v.fixtureDirectory,{bigint:true})));trustedDirectory(v.fixtureDirectory,false);return observed('download-target');
 }finally{if(fd!==undefined)try{closeSync(fd);}catch{cleanup=true;}if(cleanup)throw Error('NATIVE_COMPLETE_HOST_READ_CLEANUP_UNKNOWN');}
}
/** Consume retained bytes, not bootstrap source. openSealedContent already makes
 * an integrity pass; its second stream pass is also bounded to 29+oneover here. */
export async function observeCompleteUploadSource(input:UploadSourceRead){
 const v=closed(input,['stateDirectory','contentId','expectedSha256','expectedBytes']);path(v.stateDirectory);artifact(v);check(typeof v.contentId==='string'&&/^[a-f0-9-]{36}$/.test(v.contentId));
 let store:UploadStore|undefined,opened:ReturnType<typeof openSealedContent>|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,cleanup=false;
 try{store=new UploadStore({directory:join(v.stateDirectory,'uploads'),create:false});const content=store.content(v.contentId),original=canonical(content);check(content.id===v.contentId&&content.state==='ready'&&content.expectedSize===29&&content.sealed?.size===29&&content.sealed.sha256===artifactSha);const sealedPath=join(store.spoolDirectory,content.sealed.basename),before=lstatSync(sealedPath,{bigint:true}),parent=lstatSync(store.spoolDirectory,{bigint:true});opened=openSealedContent(store.spoolDirectory,content.sealed);reader=opened.body.getReader();const hash=createHash('sha256');let size=0;for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;check(size<=29);hash.update(next.value);}check(size===29&&hash.digest('hex')===artifactSha&&canonical(store.content(v.contentId))===original&&same(before,lstatSync(sealedPath,{bigint:true}))&&same(parent,lstatSync(store.spoolDirectory,{bigint:true})));trustedDirectory(store.spoolDirectory);return Object.freeze({...observed('upload-source'),content_id:content.id,retained_record_sha256:sha(original)});
 }finally{if(reader){try{await reader.cancel();}catch{cleanup=true;}try{reader.releaseLock();}catch{cleanup=true;}}if(opened)try{opened.close();}catch{cleanup=true;}if(store)try{store.close();}catch{cleanup=true;}if(cleanup)throw Error('NATIVE_COMPLETE_HOST_READ_CLEANUP_UNKNOWN');}
}
/** Current protected principal/lease plus actual read; no projector-only success. */
export async function observeCompleteHostJournal(input:JournalRead){
 const v=snapshot(closed(input,['stateDirectory','expected','context','subject','storeBinding']));path(v.stateDirectory);const e=closed(v.expected,['intent_id','request','principal','key','state']),p=closed(e.principal,['origin','workspaceId','principalId','slotId','slotGeneration','provenanceId']),s=v.subject,b=v.storeBinding;check(s&&b&&s.principal_id===s.agent_id&&s.principal_id===b.principal_id&&s.workspace_id===b.workspace_id&&s.runtime_id===b.runtime_id&&s.credential_id===b.credential_id&&p.principalId===s.principal_id&&p.workspaceId===s.workspace_id);
 let provider:ProtectedCredentialProvider|undefined,lease:Awaited<ReturnType<ProtectedCredentialProvider['acquire']>>|undefined,cleanup=false;
 try{provider=new ProtectedCredentialProvider({directory:join(v.stateDirectory,'secrets'),create:false});const binding=provider.binding(),runtime=provider.runtimeBinding();check(binding&&runtime&&canonical(binding)===canonical(p)&&runtime.runtimeId===s.runtime_id);lease=await provider.acquire(binding);check(lease.isCurrent());const slot=sha(canonical({slotId:lease.slotId,slotGeneration:lease.slotGeneration,token_sha256:lease.use(sha)}));check(slot===b.credential_slot_sha256&&provider.dispatchRuntimeProof(runtime,lease,sha)===b.proof_sha256);provider.assertLeaseBinding(binding,lease);const result=observeNativeJournal({stateDirectory:v.stateDirectory,expected:e,context:v.context});check(lease.isCurrent()&&canonical(provider.binding())===canonical(binding)&&canonical(provider.runtimeBinding())===canonical(runtime));provider.assertLeaseBinding(binding,lease);return result;
 }finally{if(lease)try{lease.release();}catch{cleanup=true;}if(provider)try{provider.close();}catch{cleanup=true;}if(cleanup)throw Error('NATIVE_COMPLETE_HOST_READ_CLEANUP_UNKNOWN');}
}

/** Complete-only nonnative wrong-runtime result. Does not widen native37's
 * Journal observer or infer dispatch from an error message. */
export interface UnsentJournalRead {stateDirectory:string;expected:unknown;context:unknown;storeBinding:unknown;}
export async function observeCompleteUnsentJournal(input:UnsentJournalRead){
 const v=snapshot(closed(input,['stateDirectory','expected','context','storeBinding']));path(v.stateDirectory);
 const e=closed(v.expected,['intent_id','request','principal','key']),r=closed(e.request,['operation','method','path','queryCanonical','canonicalBody','origin','workspaceId']),p=closed(e.principal,['origin','workspaceId','principalId','slotId','slotGeneration','provenanceId']);
 const c=closed(v.context,['run_id','step_id','invocation_id','config_sha256','scenario_sha256','authority_record_sha256','process_final_sha256','preparation_sha256']);
 const b=closed(v.storeBinding,['actor_slot','fixture','store_descriptor_sha256','credential_slot_sha256','credential_id','principal_id','agent_id','workspace_id','runtime_id','proof_sha256','authority_epoch']);
 const digest=(x:unknown)=>check(typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)),identifier=(x:unknown)=>check(typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x));
 check(c.step_id==='probe/wrong-runtime'&&b.actor_slot==='submitter'&&b.fixture==='runtime-probe'&&b.principal_id===b.agent_id&&p.principalId===b.principal_id&&p.workspaceId===b.workspace_id&&r.workspaceId===p.workspaceId&&r.origin===p.origin);
 for(const k of ['run_id','invocation_id'])identifier(c[k]);for(const k of Object.keys(c).filter(k=>k.endsWith('_sha256')))digest(c[k]);
 for(const k of ['store_descriptor_sha256','credential_slot_sha256','proof_sha256'])digest(b[k]);for(const k of ['credential_id','principal_id','agent_id','workspace_id','runtime_id'])identifier(b[k]);check(Number.isSafeInteger(b.authority_epoch)&&b.authority_epoch>=1);
 identifier(e.intent_id);check(e.intent_id.length<=64&&typeof e.key==='string'&&/^[\x21-\x7e]{1,256}$/.test(e.key));check(r.operation==='heartbeatRuntime'&&r.method==='POST'&&r.queryCanonical===''&&r.path.startsWith('/v2/workspaces/'+b.workspace_id+'/runtimes/')&&r.path.endsWith(':heartbeat'));const target=r.path.slice(('/v2/workspaces/'+b.workspace_id+'/runtimes/').length,-10);identifier(target);check(target!==b.runtime_id);const fingerprint=requestFingerprint(r as SemanticRequest);check(typeof p.origin==='string'&&p.origin.length<=128);for(const k of ['workspaceId','principalId','slotId','provenanceId'])check(typeof p[k]==='string'&&p[k].length>0&&Buffer.byteLength(p[k])<=256&&!/[\x00-\x1f\x7f]/.test(p[k]));check(Number.isSafeInteger(p.slotGeneration)&&p.slotGeneration>=0);
 let provider:ProtectedCredentialProvider|undefined,lease:Awaited<ReturnType<ProtectedCredentialProvider['acquire']>>|undefined,journal:Journal|undefined,cleanup=false;
 try{provider=new ProtectedCredentialProvider({directory:join(v.stateDirectory,'secrets'),create:false});const binding=provider.binding(),runtime=provider.runtimeBinding();check(binding&&runtime&&canonical(binding)===canonical(p)&&runtime.runtimeId===b.runtime_id);lease=await provider.acquire(binding);check(lease.isCurrent());const slot=sha(canonical({slotId:lease.slotId,slotGeneration:lease.slotGeneration,token_sha256:lease.use(sha)}));check(slot===b.credential_slot_sha256&&provider.dispatchRuntimeProof(runtime,lease,sha)===b.proof_sha256);provider.assertLeaseBinding(binding,lease);
  journal=new Journal({directory:join(v.stateDirectory,'journal'),create:false,authority:()=>false});const row=journal.getSync(e.intent_id);check(row&&row.id===e.intent_id&&canonical(row.request)===canonical(r)&&canonical(row.principal)===canonical(p)&&row.key===e.key&&row.replayState==='unsent'&&row.firstDispatch===null);
  check(lease.isCurrent()&&canonical(provider.binding())===canonical(binding)&&canonical(provider.runtimeBinding())===canonical(runtime));provider.assertLeaseBinding(binding,lease);
  const observed_at=Date.now();check(Number.isSafeInteger(observed_at)&&observed_at>=0);const result=Object.freeze({type:'native-complete-unsent-journal-read',version:2,scope:'protected-journal-application-read',native_conformance:false,...c,intent_id:row.id,state:'unsent',journal_entry_sha256:sha(canonical(row)),semantic_request_sha256:sha(canonical(r)),semantic_request_fingerprint_sha256:fingerprint,principal_binding:Object.freeze({...p}),principal_binding_sha256:sha(canonical(p)),retained_key_sha256:sha(e.key),first_dispatch:null,observed_at});check(Buffer.byteLength(canonical(result))<=4096);return result;
 }finally{if(journal)try{journal.close();}catch{cleanup=true;}if(lease)try{lease.release();}catch{cleanup=true;}if(provider)try{provider.close();}catch{cleanup=true;}if(cleanup)throw Error('NATIVE_COMPLETE_HOST_READ_CLEANUP_UNKNOWN');}
}
