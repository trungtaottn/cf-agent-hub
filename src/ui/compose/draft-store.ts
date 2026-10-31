import {prepareNativeOperation,canonicalBody,snapshot} from '../../../packages/client/src/native-request';
import {validateCreationPreparationResponse,validateTaskCreateRequest,validateMessageCreateRequest} from '../../http/generated/auth-validators.js';
import type {BrowserComposeOperation} from '../../../packages/client/src/types';
export interface DraftScope {workspaceId:string;principalId:string;}
export interface DraftBinding extends DraftScope {epoch:number;}
export interface Draft {operation:BrowserComposeOperation;bodyJson:string;revision:number;}
export interface CreationAdmission {admission_id:string;expires_at:string;}
export interface SubmitIntent {admission:CreationAdmission|null;legacy:boolean;operation:BrowserComposeOperation;bodyJson:string;key:string;draftRevision:number;status:'prepared'|'uncertain'|'confirmed'|'rejected';entityId:string|null;}
export interface DraftEntry {revision:number;draft:Draft|null;intent:SubmitIntent|null;}
export interface ScopeRecord {version:2;workspaceId:string;principalId:string;epoch:number;entries:Record<string,DraftEntry>;}
/** Synchronous mutation inside one storage transaction; return only after commit. Not an authorization interface. */
export interface ComposeDatabase {transact<T>(scope:DraftScope,change:(stored:unknown)=>{record:ScopeRecord;value:T}):Promise<T>;}
function fail(code:string):never{throw Error(code);}
const plain=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const keys=(x:Record<string,unknown>,names:string[])=>Object.keys(x).length===names.length&&Object.keys(x).every(k=>names.includes(k));
const id=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.length<=128&&!/[^A-Za-z0-9_-]/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
const integer=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0&&x<Number.MAX_SAFE_INTEGER;
const clone=<T>(x:T):T=>JSON.parse(JSON.stringify(x)) as T;
const opaque=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&new TextEncoder().encode(x).length<=65536;
function scopeValid(s:DraftScope){if(!plain(s)||!id(s.workspaceId)||!opaque(s.principalId))fail('INVALID_SCOPE');}
function operation(x:unknown):x is BrowserComposeOperation{return x==='createTask'||x==='createMessage';}
/** Editable empty text/recipient lists are allowed; submit still validates the unmodified canonical request. */
export function draftBody(op:BrowserComposeOperation,body:unknown):string{
 if(!operation(op))fail('INVALID_REQUEST');const value=snapshot(body);if(!plain(value))fail('INVALID_REQUEST');
 const checked=op==='createTask'?{...value,title:value.title===''?'Draft':value.title}:{...value,body:value.body===''?'Draft':value.body,recipient_agent_ids:Array.isArray(value.recipient_agent_ids)&&value.recipient_agent_ids.length===0?['draft_recipient']:value.recipient_agent_ids};
 if(!(op==='createTask'?validateTaskCreateRequest(checked):validateMessageCreateRequest(checked)))fail('INVALID_REQUEST');
 const text=canonicalBody(value);if(new TextEncoder().encode(text).length>65536)fail('DRAFT_TOO_LARGE');return text;
}
export function validAdmission(x:unknown):x is CreationAdmission{return validateCreationPreparationResponse({data:x,request_id:'local_validation'});}
function sameIdentity(a:SubmitIntent,b:Readonly<SubmitIntent>){return a.operation===b.operation&&a.key===b.key&&a.bodyJson===b.bodyJson&&a.draftRevision===b.draftRevision&&a.legacy===b.legacy;}
function validate(stored:unknown,scope:DraftScope):ScopeRecord{
 if(stored===undefined)return {version:2,...scope,epoch:0,entries:{}};
 if(!plain(stored)||!keys(stored,['version','workspaceId','principalId','epoch','entries'])||(stored.version!==1&&stored.version!==2)||stored.workspaceId!==scope.workspaceId||stored.principalId!==scope.principalId||!integer(stored.epoch)||!plain(stored.entries)||Object.keys(stored.entries).length>64)fail('STORAGE_CORRUPT');
 const r=clone(stored) as unknown as ScopeRecord;const legacy=stored.version===1;
 try{for(const [name,e]of Object.entries(r.entries)){
  if(!id(name)||!plain(e)||!keys(e,['revision','draft','intent'])||!integer(e.revision))fail('STORAGE_CORRUPT');
  if(e.draft!==null){const d=e.draft;if(!plain(d)||!keys(d,['operation','bodyJson','revision'])||!operation(d.operation)||typeof d.bodyJson!=='string'||!integer(d.revision)||d.revision<1||d.revision!==e.revision||d.bodyJson!==draftBody(d.operation,JSON.parse(d.bodyJson)))fail('STORAGE_CORRUPT');}
  if(e.intent!==null){const i=e.intent;if(!plain(i)||!keys(i,legacy?['operation','bodyJson','key','draftRevision','status','entityId']:['operation','bodyJson','key','draftRevision','status','entityId','admission','legacy'])||!operation(i.operation)||typeof i.bodyJson!=='string'||!id(i.key)||!integer(i.draftRevision)||i.draftRevision<1||!['prepared','uncertain','confirmed','rejected'].includes(i.status)||i.entityId!==null&&!opaque(i.entityId)||i.status==='confirmed'&&i.entityId===null||i.status!=='confirmed'&&i.entityId!==null)fail('STORAGE_CORRUPT');
   if(legacy){i.admission=null;i.legacy=true;}else if(typeof i.legacy!=='boolean'||i.admission!==null&&!validAdmission(i.admission)||i.legacy&&i.admission!==null)fail('STORAGE_CORRUPT');
   if(prepareNativeOperation('https://browser.invalid',scope.workspaceId,i.operation,{body:JSON.parse(i.bodyJson)}).canonicalBody!==i.bodyJson)fail('STORAGE_CORRUPT');
  }
 }}catch{fail('STORAGE_CORRUPT');}
 if(new TextEncoder().encode(JSON.stringify(r)).length>8388608)fail('STORAGE_CORRUPT');r.version=2;return clone(r);
}
/** Bounded local storage: 64 draft slots and 8MiB per authenticated scope, never server authority. */
export class DraftStore {
 constructor(private readonly database:ComposeDatabase){}
 async bind(scope:DraftScope):Promise<DraftBinding>{scopeValid(scope);const stable={workspaceId:scope.workspaceId,principalId:scope.principalId};return this.database.transact(stable,raw=>{const r=validate(raw,stable);return {record:r,value:{...stable,epoch:r.epoch}};});}
 async #change<T>(binding:DraftBinding,fn:(r:ScopeRecord)=>T):Promise<T>{scopeValid(binding);const stable={...binding};if(!integer(stable.epoch))fail('INVALID_SCOPE');return this.database.transact(stable,raw=>{const r=validate(raw,stable);if(r.epoch!==stable.epoch)fail('SCOPE_CHANGED');const value=fn(r);validate(r,stable);return {record:r,value:clone(value)};});}
 load(b:DraftBinding,name:string):Promise<DraftEntry|null>{if(!id(name))return Promise.reject(Error('INVALID_DRAFT'));return this.#change(b,r=>r.entries[name]??null);}
 async save(b:DraftBinding,name:string,op:BrowserComposeOperation,body:unknown):Promise<Draft>{if(!id(name))return Promise.reject(Error('INVALID_DRAFT'));const bodyJson=draftBody(op,body);return this.#change(b,r=>{const e=r.entries[name]??{revision:0,draft:null,intent:null};const revision=e.revision+1;if(!integer(revision))fail('DRAFT_LIMIT');e.revision=revision;e.draft={operation:op,bodyJson,revision};r.entries[name]=e;return e.draft;});}
 discard(b:DraftBinding,name:string):Promise<null>{if(!id(name))return Promise.reject(Error('INVALID_DRAFT'));return this.#change(b,r=>{const e=r.entries[name];if(e){e.draft=null;if(!e.intent)delete r.entries[name];}return null;});}
 admit(b:DraftBinding,name:string,key:string):Promise<SubmitIntent>{if(!id(name)||!id(key))return Promise.reject(Error('INVALID_INTENT'));return this.#change(b,r=>{const e=r.entries[name];if(e?.intent)return e.intent;if(!e?.draft)fail('DRAFT_REQUIRED');const d=e!.draft!;let bodyJson:string;try{bodyJson=prepareNativeOperation('https://browser.invalid',b.workspaceId,d.operation,{body:JSON.parse(d.bodyJson)}).canonicalBody;}catch{fail('INVALID_REQUEST');}return e!.intent={admission:null,legacy:false,operation:d.operation,bodyJson:bodyJson!,key,draftRevision:d.revision,status:'prepared',entityId:null};});}
 freezeAdmission(b:DraftBinding,name:string,expected:Readonly<SubmitIntent>,admission:CreationAdmission):Promise<SubmitIntent>{const original=clone(expected),value=clone(admission);if(!validAdmission(value))return Promise.reject(Error('INVALID_ADMISSION'));return this.#change(b,r=>{const i=r.entries[name]?.intent;if(!i||!sameIdentity(i,original)||i.legacy||i.status!=='prepared')fail('INTENT_CHANGED');if(i!.admission&&JSON.stringify(i!.admission)!==JSON.stringify(value))fail('INTENT_CHANGED');i!.admission=value;return i!;});}
 claimDispatch(b:DraftBinding,name:string,key:string,expected?:Readonly<SubmitIntent>):Promise<boolean>{const original=expected?clone(expected):null;return this.#change(b,r=>{const i=r.entries[name]?.intent;if(!i||i.key!==key||original&&(!sameIdentity(i,original)||JSON.stringify(i.admission)!==JSON.stringify(original.admission)))fail('INTENT_CHANGED');if(i!.status!=='prepared')return false;if(!i!.admission||i!.legacy)fail('ADMISSION_REQUIRED');i!.status='uncertain';return true;});}
 settle(b:DraftBinding,name:string,key:string,status:'confirmed'|'rejected'|'uncertain',entityId:string|null=null):Promise<SubmitIntent>{return this.#change(b,r=>{const i=r.entries[name]?.intent;if(!i||i.key!==key||i.status!=='uncertain')fail('INTENT_CHANGED');if(!['confirmed','rejected','uncertain'].includes(status)||status==='confirmed'&&!opaque(entityId)||status!=='confirmed'&&entityId!==null)fail('INVALID_RESULT');i!.status=status;i!.entityId=entityId;return i!;});}
 /** Positive retained-admission receipt only; exact immutable identity compare-and-set. */
 confirmReconciled(b:DraftBinding,name:string,expected:Readonly<SubmitIntent>,entityId:string):Promise<SubmitIntent>{
  if(!id(name)||!opaque(entityId))return Promise.reject(Error('INVALID_RESULT'));
  const identity=clone(expected);
  return this.#change(b,r=>{
   const current=r.entries[name]?.intent;
   if(!current||current.operation!==identity.operation||current.key!==identity.key||current.bodyJson!==identity.bodyJson||current.draftRevision!==identity.draftRevision||JSON.stringify(current.admission)!==JSON.stringify(identity.admission)||current.legacy!==identity.legacy)fail('INTENT_CHANGED');
   if(current!.status==='confirmed'){if(current!.entityId!==entityId)fail('INTENT_CHANGED');return current!;}
   if(current!.status!=='uncertain')fail('RECONCILIATION_REQUIRED');
   current!.status='confirmed';current!.entityId=entityId;return current!;
  });
 }
 abandonPrepared(b:DraftBinding,name:string,key:string):Promise<null>{return this.#change(b,r=>{const e=r.entries[name];if(!e?.intent||e.intent.key!==key)fail('INTENT_CHANGED');if(e!.intent!.status!=='prepared')fail('RECONCILIATION_REQUIRED');e!.intent=null;if(!e!.draft)delete r.entries[name];return null;});}
 acknowledge(b:DraftBinding,name:string):Promise<null>{return this.#change(b,r=>{const e=r.entries[name];if(e?.intent){if(!['confirmed','rejected'].includes(e.intent.status))fail('RECONCILIATION_REQUIRED');if(e.draft?.revision===e.intent.draftRevision)e.draft=null;e.intent=null;if(!e.draft)delete r.entries[name];}return null;});}
 clearScope(b:DraftBinding):Promise<null>{scopeValid(b);const stable={...b};if(!integer(stable.epoch))return Promise.reject(Error('INVALID_SCOPE'));return this.database.transact(stable,raw=>{if(plain(raw)&&integer(raw.epoch)&&raw.epoch!==stable.epoch)fail('SCOPE_CHANGED');const epoch=stable.epoch+1;if(!integer(epoch))fail('STORAGE_UNAVAILABLE');return {record:{version:2,workspaceId:stable.workspaceId,principalId:stable.principalId,epoch,entries:{}},value:null};});}
}
/** One scoped record per write transaction, including epoch tombstone and all admission state. */
export class IndexedComposeDatabase implements ComposeDatabase {
 #db:Promise<IDBDatabase>;
 constructor(factory:IDBFactory=globalThis.indexedDB){this.#db=new Promise((resolve,reject)=>{if(!factory){reject(Error('STORAGE_UNAVAILABLE'));return;}let failed=false;const request=factory.open('cfhub-composition-v1',1);request.onupgradeneeded=()=>{if(failed){request.transaction?.abort();return;}request.result.createObjectStore('scopes');};request.onerror=()=>{failed=true;reject(Error('STORAGE_UNAVAILABLE'));};request.onblocked=()=>{failed=true;reject(Error('STORAGE_UNAVAILABLE'));};request.onsuccess=()=>{const db=request.result;if(failed){db.close();return;}db.onversionchange=()=>db.close();resolve(db);};});}
 async transact<T>(scope:DraftScope,change:(stored:unknown)=>{record:ScopeRecord;value:T}):Promise<T>{const db=await this.#db;return new Promise((resolve,reject)=>{let value:T;let problem:unknown;let transaction:IDBTransaction;try{transaction=db.transaction('scopes','readwrite',{durability:'strict'});}catch{reject(Error('STORAGE_UNAVAILABLE'));return;}const store=transaction.objectStore('scopes'),key=[scope.workspaceId,scope.principalId],request=store.get(key);transaction.oncomplete=()=>resolve(value!);transaction.onabort=()=>reject(problem??Error('STORAGE_UNAVAILABLE'));transaction.onerror=()=>{problem??=Error('STORAGE_UNAVAILABLE');};request.onsuccess=()=>{try{const result=change(request.result);value=result.value;store.put(result.record,key);}catch(error){problem=error;transaction.abort();}};});}
 async close():Promise<void>{(await this.#db).close();}
}
