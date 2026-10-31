import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import example from '../../examples/config/deployment.example.json';
import {parseDeployment} from '../../src/config/deployment';
import {canonicalJson} from '../../src/config/bootstrap';
import * as contracts from '../../src/approvals/contracts';
describe('inactive policy source boundaries',()=>{
 it('preserves absent-policy canonical example bytes and digest exactly',()=>{
  const parsed=parseDeployment(example),canonical=canonicalJson(parsed);
  expect(canonical).toBe(canonicalJson(example));expect(new TextEncoder().encode(canonical).byteLength).toBe(1813);
  expect(createHash('sha256').update(canonical).digest('hex')).toBe('7073eb94446b8bf8f49ce0c37b5b3adcf840d96594d345f241df2408b6260091');
  expect(Object.hasOwn(parsed.workspace_policies[0],'decision_policy')).toBe(false);
 });
 it('never substitutes numeric artifact version for the native string generation identity',()=>{
  const a={artifactId:'a',generationId:'native_generation_a',artifactVersion:3,sha256:'a'.repeat(64),byteLength:5,associations:[{kind:'task',id:'task_a'}]};
  expect(contracts.sameNativeArtifactBinding(a,structuredClone(a))).toBe(true);
  expect(contracts.sameNativeArtifactBinding(a,{...a,generationId:'native_generation_b'})).toBe(false);
  expect(contracts.sameNativeArtifactBinding(a,{...a,generationId:3} as never)).toBe(false);
  expect(contracts.sameNativeArtifactBinding(a,{...a,artifactVersion:4})).toBe(false);
  expect(contracts.sameNativeArtifactBinding(a,{...a,associations:[{kind:'task',id:'task_b'}]})).toBe(false);
 });
 it('production bundle has no test registry, test descriptor, or configurable registry entrypoint',async()=>{
  for(const [entry,exports] of [['src/approvals/policy.ts',['lookupPolicyRequirements']],['src/approvals/input-binding.ts',['recheckProposalInput','verifyProposalInput']]] as const){
   const result=await build({entryPoints:[entry],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:'es2023'});
   expect(Object.keys(result.metafile!.inputs).some(path=>path.startsWith('test/')||path.includes('fixtures'))).toBe(false);
   const source=result.outputFiles[0].text;
   expect(source).not.toContain('synthetic.task-review');expect(source).not.toContain('ExampleApprovalInputs');
   expect(result.metafile!.outputs[Object.keys(result.metafile!.outputs)[0]].exports).toEqual(exports);
  }
  expect(contracts.availableDecisionActions()).toEqual([]);
 });
});

it('scope_target_ID_boundary_is_not_narrowed_by_artifact_role_serialization_limits',async()=>{
 const {proposalSnapshot}=await import('../../src/approvals/policy-source');
 const ids=Array.from({length:64},(_,index)=>String(index).padStart(3,'0')+'x'.repeat(125));
 expect(new TextEncoder().encode(JSON.stringify(ids)).byteLength).toBe(8385);
 const proposal={summary:'Synthetic boundary only',action:'inactive-action',scope:{project_id:null,resource_ids:ids},artifact_ids:[],inputs:{artifact_id:'input_a',sha256:'a'.repeat(64)}};
 const snapshot=proposalSnapshot(proposal);expect(snapshot).toEqual(proposal);expect(snapshot).not.toBe(proposal);
 expect(()=>proposalSnapshot({...proposal,scope:{project_id:null,resource_ids:[...ids,'extra']}})).toThrow('DECISION_UNAVAILABLE');
 expect(()=>proposalSnapshot({...proposal,scope:{project_id:null,resource_ids:['x'.repeat(129)]}})).toThrow('DECISION_UNAVAILABLE');
});
