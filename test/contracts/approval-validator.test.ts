import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import * as sharedValidators from '../../src/http/generated/auth-validators.js';
import * as validators from '../../src/http/generated/decision-validators.js';

const approval=JSON.parse(readFileSync(new URL('../../examples/http/approval-approve.response.json',import.meta.url),'utf8')).data.approval;
describe('canonical standalone approval validation',()=>{
 it('exports the existing Approval schema without enabling a decision operation',()=>{
  const validate=(validators as Record<string,unknown>).validateApproval;
  expect(typeof validate).toBe('function');
  if(typeof validate!=='function')return;
  expect(validate(approval)).toBe(true);
  expect(validate({...approval,extra_authority:true})).toBe(false);
  expect(validate({...approval,status:'ready'})).toBe(false);
  expect(validate({...approval,approval_version:0})).toBe(false);
  expect(validate({...approval,approval_version:1.5})).toBe(false);
  expect('validateApproval' in sharedValidators).toBe(false);
 });
});
it('isolates closed canonical decision envelopes and command bodies for browser transport',()=>{
 const roots=validators as Record<string,unknown>;
 const approve=JSON.parse(readFileSync(new URL('../../examples/http/approval-approve.response.json',import.meta.url),'utf8'));
 const body=JSON.parse(readFileSync(new URL('../../examples/http/approval-approve.request.json',import.meta.url),'utf8'));
 for(const [name,value] of [['ApprovalResponse',{data:approval,request_id:'synthetic'}],['ApprovalListResponse',{data:[approval],page:{next_cursor:null,has_more:false},request_id:'synthetic'}],['TaskCommandResultResponse',approve],['ApprovalDecisionRequest',body]] as const){
  expect(typeof roots['validate'+name]).toBe('function');
  const validate=roots['validate'+name] as (v:unknown)=>boolean;
  expect(validate(value)).toBe(true);expect(validate({...value,extra_authority:true})).toBe(false);
 }
});
