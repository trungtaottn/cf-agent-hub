import type {Task,TaskState,WorkspaceProfile} from '../../http/dto';
import {taskStates,taskPageLimit,type TaskReadView} from '../task-reads';
import {taskReadSection,taskStateLabels,unavailableTaskRead} from '../kanban';
import {TaskDetail} from '../task-detail';
import type {ReadState} from '../read-state';
import {el,button,labeledControl} from '../dom';

export interface FactoryExplorerOptions {
 state:TaskReadView;workspaceId:string;profile:WorkspaceProfile|null;profileRead?:Readonly<ReadState<unknown>>;projectId:string|null;workRoleId:string|null;
 onFilter:(filters:{projectId:string|null;workRoleId:string|null})=>void;onSelect:(id:string)=>void;onNext:(state:TaskState)=>void;
 onResultsNext:()=>void;onEventsNext:()=>void;onBack:()=>void;onOpenExistingTask:()=>void;nowMs?:number;
}
function surface(id:string,title:string):HTMLElement{
 const node=el('section',undefined,{class:'card','data-testid':id,'aria-label':title});node.append(el('h2',title));return node;
}
function loadedTasks(options:FactoryExplorerOptions,name:TaskState):Task[]{
 return options.state.capabilities.tasks?(options.state.columns[name].read.state.data??[]).filter(task=>task.workspace_id===options.workspaceId&&task.state===name).slice(0,taskPageLimit):[];
}
function filterControl(options:FactoryExplorerOptions,kind:'project'|'workRole'):HTMLElement{
 const project=kind==='project',current=project?options.projectId:options.workRoleId;
 const select=el('select',undefined,{'data-focus-key':'factory-filter:'+kind});
 select.append(el('option',project?'All projects':'All work roles',{value:''}));
 const catalog=options.state.capabilities.tasks?(project?options.profile?.projects:options.profile?.work_roles)??[]:[];
 const choices=new Map(catalog.map(item=>[item.id,item.display_name+(item.archived?' (archived)':'')]));
 for(const name of taskStates)for(const task of loadedTasks(options,name)){
  const id=project?task.project_id:task.work_role_id;if(id&&!choices.has(id))choices.set(id,id+' (label unavailable)');
 }
 for(const [id,label]of choices)select.append(el('option',label,{value:id,...(id===current?{selected:''}:{})}));
 if(current&&!choices.has(current))select.append(el('option','Selected filter unavailable',{value:current,selected:''}));
 select.value=current??'';
 if(!options.state.capabilities.tasks)select.setAttribute('disabled','');
 select.addEventListener('change',()=>options.onFilter(project?{projectId:select.value||null,workRoleId:options.workRoleId}:{projectId:options.projectId,workRoleId:select.value||null}));
 return labeledControl(project?'Project filter':'Work role filter',select);
}
function taskCard(task:Task,options:FactoryExplorerOptions):HTMLElement{
 const item=el('li',undefined,{class:'task-card'}),heading=el('h3');
 const query=new URLSearchParams({workspace:options.workspaceId,task:task.id});
 const link=el('a',task.title,{href:'/tasks?'+query.toString(),'data-focus-key':'factory-task:'+task.id});
 link.addEventListener('click',event=>{event.preventDefault();options.onSelect(task.id);});heading.append(link);item.append(heading);
 const project=options.profile?.projects.find(row=>row.id===task.project_id),role=options.profile?.work_roles.find(row=>row.id===task.work_role_id);
 item.append(el('p','State: '+taskStateLabels[task.state]+' · Task version '+task.task_version),el('p','Project: '+(project?.display_name??task.project_id??'Unspecified')),el('p','Work role: '+(role?.display_name??task.work_role_id??'Unspecified')),el('p','Assigned logical agent: '+(task.assigned_agent_id??'Unassigned')));
 if(task.active_run_id)item.append(el('p','Observed active run: '+task.active_run_id+' — not runtime presence'));
 if(task.flags.includes('outcome_unknown'))item.append(el('p','External outcome unknown — reconciliation required',{class:'notice'}));
 if(task.flags.includes('retry_exhausted'))item.append(el('p','Retry limit exhausted',{class:'notice'}));
 if(task.flags.includes('approval_expired'))item.append(el('p','Prior approval expired',{class:'notice'}));
 return item;
}
/** Read-only projection: it owns no transport, persistence, authority or mutation callbacks. */
export function FactoryExplorer(options:FactoryExplorerOptions):HTMLElement{
 const profileState=options.profileRead??{status:'unavailable',data:null,observedAt:null,requestId:null,errorCode:'PROFILE_READ_UNAVAILABLE'} as const;
 // Metadata remains independently sourced; an unavailable profile cannot label authorized task IDs.
 const profileAllowed=profileState.data!==null&&(profileState.status==='ready'||profileState.status==='stale');
 options={...options,profile:profileAllowed?options.profile:null};
 const {state,workspaceId}=options,root=el('div',undefined,{class:'factory-explorer','data-testid':'factory-explorer'});
 const overview=surface('factory-overview','Factory overview');
 overview.append(el('p','Read-only evidence explorer. Departments are authorized project/work-role labels, not authority or runtime locations.',{class:'notice'}),el('p','Filters apply only to the loaded pages. Each state is independently observed; matching counts are not workspace totals.'),filterControl(options,'project'),filterControl(options,'workRole'));
 const profileSource=taskReadSection('factory-profile','Department label source',profileState,'/v2/workspaces/'+encodeURIComponent(workspaceId)+'/profile');profileSource.append(el('p','Project and work-role names are presentation metadata with their own observation time; they confer no authority.'));overview.append(profileSource);
 if(!options.profile)overview.append(el('p','Profile labels unavailable; authorized task reference IDs remain visible.'));
 const columns=el('div',undefined,{class:'task-board'});
 for(const name of taskStates){
  const page=state.columns[name],read=state.capabilities.tasks?page.read.state:unavailableTaskRead(page.read.state,'TASKS_READ_UNAVAILABLE');
  const column=taskReadSection('factory-tasks-'+name,taskStateLabels[name],read,'/v2/workspaces/'+encodeURIComponent(workspaceId)+'/tasks?state='+name+'&limit='+taskPageLimit);
  const rows=loadedTasks(options,name).filter(task=>(options.projectId===null||task.project_id===options.projectId)&&(options.workRoleId===null||task.work_role_id===options.workRoleId));
  if(read.data!==null){
   column.append(el('p',rows.length+' matching tasks on this page — not a workspace total'));
   if(rows.length){const list=el('ul',undefined,{class:'records'});for(const task of rows)list.append(taskCard(task,options));column.append(list);}
   else column.append(el('p','No matching tasks on this page. Other pages or unavailable sections may contain work.'));
   column.append(el('p',page.page===null?'Page boundary unavailable; refresh current reads.':page.page.has_more?'Partial traversal — another authorized page is available.':'End of observed page traversal; not a workspace-wide count.'));
  }
  if(name==='waiting')column.append(el('p','Retained Waiting state only: human decision execution is not implemented.',{class:'notice'}));
  if(name==='cancelled')column.append(el('p','Cancelled archive. Cancellation does not prove external effects were undone.'));
  if(state.capabilities.tasks&&page.page?.has_more){const next=button('Next '+taskStateLabels[name]+' page',()=>options.onNext(name),{'data-focus-key':'factory-next:'+name,class:'secondary'});if(read.status!=='ready'&&read.status!=='empty')next.setAttribute('disabled','');column.append(next);}
  columns.append(column);
 }
 overview.append(columns);root.append(overview);
 const workstation=surface('factory-workstation','Workstation'),evidence=surface('factory-evidence','QC / evidence');
 workstation.append(el('p','Runtime presence: Unavailable — no public runtime presence read. File activity and execution locations are not reported by this view.'));
 evidence.append(el('p','Results and artifact metadata are recorded evidence, not independently verified test execution. Artifact bytes and reported content are not automatically fetched.'));
 const candidate=state.capabilities.tasks?state.task.state.data:null,task=candidate?.workspace_id===workspaceId&&candidate.id===state.selectedId?candidate:null;
 if(state.selectedId){
  workstation.append(button('Back to Factory overview',options.onBack,{'data-focus-key':'factory-back',class:'secondary'}));
  if(task){workstation.append(el('h3',task.title),el('p','Task: '+task.id+' · State: '+taskStateLabels[task.state]+' · Task version '+task.task_version),el('p','Assigned logical agent: '+(task.assigned_agent_id??'Unassigned')),el('p','Retry count: '+task.retry_count+' / '+task.retry_limit+' — native execution retry counter, not review rounds'),el('p','Review-loop budget: Unavailable'),button('Open existing task controls',options.onOpenExistingTask,{'data-focus-key':'factory-open-controls',class:'secondary'}));}
  const detail=TaskDetail({state,workspaceId,onResultsNext:options.onResultsNext,onEventsNext:options.onEventsNext,onBack:options.onBack,nowMs:options.nowMs});
  // Reuse canonical independently sourced sections, omitting its board navigation and all action affordances.
  for(const section of Array.from(detail.children)){
   const id=section.getAttribute('data-testid');if(id==='task-run')workstation.append(section);else if(id)evidence.append(section);
  }
 }else{workstation.append(el('p','Select a task to inspect its independently authorized run.'));evidence.append(el('p','Select a task to inspect current and historical result evidence.'));}
 root.append(workstation,evidence);return root;
}
