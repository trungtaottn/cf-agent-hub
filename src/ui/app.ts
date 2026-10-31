import {MessageComposition} from './compose/message-form';
import {MessageForm} from './compose/message-form-view';
import {TaskComposition} from './compose/task-form';
import {TaskForm} from './compose/task-form-view';
import {CompositionStorage} from './compose/composition-storage';
import {HubClient} from '../../packages/client/src/client';
import type {ApiResult,Workspace,AuthSession,AuthStartData,Configuration,ProfileData,PreferencesData,Operations,Event,Message,Operation,OperationInputs,RequestOptions} from '../../packages/client/src/types';
import {ReadModel,summarizeReadStates,type ReadState} from './read-state';
import {SettingsPanel} from './settings';
import {el,button,replacePreservingFocus} from './dom';
import {TaskReads} from './task-reads';
import {KanbanView} from './kanban';
import {TaskDetail} from './task-detail';
import {TaskActions,taskActionEligibility} from './task-actions';
import {TaskActionPanel,type TaskActionAffordances} from './task-action-view';
import type {BrowserReadRequest} from '../../packages/client/src/types';

const byId=(id:string)=>document.getElementById(id)!;
const workspace=document.body.dataset.workspace??'';
const view=byId('view'),sessionElement=byId('session'),navigation=byId('navigation'),notice=byId('notice');
const models={
 workspace:new ReadModel<Workspace>({isEmpty:()=>false}),
 configuration:new ReadModel<Configuration>({isEmpty:()=>false}),profile:new ReadModel<ProfileData>({isEmpty:()=>false}),
 preferences:new ReadModel<PreferencesData>({isEmpty:()=>false}),events:new ReadModel<Event[]>({isEmpty:items=>items.length===0}),
 operations:new ReadModel<Operations>({isEmpty:()=>false}),thread:new ReadModel<Message[]>({isEmpty:items=>items.length===0})
};
let connectionGeneration=0;
let client:HubClient,authority=0,session:AuthSession|null=null,denied=false,currentView=location.pathname.slice(1)||'overview',threadId:string|null=null,eventCursor:string|null=null,threadCursor:string|null=null;
let eventsAvailable=false,operationsAvailable=false,profileAvailable=false,preferencesAvailable=false,tasksAvailable=false;
let messageComposition:MessageComposition|null=null,messageForm:MessageForm|null=null,composeViewGeneration=0;
let taskComposition:TaskComposition|null=null,taskForm:TaskForm|null=null,lastTaskAdmission:string|null=null;
let composeScope:{workspaceId:string;principalId:string}|null=null;
const compositionStorage=new CompositionStorage(undefined,()=>hideComposition(),()=>{if(denied)notice.textContent=compositionStorage.failed?'Visible state cleared, but local draft erasure failed. Composition remains blocked.':'Visible state cleared. This does not cancel server writes already sent.';render();});
const composeChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('cfhub-compose-clear-v1'):null;
function compositionBinding(){return session?.actor.kind==='human'&&!denied&&navigator.onLine&&!compositionStorage.blocked?{workspaceId:workspace,principalId:session.actor.principal_id,generation:connectionGeneration}:null;}
function hideComposition(){++composeViewGeneration;messageComposition?.invalidate();taskComposition?.invalidate();if(messageForm)messageForm.element.hidden=true;if(taskForm)taskForm.element.hidden=true;lastTaskAdmission=null;}
function eraseComposition(broadcast=true){
 const scope=composeScope;hideComposition();
 if(broadcast&&scope)composeChannel?.postMessage({type:'erase',...scope});
 if(scope)void compositionStorage.erase(scope);
}
composeChannel?.addEventListener('message',event=>{const value=event.data;if(value&&typeof value==='object'&&value.type==='erase'&&value.workspaceId===workspace&&typeof value.principalId==='string'&&value.principalId===(composeScope?.principalId??session?.actor.principal_id)){eraseComposition(false);++connectionGeneration;notice.textContent='Composition cleared in another tab. Refresh current session before composing.';}});
async function verifyCompositionAuthority(kind:'message'|'task'|'upload'='message'):Promise<boolean>{
 const generation=authority,connection=connectionGeneration,principal=session?.actor.principal_id;
 const auth=await compositionRequest(()=>client.request<AuthSession>('getAuthSession',{}),true);
 if(!auth.ok||generation!==authority||connection!==connectionGeneration)return false;
 if(auth.data.actor.kind!=='human'||auth.data.actor.principal_id!==principal){invalidateAll(401,auth.requestId);return false;}
 const access=await compositionRequest(()=>client.request<Workspace>('getWorkspace',{}),true);
 if(!access.ok||generation!==authority||connection!==connectionGeneration)return false;
 if(access.data.id!==workspace||access.data.actor.principal_id!==principal){invalidateAll(401,access.requestId);return false;}
 if(!(kind==='task'?['tasks:create'] as const:['messages:send','messages:read','agents:read'] as const).every(scope=>access.data.effective_scopes.includes(scope))){invalidateAll(403,access.requestId);return false;}
 if(kind==='upload'&&!(['artifacts:read','artifacts:write'] as const).every(scope=>access.data.effective_scopes.includes(scope)))return false;
 client.setCsrfToken(auth.data.csrf_token);return true;
}
async function openComposition(replyThread?:string){
 hideComposition();const viewGeneration=composeViewGeneration;
 if(viewGeneration!==composeViewGeneration||!compositionBinding()||!models.workspace.state.data?.effective_scopes.includes('messages:send')||(!models.workspace.state.data.effective_scopes.includes('messages:read')||!models.workspace.state.data.effective_scopes.includes('agents:read')))return;
 if(!messageComposition){
  const store=compositionStorage.store;
  messageComposition=new MessageComposition({store,currentBinding:compositionBinding,changed:()=>messageForm?.update(),read:(operation,input,options)=>compositionRequest(()=>client.read(operation,input,options)),
   getThread:id=>compositionRequest(()=>client.request<Message[]>('getThread',{thread_id:id,limit:100})),
   canUpload:()=>models.workspace.state.status==='ready'&&(['artifacts:read','artifacts:write'] as const).every(scope=>models.workspace.state.data?.effective_scopes.includes(scope)),
   artifact:(operation,input,options)=>compositionRequest(()=>client.artifact(operation,input,options)),verifyUploadAuthority:()=>verifyCompositionAuthority('upload'),
   verifyAuthority:()=>verifyCompositionAuthority('message'),
   prepare:(operation,input,options)=>compositionRequest(()=>client.prepareCreation(operation,input,options),true),
   reconcile:(operation,input,options)=>compositionRequest(()=>client.reconcileCreation(operation,input,options),true),
   send:async(operation,input,options)=>{const result=await compositionRequest(()=>client.compose(operation,input,options));if(!result.ok&&result.status===403)await verifyCompositionAuthority('message');return result;}});
  messageForm=new MessageForm(messageComposition,id=>{hideComposition();navigate('activity',id);});byId('main').append(messageForm.element);
 }
 composeScope={workspaceId:workspace,principalId:session!.actor.principal_id};await messageComposition.open();if(replyThread&&viewGeneration===composeViewGeneration)await messageComposition.selectThread(replyThread);if(viewGeneration!==composeViewGeneration||messageComposition.state.status==='inactive')return;messageForm!.update();messageForm!.element.hidden=false;messageForm!.body.focus();
}


// Optional resource-read denial is field-local; tasks:create never implies picker read scopes.
async function compositionRequest<T>(call:()=>Promise<ApiResult<T>>,deny403=false):Promise<ApiResult<T>>{
 const started=authority,connection=connectionGeneration,viewGeneration=composeViewGeneration,result=await call();
 // Fence before side effects: a late denial must not erase a newer session/form.
 if(started!==authority||connection!==connectionGeneration||viewGeneration!==composeViewGeneration)return {ok:false,status:null,requestId:result.requestId,error:{code:'OBSERVATION_INVALIDATED',message:'Observation no longer current',retryable:false}};
 if(!result.ok&&(result.status===401||deny403&&result.status===403))invalidateAll(result.status as 401|403,result.requestId);
 return result;
}
const readTaskComposition:BrowserReadRequest=(operation,input,options)=>compositionRequest(()=>client.read(operation,input,options));
function taskCompositionChanged(){
 taskForm?.update();const state=taskComposition?.state;
 const id=state?.status==='confirmed'?state.entry?.intent?.entityId:null;
 if(id&&taskComposition?.currentTask&&id!==lastTaskAdmission){lastTaskAdmission=id;if(tasksAvailable&&!denied)void taskReads.refreshBoard();}
}
async function openTaskComposition(){
 hideComposition();const viewGeneration=composeViewGeneration;
 if(!compositionBinding()||models.workspace.state.status!=='ready'||!models.workspace.state.data?.effective_scopes.includes('tasks:create'))return;
 if(!taskComposition){
  taskComposition=new TaskComposition({store:compositionStorage.store,currentBinding:compositionBinding,changed:taskCompositionChanged,
   verifyAuthority:()=>verifyCompositionAuthority('task'),read:readTaskComposition,
   getProfile:()=>compositionRequest(()=>client.request<ProfileData>('getProfile',{})),
   prepare:(operation,input,options)=>compositionRequest(()=>client.prepareCreation(operation,input,options)),
   reconcile:(operation,input,options)=>compositionRequest(()=>client.reconcileCreation(operation,input,options)),
   send:(operation,input,options)=>compositionRequest(()=>client.compose(operation,input,options))});
  taskForm=new TaskForm(taskComposition,id=>{hideComposition();navigateTask(id);});taskForm.element.hidden=true;byId('main').append(taskForm.element);
 }
 composeScope={workspaceId:workspace,principalId:session!.actor.principal_id};await taskComposition.open();
 if(viewGeneration!==composeViewGeneration||taskComposition.state.status==='inactive')return;taskForm!.update();taskForm!.element.hidden=false;taskForm!.title.focus();
}

const taskReads=new TaskReads({workspaceId:workspace,request:(async(operation,input,options)=>{
 const started=authority,result=await client.read(operation,input,options);
 if(!result.ok&&(result.status===401||result.status===403)){invalidateAll(result.status,result.requestId);return result;}
 if(started!==authority)return {ok:false,status:null,requestId:result.requestId,error:{code:'OBSERVATION_INVALIDATED',message:'Observation no longer current',retryable:false}};
 return result;
}) as BrowserReadRequest,changed:()=>render()});
const taskActions=new TaskActions({
 workspaceId:workspace,
 currentBinding:()=>session&&!denied?{principalId:session.actor.principal_id,agentId:session.actor.agent_id,generation:connectionGeneration,online:navigator.onLine}:null,
 readAccess:async()=>{
  const result=await request<Workspace>('getWorkspace',{});
  if(result.ok){await models.workspace.refresh(async()=>result);render();}
  return result;
 },
 readTask:async id=>{const result=await readCommandPreparation('getTask',{path:{task_id:id}});if(!result.ok&&result.status===404)taskReads.forgetTask(id,result.requestId);return result;},
 readRun:id=>readCommandPreparation('getRun',{path:{run_id:id}}),
 command:async(operation,input,options)=>{
  const result=await client.command(operation,input,options);
  if(!result.ok&&(result.status===401||result.status===403))invalidateAll(result.status,result.requestId);
  return result;
 },
 changed:()=>{taskActionPanel?.update();render();},
 settled:state=>{
  if(state.status==='succeeded'&&state.result?.ok){
   const token=taskActionPanel.focusToken,id=state.taskId,targetState=state.result.data.task.state;
   void refreshReads().then(()=>{
    const current=taskReads.selectedId===id?taskReads.task.state:taskReads.columns[targetState].read.state;
    const visible=current.status==='ready'&&(Array.isArray(current.data)?current.data.some(task=>task.id===id):current.data?.id===id);
    const container=taskReads.selectedId===id?view:view.querySelector('[data-testid=tasks-'+targetState+']');
    const target=visible?[...(container?.querySelectorAll<HTMLElement>('[data-focus-key]')??[])].find(node=>node.getAttribute('data-focus-key')==='task:'+id)??null:null;
    taskActionPanel.restoreFocus(token,target);
   });
  }
  else if(state.status==='conflict')void refreshReads().then(()=>taskActions.refreshConflict());
 }
});
let taskActionPanel:TaskActionPanel;
taskActionPanel=new TaskActionPanel(taskActions,{workspaceId:workspace,viewKey:()=>currentView+':'+(taskReads.selectedId??''),fallback:()=>byId('main')});
byId('main').append(taskActionPanel.element);
const commandAffordances:TaskActionAffordances={
 disabledReason(task,operation,current){
  if(!session||denied)return 'Current authenticated authority required';
  if(!navigator.onLine||!current||models.workspace.state.status!=='ready')return 'Refresh current access and task observations';
  if(taskActions.state.status==='pending'||taskActions.state.status==='uncertain')return 'Reconcile the existing task command before starting another';
  return taskActionEligibility(operation,task,models.workspace.state.data?.effective_scopes??[],session.actor.principal_id,session.actor.agent_id);
 },
 open:(id,operation,invoker)=>taskActionPanel.open(id,operation,invoker)
};
const readCommandPreparation:BrowserReadRequest=async(operation,input,options)=>{
 const started=authority,result=await client.read(operation,input,options);
 if(!result.ok&&(result.status===401||result.status===403)){invalidateAll(result.status,result.requestId);return result;}
 if(started!==authority)return {ok:false,status:null,requestId:result.requestId,error:{code:'OBSERVATION_INVALIDATED',message:'Observation no longer current',retryable:false}};
 return result;
};
const source='/v2/workspaces/'+workspace;
const accents=['blue','teal','indigo','violet','amber','slate'];
const navigationLinks=new Map<string,HTMLAnchorElement>();
const settings=new SettingsPanel({
 request:<T>(operation:Operation,input:OperationInputs[Operation],options?:RequestOptions)=>request<T>(operation,input,options),
 profileSaved(result){void models.profile.refresh(async()=>result).then(async()=>{
  // A changed navigation profile can make a previously effective default unavailable.
  if(preferencesAvailable&&!denied)await models.preferences.refresh(()=>request<PreferencesData>('getPreferences',{}));
  applyPresentation();render();
 });},
 preferencesSaved(result){void models.preferences.refresh(async()=>result).then(()=>{applyPresentation();render();});}
});
function invalidateAll(status:401|403,id:string|null):void{
 eraseComposition();
 ++authority;++connectionGeneration;denied=true;session=null;client?.setCsrfToken(null);eventCursor=null;threadCursor=null;threadId=null;
 for(const model of Object.values(models))model.invalidate(status===401?'UNAUTHENTICATED':'FORBIDDEN',id);
 taskReads.invalidate(status===401?'UNAUTHENTICATED':'FORBIDDEN',id);tasksAvailable=false;
 taskActions.invalidateAuthority();taskActionPanel.navigation();
 settings.invalidate();eventsAvailable=false;operationsAvailable=false;profileAvailable=false;preferencesAvailable=false;
 document.documentElement.dataset.theme='system';document.documentElement.dataset.density='comfortable';delete document.documentElement.dataset.accent;
 byId('workspace-name').textContent='';notice.textContent=compositionStorage.erasing?'Visible private state cleared; local composition draft erasure is pending. Server writes already sent are not cancelled.':compositionStorage.failed?'Visible state cleared, but local draft erasure failed. Composition remains blocked.':'Visible cached records and settings drafts cleared. Server writes already sent are not cancelled.';
 renderSession();render();
}
async function request<T>(operation:Operation,input:OperationInputs[Operation],options?:RequestOptions):Promise<ApiResult<T>>{
 const started=authority,result=await client.request<T>(operation,input,options);
 if(!result.ok&&(result.status===401||result.status===403)){invalidateAll(result.status,result.requestId);return result;}
 if(started!==authority)return {ok:false,status:403,requestId:result.requestId,error:{code:'FORBIDDEN',message:'Access denied',retryable:false}};
 return result;
}
function renderSession():void{
 sessionElement.replaceChildren();
 if(session){
  sessionElement.append(el('span','Signed in as '+session.actor.principal_id),button('Sign out',async()=>{
   const result=await request('logoutAuth',{});if(result.ok)invalidateAll(401,result.requestId);
  },{class:'secondary'}));
 }else{
  sessionElement.append(el('span',denied?'Access denied. Sign in to refresh current authority.':'Sign in to read this workspace.'),button('Sign in',async()=>{
   const result=await request<AuthStartData>('startAuth',{return_path:currentView==='tasks'?'/tasks':currentView==='settings'?'/settings':currentView==='activity'?'/activity':'/overview'});
   if(result.ok)location.assign(result.data.authorization_url);else notice.textContent=result.error.message;
  }));
 }
}
function applyPresentation():void{
 const profile=models.profile.state.data,preferences=models.preferences.state.data;
 if(profile){
  byId('workspace-name').textContent=profile.profile.display_name;
  if(accents.includes(profile.profile.branding.accent))document.documentElement.dataset.accent=profile.profile.branding.accent;
 }
 if(preferences){document.documentElement.dataset.theme=preferences.effective.theme;document.documentElement.dataset.density=preferences.effective.density;}
}
function selectThread(id:string|null):void{
 if(threadId===id)return;
 models.thread.reset();threadCursor=null;threadId=id;
}
function navigate(name:string,selectedThread:string|null=null):void{
 hideComposition();
 taskActions.invalidatePreparation();taskActionPanel.navigation();
 currentView=name;selectThread(selectedThread);
 const query=new URLSearchParams({workspace});if(selectedThread)query.set('thread',selectedThread);
 history.pushState(null,'','/'+name+'?'+query.toString());
 if(name==='tasks'){void taskReads.select(null);void taskReads.refreshBoard();}
 render();byId('main').focus();
 if(selectedThread)void refreshThread(selectedThread,false);
}
function navigateTask(id:string|null):void{
 hideComposition();
 taskActions.invalidatePreparation();taskActionPanel.navigation();
 currentView='tasks';selectThread(null);const query=new URLSearchParams({workspace});if(id)query.set('task',id);
 history.pushState(null,'','/tasks?'+query.toString());void taskReads.select(id);render();byId('main').focus();
}
function renderNavigation():void{
 const visibleViews=models.profile.state.data?.profile.navigation.visible_views;
 const entries=([['overview','Overview'],['activity','Activity'],['tasks','Tasks'],['inbox','Inbox'],['settings','Settings']] as const).filter(([name])=>{
  // Overview is a permanent safe fallback; Settings is deliberately outside profile navigation.
  if(name==='overview')return true;
  if(name==='settings')return profileAvailable||preferencesAvailable||denied;
  if(name==='tasks')return tasksAvailable&&Boolean(visibleViews?.includes('tasks')||visibleViews?.includes('kanban'));
  if(visibleViews&&!visibleViews.includes(name))return false;
  if(name==='activity')return eventsAvailable||denied;
  return true;
 });
 const visible=new Set<string>(entries.map(([name])=>name));
 let removedFocusedLink=false;
 for(const [name,link]of navigationLinks)if(!visible.has(name)){
  if(document.activeElement===link)removedFocusedLink=true;
  link.remove();
 }
 // Keep retained links mounted: asynchronous reads and stale-state ticks must not steal keyboard focus.
 for(const [index,[name,label]]of entries.entries()){
  let link=navigationLinks.get(name);
  if(!link){
   link=el('a',label,{href:'/'+name+'?workspace='+encodeURIComponent(workspace)});
   link.addEventListener('click',event=>{event.preventDefault();navigate(name);});navigationLinks.set(name,link);
  }
  if(currentView===name&&!threadId)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  if(navigation.children.item(index)!==link)navigation.insertBefore(link,navigation.children.item(index));
 }
 if(removedFocusedLink)navigationLinks.get('overview')?.focus();
}
const statuses:Record<ReadState<unknown>['status'],string>={
 loading:'Loading — waiting for an authenticated response',ready:'Current response',empty:'Successful empty response',
 stale:'Stale — showing the last successful observation',forbidden:'Access denied — current authority is required',
 error:'Read failed — no successful result is available',disconnected:'Disconnected — no cached observation is available',unavailable:'Unavailable — no authorized resource or supported capability'
};
function section<T>(name:string,title:string,state:Readonly<ReadState<T>>,endpoint:string,content:(data:T,card:HTMLElement)=>void,emptyText?:string):HTMLElement{
 const card=el('section',undefined,{class:'card','data-testid':name+'-section','data-status':state.status,'aria-label':title});
 card.append(el('h2',title),el('p',statuses[state.status],{class:'status','data-state':state.status,role:'status'}));
 if(state.data!==null){
  if(state.status==='empty'&&emptyText)card.append(el('p',emptyText));else content(state.data,card);
 }
 if(state.errorCode)card.append(el('p','Error: '+state.errorCode,{class:'muted'}));
 const evidence=el('div',undefined,{class:'evidence'});
 evidence.append(el('div','Source: '+endpoint));
 if(state.observedAt)evidence.append(el('span','Last successful response observed: '),el('time',new Date(state.observedAt).toLocaleString(),{datetime:state.observedAt}));
 else evidence.append(el('div','Observed: Not reported'));
 evidence.append(el('div','Request: '+(state.requestId??'Not reported')));card.append(evidence);return card;
}
function eventSection():HTMLElement{
 const card=section('events','Persisted activity',models.events.state,source+'/events',(events,container)=>{
  const list=el('ol',undefined,{class:'records'});
  for(const event of events){
   const item=el('li');item.append(el('h3',event.summary),el('p',event.type+' · Sequence '+event.sequence,{class:'muted'}),el('p','Recorded: '+event.occurred_at,{class:'muted'}));
   if(event.thread_id!==null){
    const link=el('a','Read thread',{href:'/activity?workspace='+encodeURIComponent(workspace)+'&thread='+encodeURIComponent(event.thread_id)});
    link.addEventListener('click',click=>{click.preventDefault();navigate('activity',event.thread_id);});item.append(link);
   }
   list.append(item);
  }
  container.append(list);
 },'No activity recorded in this authorized response. New persisted events will appear after a successful refresh.');
 if(eventCursor&&!denied)card.append(button('Load more activity',()=>void refreshEvents(true),{class:'secondary'}));
 return card;
}
function configurationSection():HTMLElement{
 return section('configuration','Workspace configuration',models.configuration.state,source+'/configuration',(data,card)=>{
  card.append(el('p','Profile revision '+data.profile_revision+' · Configuration epoch '+data.config_epoch),el('p','Enabled R1 features: '+data.enabled_features.join(', '),{class:'muted'}));
  const metrics=el('dl',undefined,{class:'metrics'});
  metrics.append(el('dt','Registered agents'),el('dd','Not reported',{'data-testid':'agents-evidence'}),el('dt','Task progress'),el('dd','Not reported'));
  card.append(metrics,el('p','The R1 configuration endpoint does not report agent counts or task progress.',{class:'muted'}));
 });
}
function operationsSection():HTMLElement{
 return section('operations','Delivery and scheduler evidence',models.operations.state,source+'/operations',(data,card)=>{
  const metrics=el('dl',undefined,{class:'metrics'});
  for(const [label,value]of [['Pending transport',data.outbox.pending_count],['In-flight transport',data.outbox.in_flight_count],['Failed transport',data.outbox.failed_count],['Suppressed before retry',data.outbox.suppressed_count]] as const)metrics.append(el('dt',label),el('dd',String(value)));
  card.append(metrics,el('p','These are persisted outbox transport states. They do not establish recipient ACK or task completion.',{class:'muted'}),el('p','Readiness: '+(data.readiness.ready?'Ready':'Not ready')+' · Checks: '+data.readiness.checks.map(check=>check.name+' '+check.status+' ('+check.code+')').join(', '),{class:'muted'}),el('p','Server observed: '+data.observed_at,{class:'muted'}));
 });
}
function threadSection():HTMLElement{
 const card=section('thread','Thread history',models.thread.state,source+'/threads/'+encodeURIComponent(threadId??''),(messages,container)=>{
  const list=el('ol',undefined,{class:'records'});
  for(const message of messages){
   const item=el('li');item.append(el('h3','Message '+message.id),el('p','Sender: '+message.sender.principal_id,{class:'muted'}),el('p',message.body,{class:'message-body'}));
   const labels=el('div',undefined,{class:'record-labels'});labels.append(el('span','Stored: '+message.created_at),el('span','Transport: Not reported by thread history'),el('span',message.acknowledged_at?'ACK: '+message.acknowledged_at:'ACK: Not reported for human history'));
   item.append(labels);if(compositionBinding()&&models.workspace.state.data?.effective_scopes.includes('messages:send'))item.append(button('Reply in thread '+message.thread_id,()=>void openComposition(message.thread_id),{class:'secondary'}));list.append(item);
  }
  container.append(list);
 },'No messages were returned for this authorized thread response.');
 if(threadCursor&&!denied)card.append(button('Load more thread history',()=>void refreshThread(threadId!,true),{class:'secondary'}));
 return card;
}
function render():void{
 renderNavigation();
 const composeButton=byId('compose-message-open') as HTMLButtonElement|null;if(composeButton)composeButton.disabled=!compositionBinding()||models.workspace.state.status!=='ready'||!models.workspace.state.data?.effective_scopes.includes('messages:send')||(!models.workspace.state.data.effective_scopes.includes('messages:read')||!models.workspace.state.data.effective_scopes.includes('agents:read'));
 const taskComposeButton=byId('compose-task-open') as HTMLButtonElement|null;if(taskComposeButton){const eligible=!!compositionBinding()&&models.workspace.state.status==='ready'&&!!models.workspace.state.data?.effective_scopes.includes('tasks:create');taskComposeButton.hidden=!eligible;taskComposeButton.disabled=!eligible;}
 const heading=document.querySelector('h1')!;
 heading.textContent=currentView==='tasks'?(taskReads.selectedId?'Task detail':'Workspace tasks'):threadId?'Thread history':currentView==='activity'?'Workspace activity':currentView==='settings'?'Workspace settings':currentView==='inbox'?'Agent inbox':'Workspace overview';
 const active=currentView==='tasks'?(taskReads.selectedId?[taskReads.task.state,taskReads.run.state,taskReads.results.read.state,taskReads.events.read.state,taskReads.artifacts.state]:Object.values(taskReads.columns).map(page=>page.read.state)):currentView==='inbox'?[]:threadId?[models.thread.state]:currentView==='settings'?[models.workspace.state,models.profile.state,models.preferences.state]:[models.configuration.state,...(eventsAvailable||denied?[models.events.state]:[]),...(operationsAvailable?[models.operations.state]:[])];
 byId('page-status').textContent=denied?'forbidden — current authority required':currentView==='inbox'?'Unavailable for human sessions':'Read status: '+summarizeReadStates(active);
 if(currentView==='tasks'){
  const content=taskReads.selectedId?TaskDetail({state:taskReads,workspaceId:workspace,onBack:()=>navigateTask(null),onResultsNext:()=>void taskReads.nextResults(),onEventsNext:()=>void taskReads.nextEvents(),actions:commandAffordances}):KanbanView({state:taskReads,workspaceId:workspace,profile:models.profile.state.data?.profile??null,onSelect:navigateTask,onNext:state=>void taskReads.nextColumn(state),actions:commandAffordances});
  replacePreservingFocus(view,content,byId('main'));return;
 }
 if(currentView==='settings'){
  if(!denied)settings.setData(models.profile.state,models.preferences.state,source,models.workspace.state.status==='ready'&&Boolean(models.workspace.state.data?.effective_scopes.includes('profile:edit')));if(view.firstChild!==settings.element)view.replaceChildren(settings.element);return;
 }
 const grid=el('div',undefined,{class:'grid'});
 if(threadId){const card=threadSection();card.classList.add('wide');grid.append(card);}
 else if(currentView==='inbox'){
  const card=el('section',undefined,{class:'card wide'});card.append(el('h2','Native recipient lane'),el('p','Native clients poll their own agent inbox and explicitly acknowledge message IDs. Human sessions never impersonate an agent. Use authorized activity links to read thread history.',{'data-testid':'inbox-explanation'}));grid.append(card);
 }else if(currentView==='activity'){
  if(eventsAvailable||denied){const card=eventSection();card.classList.add('wide');grid.append(card);}
  else grid.append(el('p','Activity capability has not been reported for this session.',{class:'notice'}));
 }else{
  grid.append(configurationSection());
  if(eventsAvailable||denied)grid.append(eventSection());
  if(operationsAvailable)grid.append(operationsSection());
  else grid.append(el('section','Operations evidence: Not reported for this session.',{class:'card'}));
 }
 view.replaceChildren(grid);
}
async function refreshModel<T>(model:ReadModel<T>,read:()=>Promise<ApiResult<T>>,onAccepted?:(result:Extract<ApiResult<T>,{ok:true}>)=>void):Promise<void>{
 const pending=model.refresh(read,onAccepted);render();await pending;applyPresentation();render();
}
async function refreshEvents(more=false):Promise<void>{
 if(!eventsAvailable||denied)return;
 const generation=authority,cursor=more?eventCursor:null,prior=more?models.events.state.data??[]:[];
 await refreshModel(models.events,async()=>{
  const result=await request<Event[]>('listEvents',cursor?{cursor}:{});if(result.ok&&generation===authority)return {...result,data:[...prior,...result.data]};return result;
 },result=>{eventCursor=result.page?.next_cursor??null;});
}
async function refreshThread(id:string,more=false):Promise<void>{
 if(denied||id!==threadId)return;
 const generation=authority,cursor=more?threadCursor:null,prior=more?models.thread.state.data??[]:[];
 await refreshModel(models.thread,async()=>{
  const result=await request<Message[]>('getThread',{thread_id:id,...(cursor?{cursor}:{})});if(result.ok&&generation===authority)return {...result,data:[...prior,...result.data]};return result;
 },result=>{threadCursor=result.page?.next_cursor??null;});
}
async function refreshReads():Promise<void>{
 if(!session||denied)return;
 taskActions.invalidatePreparation();
 const generation=authority;
 await refreshModel(models.configuration,()=>request<Configuration>('getConfiguration',{}));
 if(denied||generation!==authority)return;
 const config=models.configuration.state.data;
 eventsAvailable=Boolean(config?.enabled_features.includes('events'));operationsAvailable=Boolean(config?.enabled_features.includes('operations'));profileAvailable=Boolean(config?.enabled_features.includes('profile'));preferencesAvailable=Boolean(config?.enabled_features.includes('preferences'));render();
 await Promise.all([
  refreshModel(models.workspace,()=>request<Workspace>('getWorkspace',{})),
  profileAvailable?refreshModel(models.profile,()=>request<ProfileData>('getProfile',{})):Promise.resolve(),
  preferencesAvailable?refreshModel(models.preferences,()=>request<PreferencesData>('getPreferences',{})):Promise.resolve(),
  eventsAvailable?refreshEvents():Promise.resolve(),
  operationsAvailable?refreshModel(models.operations,()=>request<Operations>('getOperations',{})):Promise.resolve()
 ]);
 if(!denied&&generation===authority){
  const observed=models.workspace.state;
  if(observed.status==='ready'&&observed.data){
   const scopes=observed.data.effective_scopes;tasksAvailable=scopes.includes('tasks:read');
   taskReads.setCapabilities({tasks:tasksAvailable,events:eventsAvailable&&scopes.includes('events:read'),artifacts:scopes.includes('artifacts:read')});
   if(currentView==='tasks'&&tasksAvailable)await Promise.all([taskReads.refreshBoard(),taskReads.selectedId?taskReads.refreshTask():Promise.resolve()]);
  }else taskReads.disconnect();
 }
 if(threadId&&!denied)await refreshThread(threadId);
}
async function boot():Promise<void>{
 byId('workspace-identity').textContent='Workspace '+workspace+' · '+location.origin;
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(workspace)){
  sessionElement.textContent='Choose a configured workspace';
  const form=el('form'),label=el('label','Workspace ID'),input=el('input',undefined,{name:'workspace',required:'',pattern:'[a-zA-Z0-9_-]{1,128}',autocomplete:'off'});label.append(input);form.append(label,el('button','Open workspace',{type:'submit'}));form.method='get';form.action='/overview';view.replaceChildren(form);return;
 }
 client=new HubClient(workspace);byId('read-actions').replaceChildren(button('Refresh reads',()=>void refreshReads(),{class:'secondary'}),button('New message',()=>void openComposition(),{id:'compose-message-open',title:'Requires current online human session with messages:send, messages:read and agents:read; local storage must be available'}),button('New Backlog task',()=>void openTaskComposition(),{id:'compose-task-open',title:'Requires a current online human session with tasks:create; local storage must be available'}));
 render();
 const result=await request<AuthSession>('getAuthSession',{});if(!result.ok){renderSession();return;}
 session=result.data;composeScope=session.actor.kind==='human'?{workspaceId:workspace,principalId:session.actor.principal_id}:null;denied=false;client.setCsrfToken(session.csrf_token);renderSession();notice.textContent='';await refreshReads();
 const initialTask=new URL(location.href).searchParams.get('task');if(currentView==='tasks'&&initialTask&&!denied)await taskReads.select(initialTask);
 const initialThread=new URL(location.href).searchParams.get('thread');if(initialThread&&!denied){selectThread(initialThread);currentView='activity';await refreshThread(initialThread);}
 if(location.pathname==='/'&&models.preferences.state.data&&!denied){
  const preferred=models.preferences.state.data.effective.default_view;if(preferred==='activity'&&eventsAvailable)navigate('activity');else if(preferred==='tasks'&&tasksAvailable)navigate('tasks');
 }
}
addEventListener('popstate',()=>{hideComposition();taskActions.invalidatePreparation();taskActionPanel.navigation();currentView=location.pathname.slice(1)||'overview';selectThread(new URL(location.href).searchParams.get('thread'));render();if(threadId)void refreshThread(threadId);if(currentView==='tasks'){void taskReads.select(new URL(location.href).searchParams.get('task'));void taskReads.refreshBoard();}});
addEventListener('offline',()=>{hideComposition();++connectionGeneration;taskActions.invalidatePreparation();for(const model of Object.values(models))model.disconnect();taskReads.disconnect();render();});
addEventListener('online',()=>{hideComposition();++connectionGeneration;taskActions.invalidatePreparation();void refreshReads();});
setInterval(()=>{taskReads.markStale(Date.now(),60_000);for(const model of Object.values(models))model.markStale(Date.now(),60_000);if(models.workspace.state.status!=='ready'&&taskActions.state.status==='ready')taskActions.invalidatePreparation();render();},15_000);
void boot();

addEventListener('pagehide',event=>{hideComposition();if(!(event as PageTransitionEvent).persisted){composeChannel?.close();void compositionStorage.dispose();}});
addEventListener('pageshow',event=>{if((event as PageTransitionEvent).persisted){hideComposition();++connectionGeneration;void refreshReads();}});
