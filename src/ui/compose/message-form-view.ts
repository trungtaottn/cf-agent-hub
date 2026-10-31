import type {MessageComposition} from './message-form';
import {el,button} from '../dom';
/** Stable semantic DOM; textContent only, no HTML rendering of remote text. */
export class MessageForm {
 readonly element=el('section',undefined,{class:'card','aria-labelledby':'message-compose-title','data-testid':'message-composer'});
 readonly form=el('form');
 readonly referenceId=el('input',undefined,{'aria-label':'Reference ID'});
 readonly referenceKind=el('select',undefined,{'aria-label':'Reference kind'});
 readonly threadInput=el('input',undefined,{'aria-label':'Thread ID for reply or message references'});
 readonly file=el('input',undefined,{type:'file',multiple:'','aria-label':'Files to upload (committed attachments only)'});
 readonly resources=el('fieldset');readonly referenceList=el('ul');readonly attachmentList=el('ul');readonly messageChoices=el('div');readonly replyContext=el('p',undefined,{'data-testid':'message-reply-context'});
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
 #roster='';#resourceSnapshot='';#attachmentSnapshot='';#messageSnapshot='';#checks=new Map<string,HTMLInputElement>();
 constructor(readonly model:MessageComposition,private readonly onThread:(id:string)=>void){
  const form=this.form,label=el('label','Message text',{for:'message-compose-body'});
  for(const kind of ['task','artifact','message'])this.referenceKind.append(el('option',kind,{value:kind}));
  this.resources.append(el('legend','Authorized references, reply and attachments'),this.replyContext,this.threadInput,button('Read reference thread',()=>void model.loadReferenceThread(this.threadInput.value)),button('Reply to observed thread',()=>void model.selectThread(this.threadInput.value)),button('Start new thread',()=>void model.startNewThread()),this.messageChoices,this.referenceKind,this.referenceId,button('Add reference',()=>void model.addReference(this.referenceKind.value as 'task'|'artifact'|'message',this.referenceId.value)),this.referenceList,this.file,this.attachmentList,el('p','Only committed attachment IDs are saved. Removing an upload removes local bytes and message association only; server artifacts may remain. Committed orphan artifacts are not automatically deleted.'));
  this.file.addEventListener('change',()=>{const files=Array.from(this.file.files??[]);this.file.value='';for(const file of files)void model.uploads?.add(file);});
  form.append(label,this.body,this.recipients,this.resources,el('p','32,768 UTF-8 body bytes; 65,536 envelope bytes; 8,192 reference bytes. At most five distinct artifacts, 10,485,760 bytes per file and 26,214,400 aggregate bytes.',{id:'message-compose-limits'}),this.error,this.send);
  form.addEventListener('submit',async event=>{event.preventDefault();await this.model.submit();this.update();if(this.model.validationError){if(this.model.validationField==='body'||!this.model.body)this.body.focus();else if(this.model.validationField==='refs')this.referenceId.focus();else this.error.focus();}});this.error.setAttribute('tabindex','-1');
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
  const refs=this.model.references,ids=this.model.artifactIds,resourceSnapshot=JSON.stringify([refs,ids]);if(resourceSnapshot!==this.#resourceSnapshot){this.#resourceSnapshot=resourceSnapshot;this.referenceList.replaceChildren();for(const ref of refs){const item=el('li',ref.kind+' '+ref.id);item.append(button('Remove reference '+ref.id,()=>void this.model.removeReference(ref.kind,ref.id)));this.referenceList.append(item);}for(const id of ids){const item=el('li','Committed attachment '+id);item.append(button('Remove attachment '+id,()=>void this.model.removeArtifact(id)));this.referenceList.append(item);}}
  const uploads=this.model.uploads?.items??[],attachmentSnapshot=JSON.stringify(uploads);if(attachmentSnapshot!==this.#attachmentSnapshot){this.#attachmentSnapshot=attachmentSnapshot;this.attachmentList.replaceChildren();for(const upload of uploads){const item=el('li',upload.filename+' — '+upload.status+' ('+upload.bytes+' bytes)');if(upload.artifactId&&upload.status!=='committed'){item.append(button('Check upload '+upload.filename,()=>void this.model.uploads?.check(upload.id)),button('Retry exact upload '+upload.filename,()=>void this.model.uploads?.retry(upload.id)));}item.append(button('Abandon local upload '+upload.filename,()=>{this.model.uploads?.remove(upload.id);if(upload.artifactId)void this.model.removeArtifact(upload.artifactId);}));if(upload.status==='stage-unknown')item.append(el('p','Stage outcome unknown. No retry: abandon only local state; the server artifact may exist.'));this.attachmentList.append(item);}}
  const messages=this.model.referenceMessages,messageSnapshot=JSON.stringify(messages.map(m=>m.id));if(messageSnapshot!==this.#messageSnapshot){this.#messageSnapshot=messageSnapshot;this.messageChoices.replaceChildren();for(const m of messages)this.messageChoices.append(button('Reference message '+m.id,()=>void this.model.addReference('message',m.id)));}
  this.replyContext.textContent=this.model.replyThreadId?'Reply to '+this.model.replyThreadId+' — recipients are an observed subset, not full membership. Server checks permission to reply.':'New thread — no previous history is included.';
  const state=this.model.state,held=['inactive','preparing','pending','checking','reconciliation-required','storage-error'].includes(state.status);
  this.body.disabled=held;this.recipients.disabled=held;this.resources.disabled=held||state.status==='confirmed';this.file.disabled=held||!this.model.canUpload;this.send.disabled=held||state.status==='confirmed'||state.status==='rejected';
  this.error.textContent=this.model.validationError??this.model.uploads?.error??'';this.body.setAttribute('aria-invalid',String(!!this.model.validationError&&(!this.model.validationField||this.model.validationField==='body')));this.referenceId.setAttribute('aria-invalid',String(!!this.model.validationError&&this.model.validationField==='refs'));this.recipients.setAttribute('aria-invalid',String(!!this.model.validationError&&this.model.validationField==='recipient_agent_ids'));
  this.checkAdmission.hidden=!['reconciliation-required','checking','confirmed'].includes(state.status);this.checkAdmission.disabled=state.status==='checking';this.retrySave.hidden=state.status!=='storage-error';this.more.hidden=!this.model.cursor;this.review.hidden=!['revalidation-required','preparation-error'].includes(state.status);this.acknowledge.hidden=state.status!=='confirmed'&&state.status!=='rejected';this.thread.hidden=!this.model.threadId;
  this.status.textContent=state.status==='preparation-error'?'Preparation failed. No message was sent by this attempt. The original request is retained; retry preparation or review before editing.':state.status==='confirmed'?'Durably admitted message '+state.entry?.intent?.entityId+'. Delivery and recipient ACK are not established.':state.status==='reconciliation-required'?'Outcome unknown. Check the retained original admission; unknown results remain held with no automatic resend.':state.status==='rejected'?'Server rejected this request. The draft is retained; acknowledge before another deliberate submission.':state.status==='storage-error'?'Local persistence failed. Sending is blocked; no saved request is assumed.':state.status==='revalidation-required'?'Current recipients, references, attachments, or authority changed. Review prepared message before editing or retrying.':state.status==='checking'?'Checking retained admission only; no message is sent.':state.status==='pending'?'Admission pending; delivery is not yet known.':state.status==='inactive'?'Current session and online connection required.':'Draft only — not sent.';
 }
}
