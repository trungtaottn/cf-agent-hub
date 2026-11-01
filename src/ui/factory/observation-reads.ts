import type {Task,Run,ObservationView} from '../../http/dto';
import type {ApiResult,BrowserReadRequest,Page} from '../../../packages/client/src/types';
import {ReadModel} from '../read-state';

export const observationPageLimit=50;
export const observationPollMs=2000;
export interface FactoryObservationSlot {
 readonly id:string;
 readonly task:ReadModel<Task>;
 readonly run:ReadModel<Run>;
 readonly observation:ReadModel<ObservationView>;
 page:Page|null;cursor:string|null;expectedSessionId:string|null;pageNumber:number;
 requiresExplicitRefresh:boolean;
}
export interface FactoryObservationView {readonly slots:readonly FactoryObservationSlot[];}
type Denial='FORBIDDEN'|'NOT_FOUND';
interface Options {
 workspaceId:string;request:BrowserReadRequest;verifyAuthority:()=>Promise<boolean>;
 onTaskUnavailable?:(id:string,code:Denial,requestId:string|null)=>void;changed?:()=>void;
}
const invalid=():ApiResult<never>=>({ok:false,status:null,requestId:null,error:{code:'INVALID_RESPONSE',message:'Invalid server response',retryable:false}});
const makeSlot=(id:string):FactoryObservationSlot=>({id,task:new ReadModel<Task>({isEmpty:()=>false}),run:new ReadModel<Run>({isEmpty:()=>false}),observation:new ReadModel<ObservationView>({isEmpty:data=>data.records.length===0}),page:null,cursor:null,expectedSessionId:null,pageNumber:1,requiresExplicitRefresh:false});

/** Presentation-only reads. No operation here establishes ownership or writes state. */
export class FactoryObservationReads implements FactoryObservationView {
 #slots:FactoryObservationSlot[]=[];#active=false;#disposed=false;#capabilities={tasks:false,events:false};
 #generation=0;#busy=false;#timer:ReturnType<typeof setTimeout>|null=null;
 #pending:{resolve:()=>void}|null=null;
 readonly #options:Options;
 constructor(options:Options){this.#options=options;}
 get slots():readonly FactoryObservationSlot[]{return this.#slots;}
 #changed():void{this.#options.changed?.();}
 #stopTimer():void{if(this.#timer!==null)clearTimeout(this.#timer);this.#timer=null;}
 #cancel():void{
  ++this.#generation;this.#stopTimer();this.#pending?.resolve();this.#pending=null;
  // Invalidate ReadModel publication too, including its immediate-result await.
  // Existing data may remain only as an explicitly stale independent read.
  for(const slot of this.#slots){slot.task.redact(data=>data);slot.run.redact(data=>data);slot.observation.redact(data=>data); }
 }
 #current(generation:number,slot?:FactoryObservationSlot):boolean{return !this.#disposed&&this.#active&&this.#capabilities.tasks&&generation===this.#generation&&(!slot||this.#slots.includes(slot));}
 #clearReport(slot:FactoryObservationSlot,code:string,requestId:string|null=null):void{
  // Once continuity was established, no automatic clearing may turn into an
  // unbound current-session query. The hold contains no protected identity.
  slot.requiresExplicitRefresh ||= slot.expectedSessionId!==null;
  slot.observation.unavailable(code,requestId);slot.page=null;slot.cursor=null;slot.expectedSessionId=null;slot.pageNumber=1;
 }
 #clearTask(slot:FactoryObservationSlot,code:string,requestId:string|null=null):void{
  slot.task.unavailable(code,requestId);slot.run.unavailable(code,requestId);this.#clearReport(slot,code,requestId);
 }
 setActive(active:boolean):void{
  if(this.#disposed||active===this.#active)return;this.#active=active;this.#cancel();
  if(active)void this.#enqueue();this.#changed();
 }
 setCapabilities(capabilities:{tasks:boolean;events:boolean}):void{
  if(this.#disposed||capabilities.tasks===this.#capabilities.tasks&&capabilities.events===this.#capabilities.events)return;
  this.#capabilities={...capabilities};this.#cancel();
  for(const slot of this.#slots){if(!capabilities.tasks)this.#clearTask(slot,'TASK_READ_UNAVAILABLE');else if(!capabilities.events)this.#clearReport(slot,'OBSERVATION_READ_UNAVAILABLE');}
  this.#changed();if(this.#active)void this.#enqueue();
 }
 async selectPrimary(id:string|null):Promise<void>{
  if(this.#disposed||id===(this.#slots[0]?.id??null))return;this.#cancel();this.#slots=id===null?[]:[makeSlot(id)];this.#changed();await this.#enqueue();
 }
 async compare(id:string):Promise<void>{
  if(this.#disposed||!this.#slots[0]||this.#slots[0].id===id||this.#slots[1]?.id===id)return;
  this.#cancel();this.#slots=[this.#slots[0],makeSlot(id)];this.#changed();await this.#enqueue();
 }
 removeComparison():void{if(this.#slots.length<2)return;this.#cancel();this.#slots=this.#slots.slice(0,1);this.#changed();void this.#enqueue();}
 async refreshCurrent(id:string):Promise<void>{
  const slot=this.#slots.find(row=>row.id===id);if(!slot||this.#disposed)return;
  this.#cancel();this.#clearReport(slot,'AWAITING_CURRENT_OBSERVATIONS');slot.requiresExplicitRefresh=false;this.#changed();await this.#enqueue();
 }
 async next(id:string):Promise<void>{
  const slot=this.#slots.find(row=>row.id===id);
  if(!slot||this.#disposed||slot.requiresExplicitRefresh||!slot.expectedSessionId||!slot.page?.next_cursor||!['ready','empty'].includes(slot.observation.state.status))return;
  const cursor=slot.page.next_cursor;this.#cancel();slot.cursor=cursor;slot.page=null;++slot.pageNumber;this.#changed();await this.#enqueue();
 }
 invalidate(reason:'UNAUTHENTICATED'|'FORBIDDEN',requestId:string|null=null):void{
  this.#cancel();for(const slot of this.#slots){slot.task.invalidate(reason,requestId);slot.run.invalidate(reason,requestId);slot.observation.invalidate(reason,requestId);}
  this.#slots=[];this.#active=false;this.#changed();
 }
 disconnect():void{
  this.#active=false;this.#cancel();for(const slot of this.#slots){slot.task.disconnect();slot.run.disconnect();this.#clearReport(slot,'NETWORK_ERROR');}this.#changed();
 }
 dispose():void{if(this.#disposed)return;this.#disposed=true;this.#active=false;this.#cancel();this.#slots=[];this.#changed();}
 #enqueue():Promise<void>{
  if(this.#disposed||!this.#active||!this.#capabilities.tasks||this.#slots.length===0)return Promise.resolve();
  this.#stopTimer();this.#pending?.resolve();const pending=new Promise<void>(resolve=>{this.#pending={resolve};});
  if(!this.#busy)void this.#drain();return pending;
 }
 async #drain():Promise<void>{
  this.#busy=true;
  try{while(this.#pending){const pending=this.#pending;this.#pending=null;try{await this.#cycle();}finally{pending.resolve();}}}
  finally{this.#busy=false;if(!this.#disposed&&this.#active&&this.#capabilities.tasks&&this.#slots.length){this.#timer=setTimeout(()=>{this.#timer=null;void this.#enqueue();},observationPollMs);}}
 }
 async #request(operation:Parameters<BrowserReadRequest>[0],input:any):Promise<ApiResult<any>>{
  try{return await this.#options.request(operation,input);}catch{return {ok:false,status:null,requestId:null,error:{code:'NETWORK_ERROR',message:'Read failed',retryable:false}};}
 }
 async #cycle():Promise<void>{
  const generation=this.#generation;
  let authority=false;try{authority=await this.#options.verifyAuthority();}catch{/* Required authority cannot be inferred from an unavailable read. */}
  if(!this.#current(generation))return;
  if(!authority){for(const slot of this.#slots)this.#clearTask(slot,'CURRENT_AUTHORITY_UNAVAILABLE');this.#changed();return;}
  for(const slot of [...this.#slots]){if(!this.#current(generation,slot))return;await this.#readSlot(slot,generation);}
 }
 async #publish<T>(model:ReadModel<T>,result:ApiResult<T>,generation:number,slot:FactoryObservationSlot,accepted?:()=>void):Promise<boolean>{
  if(!this.#current(generation,slot))return false;
  await model.refresh(async()=>result,()=>{if(this.#current(generation,slot))accepted?.();});
  if(!this.#current(generation,slot))return false;this.#changed();return this.#current(generation,slot);
 }
 async #readSlot(slot:FactoryObservationSlot,generation:number):Promise<void>{
  let taskResult=await this.#request('getTask',{path:{task_id:slot.id}});if(!this.#current(generation,slot))return;
  if(taskResult.ok&&(taskResult.data.id!==slot.id||taskResult.data.workspace_id!==this.#options.workspaceId))taskResult=invalid();
  if(!taskResult.ok){
   this.#clearTask(slot,taskResult.error.code,taskResult.requestId);
   // The app wrapper additionally fences its authority/connection generation.
   // Transient outages do not redact an independently authorized task cache.
   if(taskResult.status===403||taskResult.status===404)this.#options.onTaskUnavailable?.(slot.id,taskResult.status===403?'FORBIDDEN':'NOT_FOUND',taskResult.requestId);
   this.#changed();return;
  }
  if(!await this.#publish(slot.task,taskResult,generation,slot))return;
  const task=taskResult.data as Task;
  if(task.latest_run_id){
   let result=await this.#request('getRun',{path:{run_id:task.latest_run_id}});if(!this.#current(generation,slot))return;
   if(result.ok&&(result.data.id!==task.latest_run_id||result.data.task_id!==slot.id||result.data.workspace_id!==this.#options.workspaceId))result=invalid();
   if(!result.ok)slot.run.reset();if(!await this.#publish(slot.run,result,generation,slot))return;
  }else{slot.run.unavailable('NO_LATEST_RUN');this.#changed();}
  if(!this.#current(generation,slot))return;
  if(!this.#capabilities.events){this.#clearReport(slot,'OBSERVATION_READ_UNAVAILABLE');this.#changed();return;}
  if(slot.requiresExplicitRefresh)return;
  const expected=slot.expectedSessionId,cursor=slot.cursor;
  let result=await this.#request('listTaskObservations',{path:{task_id:slot.id},query:{limit:observationPageLimit,...(expected?{expected_session_id:expected}:{}),...(cursor?{cursor}:{})}});
  if(!this.#current(generation,slot))return;
  if(result.ok&&!validObservation(result.data,result.page,slot.id,expected))result=invalid();
  if(!result.ok){
   this.#clearReport(slot,result.error.code,result.requestId);
   if(result.status===403||result.status===409||result.status===410)slot.requiresExplicitRefresh=true;
   // Reset first: generic ReadModel503 caching must not retain protected data.
   slot.observation.reset();await this.#publish(slot.observation,result,generation,slot);return;
  }
  const data=result.data as ObservationView;
  if(expected&&data.status==='no_retained_data'){this.#clearReport(slot,'OBSERVATION_CONTINUITY_UNAVAILABLE',result.requestId);this.#changed();return;}
  await this.#publish(slot.observation,result,generation,slot,()=>{slot.expectedSessionId=data.binding?.session_id??null;slot.page=result.page!;});
 }
}

function validObservation(data:ObservationView,page:Page|undefined,taskId:string,expected:string|null):boolean{
 if(!data||!page||page.has_more!==(typeof page.next_cursor==='string'&&page.next_cursor.length>0)||!Array.isArray(data.records)||data.records.length>observationPageLimit)return false;
 if(data.status==='no_retained_data')return data.binding===null&&data.coverage===null&&data.retained_range===null&&data.records.length===0&&!data.truncated&&!page.has_more;
 if(data.status!=='retained'||!data.binding||data.binding.task_id!==taskId||expected!==null&&data.binding.session_id!==expected||!data.coverage)return false;
 const range=data.retained_range;
 if(range&&(!Number.isSafeInteger(range.first_sequence)||range.first_sequence<1||!Number.isSafeInteger(range.last_sequence)||range.last_sequence<range.first_sequence))return false;
 let previous=0;
 for(const record of data.records){if(!Number.isSafeInteger(record.sequence)||record.sequence<=previous||!range||record.sequence<range.first_sequence||record.sequence>range.last_sequence)return false;previous=record.sequence;}
 return !page.has_more||data.records.length>0;
}
