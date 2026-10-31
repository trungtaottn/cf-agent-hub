import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
const read=(path:string)=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url),'utf8'));
const human=['workspace:read','messages:send','messages:read','messages:review','events:read','profile:edit','operations:read','tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:review','tasks:cancel','agents:read','agents:manage','credentials:manage','artifacts:read','artifacts:write','search:read','imports:manage','approvals:read','approvals:decide'];
const native=['workspace:read','messages:send','messages:read','messages:ack','events:read','tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:claim','tasks:execute','tasks:review','tasks:cancel','agents:read','runtimes:manage','artifacts:read','artifacts:write','search:read'];
const humanOnly=['approvals:decide','credentials:manage','agents:manage','messages:review','profile:edit','operations:read','imports:manage'];
function validateScope(lane:'human_grants'|'static_credential_refs',scope:unknown){
 const schema=read('spec/deployment-config.schema.json').properties[lane].items.properties.scopes;
 return new Ajv2020({strict:false}).compile(schema)([scope]);
}
describe('R2/R3 scope recognition is a closed operator contract, not route enablement or a grant',()=>{
 it('recognizes imports management in canonical public scopes',()=>expect(read('spec/openapi.json').components.schemas.Scope.enum).toContain('imports:manage'));
 it('lists exact human lanes including inactive R3 approval recognition, without native runtime authority',()=>expect(read('spec/deployment-config.schema.json').properties.human_grants.items.properties.scopes.items.enum).toEqual(human));
 it('lists exact native R2 lanes without human-only authority',()=>expect(read('spec/deployment-config.schema.json').properties.static_credential_refs.items.properties.scopes.items.enum).toEqual(native));
 for(const scope of human)it('accepts explicit human '+scope,()=>expect(validateScope('human_grants',scope)).toBe(true));
 for(const scope of native)it('accepts explicit native '+scope,()=>expect(validateScope('static_credential_refs',scope)).toBe(true));
 for(const scope of humanOnly)it('rejects native '+scope,()=>{
  expect(validateScope('static_credential_refs',scope)).toBe(false);
  expect(read('spec/openapi.json').components.schemas.CredentialCreateRequest['x-native-disallowed-scopes']).toContain(scope);
 });
 for(const scope of ['tasks:claim','tasks:execute','runtimes:manage','messages:ack','*','future:scope',null,1])it('rejects unavailable human lane '+scope,()=>expect(validateScope('human_grants',scope)).toBe(false));
 for(const scope of ['approvals:read','*','future:scope',null,1])it('rejects unavailable native lane '+scope,()=>expect(validateScope('static_credential_refs',scope)).toBe(false));
});

// Exercise the generated validator through the same parser used by provisioning,
// not only a hand-picked schema subtree. No configuration is installed here.
import {parseDeployment} from '../../src/config/deployment.js';
describe('generated deployment parser recognizes explicit R2 grants only',()=>{
 for(const [lane,scope]of [['human_grants','imports:manage'],['static_credential_refs','tasks:claim']]as const)
  it('accepts explicit '+lane+' '+scope,()=>{
   const config=read('examples/config/deployment.example.json');config[lane][0].scopes=[scope];
   expect(parseDeployment(config)[lane][0].scopes).toEqual([scope]);
  });
 for(const scope of humanOnly)it('rejects native human-only '+scope+' through real parser',()=>{
  const config=read('examples/config/deployment.example.json');config.static_credential_refs[0].scopes=[scope];
  expect(()=>parseDeployment(config)).toThrow('INVALID_CONFIGURATION');
 });
 it('does not add newly recognized scopes to an existing operator fixture',()=>{
  const config=read('examples/config/deployment.example.json'),before=structuredClone(config);
  const parsed=parseDeployment(config);expect(parsed).toEqual(before);expect(config).toEqual(before);
 });
});
