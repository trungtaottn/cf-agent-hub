import type {MessageComposition} from './message-form';
import {el,button} from '../dom';
/** Stable semantic DOM; textContent only, no HTML rendering of remote text. */
export class MessageForm {
 readonly element=el('section',undefined,{class:'card','aria-labelledby':'message-compose-title','data-testid':'message-composer'});
 readonly body=el('textarea',undefined,{id:'message-compose-body',rows:'6','aria-describedby':'message-compose-error message-compose-limits'});
 readonly recipients=el('fieldset');
 readonly status=el('p',undefined,{role:'status','aria-live':'polite','data-testid':'message-compose-status'});
 readonly error=el('p',undefined,{id:'message-compose-error',role:'alert'});
 readonly send=el('button','Send message',{type:'submit'});
 readonly more=button('Load more recipients',()=>void this.model.loadRecipients(true));
 readonly retrySave=button('Retry saving current draft',()=>void this.model.edit(this.body.value,this.model.recipients));
 readonly review=button('Review prepared message',()=>void this.model.review());
 readonly checkAdmission=button('Check original admission',()=>void this.model.reconcile());
 readonly acknowledge=button('Acknowledge admission or rejection',()=>void this.model.acknowledge());
 readonly thread=button('Read admitted thread',()=>{const id=this.model.threadId;if(id)this.onThread(id);});
 #roster='';#checks=new Map<string,HTMLInputElement>();
 constructor(readonly model:MessageComposition,private readonly onThread:(id:string)=>void){
  const form=el('form'),label=el('label','Message text',{for:'message-compose-body'});
  form.append(label,this.body,this.recipients,el('p','Text-only: 32,768 UTF-8 body bytes and 65,536 envelope bytes. References and attachments are not available in this slice.',{id:'message-compose-limits'}),this.error,this.send);
  form.addEventListener('submit',event=>{event.preventDefault();void this.model.submit();});
  this.body.addEventListener('input',()=>void model.edit(this.body.value,[...this.#checks].filter(([,c])=>c.checked).map(([id])=>id)));
  this.element.append(el('h2','New message',{id:'message-compose-title'}),form,this.more,button('Refresh recipients',()=>void model.loadRecipients()),this.review,this.retrySave,this.checkAdmission,this.acknowledge,button('Discard text draft',()=>void model.discard()),this.status,this.thread);
  this.element.hidden=true;
 }
 update(){
  if(this.body.value!==this.model.body)this.body.value=this.model.body;
  const selected=this.model.recipients,agents=this.model.agents.map(a=>({id:a.id,display_name:a.display_name}));for(const id of selected)if(!agents.some(a=>a.id===id))agents.push({id,display_name:'Saved recipient — not observed in current page'});const key=JSON.stringify(agents.map(a=>[a.id,a.display_name]));
  if(key!==this.#roster){this.#roster=key;this.#checks.clear();this.recipients.replaceChildren(el('legend','Recipients (current authorized page, not complete workspace membership)'));
   for(const agent of agents){const input=el('input',undefined,{type:'checkbox',value:agent.id}),label=el('label',agent.display_name+' · '+agent.id);input.addEventListener('change',()=>void this.model.edit(this.body.value,[...this.#checks].filter(([,c])=>c.checked).map(([id])=>id)));label.append(input);this.recipients.append(label);this.#checks.set(agent.id,input);}
  }
  for(const [id,input]of this.#checks)input.checked=selected.includes(id);
  const state=this.model.state,held=['inactive','preparing','pending','checking','reconciliation-required','storage-error'].includes(state.status);
  this.body.disabled=held;this.recipients.disabled=held;this.send.disabled=held||state.status==='confirmed'||state.status==='rejected'||!!this.model.validationError;
  this.error.textContent=this.model.validationError??'';this.body.setAttribute('aria-invalid',String(!!this.model.validationError));
  this.checkAdmission.hidden=!['reconciliation-required','checking','confirmed'].includes(state.status);this.checkAdmission.disabled=state.status==='checking';this.retrySave.hidden=state.status!=='storage-error';this.more.hidden=!this.model.cursor;this.review.hidden=!['revalidation-required','preparation-error'].includes(state.status);this.acknowledge.hidden=state.status!=='confirmed'&&state.status!=='rejected';this.thread.hidden=!this.model.threadId;
  this.status.textContent=state.status==='preparation-error'?'Preparation failed. No message was sent by this attempt. The original request is retained; retry preparation or review before editing.':state.status==='confirmed'?'Durably admitted message '+state.entry?.intent?.entityId+'. Delivery and recipient ACK are not established.':state.status==='reconciliation-required'?'Outcome unknown. Check the retained original admission; unknown results remain held with no automatic resend.':state.status==='rejected'?'Server rejected this request. The draft is retained; acknowledge before another deliberate submission.':state.status==='storage-error'?'Local persistence failed. Sending is blocked; no saved request is assumed.':state.status==='revalidation-required'?'Current recipients or authority changed. Review prepared message before editing or retrying.':state.status==='checking'?'Checking retained admission only; no message is sent.':state.status==='pending'?'Admission pending; delivery is not yet known.':state.status==='inactive'?'Current session and online connection required.':'Draft only — not sent.';
 }
}
