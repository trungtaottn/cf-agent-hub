import {it,expect} from 'vitest';
import example from '../../examples/config/deployment.example.json';
import {parseDeployment} from '../../src/config/deployment';
const policy={policy_version:1,agent_wip_limit:1,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
it('canonical operator policy carrier accepts explicit policy and preserves legacy omission',()=>{
 const config=structuredClone(example);Object.assign(config.workspace_policies[0],{execution_policy:policy});
 expect(parseDeployment(config).workspace_policies[0]).toMatchObject({execution_policy:policy});
 expect(parseDeployment(example).workspace_policies[0]).not.toHaveProperty('execution_policy');
});
import {validateExecutionPolicy} from '../../src/config/execution-policy';
it('closed policy rejects omitted required bounds, authority extras and unsafe integers',()=>{
 for(const key of ['policy_version','agent_wip_limit','task_retry_limit','artifact_upload_ttl_seconds','eligibility_rules','replay_safety_rules']){const value:Record<string,unknown>={...policy};delete value[key];expect(()=>validateExecutionPolicy(value)).toThrow();}
 for(const patch of [{agent_wip_limit:0},{agent_wip_limit:101},{task_retry_limit:-1},{task_retry_limit:11},{artifact_upload_ttl_seconds:59},{artifact_upload_ttl_seconds:3601},{policy_version:1.5},{policy_version:Number.MAX_SAFE_INTEGER+1},{unlimited:true}])expect(()=>validateExecutionPolicy({...policy,...patch})).toThrow();
 expect(validateExecutionPolicy({...policy,task_retry_limit:0})).toMatchObject({task_retry_limit:0});
});
it('exact nullable tuples reject duplicates and conflicting replay evidence without wildcard matching',()=>{
 const replay={id:'reviewed',project_id:null,work_role_id:null,classification:'replay_safe',evidence_ref:'urn:reviewed:evidence'};
 const invalids=[{...policy,eligibility_rules:[policy.eligibility_rules[0],policy.eligibility_rules[0]]},{...policy,eligibility_rules:[{...policy.eligibility_rules[0],eligible_agent_ids:['agent_research','agent_research']}]},{...policy,replay_safety_rules:[replay,{...replay,id:'other'}]},{...policy,replay_safety_rules:[replay,{...replay,project_id:'project_other'}]},{...policy,replay_safety_rules:[{...replay,evidence_ref:''}]}];
 for(const invalid of invalids){expect(()=>validateExecutionPolicy(invalid)).toThrow();const config=structuredClone(example);Object.assign(config.workspace_policies[0],{execution_policy:invalid});expect(()=>parseDeployment(config)).toThrow();}
 expect(validateExecutionPolicy({...policy,eligibility_rules:[...policy.eligibility_rules,{project_id:'project_a',work_role_id:null,eligible_agent_ids:[]}],replay_safety_rules:[replay]}).eligibility_rules).toHaveLength(2);
 const valid=validateExecutionPolicy(policy);valid.eligibility_rules[0].eligible_agent_ids.length=0;expect(policy.eligibility_rules[0].eligible_agent_ids).toHaveLength(1);
});
