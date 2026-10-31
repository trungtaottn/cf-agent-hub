import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {CredentialDispatchLease,CredentialProvider,RuntimeCapture,RuntimeCaptureFinalizer,VerifiedPrincipalBinding,SemanticRequest} from '../../client/src/types';
import {assertPendingCapture,registerProtectedProvider,type ProtectedAssociation} from '../../client/src/native-provenance';
import {ProtectedSqlite} from './protected-sqlite';
import {prepareNativeOperation,canonicalBody} from '../../client/src/native-request';

export interface RuntimeProofBinding extends VerifiedPrincipalBinding {readonly runtimeId:string;}
/** Invoked only within the verified lease boundary. Its result is never returned as proof data. */
export type BoundProofDispatch=(proof:string)=>unknown;
export interface EnrollmentAttempt {readonly id:string;readonly request:Readonly<SemanticRequest>;readonly principalId:null;readonly slotId:string;readonly slotGeneration:number;readonly key:string|null;readonly consumed:boolean;}
const enrollmentKeys=['operation','method','path','queryCanonical','canonicalBody','origin','workspaceId'];
function enrollmentSemantic(value:SemanticRequest):string{
 try{
  if(!value||typeof value!=='object'||Object.keys(value).length!==enrollmentKeys.length||Object.keys(value).some(key=>!enrollmentKeys.includes(key))||value.operation!=='createRuntime')fail();
  const prepared=prepareNativeOperation(value.origin,value.workspaceId,'createRuntime',{body:JSON.parse(value.canonicalBody)});
  const {request:_,...semantic}=prepared;if(canonicalBody(semantic)!==canonicalBody(value))fail();return canonicalBody(semantic);
 }catch{fail();}
}
function validKey(value:unknown):value is string {try{if(typeof value!=='string'||!value||value.trim()!==value||Buffer.byteLength(value)>1024||/[\r\n]/.test(value))return false;new Headers({'idempotency-key':value});return true;}catch{return false;}}
interface AttemptRow {id:string;request_json:string;slot_id:string;generation:number;token_digest:string;key:string|null;consumed:number;provenance_id:string|null;}

function fail():never{throw Error('SECRET_STORE_REJECTED');}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const token=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
/** Syntax-only CLI preflight, never credential binding or provenance authority. */
export const isImportCredentialFormat=token;
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=2048;
const bindingKeys=['origin','workspaceId','principalId','slotId','slotGeneration','provenanceId'] as const;
const sameBinding=(a:Readonly<VerifiedPrincipalBinding>,b:Readonly<VerifiedPrincipalBinding>)=>bindingKeys.every(key=>a[key]===b[key]);
function validBinding(value:unknown):value is VerifiedPrincipalBinding{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as Record<string,unknown>;
 return Object.keys(v).every(key=>(bindingKeys as readonly string[]).includes(key))&&bindingKeys.every(key=>key==='slotGeneration'?Number.isSafeInteger(v[key])&&Number(v[key])>=0:text(v[key]));
}
function principal(binding:RuntimeProofBinding):VerifiedPrincipalBinding{const {runtimeId:_,...value}=binding;if(!validBinding(value))fail();return value;}
const APP_ID=1128679507;
const schema=[
 'CREATE TABLE secret_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), store_id TEXT NOT NULL) STRICT',
 'CREATE TABLE credential_slot (singleton INTEGER PRIMARY KEY CHECK(singleton=1), slot_id TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation>=0), token TEXT NOT NULL, token_digest TEXT NOT NULL, active_provenance TEXT) STRICT',
 "CREATE TABLE runtime_proofs (provenance_id TEXT PRIMARY KEY, slot_id TEXT NOT NULL, generation INTEGER NOT NULL, token_digest TEXT NOT NULL, origin TEXT NOT NULL, workspace_id TEXT NOT NULL, principal_id TEXT NOT NULL, runtime_id TEXT NOT NULL, proof TEXT NOT NULL, proof_digest TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('staged','active'))) STRICT",
 'CREATE TABLE enrollment_attempts (id TEXT PRIMARY KEY, request_json TEXT NOT NULL, slot_id TEXT NOT NULL, generation INTEGER NOT NULL, token_digest TEXT NOT NULL, key TEXT UNIQUE, consumed INTEGER NOT NULL CHECK(consumed IN (0,1)), provenance_id TEXT) STRICT'
];
interface Slot {slot_id:string;generation:number;token:string;token_digest:string;active_provenance:string|null;}
interface Proof {provenance_id:string;slot_id:string;generation:number;token_digest:string;origin:string;workspace_id:string;principal_id:string;runtime_id:string;proof:string;proof_digest:string;status:'staged'|'active';}
interface LeaseState {slot:Slot;released:boolean;}
/** Concrete Linux protected provider. Internal registry is a trusted-code bridge, not a same-process sandbox. */
export class ProtectedCredentialProvider implements CredentialProvider {
 readonly #storage:ProtectedSqlite;readonly #leases=new WeakMap<object,LeaseState>();readonly #dispatchAttempts=new WeakMap<CredentialDispatchLease,string>();
 #closed=false;#pinned:{database:DatabaseSync;lease:CredentialDispatchLease}|null=null;
 constructor(options:{directory:string;create?:boolean}){
  let storage:ProtectedSqlite|undefined;
  try{
   if(!options||Object.keys(options).some(key=>key!=='directory'&&key!=='create'))fail();
   storage=new ProtectedSqlite({...options,name:'secrets.sqlite'});this.#storage=storage;
   if(options.create)storage.transaction(db=>{for(const sql of schema)db.exec(sql);db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=1`);db.prepare('INSERT INTO secret_meta VALUES (1,?)').run(randomUUID());});
   storage.read(db=>{this.#schema(db);this.#slot(db,false);this.#validateProofRows(db);});
   registerProtectedProvider(this,lease=>{try{return this.#read(db=>this.#association(db,lease));}catch{return null;}});
  }catch{try{storage?.close();}catch{}fail();}
 }
 #schema(db:DatabaseSync):void{
  if(db.prepare('PRAGMA application_id').get()?.application_id!==APP_ID||db.prepare('PRAGMA user_version').get()?.user_version!==1)fail();
  if(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type NOT IN ('table','index') OR (type='index' AND sql IS NOT NULL)").get()?.count!==0)fail();
  const actual=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.sql);
  if(JSON.stringify(actual)!==JSON.stringify([...schema].sort((a,b)=>a.split(' ')[2].localeCompare(b.split(' ')[2]))))fail();
  const meta=db.prepare('SELECT * FROM secret_meta').all();if(meta.length!==1||meta[0].singleton!==1||typeof meta[0].store_id!=='string'||!/^[-0-9a-f]{36}$/.test(meta[0].store_id))fail();
 }
 #slot(db:DatabaseSync,required=true):Slot|null{
  const rows=db.prepare('SELECT * FROM credential_slot').all();if(rows.length>1)fail();if(!rows.length){if(required)fail();return null;}
  const s=rows[0] as unknown as Slot&{singleton:number};
  if(s.singleton!==1||!text(s.slot_id)||!Number.isSafeInteger(s.generation)||s.generation<0||!token(s.token)||s.token_digest!==digest(s.token)||s.active_provenance!==null&&!text(s.active_provenance))fail();return s;
 }
 #proof(db:DatabaseSync,id:string):Proof|null{
  const raw=db.prepare('SELECT * FROM runtime_proofs WHERE provenance_id=?').get(id);if(!raw)return null;const p=raw as unknown as Proof;
  if(![p.provenance_id,p.slot_id,p.token_digest,p.origin,p.workspace_id,p.principal_id,p.runtime_id].every(text)||!Number.isSafeInteger(p.generation)||p.generation<0||!token(p.proof)||p.proof_digest!==digest(p.proof)||!['staged','active'].includes(p.status))fail();
  return p;
 }
 #validateProofRows(db:DatabaseSync):void{
  const rows=db.prepare('SELECT provenance_id,status FROM runtime_proofs').all();if(rows.length>2||rows.filter(row=>row.status==='staged').length>1||rows.filter(row=>row.status==='active').length>1)fail();
  const slot=this.#slot(db,false);for(const row of rows){if(typeof row.provenance_id!=='string')fail();const p=this.#proof(db,row.provenance_id)!;if(!slot||p.slot_id!==slot.slot_id||p.generation!==slot.generation||p.token_digest!==slot.token_digest||p.status==='active'&&p.provenance_id!==slot.active_provenance)fail();}
  if(slot?.active_provenance&&!rows.some(row=>row.provenance_id===slot.active_provenance&&row.status==='active'))fail();
 }
 #read<T>(callback:(db:DatabaseSync)=>T):T{
  try{if(this.#closed)fail();if(this.#pinned)return callback(this.#pinned.database);return this.#storage.read(db=>{this.#schema(db);this.#validateProofRows(db);return callback(db);});}catch{fail();}
 }
 #write<T>(callback:(db:DatabaseSync)=>T):T{
  try{if(this.#closed||this.#pinned)fail();return this.#storage.transaction(db=>{this.#schema(db);this.#validateProofRows(db);const value=callback(db);this.#validateProofRows(db);return value;});}catch{fail();}
 }
 #state(db:DatabaseSync,lease:CredentialDispatchLease):LeaseState{
  const state=this.#leases.get(lease);if(!state||state.released||this.#closed)fail();const current=this.#slot(db)!;
  if(current.slot_id!==state.slot.slot_id||current.generation!==state.slot.generation||current.token_digest!==state.slot.token_digest||current.token!==state.slot.token||current.active_provenance!==state.slot.active_provenance)fail();return state;
 }
 #binding(proof:Proof):Readonly<VerifiedPrincipalBinding>{return Object.freeze({origin:proof.origin,workspaceId:proof.workspace_id,principalId:proof.principal_id,slotId:proof.slot_id,slotGeneration:proof.generation,provenanceId:proof.provenance_id});}
 #association(db:DatabaseSync,lease:CredentialDispatchLease):ProtectedAssociation|null{
  this.#state(db,lease);const slot=this.#slot(db)!;if(!slot.active_provenance)return null;const p=this.#proof(db,slot.active_provenance);if(!p||p.status!=='active')fail();return {binding:this.#binding(p),runtimeId:p.runtime_id};
 }
 #pin<T>(lease:CredentialDispatchLease,callback:(db:DatabaseSync)=>T):T{
  if(this.#pinned){if(this.#pinned.lease!==lease)fail();this.#state(this.#pinned.database,lease);return callback(this.#pinned.database);}
  let result!:T;this.#write(db=>{this.#state(db,lease);this.#pinned={database:db,lease};try{result=callback(db);}finally{this.#pinned=null;}});return result;
 }
 #attempt(db:DatabaseSync,id:string):AttemptRow{
  if(!text(id))fail();const row=db.prepare('SELECT * FROM enrollment_attempts WHERE id=?').get(id) as unknown as AttemptRow|undefined;if(!row||!text(row.id)||!text(row.slot_id)||!Number.isSafeInteger(row.generation)||row.generation<0||typeof row.token_digest!=='string'||!/^[a-f0-9]{64}$/.test(row.token_digest)||row.key!==null&&!validKey(row.key)||![0,1].includes(row.consumed)||row.provenance_id!==null&&!text(row.provenance_id))fail();
  if(enrollmentSemantic(JSON.parse(row.request_json))!==row.request_json)fail();return row;
 }
 #publicAttempt(row:AttemptRow):EnrollmentAttempt{return Object.freeze({id:row.id,request:Object.freeze(JSON.parse(row.request_json) as SemanticRequest),principalId:null,slotId:row.slot_id,slotGeneration:row.generation,key:row.key,consumed:row.consumed===1});}
 recordEnrollmentIntent(request:SemanticRequest,lease:CredentialDispatchLease,suppliedKey?:string):EnrollmentAttempt{
  const serialized=enrollmentSemantic(request);if(suppliedKey!==undefined&&!validKey(suppliedKey))fail();this.assertNoSecrets(serialized);if(suppliedKey!==undefined)this.assertNoSecrets(suppliedKey);
  return this.#write(db=>{const state=this.#state(db,lease);const size=db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(request_json AS BLOB))+COALESCE(length(CAST(key AS BLOB)),0)+2048),0) AS bytes FROM enrollment_attempts').get()!;if(Number(size.count)>=1000||Number(size.bytes)+Buffer.byteLength(serialized)+2048>64*1024*1024)fail();const id=randomUUID();db.prepare('INSERT INTO enrollment_attempts VALUES (?,?,?,?,?,?,0,NULL)').run(id,serialized,state.slot.slot_id,state.slot.generation,state.slot.token_digest,suppliedKey??null);return this.#publicAttempt(this.#attempt(db,id));});
 }
 getEnrollmentAttempt(id:string):EnrollmentAttempt{return this.#read(db=>this.#publicAttempt(this.#attempt(db,id)));}
 attachEnrollmentKey(id:string,key:string):EnrollmentAttempt{
  if(!validKey(key))fail();this.assertNoSecrets(key);return this.#write(db=>{const attempt=this.#attempt(db,id);if(attempt.consumed||attempt.key!==null&&attempt.key!==key)fail();if(attempt.key===null)db.prepare('UPDATE enrollment_attempts SET key=? WHERE id=? AND key IS NULL').run(key,id);return this.#publicAttempt(this.#attempt(db,id));});
 }
 /** Consumption commits before the network lease-use transaction. Crashes burn the attempt; never redispatch. */
 authorizeEnrollmentDispatch(id:string,request:SemanticRequest,lease:CredentialDispatchLease):()=>void{
  const serialized=enrollmentSemantic(request);this.#write(db=>{const state=this.#state(db,lease),attempt=this.#attempt(db,id);if(attempt.request_json!==serialized||attempt.slot_id!==state.slot.slot_id||attempt.generation!==state.slot.generation||attempt.token_digest!==state.slot.token_digest||attempt.key===null||attempt.consumed)fail();db.prepare('UPDATE enrollment_attempts SET consumed=1 WHERE id=? AND consumed=0').run(id);});
  let used=false;return ()=>{if(used||this.#pinned?.lease!==lease)fail();used=true;this.#read(db=>{this.#state(db,lease);const attempt=this.#attempt(db,id);if(attempt.consumed!==1||attempt.request_json!==serialized)fail();});this.#dispatchAttempts.set(lease,id);};
 }
 importCredential(value:string):void{
  if(!token(value))fail();this.#write(db=>{if(this.#slot(db,false))fail();db.prepare('INSERT INTO credential_slot VALUES (1,?,0,?,?,NULL)').run(randomUUID(),value,digest(value));});
 }
 rotateCredential(value:string):void{
  if(!token(value))fail();this.#write(db=>{const old=this.#slot(db)!;if(old.token===value||old.generation===Number.MAX_SAFE_INTEGER)fail();db.prepare('DELETE FROM runtime_proofs').run();db.prepare('UPDATE credential_slot SET generation=?,token=?,token_digest=?,active_provenance=NULL WHERE singleton=1').run(old.generation+1,value,digest(value));});
 }
 binding():Readonly<VerifiedPrincipalBinding>|null{return this.#read(db=>{const slot=this.#slot(db,false);if(!slot?.active_provenance)return null;return this.#binding(this.#proof(db,slot.active_provenance)!);});}
 runtimeBinding():Readonly<RuntimeProofBinding>|null{return this.#read(db=>{const slot=this.#slot(db,false);if(!slot?.active_provenance)return null;const p=this.#proof(db,slot.active_provenance)!;return Object.freeze({...this.#binding(p),runtimeId:p.runtime_id});});}
 async acquire(expected:Readonly<VerifiedPrincipalBinding>|null,signal?:AbortSignal):Promise<CredentialDispatchLease>{
  if(signal?.aborted||expected!==null&&!validBinding(expected))fail();
  const slot=this.#read(db=>({...this.#slot(db)!}));const state:LeaseState={slot,released:false};
  const lease:CredentialDispatchLease=Object.freeze({slotId:slot.slot_id,slotGeneration:slot.generation,provenance:null,
   isCurrent:()=>{try{return this.#read(db=>{this.#state(db,lease);return true;});}catch{return false;}},
   use:<T>(dispatch:(credential:string)=>T):T=>{if(typeof dispatch!=='function')fail();return this.#pin(lease,()=>dispatch(slot.token));},
   release:()=>{state.released=true;}
  });this.#leases.set(lease,state);
  try{if(expected)this.assertLeaseBinding(expected,lease);if(signal?.aborted)fail();return lease;}catch{lease.release();fail();}
 }
 assertLeaseBinding(binding:Readonly<VerifiedPrincipalBinding>,lease:CredentialDispatchLease):void{
  if(!validBinding(binding))fail();this.#read(db=>{const association=this.#association(db,lease);if(!association||!sameBinding(binding,association.binding))fail();});
 }
 #stage(binding:RuntimeProofBinding,lease:CredentialDispatchLease,value:string):void{
  const verified=principal(binding);if(!token(value)||!text(binding.runtimeId))fail();
  try{assertPendingCapture(this,verified,lease,value,binding.runtimeId);}catch{fail();}
  this.#write(db=>{
   const state=this.#state(db,lease);if(binding.slotId!==state.slot.slot_id||binding.slotGeneration!==state.slot.generation)fail();
   db.prepare("DELETE FROM runtime_proofs WHERE status='staged'").run();
   db.prepare("INSERT INTO runtime_proofs VALUES (?,?,?,?,?,?,?,?,?,?,'staged')").run(binding.provenanceId,binding.slotId,binding.slotGeneration,state.slot.token_digest,binding.origin,binding.workspaceId,binding.principalId,binding.runtimeId,value,digest(value));
  });
 }
 async putRuntimeProof(binding:RuntimeProofBinding,lease:CredentialDispatchLease,value:string):Promise<void>{this.#stage(binding,lease,value);}
 captureRuntime(capture:RuntimeCapture):RuntimeCaptureFinalizer{
  const binding={...capture.provenance.binding,runtimeId:capture.runtime.id},lease=capture.lease;
  this.#stage(binding,lease,capture.runtimeProof);let finished=false;
  return Object.freeze({commit:()=>{
   if(finished||capture.signal.aborted)fail();
   try{assertPendingCapture(this,principal(binding),lease,capture.runtimeProof,binding.runtimeId);}catch{fail();}
   this.#write(db=>{this.#state(db,lease);const p=this.#proof(db,binding.provenanceId);if(!p||p.status!=='staged'||!sameBinding(this.#binding(p),binding)||p.runtime_id!==binding.runtimeId||p.proof!==capture.runtimeProof)fail();
    db.prepare('DELETE FROM runtime_proofs WHERE provenance_id<>?').run(binding.provenanceId);db.prepare("UPDATE runtime_proofs SET status='active' WHERE provenance_id=?").run(binding.provenanceId);db.prepare('UPDATE credential_slot SET active_provenance=? WHERE singleton=1').run(binding.provenanceId);
    const attemptId=this.#dispatchAttempts.get(lease);if(attemptId)db.prepare('UPDATE enrollment_attempts SET provenance_id=? WHERE id=? AND consumed=1').run(binding.provenanceId,attemptId);
   });this.#leases.get(lease)!.slot.active_provenance=binding.provenanceId;finished=true;
  },abort:()=>{
   this.#write(db=>{const p=this.#proof(db,binding.provenanceId);if(!p)return;db.prepare('DELETE FROM runtime_proofs WHERE provenance_id=?').run(binding.provenanceId);db.prepare('UPDATE credential_slot SET active_provenance=NULL WHERE active_provenance=?').run(binding.provenanceId);});finished=true;
  }});
 }
 /** Synchronous secret-use seam for the native client's actual already-pinned lease. */
 dispatchRuntimeProof<T>(binding:RuntimeProofBinding,lease:CredentialDispatchLease,dispatch:(proof:string)=>T):T{
  const verified=principal(binding);if(typeof dispatch!=='function')fail();
  return this.#pin(lease,db=>{const association=this.#association(db,lease);if(!association||!sameBinding(verified,association.binding)||binding.runtimeId!==association.runtimeId)fail();const p=this.#proof(db,binding.provenanceId)!;return dispatch(p.proof);});
 }
 async withRuntimeProof(binding:RuntimeProofBinding,lease:CredentialDispatchLease,dispatch:BoundProofDispatch):Promise<void>{
  try{await this.dispatchRuntimeProof(binding,lease,dispatch);}catch{fail();}
 }
 assertNoSecrets(serialized:string):void{
  if(typeof serialized!=='string')fail();this.#read(db=>{const slot=this.#slot(db,false);if(slot&&serialized.includes(slot.token))fail();for(const row of db.prepare('SELECT proof FROM runtime_proofs').all())if(typeof row.proof!=='string'||serialized.includes(row.proof))fail();});
 }
 close():void{if(!this.#closed){if(this.#pinned)fail();this.#closed=true;this.#storage.close();}}
}
