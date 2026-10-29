import type {Task} from '../http/dto';
import type {BrowserTaskCommandOperation} from '../../packages/client/src/types';
import type {TaskActions} from './task-actions';
import {el,button} from './dom';
export const taskActionLabels:Record<BrowserTaskCommandOperation,string>={readyTask:'Ready',cancelTask:'Cancel',requeueTask:'Requeue',acceptTaskResult:'Accept result'};
export interface TaskActionAffordances {
 disabledReason(task:Task,operation:BrowserTaskCommandOperation,current:boolean):string|null;
 open(taskId:string,operation:BrowserTaskCommandOperation,invoker:HTMLElement):void;
}
let disclosureId=0;
/** Native disclosure, not a partial menu. Display observations never authorize dispatch. */
export function taskActionDisclosure(task:Task,current:boolean,actions:TaskActionAffordances):HTMLElement{
 const active=document.activeElement,focusKey=active?.getAttribute('data-focus-key');
 const expanded=focusKey?.startsWith('task-command:'+task.id+':')||focusKey==='task-actions:'+task.id&&active?.getAttribute('aria-expanded')==='true';
 const id='task-actions-'+(++disclosureId),root=el('div',undefined,{class:'task-actions'}),items=el('div',undefined,{id,...(expanded?{}:{hidden:''}),class:'task-action-options'});
 const toggle=button('Actions for '+task.title+' ('+task.id+')',()=>{
  const expanded=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!expanded));items.hidden=expanded;
 },{'aria-expanded':String(Boolean(expanded)),'aria-controls':id,class:'secondary','data-focus-key':'task-actions:'+task.id});
 root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();items.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}});
 for(const operation of Object.keys(taskActionLabels) as BrowserTaskCommandOperation[]){
  const disabled=actions.disabledReason(task,operation,current),reasonId=id+'-'+operation;
  const control=button(taskActionLabels[operation],()=>{items.hidden=true;toggle.setAttribute('aria-expanded','false');actions.open(task.id,operation,control);},{'data-focus-key':'task-command:'+task.id+':'+operation});
  if(disabled){control.setAttribute('disabled','');control.setAttribute('aria-describedby',reasonId);}
  items.append(control);if(disabled)items.append(el('p',disabled,{id:reasonId,class:'muted'}));
 }
 root.append(toggle,items);return root;
}
/** Persistent host must be mounted outside replaced #view. No retained intent in storage or URLs. */
export class TaskActionPanel {
 readonly element=el('div',undefined,{class:'task-action-host'});
 readonly dialog=el('dialog',undefined,{'aria-labelledby':'task-command-title','aria-describedby':'task-command-status',class:'task-command-dialog'});
 readonly #title=el('h2',undefined,{id:'task-command-title'});
 readonly #status=el('p',undefined,{id:'task-command-status'});
 readonly #evidence=el('p',undefined,{class:'review','data-testid':'task-command-review'});
 readonly #reason=el('textarea',undefined,{id:'task-command-reason',name:'reason',autocomplete:'off'});
 readonly #reasonLabel=el('label','Reason',{for:'task-command-reason'});
 readonly #live=el('p',undefined,{role:'status','aria-live':'polite','aria-atomic':'true','data-testid':'task-command-announcement'});
 readonly #confirm:HTMLButtonElement;readonly #replay:HTMLButtonElement;readonly #review:HTMLButtonElement;readonly #reopen:HTMLButtonElement;readonly #close:HTMLButtonElement;
 #focusToken=0;
 get focusToken():number{return this.#focusToken;}
 #view:string|null=null;#focusKey:string|null=null;#ownsFocus=false;#lastAnnouncement='';#retainedTask:string|null=null;
 constructor(readonly actions:TaskActions,readonly options:{workspaceId:string;viewKey:()=>string;fallback:()=>HTMLElement}){
  this.#confirm=button('Confirm command',()=>void actions.submit());this.#replay=button('Reconcile original command',()=>void actions.replay());
  this.#review=button('Review current task',()=>{const state=actions.state;if(state.taskId&&state.operation)void actions.prepare(state.taskId,state.operation);});
  this.#close=button('Close',()=>this.hide(),{class:'secondary'});this.#reopen=button('Reopen task command',()=>this.reopen(),{class:'secondary'});
  this.#reasonLabel.append(this.#reason);this.#reason.addEventListener('input',()=>actions.setReason(this.#reason.value));
  this.dialog.append(this.#title,this.#status,this.#evidence,this.#reasonLabel,this.#confirm,this.#replay,this.#review,this.#close);
  this.element.append(this.dialog,this.#live,this.#reopen);this.#reopen.hidden=true;
  this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.hide();});
  this.dialog.addEventListener('keydown',event=>{
   if(event.key!=='Tab')return;
   const controls=[...this.dialog.querySelectorAll<HTMLElement>('button,textarea')].filter(node=>!node.hidden&&!node.closest('[hidden]')&&!node.matches(':disabled'));
   const first=controls[0],last=controls.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  document.addEventListener('focusin',event=>{if(this.#ownsFocus&&!this.element.contains(event.target as Node))this.#ownsFocus=false;});
 }
 open(taskId:string,operation:BrowserTaskCommandOperation,invoker?:HTMLElement):void{
  const retained=this.actions.state;
  const target=(retained.status==='pending'||retained.status==='uncertain')?retained.taskId??taskId:taskId;
  this.#view=this.options.viewKey();this.#focusKey=target===taskId?invoker?.getAttribute('data-focus-key')??'task:'+target:'task:'+target;this.#retainedTask=target;
  void this.actions.prepare(taskId,operation);this.reopen();
 }
 reopen():void{
  ++this.#focusToken;this.#view=this.options.viewKey();this.#ownsFocus=true;
  if(!this.dialog.open)this.dialog.showModal();this.update();
  (!this.#reasonLabel.hidden&&!this.#reason.disabled?this.#reason:!this.#replay.hidden?this.#replay:this.#close).focus();
 }
 hide():void{
  const owned=this.dialog.contains(document.activeElement);this.#ownsFocus=false;
  if(this.dialog.open)this.dialog.close();this.update();
  if(owned&&this.#view===this.options.viewKey())this.#returnTarget().focus();
 }
 navigation():void{++this.#focusToken;this.#ownsFocus=false;this.#view=null;if(this.dialog.open)this.dialog.close();this.update();}
 update():void{
  const state=this.actions.state,operation=state.operation;
  if(state.status==='unresolved'){this.#retainedTask=null;this.#focusKey=null;this.#view=null;this.#ownsFocus=false;}
  this.#title.textContent=(operation?taskActionLabels[operation]:'Task command')+(state.taskId?' · '+state.taskId:'');
  this.#evidence.textContent='Workspace: '+this.options.workspaceId+(state.task?'\nTask: '+state.task.title+' ('+state.task.id+')\nState: '+state.task.state+' · Version '+state.task.task_version+(operation==='acceptTaskResult'&&state.task.result?'\nResult run: '+state.task.result.run_id+'\nSubmitted by: '+state.task.result.submitted_by.principal_id+'\nResult: '+state.task.result.summary+'\nArtifacts: '+(state.task.result.artifact_ids.join(', ')||'None'):''):'');
  this.#reasonLabel.hidden=operation===null||operation==='readyTask';
  // Equality prevents assignment during ordinary updates, preserving caret and selection.
  if(this.#reason.value!==state.reason)this.#reason.value=state.reason;
  this.#reason.disabled=['pending','uncertain','succeeded','unresolved'].includes(state.status);
  this.#confirm.disabled=state.status!=='ready'||state.disabledReason!==null;
  this.#confirm.hidden=['uncertain','conflict','succeeded','unresolved'].includes(state.status);
  this.#replay.hidden=state.status!=='uncertain';this.#review.hidden=!(['conflict','rejected'].includes(state.status)||state.status==='idle'&&state.taskId!==null);
  this.#reopen.hidden=this.dialog.open||state.status==='idle';
  const texts:Record<string,string>={idle:'Choose a task command.',preparing:'Checking current access and task version…',ready:'Review the current task version and confirm this command.',pending:'Command dispatched. Closing does not cancel it.',uncertain:'Outcome unknown. Reconcile the original command; do not create a replacement.',conflict:'Version conflict. Your reason is retained. Review the current task before a new explicit confirmation.',rejected:'Command rejected. No success is claimed.',succeeded:'Server confirmed the command. Refreshing authoritative observations; the moved task may be outside this bounded page.',unresolved:'Access changed. Sensitive intent cleared; the earlier command outcome remains unresolved.'};
  this.#status.textContent=(texts[state.status]??'Unavailable')+(state.task?' Task version '+state.task.task_version+'.':'')+(state.disabledReason?' '+state.disabledReason:'')+(operation==='cancelTask'?' Cancellation stops task execution authority; it cannot undo external effects already performed.':'')+(state.result&&!state.result.ok?' Error code: '+state.result.error.code+' · HTTP: '+(state.result.status??'No response')+' · Request: '+(state.result.requestId??'Not reported'):'');
  if(['succeeded','uncertain','conflict','rejected','unresolved'].includes(state.status)){
   const signature=[state.status,state.taskId,state.result?.requestId??'',state.result&&!state.result.ok?state.result.error.code:''].join('|');
   if(signature!==this.#lastAnnouncement){this.#lastAnnouncement=signature;this.#live.textContent=this.#status.textContent;}
  }
 }
 /** Called after current bounded reads finish, never at optimistic dispatch time. */
 restoreFocus(token:number,currentTarget:HTMLElement|null):void{
  if(token!==this.#focusToken||this.#view!==this.options.viewKey()||this.actions.state.status!=='succeeded'||!this.dialog.open)return;
  // Completion owns this modal, not necessarily the user's current focus. Hiding
  // Confirm may have moved focus outside; that must not strand a blocking modal.
  const restore=this.#ownsFocus&&this.dialog.contains(document.activeElement);
  this.#ownsFocus=false;this.dialog.close();this.update();
  if(restore)(currentTarget?.isConnected?currentTarget:this.options.fallback()).focus();
 }
 #returnTarget():HTMLElement{
  const keys=['task:'+this.#retainedTask,this.#focusKey];
  return [...document.querySelectorAll<HTMLElement>('[data-focus-key]')].find(node=>keys.includes(node.getAttribute('data-focus-key'))&&!node.closest('[hidden]')&&!node.matches(':disabled'))??this.options.fallback();
 }
}
