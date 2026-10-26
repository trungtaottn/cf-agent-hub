import {HubClient} from '../../packages/client/src/client';
import type {ApiResult,Workspace,AuthSession,AuthStartData,Configuration,ProfileData,PreferencesData,Operations,Event,Message,Operation,OperationInputs,RequestOptions} from '../../packages/client/src/types';
import {ReadModel,summarizeReadStates,type ReadState} from './read-state';
import {SettingsPanel} from './settings';
import {el,button} from './dom';

const byId=(id:string)=>document.getElementById(id)!;
const workspace=document.body.dataset.workspace??'';
const view=byId('view'),sessionElement=byId('session'),navigation=byId('navigation'),notice=byId('notice');
const models={
 workspace:new ReadModel<Workspace>({isEmpty:()=>false}),
 configuration:new ReadModel<Configuration>({isEmpty:()=>false}),profile:new ReadModel<ProfileData>({isEmpty:()=>false}),
 preferences:new ReadModel<PreferencesData>({isEmpty:()=>false}),events:new ReadModel<Event[]>({isEmpty:items=>items.length===0}),
 operations:new ReadModel<Operations>({isEmpty:()=>false}),thread:new ReadModel<Message[]>({isEmpty:items=>items.length===0})
};
let client:HubClient,authority=0,session:AuthSession|null=null,denied=false,currentView=location.pathname.slice(1)||'overview',threadId:string|null=null,eventCursor:string|null=null,threadCursor:string|null=null;
let eventsAvailable=false,operationsAvailable=false,profileAvailable=false,preferencesAvailable=false;
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
 ++authority;denied=true;session=null;client?.setCsrfToken(null);eventCursor=null;threadCursor=null;threadId=null;
 for(const model of Object.values(models))model.invalidate(status===401?'UNAUTHENTICATED':'FORBIDDEN',id);
 settings.invalidate();eventsAvailable=false;operationsAvailable=false;profileAvailable=false;preferencesAvailable=false;
 document.documentElement.dataset.theme='system';document.documentElement.dataset.density='comfortable';delete document.documentElement.dataset.accent;
 byId('workspace-name').textContent='';notice.textContent='Cached sensitive records, settings drafts and pending write data have been cleared.';
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
   const result=await request<AuthStartData>('startAuth',{return_path:currentView==='settings'?'/settings':currentView==='activity'?'/activity':'/overview'});
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
 currentView=name;selectThread(selectedThread);
 const query=new URLSearchParams({workspace});if(selectedThread)query.set('thread',selectedThread);
 history.pushState(null,'','/'+name+'?'+query.toString());render();byId('main').focus();
 if(selectedThread)void refreshThread(selectedThread,false);
}
function renderNavigation():void{
 const visibleViews=models.profile.state.data?.profile.navigation.visible_views;
 const entries=([['overview','Overview'],['activity','Activity'],['inbox','Inbox'],['settings','Settings']] as const).filter(([name])=>{
  // Overview is a permanent safe fallback; Settings is deliberately outside profile navigation.
  if(name==='overview')return true;
  if(name==='settings')return profileAvailable||preferencesAvailable||denied;
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
 error:'Read failed — no successful result is available',disconnected:'Disconnected — no cached observation is available'
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
   item.append(labels);list.append(item);
  }
  container.append(list);
 },'No messages were returned for this authorized thread response.');
 if(threadCursor&&!denied)card.append(button('Load more thread history',()=>void refreshThread(threadId!,true),{class:'secondary'}));
 return card;
}
function render():void{
 renderNavigation();
 const heading=document.querySelector('h1')!;
 heading.textContent=threadId?'Thread history':currentView==='activity'?'Workspace activity':currentView==='settings'?'Workspace settings':currentView==='inbox'?'Agent inbox':'Workspace overview';
 const active=currentView==='inbox'?[]:threadId?[models.thread.state]:currentView==='settings'?[models.workspace.state,models.profile.state,models.preferences.state]:[models.configuration.state,...(eventsAvailable||denied?[models.events.state]:[]),...(operationsAvailable?[models.operations.state]:[])];
 byId('page-status').textContent=denied?'forbidden — current authority required':currentView==='inbox'?'Unavailable for human sessions':'Read status: '+summarizeReadStates(active);
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
 if(threadId&&!denied)await refreshThread(threadId);
}
async function boot():Promise<void>{
 byId('workspace-identity').textContent='Workspace '+workspace+' · '+location.origin;
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(workspace)){
  sessionElement.textContent='Choose a configured workspace';
  const form=el('form'),label=el('label','Workspace ID'),input=el('input',undefined,{name:'workspace',required:'',pattern:'[a-zA-Z0-9_-]{1,128}',autocomplete:'off'});label.append(input);form.append(label,el('button','Open workspace',{type:'submit'}));form.method='get';form.action='/overview';view.replaceChildren(form);return;
 }
 client=new HubClient(workspace);byId('read-actions').replaceChildren(button('Refresh reads',()=>void refreshReads(),{class:'secondary'}));
 render();
 const result=await request<AuthSession>('getAuthSession',{});if(!result.ok){renderSession();return;}
 session=result.data;denied=false;client.setCsrfToken(session.csrf_token);renderSession();notice.textContent='';await refreshReads();
 const initialThread=new URL(location.href).searchParams.get('thread');if(initialThread&&!denied){selectThread(initialThread);currentView='activity';await refreshThread(initialThread);}
 if(location.pathname==='/'&&models.preferences.state.data&&!denied){
  const preferred=models.preferences.state.data.effective.default_view;if(preferred==='activity'&&eventsAvailable)navigate('activity');
 }
}
addEventListener('popstate',()=>{currentView=location.pathname.slice(1)||'overview';selectThread(new URL(location.href).searchParams.get('thread'));render();if(threadId)void refreshThread(threadId);});
addEventListener('offline',()=>{for(const model of Object.values(models))model.disconnect();render();});
setInterval(()=>{for(const model of Object.values(models))model.markStale(Date.now(),60_000);render();},15_000);
void boot();
