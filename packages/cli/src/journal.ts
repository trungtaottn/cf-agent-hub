import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {VerifiedPrincipalBinding} from '../../client/src/types';
import {ProtectedSqlite} from './protected-sqlite';
import type {DispatchStamp,ReplayClockEvidence} from './replay-clock';
export type {DispatchStamp,ReplayClockEvidence} from './replay-clock';

/** Already validated against the single native operation map; never headers/proofs. */
export interface SemanticRequest {operation:string;method:string;path:string;queryCanonical:string;canonicalBody:string;origin:string;workspaceId:string;}
export interface JournalEntry {id:string;request:SemanticRequest;principal:VerifiedPrincipalBinding;key:string|null;firstDispatch:DispatchStamp|null;replayState:'unsent'|'within-window'|'reconciliation-required'|'settled';}
export interface RedactedOutcome {status:number|null;code:string|null;requestId:null;}
export interface JournalOptions {directory:string;create?:boolean;authority:(binding:Readonly<VerifiedPrincipalBinding>)=>boolean;}
interface StoredEntry extends JournalEntry {createdAt:number;settledAt:number|null;outcome:RedactedOutcome|null;}
interface Row {id:string;payload:string;checksum:string;reserved_bytes:number;}
const MAX_ENTRIES=1000,MAX_BYTES=64*1024*1024,ENTRY_BYTES=128*1024,METADATA_RESERVE=4096,SETTLED_RETENTION_MS=7*86400000;
const applicationId=0x4346484a;
const schema="CREATE TABLE journal_entries (id TEXT PRIMARY KEY, payload TEXT NOT NULL, checksum TEXT NOT NULL, reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes BETWEEN 4096 AND 131072)) STRICT";
function deny():never{throw Error('JOURNAL_REJECTED');}
const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function shape(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown>{if(!object(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))deny();}
const bounded=(value:unknown,max:number,min=1):value is string=>typeof value==='string'&&Buffer.byteLength(value,'utf8')>=min&&Buffer.byteLength(value,'utf8')<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function canonical(value:unknown,depth=0):string{
 if(depth>32)deny();
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
 if(object(value)){
  const keys=Object.keys(value).sort();
  if(keys.some(k=>/^(?:authorization|cookie|set-cookie|runtime[_-]?proof|runtime[_-]?token|access[_-]?token|refresh[_-]?token|bearer|credential)$/i.test(k)))deny();
  return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
 }
 return deny();
}
function requestValue(value:unknown):SemanticRequest{
 shape(value,['operation','method','path','queryCanonical','canonicalBody','origin','workspaceId']);
 if(!bounded(value.operation,128)||!/^[A-Za-z][A-Za-z0-9]*$/.test(value.operation)||!['POST','PUT','PATCH','DELETE'].includes(String(value.method))||!bounded(value.path,8192)||!value.path.startsWith('/')||value.path.startsWith('//')||/[?#]/.test(value.path)||!bounded(value.queryCanonical,8192,0)||!bounded(value.canonicalBody,ENTRY_BYTES-METADATA_RESERVE,0)||!bounded(value.origin,2048)||!bounded(value.workspaceId,256))deny();
 const url=new URL(value.origin);if(url.protocol!=='https:'||url.origin!==value.origin||url.username||url.password)deny();
 const query=new URLSearchParams(value.queryCanonical);query.sort();if(query.toString()!==value.queryCanonical)deny();
 if(value.canonicalBody!==''&&canonical(JSON.parse(value.canonicalBody))!==value.canonicalBody)deny();
 return {operation:value.operation,method:String(value.method),path:value.path,queryCanonical:value.queryCanonical,canonicalBody:value.canonicalBody,origin:value.origin,workspaceId:value.workspaceId};
}
function principalValue(value:unknown):VerifiedPrincipalBinding{
 shape(value,['origin','workspaceId','principalId','slotId','slotGeneration','provenanceId']);
 if(!bounded(value.origin,2048)||!bounded(value.workspaceId,256)||!bounded(value.principalId,256)||!bounded(value.slotId,256)||!integer(value.slotGeneration)||!bounded(value.provenanceId,256))deny();
 return {origin:value.origin,workspaceId:value.workspaceId,principalId:value.principalId,slotId:value.slotId,slotGeneration:value.slotGeneration,provenanceId:value.provenanceId};
}
function keyValue(value:unknown):string{if(!bounded(value,256)||!/^[\x21-\x7e]+$/.test(value))deny();return value;}
export function requestFingerprint(request:SemanticRequest):string{
 try{const r=requestValue(request);return digest(JSON.stringify([r.operation,r.method,r.path,r.queryCanonical,r.canonicalBody,r.origin,r.workspaceId]));}catch{return deny();}
}
function stampValue(value:unknown,fingerprint:string):DispatchStamp{
 shape(value,['firstDispatchWallMs','firstDispatchMonotonicMs','clockEpochId','guaranteedRetentionMs','requestFingerprint']);
 if(!integer(value.firstDispatchWallMs)||!integer(value.firstDispatchMonotonicMs)||!bounded(value.clockEpochId,256)||value.guaranteedRetentionMs!==86400000||value.requestFingerprint!==fingerprint)deny();
 return {firstDispatchWallMs:value.firstDispatchWallMs,firstDispatchMonotonicMs:value.firstDispatchMonotonicMs,clockEpochId:value.clockEpochId,guaranteedRetentionMs:86400000,requestFingerprint:fingerprint};
}
function clockAllows(stamp:DispatchStamp,clock:unknown):boolean{
 try{shape(clock,['clockEpochId','nowMonotonicMs','continuityVerified','suspendAwareElapsedVerified']);
  return clock.continuityVerified===true&&clock.suspendAwareElapsedVerified===true&&clock.clockEpochId===stamp.clockEpochId&&integer(clock.nowMonotonicMs)&&clock.nowMonotonicMs>=stamp.firstDispatchMonotonicMs&&clock.nowMonotonicMs-stamp.firstDispatchMonotonicMs<stamp.guaranteedRetentionMs;
 }catch{return false;}
}
const outcomeCodes=new Set(['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','INVALID_STATE','STALE_RUN','APPROVAL_EXPIRED','CURSOR_EXPIRED','LIMIT_EXCEEDED','RATE_LIMITED','DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR','REQUEST_TIMEOUT','REQUEST_ABORTED','CREDENTIAL_CHANGED','CREDENTIAL_UNBOUND','CREDENTIAL_UNAVAILABLE','INVALID_RESPONSE','CAPTURE_FAILED','ENROLLMENT_PROOF_UNAVAILABLE','STREAM_INVALID','NETWORK_ERROR']);
function outcomeValue(value:unknown):RedactedOutcome{
 shape(value,['status','code','requestId']);
 if(value.status!==null&&(!integer(value.status)||value.status<100||value.status>599)||value.code!==null&&(typeof value.code!=='string'||!outcomeCodes.has(value.code))||value.requestId!==null)deny();
 return {status:value.status as number|null,code:value.code as string|null,requestId:null};
}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function publicEntry(e:StoredEntry):JournalEntry{return structuredClone({id:e.id,request:e.request,principal:e.principal,key:e.key,firstDispatch:e.firstDispatch,replayState:e.replayState});}
function rowValue(raw:unknown):{entry:StoredEntry;row:Row}{
 shape(raw,['id','payload','checksum','reserved_bytes']);
 if(!bounded(raw.id,64)||!bounded(raw.payload,ENTRY_BYTES)||typeof raw.checksum!=='string'||digest(raw.payload)!==raw.checksum||!integer(raw.reserved_bytes)||raw.reserved_bytes<METADATA_RESERVE||raw.reserved_bytes>ENTRY_BYTES||Buffer.byteLength(raw.payload)>raw.reserved_bytes)deny();
 const e:unknown=JSON.parse(raw.payload);shape(e,['id','request','principal','key','firstDispatch','replayState','createdAt','settledAt','outcome']);
 const request=requestValue(e.request),principal=principalValue(e.principal);
 if(e.id!==raw.id||request.origin!==principal.origin||request.workspaceId!==principal.workspaceId||!integer(e.createdAt)||!['unsent','within-window','reconciliation-required','settled'].includes(String(e.replayState)))deny();
 const key=e.key===null?null:keyValue(e.key),firstDispatch=e.firstDispatch===null?null:stampValue(e.firstDispatch,requestFingerprint(request));
 const outcome=e.outcome===null?null:outcomeValue(e.outcome);
 if(e.replayState==='within-window'&&(!key||!firstDispatch)||e.replayState==='unsent'&&firstDispatch!==null||firstDispatch!==null&&key===null||e.replayState==='settled'&&(!integer(e.settledAt)||outcome===null)||e.replayState!=='settled'&&e.settledAt!==null||e.replayState==='settled'&&(!outcome||outcome.code!==null||outcome.status===null||outcome.status<200||outcome.status>=300))deny();
 return {entry:{id:raw.id,request,principal,key,firstDispatch,replayState:e.replayState as JournalEntry['replayState'],createdAt:e.createdAt,settledAt:e.settledAt as number|null,outcome},row:raw as unknown as Row};
}
function load(db:DatabaseSync,id:string):{entry:StoredEntry;row:Row}|null{if(!bounded(id,64))deny();const raw=db.prepare('SELECT id,payload,checksum,reserved_bytes FROM journal_entries WHERE id=?').get(id);return raw?rowValue(raw):null;}
function required(db:DatabaseSync,id:string){return load(db,id)??deny();}
function persist(db:DatabaseSync,entry:StoredEntry,row:Row):void{
 const payload=JSON.stringify(entry);if(Buffer.byteLength(payload)>row.reserved_bytes||Buffer.byteLength(payload)>ENTRY_BYTES)deny();
 db.prepare('UPDATE journal_entries SET payload=?,checksum=? WHERE id=?').run(payload,digest(payload),entry.id);
}

/** The authority callback is a trusted current pinned-lease gate, not serialized
 * principal metadata. This store performs no fetch and has no implicit retries. */
export class Journal {
 readonly #store:ProtectedSqlite;readonly #authority:JournalOptions['authority'];
 constructor(options:JournalOptions){
  if(typeof options?.authority!=='function')deny();this.#authority=options.authority;
  this.#store=new ProtectedSqlite({directory:options.directory,name:'journal.sqlite',create:options.create});
  try{
   if(options.create)this.#store.transaction(db=>{db.exec(schema);db.exec(`PRAGMA application_id=${applicationId}; PRAGMA user_version=1;`);});
   this.#store.read(db=>{
    if(db.prepare('PRAGMA application_id').get()?.application_id!==applicationId||db.prepare('PRAGMA user_version').get()?.user_version!==1)deny();
    const definitions=db.prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all();
    if(definitions.length!==1||definitions[0].name!=='journal_entries'||definitions[0].sql!==schema)deny();
    const rows=db.prepare('SELECT id,payload,checksum,reserved_bytes FROM journal_entries').all();let total=0;
    if(rows.length>MAX_ENTRIES)deny();for(const row of rows)total+=rowValue(row).row.reserved_bytes;if(total>MAX_BYTES)deny();
   });
  }catch{this.#store.close();throw Error('JOURNAL_REJECTED');}
 }
 #authorized(binding:VerifiedPrincipalBinding):boolean{try{return this.#authority(Object.freeze({...binding}))===true;}catch{return false;}}
 async recordIntent(input:{request:SemanticRequest;principal:VerifiedPrincipalBinding;suppliedKey?:string}):Promise<JournalEntry>{
  try{
   if(!object(input)||Object.keys(input).some(k=>!['request','principal','suppliedKey'].includes(k)))deny();
   const request=requestValue(input.request),principal=principalValue(input.principal),key=input.suppliedKey===undefined?null:keyValue(input.suppliedKey);
   if(request.origin!==principal.origin||request.workspaceId!==principal.workspaceId)deny();
   const entry:StoredEntry={id:randomUUID(),request,principal,key,firstDispatch:null,replayState:'unsent',createdAt:Date.now(),settledAt:null,outcome:null};
   if(!integer(entry.createdAt))deny();const payload=JSON.stringify(entry),reserved=Buffer.byteLength(payload)+METADATA_RESERVE;if(reserved>ENTRY_BYTES)deny();
   return this.#store.transaction(db=>{
    if(!this.#authorized(principal))deny();const stats=db.prepare('SELECT count(*) AS n,coalesce(sum(reserved_bytes),0) AS bytes FROM journal_entries').get()!;
    if(typeof stats.n!=='number'||stats.n>=MAX_ENTRIES||typeof stats.bytes!=='number'||stats.bytes+reserved>MAX_BYTES)deny();
    db.prepare('INSERT INTO journal_entries(id,payload,checksum,reserved_bytes) VALUES (?,?,?,?)').run(entry.id,payload,digest(payload),reserved);return publicEntry(entry);
   });
  }catch{throw Error('JOURNAL_REJECTED');}
 }
 async attachKey(id:string,key:string):Promise<JournalEntry>{
  return this.#store.transaction(db=>{const valid=keyValue(key),{entry,row}=required(db,id);if(!this.#authorized(entry.principal)||entry.key!==null&&entry.key!==valid||entry.replayState!=='unsent')deny();if(entry.key===null){entry.key=valid;persist(db,entry,row);}return publicEntry(entry);});
 }
 async markFirstDispatch(id:string,stamp:DispatchStamp):Promise<JournalEntry>{
  return this.#store.transaction(db=>{const {entry,row}=required(db,id),valid=stampValue(stamp,requestFingerprint(entry.request));if(!this.#authorized(entry.principal)||entry.key===null||entry.replayState==='reconciliation-required'||entry.replayState==='settled')deny();if(entry.firstDispatch===null){entry.firstDispatch=valid;entry.replayState='within-window';persist(db,entry,row);}return publicEntry(entry);});
 }
 async authorizeReplay(id:string,current:VerifiedPrincipalBinding,request:SemanticRequest,clock:ReplayClockEvidence):Promise<'send-once'|'no-send-reconcile'>{return this.authorizeReplaySync(id,current,request,clock);}
 /** Preparatory durable check only: supplied evidence can age during lock waits. */
 authorizeReplaySync(id:string,current:VerifiedPrincipalBinding,request:SemanticRequest,clock:ReplayClockEvidence):'send-once'|'no-send-reconcile'{
  return this.#authorize(id,current,request,clock)?'send-once':'no-send-reconcile';
 }
 #authorize(id:string,current:VerifiedPrincipalBinding,request:SemanticRequest,clock:unknown):Readonly<DispatchStamp>|null{
  return this.#store.transaction(db=>{
   const {entry,row}=required(db,id);if(entry.replayState==='settled')return null;
   let allowed=false;
   try{
    const principal=principalValue(current),semantic=requestValue(request),stamp=entry.firstDispatch;
    allowed=entry.replayState==='within-window'&&entry.key!==null&&stamp!==null&&equal(principal,entry.principal)&&equal(semantic,entry.request)&&this.#authorized(principal)&&clockAllows(stamp,clock);
   }catch{allowed=false;}
   if(allowed)return Object.freeze({...entry.firstDispatch!});
   entry.replayState='reconciliation-required';persist(db,entry,row);return null;
  });
 }
 /** Final pinned-lease dispatch barrier. The fresh final sample occurs AFTER all
  * SQLite lock/commit/validation work. The allow path performs no subsequent I/O.
  * Call this immediately before fetch; earlier replay decisions are preparatory. */
 authorizeDispatchSync(id:string,current:VerifiedPrincipalBinding,request:SemanticRequest,clock:()=>ReplayClockEvidence):'send-once'|'no-send-reconcile'{
  const sample=():ReplayClockEvidence|null=>{try{return clock();}catch{return null;}};
  const stamp=this.#authorize(id,current,request,sample());if(stamp===null)return 'no-send-reconcile';
  if(clockAllows(stamp,sample()))return 'send-once';
  this.#store.transaction(db=>{const {entry,row}=required(db,id);if(entry.replayState!=='settled'){entry.replayState='reconciliation-required';persist(db,entry,row);}});
  return 'no-send-reconcile';
 }
 async recordOutcome(id:string,redactedOutcome:unknown):Promise<void>{
  this.#store.transaction(db=>{const outcome=outcomeValue(redactedOutcome),{entry,row}=required(db,id);if(entry.replayState==='settled'){if(!equal(entry.outcome,outcome))deny();return;}entry.outcome=outcome;
   // Only an explicit canonical successful result settles. Transport failures and
   // conflicts cannot establish whether the original effect already happened.
   if(outcome.code===null&&outcome.status!==null&&outcome.status>=200&&outcome.status<300){entry.settledAt=Date.now();if(!integer(entry.settledAt))deny();entry.replayState='settled';}
   persist(db,entry,row);});
 }
 /** Internal exact intent read; consumers must never print this sensitive payload. */
 async get(id:string):Promise<JournalEntry|null>{return this.#store.read(db=>{const found=load(db,id);return found?publicEntry(found.entry):null;});}
 /** Explicit local cleanup only; unresolved intent is never evicted. No automatic GC. */
 async pruneSettled():Promise<number>{
  return this.#store.transaction(db=>{const now=Date.now();if(!integer(now))deny();let count=0;for(const raw of db.prepare('SELECT id,payload,checksum,reserved_bytes FROM journal_entries').all()){const {entry}=rowValue(raw);if(entry.replayState==='settled'&&entry.settledAt!==null&&now-entry.settledAt>=SETTLED_RETENTION_MS){db.prepare('DELETE FROM journal_entries WHERE id=?').run(entry.id);count++;}}return count;});
 }
 close():void{this.#store.close();}
}
