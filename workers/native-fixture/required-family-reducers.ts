/** Fixed fixture projections over independently selected rows. No database access,
 * ActorContext, caller visibility callbacks, or response-ID membership queries. */
import {credentialView,type CredentialRow} from '../../src/auth/native-credentials';
import {canonicalJson} from '../../src/config/bootstrap';
import {neutralProfile} from '../../src/config/profile';
import {agentView,type AgentRow} from '../../src/agents/commands';
import {runView,type RunRow} from '../../src/tasks/lease';
import {artifactView,type ArtifactRow} from '../../src/artifacts/repository';
import {clientOperations} from '../../src/http/generated/client-operations';
import {validateError} from '../../src/http/generated/auth-validators.js';
import type {SelectedOriginal} from './selected-state';
import plan from './required-application-plan.json';
type Row=Record<string,any>;
export type RequiredBindings={task_id:string|null;run_id:string|null;runtime_id:string|null;artifact_id:string|null;thread_id:string|null;message_id:string|null;reviewer_agent_id:string|null};
export type RequiredResponse={operation:string;status:number;data:unknown;body:Uint8Array;proof_sha256:string|null};
export type RequiredReduction={step_id:string;before:readonly SelectedOriginal[];after:readonly SelectedOriginal[];responses:readonly RequiredResponse[];bindings:RequiredBindings;actor:Readonly<{agent_id:string;credential_id:string}>;requestBody:unknown};
export function requiredAssert(value:unknown):asserts value{if(!value)throw Error('REQUIRED_FAMILY_REJECTED');}
const same=(a:unknown,b:unknown)=>requiredAssert(canonicalJson(a)===canonicalJson(b));
const iso=(v:unknown)=>{requiredAssert(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0);return new Date(v).toISOString();};
export function requiredRows(originals:readonly SelectedOriginal[],selector:string):Row[]{const found=originals.filter(r=>r.selector===selector);requiredAssert(found.length===1);return JSON.parse(found[0].canonical) as Row[];}
export function assertRequiredNegativeKeyAbsent(originals:readonly SelectedOriginal[],subject:{workspace_id:string;principal_id:string;operation:string;target:string;key:string}){requiredAssert(!requiredRows(originals,'IW').some(row=>row.workspace_id===subject.workspace_id&&row.key===subject.key));}
function one(originals:readonly SelectedOriginal[],selector:string,id?:unknown,key='id'):Row{const found=requiredRows(originals,selector).filter(r=>id===undefined||r[key]===id);requiredAssert(found.length===1);return found[0];}
function sorted(rows:Row[],key='id'){return [...rows].sort((a,b)=>a.created_at-b.created_at||(String(a[key])<String(b[key])?-1:String(a[key])>String(b[key])?1:0));}
function resultProjection(s:readonly SelectedOriginal[],q:Row):Row{
 const t=one(s,'T',q.task_id),run=one(s,'R',q.run_id);requiredAssert(run.task_id===t.id&&run.agent_id===q.submitted_agent_id&&run.workspace_id===q.workspace_id&&t.workspace_id===q.workspace_id);
 const refs=requiredRows(s,'RA').filter(r=>r.result_id===q.id).sort((a,b)=>a.ordinal-b.ordinal);requiredAssert(refs.length<=1);
 for(const [ordinal,ref]of refs.entries()){
  const a=one(s,'AR',ref.artifact_id),g=one(s,'GEN',a.committed_generation_id),edges=requiredRows(s,'AS').filter(e=>e.artifact_id===a.id);
  requiredAssert(ref.ordinal===ordinal&&a.workspace_id===q.workspace_id&&a.status==='committed'&&a.committed_at!==null&&a.expires_at===null&&a.task_id===t.id&&a.run_id===run.id&&g.artifact_id===a.id&&g.state==='committed'&&g.expected_sha256===a.sha256&&g.observed_sha256===a.sha256&&g.expected_byte_size===a.byte_size&&g.observed_byte_size===a.byte_size);
  for(const [kind,id]of [['task',t.id],['run',run.id],['result',q.id]])requiredAssert(edges.some(e=>e.workspace_id===q.workspace_id&&e.resource_kind===kind&&e.resource_id===id));
 }
 return {summary:q.summary,artifact_ids:refs.map(r=>r.artifact_id),run_id:q.run_id,submitted_by:{kind:q.submitted_kind,principal_id:q.submitted_principal_id,agent_id:q.submitted_agent_id},submitted_at:iso(q.created_at)};
}
export function requiredTaskProjection(s:readonly SelectedOriginal[],t:Row):Row{
 const out:Row={};for(const k of ['id','workspace_id','title','description','state','task_version','proposal_version','project_id','work_role_id','assigned_agent_id','active_run_id','latest_run_id','approval_id','retry_count','retry_limit'])out[k]=t[k];
 requiredAssert(t.project_id===null&&t.work_role_id===null&&t.approval_id===null);
 for(const id of [t.active_run_id,t.latest_run_id])if(id!==null){const r=one(s,'R',id);requiredAssert(r.workspace_id===t.workspace_id&&r.task_id===t.id);}
 out.result=t.current_result_id===null?null:resultProjection(s,one(s,'Q',t.current_result_id));out.flags=JSON.parse(t.flags_json);out.created_at=iso(t.created_at);out.updated_at=iso(t.updated_at);return out;
}
function runtimeProjection(r:Row){const out:Row={};for(const k of ['id','workspace_id','agent_id','runtime_version','label','status'])out[k]=r[k];for(const k of ['created_at','last_seen_at','presence_expires_at'])out[k]=iso(r[k]);return out;}
function messageProjection(s:readonly SelectedOriginal[],m:Row,agent:string):Row{
 const thread=one(s,'TH',m.thread_id),participants=requiredRows(s,'TP').filter(p=>p.thread_id===m.thread_id),inbox=requiredRows(s,'IN').filter(r=>r.message_id===m.id).sort((a,b)=>a.recipient_agent_id<b.recipient_agent_id?-1:1);
 requiredAssert(thread.workspace_id===m.workspace_id&&participants.some(p=>p.participant_kind==='agent'&&p.participant_id===agent));
 const refs=JSON.parse(m.refs_json);requiredAssert(refs.length===1&&refs[0].kind==='task');requiredTaskProjection(s,one(s,'T',refs[0].id));
 const arts=requiredRows(s,'MA').filter(a=>a.message_id===m.id);requiredAssert(arts.length===0);const ack=inbox.find(r=>r.recipient_agent_id===agent)?.acknowledged_at??null;
 return {id:m.id,workspace_id:m.workspace_id,thread_id:m.thread_id,sender:{kind:m.sender_kind,principal_id:m.sender_principal_id,agent_id:m.sender_agent_id},recipient_agent_ids:inbox.map(r=>r.recipient_agent_id),body:m.body,refs,artifact_ids:[],created_at:iso(m.created_at),acknowledged_at:ack===null?null:iso(ack)};
}
function artifactProjection(s:readonly SelectedOriginal[],a:Row){
 if(a.task_id!==null)requiredTaskProjection(s,one(s,'T',a.task_id));if(a.run_id!==null){const r=one(s,'R',a.run_id);requiredAssert(r.task_id===a.task_id);}
 const edges=requiredRows(s,'AS').filter(r=>r.artifact_id===a.id);for(const [kind,id]of [['task',a.task_id],['run',a.run_id]])if(id!==null)requiredAssert(edges.some(e=>e.resource_kind===kind&&e.resource_id===id));
 if(a.status==='committed'){const g=one(s,'GEN',a.committed_generation_id);requiredAssert(g.artifact_id===a.id&&g.state==='committed'&&g.observed_sha256===a.sha256&&g.expected_sha256===a.sha256&&g.observed_byte_size===a.byte_size&&g.expected_byte_size===a.byte_size&&a.expires_at===null&&a.committed_at!==null);}
 return artifactView(a as ArtifactRow);
}
function page(envelope:Row,items:unknown[],hasMore=false){same(envelope.data,items);requiredAssert(envelope.page?.has_more===hasMore);if(!hasMore)requiredAssert(envelope.page.next_cursor===null);else requiredAssert(typeof envelope.page.next_cursor==='string'&&envelope.page.next_cursor.length>0&&envelope.page.next_cursor.length<=2048);}
function eventProjection(e:Row){const out:Row={};for(const k of ['id','workspace_id','sequence','type','resource_type','resource_id','resource_version','thread_id','request_id','summary','task_version','run_id','fence'])out[k]=e[k];out.actor=JSON.parse(e.actor_json);out.occurred_at=iso(e.occurred_at);return out;}
function eventVisible(s:readonly SelectedOriginal[],e:Row,agent:string):boolean{
 // Fixed source fixture has no managed identities/preferences/imports/approvals.
 if(e.type==='configuration.installed')return false;
 if(e.resource_type==='runtime')return false; // Product resourceEventVisibility has no runtime producer branch.
 if(e.resource_type==='task'){const t=one(s,'T',e.resource_id);requiredTaskProjection(s,t);requiredAssert(e.task_version>0&&e.task_version<=t.task_version);return true;}
 if(e.resource_type==='run'){const r=one(s,'R',e.resource_id);requiredAssert(e.run_id===r.id&&e.fence===r.fence);requiredTaskProjection(s,one(s,'T',r.task_id));return true;}
 if(e.resource_type==='artifact'){artifactProjection(s,one(s,'AR',e.resource_id));return true;}
 if(e.resource_type==='message'){messageProjection(s,one(s,'MSG',e.resource_id),agent);return true;}
 return false;
}
/** Body recipe derives versions/IDs from owned selections, never supplied body. */
export function requiredBody(stepId:string,s:readonly SelectedOriginal[],b:RequiredBindings,actor:string):unknown{
 const row=plan.find(p=>p.step_id===stepId);requiredAssert(row);const op=row.process_operation;
 const task=()=>one(s,'T',b.task_id),run=()=>one(s,'R',b.run_id),runtime=()=>one(s,'U',b.runtime_id);
 switch(op){
 case 'createRuntime':return {label:stepId.startsWith('E2/')?'Native external proof '+stepId.slice(-1):'Native scenario '+row.actor};
 case 'revokeCredential':requiredAssert(one(s,'G').credential_version===1);return {expected_credential_version:1,reason:'R2'};
 case 'createTask':return {title:'Native scenario '+row.fixture,description:'Synthetic isolated conformance fixture'};
 case 'patchTask':return {expected_version:task().task_version,title:'Native scenario patched'};
 case 'readyTask':return {expected_version:task().task_version};
 case 'acceptTaskResult':case 'cancelTask':case 'requeueTask':return {expected_version:task().task_version,reason:'Native scenario '+op};
 case 'claimTask':return {expected_version:task().task_version,runtime_instance_id:runtime().id};
 case 'submitTaskResult':return {expected_version:task().task_version,run_id:run().id,fence:run().fence,result:{summary:'Native scenario completed work',artifact_ids:[b.artifact_id]}};
 case 'failTask':return {expected_version:task().task_version,run_id:run().id,fence:run().fence,reason:'Native scenario uncertain external outcome',outcome_unknown:true};
 case 'heartbeatRun':return {expected_run_version:run().run_version,fence:run().fence};
 case 'heartbeatRuntime':return {expected_runtime_version:stepId.startsWith('E2/')||stepId==='probe/wrong-runtime'?1:runtime().runtime_version};
 case 'stageArtifact':return {task_id:task().id,run_id:run().id,filename:'native-scenario.txt',media_type:'text/plain',byte_size:29,sha256:'eefb414947860e55eb533966c87bb64b6d38ea4514768cf10f4a16721ee876b2'};
 case 'commitArtifact':return {expected_artifact_version:one(s,'AR',b.artifact_id).artifact_version};
 case 'createMessage':return {recipient_agent_ids:[b.reviewer_agent_id],body:'Review the linked native scenario task',refs:[{kind:'task',id:b.task_id}],artifact_ids:[]};
 case 'ackMessages':return {message_ids:[b.message_id]};
 case 'uploadArtifactContent':return 'Native conformance artifact.\n';
 default:return null;
 }
}
// Fixed exports retain historical16 display semantics; only the statically wired
// current17 witness recognizes the newly implemented capability advertisement.
function familyReducer(current17:boolean){return function(value:unknown):Readonly<{family:string;sourceOnly:true}>{
 const v=value as RequiredReduction;requiredAssert(v&&typeof v==='object'&&typeof v.step_id==='string');const step=plan.find(p=>p.step_id===v.step_id);requiredAssert(step&&Array.isArray(v.before)&&Array.isArray(v.after)&&Array.isArray(v.responses));
 const s=v.after,b=v.bindings,actor=v.actor;requiredAssert(b&&actor);
 if(step.step_id==='prepare/retain-artifact'){requiredAssert(v.before.length===0&&s.length===0&&v.responses.length===0);return Object.freeze({family:'host-artifact-only',sourceOnly:true});}
 const m=one(s,'M'),f=one(s,'F');requiredAssert(m.admission_state==='installed'&&f.state==='open');
 if(step.ordinals.length===0||step.expected_status===401){
  same(v.before.map(r=>[r.selector,r.canonical]),s.map(r=>[r.selector,r.canonical]));requiredAssert(v.responses.length===step.ordinals.length);
  for(const r of v.responses)requiredAssert(r.status===401&&validateError(r.data));
  return Object.freeze({family:step.ordinals.length?'server-denial':'source-no-effect-only',sourceOnly:true});
 }
 requiredAssert(v.responses.length===step.ordinals.length);const last=v.responses.at(-1)!;
 for(const [i,r]of v.responses.entries()){requiredAssert(r.operation===step.ordinals[i].operation&&r.status===(v.step_id==='case/lost-response-retained'?201:step.ordinals[i].response_status));const op=clientOperations[r.operation as keyof typeof clientOperations];requiredAssert(op);if(op.validateResponse)requiredAssert(op.validateResponse(r.data));}
 const envelope=last.data as Row,data=envelope?.data,op=step.process_operation;if(op!=='downloadArtifactContent')requiredAssert(envelope&&typeof envelope.request_id==='string');
 if(step.ordinals.at(-1)!.idempotency){
  const outcome=one(s,'I'),event=one(s,'EK');requiredAssert(outcome.status===last.status&&outcome.original_request_id===envelope.request_id&&outcome.event_id===event.id&&event.workspace_id===m.workspace_id&&event.request_id===envelope.request_id&&outcome.principal_id===(step.actor==='human'?one(s,'HG').principal_id:actor.agent_id));
  same(JSON.parse(outcome.outcome_json),op==='createRuntime'?{runtime:data.runtime,runtime_token:null,revealed:false}:data);
 }
 switch(op){
 case 'revokeCredential':{const old=one(v.before,'CW',actor.credential_id,'credential_id'),now=one(s,'CW',actor.credential_id,'credential_id');requiredAssert(old.enabled===1&&old.revoked_at===null&&now.revoked_at!==null);same(now,{...old,enabled:0,revoked_at:now.revoked_at,credential_version:old.credential_version+1});same(data,credentialView(now as CredentialRow,now.revoked_at));for(const name of ['S','F','M','HG','SE','LA'])same(requiredRows(v.before,name),requiredRows(s,name));same(requiredRows(s,'U'),requiredRows(v.before,'U').map(r=>r.credential_id===actor.credential_id&&r.revoked_at===null?{...r,runtime_version:r.runtime_version+1,status:'expired',revoked_at:now.revoked_at}:r));break;}
 case 'getWorkspace':{const g=one(s,'G');const display=new Set(['workspace:read','agents:read','messages:send','messages:read','messages:ack','events:read','tasks:read',...(current17?['tasks:create','artifacts:write']:[]),'tasks:schedule','tasks:cancel','tasks:review','artifacts:read']);same(data,{id:m.workspace_id,display_name:neutralProfile.display_name,contract_revision:'0.1',actor:{kind:'agent',principal_id:actor.agent_id,agent_id:actor.agent_id},effective_scopes:JSON.parse(g.scopes_json).filter((x:string)=>display.has(x)).sort()});break;}
 case 'getConfiguration':{const scopes=JSON.parse(one(s,'G').scopes_json),features=['workspace','profile'];if(scopes.includes('messages:read')||scopes.includes('messages:send'))features.push('messages');if(scopes.includes('events:read'))features.push('events');same(data,{config_epoch:m.config_epoch,profile_revision:1,preferences_revision:null,allowed_user_overrides:[],enabled_features:features});break;}
 case 'getProfile':requiredAssert(requiredRows(s,'P').length===0);same(data,{profile_revision:1,profile:neutralProfile});break;
 case 'listAgents':page(envelope,sorted(requiredRows(s,'AG'),'agent_id').map(r=>agentView(r as AgentRow)));break;
 case 'getAgent':same(data,agentView(one(s,'AG',b.reviewer_agent_id,'agent_id') as AgentRow));break;
 case 'createRuntime':{const r=one(s,'U',data.runtime.id);requiredAssert(!requiredRows(v.before,'U').some(x=>x.id===r.id)&&r.agent_id===actor.agent_id&&r.credential_id===actor.credential_id&&r.authority_epoch===m.config_epoch&&r.runtime_version===1&&r.status==='online'&&r.proof_sha256===last.proof_sha256&&data.revealed===true&&typeof data.runtime_token==='string'&&data.runtime_token.length===43);same(data.runtime,runtimeProjection(r));break;}
 case 'heartbeatRuntime':{const r=one(s,'U',b.runtime_id),old=one(v.before,'U',b.runtime_id);requiredAssert(r.runtime_version===old.runtime_version+1&&r.proof_sha256===old.proof_sha256&&r.credential_id===actor.credential_id&&r.agent_id===actor.agent_id);same(data,runtimeProjection(r));break;}
 case 'getRun':case 'heartbeatRun':{const r=one(s,'R',b.run_id);same(data,runView(r as RunRow));requiredTaskProjection(s,one(s,'T',r.task_id));if(op==='heartbeatRun')requiredAssert(r.run_version===one(v.before,'R',b.run_id).run_version+1);break;}
 case 'createTask':case 'getTask':case 'patchTask':same(data,requiredTaskProjection(s,one(s,'T',op==='createTask'?data.id:b.task_id)));break;
 case 'readyTask':case 'claimTask':case 'submitTaskResult':case 'acceptTaskResult':case 'cancelTask':case 'requeueTask':case 'failTask':{
  const t=one(s,'T',b.task_id);same(data.task,requiredTaskProjection(s,t));requiredAssert(data.approval===null);
  const runId=op==='claimTask'?t.latest_run_id:['submitTaskResult','failTask'].includes(op!)?b.run_id:null;same(data.run,runId===null?null:runView(one(s,'R',runId) as RunRow));
  const states:Record<string,string>={readyTask:'ready',claimTask:'doing',submitTaskResult:'review',acceptTaskResult:'done',cancelTask:'cancelled',requeueTask:'ready',failTask:'backlog'};
  requiredAssert(t.state===states[op!]&&t.task_version===one(v.before,'T',b.task_id).task_version+1);
  if(op==='acceptTaskResult'){const q=one(s,'Q',t.current_result_id),a=one(s,'A',t.id,'task_id');requiredAssert(a.reviewer_principal_id===actor.agent_id&&a.reviewer_agent_id===actor.agent_id&&q.submitted_principal_id!==actor.agent_id&&q.submitted_agent_id!==actor.agent_id&&a.result_id===q.id&&a.run_id===q.run_id&&a.task_version===t.task_version);}
  break;
 }
 case 'listTasks':page(envelope,sorted(requiredRows(s,'T')).map(t=>requiredTaskProjection(s,t)));break;
 case 'listTaskResults':page(envelope,requiredRows(s,'Q').filter(q=>q.task_id===b.task_id).sort((a,b)=>a.submission_sequence-b.submission_sequence).map(q=>resultProjection(s,q)));break;
 case 'stageArtifact':case 'uploadArtifactContent':case 'commitArtifact':case 'getArtifact':same(data,artifactProjection(s,one(s,'AR',op==='stageArtifact'?data.id:b.artifact_id)));break;
 case 'downloadArtifactContent':requiredAssert(last.body.byteLength===29&&new TextDecoder().decode(last.body)==='Native conformance artifact.\n');artifactProjection(s,one(s,'AR',b.artifact_id));break;
 case 'listArtifacts':page(envelope,sorted(requiredRows(s,'AR')).map(a=>artifactProjection(s,a)));break;
 case 'createMessage':same(data,messageProjection(s,one(s,'MSG',data.id),actor.agent_id));break;
 case 'getInbox':page(envelope,sorted(requiredRows(s,'MSG').filter(m=>requiredRows(s,'IN').some(i=>i.message_id===m.id&&i.recipient_agent_id===actor.agent_id&&i.acknowledged_at===null))).map(m=>messageProjection(s,m,actor.agent_id)));break;
 case 'getThread':page(envelope,sorted(requiredRows(s,'MSG').filter(m=>m.thread_id===b.thread_id)).map(m=>messageProjection(s,m,actor.agent_id)));break;
 case 'ackMessages':{const old=one(v.before,'IN',b.message_id,'message_id'),now=one(s,'IN',b.message_id,'message_id');requiredAssert(old.recipient_agent_id===actor.agent_id&&old.acknowledged_at===null&&now.acknowledged_at!==null);same(data,{acknowledged_ids:[b.message_id],already_acknowledged_ids:[]});break;}
 case 'listEvents':{const events=['E0','E1','E2'].flatMap(k=>requiredRows(s,k)).sort((a,b)=>a.sequence-b.sequence);const first=events.slice(0,20),visible=first.filter(e=>eventVisible(s,e,actor.agent_id)).map(eventProjection);page(envelope,visible,events.length>20);break;}
 case 'searchWorkspace':{const hits:Row[]=[];for(const t of requiredRows(s,'T')){requiredTaskProjection(s,t);const matched=[t.title,t.description].find(x=>x.includes('conformance'));if(matched)hits.push({kind:'task',id:t.id,title:t.title,snippet:Array.from(matched).slice(0,256).join(''),created_at:iso(t.created_at)});}for(const m of requiredRows(s,'MSG')){messageProjection(s,m,actor.agent_id);if(m.body.includes('conformance'))hits.push({kind:'message',id:m.id,title:'Message',snippet:Array.from(m.body).slice(0,256).join(''),created_at:iso(m.created_at)});}for(const a of requiredRows(s,'AR')){artifactProjection(s,a);const match=[a.filename,a.media_type].find(x=>x.includes('conformance'));if(a.status==='committed'&&match)hits.push({kind:'artifact',id:a.id,title:a.filename,snippet:match,created_at:iso(a.created_at)});}hits.sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||(a.id<b.id?-1:1));page(envelope,hits);break;}
 default:requiredAssert(false);
 }
 return Object.freeze({family:String(op),sourceOnly:true});
}; }
export const reconcileRequiredFamily=familyReducer(false);
export const reconcileRequiredFamilySchema17=familyReducer(true);
