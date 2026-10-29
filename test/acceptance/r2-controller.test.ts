import {describe,it,expect} from 'vitest';
import {verifyR2Release} from '../../scripts/lib/r2-release-verifier.mjs';
import {verifyRelease} from '../../scripts/verify-release.mjs';
describe('R2 controller admission',()=>{
 it('fails closed without crashing on incomplete R2 evidence',()=>{const input={format_version:2,round:'R2'};const result=verifyR2Release(input,{files:new Map()});expect(result.passed).toBe(false);expect(result.findings.some(x=>x.code==='R2_SCHEMA_INVALID')).toBe(true);expect(verifyRelease(input,new Map())).toEqual(result);});
 it('rejects unknown version and round before loading bytes',()=>{const files=new Map();Object.defineProperty(files,'get',{value(){throw Error('must not read');}});for(const input of [{format_version:1,round:'R2'},{format_version:2,round:'R1'},{format_version:3,round:'R2'}])expect(verifyR2Release(input,{files}).passed).toBe(false);});
 it('rejects non-JSON and root oversize inputs safely',()=>{const cyclic:any={};cyclic.x=cyclic;for(const value of [cyclic,undefined,BigInt(1),'x'.repeat(4194305)])expect(verifyR2Release(value,{files:new Map()}).passed).toBe(false);});
});
import {controllerFixture} from './r2-controller-fixtures';
describe('R2 controller candidate composition and command ownership',()=>{
 it('reports real structural checks rather than treating a round label as verification',()=>{const f=controllerFixture();f.root.features.pop();expect(verifyR2Release(f.root,{files:f.files}).findings.some(x=>x.code==='R2_FEATURE_SCOPE')).toBe(true);});
 it('rejects source byte substitution',()=>{const f=controllerFixture();f.files.set('package.json','substitution');expect(verifyR2Release(f.root,{files:f.files}).findings.some(x=>x.code==='R2_SIZE'||x.code==='R2_DIGEST')).toBe(true);});
 it('rejects component role aliasing before payload reads',()=>{const f=controllerFixture();const a=f.root.components.find((x:any)=>x.role==='application-worker'),b=f.root.components.find((x:any)=>x.role==='operator-worker');b.files[0].artifact=a.files[0].artifact;expect(verifyR2Release(f.root,{files:f.files}).findings.some(x=>x.code==='R2_REF_CONFLICT')).toBe(true);});
 it('refuses synthetic command projection as live provenance',()=>{const f=controllerFixture();expect(verifyR2Release(f.root,{files:f.files}).findings.some(x=>x.code==='R2_PROVENANCE')).toBe(true);});
});
it('a complete synthetic graph fails only provenance, never becomes release acceptance',()=>{const f=controllerFixture();const result=verifyR2Release(f.root,{files:f.files});expect(result.passed).toBe(false);expect([...new Set(result.findings.map(x=>x.code))]).toEqual(['R2_PROVENANCE']);});
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {execFileSync} from 'node:child_process';
import {runCli} from '../../scripts/verify-release.mjs';
import {vi} from 'vitest';
it('CLI dispatches R2 to bounded structural verification and preserves candidate gate',()=>{
 const f=controllerFixture(),dir=mkdtempSync(join(tmpdir(),'r2-controller-'));
 const stdout=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
 try{
  for(const [path,bytes]of f.files){mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),bytes);}
  const git=(args:string[])=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
  git(['init','-q']);git(['config','user.name','Synthetic Controller Test']);git(['config','user.email','synthetic@example.invalid']);git(['add',...f.root.files.map((x:any)=>x.path)]);git(['commit','-qm','test: synthetic candidate']);
  const path='validation/releases/synthetic/root.json';writeFileSync(join(dir,path),JSON.stringify(f.root));
  expect(runCli(['--round','R2','--evidence',path],dir)).toBe(1);
  const result=JSON.parse(String(stdout.mock.calls.at(-1)?.[0]));
  expect(result.findings.some((x:any)=>x.code==='R2_PROVENANCE')).toBe(true);
  expect(result.findings.some((x:any)=>x.code==='REVISION_MISMATCH')).toBe(true);
 }finally{stdout.mockRestore();rmSync(dir,{recursive:true,force:true});}
});
import {assertSharedSchemaDialect} from '../../scripts/lib/r2-schema-registry.mjs';
it('rejects silently incompatible future schema keywords and tuple items',()=>{for(const schema of [{type:'array',items:[{type:'string'}]},{type:'object',unevaluatedProperties:false},{type:'string',unknownPolicyKeyword:true}])expect(()=>assertSharedSchemaDialect(schema)).toThrow('R2_SCHEMA_DIALECT');expect(()=>assertSharedSchemaDialect({type:'object',properties:{items:{type:'string'}},additionalProperties:false})).not.toThrow();});
function changeReceipt(f:ReturnType<typeof controllerFixture>,key:string,change:(value:any)=>void){const names:Record<string,string>={result_graph:'result-graph'};const value=f.receipts.get(names[key]??key);change(value);const artifact=f.put(f.root[key].path,value);f.root[key]=artifact;const command=f.commands.get(value.command_id);const result=command?.results.find((x:any)=>x.artifact.path===artifact.path);if(result)result.artifact=artifact;f.refreshCommands();}
describe('cross-artifact controller mutation regressions',()=>{
 const rows:Array<[string,string,(f:ReturnType<typeof controllerFixture>)=>void]>=[
  ['tree digest','R2_TREE_DIGEST',f=>{f.root.tree_sha256='f'.repeat(64);}],
  ['extra source','R2_UNREVIEWED_FILE',f=>{f.files.set('unreviewed.txt','extra');}],
  ['source duplicate','R2_DUPLICATE_SOURCE',f=>{f.root.files.push(f.root.files[0]);}],
  ['lock digest','R2_LOCK_DIGEST',f=>{f.root.toolchain.lock_sha256='f'.repeat(64);}],
  ['component roles','R2_COMPONENT_ROLES',f=>{f.root.components[1].role=f.root.components[0].role;}],
  ['component module names','R2_COMPONENT_INVENTORY',f=>{f.root.components[0].files[0].name='unrecognized.js';}],
  ['component configuration','R2_COMPONENT_CONFIGURATION',f=>{f.root.components[0].configuration_sha256='f'.repeat(64);}],
  ['command root metadata','R2_COMMAND_METADATA',f=>{f.root.commands[0].exit_code=1;}],
  ['command candidate','R2_COMMAND_CANDIDATE',f=>{f.commands.values().next().value!.tree_sha256='f'.repeat(64);f.refreshCommands();}],
  ['command outcome','R2_COMMAND_OUTCOME',f=>{f.commands.values().next().value!.exit_code=1;f.refreshCommands();}],
  ['command sanitized invocation','R2_COMMAND_INVOCATION',f=>{f.commands.get('review').invocation='r2-types-v1';f.refreshCommands();}],
  ['duplicate command','R2_DUPLICATE_COMMAND',f=>{f.root.commands.push(f.root.commands[0]);}],
  ['required command kind','R2_MISSING_COMMAND_KIND',f=>{f.commands.delete('gate-generated');f.refreshCommands();}],
  ['command case commitment set','R2_COMMAND_CASES',f=>{const c=[...f.commands.values()].find(c=>c.case_ids.length);c.case_ids.pop();f.refreshCommands();}],
  ['receipt ownership','R2_RESULT_OWNERSHIP',f=>{f.commands.get('review').results=[];f.refreshCommands();}],
  ['receipt candidate','R2_RECEIPT_CANDIDATE',f=>changeReceipt(f,'review',x=>{x.tree_sha256='f'.repeat(64);})],
  ['receipt observed time','R2_RECEIPT_COMMAND',f=>changeReceipt(f,'review',x=>{x.observed_at=999999;})],
  ['self review','R2_INDEPENDENT_REVIEW',f=>changeReceipt(f,'review',x=>{x.reviewer_id=f.root.author_id;x.observer_id=f.root.author_id;})],
  ['blocking review','R2_INDEPENDENT_REVIEW',f=>changeReceipt(f,'review',x=>{x.open_findings=[{severity:'important',code:'BLOCKER'}];})],
  ['audit coverage','R2_DEPENDENCY_AUDIT',f=>changeReceipt(f,'audit',x=>{x.embedded_inventory_complete=false;})],
  ['audit lock','R2_DEPENDENCY_AUDIT',f=>changeReceipt(f,'audit',x=>{x.lock_sha256='f'.repeat(64);})],
  ['deployment identity','R2_DEPLOYMENT_IDENTITY',f=>changeReceipt(f,'deployment',x=>{x.object_name='other_object';})],
  ['deployment namespace','R2_DEPLOYMENT_NAMESPACE',f=>changeReceipt(f,'deployment',x=>{x.components.find((r:any)=>r.role==='anchor-provider').namespace_id=x.components.find((r:any)=>r.role==='application-worker').namespace_id;})],
  ['deployment component','R2_DEPLOYMENT_COMPONENT',f=>changeReceipt(f,'deployment',x=>{x.components[0].artifact_inventory_sha256='f'.repeat(64);})],
  ['native CLI not Worker','R2_DEPLOYMENT_APPLICABILITY',f=>changeReceipt(f,'deployment',x=>{x.components.find((r:any)=>r.role==='native-cli').deployment_id='invented';})],
  ['operator has no own namespace','R2_DEPLOYMENT_APPLICABILITY',f=>changeReceipt(f,'deployment',x=>{x.components.find((r:any)=>r.role==='operator-worker').namespace_id='invented';})],
  ['UI follows app deployment','R2_DEPLOYMENT_APPLICABILITY',f=>changeReceipt(f,'deployment',x=>{x.components.find((r:any)=>r.role==='ui-assets').deployment_id='invented';})],
  ['operator exact DO binding','R2_DEPLOYMENT_BINDINGS',f=>changeReceipt(f,'deployment',x=>{x.components.find((r:any)=>r.role==='operator-worker').bindings[0].kind='service';})],
  ['unknown receipt property','R2_RECEIPT_SCHEMA',f=>changeReceipt(f,'review',x=>{x.free_text='not allowed';})],
  ['unknown command property','R2_COMMAND_SCHEMA',f=>{f.commands.get('review').shell='curl anything';f.refreshCommands();}],
  ['sensitive receipt','R2_SENSITIVE_EVIDENCE',f=>changeReceipt(f,'audit',x=>{x.packages[0].name='Bearer '+'a'.repeat(40);})],
 ];
 it.each(rows)('%s is rejected with %s',(_name,code,mutate)=>{const f=controllerFixture();mutate(f);const result=verifyR2Release(f.root,{files:f.files});expect(result.passed).toBe(false);expect(result.findings.map(x=>x.code)).toContain(code);});
 it('explicitly reports structural-only even when every provenance marker claims eligibility',()=>{const f=controllerFixture();for(const c of f.commands.values())c.provenance=['browser-tests','dependency-audit','deployed-ingress','deployed-recovery','native-live'].includes(c.kind)?'real-run':'source';f.refreshCommands();const result=verifyR2Release(f.root,{files:f.files});expect(result).toMatchObject({passed:true,scope:'structural-only',acceptance:'pending-external-inspection',findings:[]});});
});
describe('protected post-run command manifest commitments',()=>{
 it('requires root and projection original manifest digest',()=>{const f=controllerFixture();delete f.root.commands[0].record_sha256;expect(verifyR2Release(f.root,{files:f.files}).findings.map(x=>x.code)).toContain('R2_SCHEMA_INVALID');});
 it('rejects two invocation identities reusing the same original record',()=>{const f=controllerFixture();const [a,b]=[...f.commands.values()];b.record_sha256=a.record_sha256??'f'.repeat(64);a.record_sha256=b.record_sha256;f.refreshCommands();expect(verifyR2Release(f.root,{files:f.files}).findings.map(x=>x.code)).toContain('R2_DUPLICATE_COMMAND_RECORD');});
 it('rejects swapping the original command manifest under unchanged root metadata',()=>{const f=controllerFixture();f.root.commands[0].record_sha256='f'.repeat(64);expect(verifyR2Release(f.root,{files:f.files}).findings.map(x=>x.code)).toContain('R2_COMMAND_METADATA');});
});
it('normalizes typed family findings into the public diagnostic shape',()=>{const f=controllerFixture();f.commands.get(f.receipts.get('isolation').command_id).exit_code=1;f.refreshCommands();const result=verifyR2Release(f.root,{files:f.files});expect(result.passed).toBe(false);expect(result.findings.every(x=>typeof x.path==='string'&&typeof x.message==='string')).toBe(true);});
it('R2 missing evidence errors retain an explicit R2 structural scope',()=>{const stdout=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);try{expect(runCli(['--round','R2','--evidence','missing-root.json'],tmpdir())).toBe(1);const result=JSON.parse(String(stdout.mock.calls.at(-1)?.[0]));expect(result).toMatchObject({passed:false,scope:'structural-only',acceptance:'pending-external-inspection'});expect(result.findings[0].code).toBe('R2_EVIDENCE_UNAVAILABLE');}finally{stdout.mockRestore();}});
