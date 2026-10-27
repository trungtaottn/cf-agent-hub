import {describe,expect,it} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const verifier=()=>require('../../scripts/verify-r2-policy-contract.mjs');
const executionPolicyIssues=(value:unknown):string[]=>verifier().executionPolicyIssues(value);
const run=()=>verifier().run();

const policy=()=>({policy_version:1,agent_wip_limit:1,task_retry_limit:2,artifact_upload_ttl_seconds:900,
 eligibility_rules:[{project_id:null as string|null,work_role_id:null as string|null,eligible_agent_ids:['agent_a']}],
 replay_safety_rules:[{id:'rule_a',project_id:null as string|null,work_role_id:null as string|null,classification:'replay_safe',evidence_ref:'review-a'}]});
describe('R2 execution policy static semantic contract',()=>{
 it('accepts the closed explicit fixture and standalone verifier',()=>{expect(executionPolicyIssues(policy())).toEqual([]);expect(()=>run()).not.toThrow();});
 it('rejects absent policy instead of allowing unlimited operation',()=>expect(executionPolicyIssues(undefined)).toContain('invalid_shape'));
 it('rejects duplicate eligibility tuples even with different allowed agents',()=>{
  const value=policy();value.eligibility_rules.push({...value.eligibility_rules[0],eligible_agent_ids:['agent_b']});expect(executionPolicyIssues(value)).toContain('duplicate_eligibility_tuple');
 });
 it('rejects duplicate replay rule identity across different tuples',()=>{
  const value=policy();value.replay_safety_rules.push({...value.replay_safety_rules[0],project_id:'p_a'});expect(executionPolicyIssues(value)).toContain('duplicate_replay_id');
 });
 it('rejects multiple matching replay rules even when their evidence differs',()=>{
  const value=policy();value.replay_safety_rules.push({...value.replay_safety_rules[0],id:'rule_b',evidence_ref:'review-b'});expect(executionPolicyIssues(value)).toContain('conflicting_replay_tuple');
 });
 it('rejects exact duplicate replay rules too',()=>{
  const value=policy();value.replay_safety_rules.push({...value.replay_safety_rules[0]});expect(executionPolicyIssues(value)).toContain('conflicting_replay_tuple');
 });
 it('does not treat null project or role as a wildcard when checking conflicts',()=>{
  const value=policy();value.eligibility_rules.push({...value.eligibility_rules[0],project_id:'p_a'},{...value.eligibility_rules[0],work_role_id:'role_a'});
  value.replay_safety_rules.push({...value.replay_safety_rules[0],id:'rule_b',project_id:'p_a'});expect(executionPolicyIssues(value)).toEqual([]);
 });
 it('keeps string null distinct from null and delimiter-like identifiers unambiguous',()=>{
  const value=policy();value.eligibility_rules.push({project_id:'null',work_role_id:null,eligible_agent_ids:['agent_a']},{project_id:'a,b',work_role_id:'c',eligible_agent_ids:['agent_a']},{project_id:'a',work_role_id:'b,c',eligible_agent_ids:['agent_a']});expect(executionPolicyIssues(value)).toEqual([]);
 });
 it('rejects malformed nested policy before attempting semantic traversal',()=>expect(executionPolicyIssues({...policy(),eligibility_rules:[null]})).toContain('invalid_shape'));
 it('does not mutate input or manufacture a replay-safe match from an empty ruleset',()=>{
  const value={...policy(),replay_safety_rules:[]},before=structuredClone(value);expect(executionPolicyIssues(value)).toEqual([]);expect(value).toEqual(before);
 });
 for(const value of [NaN,Infinity,-Infinity])it(`rejects non-finite numeric policy ${value}`,()=>expect(executionPolicyIssues({...policy(),agent_wip_limit:value})).toContain('invalid_shape'));
});
