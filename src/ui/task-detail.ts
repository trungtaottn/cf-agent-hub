import type {Event,Task,TaskResult} from '../http/dto';
import type {TaskReadView} from './task-reads';
import {taskPageLimit} from './task-reads';
import {taskReadSection,unavailableTaskRead,taskStateLabels} from './kanban';
import {el,button} from './dom';

export interface TaskDetailOptions {state:TaskReadView;workspaceId:string;onResultsNext:()=>void;onEventsNext:()=>void;onBack:()=>void;nowMs?:number;}
function relevantEvent(event:Event,task:Task,workspaceId:string):boolean{
  if(event.workspace_id!==workspaceId||event.task_version===null||event.task_version>task.task_version)return false;
  const runs=new Set([task.active_run_id,task.latest_run_id,task.result?.run_id].filter((id):id is string=>Boolean(id)));
  return event.resource_type==='task'&&event.resource_id===task.id&&(event.run_id===null||runs.has(event.run_id))||
    event.resource_type==='run'&&event.run_id!==null&&event.resource_id===event.run_id&&runs.has(event.run_id);
}
function resultEvidence(result:TaskResult,current:boolean):HTMLElement{
  const item=el('li');item.append(el('h3',current?'Current result':'Historical result'),el('p',result.summary),el('p','Run: '+result.run_id),el('p','Submitted by: '+result.submitted_by.principal_id+' · '+result.submitted_by.kind),el('p','Submitted: '+result.submitted_at));
  const ids=el('ul',undefined,{class:'records'});for(const id of result.artifact_ids.slice(0,5))ids.append(el('li','Artifact reference: '+id));item.append(ids);return item;
}
function nextButton(label:string,key:string,action:()=>void,enabled:boolean):HTMLElement{
  const control=button(label,action,{class:'secondary','data-focus-key':key});if(!enabled)control.setAttribute('disabled','');return control;
}
export function TaskDetail({state,workspaceId,onResultsNext,onEventsNext,onBack,nowMs=Date.now()}:TaskDetailOptions):HTMLElement{
  const root=el('div',undefined,{class:'task-detail'}),source='/v2/workspaces/'+encodeURIComponent(workspaceId);
  root.append(button('Back to task board',onBack,{class:'secondary','data-focus-key':'task-back'}));
  const candidate=state.capabilities.tasks?state.task.state.data:null;
  const task=candidate?.id===state.selectedId&&candidate.workspace_id===workspaceId?candidate:null;
  const taskPath=source+'/tasks/'+encodeURIComponent(state.selectedId??'');
  const taskRead=state.capabilities.tasks?state.task.state:unavailableTaskRead(state.task.state,'TASKS_READ_UNAVAILABLE');
  const info=taskReadSection('task-detail','Task detail',taskRead,taskPath);
  const events=task&&state.capabilities.events?(state.events.read.state.data??[]).slice(0,taskPageLimit).filter(event=>relevantEvent(event,task,workspaceId)):[];
  if(task){
    info.append(el('h3',task.title),el('p',task.description),el('p','State: '+taskStateLabels[task.state]+' · Task version '+task.task_version),el('p','Assigned agent: '+(task.assigned_agent_id??'Unassigned')));
    if(task.result){
      const list=el('ul',undefined,{class:'records'});list.append(resultEvidence(task.result,true));info.append(list);
      const acceptance=events.find(event=>event.type==='task.result_accepted'&&event.resource_type==='task'&&event.resource_id===task.id&&event.run_id===task.result!.run_id);
      info.append(el('p',acceptance?'Acceptance evidence: '+acceptance.actor.principal_id+' at '+acceptance.occurred_at+' — independently observed event at task version '+acceptance.task_version+'. Task and event responses have independent observation times.':'Acceptance actor/time not observed in this page; absence is not proof that no acceptance exists.'));
    }else info.append(el('p','No current result in this task response. Retained results below are historical.'));
    if(task.state==='waiting'){
      info.append(el('p','R3 unavailable — human decision execution is not implemented. A retained approval reference is not current approval authority.',{class:'notice'}),button('Approve',()=>{},{disabled:'','aria-disabled':'true'}),button('Reject',()=>{},{disabled:'','aria-disabled':'true'}));
    }
  }
  root.append(info);

  const runRead=task?state.run.state:unavailableTaskRead(state.run.state,'TASK_NOT_AVAILABLE');
  const run=task&&state.run.state.data?.workspace_id===workspaceId&&state.run.state.data.task_id===task.id&&state.run.state.data.id===task.latest_run_id?state.run.state.data:null;
  const runSection=taskReadSection('task-run','Latest run and observed lease',runRead,task?.latest_run_id?source+'/runs/'+encodeURIComponent(task.latest_run_id):'No latest run in the current task response');
  runSection.append(el('p','Runtime presence: Unavailable — no public runtime presence read'));
  if(run){
    const deadline=Date.parse(run.lease_expires_at),relative=nowMs>=deadline?'Browser clock is past the observed lease deadline':'Browser clock is before the observed lease deadline';
    runSection.append(el('p','Run: '+run.id+' · Status: '+run.status+' · Run version '+run.run_version),el('p','Logical agent: '+run.agent_id),el('p','Runtime instance: '+run.runtime_instance_id),el('p','Fence: '+run.fence),el('p','Observed lease deadline: '+run.lease_expires_at),el('p',relative+'; this is not a live lease or presence authorization check.'));
  }
  root.append(runSection);

  const resultsRead=task?state.results.read.state:unavailableTaskRead(state.results.read.state,'TASK_NOT_AVAILABLE');
  const history=taskReadSection('task-results','Retained result evidence',resultsRead,taskPath+'/results?limit='+taskPageLimit);
  if(task&&resultsRead.data!==null){
    const results=state.results.read.state.data??[],list=el('ul',undefined,{class:'records'});
    for(const result of results.slice(0,taskPageLimit))list.append(resultEvidence(result,task.result?.run_id===result.run_id));history.append(list);
    history.append(el('p',results.length===0?'No visible retained results on this page.':'Showing '+Math.min(results.length,taskPageLimit)+' results on this page, not total retained history.'));
  }
  if(task&&state.results.page?.has_more)history.append(nextButton('Next results page','next-task-results',onResultsNext,resultsRead.status==='ready'||resultsRead.status==='empty'));
  root.append(history);

  const eventRead=task&&state.capabilities.events?state.events.read.state:unavailableTaskRead(state.events.read.state,'EVENTS_READ_UNAVAILABLE');
  const eventSection=taskReadSection('task-events','Authorized event evidence',eventRead,source+'/events?limit='+taskPageLimit);
  eventSection.append(el('p','This bounded workspace event page is filtered to the selected task and its observed runs. It is not complete task history.'));
  if(task&&state.capabilities.events&&eventRead.data!==null){
    const list=el('ol',undefined,{class:'records'});for(const event of events){const item=el('li');item.append(el('h3',event.summary),el('p',event.type+' · Task version '+event.task_version),el('p','Actor: '+event.actor.principal_id+' · Recorded: '+event.occurred_at));list.append(item);}eventSection.append(list);
    if(events.length===0)eventSection.append(el('p','No matching task evidence observed in this page; this is not proof that no events exist.'));
  }
  if(task&&state.capabilities.events&&state.events.page?.has_more)eventSection.append(nextButton('Next events page','next-task-events',onEventsNext,eventRead.status==='ready'||eventRead.status==='empty'));
  root.append(eventSection);

  const artifactRead=task&&state.capabilities.artifacts?state.artifacts.state:unavailableTaskRead(state.artifacts.state,'ARTIFACTS_READ_UNAVAILABLE');
  const artifacts=taskReadSection('task-artifacts','Current result artifact metadata',artifactRead,source+'/artifacts/{artifact_id} (current result references only)');
  if(task&&state.capabilities.artifacts&&artifactRead.data!==null){
    const currentIds=new Set(task.result?.artifact_ids??[]),list=el('ul',undefined,{class:'records'});
    const visible=(state.artifacts.state.data??[]).filter(artifact=>artifact.workspace_id===workspaceId&&currentIds.has(artifact.id)&&(artifact.task_id===null||artifact.task_id===task.id)&&(artifact.run_id===null||artifact.run_id===task.result?.run_id)).slice(0,5);
    for(const artifact of visible){const item=el('li');item.append(el('h3',artifact.filename),el('p','Artifact: '+artifact.id+' · '+artifact.status),el('p',artifact.media_type+' · '+artifact.byte_size+' bytes'));list.append(item);}artifacts.append(list);
    if(visible.length===0)artifacts.append(el('p','No current result artifact metadata observed.'));
  }
  artifacts.append(el('p','Metadata only. No artifact bytes or embedded URLs are fetched.'));root.append(artifacts);
  return root;
}
