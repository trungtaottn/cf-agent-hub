import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

const fixture=()=>({
 policy_version:1,agent_wip_limit:1,task_retry_limit:2,artifact_upload_ttl_seconds:900,
 eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_a','agent_b']}],
 replay_safety_rules:[{id:'rule_a',project_id:null,work_role_id:null,classification:'replay_safe',evidence_ref:'reviewed-evidence-a'}],
});
function valid(value:unknown):boolean {
 const schema=JSON.parse(readFileSync(new URL('../../spec/execution-policy.schema.json',import.meta.url),'utf8'));
 return new Ajv2020({strict:true,allErrors:true}).compile(schema)(value) as boolean;
}

describe('R2 execution policy schema boundary',()=>{
 it('accepts the explicitly selected test policy without installing a production default',()=>expect(valid(fixture())).toBe(true));
 const boundaries:Record<string,Array<[number,boolean]>>={
  policy_version:[[0,false],[1,true],[2,true],[1.5,false]],
  agent_wip_limit:[[0,false],[1,true],[100,true],[101,false],[1.5,false]],
  task_retry_limit:[[-1,false],[0,true],[10,true],[11,false],[1.5,false]],
  artifact_upload_ttl_seconds:[[59,false],[60,true],[3600,true],[3601,false],[60.5,false]],
 };
 for(const [field,cases]of Object.entries(boundaries))for(const [value,accepted]of cases)
  it(`${field}=${value} is ${accepted?'accepted':'rejected'}`,()=>expect(valid({...fixture(),[field]:value})).toBe(accepted));
 for(const field of Object.keys(fixture()))
  it(`rejects missing ${field}`,()=>{const value:Record<string,unknown>=fixture();delete value[field];expect(valid(value)).toBe(false);});
 for(const field of Object.keys(boundaries))
  it(`rejects coerced ${field}`,()=>expect(valid({...fixture(),[field]:'1'})).toBe(false));
 it('rejects unknown policy keys',()=>expect(valid({...fixture(),unlimited:true})).toBe(false));
 it('preserves explicit null tuple components rather than inserting defaults',()=>{
  const value=fixture(),before=structuredClone(value);expect(valid(value)).toBe(true);expect(value).toEqual(before);
 });
 it('accepts explicit project and role identifiers',()=>{
  const value=fixture();Object.assign(value.eligibility_rules[0],{project_id:'project_a',work_role_id:'role_a'});expect(valid(value)).toBe(true);
 });
 for(const key of ['project_id','work_role_id','eligible_agent_ids'])
  it(`requires eligibility ${key}`,()=>{const value=fixture();delete (value.eligibility_rules[0] as Record<string,unknown>)[key];expect(valid(value)).toBe(false);});
 it('rejects duplicate eligible agent ids',()=>{const value=fixture();value.eligibility_rules[0].eligible_agent_ids=['agent_a','agent_a'];expect(valid(value)).toBe(false);});
 it('rejects empty agent identifiers',()=>{const value=fixture();value.eligibility_rules[0].eligible_agent_ids=[''];expect(valid(value)).toBe(false);});
 it('rejects unknown eligibility authority',()=>{const value=fixture();Object.assign(value.eligibility_rules[0],{all_projects:true});expect(valid(value)).toBe(false);});
 for(const key of ['id','project_id','work_role_id','classification','evidence_ref'])
  it(`requires replay rule ${key}`,()=>{const value=fixture();delete (value.replay_safety_rules[0] as Record<string,unknown>)[key];expect(valid(value)).toBe(false);});
 it('rejects unsupported replay classification',()=>{const value=fixture();value.replay_safety_rules[0].classification='always_retry';expect(valid(value)).toBe(false);});
 it('requires nonempty replay evidence',()=>{const value=fixture();value.replay_safety_rules[0].evidence_ref='';expect(valid(value)).toBe(false);});
 it('rejects unknown replay authority',()=>{const value=fixture();Object.assign(value.replay_safety_rules[0],{override_unknown_outcome:true});expect(valid(value)).toBe(false);});
 it('accepts no rules without manufacturing an eligible agent or safe replay rule',()=>{
  const value={...fixture(),eligibility_rules:[],replay_safety_rules:[]};expect(valid(value)).toBe(true);expect(value.eligibility_rules).toEqual([]);expect(value.replay_safety_rules).toEqual([]);
 });
});
