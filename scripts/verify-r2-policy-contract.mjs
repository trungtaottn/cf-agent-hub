import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const readJson=relative=>JSON.parse(readFileSync(new URL('../'+relative,import.meta.url),'utf8'));
const validate=new Ajv2020({strict:true,allErrors:true}).compile(readJson('spec/execution-policy.schema.json'));
const tuple=rule=>JSON.stringify([rule.project_id,rule.work_role_id]);

/** Static contract checks only: no current grants, resource lookup or runtime retry authorization. */
export function executionPolicyIssues(policy){
 if(!validate(policy))return ['invalid_shape'];
 const issues=new Set(),eligibility=new Set(),replayIds=new Set(),replayTuples=new Set();
 for(const rule of policy.eligibility_rules){
  const key=tuple(rule);if(eligibility.has(key))issues.add('duplicate_eligibility_tuple');eligibility.add(key);
 }
 for(const rule of policy.replay_safety_rules){
  const key=tuple(rule);
  if(replayIds.has(rule.id))issues.add('duplicate_replay_id');
  if(replayTuples.has(key))issues.add('conflicting_replay_tuple');
  replayIds.add(rule.id);replayTuples.add(key);
 }
 return [...issues];
}

export function run(){
 const fixtures=readJson('examples/http/r2-contracts.json');
 assert.deepEqual(executionPolicyIssues(fixtures.execution_policy),[],'invalid selected execution policy fixture');
 for(const fixture of fixtures.invalid_execution_policies){
  const issues=executionPolicyIssues(fixture.value);
  assert(issues.includes(fixture.expected_code),'missing expected rejection for '+fixture.name);
 }
 return {scope:'static-execution-policy-contract',negative_cases:fixtures.invalid_execution_policies.length};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(run()));}catch(error){console.error(error.message);process.exitCode=1;}
}
