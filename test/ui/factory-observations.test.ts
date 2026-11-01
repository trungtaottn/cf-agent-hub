import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {ReadModel} from '../../src/ui/read-state';
import {FactoryExplorer} from '../../src/ui/factory/explorer';
import {TaskReads} from '../../src/ui/task-reads';
import type {Task,ObservationView} from '../../src/http/dto';
import type {FactoryObservationSlot} from '../../src/ui/factory/observation-reads';
import {asFixture,descendants,DomFixtureElement,section} from '../helpers/dom-fixture';
const path='../../src/ui/factory/observations';const implementation=await import(/* @vite-ignore */path).catch(()=>({})) as any;
const at='2026-11-01T00:00:00.000Z';
const task=(id:string):Task=>({id,workspace_id:'ws_example',title:'Authorized '+id,description:'',state:'doing',task_version:1,proposal_version:0,project_id:null,work_role_id:null,assigned_agent_id:'assigned_agent',active_run_id:null,latest_run_id:'run_current',approval_id:null,result:null,retry_count:0,retry_limit:2,flags:[],created_at:at,updated_at:at});
const data=(id:string,checkout='checkout_'+id):ObservationView=>({status:'retained',binding:{task_id:id,run_id:'run_historical',agent_id:'report_agent',runtime_instance_id:'report_runtime',repository_id:'repository_example',checkout_slot_id:checkout,fence:3,session_id:'obs_'+'a'.repeat(48),session_epoch:1},coverage:{configured_events:['read-observed','write-observed'],completeness:'unknown',reported_loss:false},retained_range:{first_sequence:1,last_sequence:1},truncated:false,records:[{sequence:1,server_received_at:'2026-11-01T00:01:00.000Z',reported:{observed_at:'2025-01-01T00:00:00.000Z',relative_path:'src/shared.ts',activity:'write-observed',source_oid:'a'.repeat(40),label:'reported test label'}}],read_at:'2026-11-01T00:02:00.000Z'});
async function observe(model:ReadModel<any>,value:any){await model.refresh(async()=>({ok:true,status:200,data:value,requestId:'req_example'}));}
async function slot(id:string,value=data(id)):Promise<FactoryObservationSlot>{const item:FactoryObservationSlot={id,task:new ReadModel({isEmpty:()=>false}),run:new ReadModel({isEmpty:()=>false}),observation:new ReadModel({isEmpty:v=>v.records.length===0}),page:{has_more:false,next_cursor:null},cursor:null,expectedSessionId:value.binding?.session_id??null,pageNumber:1,requiresExplicitRefresh:false};await observe(item.task,task(id));await observe(item.observation,value);return item;}
const options=(slots:FactoryObservationSlot[])=>({state:{slots},workspaceId:'ws_example',candidates:[task('one'),task('two')],onCompare:vi.fn(),onRemoveComparison:vi.fn(),onNext:vi.fn(),onRefresh:vi.fn()});
function render(slots:FactoryObservationSlot[],overrides:any={}){expect(implementation.FactoryObservationSurfaces).toBeTypeOf('function');const parts=implementation.FactoryObservationSurfaces({...options(slots),...overrides});return Object.fromEntries(Object.entries(parts).map(([key,node])=>[key,asFixture(node as HTMLElement)])) as Record<string,DomFixtureElement>;}
class Element extends DomFixtureElement{appendChild(node:DomFixtureElement){this.append(node);return node;}}
beforeEach(()=>vi.stubGlobal('document',{createElement:(tag:string)=>new Element(tag.toUpperCase())}));afterEach(()=>vi.unstubAllGlobals());
describe('Factory reported observations — structural DOM only',()=>{
 it('D1 integrates reports into existing three surfaces and preserves existing evidence',async()=>{
  const one=await slot('one'),state=new TaskReads({workspaceId:'ws_example',request:vi.fn() as any});await state.select('one');state.setCapabilities({tasks:true,events:true,artifacts:true});await observe(state.task,task('one'));await observe(state.columns.doing.read,[task('one')]);const callbacks={onFilter:vi.fn(),onSelect:vi.fn(),onNext:vi.fn(),onResultsNext:vi.fn(),onEventsNext:vi.fn(),onBack:vi.fn(),onOpenExistingTask:vi.fn()};
  const root=asFixture(FactoryExplorer({state,workspaceId:'ws_example',profile:null,projectId:null,workRoleId:null,...callbacks,observations:options([one])} as any));expect(section(root,'factory-overview').textContent).toContain('Compare reported paths');expect(section(root,'factory-overview').textContent).toContain('Declared project');expect(section(root,'factory-workstation').textContent).toContain('src/shared.ts');expect(section(root,'factory-workstation').textContent).toContain('Runtime presence: Unavailable');expect(section(root,'factory-evidence').textContent).toContain('Coverage completeness: unknown');expect(section(root,'factory-evidence').textContent).toContain('not independently verified test execution');
 });
 it('D2 hostile exact Unicode/case paths and labels stay inert text',async()=>{
  const value=data('one');value.records[0].reported.relative_path='src/<img onerror=alert(1)> Ω.ts';value.records[0].reported.label='<script>unsafe</script>';const parts=render([await slot('one',value)]);expect(parts.workstation.textContent).toContain('src/<img onerror=alert(1)> Ω.ts');expect(parts.evidence.textContent).toContain('<script>unsafe</script>');for(const root of Object.values(parts))expect(descendants(root,n=>['IMG','SCRIPT','IFRAME'].includes(n.tagName))).toHaveLength(0);expect(descendants(parts.workstation,n=>n.tagName==='A')).toHaveLength(0);
 });
 it('D3 a denied side contributes no prior task identifier path or overlap',async()=>{
  const a=await slot('one'),b=await slot('private_two');b.task.unavailable('FORBIDDEN');b.observation.unavailable('FORBIDDEN');b.page=null;b.expectedSessionId=null;b.requiresExplicitRefresh=true;const parts=render([a,b],{candidates:[task('one')]});const text=Object.values(parts).map(x=>x.textContent).join(' ');expect(text).not.toContain('private_two');expect(text).not.toContain('checkout_private_two');expect(text).toContain('Comparison coverage unavailable');expect(text).not.toContain('Potential integration overlap');expect(text).toContain('Authorized one');
 });
 it('D4 separate checkout overlap is advisory, never filesystem conflict',async()=>{
  const parts=render([await slot('one'),await slot('two')]);expect(parts.workstation.textContent).toContain('Potential integration overlap across separate configured checkouts');expect(parts.workstation.textContent).toContain('not a filesystem conflict');expect(parts.workstation.textContent).toContain('coverage unknown');
 });
 it('D4 shared checkout and different repositories retain distinct meanings',async()=>{
  const a=await slot('one',data('one','shared_checkout')),b=await slot('two',data('two','shared_checkout'));expect(render([a,b]).workstation.textContent).toContain('Reported shared-checkout overlap — not write-enforced');const other=data('two');other.binding!.repository_id='other_repository';await observe(b.observation,other);expect(render([a,b]).workstation.textContent).toContain('overlap not compared');
 });
 it('D4 empty intersection and exact case difference never claim no-conflict',async()=>{
  const a=await slot('one'),value=data('two');value.records[0].reported.relative_path='src/Shared.ts';const text=render([a,await slot('two',value)]).workstation.textContent;expect(text).toContain('No shared paths on these two retained pages; coverage unknown');expect(text).not.toContain('No conflicts');
 });
 it('D5 reports separate clocks coverage retention and historical attribution',async()=>{
  const value=data('one');value.truncated=true;value.coverage!.reported_loss=true;const parts=render([await slot('one',value)]),text=parts.evidence.textContent;for(const label of ['Server read time','Browser received time','Producer-reported observed time','Server received time','Claimed source OID','Coverage completeness: unknown','Reported loss: yes','Truncated: yes','Retained sequence range: 1–1','Adapter version: Unavailable'])expect(text).toContain(label);expect(parts.workstation.textContent).toContain('Historical report run');expect(parts.workstation.textContent).toContain('Assigned logical agent: assigned_agent');expect(parts.workstation.textContent).toContain('report_agent');expect(text).not.toContain('Verified');
 });
 it('D6 page controls require successful committed page and forward explicit callbacks',async()=>{
  const one=await slot('one');one.page={has_more:true,next_cursor:'next'};const onNext=vi.fn(),onRefresh=vi.fn(),parts=render([one],{onNext,onRefresh});const controls=descendants(parts.evidence,n=>n.tagName==='BUTTON');controls.find(n=>n.textContent==='Next reported page (1)')!.click();expect(onNext).toHaveBeenCalledWith('one');controls.find(n=>n.textContent==='Refresh current observations (1)')!.click();expect(onRefresh).toHaveBeenCalledWith('one');
 });
 it('D6 delayed next hides prior-page rows rather than labelling them page2',async()=>{
  const one=await slot('one');one.pageNumber=2;one.cursor='next';one.page=null;one.observation.redact(v=>v);const parts=render([one]);expect(parts.workstation.textContent).not.toContain('src/shared.ts');expect(parts.evidence.textContent).not.toContain('src/shared.ts');expect(parts.evidence.textContent).not.toContain('Page 2');expect(parts.evidence.textContent).toContain('Waiting for a successful committed page');
 });
 it('D6 comparison is an explicit semantic control with no implicit selection',async()=>{
  const one=await slot('one'),onCompare=vi.fn(),parts=render([one],{onCompare});expect(onCompare).not.toHaveBeenCalled();const select=descendants(parts.overview,n=>n.tagName==='SELECT')[0];expect(select.getAttribute('aria-label')).toBe('Compare reported paths');Object.assign(select,{value:'two'});for(const listener of select.listeners.get('change')??[])listener({preventDefault(){}});expect(onCompare).toHaveBeenCalledWith('two');expect(descendants(parts.overview,n=>n.tagName==='OPTION').map(x=>x.getAttribute('value'))).toEqual(['','two']);
 });
 it('D5 no-retained-data and retained-empty never say never-executed or idle',async()=>{
  const value:ObservationView={status:'no_retained_data',binding:null,coverage:null,retained_range:null,truncated:false,records:[],read_at:at};let parts=render([await slot('one',value)]);expect(parts.workstation.textContent).toContain('External activity and prior execution are unknown');const retained=data('one');retained.records=[];retained.retained_range=null;parts=render([await slot('one',retained)]);expect(parts.workstation.textContent).toContain('No retained records on this page');expect(parts.evidence.textContent).toContain('this retained session');
 });
 it('D5 provenance names the actual workspace scoped endpoint',async()=>{
  const parts=render([await slot('one')]);expect(parts.evidence.textContent).toContain('/v2/workspaces/ws_example/tasks/one/observations');
 });
 it('D3 denied slot metadata is absent from every attribute as well as text',async()=>{
  const one=await slot('secret_task');one.task.unavailable('FORBIDDEN');const parts=render([one],{candidates:[]});
  for(const root of Object.values(parts))for(const node of descendants(root,()=>true)){expect(node.textContent).not.toContain('secret_task');for(const value of node.attributes.values())expect(value).not.toContain('secret_task');}
 });
 it('D6 disabled next cannot invoke its callback during a pending page',async()=>{
  const one=await slot('one');one.page=null;const onNext=vi.fn(),parts=render([one],{onNext});const next=descendants(parts.evidence,n=>n.tagName==='BUTTON'&&n.textContent.startsWith('Next'))[0];expect(next.getAttribute('disabled')).toBe('');next.click();expect(onNext).not.toHaveBeenCalled();
 });
 it('D3 stale task and stale observations cannot project cached paths',async()=>{
  for(const kind of ['task','observation'] as const){const one=await slot('one');if(kind==='task')one.task.redact(v=>v);else one.observation.redact(v=>v);const parts=render([one]);expect(parts.workstation.textContent).not.toContain('src/shared.ts');expect(parts.evidence.textContent).not.toContain('src/shared.ts');}
 });

 it('D4 overlap carries each page boundary beside coverage',async()=>{
  const a=await slot('one'),b=await slot('two');a.page={has_more:true,next_cursor:'next'};const parts=render([a,b]);const comparison=section(parts.workstation,'factory-observation-comparison');expect(comparison.textContent).toContain('Selected report 1 page: partial traversal');expect(comparison.textContent).toContain('Selected report 2 page: end of this read');
 });

});
