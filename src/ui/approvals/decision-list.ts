import type {Approval} from '../../http/dto';
import type {Page,ApiResult} from '../../../packages/client/src/types';
import {validateApproval} from '../../http/generated/decision-validators.js';
import {ReadModel,type ReadState} from '../read-state';
import {el,button} from '../dom';
import {InputInspector} from './input-viewer';
import type {DecisionObservation} from './decision-actions';
import {loadDecisionMetadata,loadDecisionView,decisionAccess,invalidDecision,type DecisionBinding,type DecisionReader,type DecisionView} from './decision-detail';
/** One bounded page and one explicit selection; no automatic polling or all-page cache. */
export class DecisionReads {
 readonly list=new ReadModel<Approval[]>({isEmpty:items=>items.length===0});
 readonly detail=new ReadModel<DecisionView>({isEmpty:()=>false});
 #selectedId:string|null=null;#generation=0;#listGeneration=0;#abort:AbortController|null=null;#flight:Promise<unknown>|null=null;#displayRevision=0;#page:Page|null=null;
 readonly #inspector=new InputInspector();
 constructor(private readonly options:{workspaceId:string;currentBinding:()=>DecisionBinding|null;reader:DecisionReader;readerFor?:(current:()=>boolean)=>DecisionReader;changed?:()=>void}){}
 get displayRevision(){return this.#displayRevision;}
 get selectedId(){return this.#selectedId;}
 get page(){return this.#page;}
 #changed(){this.options.changed?.();}
 #same(binding:DecisionBinding):boolean{const now=this.options.currentBinding();return !!now?.online&&now.principalId===binding.principalId&&now.generation===binding.generation&&now.renderGeneration===binding.renderGeneration;}
 #clearDetail(displayChange=true){if(displayChange)++this.#displayRevision;++this.#generation;this.#abort?.abort();this.#abort=null;this.detail.unavailable('CURRENT_INSPECTION_REQUIRED');}
 invalidate(reason:'UNAUTHENTICATED'|'FORBIDDEN'='UNAUTHENTICATED'):void{this.#clearDetail();++this.#listGeneration;this.#page=null;this.#selectedId=null;this.list.invalidate(reason);this.detail.invalidate(reason);this.#changed();}
 disconnect():void{this.#clearDetail();++this.#listGeneration;this.#page=null;this.list.disconnect();this.detail.disconnect();this.#changed();}
 markStale(nowMs:number,maxAgeMs:number):void{const before=this.detail.state.status;this.list.markStale(nowMs,maxAgeMs);this.detail.markStale(nowMs,maxAgeMs);if(before!==this.detail.state.status)++this.#displayRevision;}
 /** One inspector and content-flight budget shared with ordinary detail reads.
  * The invocation predicate reaches host side effects, not merely returned data. */
 async observeForDecision(id:string,mode:'exact'|'metadata',invocationCurrent:()=>boolean):Promise<ApiResult<DecisionObservation>>{
  const binding=this.options.currentBinding();if(!binding?.online||!invocationCurrent()||!this.options.readerFor)return invalidDecision('OBSERVATION_INVALIDATED');
  // Transfer display ownership BEFORE the action captures its reviewed revision.
  if(this.#selectedId!==id||this.detail.state.data!==null)++this.#displayRevision;
  this.#selectedId=id;this.#clearDetail(false);const generation=this.#generation,stable={...binding},previous=this.#flight;
  const current=()=>generation===this.#generation&&this.#same(stable)&&invocationCurrent();
  const run=async():Promise<ApiResult<DecisionObservation>>=>{
   if(previous)await previous;if(!current())return invalidDecision('OBSERVATION_INVALIDATED');
   const abort=new AbortController();this.#abort=abort;
   const reader=this.options.readerFor!(current),options={id,workspaceId:this.options.workspaceId,principalId:stable.principalId,reader,signal:abort.signal,current};
   const result:ApiResult<DecisionObservation>=mode==='exact'
    ?await loadDecisionView({...options,inspector:this.#inspector}).then(r=>r.ok?{...r,data:{...r.data,mode:'exact' as const}}:r)
    :await loadDecisionMetadata(options).then(r=>r.ok?{...r,data:{...r.data,mode:'metadata' as const,input:null}}:r);
   if(!current())return invalidDecision('OBSERVATION_INVALIDATED');
   if(!result.ok){
    if(result.status===401||result.status===403||result.error.code==='CURRENT_AUTHORITY_REQUIRED'){this.invalidate(result.status===401?'UNAUTHENTICATED':'FORBIDDEN');}
    else if(result.status===404||result.status===410){++this.#listGeneration;this.#page=null;this.list.redact(items=>items.filter(a=>a.id!==id));this.#changed();}
    return result;
   }
   return result;
  };
  const flight=run();this.#flight=flight;
  try{return await flight;}finally{if(this.#flight===flight){this.#flight=null;this.#abort=null;}}
 }

 async refreshList():Promise<void>{await this.#loadList();}
 async next():Promise<void>{if(!['ready','empty'].includes(this.list.state.status)||!this.#page?.has_more||!this.#page.next_cursor)return;await this.#loadList(this.#page.next_cursor);}
 async #loadList(cursor?:string):Promise<void>{
  const binding=this.options.currentBinding();if(!binding?.online){this.disconnect();return;}
  const stable={...binding},generation=++this.#listGeneration;this.#page=null;
  const current=()=>generation===this.#listGeneration&&this.#same(stable),reader=this.options.readerFor?.(current)??this.options.reader;
  const pending=this.list.refresh(async()=>{
   const access=await reader.readAccess();if(generation!==this.#listGeneration||!this.#same(stable))return invalidDecision();
   if(!access.ok)return access;if(!decisionAccess(access.data,this.options.workspaceId,stable.principalId))return invalidDecision('CURRENT_AUTHORITY_REQUIRED');
   const result=await reader.listApprovals({limit:25,...(cursor?{cursor}:{})});if(generation!==this.#listGeneration||!this.#same(stable))return invalidDecision();
   if(!result.ok)return result;
   if(!Array.isArray(result.data)||result.data.length>25||result.data.some(a=>!validateApproval(a)||a.workspace_id!==this.options.workspaceId)||!result.page||typeof result.page.has_more!=='boolean'||result.page.has_more!==(result.page.next_cursor!==null)||result.page.next_cursor!==null&&(typeof result.page.next_cursor!=='string'||result.page.next_cursor.length<1||result.page.next_cursor.length>2048))return invalidDecision();
   return {...result,data:structuredClone(result.data)};
  },result=>{this.#page=result.page??null;});this.#changed();await pending;
  if(generation===this.#listGeneration&&!this.#same(stable)){this.invalidate();return;}
  if(this.list.state.status==='forbidden'||this.list.state.errorCode==='CURRENT_AUTHORITY_REQUIRED')this.invalidate(this.list.state.errorCode==='UNAUTHENTICATED'?'UNAUTHENTICATED':'FORBIDDEN');this.#changed();
 }
 async select(id:string|null):Promise<void>{this.#selectedId=id;this.#clearDetail();this.#changed();if(id!==null)await this.refreshDetail();}
 async refreshDetail():Promise<void>{
  this.#clearDetail();const id=this.#selectedId,binding=this.options.currentBinding(),generation=this.#generation;
  if(!id||!binding?.online){this.#changed();return;}const stable={...binding};
  // Cancel old work immediately, then serialize its bounded cleanup before a new
  // content read. InputInspector separately fences an unfinished native digest.
  const previous=this.#flight;
  const run=async()=>{if(previous)await previous;if(generation!==this.#generation||!this.#same(stable))return;
   const abort=new AbortController();this.#abort=abort;this.detail.reset();
   let failure:Extract<ApiResult<never>,{ok:false}>|null=null;
   const pending=this.detail.refresh(async()=>{const result=await loadDecisionView({id,workspaceId:this.options.workspaceId,principalId:stable.principalId,reader:this.options.readerFor?.(()=>generation===this.#generation&&this.#same(stable))??this.options.reader,inspector:this.#inspector,signal:abort.signal,current:()=>generation===this.#generation&&this.#same(stable)});if(!result.ok)failure=result;return result;});this.#changed();await pending;
   if(generation!==this.#generation)return;
   if(!this.#same(stable)){this.invalidate();return;}
   const failed=failure as Extract<ApiResult<never>,{ok:false}>|null;
   if(failed&&(failed.status===401||failed.status===403||failed.error.code==='CURRENT_AUTHORITY_REQUIRED')){this.invalidate(failed.status===401?'UNAUTHENTICATED':'FORBIDDEN');return;}
   if(failed&&(failed.status===404||failed.status===410)){++this.#listGeneration;this.#page=null;this.list.redact(items=>items.filter(a=>a.id!==id));}
   this.#changed();
  };
  const flight=run();this.#flight=flight;try{await flight;}finally{if(this.#flight===flight)this.#flight=null;}
 }
}
export function renderDecisionList(state:Readonly<ReadState<Approval[]>>,onSelect:(id:string)=>void,disabled=false):HTMLElement{
 const root=el('section',undefined,{'aria-label':'Decisions'});root.append(el('h2','Decisions'),el('p','Decision list: '+state.status+(state.errorCode?' · '+state.errorCode:''),{role:'status'}));
 if(state.data)for(const a of state.data){const row=el('article');row.append(button(a.proposal.summary+' · '+a.id,()=>onSelect(a.id),{'data-focus-key':'approval:'+a.id,...(disabled?{disabled:''}:{})}),el('p',a.status+' · proposal '+a.proposal_version+' · approval '+a.approval_version+' · expires '+a.expires_at));root.append(row);}
 root.append(el('p','Observed: '+(state.observedAt??'Not reported')+' · Request: '+(state.requestId??'Not reported'),{class:'evidence'}));
 if(state.status==='empty')root.append(el('p','No visible decisions in this bounded page.'));return root;
}
