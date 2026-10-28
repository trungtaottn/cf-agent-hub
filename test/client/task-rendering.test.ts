import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {KanbanView} from '../../src/ui/kanban';
import {TaskDetail} from '../../src/ui/task-detail';
import {ReadModel} from '../../src/ui/read-state';
import {taskStates,type TaskPage,type TaskReadView} from '../../src/ui/task-reads';
import type {Task,TaskResult,TaskState,Run,Artifact,Event,WorkspaceProfile} from '../../src/http/dto';
import {asFixture,descendants,domFixture,section} from '../helpers/dom-fixture';
const when='2026-10-27T10:00:00.000Z';
const actor={kind:'agent',principal_id:'principal_example',agent_id:'agent_example'} as const;
const makeTask=(state:TaskState='backlog',id='task_example'):Task=>({id,workspace_id:'ws_example',title:'A durable task',description:'Retained intent',state,task_version:4,proposal_version:0,project_id:null,work_role_id:null,assigned_agent_id:'agent_example',active_run_id:null,latest_run_id:null,approval_id:null,result:null,retry_count:0,retry_limit:3,flags:[],created_at:when,updated_at:when});
const result=(run_id='run_old'):TaskResult=>({summary:'Retained summary',artifact_ids:[],run_id,submitted_by:actor,submitted_at:when});
const event=(overrides:Partial<Event>={}):Event=>({id:'event_example',workspace_id:'ws_example',sequence:1,type:'task.result_accepted',actor:{kind:'human',principal_id:'reviewer_example',agent_id:null},resource_type:'task',resource_id:'task_example',task_version:4,run_id:'run_current',fence:1,occurred_at:when,summary:'Task result independently accepted.',request_id:'request_event',resource_version:null,thread_id:null,...overrides});
const model=<T>()=>new ReadModel<T>({isEmpty:value=>Array.isArray(value)&&value.length===0,now:()=>Date.parse(when)});
const page=<T>():TaskPage<T>=>({read:model<T[]>(),page:null,cursor:null});
function state():TaskReadView{return {columns:Object.fromEntries(taskStates.map(name=>[name,page<Task>()])) as Record<TaskState,TaskPage<Task>>,task:model<Task>(),run:model<Run>(),results:page<TaskResult>(),events:page<Event>(),artifacts:model<Artifact[]>(),selectedId:'task_example',capabilities:{tasks:true,events:true,artifacts:true}};}
async function observe<T>(read:ReadModel<T>,data:T){await read.refresh(async()=>({ok:true,status:200,data,requestId:'request_example'}));}
const board=(value:TaskReadView,profile:WorkspaceProfile|null=null,onSelect=vi.fn(),onNext=vi.fn())=>asFixture(KanbanView({state:value,workspaceId:'ws_example',profile,onSelect,onNext}));
const detail=(value:TaskReadView,onResultsNext=vi.fn(),onEventsNext=vi.fn())=>asFixture(TaskDetail({state:value,workspaceId:'ws_example',onResultsNext,onEventsNext,onBack:vi.fn(),nowMs:Date.parse(when)}));
beforeEach(()=>vi.stubGlobal('document',domFixture));afterEach(()=>vi.unstubAllGlobals());

describe('read-only task rendering (structural DOM, not browser assertions)',()=>{
  it('has six canonical headings and a separate cancelled archive without fabricated empty reads',()=>{
    const root=board(state());expect(descendants(root,node=>node.tagName==='H2').map(node=>node.textContent)).toEqual(['Backlog','Ready','Doing','Waiting','Review','Done','Cancelled archive']);
    expect(section(root,'tasks-backlog').getAttribute('data-status')).toBe('loading');expect(root.textContent).not.toContain('0 tasks');
  });
  it('shows only a bounded authorized page, source/time and next control without workspace totals',async()=>{
    const value=state();await observe(value.columns.ready.read,Array.from({length:23},(_,i)=>makeTask('ready','task_'+i)));value.columns.ready.page={has_more:true,next_cursor:'opaque_next'};
    const onNext=vi.fn(),root=board(value,null,vi.fn(),onNext),column=section(root,'tasks-ready');
    expect(descendants(column,node=>node.tagName==='A')).toHaveLength(20);expect(column.textContent).toContain('20 tasks on this page');expect(column.textContent).toContain('not a workspace total');expect(column.textContent).toContain('/tasks?state=ready&limit=20');expect(column.textContent).toContain(when);
    const next=descendants(column,node=>node.tagName==='BUTTON'&&node.textContent==='Next Ready page')[0];expect(next).toBeDefined();next.click();expect(onNext).toHaveBeenCalledWith('ready');
  });
  it('keeps task and profile names inert and links encoded with stable focus keys',async()=>{
    const value=state(),task={...makeTask(),id:'task_<unsafe>&',title:'<img src=x onerror=alert(1)>',project_id:'project_example',work_role_id:'role_example'};await observe(value.columns.backlog.read,[task]);
    const profile:WorkspaceProfile={contract_revision:'0.1',profile_id:'profile_example',display_name:'Example',description:'',branding:{accent:'blue'},navigation:{visible_views:['tasks']},projects:[{id:'project_example',display_name:'<b>Project</b>',description:'',archived:false}],work_roles:[{id:'role_example',display_name:'<script>Role</script>',description:'',archived:false}]};
    const onSelect=vi.fn(),root=board(value,profile,onSelect),link=descendants(root,node=>node.tagName==='A')[0];expect(link.textContent).toBe(task.title);expect(link.getAttribute('href')).toBe('/tasks?workspace=ws_example&task=task_%3Cunsafe%3E%26');expect(link.getAttribute('data-focus-key')).toBe('task:'+task.id);link.click();expect(onSelect).toHaveBeenCalledWith(task.id);expect(root.textContent).toContain('<b>Project</b>');expect(descendants(root,node=>['IMG','SCRIPT'].includes(node.tagName))).toHaveLength(0);
  });
  it('keeps a failed section distinct from successful empty and ready sections',async()=>{
    const value=state();await observe(value.columns.backlog.read,[makeTask()]);await observe(value.columns.ready.read,[]);await value.columns.doing.read.refresh(async()=>({ok:false,status:503,error:{code:'DEPENDENCY_UNAVAILABLE',message:'Unavailable',retryable:false},requestId:'failure_request'}));
    const root=board(value);expect(section(root,'tasks-backlog').getAttribute('data-status')).toBe('ready');expect(section(root,'tasks-ready').textContent).toContain('No tasks on this page');expect(section(root,'tasks-doing').getAttribute('data-status')).toBe('error');expect(section(root,'tasks-doing').textContent).toContain('DEPENDENCY_UNAVAILABLE');expect(section(root,'tasks-doing').textContent).not.toContain('No tasks on this page');
  });
  it('does not render retained records when task capability is unavailable',async()=>{
    const value=state();await observe(value.columns.backlog.read,[makeTask()]);const root=board({...value,capabilities:{tasks:false,events:false,artifacts:false}});expect(root.textContent).not.toContain('A durable task');expect(root.textContent).toContain('Unavailable');
  });
  it('labels old results historical even when latest_run_id still names that submitted run',async()=>{
    const value=state();await observe(value.task,{...makeTask('ready'),latest_run_id:'run_old'});await observe(value.results.read,[result()]);const root=detail(value),history=section(root,'task-results');expect(history.textContent).toContain('Historical result');expect(history.textContent).not.toContain('Current result');expect(history.textContent).toContain('Retained summary');
  });
  it('never uses acceptance of another task/run or a future version as current result acceptance',async()=>{
    const value=state();await observe(value.task,{...makeTask('review'),result:result('run_current'),latest_run_id:'run_current'});await observe(value.events.read,[event({run_id:'run_old'}),event({resource_id:'task_other'}),event({task_version:99})]);
    const root=detail(value);expect(section(root,'task-detail').textContent).toContain('Acceptance actor/time not observed in this page');expect(section(root,'task-detail').textContent).not.toContain('reviewer_example');
    await observe(value.events.read,[event()]);const accepted=detail(value);expect(section(accepted,'task-detail').textContent).toContain('reviewer_example');expect(section(accepted,'task-detail').textContent).toContain('independently observed event');
  });
  it('separates lease observation from unavailable presence and disables Waiting decisions',async()=>{
    const value=state();await observe(value.task,{...makeTask('waiting'),latest_run_id:'run_example',approval_id:'approval_example'});await observe(value.run,{id:'run_example',workspace_id:'ws_example',task_id:'task_example',agent_id:'agent_example',runtime_instance_id:'runtime_example',status:'active',run_version:1,fence:2,lease_expires_at:'2026-10-27T09:59:00.000Z',started_at:when,ended_at:null});
    const root=detail(value);expect(section(root,'task-run').textContent).toContain('no public runtime presence read');expect(section(root,'task-run').textContent).toContain('past the observed lease deadline');expect(root.textContent).toContain('R3 unavailable');const controls=descendants(root,node=>node.tagName==='BUTTON'&&['Approve','Reject'].includes(node.textContent));expect(controls).toHaveLength(2);expect(controls.every(node=>node.getAttribute('disabled')!==null)).toBe(true);
  });
  it('renders current-result artifact metadata as text only and hides stale metadata without scope',async()=>{
    const value=state(),current={...result('run_current'),artifact_ids:['artifact_example']};await observe(value.task,{...makeTask('review'),result:current});await observe(value.artifacts,[{id:'artifact_example',workspace_id:'ws_example',task_id:'task_example',run_id:'run_current',owner:actor,artifact_version:1,filename:'<svg onload=alert(1)>',media_type:'text/plain',byte_size:4,sha256:'a'.repeat(64),status:'committed',created_at:when,committed_at:when,expires_at:null}]);const root=detail(value);expect(section(root,'task-artifacts').textContent).toContain('<svg onload=alert(1)>');expect(descendants(root,node=>node.tagName==='SVG')).toHaveLength(0);expect(section(detail({...value,capabilities:{...value.capabilities,artifacts:false}}),'task-artifacts').textContent).not.toContain('<svg');
  });
  it('bounds and correlates event evidence with independent pagination and unavailable scopes',async()=>{
    const value=state();await observe(value.task,{...makeTask('review'),result:result('run_current'),latest_run_id:'run_current'});await observe(value.events.read,[event(),event({id:'event_other',resource_id:'task_other',summary:'Other task private summary'})]);value.events.page={has_more:true,next_cursor:'event_next'};await observe(value.results.read,[result('run_current')]);value.results.page={has_more:true,next_cursor:'result_next'};
    const nextResults=vi.fn(),nextEvents=vi.fn(),root=detail(value,nextResults,nextEvents);expect(section(root,'task-events').textContent).not.toContain('Other task private summary');expect(section(root,'task-events').textContent).toContain('workspace event page');for(const control of descendants(root,node=>node.tagName==='BUTTON'))control.click();expect(nextResults).toHaveBeenCalledOnce();expect(nextEvents).toHaveBeenCalledOnce();const unavailable=detail({...value,capabilities:{...value.capabilities,events:false}});expect(section(unavailable,'task-events').textContent).not.toContain('Task result independently accepted.');expect(section(unavailable,'task-detail').textContent).not.toContain('reviewer_example');
  });
  it('suppresses every dependent cached record when the selected task is not authorized or differs',async()=>{
    const value=state();await observe(value.task,{...makeTask('review'),result:result('run_current'),latest_run_id:'run_current'});await observe(value.results.read,[{...result(),summary:'Cached historical private summary'}]);await observe(value.events.read,[event()]);
    const foreign=detail({...value,selectedId:'task_other'});expect(foreign.textContent).not.toContain('A durable task');expect(foreign.textContent).not.toContain('Cached historical private summary');expect(foreign.textContent).not.toContain('reviewer_example');
    value.task.invalidate('FORBIDDEN');const denied=detail(value);expect(section(denied,'task-detail').getAttribute('data-status')).toBe('forbidden');expect(denied.textContent).not.toContain('Cached historical private summary');expect(denied.textContent).not.toContain('reviewer_example');
  });
  it('disables continuation on a stale observation while preserving its real source/time',async()=>{
    const value=state();await observe(value.columns.done.read,[makeTask('done')]);value.columns.done.page={has_more:true,next_cursor:'next'};value.columns.done.read.disconnect();const next=vi.fn(),root=board(value,null,vi.fn(),next),column=section(root,'tasks-done');expect(column.getAttribute('data-status')).toBe('stale');expect(column.textContent).toContain(when);const control=descendants(column,node=>node.tagName==='BUTTON')[0];expect(control.getAttribute('disabled')).not.toBeNull();control.click();expect(next).not.toHaveBeenCalled();
  });

  it('keeps unavailable R3 decisions visibly disabled even on an empty Waiting column',async()=>{
    const value=state();await observe(value.columns.waiting.read,[]);const waiting=section(board(value),'tasks-waiting');expect(waiting.textContent).toContain('R3 unavailable');const controls=descendants(waiting,node=>node.tagName==='BUTTON'&&['Approve','Reject'].includes(node.textContent));expect(controls).toHaveLength(2);expect(controls.every(node=>node.getAttribute('disabled')!==null&&node.getAttribute('aria-disabled')==='true')).toBe(true);
  });

  it('preserves forbidden states after global authority loss also removes capabilities',()=>{
    const value=state();for(const column of Object.values(value.columns))column.read.invalidate('UNAUTHENTICATED');value.task.invalidate('UNAUTHENTICATED');value.run.invalidate('UNAUTHENTICATED');value.results.read.invalidate('UNAUTHENTICATED');value.events.read.invalidate('UNAUTHENTICATED');value.artifacts.invalidate('UNAUTHENTICATED');const denied={...value,capabilities:{tasks:false,events:false,artifacts:false}};
    expect(section(board(denied),'tasks-ready').getAttribute('data-status')).toBe('forbidden');for(const id of ['task-detail','task-run','task-results','task-events','task-artifacts'])expect(section(detail(denied),id).getAttribute('data-status')).toBe('forbidden');expect(detail(denied).textContent).toContain('UNAUTHENTICATED');
  });

});
it('does not claim a terminal page after resource redaction invalidates its cursor',async()=>{
 const value=state();await observe(value.columns.ready.read,[makeTask('ready','unrelated')]);value.columns.ready.read.redact(tasks=>tasks);value.columns.ready.page=null;
 const column=section(board(value),'tasks-ready');expect(column.textContent).toContain('Page boundary unavailable');expect(column.textContent).not.toContain('End of the observed page traversal');
});
