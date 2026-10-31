import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import validExample from '../../examples/decisions/policy-valid.json';
import invalidExample from '../fixtures/decisions/policy-invalid.json';
import deployment from '../../examples/config/deployment.example.json';
import {parseDeployment} from '../../src/config/deployment';
import * as api from '../../src/approvals/contracts';
const policy={policy_version:1,expiry_seconds:120,expiry_batch_limit:2,actions:[{action_id:'synthetic.test',schema_version:1,schema_sha256:'a'.repeat(64),reviewer_ids:['human.one@example.invalid'],resource_kinds:['synthetic']} ]};
const binding={workspaceId:'ws',taskId:'task',approvalId:'approval',proposalVersion:2,approvalVersion:1,taskVersionAtApproval:4,retryCountAtApproval:0,originalExpiresAt:1000,actionId:'synthetic.test',schemaVersion:1,schemaSha256:'a'.repeat(64),inputArtifactId:'input',inputGeneration:1,inputSha256:'b'.repeat(64),policyVersion:1,policyEpoch:3,targetVersions:[{kind:'synthetic',id:'target',version:5}]};
function observation(){return {approved:structuredClone(binding),current:structuredClone(binding),approvalStatus:'approved' as const,expiresAt:1000,nowMs:999,expectedTaskVersion:6,currentTaskVersion:6,currentApprovalVersion:1,currentProposalVersion:2,retryCount:1,retryLimit:2,activeRunId:null,nextRunId:'run2',nextFence:2,priorAttempts:[{runId:'run1',fence:1,taskVersionBeforeClaim:4,taskVersionAfterClaim:5,taskVersionAfterEnd:6,status:'failed' as const,effect:'no-effect' as const,evidence:{kind:'authoritative-no-dispatch' as const,reference:'synthetic-fixture-only',binding:structuredClone(binding),runId:'run1',fence:1,complete:true as const}}]};}
describe('closed decision contract, not installed authority',()=>{
 it('validates explicit closed policy but never enables synthetic configured actions',()=>{
  expect(api.parseDecisionPolicy(policy)).toEqual(policy);expect(api.parseDecisionPolicy(validExample).actions).toEqual([]);expect(()=>api.parseDecisionPolicy(invalidExample)).toThrow();
  expect(api.availableDecisionActions()).toEqual([]);
  expect(()=>api.resolveConfiguredAction(policy,'synthetic.test')).toThrow('DECISION_UNAVAILABLE');
 });
 it('rejects missing bounds, extras, duplicate identities and unknown empty reviewers',()=>{
  for(const key of Object.keys(policy)){const p:Record<string,unknown>={...policy};delete p[key];expect(()=>api.parseDecisionPolicy(p)).toThrow();}
  for(const patch of [{expiry_seconds:0},{expiry_seconds:Number.MAX_SAFE_INTEGER+1},{expiry_batch_limit:201},{actions:[{...policy.actions[0],reviewer_ids:['same','same']}]},{actions:[{...policy.actions[0],resource_kinds:['same','same']}]} ,{unlimited:true},{actions:[policy.actions[0],policy.actions[0]]},{actions:[{...policy.actions[0],reviewer_ids:[]}]},{actions:[{...policy.actions[0],schema_sha256:'A'.repeat(64)}]}])expect(()=>api.parseDecisionPolicy({...policy,...patch})).toThrow();
 });
 it('returns detached policy data and accepts inactive structural deployment configuration',()=>{
  const copy=api.parseDecisionPolicy(policy);copy.actions[0].reviewer_ids.length=0;expect(policy.actions[0].reviewer_ids).toHaveLength(1);
  const candidate=structuredClone(deployment);Object.assign(candidate.workspace_policies[0],{decision_policy:validExample});expect(parseDeployment(candidate).workspace_policies[0].decision_policy).toEqual(validExample);
 });
 it('models bounded reuse with immutable bindings and legitimate lifecycle increments only',()=>{
  expect(api.reuseDenials(observation())).toEqual([]); // synthetic obligation satisfaction, NOT authority
  for(const patch of [{nowMs:1000},{nowMs:1001},{nowMs:NaN},{nowMs:-1},{expiresAt:Infinity},{expiresAt:2000},{expectedTaskVersion:4},{currentTaskVersion:7},{currentApprovalVersion:2},{currentProposalVersion:3},{activeRunId:'run1'},{nextRunId:'run1'},{nextFence:1},{retryCount:0},{retryLimit:0},{priorAttempts:[]}])expect(api.reuseDenials({...observation(),...patch} as never).length).toBeGreaterThan(0);
 });
 it('never equates replay-safe fields or a runtime false uncertainty flag with no-effect proof',()=>{
  const o=observation();o.priorAttempts[0].evidence=null as never;
  expect(api.reuseDenials(Object.assign(o,{outcome_unknown:false,replay_policy_version:1,replay_rule_id:'safe',replay_evidence_ref:'present'}))).toContain('NO_EFFECT_UNPROVEN');
 });
 it('rejects every changed immutable authority binding',()=>{
  for(const key of Object.keys(binding)){const o=observation();(o.current as Record<string,unknown>)[key]=typeof (binding as Record<string,unknown>)[key]==='number'?99:'changed';expect(api.reuseDenials(o as never)).toContain('BINDING_CHANGED');}
 });
 it('rejects wrong or partial no-effect evidence and arbitrary version drift',()=>{
  for(const mutate of [(o:ReturnType<typeof observation>)=>o.priorAttempts[0].evidence.runId='other',(o:ReturnType<typeof observation>)=>o.priorAttempts[0].evidence.fence=9,(o:ReturnType<typeof observation>)=>o.priorAttempts[0].evidence.complete=false as never,(o:ReturnType<typeof observation>)=>o.priorAttempts[0].evidence.binding.inputSha256='c'.repeat(64),(o:ReturnType<typeof observation>)=>o.priorAttempts[0].taskVersionAfterClaim=6,(o:ReturnType<typeof observation>)=>o.priorAttempts[0].effect='effected' as never]){const o=observation();mutate(o);expect(api.reuseDenials(o).length).toBeGreaterThan(0);}
 });
 it('binds every prior no-effect observation to exact policy/action/target provenance',()=>{
  for(const key of ['policyEpoch','actionId','schemaVersion','schemaSha256','targetVersions']){const o=observation();(o.priorAttempts[0].evidence.binding as Record<string,unknown>)[key]='changed';expect(api.reuseDenials(o)).toContain('NO_EFFECT_UNPROVEN');}
 });
 it('later no-effect cannot erase an earlier uncertain attempt',()=>{
  const o=observation(),second=structuredClone(o.priorAttempts[0]);second.runId='run2';second.fence=2;second.taskVersionBeforeClaim=6;second.taskVersionAfterClaim=7;second.taskVersionAfterEnd=8;second.evidence.runId='run2';second.evidence.fence=2;o.priorAttempts.push(second);o.currentTaskVersion=o.expectedTaskVersion=8;o.retryCount=2;o.nextRunId='run3';o.nextFence=3;expect(api.reuseDenials(o)).toEqual([]);o.priorAttempts[0].effect='unknown' as never;expect(api.reuseDenials(o)).toContain('NO_EFFECT_UNPROVEN');
 });
 it('preserves prior task retry budget without resetting it at approval',()=>{
  const o=observation();o.approved.retryCountAtApproval=o.current.retryCountAtApproval=o.priorAttempts[0].evidence.binding.retryCountAtApproval=1;o.retryCount=2;expect(api.reuseDenials(o)).toEqual([]);o.retryCount=1;expect(api.reuseDenials(o)).toContain('RETRY_BUDGET');
 });
 it('hashes exact immutable input bytes and rejects wrong MIME before content inspection',async()=>{
  const a=new TextEncoder().encode('{"n":1}'),b=new TextEncoder().encode('{ "n" : 1 }');
  const pending=api.inspectProposalBytes(a,'application/json');a.fill(0);const x=await pending,y=await api.inspectProposalBytes(b,'application/json');
  expect(x.sha256).toBe(createHash('sha256').update('{"n":1}').digest('hex'));expect(y.sha256).toBe(createHash('sha256').update(b).digest('hex'));expect(x.value).toEqual(y.value);expect(x.sha256).not.toBe(y.sha256);expect(x.byteLength).toBe(7);expect(Object.isFrozen(x.value)).toBe(true);
  await expect(api.inspectProposalBytes(b,'text/plain')).rejects.toThrow('INVALID_PROPOSAL_MIME');
 });
 it('derives finite expiry without default, overflow or renewal',()=>{
  expect(api.decisionExpiry(1000,2)).toBe(3000);for(const pair of [[0,0],[-1,1],[NaN,1],[0,Infinity],[8640000000000000,1]])expect(()=>api.decisionExpiry(pair[0],pair[1])).toThrow();
 });
 it('accounts distinct retained artifact IDs once while preserving per-list and union caps',()=>{
  const a={id:'one',bytes:10,sha256:'a'.repeat(64),generation:1};
  expect(api.accountDecisionArtifacts([a],[a],a)).toEqual({distinctCount:1,totalBytes:10});
  expect(()=>api.accountDecisionArtifacts([a,a],[],a)).toThrow();
  expect(()=>api.accountDecisionArtifacts([a],[{...a,bytes:11}],a)).toThrow();
  expect(()=>api.accountDecisionArtifacts(Array.from({length:5},(_,i)=>({...a,id:'a'+i})),[],{...a,id:'six'})).toThrow();
  expect(()=>api.accountDecisionArtifacts([{...a,bytes:10485761}],[],a)).toThrow();
  const x={...a,id:'x',bytes:10485760},y={...a,id:'y',bytes:10485760},z={...a,id:'z',bytes:5242880};expect(api.accountDecisionArtifacts([x,y],[],z).totalBytes).toBe(26214400);expect(()=>api.accountDecisionArtifacts([x,y],[],{...z,bytes:z.bytes+1})).toThrow();
 });
});
