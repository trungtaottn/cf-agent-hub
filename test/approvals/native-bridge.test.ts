import {describe,it,expect} from 'vitest';
import * as validators from '../../src/http/generated/auth-validators.js';

const decision={expected_version:3,expected_proposal_version:2,expected_approval_version:1,reason:'Reviewed exact input'};
const request={expected_version:3,run_id:'run_one',fence:2,checkpoint:{summary:'Paused',artifact_ids:[]},proposal:{summary:'Fixture only',action:'unconfigured_fixture',scope:{project_id:null,resource_ids:[]},artifact_ids:[],inputs:{artifact_id:'artifact_one',sha256:'a'.repeat(64)}}};
const validator=(name:string)=>(validators as unknown as Record<string,(x:unknown)=>boolean>)[name];

describe('canonical decision schema roots (not operation activation)',()=>{
 it('validates all three decision versions and rejects missing or authority-bearing fields',()=>{
  const check=validator('validateApprovalDecisionRequest');expect(check).toBeTypeOf('function');
  expect(check(decision)).toBe(true);
  for(const key of ['expected_version','expected_proposal_version','expected_approval_version']){
   const bad:Record<string,unknown>={...decision};delete bad[key];expect(check(bad)).toBe(false);
   expect(check({...decision,[key]:0})).toBe(false);
  }
  for(const extra of [{actor_id:'human'},{sessionId:'session'},{grant:{}},{expectedVersion:3}])expect(check({...decision,...extra})).toBe(false);
 });
 it('validates exact proposal input identity and rejects caller verification flags',()=>{
  const check=validator('validateTaskRequestDecisionRequest');expect(check).toBeTypeOf('function');
  expect(check(request)).toBe(true);
  expect(check({...request,proposal:{...request.proposal,inputs:{...request.proposal.inputs,sha256:'A'.repeat(64)}}})).toBe(false);
  expect(check({...request,verified:true})).toBe(false);
  expect(check({...request,proposal:{...request.proposal,inputs:{...request.proposal.inputs,verified:true}}})).toBe(false);
 });
});

import {createNativeInvoker} from '../../packages/client/src/native-types';
import {nativeFixture,configuration,denied} from '../client/native-helpers';
import type {EnabledOperationId} from '../../packages/client/src/types';

describe('thin bridge over actual native transport',()=>{
 it('preserves validated success and request correlation',async()=>{
  const f=nativeFixture();
  expect(await createNativeInvoker(f.client).invoke('getConfiguration',{})).toEqual({ok:true,status:200,data:configuration,requestId:'req_native'});
  expect(f.fetch).toHaveBeenCalledTimes(1);
 });
 it('preserves caller mutation key, exact body and native denial without retries',async()=>{
  const f=nativeFixture();await f.enroll();f.fetch.mockImplementation(async()=>denied('VERSION_CONFLICT',409));
  const result=await createNativeInvoker(f.client).invoke('createTask',{body:{title:'Original intent',description:''}},{idempotencyKey:'original-intent-key',expectedBinding:f.state.provenance!.binding});
  expect(result).toMatchObject({ok:false,status:409,requestId:'req_denied',error:{code:'VERSION_CONFLICT',details:{current_version:2}}});
  expect(f.fetch).toHaveBeenCalledTimes(2);
  const [,init]=f.fetch.mock.calls[1]!;expect(init!.body).toBe('{"title":"Original intent","description":""}');
  expect(new Headers(init!.headers).get('idempotency-key')).toBe('original-intent-key');
 });
 it.each(['requestTaskDecision','listApprovals','getApproval','approveApproval','rejectApproval'])('does not activate %s or acquire credentials',async operation=>{
  const f=nativeFixture();expect(await createNativeInvoker(f.client).invoke(operation as EnabledOperationId,{} as never)).toMatchObject({ok:false,error:{code:'OPERATION_UNAVAILABLE'}});
  expect(f.acquire).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
 });
 it('rejects actor and session overrides before provider acquisition',async()=>{
  const f=nativeFixture();
  for(const extra of [{actor_id:'human_one'},{sessionId:'session_one'},{grant:{scopes:['tasks:manage']}}]){
   expect(await createNativeInvoker(f.client).invoke('createTask',{body:{title:'Task',description:'',...extra}} as never,{idempotencyKey:'same-key'})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});
  }
  expect(f.acquire).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
 });
});
