/** Fixed reporter; framework metadata is already materialized before callbacks. */
import {fileURLToPath} from 'node:url';
import type {TestCase,TestModule,Vitest} from 'vitest/node';
import {writeJ1Failure} from './r3-source-failure.mjs';
import {J1_MODULE,J1_TESTS,J1_LIMITS as L} from './r3-source-producer-policy.mjs';
import {J1SourceRun,type J1TestFact} from './r3-source-producer-run';
import {loadJ1RunInput,writeJ1Staged} from './r3-source-producer-io.mjs';
function fail():never{throw Error('R3_SOURCE_REPORTER_INVALID');}
export function normalizeJ1Test(test:TestCase):J1TestFact {
 const result=test.result(),diagnostic=test.diagnostic(),meta=test.meta();
 if(!meta||(Object.getPrototypeOf(meta)!==Object.prototype&&Object.getPrototypeOf(meta)!==null))fail();
 const keys=Reflect.ownKeys(meta);if(keys.length>1||keys.some(k=>k!=='r3SourceObservation'))fail();
 const descriptor=Object.getOwnPropertyDescriptor(meta,'r3SourceObservation');
 if(descriptor&&!Object.hasOwn(descriptor,'value'))fail();const packet=descriptor?.value??null;
 if(packet!==null&&(typeof packet!=='string'||Buffer.byteLength(packet)>L.packet))fail();
 return {id:test.id,name:test.name,state:result.state,mode:test.options.mode,packet,retry_count:diagnostic?.retryCount??null,repeat_count:diagnostic?.repeatCount??null,flaky:diagnostic?.flaky??null,error_count:result.errors?.length??0};
}
function moduleFact(module:TestModule,diagnostic?:(phase:string)=>void){const cases=[];for(const test of module.children.allTests()){if(cases.length>=8){diagnostic?.('collect-count');fail();}const meta=test.meta();diagnostic?.(meta&&Object.getPrototypeOf(meta)===null?'collect-meta-null':meta&&Object.getPrototypeOf(meta)===Object.prototype?'collect-meta-fields':'collect-meta-other');cases.push(normalizeJ1Test(test));}return {module_path:module.relativeModuleId,project_name:module.project.name,state:module.state(),cases};}
export function diagnoseJ1Collection(m:ReturnType<typeof moduleFact>):string {
 if(m.state==='queued')return 'collect-queued';if(m.state!=='pending')return 'collect-state';if(m.module_path!==J1_MODULE)return 'collect-path';if(m.project_name!=='r3-j1-source-producer')return 'collect-project';if(m.cases.length!==8)return 'collect-count';
 if(new Set(m.cases.map(x=>x.id)).size!==8||m.cases.some(x=>!/^[-A-Za-z0-9_]{1,128}$/.test(x.id)))return 'collect-id';
 if(new Set(m.cases.map(x=>x.name)).size!==8||J1_TESTS.some(name=>!m.cases.some(x=>x.name===name)))return 'collect-name';
 if(m.cases.some(x=>x.state!=='pending'))return 'collect-test-state';if(m.cases.some(x=>x.mode!=='run'))return 'collect-mode';if(m.cases.some(x=>x.packet!==null))return 'collect-packet';if(m.cases.some(x=>x.retry_count!==null||x.repeat_count!==null||x.flaky!==null||x.error_count!==0))return 'collect-diagnostic';return 'collect';
}
export default class J1SourceReporter {
 #run=new J1SourceRun();#input:ReturnType<typeof loadJ1RunInput>|undefined;#failed=false;#phase='init-input';
 #diagnose(){try{writeJ1Failure(process.env.R3_SOURCE_RUN_STATE,'reporter',{phase:this.#phase});}catch{}}
 onInit(ctx:Vitest){try{const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'');const input=loadJ1RunInput(process.env.R3_SOURCE_RUN_STATE,root);this.#input=input;const c=ctx.config;
 const checks:Record<string,boolean>={root:c.root===root,watch:!c.watch,retry:c.retry===0,only:!c.allowOnly,filter:!c.testNamePattern,shard:!c.shard,include:c.include.length===1&&c.include[0]===J1_MODULE,name:c.name==='r3-j1-source-producer',exclude:c.exclude.length===0,workers:c.maxWorkers===1,pool:c.pool==='cloudflare-pool',env:Object.entries(input.context.environment).every(([k,v])=>process.env[k]===v)};
 for(const [name,valid]of Object.entries(checks)){this.#phase='init-'+name;if(!valid)fail();}
 }catch{this.#failed=true;this.#diagnose();fail();}}
 onTestModuleCollected(module:TestModule){try{this.#phase='collect';if(!this.#input||this.#failed)fail();const fact=moduleFact(module,phase=>{this.#phase=phase;});this.#phase=diagnoseJ1Collection(fact);this.#run.collect(fact);}catch{this.#failed=true;this.#diagnose();fail();}}
 async onTestCaseResult(test:TestCase){try{this.#phase='case';if(!this.#input||this.#failed)fail();await this.#run.result(normalizeJ1Test(test));}catch{this.#failed=true;this.#diagnose();fail();}}
 onTestRunEnd(modules:ReadonlyArray<TestModule>,errors:ReadonlyArray<unknown>,reason:string){try{this.#phase='finish';if(!this.#input||this.#failed||modules.length!==1)fail();const candidate=this.#run.finish(moduleFact(modules[0]),reason,errors.length);writeJ1Staged(this.#input.output_root,this.#input.binding,candidate);}catch{this.#failed=true;this.#diagnose();fail();}}
}
