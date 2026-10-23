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
