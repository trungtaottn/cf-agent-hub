import type {TaskCreateRequest} from '../../http/dto';
import type {TaskComposition,TaskField} from './task-form';
import {el,button} from '../dom';
const references=['project_id','work_role_id','assigned_agent_id'] as const;
/** Semantic stable controls; remote text is never HTML. Visibility is not authorization. */
export class TaskForm {
 readonly element=el('section',undefined,{'aria-labelledby':'task-compose-heading','data-testid':'task-composer',class:'card'});
 readonly form=el('form',undefined,{novalidate:''});
 readonly title=el('input',undefined,{id:'task-title',type:'text','aria-describedby':'task-title-error'});
 readonly description=el('textarea',undefined,{id:'task-description',rows:'6','aria-describedby':'task-description-error task-compose-limits'});
 readonly selects=Object.fromEntries(references.map(field=>[field,el('select',undefined,{id:'task-'+field,'aria-describedby':'task-'+field+'-error'})])) as Record<typeof references[number],HTMLSelectElement>;
 readonly status=el('p',undefined,{role:'status','aria-live':'polite','data-testid':'task-compose-status'});
 readonly error=el('p',undefined,{role:'alert',tabindex:'-1'});
 readonly send=el('button','Create Backlog task',{type:'submit'});
 readonly review=button('Review prepared task',()=>void this.model.review());
 readonly checkAdmission=button('Check original admission',()=>void this.model.reconcile());
 readonly acknowledge=button('Acknowledge admission or rejection',()=>void this.model.acknowledge());
 readonly retrySave=button('Retry saving current draft',()=>void this.model.edit(this.model.draft));
 readonly detail=button('Read current task',()=>{const task=this.model.currentTask;if(task)this.onTask(task.id);});
 readonly more=button('Load more agents',()=>void this.model.loadOptions(true));
 #errors=new Map<TaskField,HTMLParagraphElement>();#optionKeys=new Map<string,string>();
 constructor(readonly model:TaskComposition,private readonly onTask:(id:string)=>void){
  const fields:[TaskField,string,HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement][]=[['title','Title',this.title],['description','Description',this.description],['project_id','Project',this.selects.project_id],['work_role_id','Work role',this.selects.work_role_id],['assigned_agent_id','Assigned agent',this.selects.assigned_agent_id]];
  for(const [field,label,input] of fields){const error=el('p',undefined,{id:'task-'+field+'-error'});this.#errors.set(field,error);[el('label',label,{for:'task-'+field}),input,error].forEach(node=>this.form.appendChild(node));input.addEventListener(field==='title'||field==='description'?'input':'change',()=>void this.edit());}
  [el('p','Initial Backlog state, versions, actor and execution policy are server-owned. Limit: 65,536 UTF-8 bytes for the complete JSON envelope.',{id:'task-compose-limits'}),this.error,this.send].forEach(node=>this.form.appendChild(node));
  this.form.addEventListener('submit',async event=>{event.preventDefault();await model.submit();this.update();const errors=model.errors;const first=fields.find(([field])=>errors[field]);if(first)first[2].focus();else if(errors.form)this.error.focus();});
  [el('h2','New Backlog task',{id:'task-compose-heading'}),this.form,button('Refresh choices',()=>void model.loadOptions()),this.more,this.review,this.retrySave,this.checkAdmission,this.acknowledge,button('Discard text draft',()=>void model.discard()),button('Refresh current task',()=>void model.refreshTask()),this.status,this.detail].forEach(node=>this.element.appendChild(node));
 }
 private edit(){const body={title:this.title.value,description:this.description.value} as TaskCreateRequest;for(const field of references){const value=this.selects[field].value;if(value==='null')body[field]=null;else if(value.startsWith('id:'))body[field]=value.slice(3);}return this.model.edit(body);}
 update(){const draft=this.model.draft,state=this.model.state,errors=this.model.errors;
  if(this.title.value!==draft.title)this.title.value=draft.title;if(this.description.value!==draft.description)this.description.value=draft.description;
  const choices={project_id:this.model.projects,work_role_id:this.model.roles,assigned_agent_id:this.model.agents};
  for(const field of references){const selected=draft[field],rows=choices[field].map(row=>({id:row.id,label:row.display_name}));if(typeof selected==='string'&&!rows.some(row=>row.id===selected))rows.push({id:selected,label:'Saved selection — review current availability'});const key=JSON.stringify(rows);if(this.#optionKeys.get(field)!==key){this.#optionKeys.set(field,key);this.selects[field].replaceChildren(el('option','Omit (server default)',{value:'omit'}),el('option','Explicitly none (null)',{value:'null'}),...rows.map(row=>el('option',row.label+' · '+row.id,{value:'id:'+row.id})));}this.selects[field].value=selected===undefined?'omit':selected===null?'null':'id:'+selected;}
  const held=['inactive','preparing','pending','checking','reconciliation-required','storage-error'].includes(state.status);this.title.disabled=held;this.description.disabled=held;
  for(const field of references)this.selects[field].disabled=held||(field==='assigned_agent_id'?!this.model.agentsAvailable:!this.model.catalogAvailable)&&draft[field]===undefined;
  for(const [field,node] of this.#errors){node.textContent=errors[field]??'';const input=field==='title'?this.title:field==='description'?this.description:this.selects[field];input.setAttribute('aria-invalid',String(!!errors[field]));}
  this.error.textContent=errors.form??'';this.send.disabled=held||state.status==='confirmed'||state.status==='rejected';this.review.hidden=!['revalidation-required','preparation-error'].includes(state.status);this.retrySave.hidden=state.status!=='storage-error';this.checkAdmission.hidden=!['reconciliation-required','checking','confirmed'].includes(state.status);this.checkAdmission.disabled=state.status==='checking';this.acknowledge.hidden=!['confirmed','rejected'].includes(state.status);this.more.hidden=!this.model.cursor;this.detail.hidden=!this.model.currentTask;
  this.status.textContent=state.status==='confirmed'?'Original task admission confirmed: '+state.entry?.intent?.entityId+'. '+(this.model.currentTask?'Current authorized state: '+this.model.currentTask.state+'.':'Current task unavailable; no current state is inferred.')+' Admission is not execution or completion.':state.status==='reconciliation-required'?'Outcome unknown. Check original admission; no automatic resend or replacement key.':state.status==='preparation-error'?'Preparation failed. No task was sent by this attempt. Review or retry the same prepared intent.':state.status==='revalidation-required'?'Current permission or references need review. Text is retained.':state.status==='rejected'?'Server rejected this request. Text is retained; acknowledge before a new submission.':state.status==='storage-error'?'Local persistence failed. Submission is blocked.':state.status==='checking'?'Checking original admission only; no task is sent.':state.status==='pending'?'Admission pending; execution is not established.':state.status==='inactive'?'Current authorized session required.':'Draft only — not admitted.';
 }
}
