import {createHash} from 'node:crypto';
import type {ObservationEstablishRequest,ObservationBatchRequest,ObservationReplaceRequest,ObservationRecord,ObservationBatchReceipt,ObservationReplacementReceipt,ObservationCurrentBinding,ObservationOwnerStatus} from '../../../src/http/dto';
import {validateObservationBatchReceipt,validateObservationReplacementReceipt,validateObservationRecord,validateObservationEstablishRequest,validateObservationBatchRequest,validateObservationReplaceRequest} from '../../../src/http/generated/auth-validators.js';
import {parseExactJson} from '../../../src/approvals/exact-json';
import {canonicalBody,nativeOrigin} from '../../client/src/native-request';
import type {VerifiedPrincipalBinding} from '../../client/src/types';
import type {Deadline} from '../../client/src/transport';
/** Structural comparison constraints only. This JSON never authenticates a caller. */
export interface FrozenBinding {
 origin:string;workspaceId:string;principal:VerifiedPrincipalBinding;runtimeId:string;taskId:string;runId:string;fence:number;
 repositoryId:string;checkoutSlotId:string;launchGeneration:string;adapterId:string;adapterVersion:string;expectedConfigIdentity:string;
}
export interface Session {id:string;epoch:number;highWater:number|null;}
export type Intent={kind:'establish';body:ObservationEstablishRequest}|{kind:'append';sessionId:string;body:ObservationBatchRequest}|{kind:'replace';body:ObservationReplaceRequest};
export interface Pending {binding:FrozenBinding;intent:Intent;method:'POST';path:string;canonicalBody:string;fingerprint:string;}
export interface OwnerStatusContinuation {sessionId:string;epoch:number;reason:'established'|'replacement-recovered';}
export interface State {
 version:1;binding:FrozenBinding;completeness:'unknown';session:Session|null;pending:Pending|null;
 phase:'ready'|'pending'|'unknown'|'awaiting-owner-status'|'held';ownerStatus:OwnerStatusContinuation|null;
 queue:ObservationRecord[];reportedLocalLoss:boolean;lastReceipt:ObservationBatchReceipt|ObservationReplacementReceipt|null;
}
export type OwnerFailure={kind:'no-dispatch'}|{kind:'unknown'}|{kind:'blocked'};
export type OwnerOutcome=OwnerFailure|{kind:'established';data:ObservationCurrentBinding}|{kind:'appended';data:ObservationBatchReceipt}|{kind:'replaced';data:ObservationReplacementReceipt};
export type OwnerStatusOutcome=OwnerFailure|{kind:'status';data:ObservationOwnerStatus};
export interface OwnerTransport {dispatch(pending:Pending,deadline:Deadline):Promise<OwnerOutcome>;status(binding:FrozenBinding,sessionId:string,deadline:Deadline):Promise<OwnerStatusOutcome>;}
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function fail():never {throw new Error('INVALID_OBSERVATION_STATE');}
const nonempty=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
const safe=(v:unknown,min=0):v is number=>Number.isSafeInteger(v)&&Number(v)>=min;
const sessionId=(v:unknown):v is string=>typeof v==='string'&&/^obs_[a-f0-9]{48}$/.test(v);
const size=(v:unknown)=>Buffer.byteLength(JSON.stringify(v),'utf8');
const equal=(a:unknown,b:unknown)=>canonicalBody(a)===canonicalBody(b);
const timestamp=(v:string)=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v.replace(/Z$/,v.includes('.')?'Z':'.000Z');
const bindingKeys=['origin','workspaceId','principal','runtimeId','taskId','runId','fence','repositoryId','checkoutSlotId','launchGeneration','adapterId','adapterVersion','expectedConfigIdentity'];
function assertBinding(v:unknown):asserts v is FrozenBinding{
 if(!exact(v,bindingKeys)||!exact(v.principal,['origin','workspaceId','principalId','slotId','slotGeneration','provenanceId']))fail();
 for(const k of bindingKeys)if(k!=='principal'&&k!=='fence'&&!nonempty(v[k]))fail();
 const p=v.principal;for(const k of ['origin','workspaceId','principalId','slotId','provenanceId'])if(!nonempty(p[k]))fail();
 if(!safe(v.fence,1)||!safe(p.slotGeneration)||p.origin!==v.origin||p.workspaceId!==v.workspaceId||typeof v.workspaceId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(v.workspaceId)||v.taskId==='.'||v.taskId==='..')fail();
 try{nativeOrigin(v.origin);}catch{fail();}
}
function immutable<T>(v:T):T {if(v&&typeof v==='object'){for(const x of Object.values(v))immutable(x);Object.freeze(v);}return v;}
export function sameFrozenBinding(a:FrozenBinding,b:FrozenBinding):boolean {try{assertBinding(a);assertBinding(b);return equal(a,b);}catch{return false;}}
export function emptyState(binding:FrozenBinding):State {
 assertBinding(binding);return validateState({version:1,binding,completeness:'unknown',session:null,pending:null,phase:'ready',ownerStatus:null,queue:[],reportedLocalLoss:false,lastReceipt:null});
}
function assertProjectedRecord(v:unknown):asserts v is ObservationRecord{
 if(!validateObservationRecord(v))fail();
 const p=v.relative_path;
 if(Buffer.byteLength(p)>1024||p.includes('\\')||p.includes('\0')||/^[a-zA-Z]:/.test(p)||p.split('/').some(x=>x===''||x==='.'||x==='..')||!timestamp(v.observed_at))fail();
 if(v.source_oid!==null||Object.hasOwn(v,'label')||!['read-observed','write-observed'].includes(v.activity))fail();
}
export function freezeIntent(binding:FrozenBinding,intent:Intent):Pending{
 try{
  assertBinding(binding);
  if(!record(intent)||!['establish','append','replace'].includes(intent.kind)||!exact(intent,intent.kind==='append'?['kind','sessionId','body']:['kind','body']))fail();
  const text=canonicalBody(intent.body);if(Buffer.byteLength(text)>32768)fail();
  const body=parseExactJson(new TextEncoder().encode(text),{maxBytes:32768,maxDepth:8,maxNodes:1024});
  if(!(intent.kind==='establish'?validateObservationEstablishRequest(body):intent.kind==='append'?validateObservationBatchRequest(body):validateObservationReplaceRequest(body)))fail();
  if(intent.body.run_id!==binding.runId||intent.body.fence!==binding.fence)fail();
  let suffix:string;
  if(intent.kind==='establish'){
   if(intent.body.adapter_id!==binding.adapterId||intent.body.adapter_version!==binding.adapterVersion)fail();suffix='/observations:establish';
  }else if(intent.kind==='append'){
   if(!sessionId(intent.sessionId))fail();for(const r of intent.body.records)assertProjectedRecord(r);
   if(intent.body.first_sequence>Number.MAX_SAFE_INTEGER-(intent.body.records.length-1))fail();suffix='/observation-sessions/'+intent.sessionId+'/records';
  }else suffix='/observation-sessions:replace';
  const path='/v2/workspaces/'+binding.workspaceId+'/tasks/'+encodeURIComponent(binding.taskId)+suffix;
  const fingerprint=createHash('sha256').update(canonicalBody({method:'POST',path,sessionId:intent.kind==='append'?intent.sessionId:null,body:intent.body})).digest('hex');
  return immutable(JSON.parse(JSON.stringify({binding,intent,method:'POST',path,canonicalBody:text,fingerprint})) as Pending);
 }catch{return fail();}
}
/** Metadata counts all retained framing/bindings/receipts, omitting only queue and
 * two request-body representations. Full state cap still counts every duplicate. */
export function stateUsage(s:State):{totalBytes:number;queueBytes:number;requestBytes:number;metadataBytes:number}{
 const pending=s.pending?{...s.pending,intent:s.pending.intent.kind==='append'?{kind:s.pending.intent.kind,sessionId:s.pending.intent.sessionId}:{kind:s.pending.intent.kind},canonicalBody:''}:null;
 return {totalBytes:size(s),queueBytes:size(s.queue),requestBytes:s.pending?Buffer.byteLength(s.pending.canonicalBody):0,metadataBytes:size({...s,queue:[],pending})};
}
function assertReceipt(s:State):void {
 const r=s.lastReceipt;if(r===null)return;
 if(!s.session)fail();
 if(r.kind==='batch_receipt'){
  if(!validateObservationBatchReceipt(r)||!timestamp(r.accepted_at)||r.record_count!==r.last_sequence-r.first_sequence+1||r.session_id!==s.session.id||s.session.highWater!==r.last_sequence)fail();
 }else if(r.kind==='replacement_receipt'){
  if(!validateObservationReplacementReceipt(r)||!timestamp(r.accepted_at)||r.new_session_id===r.old_session_id||r.new_session_id!==s.session.id||r.new_epoch!==s.session.epoch||s.session.highWater!==null&&s.session.highWater!==0)fail();
 }else fail();
}
export function validateState(value:unknown):State{
 try{
  if(!exact(value,['version','binding','completeness','session','pending','phase','ownerStatus','queue','reportedLocalLoss','lastReceipt'])||value.version!==1||value.completeness!=='unknown'||typeof value.reportedLocalLoss!=='boolean'||!['ready','pending','unknown','awaiting-owner-status','held'].includes(String(value.phase))||!Array.isArray(value.queue)||value.queue.length>64)fail();
  assertBinding(value.binding);for(const r of value.queue)assertProjectedRecord(r);
  const s=value as unknown as State;
  if(s.session!==null&&(!exact(s.session,['id','epoch','highWater'])||!sessionId(s.session.id)||!safe(s.session.epoch,1)||s.session.highWater!==null&&!safe(s.session.highWater)))fail();
  if(s.ownerStatus!==null){
   if(!exact(s.ownerStatus,['sessionId','epoch','reason'])||!s.session||s.session.highWater!==null||s.session.id!==s.ownerStatus.sessionId||s.session.epoch!==s.ownerStatus.epoch||!['established','replacement-recovered'].includes(s.ownerStatus.reason)||s.pending!==null||!['awaiting-owner-status','held'].includes(s.phase))fail();
   if(s.ownerStatus.reason==='established'&&s.lastReceipt!==null||s.ownerStatus.reason==='replacement-recovered'&&s.lastReceipt?.kind!=='replacement_receipt')fail();
  }else if(s.phase==='awaiting-owner-status'||s.session?.highWater===null)fail();
  if(s.pending!==null){
   if(!exact(s.pending,['binding','intent','method','path','canonicalBody','fingerprint'])||!['pending','unknown','held'].includes(s.phase)||!sameFrozenBinding(s.binding,s.pending.binding)||s.ownerStatus!==null)fail();
   const expected=freezeIntent(s.binding,s.pending.intent);if(!equal(expected,s.pending))fail();
   const intent=s.pending.intent;
   if(intent.kind==='establish'){if(s.session!==null||s.lastReceipt!==null)fail();}
   else if(intent.kind==='append'){
    if(!s.session||s.session.highWater===null||s.session.id!==intent.sessionId||intent.body.first_sequence!==s.session.highWater+1||!equal(s.queue.slice(0,intent.body.records.length),intent.body.records))fail();
   }else if(!s.session||s.session.id!==intent.body.expected_session_id||s.session.highWater!==intent.body.expected_high_water||s.queue.length!==0||!s.reportedLocalLoss)fail();
  }else if(s.phase==='pending'||s.phase==='unknown')fail();
  if(s.session?.highWater!==null&&s.session&&s.session.highWater>0&&s.lastReceipt?.kind!=='batch_receipt')fail();
  assertReceipt(s);
  const usage=stateUsage(s);if(usage.queueBytes>65536||usage.requestBytes>32768||usage.metadataBytes>16384||usage.totalBytes>131072)fail();
  // Detached private comparison state, not a provenance receipt. Return mutable
  // transition draft; only frozen pending requests become immutable snapshots.
  return JSON.parse(JSON.stringify(s)) as State;
 }catch{return fail();}
}
