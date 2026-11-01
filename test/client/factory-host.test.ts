import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
/** Actual host function bodies with inert adapters, not browser evidence. */
function fixture(){
 const source=ts.createSourceFile('app.ts',readFileSync(new URL('../../src/ui/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const names=['resetFactoryView','setFactoryMode','navigate','navigateTask','reconcileFactoryFilters'];
 const selected=source.statements.filter(s=>ts.isFunctionDeclaration(s)&&s.name&&names.includes(s.name.text));
 expect(selected).toHaveLength(names.length);
 const code=ts.transpileModule(selected.map(s=>s.getText(source)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2023}}).outputText;
 const render=vi.fn(),select=vi.fn(),refresh=vi.fn(),invalidate=vi.fn(),hide=vi.fn(),disposeDecisions=vi.fn();
 const app=new Function('render','select','refresh','invalidate','hide','disposeDecisions',`
 let factoryMode=false,factoryProjectId=null,factoryWorkRoleId=null,currentView='tasks',workspace='ws',factoryAuthority=null;
 const factoryObservations={setActive(){},selectPrimary:async()=>{}};
 let denied=false,tasksAvailable=true;const models={profile:{state:{status:'forbidden',data:null}}};const normalizeFactoryFilters=options=>({projectId:options.projectId==='visible-project'?'visible-project':null,workRoleId:null});
 const hideComposition=hide,taskActions={invalidatePreparation:invalidate},taskActionPanel={navigation(){}},taskReads={select,refreshBoard:refresh,selectedId:null};
 const history={pushState(){}},selectThread=()=>{},byId=()=>({focus(){}}),refreshThread=()=>{};
 ${code}
 return {set:setFactoryMode,reset:resetFactoryView,reconcile:reconcileFactoryFilters,navigate,navigateTask,state:()=>({factoryMode,factoryProjectId,factoryWorkRoleId}),filter(){factoryProjectId='private-project';factoryWorkRoleId='private-role';},deny(){denied=true;},unavailable(){tasksAvailable=false;},leave(){currentView='overview';}};`)(render,select,refresh,invalidate,hide,disposeDecisions);
 return {app,render,select,refresh,invalidate,hide,disposeDecisions};
}
it('factory defaults off, toggles without reads/writes and invalidates pending command preparation',()=>{
 const f=fixture();expect(f.app.state().factoryMode).toBe(false);f.app.set(true);expect(f.app.state().factoryMode).toBe(true);expect(f.select).not.toHaveBeenCalled();expect(f.refresh).not.toHaveBeenCalled();expect(f.invalidate).toHaveBeenCalled();expect(f.hide).toHaveBeenCalled();
});
it.each(['deny','unavailable','leave'])('cannot enter factory when %s',mode=>{const f=fixture();f.app[mode]();f.app.set(true);expect(f.app.state().factoryMode).toBe(false);});
it('reset removes transient filters and route exit restores board default',()=>{const f=fixture();f.app.set(true);f.app.filter();f.app.navigate('overview');expect(f.disposeDecisions).toHaveBeenCalledOnce();expect(f.disposeDecisions.mock.invocationCallOrder[0]).toBeLessThan(f.render.mock.invocationCallOrder.at(-1)!);expect(f.app.state()).toEqual({factoryMode:false,factoryProjectId:null,factoryWorkRoleId:null});});
it('selected task navigation retains factory while returning to tasks route resets it',()=>{const f=fixture();f.app.set(true);f.app.navigateTask('task_one');expect(f.disposeDecisions).toHaveBeenCalledOnce();expect(f.disposeDecisions.mock.invocationCallOrder[0]).toBeLessThan(f.select.mock.invocationCallOrder[0]);expect(f.app.state().factoryMode).toBe(true);f.app.navigate('tasks');expect(f.disposeDecisions).toHaveBeenCalledTimes(2);expect(f.app.state().factoryMode).toBe(false);});

it('host clears orphan filter state and ignores stale callback IDs while retaining currently allowed IDs',()=>{const f=fixture();f.app.filter();f.app.reconcile();expect(f.app.state()).toMatchObject({factoryProjectId:null,factoryWorkRoleId:null});f.app.reconcile({projectId:'private-project',workRoleId:'private-role'});expect(f.app.state()).toMatchObject({factoryProjectId:null,factoryWorkRoleId:null});f.app.reconcile({projectId:'visible-project',workRoleId:'private-role'});expect(f.app.state()).toMatchObject({factoryProjectId:'visible-project',factoryWorkRoleId:null});});
