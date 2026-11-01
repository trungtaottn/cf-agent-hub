import {randomUUID} from 'node:crypto';
import type {ObservationRecord,ObservationBatchReceipt,ObservationOwnerStatus} from '../../../src/http/dto';
import {validateObservationCurrentBinding,validateObservationBatchReceipt,validateObservationReplacementReceipt,validateObservationOwnerStatus} from '../../../src/http/generated/auth-validators.js';
import {canonicalBody} from '../../client/src/native-request';
import type {Deadline} from '../../client/src/transport';
import {freezeIntent,validateState,sameFrozenBinding,type State,type Pending,type FrozenBinding,type OwnerTransport,type OwnerOutcome,type OwnerStatusOutcome} from './contract';
import {projectHook,readHookInput} from './claude-hook';
import {withStateLock,type StateDirectoryOptions} from './state-file';
export type Transition={state:State;operation:{kind:'dispatch';pending:Pending}|{kind:'status';sessionId:string}|null};
const equal=(a:unknown,b:unknown)=>canonicalBody(a)===canonicalBody(b);
const held=(s:State):State=>validateState({...s,phase:'held'});
function appendRecord(s:State,r:ObservationRecord|null):State{
 if(r===null||s.pending?.intent.kind==='replace')return s;
 try{return validateState({...s,queue:[...s.queue,r]});}catch{try{return validateState({...s,reportedLocalLoss:true});}catch{return s;}}
}
/** Pure decisions. A returned operation is not a send permit: the runner must
 * durably persist this complete state before obtaining the protected provider. */
export function planTransition(input:State,record:ObservationRecord|null):Transition{
 let state=validateState(input);if(state.phase==='held')return {state,operation:null};state=appendRecord(state,record);
 const pending=state.pending;
 if(pending){
  if(pending.intent.kind==='append'&&state.phase!=='unknown')return {state,operation:{kind:'status',sessionId:pending.intent.sessionId}};
  return {state,operation:{kind:'dispatch',pending}};
 }
 if(state.ownerStatus)return {state,operation:{kind:'status',sessionId:state.ownerStatus.sessionId}};
 if(!state.session){
  try{state={...state,phase:'pending',pending:freezeIntent(state.binding,{kind:'establish',body:{run_id:state.binding.runId,fence:state.binding.fence,adapter_id:state.binding.adapterId,adapter_version:state.binding.adapterVersion}})};state=validateState(state);return {state,operation:{kind:'dispatch',pending:state.pending!}};}catch{return {state:held(input),operation:null};}
 }
 if(state.reportedLocalLoss)return {state,operation:{kind:'status',sessionId:state.session.id}};
 if(state.queue.length===0)return {state,operation:null};
 if(state.session.highWater===null||state.session.highWater===Number.MAX_SAFE_INTEGER)return {state:held(state),operation:null};
 for(let count=Math.min(32,state.queue.length);count>0;count--){
  try{const p=freezeIntent(state.binding,{kind:'append',sessionId:state.session.id,body:{run_id:state.binding.runId,fence:state.binding.fence,first_sequence:state.session.highWater+1,records:state.queue.slice(0,count)}});const next=validateState({...state,phase:'pending',pending:p});return {state:next,operation:{kind:'dispatch',pending:p}};}catch{}
 }
 return {state:held(state),operation:null};
}
function matchingBatch(s:State,r:ObservationBatchReceipt):boolean{
 const p=s.pending;if(!p||p.intent.kind!=='append'||!validateObservationBatchReceipt(r))return false;
 const body=p.intent.body;return r.session_id===p.intent.sessionId&&r.first_sequence===body.first_sequence&&r.record_count===body.records.length&&r.last_sequence===body.first_sequence+(body.records.length-1)&&r.request_fingerprint===p.fingerprint;
}
function settleBatch(s:State,r:ObservationBatchReceipt):State{
 if(!matchingBatch(s,r))throw Error('INVALID_RECEIPT');
 return validateState({...s,phase:'ready',pending:null,queue:s.queue.slice(r.record_count),lastReceipt:r,session:{...s.session!,highWater:r.last_sequence}});
}
function statusMatchesHistory(s:State,status:ObservationOwnerStatus):boolean{
 if(!s.session||status.session_id!==s.session.id||status.session_epoch!==s.session.epoch||status.high_water!==s.session.highWater)return false;
 if(s.lastReceipt?.kind==='batch_receipt')return equal(status.latest_batch_receipt,s.lastReceipt);
 if(status.latest_batch_receipt!==null)return false;
 return s.lastReceipt?.kind==='replacement_receipt'?equal(status.latest_replacement_receipt,s.lastReceipt):status.latest_replacement_receipt===null;
}
/** A receipt only settles the exact retained diagnostic intent, never a task. */
export function settleTransition(input:State,outcome:OwnerOutcome|OwnerStatusOutcome,replacementId?:string):State{
 const s=validateState(input);if(s.phase==='held')return s;
 if(outcome.kind==='blocked'||outcome.kind==='no-dispatch')return held(s);
 if(outcome.kind==='unknown')return s.pending?validateState({...s,phase:'pending'}):s;
 try{
  if(outcome.kind==='appended')return settleBatch(s,outcome.data);
  if(outcome.kind==='established'){
   const r=outcome.data;if(s.pending?.intent.kind!=='establish'||!validateObservationCurrentBinding(r)||r.run_id!==s.binding.runId||r.fence!==s.binding.fence)throw Error('INVALID_RECEIPT');
   return validateState({...s,phase:'awaiting-owner-status',pending:null,session:{id:r.session_id,epoch:r.session_epoch,highWater:null},ownerStatus:{sessionId:r.session_id,epoch:r.session_epoch,reason:'established'}});
  }
  if(outcome.kind==='replaced'){
   const r=outcome.data,p=s.pending;if(!p||p.intent.kind!=='replace'||!validateObservationReplacementReceipt(r)||r.old_session_id!==p.intent.body.expected_session_id||r.replacement_request_id!==p.intent.body.replacement_request_id||r.request_fingerprint!==p.fingerprint||!s.session||r.new_epoch!==s.session.epoch+1)throw Error('INVALID_RECEIPT');
   return validateState({...s,phase:'awaiting-owner-status',pending:null,session:{id:r.new_session_id,epoch:r.new_epoch,highWater:null},ownerStatus:{sessionId:r.new_session_id,epoch:r.new_epoch,reason:'replacement-recovered'},queue:[],reportedLocalLoss:false,lastReceipt:r});
  }
  const r=outcome.data;if(!validateObservationOwnerStatus(r)||!s.session||r.session_id!==s.session.id||r.session_epoch!==s.session.epoch)throw Error('INVALID_RECEIPT');
  if(s.ownerStatus){
   if(r.high_water!==0||r.latest_batch_receipt!==null||(s.ownerStatus.reason==='established'?r.latest_replacement_receipt!==null:!equal(r.latest_replacement_receipt,s.lastReceipt)))return held(s);
   return validateState({...s,phase:'ready',session:{...s.session,highWater:0},ownerStatus:null});
  }
  if(s.pending?.intent.kind==='append'){
   if(r.latest_batch_receipt&&matchingBatch(s,r.latest_batch_receipt)&&r.high_water===r.latest_batch_receipt.last_sequence)return settleBatch(s,r.latest_batch_receipt);
   // Absence cannot settle. An unchanged status permits only another exact
   // frozen retry on a later invocation; abort never proves remote rollback.
   return statusMatchesHistory(s,r)?validateState({...s,phase:'unknown'}):held(s);
  }
  if(s.phase==='ready'&&s.reportedLocalLoss){
   if(!statusMatchesHistory(s,r)||!replacementId)return held(s);
   return validateState({...s,phase:'pending',queue:[],pending:freezeIntent(s.binding,{kind:'replace',body:{run_id:s.binding.runId,fence:s.binding.fence,expected_session_id:s.session.id,expected_high_water:r.high_water,replacement_request_id:replacementId,reason:'coverage_loss'}})});
  }
  throw Error('INVALID_RECEIPT');
 }catch{return s.pending?validateState({...s,phase:'pending'}):s;}
}
export interface InvocationContext {
 readonly root:string;readonly profile:string;readonly observedAt:string;readonly binding:FrozenBinding;
 readonly state:Omit<StateDirectoryOptions,'purpose'>;readonly deadline:Deadline;
 /** Current trusted launch comparison, not hook-supplied authentication. */
 readonly currentBinding:()=>FrozenBinding;
 /** Lazy trusted code factory, called only after durable pending/refence. */
 readonly transportFactory:()=>OwnerTransport;
}
export async function runInvocation(context:InvocationContext,input:ReadableStream<Uint8Array>):Promise<void>{
 const deadline=context.deadline,detached=JSON.parse(JSON.stringify(context.binding)) as FrozenBinding;
 const binding=Object.freeze({...detached,principal:Object.freeze({...detached.principal})});
 const root=context.root,profile=context.profile,observedAt=context.observedAt;
 const currentBinding=context.currentBinding,transportFactory=context.transportFactory;
 const stateOptions=Object.freeze({...context.state,purpose:'invoke' as const,flock:Object.freeze({...context.state.flock})});
 const current=()=>{deadline.check();if(!sameFrozenBinding(binding,currentBinding()))throw Error('LAUNCH_CHANGED');deadline.check();};
 current();const bytes=await readHookInput(input.getReader(),deadline);current();
 const projected=projectHook(bytes,{root,profile,observedAt});deadline.check();if(projected===null)return;
 await withStateLock(stateOptions,deadline,async store=>{
  current();const prior=store.read();current();if(!sameFrozenBinding(prior.binding,binding))return;
  const transition=planTransition(prior,projected);current();
  // Re-fence EVERY HTTP, even status, after possible post-rename fsync ambiguity.
  // No protected provider construction or secret acquisition precedes durability.
  store.persist(transition.state);current();const operation=transition.operation;if(operation===null)return;
  const transport=transportFactory();current();if(!transport||typeof transport.dispatch!=='function'||typeof transport.status!=='function')throw Error('TRANSPORT_UNAVAILABLE');
  let outcome:OwnerOutcome|OwnerStatusOutcome;
  try{
   if(operation.kind==='dispatch'){const frozen=freezeIntent(binding,operation.pending.intent);if(!equal(frozen,operation.pending))throw Error('INTENT_CHANGED');current();outcome=await deadline.wait(transport.dispatch(frozen,deadline));}
   else outcome=await deadline.wait(transport.status(binding,operation.sessionId,deadline));
  }catch{return;}
  current();const settled=settleTransition(transition.state,outcome,randomUUID());current();store.persist(settled);current();
 });
}
