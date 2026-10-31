import type {Task,TaskState,WorkspaceProfile} from '../http/dto';
import type {ReadState} from './read-state';
import {taskPageLimit,taskStates,type TaskReadView} from './task-reads';
import {el,button} from './dom';
import {taskActionDisclosure,type TaskActionAffordances} from './task-action-view';

export interface KanbanViewOptions {state:TaskReadView;workspaceId:string;profile:WorkspaceProfile|null;onSelect:(id:string)=>void;onNext:(state:TaskState)=>void;actions?:TaskActionAffordances;}
export const taskStateLabels:Record<TaskState,string>={backlog:'Backlog',ready:'Ready',doing:'Doing',waiting:'Waiting',review:'Review',done:'Done',cancelled:'Cancelled archive'};
const statusLabels:Record<string,string>={
  loading:'Loading — waiting for an authenticated response',ready:'Current response',empty:'Successful empty response',
  stale:'Stale — showing the last successful observation',forbidden:'Access denied — current authority is required',
  error:'Read failed — no successful result is available',disconnected:'Disconnected — no cached observation is available',
  unavailable:'Unavailable — this read capability has not been reported'
};
/** Each independently authorized observation retains its own source and timestamp. */
export function taskReadSection(name:string,title:string,state:Readonly<ReadState<unknown>>,endpoint:string):HTMLElement{
  const section=el('section',undefined,{class:'card','data-testid':name,'data-status':state.status,'aria-label':title});
  section.append(el('h2',title),el('p',statusLabels[state.status]??'Unavailable',{class:'status',role:'status','data-state':state.status}));
  if(state.errorCode)section.append(el('p','Error: '+state.errorCode,{class:'muted'}));
  const evidence=el('div',undefined,{class:'evidence'});
  evidence.append(el('div','Source: '+endpoint));
  if(state.observedAt)evidence.append(el('span','Last successful response observed: '),el('time',state.observedAt,{datetime:state.observedAt}));
  else evidence.append(el('div','Observed: Not reported'));
  evidence.append(el('div','Request: '+(state.requestId??'Not reported')));section.append(evidence);return section;
}
export function unavailableTaskRead(state:Readonly<ReadState<unknown>>,code:string):Readonly<ReadState<unknown>>{
  if(state.status==='forbidden')return {...state,data:null};
  return {status:'unavailable',data:null,observedAt:null,requestId:null,errorCode:code};
}
const flags:Record<Task['flags'][number],string>={retry_exhausted:'Retry limit exhausted',outcome_unknown:'External outcome unknown — reconciliation required',approval_expired:'Prior approval expired'};
function taskCard(task:Task,workspaceId:string,profile:WorkspaceProfile|null,onSelect:(id:string)=>void,actions?:TaskActionAffordances,current=false):HTMLElement{
  const item=el('li',undefined,{class:'task-card'}),heading=el('h3');
  const query=new URLSearchParams({workspace:workspaceId,task:task.id});
  const link=el('a',task.title,{href:'/tasks?'+query.toString(),'data-focus-key':'task:'+task.id});
  link.addEventListener('click',event=>{event.preventDefault();onSelect(task.id);});heading.append(link);item.append(heading);
  item.append(el('p','State: '+taskStateLabels[task.state]+' · Task version '+task.task_version));
  if(task.project_id)item.append(el('p','Project: '+(profile?.projects.find(project=>project.id===task.project_id)?.display_name??task.project_id)));
  if(task.work_role_id)item.append(el('p','Work role: '+(profile?.work_roles.find(role=>role.id===task.work_role_id)?.display_name??task.work_role_id)));
  item.append(el('p','Assigned agent: '+(task.assigned_agent_id??'Unassigned')));
  if(task.active_run_id)item.append(el('p','Observed active run: '+task.active_run_id+' — inspect detail for lease evidence'));
  for(const flag of task.flags)item.append(el('p',flags[flag],{class:'notice'}));
  if(task.state==='waiting')item.append(el('p','R3 unavailable — decision controls are not implemented'));
  if(task.state==='cancelled')item.append(el('p','Cancellation reason is not exposed by the public read contract'));
  if(actions)item.append(taskActionDisclosure(task,current,actions));
  return item;
}
export function KanbanView({state,workspaceId,profile,onSelect,onNext,actions}:KanbanViewOptions):HTMLElement{
  const root=el('div',undefined,{class:'task-board','data-testid':'task-board'});
  root.append(el('p',actions?'Commands require a fresh authorized task read and explicit confirmation. Each column is an independent authorized page, not a workspace total. Hiding this view does not pause task execution.':'Read-only board. Each column is an independent authorized page, not a workspace total. Hiding this view does not pause task execution.',{class:'notice'}));
  let dragged:{task:Task;source:HTMLElement;operation:'readyTask'|'acceptTaskResult'}|null=null;
  const source='/v2/workspaces/'+encodeURIComponent(workspaceId)+'/tasks';
  for(const name of taskStates){
    const page=state.columns[name],read=state.capabilities.tasks?page.read.state:unavailableTaskRead(page.read.state,'TASKS_READ_UNAVAILABLE');
    const section=taskReadSection('tasks-'+name,taskStateLabels[name],read,source+'?state='+name+'&limit='+taskPageLimit);
    const tasks=state.capabilities.tasks?(page.read.state.data??[]).filter(task=>task.workspace_id===workspaceId&&task.state===name).slice(0,taskPageLimit):[];
    if(read.data!==null){
      section.append(el('p',tasks.length+' tasks on this page — not a workspace total',{class:'muted'}));
      if(tasks.length===0)section.append(el('p','No tasks on this page. This does not prove that the workspace is empty.'));
      else{const list=el('ul',undefined,{class:'records'});for(const task of tasks){
        const current=read.status==='ready',card=taskCard(task,workspaceId,profile,onSelect,actions,current);
        const operation=task.state==='backlog'?'readyTask':task.state==='review'?'acceptTaskResult':null;
        if(actions&&operation&&actions.disabledReason(task,operation,current)===null){
          card.setAttribute('draggable','true');
          card.addEventListener('dragstart',event=>{if(!event.dataTransfer)return;dragged={task,source:card,operation};event.dataTransfer.setData('application/x-agenthub-task',workspaceId+':'+task.id);event.dataTransfer.effectAllowed='move';});
          card.addEventListener('dragend',()=>{dragged=null;});
        }
        list.append(card);
      }section.append(list);}
      section.append(el('p',page.page===null?'Page boundary unavailable; refresh reads to reauthorize.':page.page.has_more?'Partial traversal — another authorized page is available.':'End of the observed page traversal; this is not a workspace-wide count.',{class:'muted'}));
    }
    if(name==='waiting')section.append(el('p','R3 unavailable — human decision execution is not implemented.',{class:'notice'}),button('Approve',()=>{},{disabled:'','aria-disabled':'true'}),button('Reject',()=>{},{disabled:'','aria-disabled':'true'}));
    if(state.capabilities.tasks&&page.page?.has_more){
      const next=button('Next '+taskStateLabels[name]+' page',()=>onNext(name),{'data-focus-key':'next-tasks:'+name,class:'secondary'});
      if(read.status!=='ready'&&read.status!=='empty')next.setAttribute('disabled','');section.append(next);
    }
    if(actions&&(name==='ready'||name==='done')){
      const allowed=()=>dragged!==null&&dragged.task.workspace_id===workspaceId&&(name==='ready'&&dragged.operation==='readyTask'||name==='done'&&dragged.operation==='acceptTaskResult');
      section.addEventListener('dragover',event=>{if(allowed())event.preventDefault();});
      section.addEventListener('drop',event=>{
        if(!allowed()||!dragged||event.dataTransfer?.getData('application/x-agenthub-task')!==workspaceId+':'+dragged.task.id)return;
        event.preventDefault();const original=dragged;dragged=null;actions.open(original.task.id,original.operation,original.source);
      });
    }
    root.append(section);
  }
  return root;
}
