import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
/** Actual host function bodies with inert adapters, not browser evidence. */
function fixture(){
 const source=ts.createSourceFile('app.ts',readFileSync(new URL('../../src/ui/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const names=['resetFactoryView','setFactoryMode','navigate','navigateTask'];
 const selected=source.statements.filter(s=>ts.isFunctionDeclaration(s)&&s.name&&names.includes(s.name.text));
 expect(selected).toHaveLength(names.length);
 const code=ts.transpileModule(selected.map(s=>s.getText(source)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2023}}).outputText;
 const render=vi.fn(),select=vi.fn(),refresh=vi.fn(),invalidate=vi.fn(),hide=vi.fn();
 const app=new Function('render','select','refresh','invalidate','hide',`
 let factoryMode=false,factoryProjectId=null,factoryWorkRoleId=null,currentView='tasks',workspace='ws';
 let denied=false,tasksAvailable=true;
 const hideComposition=hide,taskActions={invalidatePreparation:invalidate},taskActionPanel={navigation(){}},taskReads={select,refreshBoard:refresh};
 const history={pushState(){}},selectThread=()=>{},byId=()=>({focus(){}}),refreshThread=()=>{};
 ${code}
 return {set:setFactoryMode,reset:resetFactoryView,navigate,navigateTask,state:()=>({factoryMode,factoryProjectId,factoryWorkRoleId}),filter(){factoryProjectId='private-project';factoryWorkRoleId='private-role';},deny(){denied=true;},unavailable(){tasksAvailable=false;},leave(){currentView='overview';}};`)(render,select,refresh,invalidate,hide);
 return {app,render,select,refresh,invalidate,hide};
}
it('factory defaults off, toggles without reads/writes and invalidates pending command preparation',()=>{
 const f=fixture();expect(f.app.state().factoryMode).toBe(false);f.app.set(true);expect(f.app.state().factoryMode).toBe(true);expect(f.select).not.toHaveBeenCalled();expect(f.refresh).not.toHaveBeenCalled();expect(f.invalidate).toHaveBeenCalled();expect(f.hide).toHaveBeenCalled();
});
it.each(['deny','unavailable','leave'])('cannot enter factory when %s',mode=>{const f=fixture();f.app[mode]();f.app.set(true);expect(f.app.state().factoryMode).toBe(false);});
it('reset removes transient filters and route exit restores board default',()=>{const f=fixture();f.app.set(true);f.app.filter();f.app.navigate('overview');expect(f.app.state()).toEqual({factoryMode:false,factoryProjectId:null,factoryWorkRoleId:null});});
it('selected task navigation retains factory while returning to tasks route resets it',()=>{const f=fixture();f.app.set(true);f.app.navigateTask('task_one');expect(f.app.state().factoryMode).toBe(true);f.app.navigate('tasks');expect(f.app.state().factoryMode).toBe(false);});
