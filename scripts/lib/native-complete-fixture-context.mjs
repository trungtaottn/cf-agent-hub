/** Pure fixed-fixture content derivation. A lookalike statement/material object
 * is not authenticated custody: actual factory guards and current SQL/auth remain
 * mandatory. Stable initial G identity is deliberately not current revoked G. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {selectCompleteProfile} from './native-profile-selection.mjs';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {validateCompleteConfig} from './native-complete-config.mjs';
import {parseCompleteFixtureInputs,parseCompleteCredential,parseCompleteHuman,COMPLETE_FIXTURE_INPUT_LIMIT} from './native-complete-installed-inputs.mjs';
import {buildCompletePolicyFromStatement} from './native-complete-policy-bootstrap.mjs';
import {snapshotCompleteValue as snapshot,freezeCompleteValue as freeze,completeKeys as keys} from './native-complete-protocol.mjs';

const hash=v=>createHash('sha256').update(v).digest('hex');
const check=v=>{if(!v)throw Error('NATIVE_COMPLETE_FIXTURE_CONTEXT_REJECTED');};
function args(v){check(v&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype);const names=['config','inputs','credentials','human','installation','runId'],d=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(d).length===names.length);return Object.fromEntries(names.map(k=>{check(d[k]?.enumerable&&Object.hasOwn(d[k],'value'));return[k,d[k].value];}));}
export function deriveCompleteFixtureContext(input){try{
 const a=args(input),config=validateCompleteConfig(a.config),fixture=selectCompleteProfile(config.profile).profile.fixture,installation=snapshot(a.installation,16384);
 buildCompletePolicyFromStatement({config,installation,runId:a.runId});
 const wire=Buffer.from(canonical(snapshot(a.inputs,COMPLETE_FIXTURE_INPUT_LIMIT)));
 check(hash(wire)===installation.payload.private_inputs_sha256);
 const inputs=parseCompleteFixtureInputs({wire,config,authRef:installation.payload.auth_ref}),f=inputs.fixture_facts;
 const credentials=snapshot(a.credentials,1024);check(Array.isArray(credentials)&&credentials.length===3);
 const actors={},seen=new Set();
 for(const [i,role]of ['S','R','X'].entries()){
  const c=credentials[i];keys(c,'role token sha256');check(c.role===role&&typeof c.token==='string');
  const token=parseCompleteCredential(Buffer.from(c.token)),tokenHash=hash(token);check(tokenHash===c.sha256&&!seen.has(tokenHash));seen.add(tokenHash);
  actors[role]={agent_id:inputs.credentials[i].agent_id,credential_id:inputs.credentials[i].credential_id,token_sha256:tokenHash};
 }
 const human=parseCompleteHuman(Buffer.from(canonical(snapshot(a.human,123))));
 check(!Object.values(actors).some(actor=>actor.agent_id===inputs.human.principal_id));
 const workspaces={};for(const [i,role]of ['primary','foreign'].entries()){const w=f.workspaces[i];workspaces[role]={id:config.workspaces[role],object_name:w.object_name,installation_sha256:w.installation_sha256,generation:w.generation};}
 const expected={role:'primary',epoch:f.config_epoch,config_sha256:f.config_sha256,origin:config.origin,audience:f.audience,workspaces,actors,human:{principal_id:inputs.human.principal_id,issuer:f.human.issuer,subject:f.human.subject,session_id:inputs.human.session_id,
  // Product SE commits the opaque cookie value, never the Cookie header prefix.
  token_sha256:hash(human.session_cookie),csrf_sha256:hash(human.csrf_token)}};
 const initial_grants=['S','R','X'].map((role,i)=>{
  const actor=actors[role],fact=f.credentials[i];
  const row={workspace_id:inputs.credentials[i].workspace_id,credential_id:actor.credential_id,agent_id:actor.agent_id,credential_version:fact.credential_version,token_sha256:actor.token_sha256,
   scopes_json:canonical(fixture.configuration_constraints.native_scopes[role]),project_ids_json:'null',enabled:1,expires_at:fact.expires_at,config_epoch:f.config_epoch,retired_at_epoch:null,revoked_at:null,origin:'operator_static',agent_status:'active',agent_origin:'operator_static',agent_epoch:f.config_epoch};
  return {role,row,sha256:hash(canonical(row))};
 });
 const p=installation.payload;check(/^[a-z0-9][a-z0-9_-]{0,127}$/.test(p.environment_id));
 // These are the missing fixed additions, NOT a complete recorder context.
 const observation_context={config_epoch:f.config_epoch,observer_id:p.service_id,environment_id:p.environment_id};
 return freeze({scope:'source-derived-fixture-context',installedAuthority:false,native_conformance:false,expected,initial_grants,observation_context});
 }catch{throw Error('NATIVE_COMPLETE_FIXTURE_CONTEXT_REJECTED');}}
