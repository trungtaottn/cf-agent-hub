import type {Task,TaskState,TaskResult,Run,Event,Artifact} from '../http/dto';
import type {BrowserReadRequest,Page} from '../../packages/client/src/types';
import {ReadModel} from './read-state';
export const taskStates=['backlog','ready','doing','waiting','review','done','cancelled'] as const;
export const taskPageLimit=20;
export interface TaskPage<T>{read:ReadModel<T[]>;page:Page|null;cursor:string|null;}
export interface TaskCapabilities{tasks:boolean;events:boolean;artifacts:boolean;}
export interface TaskReadView{
 readonly columns:Record<TaskState,TaskPage<Task>>;
 readonly task:ReadModel<Task>;readonly run:ReadModel<Run>;
 readonly results:TaskPage<TaskResult>;readonly events:TaskPage<Event>;
 readonly artifacts:ReadModel<Artifact[]>;
 readonly selectedId:string|null;readonly capabilities:Readonly<TaskCapabilities>;
}
// Controller implementation follows test-first below; renderers consume only TaskReadView.
const pageModel=<T>():TaskPage<T>=>({read:new ReadModel<T[]>({isEmpty:items=>items.length===0}),page:null,cursor:null});
const invalid=():import('../../packages/client/src/types').ApiResult<never>=>({ok:false,status:null,requestId:null,error:{code:'INVALID_RESPONSE',message:'Invalid server response',retryable:false}});

/** Bounded response projections, not a browser task authority or mutation engine. */
export class TaskReads implements TaskReadView{
 readonly columns=Object.fromEntries(taskStates.map(state=>[state,pageModel<Task>()])) as Record<TaskState,TaskPage<Task>>;
 readonly task=new ReadModel<Task>({isEmpty:()=>false});readonly run=new ReadModel<Run>({isEmpty:()=>false});
 readonly results=pageModel<TaskResult>();readonly events=pageModel<Event>();
 readonly artifacts=new ReadModel<Artifact[]>({isEmpty:items=>items.length===0});
 #selectedId:string|null=null;#capabilities:TaskCapabilities={tasks:false,events:false,artifacts:false};#detailGeneration=0;
 readonly #request:BrowserReadRequest;readonly #changed:()=>void;readonly #workspaceId:string;
 constructor(options:{workspaceId:string;request:BrowserReadRequest;changed?:()=>void}){
  this.#request=options.request;this.#changed=options.changed??(()=>{});this.#workspaceId=options.workspaceId;
 }
 get selectedId(){return this.#selectedId;}
 get capabilities(){return this.#capabilities;}
 #models():ReadModel<any>[]{return [...Object.values(this.columns).map(page=>page.read),this.task,this.run,this.results.read,this.events.read,this.artifacts];}
 #clearChildren(code='AWAITING_CURRENT_TASK'):void{
  this.run.unavailable(code);this.results.read.unavailable(code);this.events.read.unavailable(code);this.artifacts.unavailable(code);
  this.results.page=this.events.page=null;this.results.cursor=this.events.cursor=null;
 }
 setCapabilities(capabilities:TaskCapabilities):void{
  const previous=this.#capabilities;this.#capabilities={...capabilities};
  if(!capabilities.tasks){
   ++this.#detailGeneration;for(const model of this.#models())model.unavailable('TASK_READ_UNAVAILABLE');
   for(const page of Object.values(this.columns)){page.page=null;page.cursor=null;}
   this.#clearChildren('TASK_READ_UNAVAILABLE');
  }else if(!previous.tasks){for(const model of this.#models())model.reset();}
  if(!capabilities.events){this.events.read.unavailable('EVENT_READ_UNAVAILABLE');this.events.page=null;this.events.cursor=null;}
  if(!capabilities.artifacts)this.artifacts.unavailable('ARTIFACT_READ_UNAVAILABLE');
  this.#changed();
 }
 invalidate(reason:'UNAUTHENTICATED'|'FORBIDDEN',requestId:string|null=null):void{
  ++this.#detailGeneration;this.#capabilities={tasks:false,events:false,artifacts:false};
  for(const model of this.#models())model.invalidate(reason,requestId);
  for(const page of [...Object.values(this.columns),this.results,this.events]){page.page=null;page.cursor=null;}
  this.#changed();
 }
 disconnect():void{++this.#detailGeneration;for(const model of this.#models())model.disconnect();this.#changed();}
 markStale(nowMs:number,maxAgeMs:number):void{for(const model of this.#models())model.markStale(nowMs,maxAgeMs);}
 async #refresh<T>(model:ReadModel<T>,read:()=>Promise<import('../../packages/client/src/types').ApiResult<T>>,accepted?:(result:Extract<import('../../packages/client/src/types').ApiResult<T>,{ok:true}>)=>void):Promise<void>{
  const pending=model.refresh(read,accepted);this.#changed();await pending;this.#changed();
 }
 async refreshBoard():Promise<void>{
  if(!this.#capabilities.tasks)return;
  await Promise.all(taskStates.map(state=>this.#column(state,null)));
 }
 async nextColumn(state:TaskState):Promise<void>{
  const page=this.columns[state];if(!page||!['ready','empty'].includes(page.read.state.status)||!page.page?.next_cursor)return;
  await this.#column(state,page.page.next_cursor);
 }
 async #column(state:TaskState,cursor:string|null):Promise<void>{
  if(!this.#capabilities.tasks)return;const page=this.columns[state];
  await this.#refresh(page.read,async()=>{
   const result=await this.#request('listTasks',{query:{state,limit:taskPageLimit,...(cursor?{cursor}:{})}});
   return result.ok&&(result.data.length>taskPageLimit||result.data.some(task=>task.workspace_id!==this.#workspaceId||task.state!==state))?invalid():result;
  },result=>{page.page=result.page??null;page.cursor=cursor;});
 }
 async select(id:string|null):Promise<void>{
  ++this.#detailGeneration;this.#selectedId=id;this.task.reset();this.#clearChildren();this.#changed();
  if(id!==null)await this.refreshTask();
 }
 async refreshTask():Promise<void>{
  const id=this.#selectedId;if(id===null||!this.#capabilities.tasks)return;
  const generation=++this.#detailGeneration;this.#clearChildren();let accepted:Task|null=null;
  await this.#refresh(this.task,async()=>{
   const result=await this.#request('getTask',{path:{task_id:id}});
   if(generation!==this.#detailGeneration)return invalid();
   if(!result.ok&&result.status===404)this.#purgeTask(id,result.requestId);
   return result.ok&&(result.data.id!==id||result.data.workspace_id!==this.#workspaceId)?invalid():result;
  },result=>{accepted=result.data;});
  if(generation!==this.#detailGeneration||!accepted||!this.#capabilities.tasks)return;
  const task=accepted as Task;
  await Promise.all([
   this.#loadRun(task,generation),this.#loadResults(id,generation,null),this.#loadEvents(id,generation,null),this.#loadArtifacts(task,generation)
  ]);
 }
 #purgeTask(id:string,requestId:string|null):void{
  if(id!==this.#selectedId)return;
  ++this.#detailGeneration;this.task.unavailable('NOT_FOUND',requestId);
  // Invalidate every older page generation, retaining unrelated observations
  // only as stale. No automatic request may resurrect the confirmed absence.
  for(const page of Object.values(this.columns)){page.read.redact(tasks=>tasks.filter(task=>task.id!==id));page.page=null;page.cursor=null;}
  this.#clearChildren('NOT_FOUND');this.#changed();
 }
 async #loadRun(task:Task,generation:number):Promise<void>{
  if(task.latest_run_id===null){this.run.unavailable('NO_LATEST_RUN');this.#changed();return;}
  const id=task.latest_run_id;
  await this.#refresh(this.run,async()=>{
   const result=await this.#request('getRun',{path:{run_id:id}});
   if(generation!==this.#detailGeneration)return invalid();
   return result.ok&&(result.data.id!==id||result.data.task_id!==task.id||result.data.workspace_id!==this.#workspaceId)?invalid():result;
  });
 }
 async #loadResults(id:string,generation:number,cursor:string|null):Promise<void>{
  await this.#refresh(this.results.read,async()=>{
   const result=await this.#request('listTaskResults',{path:{task_id:id},query:{limit:taskPageLimit,...(cursor?{cursor}:{})}});
   if(generation!==this.#detailGeneration)return invalid();
   if(!result.ok&&result.status===404)this.#purgeTask(id,result.requestId);
   return result.ok&&result.data.length>taskPageLimit?invalid():result;
  },result=>{this.results.page=result.page??null;this.results.cursor=cursor;});
 }
 async #loadEvents(id:string,generation:number,cursor:string|null):Promise<void>{
  if(!this.#capabilities.events){this.events.read.unavailable('EVENT_READ_UNAVAILABLE');this.#changed();return;}
  await this.#refresh(this.events.read,async()=>{
   const result=await this.#request('listEvents',{query:{limit:taskPageLimit,...(cursor?{cursor}:{})}});
   if(generation!==this.#detailGeneration)return invalid();
   if(!result.ok)return result;if(result.data.length>taskPageLimit)return invalid();
   const task=this.task.state.data;
   const runs=new Set([task?.active_run_id,task?.latest_run_id,task?.result?.run_id].filter((run):run is string=>Boolean(run)));
   return {...result,data:result.data.filter(event=>event.workspace_id===this.#workspaceId&&(event.resource_type==='task'&&event.resource_id===id||event.resource_type==='run'&&event.run_id!==null&&event.resource_id===event.run_id&&runs.has(event.run_id)))};
  },result=>{this.events.page=result.page??null;this.events.cursor=cursor;});
 }
 async #loadArtifacts(task:Task,generation:number):Promise<void>{
  if(!this.#capabilities.artifacts){this.artifacts.unavailable('ARTIFACT_READ_UNAVAILABLE');this.#changed();return;}
  const ids=task.result?.artifact_ids??[];
  if(ids.length===0){this.artifacts.unavailable('NO_CURRENT_RESULT_ARTIFACTS');this.#changed();return;}
  if(ids.length>5){this.artifacts.unavailable('INVALID_RESPONSE');this.#changed();return;}
  await this.#refresh(this.artifacts,async()=>{
   const results=await Promise.all(ids.map(id=>this.#request('getArtifact',{path:{artifact_id:id}})));
   if(generation!==this.#detailGeneration)return invalid();
   const failure=results.find(result=>!result.ok);if(failure&&!failure.ok)return failure;
   const successful=results.filter(result=>result.ok);
   if(successful.some((result,index)=>result.data.id!==ids[index]||result.data.workspace_id!==this.#workspaceId||result.data.task_id!==null&&result.data.task_id!==task.id||result.data.run_id!==null&&result.data.run_id!==task.result?.run_id||result.data.status!=='committed'))return invalid();
   // Each underlying request retains its ID on the rendered metadata. The group
   // is one bounded observation; do not invent a single server request identity.
   return {ok:true,status:200,data:successful.map(result=>result.data),requestId:successful.map(result=>result.requestId).join(', ')};
  });
 }
 async nextResults():Promise<void>{
  const cursor=this.results.page?.next_cursor,id=this.#selectedId;
  if(!id||!cursor||!this.#capabilities.tasks||!['ready','empty'].includes(this.results.read.state.status))return;
  await this.#loadResults(id,this.#detailGeneration,cursor);
 }
 async nextEvents():Promise<void>{
  const cursor=this.events.page?.next_cursor,id=this.#selectedId;
  if(!id||!cursor||!this.#capabilities.tasks||!this.#capabilities.events||!['ready','empty'].includes(this.events.read.state.status))return;
  await this.#loadEvents(id,this.#detailGeneration,cursor);
 }
}
