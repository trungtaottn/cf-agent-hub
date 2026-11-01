import type {ProtectedCredentialProvider} from '../../cli/src/secret-store';
import type {CredentialDispatchLease} from '../../client/src/types';
import {protectedAssociationFor,samePrincipalBinding,runFinalClockCheck,clearFinalClockCheck} from '../../client/src/native-provenance';
import {HttpTransport,type Deadline} from '../../client/src/transport';
import {canonicalBody,nativeOrigin} from '../../client/src/native-request';
import {validateObservationEstablishResponse,validateObservationBatchResponse,validateObservationReplaceResponse,validateObservationOwnerStatusResponse} from '../../../src/http/generated/auth-validators.js';
import {emptyState,freezeIntent,sameFrozenBinding,type FrozenBinding,type Pending,type OwnerTransport,type OwnerOutcome,type OwnerStatusOutcome} from './contract';
const token=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const observe=(v:unknown)=>{try{void Promise.resolve(v).catch(()=>{});}catch{}};
function unavailable():never{throw Error('OWNER_TRANSPORT_UNAVAILABLE');}
/** Internal four-route client. The private registered provider/lease association,
 * not a JSON binding or claimed verified flag, is mandatory at actual dispatch.
 * The concrete provider is opened create:false by the trusted launch adapter. */
export function createOwnerTransport(provider:ProtectedCredentialProvider,fetcher:typeof fetch,currentBinding:()=>FrozenBinding):OwnerTransport{
 const http=new HttpTransport(fetcher);
 async function execute(binding:FrozenBinding,pending:Pending|null,sessionId:string|null,deadline:Deadline):Promise<OwnerOutcome|OwnerStatusOutcome>{
  let lease:CredentialDispatchLease|undefined,response:Response|undefined,sent=false,finished=false;
  const headers=new Headers({accept:'application/json'});let snapshot:FrozenBinding;
  const release=(value:CredentialDispatchLease)=>{try{clearFinalClockCheck(value);value.release();}catch{}};
  const current=()=>{
   deadline.check();if(finished||!sameFrozenBinding(snapshot,currentBinding())||!lease||lease.isCurrent()!==true)unavailable();
   const association=protectedAssociationFor(provider,lease);if(!association||!samePrincipalBinding(snapshot.principal,association.binding)||association.runtimeId!==snapshot.runtimeId||association.binding.origin!==snapshot.origin||association.binding.workspaceId!==snapshot.workspaceId)unavailable();
   provider.assertLeaseBinding(snapshot.principal,lease);const runtime=provider.runtimeBinding();if(!runtime||runtime.runtimeId!==snapshot.runtimeId||!samePrincipalBinding(runtime,snapshot.principal))unavailable();deadline.check();
  };
  try{
   deadline.check();const detached=emptyState(binding).binding;snapshot=Object.freeze({...detached,principal:Object.freeze({...detached.principal})});
   const origin=nativeOrigin(snapshot.origin);if(!sameFrozenBinding(snapshot,currentBinding())||typeof fetcher!=='function'||!provider||typeof provider.acquire!=='function'||typeof provider.dispatchRuntimeProof!=='function')unavailable();
   let path:string,body:string|undefined,kind:'establish'|'append'|'replace'|'status';
   if(pending){const frozen=freezeIntent(snapshot,pending.intent);if(canonicalBody(frozen)!==canonicalBody(pending))unavailable();pending=frozen;path=frozen.path;body=frozen.canonicalBody;kind=frozen.intent.kind;headers.set('content-type','application/json');}
   else{if(typeof sessionId!=='string'||!/^obs_[a-f0-9]{48}$/.test(sessionId))unavailable();path='/v2/workspaces/'+snapshot.workspaceId+'/tasks/'+encodeURIComponent(snapshot.taskId)+'/observation-sessions/'+sessionId+'/owner-status';kind='status';}
   deadline.check();const acquiring=Promise.resolve(provider.acquire(snapshot.principal,deadline.signal));
   try{lease=await deadline.wait(acquiring);}catch(error){void acquiring.then(release,()=>{});throw error;}
   current();const use=lease.use.bind(lease),proofDispatch=provider.dispatchRuntimeProof.bind(provider);
   response=await http.open(origin+path,{method:kind==='status'?'GET':'POST',headers,body,credentials:'omit',redirect:'manual',cache:'no-store',signal:deadline.signal},deadline,send=>{
    let calls=0,inside=true,dispatched:Promise<Response>|undefined;
    try{
     const used=use(credential=>{
      if(!inside||++calls!==1||!token(credential))unavailable();current();headers.set('authorization','Bearer '+credential);
      let proofCalls=0,proofInside=true;
      try{
       const proved=proofDispatch({...snapshot.principal,runtimeId:snapshot.runtimeId},lease!,proof=>{
        if(!proofInside||++proofCalls!==1||!token(proof)||sent)unavailable();current();headers.set('x-runtime-token',proof);current();runFinalClockCheck(provider,lease!);deadline.check();sent=true;return dispatched=send();
       });observe(proved);if(proofCalls!==1||proved!==dispatched)unavailable();return proved;
      }finally{proofInside=false;}
     });observe(used);if(calls!==1||used!==dispatched)unavailable();return used;
    }catch(error){void dispatched?.then(r=>{void r.body?.cancel().catch(()=>{});},()=>{});throw error;}finally{inside=false;}
   });
   current();
   if(response.type==='opaqueredirect'||response.redirected||response.status>=300&&response.status<400||response.headers.has('set-cookie')||response.url&&new URL(response.url).origin!==origin)unavailable();
   if(response.status!==200)return {kind:'blocked'};
   const validate=kind==='establish'?validateObservationEstablishResponse:kind==='append'?validateObservationBatchResponse:kind==='replace'?validateObservationReplaceResponse:validateObservationOwnerStatusResponse;
   const result=await http.json<unknown>(response,{status:200,validateEnvelope:validate,maxBytes:1048576,deadline,current});current();if(!result.ok)unavailable();
   if(kind==='establish'){
    const envelope={data:result.data,request_id:result.requestId};if(!validateObservationEstablishResponse(envelope)||envelope.data.run_id!==snapshot.runId||envelope.data.fence!==snapshot.fence)unavailable();return {kind:'established',data:envelope.data};
   }
   if(kind==='append'){
    const envelope={data:result.data,request_id:result.requestId};if(!validateObservationBatchResponse(envelope)||pending?.intent.kind!=='append')unavailable();const r=envelope.data,b=pending.intent.body;if(r.session_id!==pending.intent.sessionId||r.first_sequence!==b.first_sequence||r.last_sequence!==b.first_sequence+(b.records.length-1)||r.record_count!==b.records.length||r.request_fingerprint!==pending.fingerprint)unavailable();return {kind:'appended',data:r};
   }
   if(kind==='replace'){
    const envelope={data:result.data,request_id:result.requestId};if(!validateObservationReplaceResponse(envelope)||pending?.intent.kind!=='replace')unavailable();const r=envelope.data,b=pending.intent.body;if(r.old_session_id!==b.expected_session_id||r.new_session_id===r.old_session_id||r.replacement_request_id!==b.replacement_request_id||r.request_fingerprint!==pending.fingerprint)unavailable();return {kind:'replaced',data:r};
   }
   const envelope={data:result.data,request_id:result.requestId};if(!validateObservationOwnerStatusResponse(envelope)||envelope.data.session_id!==sessionId)unavailable();return {kind:'status',data:envelope.data};
  }catch{return {kind:sent?'unknown':'no-dispatch'};}finally{finished=true;headers.delete('authorization');headers.delete('x-runtime-token');if(response?.body&&!response.bodyUsed)void response.body.cancel().catch(()=>{});if(lease)release(lease);}
 }
 return {
  dispatch:async(pending,deadline)=>{const result=await execute(pending.binding,pending,null,deadline);return result.kind==='status'?{kind:'unknown'}:result;},
  status:async(binding,sessionId,deadline)=>{const result=await execute(binding,null,sessionId,deadline);return ['established','appended','replaced'].includes(result.kind)?{kind:'unknown'}:result as OwnerStatusOutcome;}
 };
}
