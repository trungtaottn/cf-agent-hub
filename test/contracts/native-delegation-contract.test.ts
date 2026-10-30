import schema from '../../spec/deployment-config.schema.json';
import {it,expect} from 'vitest';
import example from '../../examples/config/deployment.example.json';
import {parseDeployment} from '../../src/config/deployment';
const input=(value:unknown)=>{const c=structuredClone(example);Object.assign(c.human_grants[0],{delegable_native_scopes:value});return c;};
it('explicit native delegation is independent of executable human scope and exact empty is preserved',()=>{
 for(const list of [[],['runtimes:manage','messages:ack','tasks:claim','tasks:execute']]){
  const c=input(list),result=parseDeployment(c);expect(result.human_grants[0]).toMatchObject({delegable_native_scopes:list});expect(result.human_grants[0].scopes).toEqual(example.human_grants[0].scopes);
 }
 const result=parseDeployment(structuredClone(example));expect(result.human_grants[0]).not.toHaveProperty('delegable_native_scopes');
});
for(const value of [null,['*'],['future:scope'],['credentials:manage'],['agents:manage'],['approvals:decide'],['messages:review'],['runtimes:manage','runtimes:manage'],new Array(1001).fill('messages:read')])it('invalid delegation fails closed: '+JSON.stringify(value).slice(0,70),()=>{expect(()=>parseDeployment(input(value))).toThrow('INVALID_CONFIGURATION');});

it('delegable scope enum remains exactly the canonical native allowlist',()=>{expect(schema.properties.human_grants.items.properties.delegable_native_scopes.items.enum).toEqual(schema.properties.static_credential_refs.items.properties.scopes.items.enum);});
