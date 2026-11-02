import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {PluginBuild} from 'esbuild';
import {createDecisionFixturePlugin,assertDecisionBuildGraph,buildDecisionBrowserFixture} from '../../scripts/lib/build-decision-browser-fixture.mjs';
const root=resolve('.');
const source=(p:string)=>readFileSync(resolve(root,p),'utf8');
const normal={'src/index.ts':{},'src/approvals/commands.ts':{},'src/approvals/commands-source.ts':{}};
const privateGraph={'src/index.ts':{},'test/helpers/decision-browser-composition.ts':{},'src/approvals/commands-source.ts':{}};
function plugin(){
 let resolveHook!: Parameters<PluginBuild['onResolve']>[1];
 let endHook!: Parameters<PluginBuild['onEnd']>[0];
 const p=createDecisionFixturePlugin(root);
 p.setup({onResolve(_options,callback){resolveHook=callback;},onEnd(callback){endHook=callback;}} as PluginBuild);
 return {resolve(path:string,resolveDir=resolve(root,'src/http')){return resolveHook({path,resolveDir,importer:resolve(resolveDir,'decision-routes.ts'),namespace:'file',kind:'import-statement',pluginData:undefined,with:{}});},end(){return endHook({errors:[],warnings:[],outputFiles:undefined,metafile:undefined,mangleCache:undefined});}};
}
describe('fixed private browser decision build contract',()=>{
 it('replaces only the exact canonical resolved module',()=>{const p=plugin();expect(p.resolve('../approvals/commands')).toEqual({path:resolve(root,'test/helpers/decision-browser-composition.ts')});expect(p.resolve('../tasks/commands')).toBeUndefined();expect(p.resolve('./commands',resolve(root,'test/approvals'))).toBeUndefined();expect(p.end()).toBeUndefined();});
 it('fails closed when no replacement occurs',()=>{expect(plugin().end()).toMatchObject({errors:[{text:'DECISION_FIXTURE_REPLACEMENT_COUNT'}]});});
 it('fails closed when canonical module is requested twice',()=>{const p=plugin();p.resolve('../approvals/commands');p.resolve('../approvals/commands.ts');expect(p.end()).toMatchObject({errors:[{text:'DECISION_FIXTURE_REPLACEMENT_COUNT'}]});});
 it('accepts distinct normal and fixed private graphs',()=>{expect(()=>assertDecisionBuildGraph({root,kind:'normal',inputs:normal,code:'ordinary'})).not.toThrow();expect(()=>assertDecisionBuildGraph({root,kind:'private',inputs:privateGraph,code:'synthetic.task-review'})).not.toThrow();});
 it.each(['test/helpers/decision-browser-composition.ts','test/helpers/other.ts'])('rejects normal graph containing %s',path=>{expect(()=>assertDecisionBuildGraph({root,kind:'normal',inputs:{...normal,[path]:{}},code:'ordinary'})).toThrow('DECISION_FIXTURE_PRODUCTION_GRAPH');});
 it('rejects normal emitted private identity even without a private graph entry',()=>{expect(()=>assertDecisionBuildGraph({root,kind:'normal',inputs:normal,code:'synthetic.task-review'})).toThrow('DECISION_FIXTURE_PRODUCTION_MARKER');});
 it('rejects absent wrapper or ordinary composition in private graph',()=>{expect(()=>assertDecisionBuildGraph({root,kind:'private',inputs:normal,code:'synthetic.task-review'})).toThrow();expect(()=>assertDecisionBuildGraph({root,kind:'private',inputs:{...privateGraph,'src/approvals/commands.ts':{}},code:'synthetic.task-review'})).toThrow();});
 it('keeps the fixed descriptor identical to the established private fixture',()=>{const descriptor=(s:string)=>s.slice(s.indexOf('export const syntheticSchema='),s.indexOf('export const syntheticPolicy:'));const existing=descriptor(source('test/helpers/decision-policy.ts'));const next=source('test/helpers/decision-browser-composition.ts');expect(next).toContain(existing.trim());expect(next).toContain('createDecisionCommands(Object.freeze([descriptor]))');expect(next).not.toMatch(/process\.env|cloudflare:workers|decision-policy/);});
 it('rejects an extra runtime or registry build option before reading/building',async()=>{await expect(Reflect.apply(buildDecisionBrowserFixture,undefined,[{root,outputDirectory:'/tmp/not-created',registry:[]}])).rejects.toThrow('DECISION_FIXTURE_BUILD_OPTIONS');});
 it('leaves production composition fixed empty and independent',()=>{expect(source('src/approvals/action-registry.ts')).toContain('productionDecisionDescriptors:readonly DecisionActionDescriptor[]=Object.freeze([])');expect(source('src/approvals/commands.ts')).toContain('createDecisionCommands(productionDecisionDescriptors)');expect(source('src/approvals/commands.ts')).not.toContain('test/');});
});
