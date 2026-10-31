/** Real isolated workerd/controller; synthetic host signature/bootstrap identity only.
 * This does not spawn the protected CLI or establish installed authority. */
import test from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {fixture as signedFixture} from '../native-r2/complete-service-values.mjs';
import {fixture as preparationFixture,sha} from '../native-r2/complete-preparation-values.mjs';
import {createCompleteServiceCore} from '../../scripts/lib/native-complete-service.mjs';
import {completePolicyDigest} from '../../scripts/lib/native-complete-protocol.mjs';

test('real isolated service binds and observes authorization through the private controller',async()=>{
 const directory=await mkdtemp(join(process.cwd(),'.complete-service-test-'));let local,service;
 try{
  const outfile=join(directory,'fixture.mjs');await build({entryPoints:[join(process.cwd(),'test/helpers/native-complete/local-fixture.ts')],outfile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
  local=await(await import(pathToFileURL(outfile).href)).createLocalCompleteFixture();
  assert.equal(local.profile,'native-r2-required-schema17-v1');
  const p=preparationFixture({expected:local.expected,credentialExpiry:local.credentialExpiry},local.profile);
  const initialGrantSha256=Object.fromEntries(p.input.fixtureContext.initial_grants.map(g=>[g.role,g.sha256]));
  const f=signedFixture(local.profile,{...local,initialGrantSha256});assert.equal(f.v.installation.payload.fixture_sha256,local.fixture_sha256);assert.equal(f.v.installation.payload.family_ledger_sha256,local.family_ledger_sha256);service=createCompleteServiceCore(f.input);let sequence=0;
  const send=async(operation,payload)=>{const r={...f.v.request,sequence:++sequence,request_id:'real_source_'+sequence,operation,payload};const result=await service.handle(f.wire(r));assert.equal(result.status,200);return JSON.parse(result.body);};
  assert.equal((await send('preflight',f.v.request.payload)).data.status,'ready');
  assert.equal((await send('bind-run',{policy_sha256:completePolicyDigest(f.v.policy)})).data.status,'bound');
  const slot={kind:'control',id:'control/authorize'},preparation={kind:'control',step_id:slot.id,actor_slot:'submitter',fixture:'primary',prior_bindings_sha256:sha({}),authorization_record_sha256:f.v.policy.run_context.authorityRecordSha256,payload:{run_context_sha256:sha(f.v.policy.run_context),coverage_sha256:sha(f.v.policy.coverage),installation_descriptor_sha256:f.v.policy.descriptor_sha256}};
  assert.equal((await send('prepare-slot',{slot,preparation})).data.status,'prepared');
  const observed=await send('execute-control',{slot,preparation_sha256:sha(preparation)});
  assert.equal(observed.type,'native-complete-original');
  assert.equal((await send('observe-slot',{slot,preparation_sha256:sha(preparation)})).data.manifest.typed_observation_ref,null);
  const provisionSlot={kind:'control',id:'control/provision'},provision={kind:'control',step_id:provisionSlot.id,actor_slot:'submitter',fixture:'primary',prior_bindings_sha256:sha({}),authorization_record_sha256:f.v.policy.run_context.authorityRecordSha256,payload:{fixture_plan_sha256:p.selected.commitments.fixture_sha256,actors_sha256:f.v.policy.actors_sha256,workspaces_sha256:f.v.policy.workspaces_sha256,fixture_stores_sha256:f.v.policy.fixture_stores_sha256,artifact_source_plan_sha256:sha(p.input.bootstrapPlan.artifact)}};
  await send('prepare-slot',{slot:provisionSlot,preparation:provision});
  const provisioned=await send('execute-control',{slot:provisionSlot,preparation_sha256:sha(provision),private_inputs:{credentials:['S','R','X'].map(role=>({role,token:local.credentials[role]})),human:local.human}});
  assert.equal(provisioned.type,'native-complete-original');
  const read=await send('observe-slot',{slot:provisionSlot,preparation_sha256:sha(provision)});assert.equal(read.data.manifest.records[0].family,'control-acknowledgment');
  // This deliberately bounded smoke is not a completed schedule. Poison an
  // out-of-window ingress and exercise the existing failure cleanup allowance.
  await assert.rejects(service.forwardApplication(new Request(local.expected.origin+'/v2/workspaces/'+local.expected.workspaces.primary.id)),/REJECTED/);
  assert.equal((await send('close-run',{})).data.status,'closed');
 }finally{if(local)assert.equal((await local.close()).status,'closed');await rm(directory,{recursive:true,force:true});}
});
