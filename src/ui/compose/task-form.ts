import type {Agent,ProfileData,Task,TaskCreateRequest} from '../../http/dto';
import type {ApiResult,BrowserReadRequest,BrowserComposeRequest,BrowserComposeReconcileRequest,BrowserComposePrepareRequest} from '../../../packages/client/src/types';
import {prepareNativeOperation,canonicalBody} from '../../../packages/client/src/native-request';
import {classifyWriteResult} from '../write-intent';
import {DraftStore,draftBody} from './draft-store';
import {SubmitController,type ComposeBinding} from './submit-intent';
export type TaskField=keyof TaskCreateRequest;
export type TaskErrors=Partial<Record<TaskField|'form',string>>;
export interface TaskCompositionOptions {
 store:DraftStore;currentBinding:()=>ComposeBinding|null;
 /** Current authenticated human + actual tasks:create capability. Picker reads grant nothing. */
 verifyAuthority:()=>Promise<boolean>;
 /** Existing HubClient.request('getProfile', {}), not a new reference endpoint. */
 getProfile:()=>Promise<ApiResult<ProfileData>>;
 read:BrowserReadRequest;prepare:BrowserComposePrepareRequest;send:BrowserComposeRequest;
 reconcile?:BrowserComposeReconcileRequest;changed:()=>void;
}
const empty=():TaskCreateRequest=>({title:'',description:''});
/** Task form state only; durable intent/dispatch/reconciliation belong to SubmitController. */
export class TaskComposition {
 readonly controller:SubmitController;
 #generation=0;#scope:ComposeBinding|null=null;#clearing=false;#eraseFailed=false;
 #draft=empty();#errors:TaskErrors={};#profile:ProfileData|null=null;#agents:Agent[]=[];#cursor:string|null=null;#agentsAvailable=false;#optionsRequest=0;
 #task:Task|null=null;#detailRequest=0;#edit=0;#saved=0;#edits:Promise<void>=Promise.resolve();#flight:Promise<void>|null=null;
 constructor(private readonly options:TaskCompositionOptions){
  this.controller=new SubmitController({draftId:'task-compose',store:options.store,currentBinding:options.currentBinding,
   revalidate:async(op,body)=>op==='createTask'&&await (this.controller.state.status==='checking'?this.lookupAuthority():this.references(body as TaskCreateRequest)),prepare:options.prepare,reconcile:options.reconcile,
   send:async(op,input,opts)=>{const g=this.#generation,c=this.capture(),edit=this.#edit,revision=this.draftRevision();const result=await options.send(op,input,opts);if(c&&this.same(g,c)&&!result.ok&&['rejected','conflict'].includes(classifyWriteResult(result))){const field=result.error.details?.field;const name=typeof field==='string'?field.replace(/^\/(body\/)?/,''):'';this.#errors=this.errorApplies(input.body,edit,revision)?{[['title','description','project_id','work_role_id','assigned_agent_id'].includes(name)?name:'form']:'Request rejected. Review the retained values before another submission.'}:{...this.validate(this.#draft),form:'The original retained request was rejected, not the current draft. Acknowledge its outcome before submitting these edits.'};}return result;}});
 }
 private capture(){const c=this.options.currentBinding();return c?{...c}:null;}
 private same(g:number,c:ComposeBinding){const now=this.options.currentBinding();return g===this.#generation&&!!now&&now.workspaceId===c.workspaceId&&now.principalId===c.principalId&&now.generation===c.generation;}
 private visible(){return !!this.#scope&&this.same(this.#generation,this.#scope);}
 get state(){return this.#eraseFailed?{status:'storage-error' as const,entry:null}:this.visible()?this.controller.state:{status:'inactive' as const,entry:null};}
 get draft(){return structuredClone(this.visible()?this.#draft:empty());}get errors(){return this.visible()?{...this.#errors}:{};}
 get projects(){return structuredClone((this.visible()?this.#profile:null)?.profile.projects.filter(p=>!p.archived)??[]);}
 get roles(){return structuredClone((this.visible()?this.#profile:null)?.profile.work_roles.filter(p=>!p.archived)??[]);}
 get catalogAvailable(){return this.visible()&&this.#profile!==null;}get agentsAvailable(){return this.visible()&&this.#agentsAvailable;}get agents(){return structuredClone(this.visible()?this.#agents:[]);}get cursor(){return this.visible()?this.#cursor:null;}
 get currentTask(){return this.state.status==='confirmed'&&this.#task?structuredClone(this.#task):null;}
 private validate(body:TaskCreateRequest):TaskErrors {const c=this.capture();if(!c)return {form:'Current authenticated session required.'};try{prepareNativeOperation('https://browser.invalid',c.workspaceId,'createTask',{body});return {};}catch{return typeof body?.title==='string'&&body.title.length===0?{title:'Enter a title.'}:{form:'Use only native task fields within the 65,536-byte UTF-8 JSON envelope.'};}}
 private async lookupAuthority(){const g=this.#generation,c=this.capture();if(!c)return false;try{return await this.options.verifyAuthority()&&this.same(g,c);}catch{return false;}}
 private draftRevision(){return this.state.entry?.draft?.revision??this.state.entry?.intent?.draftRevision??0;}
 private errorApplies(body:unknown,edit:number,revision:number){const intent=this.state.entry?.intent;return edit===this.#edit&&revision===this.draftRevision()&&canonicalBody(body)===canonicalBody(this.#draft)&&(!intent||intent.bodyJson!==canonicalBody(body)||intent.draftRevision===revision);}
 private async references(body:TaskCreateRequest):Promise<boolean>{
  const g=this.#generation,c=this.capture(),edit=this.#edit,revision=this.draftRevision();if(!c)return false;
  let allowed=false;try{allowed=await this.options.verifyAuthority();}catch{/* fail closed */}if(!this.same(g,c))return false;
  const errors:TaskErrors={};if(!allowed)errors.form='Current permission to create tasks is unavailable.';
  // Missing optional read scopes do not impose a new policy on omitted/null references.
  let profile:ApiResult<ProfileData>|null=null;try{profile=await this.options.getProfile();}catch{/* unavailable catalog */}if(!this.same(g,c))return false;
  for(const [field,list] of [['project_id','projects'],['work_role_id','work_roles']] as const){const id=body[field];if(typeof id==='string'&&(!profile?.ok||!profile.data.profile[list].some(p=>p.id===id&&!p.archived)))errors[field]='Saved selection is unavailable or archived. Review this field.';}
  if(typeof body.assigned_agent_id==='string'){let result;try{result=await this.options.read('getAgent',{path:{agent_id:body.assigned_agent_id}});}catch{/* unavailable assignment */}if(!this.same(g,c))return false;if(!result?.ok||result.data.id!==body.assigned_agent_id||result.data.workspace_id!==c.workspaceId||result.data.status!=='active')errors.assigned_agent_id='Assigned agent is unavailable or archived. Review this field.';}
  this.#errors={...this.validate(this.#draft),...(this.errorApplies(body,edit,revision)?errors:Object.keys(errors).length?{form:'The original retained request needs review, not the current draft. Review that original intent before submitting these edits.'}:{})};this.options.changed();return Object.keys(errors).length===0;
 }
 private restore(){const text=this.state.entry?.draft?.bodyJson??this.state.entry?.intent?.bodyJson;this.#draft=text?JSON.parse(text):empty();this.#errors={};}
 async open(){if(this.#clearing||this.#eraseFailed)return;this.invalidate();const g=this.#generation,c=this.capture();this.#scope=c;if(!c)return;let allowed=false;try{allowed=await this.options.verifyAuthority();}catch{}if(!allowed||!this.same(g,c))return;await this.controller.open();if(!this.same(g,c))return;this.restore();this.#edit=0;this.#saved=0;this.options.changed();await this.loadOptions();if(!this.same(g,c))return;await this.references(this.#draft);if(this.same(g,c)&&this.state.status==='confirmed')await this.refreshTask();}
 async loadOptions(more=false){const g=this.#generation,c=this.capture(),request=++this.#optionsRequest;if(!c)return;const cursor=more?this.#cursor:null;if(more&&!cursor)return;
  const [profile,agents]=await Promise.all([this.options.getProfile().catch(()=>null),this.options.read('listAgents',{query:{limit:20,...(cursor?{cursor}:{})}}).catch(()=>null)]);if(!this.same(g,c)||request!==this.#optionsRequest)return;
  this.#profile=profile?.ok?profile.data:null;this.#agentsAvailable=!!agents?.ok;
  this.#agents=agents?.ok?[...new Map([...(more?this.#agents:[]),...agents.data.filter(a=>a.workspace_id===c.workspaceId&&a.status==='active')].map(a=>[a.id,a])).values()]:[];this.#cursor=agents?.ok?agents.page?.next_cursor??null:null;this.options.changed();
 }
 edit(body:TaskCreateRequest):Promise<void>{const g=this.#generation,c=this.capture();if(!c)return Promise.resolve();const edit=++this.#edit;this.#draft=structuredClone(body);this.#errors=this.validate(body);const payload=structuredClone(body);let canStore=true;try{draftBody('createTask',payload);}catch{canStore=false;}this.options.changed();const job=this.#edits.then(async()=>{if(!this.same(g,c)||!canStore)return;await this.controller.save('createTask',payload);if(this.same(g,c)){if(this.state.status!=='storage-error'&&this.state.entry?.draft?.bodyJson===canonicalBody(payload))this.#saved=edit;this.options.changed();}});this.#edits=job.catch(()=>{});return job;}
 submit():Promise<void>{if(this.#flight)return this.#flight;const g=this.#generation,c=this.capture();const job=(async()=>{await this.#edits;if(!c||!this.same(g,c))return;
  // A retained intent always goes back through the controller unchanged, never a new draft/key.
  if(!this.state.entry?.intent){this.#errors=this.validate(this.#draft);if(this.#saved!==this.#edit&&!Object.keys(this.#errors).length)this.#errors.form='Current edit is not durably saved. Retry saving before submitting.';if(Object.keys(this.#errors).length){this.options.changed();return;}}
  const pending=this.controller.submit();this.options.changed();await pending;if(!this.same(g,c))return;if(this.state.status==='confirmed')await this.refreshTask();if(this.same(g,c))this.options.changed();})();this.#flight=job.finally(()=>{this.#flight=null;});return this.#flight;}
 async refreshTask(){const request=++this.#detailRequest,g=this.#generation,c=this.capture(),id=this.state.status==='confirmed'?this.state.entry?.intent?.entityId:null;this.#task=null;if(!c||!id)return;let result;try{result=await this.options.read('getTask',{path:{task_id:id}});}catch{}if(!this.same(g,c)||request!==this.#detailRequest||this.state.entry?.intent?.entityId!==id)return;if(result?.ok&&result.data.id===id&&result.data.workspace_id===c.workspaceId)this.#task=result.data;this.options.changed();}
 async reconcile(){const g=this.#generation,c=this.capture();await this.#edits;if(!c||!this.same(g,c))return;const pending=this.controller.reconcile();this.options.changed();await pending;if(!this.same(g,c))return;if(this.state.status==='confirmed')await this.refreshTask();if(this.same(g,c))this.options.changed();}
 async review(){const g=this.#generation,c=this.capture();await this.controller.reviewPrepared();if(c&&this.same(g,c)){if(!this.state.entry?.intent)this.#errors=this.validate(this.#draft);this.options.changed();}}
 async acknowledge(){await this.clearDraft(false);}async discard(){await this.clearDraft(true);}
 private async clearDraft(discard:boolean){const g=this.#generation,c=this.capture(),edit=this.#edit;await this.#edits;if(!c||!this.same(g,c))return;if(discard)await this.controller.discard();else await this.controller.acknowledge();if(!this.same(g,c))return;if(edit===this.#edit){this.restore();this.#saved=this.#edit;}++this.#detailRequest;this.#task=null;this.options.changed();}
 invalidate(){++this.#generation;++this.#detailRequest;this.controller.invalidate();this.#draft=empty();this.#errors={};this.#profile=null;this.#agents=[];this.#agentsAvailable=false;this.#cursor=null;this.#task=null;this.options.changed();}
 async logout(){if(this.#clearing)return;const scope=this.#scope;this.#clearing=true;this.invalidate();try{if(scope)await this.options.store.clearScope(await this.options.store.bind(scope));this.#scope=null;this.#eraseFailed=false;}catch{this.#eraseFailed=true;}finally{this.#clearing=false;this.options.changed();}}
}
