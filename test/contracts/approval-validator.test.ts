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
