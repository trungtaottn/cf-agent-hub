import { describe, it, expect } from 'vitest';
import example from '../../examples/config/deployment.example.json';
import negatives from '../../examples/http/r1-contract-negative.json';
import { parseDeployment, resolveWorkspace } from '../../src/config/deployment';
describe('deployment catalog', () => {
 it('rename_does_not_change_object', () => {
  const config=structuredClone(example), before=resolveWorkspace(parseDeployment(config),'ws_example');
  config.static_participants[0].display_name='Renamed participant';
  expect(resolveWorkspace(parseDeployment(config),'ws_example')).toEqual(before);
 });
 it('duplicate_mapping_denied', () => {
  const c=structuredClone(example);c.workspace_catalog.push({workspace_id:'ws_other',object_name:c.workspace_catalog[0].object_name});
  expect(()=>parseDeployment(c)).toThrow();
 });
 it('unknown_workspace_no_object_lookup', () => { expect(()=>resolveWorkspace(parseDeployment(example),'ws_unknown')).toThrow('UNKNOWN_WORKSPACE'); });
 it('consumes the closed deployment schema and exact endpoint boundary', () => {
  for(const item of negatives.cases.filter(x=>x.schema==='spec/deployment-config.schema.json'&&!x.context&&x.field!=='static_credential_refs.expires_at')) expect(()=>parseDeployment(item.value)).toThrow();
 });
 it('does not normalize signed inputs or invent endpoint pins', () => {
  for(const value of ['https://identity.example.invalid:443/token','https://127.0.0.1/token','https://metadata.internal/token','https://identity.example.invalid/token?x=1']) {
   const c=structuredClone(example);c.authentication.reviewed_oidc_endpoints.token_endpoint=value;expect(()=>parseDeployment(c)).toThrow();
  }
  expect(()=>parseDeployment({...example,extra:true})).toThrow();
 });
});

describe('inactive structural decision policy installation',()=>{
 const policy={policy_version:1,expiry_seconds:120,expiry_batch_limit:2,actions:[{action_id:'inactive.synthetic',schema_version:1,schema_sha256:'a'.repeat(64),reviewer_ids:['synthetic_reviewer'],resource_kinds:['task']}]};
 it('accepts structurally valid inactive selections without registering any action',()=>{
  const c=structuredClone(example);Object.assign(c.workspace_policies[0],{decision_policy:policy});
  expect(parseDeployment(c).workspace_policies[0]).toHaveProperty('decision_policy',policy);
 });
 it('recognizes existing approval scopes only on human grants',()=>{
  const c=structuredClone(example);Object.assign(c.human_grants[0],{scopes:['approvals:read','approvals:decide']});
  expect(parseDeployment(c).human_grants[0].scopes).toEqual(['approvals:read','approvals:decide']);
  for(const scope of ['approvals:read','approvals:decide']){
   const native=structuredClone(example);Object.assign(native.static_credential_refs[0],{scopes:[scope]});expect(()=>parseDeployment(native)).toThrow();
   const delegated=structuredClone(example);Object.assign(delegated.human_grants[0],{delegable_native_scopes:[scope]});expect(()=>parseDeployment(delegated)).toThrow();
  }
 });
 it('rejects malformed structural policies but does not require a known descriptor',()=>{
  for(const patch of [{expiry_seconds:undefined},{extra:true},{actions:[{...policy.actions[0],schema_sha256:'A'.repeat(64)}]},{actions:[policy.actions[0],policy.actions[0]]}]){
   const c=structuredClone(example);Object.assign(c.workspace_policies[0],{decision_policy:{...policy,...patch}});expect(()=>parseDeployment(c)).toThrow();
  }
 });
});
