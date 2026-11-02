import type {DecisionActionState} from './decision-actions';
import {renderInput} from './input-viewer';
import {el,button} from '../dom';
export interface DecisionActionViewOptions {
 onReason:(reason:string)=>void;onConfirm:()=>void;onSubmit:()=>void;onReplay:()=>void;onRefresh:()=>void;onPrepare:()=>void;nowMs?:number;
}
/** Inert source rendering. Host supplies current paint/lifetime-fenced callbacks. */
export function renderDecisionActions(state:Readonly<DecisionActionState>,options:DecisionActionViewOptions):HTMLElement{
 const root=el('section',undefined,{'aria-label':'Human decision request','data-testid':'decision-action-panel'});
 root.append(el('h2',state.operation==='approveApproval'?'Approval request':state.operation==='rejectApproval'?'Rejection request':'Decision outcome'));
 const unknown=state.status==='pending'||state.status==='uncertain',v=state.observation;
 const status=state.status==='uncertain'?'Original outcome unknown. Only the original immutable request may be replayed.':state.status==='pending'?'Original request pending. Do not submit a second intent.':state.status==='unresolved'?'Original outcome remains unresolved. Private intent was cleared; navigation does not cancel a dispatched request.':state.status==='succeeded'?'Server confirmed the original decision transition, not execution or completion.':'Decision request: '+state.status;
 root.append(el('p',status+(state.code?' · '+state.code:''),{role:'status','aria-live':'polite','aria-atomic':'true'}));
 root.append(el('p','The server checks current policy and action availability. This view does not enable a product action.'));
 if(state.status==='preparing'||state.status==='unresolved')return root;
 const expired=Boolean(v&&Date.parse(v.approval.expires_at)<=(options.nowMs??Date.now()));
 if(v){
  root.append(el('p','Approval '+v.approval.id+' · task '+v.task.id+' · task version '+v.task.task_version+' · proposal version '+v.approval.proposal_version+' · approval version '+v.approval.approval_version+' · task version at request '+v.approval.task_version_at_request),el('p','Original expiry: '+v.approval.expires_at+(expired?' · locally expired; server status is authoritative':'')),el('p',v.approval.proposal.summary),el('p','Action: '+v.approval.proposal.action));
  root.append(el('pre',JSON.stringify(v.approval.proposal.scope,null,2),{'aria-label':'Exact requested scope',tabindex:'0'}),
   el('pre',JSON.stringify(v.approval.checkpoint,null,2),{'aria-label':'Immutable checkpoint',tabindex:'0'}),
   el('p','Reviewing human: '+v.access.actor.principal_id+' · assigned humans: '+v.approval.assigned_human_principal_ids.join(', ')),
   el('p','Requested by: '+v.approval.requested_by.principal_id+' · original run: '+v.approval.run_id),
   el('p','Input artifact: '+v.artifact.id+' · artifact version '+v.artifact.artifact_version+' · '+v.artifact.byte_size+' bytes'),
   el('p','Proposal input SHA-256: '+v.approval.proposal.inputs.sha256+' · committed metadata SHA-256: '+v.artifact.sha256));
  if(v.mode==='exact'&&v.input)root.append(renderInput(v.input));
  else root.append(el('p','Reject using current metadata; exact input was not inspected.',{'data-testid':'decision-metadata-only'}));
 }
 const body=v?{expected_version:v.task.task_version,expected_proposal_version:v.approval.proposal_version,expected_approval_version:v.approval.approval_version,reason:state.reason}:null;
 const invalidReason=state.reason.length===0||body!==null&&new TextEncoder().encode(JSON.stringify(body)).length>65536;
 const reason=el('textarea',undefined,{id:'decision-reason',name:'reason',autocomplete:'off','aria-label':'Decision reason','data-focus-key':'decision-reason','data-reason-revision':String(state.reasonRevision)});
 reason.value=state.reason;if(unknown)reason.setAttribute('disabled','');
 if(state.code==='CURRENT_REVIEW_REQUIRED'&&invalidReason){reason.setAttribute('aria-invalid','true');reason.setAttribute('aria-describedby','decision-reason-error');root.append(el('p','Enter a reason within the 65,536-byte complete request limit.',{id:'decision-reason-error'}));}
 reason.addEventListener('input',()=>options.onReason(reason.value));root.append(el('label','Decision reason',{for:'decision-reason'}),reason);
 const control=(label:string,callback:()=>void,enabled:boolean,key:string)=>{const node=button(label,callback,{'data-focus-key':key});if(!enabled)node.setAttribute('disabled','');return node;};
 root.append(control('Confirm reviewed request',options.onConfirm,state.status==='review'&&!!v&&!invalidReason&&!expired,'decision-confirm'),control('Send decision request',options.onSubmit,state.status==='ready'&&!expired,'decision-send'));
 if(state.status==='uncertain')root.append(control('Replay original request',options.onReplay,true,'decision-replay'));
 if(['uncertain','conflict','succeeded','rejected'].includes(state.status))root.append(control('Refresh current outcome',options.onRefresh,true,'decision-current-refresh'),el('p','Current reads do not resolve an unknown original outcome or prove which request committed.'));
 if(!unknown&&(['idle','conflict','rejected','succeeded'].includes(state.status)||state.status==='review'&&!v))root.append(control('Review current decision again',options.onPrepare,!!state.approvalId&&!!state.operation,'decision-review-again'));
 if(state.currentObservation){const current=state.currentObservation;root.append(el('p','Separately observed current state: '+current.approval.status+' · task '+current.task.state+' · task version '+current.task.task_version+' · approval version '+current.approval.approval_version,{'data-testid':'decision-current-observation'}));}
 return root;
}
