import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync,opendirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import type {Artifact} from '../../../src/http/dto';
import type {SemanticRequest,VerifiedPrincipalBinding} from '../../client/src/types';
import type {DispatchStamp} from './replay-clock';
import {ProtectedSqlite} from './protected-sqlite';
import {captureFile,sourceSize,trustedDirectory,syncArtifactDirectory,unlinkSealedContent,type SealedContent} from './artifact-files';
import {canonicalBody,prepareNativeOperation} from '../../client/src/native-request';
import {validateArtifact} from '../../../src/http/generated/auth-validators.js';
import {requestFingerprint} from './journal';
import type {DurableMutations} from './durable-mutations';
import type {ProtectedCredentialProvider} from './secret-store';
export interface ContentRecord {id:string;state:'reserving'|'ready'|'deleting';reservedBytes:number;expectedSize:number;basename:string;createdAt:number;eligibleAt:number;sealed:SealedContent|null;}
export interface ContentHold {id:string;contentId:string;operation:'stageArtifact'|'commitArtifact';binding:VerifiedPrincipalBinding;journalId:string|null;createdAt:number;association:ArtifactReceipt|null;settledAt:number|null;}
export interface UploadIntent {id:string;contentId:string;binding:VerifiedPrincipalBinding;runtimeId:string;artifact:Artifact;request:SemanticRequest;fingerprint:string;key:string|null;firstDispatch:DispatchStamp|null;state:'prepared'|'pending'|'settled'|'reconciliation-required';createdAt:number;outcome:{status:number|null;ok:boolean}|null;receipt:ArtifactReceipt|null;settledAt:number|null;}
export interface ArtifactReceipt {artifactId:string;workspaceId:string;version:number;status:Artifact['status'];manifest:Pick<Artifact,'task_id'|'run_id'|'owner'|'filename'|'media_type'|'byte_size'|'sha256'>;}
export function artifactReceipt(artifact:Artifact):ArtifactReceipt{if(!validateArtifact(artifact))fail();const {task_id,run_id,owner,filename,media_type,byte_size,sha256}=artifact;return {artifactId:artifact.id,workspaceId:artifact.workspace_id,version:artifact.artifact_version,status:artifact.status,manifest:{task_id,run_id,owner,filename,media_type,byte_size,sha256}};}
export function validArtifactTransition(before:ArtifactReceipt,after:ArtifactReceipt,status:'uploaded'|'committed'):boolean{return equal(before.manifest,after.manifest)&&before.artifactId===after.artifactId&&before.workspaceId===after.workspaceId&&Number.isSafeInteger(before.version+1)&&after.version===before.version+1&&after.status===status;}
function validReceipt(r:unknown):boolean{if(!closed(r,['artifactId','workspaceId','version','status','manifest']))return false;const a=r as ArtifactReceipt;return validateArtifact({id:a.artifactId,workspace_id:a.workspaceId,artifact_version:a.version,status:a.status,...a.manifest,created_at:'2026-01-01T00:00:00Z',committed_at:a.status==='committed'?'2026-01-01T00:00:00Z':null,expires_at:null});}
function fail():never{throw Error('UPLOAD_STORE_REJECTED');}
const app=0x4155504c,version=1,week=7*86400000;
const schema="CREATE TABLE retained (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('content','hold','upload')), content_id TEXT, reserved_bytes INTEGER NOT NULL, metadata_bytes INTEGER NOT NULL, payload TEXT NOT NULL, checksum TEXT NOT NULL) STRICT";
const checksum=(s:string)=>createHash('sha256').update(s).digest('hex');
const closed=(v:unknown,keys:string[])=>typeof v==='object'&&v!==null&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===keys.sort().join('|');
const validBinding=(b:unknown):b is VerifiedPrincipalBinding=>closed(b,['origin','workspaceId','principalId','slotId','slotGeneration','provenanceId'])&&Object.entries(b as object).every(([k,v])=>k==='slotGeneration'?Number.isSafeInteger(v)&&Number(v)>=0:typeof v==='string'&&v.length>0&&v.length<2048);
const equal=(a:unknown,b:unknown)=>canonicalBody(a)===canonicalBody(b);
function validate(kind:string,v:unknown):void{
 if(kind==='content'){
  if(!closed(v,['id','state','reservedBytes','expectedSize','basename','createdAt','eligibleAt','sealed']))fail();const c=v as ContentRecord;
  if(!['reserving','ready','deleting'].includes(c.state)||!Number.isSafeInteger(c.reservedBytes)||c.reservedBytes<0||c.reservedBytes>10485760||c.expectedSize!==c.reservedBytes||!/^[a-f0-9]{32}\.blob$/.test(c.basename)||!Number.isSafeInteger(c.createdAt)||!Number.isSafeInteger(c.eligibleAt)||c.eligibleAt<c.createdAt+week)fail();
  if(c.state==='reserving'){if(c.sealed!==null)fail();}else{const s=c.sealed;if(!closed(s,['basename','size','sha256','dev','ino','uid','mode','nlink'])||!s||s.basename!==c.basename||s.size!==c.expectedSize||!/^[a-f0-9]{64}$/.test(s.sha256)||!['dev','ino','uid','mode','nlink'].every(k=>typeof s[k as keyof SealedContent]==='string'&&/^\d+$/.test(s[k as keyof SealedContent] as string)))fail();}
 }else if(kind==='hold'){
  if(!closed(v,['id','contentId','operation','binding','journalId','createdAt','association','settledAt']))fail();const h=v as ContentHold;if(!['stageArtifact','commitArtifact'].includes(h.operation)||!validBinding(h.binding)||h.journalId!==null&&(typeof h.journalId!=='string'||h.journalId.length<1||h.journalId.length>128)||h.association!==null&&!validReceipt(h.association)||h.settledAt!==null&&(!Number.isSafeInteger(h.settledAt)||h.settledAt<0||h.association===null||h.journalId===null))fail();if(h.association!==null&&(h.operation==='stageArtifact'?(h.association.status!=='staged'||h.association.version!==1):h.association.status!=='uploaded'))fail();
 }else if(kind==='upload'){
  if(!closed(v,['id','contentId','binding','runtimeId','artifact','request','fingerprint','key','firstDispatch','state','createdAt','outcome','receipt','settledAt']))fail();const u=v as UploadIntent;
  if(!validBinding(u.binding)||typeof u.runtimeId!=='string'||!u.runtimeId||u.key!==null&&(typeof u.key!=='string'||!u.key||u.key.length>1024||/[\r\n]/.test(u.key))||!/^[a-f0-9]{64}$/.test(u.fingerprint)||!['prepared','pending','settled','reconciliation-required'].includes(u.state)||u.receipt!==null&&!validReceipt(u.receipt)||u.settledAt!==null&&(!Number.isSafeInteger(u.settledAt)||u.settledAt<0||u.receipt===null||u.state!=='settled'))fail();
  if(!validateArtifact(u.artifact)||u.artifact.workspace_id!==u.binding.workspaceId||!['staged','uploaded'].includes(u.artifact.status)||!closed(u.request,['operation','method','path','queryCanonical','canonicalBody','origin','workspaceId']))fail();
  const {request:_input,...semantic}=prepareNativeOperation(u.binding.origin,u.binding.workspaceId,'uploadArtifactContent',{path:{artifact_id:u.artifact.id}});if(!equal(semantic,u.request)||requestFingerprint(semantic)!==u.fingerprint)fail();
  if(u.firstDispatch!==null){if(u.key===null)fail();const stamp=u.firstDispatch;if(!closed(stamp,['firstDispatchWallMs','firstDispatchMonotonicMs','clockEpochId','guaranteedRetentionMs','requestFingerprint'])||!Number.isSafeInteger(stamp.firstDispatchWallMs)||!Number.isSafeInteger(stamp.firstDispatchMonotonicMs)||stamp.firstDispatchMonotonicMs<0||typeof stamp.clockEpochId!=='string'||!stamp.clockEpochId||stamp.guaranteedRetentionMs!==86400000||stamp.requestFingerprint!==u.fingerprint)fail();}else if(u.state!=='prepared'||u.outcome!==null||u.receipt!==null)fail();
  if(u.outcome!==null&&(!closed(u.outcome,['status','ok'])||typeof u.outcome.ok!=='boolean'||u.outcome.status!==null&&(!Number.isSafeInteger(u.outcome.status)||u.outcome.status<100||u.outcome.status>599)))fail();
  if(u.outcome?.ok===true&&(u.outcome.status!==200||u.state!=='settled')||u.receipt!==null&&u.state!=='settled')fail();
  if(u.receipt!==null&&!validArtifactTransition(artifactReceipt(u.artifact),u.receipt,'uploaded')||u.state==='settled'&&(u.receipt===null||u.outcome?.ok!==true||u.outcome.status!==200))fail();
 }else fail();
 const r=v as {id:string;createdAt:number;contentId?:string};if(!/^[a-f0-9-]{36}$/.test(r.id)||(!Number.isSafeInteger(r.createdAt)||r.createdAt<0)||kind!=='content'&&!/^[a-f0-9-]{36}$/.test(r.contentId??''))fail();
}
/** Bounded, checksummed closed local records. No credentials, response bodies or server-private IDs. */
export class UploadStore {
 readonly #db:ProtectedSqlite;readonly spoolDirectory:string;
 constructor(options:{directory:string;create?:boolean}){
  this.#db=new ProtectedSqlite({directory:options.directory,name:'uploads.sqlite',create:options.create});this.spoolDirectory=join(options.directory,'content');
  if(options.create){this.#db.transaction(db=>{db.exec(`PRAGMA application_id=${app}; PRAGMA user_version=${version}; ${schema}`);});mkdirSync(this.spoolDirectory,{mode:0o700});syncArtifactDirectory(options.directory);}
  try{this.#db.read(db=>this.#rows(db));trustedDirectory(this.spoolDirectory);}catch(error){this.#db.close();throw error;}
 }
 #rows(db:DatabaseSync):Array<{kind:string;value:ContentRecord|ContentHold|UploadIntent}>{
  if(db.prepare('PRAGMA application_id').get()?.application_id!==app||db.prepare('PRAGMA user_version').get()?.user_version!==version)fail();
  const schemas=db.prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();if(schemas.length!==1||schemas[0].name!=='retained'||schemas[0].sql!==schema)fail();
  const result:Array<{kind:string;value:ContentRecord|ContentHold|UploadIntent}>=[];let bytes=0,reserved=0,contents=0,references=0;
  for(const row of db.prepare('SELECT * FROM retained LIMIT 193').iterate()){
   if(typeof row.payload!=='string'||Buffer.byteLength(row.payload)>16384||row.metadata_bytes!==16384||row.checksum!==checksum(row.payload)||typeof row.kind!=='string')fail();
   const value=JSON.parse(row.payload);validate(row.kind,value);if(row.id!==value.id||row.content_id!==(row.kind==='content'?null:value.contentId)||row.reserved_bytes!==(row.kind==='content'?value.reservedBytes:0))fail();
   bytes+=Number(row.metadata_bytes);reserved+=Number(row.reserved_bytes);row.kind==='content'?contents++:references++;if(contents>64||references>128||reserved>64*1024*1024||bytes>4*1024*1024)fail();result.push({kind:row.kind,value});
  }
  for(const r of result)if(r.kind!=='content'&&!result.some(c=>c.kind==='content'&&c.value.id===(r.value as ContentHold).contentId))fail();return result;
 }
 #save(db:DatabaseSync,kind:string,value:ContentRecord|ContentHold|UploadIntent,insert=false):void{
  validate(kind,value);const payload=canonicalBody(value);if(Buffer.byteLength(payload)>16384)fail();const params=[kind,kind==='content'?null:(value as ContentHold).contentId,kind==='content'?(value as ContentRecord).reservedBytes:0,16384,payload,checksum(payload),value.id];
  db.prepare(insert?'INSERT INTO retained(kind,content_id,reserved_bytes,metadata_bytes,payload,checksum,id) VALUES(?,?,?,?,?,?,?)':'UPDATE retained SET kind=?,content_id=?,reserved_bytes=?,metadata_bytes=?,payload=?,checksum=? WHERE id=?').run(...params);this.#rows(db);
 }
 #directory(rows:Array<{kind:string;value:ContentRecord|ContentHold|UploadIntent}>):void{
  trustedDirectory(this.spoolDirectory);const names:string[]=[];const directory=opendirSync(this.spoolDirectory);try{for(;;){const entry=directory.readSync();if(!entry)break;names.push(entry.name);if(names.length>64)fail();}}finally{directory.closeSync();}for(const name of names){if(!rows.some(r=>r.kind==='content'&&(r.value as ContentRecord).basename===name))fail();const s=lstatSync(join(this.spoolDirectory,name));if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid!()||(s.mode&0o777)!==0o600)fail();}
  for(const r of rows)if(r.kind==='content'&&(r.value as ContentRecord).state==='ready'&&!names.includes((r.value as ContentRecord).basename))fail();
 }
 content(id:string):ContentRecord{const row=this.#db.read(db=>this.#rows(db).find(r=>r.kind==='content'&&r.value.id===id));if(!row)fail();return row.value as ContentRecord;}
 retain(file:string):ContentRecord{
  const size=sourceSize(file),now=Date.now();const value:ContentRecord={id:randomUUID(),state:'reserving',reservedBytes:size,expectedSize:size,basename:randomBytes(16).toString('hex')+'.blob',createdAt:now,eligibleAt:now+week,sealed:null};
  this.#db.transaction(db=>{const rows=this.#rows(db);this.#directory(rows);this.#save(db,'content',value,true);});
  const sealed=captureFile(file,this.spoolDirectory,value.basename,size);
  this.#db.transaction(db=>{const row=this.#rows(db).find(r=>r.value.id===value.id);if(!row||!equal(row.value,value))fail();value.state='ready';value.sealed=sealed;this.#save(db,'content',value);});return value;
 }
 inspectContent(id:string){const c=this.content(id);const references=this.#db.read(db=>this.#rows(db).filter(r=>r.kind!=='content'&&(r.value as ContentHold).contentId===id).length);return {id:c.id,state:c.state,byteSize:c.expectedSize,sha256:c.sealed?.sha256??null,references};}
 createHold(contentId:string,operation:ContentHold['operation'],binding:VerifiedPrincipalBinding,artifact?:Artifact):ContentHold{
  const hold:ContentHold={id:randomUUID(),contentId,operation,binding:JSON.parse(JSON.stringify(binding)),journalId:null,createdAt:Date.now(),association:artifact?artifactReceipt(artifact):null,settledAt:null};this.#db.transaction(db=>{const rows=this.#rows(db);this.#directory(rows);const c=rows.find(r=>r.kind==='content'&&r.value.id===contentId)?.value as ContentRecord|undefined;if(c?.state!=='ready'||operation==='commitArtifact'&&(!hold.association||hold.association.manifest.byte_size!==c.sealed?.size||hold.association.manifest.sha256!==c.sealed?.sha256))fail();this.#save(db,'hold',hold,true);});return hold;
 }
 bindHold(id:string,journalId:string):void{if(!journalId||journalId.length>128)fail();this.#db.transaction(db=>{const h=this.#rows(db).find(r=>r.kind==='hold'&&r.value.id===id)?.value as ContentHold|undefined;if(!h||h.journalId!==null)fail();h.journalId=journalId;this.#save(db,'hold',h);});}
 createUpload(intent:UploadIntent):void{this.#db.transaction(db=>{const rows=this.#rows(db);this.#directory(rows);const c=rows.find(r=>r.kind==='content'&&r.value.id===intent.contentId)?.value as ContentRecord|undefined;if(c?.state!=='ready'||!c.sealed||c.sealed.size!==intent.artifact.byte_size||c.sealed.sha256!==intent.artifact.sha256)fail();this.#save(db,'upload',intent,true);});}
 upload(id:string):UploadIntent{const r=this.#db.read(db=>this.#rows(db).find(r=>r.kind==='upload'&&r.value.id===id));if(!r)fail();return r.value as UploadIntent;}
 updateUpload(id:string,update:(current:UploadIntent)=>void):UploadIntent{return this.#db.transaction(db=>{const r=this.#rows(db).find(r=>r.kind==='upload'&&r.value.id===id);if(!r)fail();const value=r.value as UploadIntent;update(value);this.#save(db,'upload',value);return value;});}
 inspectUpload(id:string){const u=this.upload(id);return {id:u.id,key:u.key,operation:'uploadArtifactContent' as const,origin:u.binding.origin,workspaceId:u.binding.workspaceId,replayState:u.state};}
 association(artifact:Artifact,binding:VerifiedPrincipalBinding):string|null{const target=artifactReceipt(artifact);const matches=this.#db.read(db=>this.#rows(db).filter(r=>r.kind==='upload'&&(r.value as UploadIntent).artifact.id===artifact.id&&equal((r.value as UploadIntent).binding,binding)).map(r=>r.value as UploadIntent));if(!matches.length)return null;if(matches.length!==1||matches[0].state!=='settled'||!equal(matches[0].receipt,target))fail();return matches[0].contentId;}
 async recordStageReceipt(holdId:string,artifact:Artifact,mutations:DurableMutations,provider:ProtectedCredentialProvider):Promise<void>{
  const h=this.#db.read(db=>this.#rows(db).find(r=>r.kind==='hold'&&r.value.id===holdId)?.value as ContentHold|undefined);if(!h||h.operation!=='stageArtifact'||!h.journalId)fail();provider.assertNoSecrets(JSON.stringify(artifact));const evidence=await mutations.inspectSettledArtifactIntent(h.journalId,'stageArtifact',h.binding);if(!evidence)fail();const receipt=artifactReceipt(artifact),body=JSON.parse(evidence.request.canonicalBody),content=this.content(h.contentId);if(content.state!=='ready'||content.sealed?.sha256!==artifact.sha256||content.sealed?.size!==artifact.byte_size)fail();if(receipt.status!=='staged'||receipt.version!==1||receipt.workspaceId!==h.binding.workspaceId||!equal(body,{task_id:artifact.task_id,run_id:artifact.run_id,filename:artifact.filename,media_type:artifact.media_type,byte_size:artifact.byte_size,sha256:artifact.sha256}))fail();
  this.#db.transaction(db=>{const current=this.#rows(db).find(r=>r.kind==='hold'&&r.value.id===holdId)?.value as ContentHold|undefined;if(!current||current.journalId!==h.journalId||!equal(current.binding,h.binding)||current.association!==null&&!equal(current.association,receipt))fail();current.association=receipt;this.#save(db,'hold',current);});
 }
 async settleCommit(holdId:string,artifact:Artifact,mutations:DurableMutations,provider:ProtectedCredentialProvider):Promise<void>{
  provider.assertNoSecrets(JSON.stringify(artifact));const rows=this.#db.read(db=>this.#rows(db)),hold=rows.find(r=>r.kind==='hold'&&r.value.id===holdId)?.value as ContentHold|undefined;if(!hold||hold.operation!=='commitArtifact'||!hold.journalId||!hold.association)fail();const receipt=artifactReceipt(artifact);if(!validArtifactTransition(hold.association,receipt,'committed'))fail();const evidence=await mutations.inspectSettledArtifactIntent(hold.journalId,'commitArtifact',hold.binding);if(!evidence)fail();const {request:_input,...expected}=prepareNativeOperation(hold.binding.origin,hold.binding.workspaceId,'commitArtifact',{path:{artifact_id:receipt.artifactId},body:{expected_artifact_version:hold.association.version}});if(!equal(evidence.request,expected))fail();
  const uploads=rows.filter(r=>r.kind==='upload'&&(r.value as UploadIntent).contentId===hold.contentId&&equal((r.value as UploadIntent).binding,hold.binding)&&(r.value as UploadIntent).artifact.id===receipt.artifactId&&(r.value as UploadIntent).state==='settled'&&equal((r.value as UploadIntent).receipt,hold.association)).map(r=>r.value as UploadIntent);if(uploads.length!==1||uploads[0].state!=='settled'||!equal(uploads[0].receipt,hold.association))fail();
  const stages:ContentHold[]=[];for(const row of rows){if(row.kind!=='hold')continue;const h=row.value as ContentHold;if(h.operation!=='stageArtifact'||h.contentId!==hold.contentId||!equal(h.binding,hold.binding)||h.association?.artifactId!==receipt.artifactId)continue;if(!h.journalId||!validArtifactTransition(h.association,uploads[0].receipt!,'uploaded'))continue;const proof=await mutations.inspectSettledArtifactIntent(h.journalId,'stageArtifact',h.binding);if(!proof)continue;const body=JSON.parse(proof.request.canonicalBody);const m=h.association.manifest;if(!equal(body,{task_id:m.task_id,run_id:m.run_id,filename:m.filename,media_type:m.media_type,byte_size:m.byte_size,sha256:m.sha256}))continue;stages.push(h);}
  this.#db.transaction(db=>{const current=this.#rows(db);const selected=[hold,uploads[0],...stages];for(const previous of selected){const row=current.find(r=>r.value.id===previous.id);if(!row||!equal(row.value,previous))fail();}const now=Date.now();for(const previous of selected){const kind='operation'in previous?'hold':'upload';previous.settledAt??=now;this.#save(db,kind,previous);}const c=current.find(r=>r.kind==='content'&&r.value.id===hold.contentId)?.value as ContentRecord|undefined;if(!c||c.state!=='ready')fail();c.eligibleAt=Math.max(c.eligibleAt,...selected.map(r=>r.settledAt!+week));this.#save(db,'content',c);});
 }

 cleanup():{deleted:number;blocked:number}{let deleted=0;const rows=this.#db.read(db=>this.#rows(db));this.#directory(rows);for(const row of rows){if(row.kind!=='content')continue;const id=row.value.id;const chosen=this.#db.transaction(db=>{let current=this.#rows(db);for(const r of current){if(r.kind==='content')continue;const ref=r.value as ContentHold|UploadIntent;if(ref.contentId===id&&ref.settledAt!==null&&ref.settledAt+week<=Date.now())db.prepare('DELETE FROM retained WHERE id=?').run(ref.id);}current=this.#rows(db);const c=current.find(r=>r.kind==='content'&&r.value.id===id)?.value as ContentRecord|undefined;if(!c||!['ready','deleting'].includes(c.state)||c.eligibleAt>Date.now()||current.some(r=>r.kind!=='content'&&(r.value as ContentHold).contentId===id))return null;c.state='deleting';this.#save(db,'content',c);return c;});if(!chosen)continue;try{lstatSync(join(this.spoolDirectory,chosen.basename));unlinkSealedContent(this.spoolDirectory,chosen.sealed!);}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'))throw error;syncArtifactDirectory(this.spoolDirectory);}this.#db.transaction(db=>{const c=this.#rows(db).find(r=>r.value.id===id)?.value;if(!equal(c,chosen))fail();db.prepare('DELETE FROM retained WHERE id=?').run(id);});deleted++;}return {deleted,blocked:rows.filter(r=>r.kind==='content').length-deleted};}
 close():void{this.#db.close();}
}
