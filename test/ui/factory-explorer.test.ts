import {factoryAppSource} from '../helpers/factory-app-source.mjs';
import ts from 'typescript';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FactoryExplorer,type FactoryExplorerOptions} from '../../src/ui/factory/explorer';
import {TaskDetail} from '../../src/ui/task-detail';
import {ReadModel} from '../../src/ui/read-state';
import {taskStates,type TaskPage,type TaskReadView} from '../../src/ui/task-reads';
import type {Task,TaskResult,TaskState,Run,Artifact,Event,WorkspaceProfile} from '../../src/http/dto';
import {asFixture,descendants,DomFixtureElement,section} from '../helpers/dom-fixture';
const when='2026-11-01T02:00:00.000Z';
const actor={kind:'agent',principal_id:'principal_example',agent_id:'agent_example'} as const;
const task=(state:TaskState='backlog',id='task_example'):Task=>({id,workspace_id:'ws_example',title:'Durable work',description:'Observed intent',state,task_version:4,proposal_version:0,project_id:null,work_role_id:null,assigned_agent_id:'agent_example',active_run_id:null,latest_run_id:null,approval_id:null,result:null,retry_count:0,retry_limit:3,flags:[],created_at:when,updated_at:when});
const result=(run_id='run_old'):TaskResult=>({summary:'Reported test result',artifact_ids:[],run_id,submitted_by:actor,submitted_at:when});
const model=<T>()=>new ReadModel<T>({isEmpty:value=>Array.isArray(value)&&value.length===0,now:()=>Date.parse(when)});
const page=<T>():TaskPage<T>=>({read:model<T[]>(),page:null,cursor:null});
function state():TaskReadView{return {columns:Object.fromEntries(taskStates.map(name=>[name,page<Task>()])) as Record<TaskState,TaskPage<Task>>,task:model<Task>(),run:model<Run>(),results:page<TaskResult>(),events:page<Event>(),artifacts:model<Artifact[]>(),selectedId:null,capabilities:{tasks:true,events:true,artifacts:true}};}
async function observe<T>(read:ReadModel<T>,data:T){await read.refresh(async()=>({ok:true,status:200,data,requestId:'request_example'}));}
const render=(value:TaskReadView,options:Partial<FactoryExplorerOptions>={})=>asFixture(FactoryExplorer({state:value,workspaceId:'ws_example',profile:null,projectId:null,workRoleId:null,onFilter:vi.fn(),onSelect:vi.fn(),onNext:vi.fn(),onResultsNext:vi.fn(),onEventsNext:vi.fn(),onBack:vi.fn(),onOpenExistingTask:vi.fn(),nowMs:Date.parse(when),...options}));
class Element extends DomFixtureElement {appendChild(node:DomFixtureElement){this.append(node);return node;}}
beforeEach(()=>vi.stubGlobal('document',{createElement:(tag:string)=>new Element(tag.toUpperCase())}));afterEach(()=>vi.unstubAllGlobals());

describe('Factory evidence projection (structural DOM, not browser proof)',()=>{
 it('shows three semantic surfaces with unavailable selected evidence and no fabricated live map',()=>{
  const root=render(state());for(const id of ['factory-overview','factory-workstation','factory-evidence'])expect(section(root,id)).toBeDefined();
  for(const name of taskStates)expect(section(root,'factory-tasks-'+name).getAttribute('data-status')).toBe('loading');
  expect(root.textContent).toContain('Select a task');expect(root.textContent).toContain('Runtime presence: Unavailable');expect(root.textContent).not.toContain('0 tasks');
 });
 it('bounds pages at20 and keeps independent pagination when filters show no matches',async()=>{
  const value=state();await observe(value.columns.ready.read,Array.from({length:23},(_,i)=>({...task('ready','task_'+i),project_id:'project_one'})));value.columns.ready.page={has_more:true,next_cursor:'next'};
  const next=vi.fn(),full=section(render(value),'factory-tasks-ready');expect(descendants(full,n=>n.tagName==='A')).toHaveLength(20);expect(full.textContent).toContain('not a workspace total');expect(full.textContent).toContain(when);
  await observe(value.columns.backlog.read,[{...task('backlog','other_project_task'),project_id:'project_other'}]);
  const filtered=section(render(value,{projectId:'project_other',onNext:next}),'factory-tasks-ready');expect(descendants(filtered,n=>n.tagName==='A')).toHaveLength(0);expect(filtered.textContent).toContain('No matching tasks on this page');const control=descendants(filtered,n=>n.tagName==='BUTTON'&&n.textContent==='Next Ready page')[0];control.click();expect(next).toHaveBeenCalledWith('ready');
 });
 it('filters conjunction of authorized project and work role without inventing departments',async()=>{
  const value=state();await observe(value.columns.backlog.read,[{...task('backlog','one'),project_id:'p',work_role_id:'r'},{...task('backlog','two'),project_id:'p',work_role_id:'other'},{...task('backlog','three'),project_id:'foreign',work_role_id:'r'}]);
  const root=render(value,{projectId:'p',workRoleId:'r'});expect(descendants(root,n=>n.tagName==='A').map(n=>n.getAttribute('data-focus-key'))).toEqual(['factory-task:one']);expect(root.textContent).toContain('Filters apply only to the loaded pages');
 });
 it('keeps task and department labels inert, encoding links and forwarding explicit selection',async()=>{
  const value=state(),item={...task(),id:'task_<unsafe>&',title:'<img onerror=alert(1)>',project_id:'p'};await observe(value.columns.backlog.read,[item]);
  const profile:WorkspaceProfile={contract_revision:'0.1',profile_id:'profile',display_name:'Example',description:'',branding:{accent:'blue'},navigation:{visible_views:['tasks']},projects:[{id:'p',display_name:'<script>Department</script>',description:'',archived:false}],work_roles:[]};
  const select=vi.fn(),root=render(value,{profile,profileRead:{status:'ready',data:profile,observedAt:when,requestId:'profile_request',errorCode:null},onSelect:select}),link=descendants(root,n=>n.tagName==='A')[0];expect(link.textContent).toBe(item.title);expect(link.getAttribute('href')).toContain('task_%3Cunsafe%3E%26');link.click();expect(select).toHaveBeenCalledWith(item.id);expect(descendants(root,n=>['SCRIPT','IMG'].includes(n.tagName))).toHaveLength(0);expect(root.textContent).toContain('<script>Department</script>');
 });
 it('forwards filters through labelled semantic selects only',async()=>{
  const value=state();await observe(value.columns.backlog.read,[{...task(),project_id:'p',work_role_id:'r'}]);const onFilter=vi.fn(),root=render(value,{onFilter});
  const project=descendants(root,n=>n.tagName==='SELECT'&&n.getAttribute('aria-label')==='Project filter')[0],role=descendants(root,n=>n.tagName==='SELECT'&&n.getAttribute('aria-label')==='Work role filter')[0];
  Object.assign(project,{value:'p'});for(const listener of project.listeners.get('change')??[])listener({preventDefault(){}});expect(onFilter).toHaveBeenLastCalledWith({projectId:'p',workRoleId:null});
  Object.assign(role,{value:'r'});for(const listener of role.listeners.get('change')??[])listener({preventDefault(){}});expect(onFilter).toHaveBeenLastCalledWith({projectId:null,workRoleId:'r'});
 });
 it('keeps independently failed and empty pages distinct and stale pagination disabled',async()=>{
  const value=state();await observe(value.columns.backlog.read,[]);await value.columns.ready.read.refresh(async()=>({ok:false,status:503,error:{code:'DEPENDENCY_UNAVAILABLE',message:'untrusted',retryable:false},requestId:'r'}));await observe(value.columns.done.read,[task('done')]);value.columns.done.page={has_more:true,next_cursor:'next'};value.columns.done.read.disconnect();
  const next=vi.fn(),root=render(value,{onNext:next});expect(section(root,'factory-tasks-backlog').textContent).toContain('No matching tasks on this page');expect(section(root,'factory-tasks-ready').getAttribute('data-status')).toBe('error');expect(section(root,'factory-tasks-ready').textContent).not.toContain('No matching');const control=descendants(section(root,'factory-tasks-done'),n=>n.tagName==='BUTTON')[0];expect(control.getAttribute('disabled')).not.toBeNull();control.click();expect(next).not.toHaveBeenCalled();
 });
 it('hides cached nodes and derived filter choices after task capability loss',async()=>{
  const value=state();await observe(value.columns.backlog.read,[{...task(),title:'Private title',project_id:'private_project'}]);const root=render({...value,capabilities:{tasks:false,events:false,artifacts:false}});expect(root.textContent).not.toContain('Private title');expect(root.textContent).not.toContain('private_project');expect(root.textContent).toContain('Unavailable');
 });
 it('shows current task/run provenance distinct from historical result and no verified test claim',async()=>{
  const value={...state(),selectedId:'task_example'};await observe(value.task,{...task('ready'),latest_run_id:'run_old',retry_count:2});await observe(value.run,{id:'run_old',workspace_id:'ws_example',task_id:'task_example',agent_id:'agent_example',runtime_instance_id:'runtime_example',status:'submitted',run_version:2,fence:4,lease_expires_at:when,started_at:when,ended_at:when});await observe(value.results.read,[result()]);
  const root=render(value);expect(section(root,'factory-workstation').textContent).toContain('runtime_example');expect(section(root,'factory-workstation').textContent).toContain('not a live lease');expect(section(root,'factory-evidence').textContent).toContain('Historical result');expect(root.textContent).toContain('not independently verified test execution');expect(root.textContent).toContain('Retry count: 2');expect(root.textContent).toContain('Review-loop budget: Unavailable');
 });
 it('opens existing controls only via deliberate callback and does not expose mutation buttons',async()=>{
  const value={...state(),selectedId:'task_example'};await observe(value.task,task('review'));const open=vi.fn(),root=render(value,{onOpenExistingTask:open});expect(open).not.toHaveBeenCalled();const buttons=descendants(root,n=>n.tagName==='BUTTON');expect(buttons.some(n=>['Accept','Requeue','Ready','Cancel'].includes(n.textContent))).toBe(false);buttons.find(n=>n.textContent==='Open existing task controls')!.click();expect(open).toHaveBeenCalledOnce();
 });
 it('suppresses dependent private evidence and command navigation on mismatched selection',async()=>{
  const value={...state(),selectedId:'another'};await observe(value.task,task());await observe(value.results.read,[{...result(),summary:'Private old result'}]);const root=render(value);expect(root.textContent).not.toContain('Private old result');expect(root.textContent).not.toContain('Durable work');expect(descendants(root,n=>n.textContent==='Open existing task controls')).toHaveLength(0);
 });
 it('keeps retained Waiting unavailable rather than creating an approval lifecycle',async()=>{
  const value={...state(),selectedId:'task_example'};await observe(value.task,task('waiting'));const root=render(value);expect(root.textContent).toContain('human decision execution is not implemented');for(const control of descendants(root,n=>n.tagName==='BUTTON'&&['Approve','Reject'].includes(n.textContent)))expect(control.getAttribute('disabled')).not.toBeNull();
 });
 it('keeps denied artifact and event sections distinct while retaining authorized current task',async()=>{
  const value={...state(),selectedId:'task_example'};await observe(value.task,{...task('review'),latest_run_id:'run_current',result:result('run_current')});await value.events.read.refresh(async()=>({ok:false,status:403,error:{code:'FORBIDDEN',message:'denied',retryable:false},requestId:'event_denied'}));await value.artifacts.refresh(async()=>({ok:false,status:403,error:{code:'FORBIDDEN',message:'denied',retryable:false},requestId:'artifact_denied'}));
  const root=render(value);expect(section(root,'factory-workstation').textContent).toContain('Durable work');expect(section(root,'task-events').getAttribute('data-status')).toBe('forbidden');expect(section(root,'task-artifacts').getAttribute('data-status')).toBe('forbidden');expect(section(root,'task-artifacts').textContent).not.toContain('No current result artifact');expect(section(root,'task-detail').textContent).toContain('Acceptance actor/time not observed');
 });
 it('never counts foreign-workspace or wrong-state rows nor derives filter choices from them',async()=>{
  const value=state();await observe(value.columns.backlog.read,[{...task(),workspace_id:'foreign',project_id:'private_project',title:'Foreign'},{...task('done'),work_role_id:'private_role',title:'Wrong state'},task()]);
  const root=render(value);expect(section(root,'factory-tasks-backlog').textContent).toContain('1 matching tasks');expect(root.textContent).not.toContain('Foreign');expect(root.textContent).not.toContain('Wrong state');expect(root.textContent).not.toContain('private_project');expect(root.textContent).not.toContain('private_role');
 });
 it('re-render after authority invalidation cannot expose earlier selected run or result',async()=>{
  const value={...state(),selectedId:'task_example'};await observe(value.task,{...task('review'),latest_run_id:'old'});await observe(value.results.read,[{...result(),summary:'Private result'}]);value.task.invalidate('FORBIDDEN');
  const root=render(value);expect(root.textContent).not.toContain('Private result');expect(root.textContent).not.toContain('Durable work');expect(section(root,'task-detail').getAttribute('data-status')).toBe('forbidden');expect(descendants(root,n=>n.textContent==='Open existing task controls')).toHaveLength(0);
 });

 it('separately timestamps profile labels and suppresses them when that read is unavailable',async()=>{
  const value=state();await observe(value.columns.backlog.read,[{...task(),project_id:'p'}]);const profile:WorkspaceProfile={contract_revision:'0.1',profile_id:'profile',display_name:'Example',description:'',branding:{accent:'blue'},navigation:{visible_views:['tasks']},projects:[{id:'p',display_name:'Sensitive department',description:'',archived:false}],work_roles:[]};
  const root=render(value,{profile,profileRead:{status:'stale',data:profile,observedAt:'2026-10-31T01:00:00.000Z',requestId:'profile_old',errorCode:null}});expect(section(root,'factory-profile').getAttribute('data-status')).toBe('stale');expect(section(root,'factory-profile').textContent).toContain('2026-10-31T01:00:00.000Z');expect(section(root,'factory-profile').textContent).toContain('/v2/workspaces/ws_example/profile');expect(root.textContent).toContain('Sensitive department');
  const denied=render(value,{profile,profileRead:{status:'forbidden',data:null,observedAt:null,requestId:'denied',errorCode:'FORBIDDEN'}});expect(denied.textContent).not.toContain('Sensitive department');expect(denied.textContent).toContain('p (label unavailable)');expect(section(denied,'factory-profile').getAttribute('data-status')).toBe('forbidden');
 });

 it('removes orphan formerly private filters from values attributes callbacks and matching rows after profile denial',async()=>{
  const value=state();await observe(value.columns.backlog.read,[task()]);const onFilter=vi.fn(),root=render(value,{projectId:'private_project',workRoleId:'private_role',profileRead:{status:'forbidden',data:null,observedAt:null,requestId:'denied',errorCode:'FORBIDDEN'},onFilter});
  const nodes=descendants(root,()=>true),serialized=nodes.map(n=>[n.textContent,...n.attributes.values(),(n as unknown as {value?:string}).value??''].join('|')).join('|');expect(serialized).not.toContain('private_project');expect(serialized).not.toContain('private_role');expect(section(root,'factory-tasks-backlog').textContent).toContain('Durable work');
  for(const select of nodes.filter(n=>n.tagName==='SELECT')){expect((select as unknown as {value:string}).value).toBe('');for(const listener of select.listeners.get('change')??[])listener({preventDefault(){}});}expect(onFilter).toHaveBeenCalledTimes(2);for(const call of onFilter.mock.calls)expect(call[0]).toEqual({projectId:null,workRoleId:null});
 });
 it('retains reference IDs independently visible in authorized task pages after profile denial',async()=>{
  const value=state();await observe(value.columns.backlog.read,[{...task(),project_id:'visible_project',work_role_id:'visible_role'}]);const onFilter=vi.fn(),root=render(value,{projectId:'visible_project',workRoleId:'visible_role',profileRead:{status:'forbidden',data:null,observedAt:null,requestId:'denied',errorCode:'FORBIDDEN'},onFilter});const selects=descendants(root,n=>n.tagName==='SELECT');expect(selects.map(n=>(n as unknown as {value:string}).value)).toEqual(['visible_project','visible_role']);expect(root.textContent).toContain('visible_project (label unavailable)');expect(root.textContent).toContain('Durable work');
  for(const listener of selects[1].listeners.get('change')??[])listener({preventDefault(){}});expect(onFilter).toHaveBeenLastCalledWith({projectId:'visible_project',workRoleId:'visible_role'});
 });
 it('does not forward injected orphan option values through renderer filter callbacks',async()=>{
  const value=state(),onFilter=vi.fn(),root=render(value,{onFilter}),select=descendants(root,n=>n.tagName==='SELECT')[0];Object.assign(select,{value:'private_injected'});for(const listener of select.listeners.get('change')??[])listener({preventDefault(){}});expect(onFilter).toHaveBeenLastCalledWith({projectId:null,workRoleId:null});
 });

});

it('cleared denied task detail does not retain its old identifier in provenance after leaving Factory',async()=>{
 const value={...state(),selectedId:'private_denied_id'};await observe(value.task,{...task(),id:'private_denied_id'});
 const detail=()=>asFixture(TaskDetail({state:value,workspaceId:'ws_example',onResultsNext:vi.fn(),onEventsNext:vi.fn(),onBack:vi.fn()}));
 expect(detail().textContent).toContain('/tasks/private_denied_id');value.task.unavailable('FORBIDDEN');value.results.read.unavailable('FORBIDDEN');value.run.unavailable('FORBIDDEN');
 expect(detail().textContent).not.toContain('private_denied_id');expect(detail().textContent).toContain('/tasks/{selected-task}');
});
it('a newly selected canonical task cannot render reports retained for the prior selection',async()=>{
 const value={...state(),selectedId:'new_task'},old=model<Task>(),report=model<any>();await observe(old,{...task(),id:'old_task',title:'Prior selected title'});await observe(report,{status:'retained',binding:{task_id:'old_task',run_id:'run_old',agent_id:'agent_old',runtime_instance_id:'runtime_old',repository_id:'repo',checkout_slot_id:'checkout',session_id:'obs_'+'a'.repeat(48),session_epoch:1,fence:1},coverage:{configured_events:['read-observed'],completeness:'unknown',reported_loss:false},retained_range:{first_sequence:1,last_sequence:1},truncated:false,records:[{sequence:1,server_received_at:when,reported:{observed_at:when,relative_path:'src/prior-private.ts',activity:'read-observed',source_oid:null}}],read_at:when});
 const root=render(value,{observations:{state:{slots:[{id:'old_task',task:old,run:model<Run>(),observation:report,page:{has_more:false,next_cursor:null},cursor:null,expectedSessionId:'obs_'+'a'.repeat(48),pageNumber:1,requiresExplicitRefresh:false}]},onCompare:vi.fn(),onRemoveComparison:vi.fn(),onNext:vi.fn(),onRefresh:vi.fn()}});expect(root.textContent).not.toContain('src/prior-private.ts');expect(root.textContent).not.toContain('Prior selected title');expect(root.textContent).not.toContain('old_task');
});

it('detached observation DOM callbacks cannot act across primary or host lifecycle changes',async()=>{
 const source=ts.createSourceFile('app.ts',factoryAppSource,ts.ScriptTarget.Latest,true);let expression='';
 function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='FactoryExplorer'){const object=node.arguments[0] as ts.ObjectLiteralExpression;expression=(object.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='observations') as ts.PropertyAssignment).initializer.getText(source);}ts.forEachChild(node,visit);}visit(source);expect(expression).not.toBe('');const renderSource=source.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='render')!.getText(source);expect(renderSource.indexOf('++factoryObservationRender')).toBeGreaterThan(renderSource.indexOf('syncFactoryObservationState()'));expect(renderSource.indexOf('++factoryObservationRender')).toBeLessThan(renderSource.indexOf('renderNavigation()'));
 const helper=source.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='factoryObservationCallbacks');const code=ts.transpileModule((helper?.getText(source)??'')+';function capture(){const observationRender=++factoryObservationRender;return '+expression+';}',{compilerOptions:{target:ts.ScriptTarget.ES2023}}).outputText;
 const calls={compare:vi.fn(),removeComparison:vi.fn(),next:vi.fn(),refreshCurrent:vi.fn()};const controller={slots:[{id:'a'}],...calls};const host=new Function('factoryObservations','compareFactoryTask',`let factoryObservationRender=0,authority=1,connectionGeneration=1,session={actor:{principal_id:'human'}},factoryMode=true,currentView='tasks',denied=false;const taskReads={selectedId:'a'};${code};return {capture,select(id){taskReads.selectedId=id;factoryObservations.slots=[{id}];factoryObservationRender++;},authority(){authority++;},rerender(){factoryObservationRender++;},connection(){connectionGeneration++;},principal(){session.actor.principal_id='other';},leave(){factoryMode=false;factoryObservationRender++;}};`)(controller,calls.compare);
 const value={...state(),selectedId:'a'};await observe(value.columns.ready.read,[task('ready','a'),task('ready','b'),task('ready','c')]);const a={id:'a',task:model<Task>(),run:model<Run>(),observation:model<any>(),page:null,cursor:null,expectedSessionId:null,pageNumber:1,requiresExplicitRefresh:false};await observe(a.task,task('ready','a'));
 const live=host.capture();live.onCompare('c');live.onRemoveComparison();live.onNext('a');live.onRefresh('a');for(const call of Object.values(calls)){expect(call).toHaveBeenCalledOnce();call.mockClear();}
 const old=host.capture();const root=render(value,{observations:{...old,state:{slots:[a]}}});const select=descendants(root,n=>n.tagName==='SELECT'&&n.getAttribute('aria-label')==='Compare reported paths')[0];Object.assign(select,{value:'c'});host.select('b');for(const listener of select.listeners.get('change')??[])listener({preventDefault(){}});expect(calls.compare).not.toHaveBeenCalled();old.onRemoveComparison();old.onNext('a');old.onRefresh('a');for(const call of Object.values(calls))expect(call).not.toHaveBeenCalled();host.select('a');for(const listener of select.listeners.get('change')??[])listener({preventDefault(){}});expect(calls.compare).not.toHaveBeenCalled();
 for(const invalidate of ['rerender','authority','connection','principal','leave']){const previous=host.capture();host[invalidate]();previous.onCompare('c');previous.onRemoveComparison();previous.onNext('a');previous.onRefresh('a');}for(const call of Object.values(calls))expect(call).not.toHaveBeenCalled();
});
