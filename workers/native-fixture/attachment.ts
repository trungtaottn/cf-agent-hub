/** Private source attachment, not exported by the production Worker. Registration
 * is correlation, never authentication. Product super.fetch remains authoritative. */
import {WorkspaceDO} from '../../src/workspace/workspace-do';
import {canonicalJson,sha256} from '../../src/config/bootstrap';
import {clientOperations} from '../../src/http/generated/client-operations';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {admitCurrentCompleteFixture as admitCompleteFixture,readCurrentFixtureAdmissionCapture as readFixtureAdmissionCapture} from './fixture-admission';
import {createCurrentCompleteSelectedState as createCompleteSelectedState,currentCompletePhaseReservation as completePhaseReservation,type SelectedOriginal} from './selected-state';
type Obj=Record<string,unknown>;
type Registration={run_id:string;step_id:string;invocation_id:string;preparation_sha256:string;idempotency_key:string;request_body_sha256:string};
type CaptureSubject=Readonly<Omit<Registration,'idempotency_key'>&{idempotency_key_sha256:string}>;
type Capture={subject:CaptureSubject;before:readonly Readonly<SelectedOriginal>[];after:readonly Readonly<SelectedOriginal>[];requestBody:Uint8Array;responseBody:Uint8Array;beforeAt:number;afterAt:number;status:number;requestHeaders:Readonly<Record<string,string>>;responseHeaders:Readonly<Record<string,string>>};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const steps=[
 {id:'prepare/submitter-enrollment',actor:'S',path:'runtimes',operation:'domain.runtimes:manage',target:'runtimes:create',body:{label:'Native scenario submitter'},bodyCap:37,responseCap:2048},
 {id:'prepare/reviewer-enrollment',actor:'R',path:'runtimes',operation:'domain.runtimes:manage',target:'runtimes:create',body:{label:'Native scenario reviewer'},bodyCap:36,responseCap:2048},
 {id:'success/createTask',actor:'S',path:'tasks',operation:'domain.tasks:create',target:'tasks:create',body:{title:'Native scenario main',description:'Synthetic isolated conformance fixture'},bodyCap:87,responseCap:4096}
] as const;
const captures=new WeakMap<object,{records:Map<string,Capture>;available:()=>boolean}>();
function reject():never{throw Error('NATIVE_FIXTURE_ATTACHMENT_REJECTED');}
function check(value:unknown):asserts value{if(!value)reject();}
function object(value:unknown):Obj{check(value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype);return value as Obj;}
function closed(value:unknown,names:string[]):Obj{const v=object(value),ds=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(ds).length===names.length);const copy:Obj={};for(const name of names){const d=ds[name];check(d?.enumerable&&Object.hasOwn(d,'value'));copy[name]=d.value;}return copy;}
function copy(value:unknown,depth=0,budget={nodes:0,bytes:0}):unknown{
 check(depth<=8&&++budget.nodes<=256);
 const charge=(bytes:number)=>{budget.bytes+=bytes;check(budget.bytes<=16384);};
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isSafeInteger(value)||typeof value==='string'&&value.length<=2048){charge(encoder.encode(JSON.stringify(value)).length);return value;}
 const v=object(value),own=Reflect.ownKeys(v);check(own.length<=20&&own.every(k=>typeof k==='string'&&k.length<=64));charge(2);
 const entries:[string,unknown][]=[];
 for(const [i,key] of (own as string[]).entries()){
  const d=Object.getOwnPropertyDescriptor(v,key);check(d?.enumerable&&Object.hasOwn(d,'value'));
  charge(encoder.encode(JSON.stringify(key)).length+1+(i?1:0));entries.push([key,copy(d.value,depth+1,budget)]);
 }
 return Object.freeze(Object.fromEntries(entries));
}
function id(v:unknown):asserts v is string{check(typeof v==='string'&&v.length>0&&v.length<=64&&!/[^A-Za-z0-9_-]/.test(v));}
function digest(v:unknown):asserts v is string{check(typeof v==='string'&&v.length===64&&!/[^a-f0-9]/.test(v));}
function rows(originals:readonly Readonly<SelectedOriginal>[],selector:string):Obj[]{const row=originals.find(x=>x.selector===selector);check(row);return JSON.parse(row.canonical) as Obj[];}
function single(originals:readonly Readonly<SelectedOriginal>[],selector:string):Obj{const found=rows(originals,selector);check(found.length===1);return found[0];}
function equal(a:unknown,b:unknown){check(canonicalJson(a)===canonicalJson(b));}
function selectedHeaders(headers:Headers):Readonly<Record<string,string>>{const out:Record<string,string>={};for(const name of ['authorization','content-type','idempotency-key','x-runtime-token','origin','cookie','x-csrf-token','content-length','content-disposition']){const value=headers.get(name);if(value!==null)out[name]=value;}check(encoder.encode(canonicalJson(out)).length<=2048);return Object.freeze(out);}
/** Detached private copy, once only. No generic serialized result contains raw bytes. */
export function readAttachmentCapture(owner:unknown,invocationId:string):Capture{check(owner!==null&&typeof owner==='object');const state=captures.get(owner);check(state&&state.available());const map=state.records,held=map.get(invocationId);check(held);map.delete(invocationId);return Object.freeze({...held,requestBody:held.requestBody.slice(),responseBody:held.responseBody.slice()});}
/** Pure reconciliation seam; normal route production is tested separately. */
export function assertFreshTaskProjection(data:unknown,row:unknown):void{
 const t=closed(row,['workspace_id','id','title','description','state','task_version','proposal_version','project_id','work_role_id','assigned_agent_id','active_run_id','latest_run_id','approval_id','current_result_id','retry_count','retry_limit','flags_json','created_at','updated_at','next_fence','next_result_sequence']);
 const projected:Obj={};
 for(const key of ['id','workspace_id','title','description','state','task_version','proposal_version','project_id','work_role_id','assigned_agent_id','active_run_id','latest_run_id','approval_id','retry_count','retry_limit'])projected[key]=t[key];
 for(const key of ['project_id','work_role_id','assigned_agent_id','active_run_id','latest_run_id','approval_id','current_result_id'])check(t[key]===null);
 check(t.state==='backlog'&&t.task_version===1&&t.proposal_version===0&&t.retry_count===0&&t.retry_limit===0&&t.next_fence===1&&t.next_result_sequence===1&&t.flags_json==='[]'&&t.created_at===t.updated_at);
 projected.result=null;projected.flags=[];
 for(const key of ['created_at','updated_at']){check(Number.isSafeInteger(t[key])&&Number(t[key])>=0);projected[key]=new Date(Number(t[key])).toISOString();}
 equal(data,projected);
}
export class NativeFixtureAttachment extends WorkspaceDO{
 #run:Obj|null=null;#expected:Obj|null=null;#deadline=0;#bound=false;#failed=false;#closed=false;#active:Promise<unknown>|null=null;#slot:Registration|null=null;#index=0;#dispatches=0;
 #usedInvocations=new Set<string>();#usedKeys=new Set<string>();#runtimeIds=new Set<string>();#cleanupFailed=false;#cancellations=new Set<Promise<void>>();
 #reserved={queries:0,bridgeBytes:0,canonicalBytes:0,requestBytes:0,responseBytes:0,headerBytes:0,metadataBytes:0};
 #healthy(){check(!this.#failed&&!this.#closed&&Date.now()<this.#deadline);}
 #poison():never{this.#failed=true;return reject();}
 #owned<T>(fn:()=>Promise<T>,deadline:number):Promise<T>{
  if(this.#active||this.#failed||this.#closed)return Promise.reject(this.#poison());
  let timer:ReturnType<typeof setTimeout>|undefined;
  const work=Promise.resolve().then(fn).catch(()=>this.#poison()).finally(()=>{if(timer!==undefined)clearTimeout(timer);this.#active=null;});this.#active=work;
  const expired=new Promise<never>((_resolve,rejectDeadline)=>{timer=setTimeout(()=>{this.#failed=true;rejectDeadline(Error('NATIVE_FIXTURE_ATTACHMENT_REJECTED'));},Math.max(0,deadline-Date.now()));});
  return Promise.race([work,expired]);
 }
 async #bytes(body:ReadableStream<Uint8Array>|null,cap:number):Promise<Uint8Array<ArrayBuffer>>{
  check(body&&!body.locked);const reader=body.getReader(),parts:Uint8Array[]=[];let count=0,done=false;
  try{for(;;){const item=await reader.read();if(item.done){done=true;break;}this.#healthy();check(item.value instanceof Uint8Array&&item.value.byteLength>0);count+=item.value.byteLength;check(count<=cap);parts.push(item.value.slice());}const out=new Uint8Array(count);let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}return out;}
  finally{if(!done)try{await reader.cancel();}catch{this.#cleanupFailed=true;}reader.releaseLock();}
 }
 async bindFixture(input:unknown){
  try{
  if(this.#bound||this.#active||this.#closed||this.#failed)this.#poison();this.#bound=true;
  const v=closed(input,['run_id','run_deadline','expires_at','expected']);id(v.run_id);const now=Date.now();
  check(Number.isSafeInteger(v.run_deadline)&&Number(v.run_deadline)>now&&Number(v.run_deadline)<=now+300000);check(Number.isSafeInteger(v.expires_at)&&Number(v.expires_at)>now&&Number(v.expires_at)<=Number(v.run_deadline));
  const expected=object(copy(v.expected));check(expected.role==='primary');this.#deadline=Number(v.expires_at);
  return await this.#owned(async()=>{
   const w=object(object(expected.workspaces).primary);check(typeof w.object_name==='string'&&this.env.WORKSPACE.idFromName(w.object_name).toString()===this.ctx.id.toString());
   const admitted=await admitCompleteFixture(this.ctx.storage,expected);check(this.#deadline<=admitted.expiresAt);this.#healthy();
   // Baseline validation already consumed its own provision reservation. No claim
   // that effect-only counters below include this separate baseline allocation.
   readFixtureAdmissionCapture(admitted);this.#expected=expected;this.#run=Object.freeze({...v,expected:undefined});captures.set(this,{records:new Map(),available:()=>!this.#active&&!this.#failed&&!this.#closed&&Date.now()<this.#deadline});
   return Object.freeze({status:'bound',scope:'source-fixture-attachment',installedAuthority:false,native_conformance:false});
  },this.#deadline);
  }catch{this.#poison();}
 }
 registerProductSlot(input:unknown){
  try{this.#healthy();check(this.#run&&this.#expected&&!this.#active&&!this.#slot&&this.#index<steps.length&&captures.get(this)?.records.size===0);
   const v=closed(input,['run_id','step_id','invocation_id','preparation_sha256','idempotency_key','request_body_sha256']);id(v.run_id);id(v.invocation_id);digest(v.preparation_sha256);digest(v.request_body_sha256);
   check(v.run_id===this.#run.run_id&&v.step_id===steps[this.#index].id&&typeof v.idempotency_key==='string'&&/^r2_[a-f0-9]{32}$/.test(v.idempotency_key));
   check(!this.#usedInvocations.has(v.invocation_id)&&!this.#usedKeys.has(v.idempotency_key));
   this.#usedInvocations.add(v.invocation_id);this.#usedKeys.add(v.idempotency_key);this.#slot=Object.freeze(v) as Registration;
  }catch{this.#poison();}
 }
 override async fetch(request:Request):Promise<Response>{
  let cleanupOwned=false;
  try{return await this.#owned(async()=>{
   this.#healthy();check(this.#expected&&this.#slot);const slot=this.#slot,step=steps[this.#index];this.#slot=null;
   const expected=this.#expected,w=object(object(expected.workspaces).primary),actor=object(object(expected.actors)[step.actor]),human=object(expected.human);
   const beforeBudget=completePhaseReservation(step.id,'before'),afterBudget=completePhaseReservation(step.id,'after');
   const pair={queries:beforeBudget.queries+afterBudget.queries,bridgeBytes:beforeBudget.bridgeBytes+afterBudget.bridgeBytes,canonicalBytes:beforeBudget.canonicalBytes+afterBudget.canonicalBytes};
   const next={queries:this.#reserved.queries+pair.queries,bridgeBytes:this.#reserved.bridgeBytes+pair.bridgeBytes,canonicalBytes:this.#reserved.canonicalBytes+pair.canonicalBytes,requestBytes:this.#reserved.requestBytes+step.bodyCap,responseBytes:this.#reserved.responseBytes+step.responseCap,headerBytes:this.#reserved.headerBytes+4096,metadataBytes:this.#reserved.metadataBytes+1024};
   check(next.queries<=50&&next.bridgeBytes<=2368938&&next.canonicalBytes<=123510&&next.requestBytes<=160&&next.responseBytes<=8192&&next.headerBytes<=12288&&next.metadataBytes<=3072);this.#reserved=next;
   let response:Response|null=null,responseConsumed=false;let reader:ReturnType<typeof createCompleteSelectedState>|null=null;
   try{
    cleanupOwned=true;const subject:CaptureSubject=Object.freeze({run_id:slot.run_id,step_id:slot.step_id,invocation_id:slot.invocation_id,preparation_sha256:slot.preparation_sha256,request_body_sha256:slot.request_body_sha256,idempotency_key_sha256:await sha256(slot.idempotency_key)});check(encoder.encode(canonicalJson(subject)).length<=1024);this.#healthy();const url=new URL(request.url);check(request.method==='POST'&&url.origin===expected.origin&&url.pathname==='/v2/workspaces/'+w.id+'/'+step.path&&!url.search&&!url.hash);
    check(request.headers.get('idempotency-key')===slot.idempotency_key&&request.headers.get('content-type')==='application/json'&&!request.headers.has('cookie')&&!request.headers.has('x-runtime-token'));
    const requestHeaders=selectedHeaders(request.headers),authorization=request.headers.get('authorization');check(authorization&&/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization));check(await sha256(authorization.slice(7))===actor.token_sha256);
    const requestBody=await this.#bytes(request.body,step.bodyCap);check(requestBody.length===step.bodyCap&&await sha256(decoder.decode(requestBody))===slot.request_body_sha256);equal(JSON.parse(decoder.decode(requestBody)),step.body);this.#healthy();
    reader=createCompleteSelectedState(this.ctx.storage,{W:w.id,C:actor.credential_id,human:human.principal_id,principal:actor.agent_id,operation:step.operation,target:step.target,key:slot.idempotency_key},pair);
    const beforeAt=Date.now(),before=reader.readPhase({stepId:step.id,phase:'before'}).originals;this.#fence(before,actor,w);check(rows(before,'I').length===0);
    if(this.#index<2)check(rows(before,'U').length===this.#index);else check(rows(before,'T').length===0&&this.#runtimeIds.size===2);
    this.#healthy();this.#dispatches++;response=await super.fetch(new Request(request.url,{method:request.method,headers:request.headers,body:requestBody}));this.#healthy();
    const responseHeaders=selectedHeaders(response.headers),responseBody=await this.#bytes(response.body,step.responseCap);responseConsumed=true;this.#healthy();
    const afterAt=Date.now(),after=reader.readPhase({stepId:step.id,phase:'after'}).originals;this.#fence(after,actor,w);
    check(response.status===201);const dto=JSON.parse(decoder.decode(responseBody));check((this.#index<2?clientOperations.createRuntime:clientOperations.createTask).validateResponse(dto));
    const envelope=object(dto),data=object(envelope.data),outcome=single(after,'I'),event=single(after,'EK');
    check(outcome.operation===step.operation&&outcome.target===step.target&&outcome.key===slot.idempotency_key&&outcome.principal_id===actor.agent_id&&outcome.status===201&&outcome.original_request_id===envelope.request_id&&outcome.event_id===event.id);
    check(outcome.fingerprint===await fingerprintRequest('POST',url.pathname,{},step.body));check(event.workspace_id===w.id&&event.request_id===envelope.request_id);
    if(this.#index<2){
     const runtime=object(data.runtime);check(data.revealed===true&&typeof data.runtime_token==='string'&&data.runtime_token.length===43&&!this.#runtimeIds.has(String(runtime.id)));
     const all=rows(after,'U');check(all.length===this.#index+1);const actual=all.find(x=>x.id===runtime.id);check(actual&&actual.workspace_id===w.id&&actual.agent_id===actor.agent_id&&actual.credential_id===actor.credential_id&&actual.authority_epoch===expected.epoch&&actual.proof_sha256===await sha256(data.runtime_token)&&actual.runtime_version===1&&actual.status==='online');
     for(const key of ['id','workspace_id','agent_id','runtime_version','label','status'])check(runtime[key]===actual[key]);for(const key of ['created_at','last_seen_at','presence_expires_at'])check(runtime[key]===new Date(Number(actual[key])).toISOString());
     equal(JSON.parse(String(outcome.outcome_json)),{runtime,runtime_token:null,revealed:false});check(event.type==='runtime.enrolled'&&event.resource_id===runtime.id);this.#runtimeIds.add(String(runtime.id));
    }else{
     check('title' in step.body&&'description' in step.body);const task=single(after,'T'),history=single(after,'HK');assertFreshTaskProjection(data,task);check(task.workspace_id===w.id&&task.state==='backlog'&&task.task_version===1&&task.title===step.body.title&&task.description===step.body.description);
     equal(JSON.parse(String(outcome.outcome_json)),data);check(event.type==='task.created'&&event.resource_id===task.id&&history.event_id===event.id&&history.task_id===task.id);
    }
    this.#healthy();captures.get(this)!.records.set(slot.invocation_id,Object.freeze({subject,before,after,requestBody,responseBody,beforeAt,afterAt,status:response.status,requestHeaders,responseHeaders}));this.#index++;
    return new Response(responseBody.slice(),{status:response.status,statusText:response.statusText,headers:response.headers});
   }finally{
    reader?.close();if(response?.body&&!responseConsumed)await this.#discard(response.body);
    if(request.body&&(!request.bodyUsed||request.body.locked))await this.#discard(request.body);
   }
  },this.#deadline);
  }catch{if(!cleanupOwned&&request.body){const pending=this.#discard(request.body);await this.#grace(pending);}this.#poison();}
 }
 #discard(body:ReadableStream<Uint8Array>):Promise<void>{
  if(body.locked){this.#cleanupFailed=true;return Promise.resolve();}
  let cancel:Promise<void>;try{cancel=body.cancel();}catch{this.#cleanupFailed=true;return Promise.resolve();}
  const owned=Promise.resolve(cancel).catch(()=>{this.#cleanupFailed=true;}).finally(()=>{this.#cancellations.delete(owned);});this.#cancellations.add(owned);return owned;
 }
 async #grace(work:Promise<unknown>):Promise<boolean>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work.then(()=>true,()=>true),new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),1000);})]);}finally{if(timer!==undefined)clearTimeout(timer);}}
 #fence(originals:readonly Readonly<SelectedOriginal>[],actor:Obj,w:Obj){
  const e=this.#expected!,m=single(originals,'M'),f=single(originals,'F'),g=single(originals,'G');
  check(m.workspace_id===w.id&&m.object_name===w.object_name&&m.config_epoch===e.epoch&&m.config_digest===e.config_sha256&&m.installation_digest===w.installation_sha256&&m.admission_state==='installed');
  check(f.state==='open'&&f.authority_epoch===e.epoch&&f.generation===w.generation&&g.credential_id===actor.credential_id&&g.agent_id===actor.agent_id&&g.token_sha256===actor.token_sha256&&g.enabled===1&&g.config_epoch===e.epoch&&g.revoked_at===null&&g.retired_at_epoch===null&&Number(g.expires_at)>Date.now());
 }
 snapshot(){return Object.freeze({scope:'source-fixture-attachment',installedAuthority:false,native_conformance:false,completed:this.#index,dispatches:this.#dispatches,failed:this.#failed,active:this.#active!==null,closed:this.#closed,reserved:Object.freeze({...this.#reserved})});}
 async closeAttachment(){
  this.#closed=true;const owned=[...this.#cancellations,...(this.#active?[this.#active]:[])];
  const settled=await this.#grace(Promise.allSettled(owned));
  if(!settled||this.#cleanupFailed||this.#active||this.#cancellations.size)return Object.freeze({status:'cleanup-unknown',pending:this.#active!==null||this.#cancellations.size>0});
  const map=captures.get(this)?.records;for(const held of map?.values()??[]){held.requestBody.fill(0);held.responseBody.fill(0);}map?.clear();return Object.freeze({status:'closed',pending:false});
 }
}
