/** Source-only initial fixture semantics. A snapshot is not an authenticated request
 * or a promise about state after the transaction/crypto await. Actual effect owners
 * must reauthenticate and recheck the current fence. No public route or SQL writes.
 */
import manifest from '../../scripts/lib/native-complete-fixture.json';
import {parseDeployment} from '../../src/config/deployment';
import {canonicalJson,sha256} from '../../src/config/bootstrap';
import * as selected from './selected-state';
import type {SelectedOriginal} from './selected-state';
import currentIdentity from './selected-state-schema17-profile.json';
type Row=Record<string,string|number|null>;
type Workspace={id:string;object_name:string;installation_sha256:string;generation:number};
type NativeActor={agent_id:string;credential_id:string;token_sha256:string};
interface Expected {role:'primary'|'foreign';epoch:number;config_sha256:string;origin:string;audience:string;workspaces:{primary:Workspace;foreign:Workspace};actors:{S:NativeActor;R:NativeActor;X:NativeActor};human:{principal_id:string;issuer:string;subject:string;session_id:string;token_sha256:string;csrf_sha256:string};}
function admissionProfile(schemaVersion:16|17){
const createCompleteSelectedState=schemaVersion===16?selected.createCompleteSelectedState:selected.createCurrentCompleteSelectedState;
const completePhaseReservation=schemaVersion===16?selected.completePhaseReservation:selected.currentCompletePhaseReservation;
const privateCaptures=new WeakMap<object,Readonly<{originals:readonly Readonly<SelectedOriginal>[]}>>();
function freezeSource(value:unknown):void {if(value!==null&&typeof value==='object'){for(const child of Object.values(value))freezeSource(child);Object.freeze(value);}}
freezeSource(manifest);
const constraints=manifest.configuration_constraints,encoder=new TextEncoder();
function reject():never {throw Error('COMPLETE_FIXTURE_ADMISSION_REJECTED');}
function check(v:unknown):asserts v {if(!v)reject();}
function closed(v:unknown,keys:readonly string[]):Record<string,unknown>{
 check(v!==null&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v)));
 const actual=Reflect.ownKeys(v);check(actual.length===keys.length&&actual.every(k=>typeof k==='string'&&keys.includes(k)));
 const copy:Record<string,unknown>={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);check(d&&d.enumerable&&Object.hasOwn(d,'value'));copy[k]=d.value;}return copy;
}
function id(v:unknown,max=64):asserts v is string {check(typeof v==='string'&&v.length>=1&&v.length<=max&&!/[^A-Za-z0-9_-]/.test(v));}
function hash(v:unknown):asserts v is string {check(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v));}
function number(v:unknown,min=0):asserts v is number {check(typeof v==='number'&&Number.isSafeInteger(v)&&v>=min);}
function origin(v:unknown):asserts v is string {
 check(typeof v==='string'&&v.length<=128&&!/[^\x21-\x7e]|["\\]/.test(v));const u=new URL(v);
 check(u.protocol==='https:'&&u.origin===v&&u.href===v+'/'&&!u.username&&!u.password&&!u.port&&u.hostname.includes('.')&&!u.hostname.endsWith('.')&&!/^[\d.]+$|:|(^|\.)localhost(?:\.|$)/.test(u.hostname));
}
function expected(value:unknown):Readonly<Expected>{
 const e=closed(value,['role','epoch','config_sha256','origin','audience','workspaces','actors','human']);check(e.role==='primary'||e.role==='foreign');number(e.epoch,1);hash(e.config_sha256);origin(e.origin);id(e.audience);
 const workspaces=closed(e.workspaces,['primary','foreign']);for(const role of ['primary','foreign']){const w=closed(workspaces[role],['id','object_name','installation_sha256','generation']);id(w.id);id(w.object_name,96);hash(w.installation_sha256);number(w.generation);workspaces[role]=Object.freeze(w);}
 const actors=closed(e.actors,['S','R','X']);for(const role of ['S','R','X']){const a=closed(actors[role],['agent_id','credential_id','token_sha256']);id(a.agent_id);id(a.credential_id);hash(a.token_sha256);actors[role]=Object.freeze(a);}
 const h=closed(e.human,['principal_id','issuer','subject','session_id','token_sha256','csrf_sha256']);for(const k of ['principal_id','subject','session_id'])id(h[k]);origin(h.issuer);hash(h.token_sha256);hash(h.csrf_sha256);
 const result={...e,workspaces:Object.freeze(workspaces),actors:Object.freeze(actors),human:Object.freeze(h)} as unknown as Expected;
 check(result.workspaces.primary.id!==result.workspaces.foreign.id&&result.workspaces.primary.object_name!==result.workspaces.foreign.object_name);
 for(const key of ['agent_id','credential_id','token_sha256'] as const)check(new Set(Object.values(result.actors).map(a=>a[key])).size===3);
 check(!Object.values(result.actors).some(a=>a.agent_id===result.human.principal_id));return Object.freeze(result);
}
function one(rows:Row[]):Row {check(rows.length===1);return rows[0];}
function same(a:unknown,b:unknown){check(canonicalJson(a)===canonicalJson(b));}
function configuration(text:string,e:Expected){
 check(encoder.encode(text).byteLength<=manifest.configuration_canonical_bytes);const c=parseDeployment(JSON.parse(text));check(canonicalJson(c)===text);
 const roleNames=['S','R','X'] as const;check(c.static_credential_refs.length===3);
 const expiries=c.static_credential_refs.map(r=>{const n=Date.parse(r.expires_at);check(Number.isSafeInteger(n)&&r.expires_at.length===24&&new Date(n).toISOString()===r.expires_at);return r.expires_at;});
 const policy=constraints.workspace_policy,origin=e.origin,issuer=e.human.issuer;
 const fixed={contract_revision:constraints.contract_revision,config_epoch:e.epoch,
  workspace_catalog:[e.workspaces.primary,e.workspaces.foreign].map(w=>({workspace_id:w.id,object_name:w.object_name})),
  authentication:{mode:constraints.authentication_mode,issuer,audience:e.audience,client_id:e.audience,allowed_origins:[origin],redirect_uris:[e.workspaces.primary,e.workspaces.foreign].map(w=>({workspace_id:w.id,redirect_uri:origin+'/v2/workspaces/'+w.id+'/auth/callback'})),client_secret_ref:constraints.client_secret_ref,session_ttl_seconds:constraints.session_ttl_seconds,id_token_algorithms:constraints.id_token_algorithms,reviewed_oidc_endpoints:{authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks'}},
  static_participants:roleNames.map(role=>({workspace_id:e.workspaces[role==='X'?'foreign':'primary'].id,agent_id:e.actors[role].agent_id,display_name:manifest.substitution.grammars.displayLabels[role]})),
  human_grants:[{workspace_id:e.workspaces.primary.id,principal_id:e.human.principal_id,issuer,subject:e.human.subject,scopes:constraints.human_scopes,project_ids:null,enabled:true,delegable_native_scopes:constraints.human_delegable_native_scopes}],
  static_credential_refs:roleNames.map((role,i)=>({workspace_id:e.workspaces[role==='X'?'foreign':'primary'].id,credential_id:e.actors[role].credential_id,agent_id:e.actors[role].agent_id,scopes:constraints.native_scopes[role],project_ids:null,expires_at:expiries[i],enabled:true})),
  workspace_policies:([e.workspaces.primary,e.workspaces.foreign]).map((w,i)=>({workspace_id:w.id,allowed_user_overrides:policy.allowed_user_overrides,notification_destinations:policy.notification_destinations,retry_after_max_seconds:policy.retry_after_max_seconds,execution_policy:{...policy.execution_policy,eligibility_rules:i===0?[{project_id:null,work_role_id:null,eligible_agent_ids:[e.actors.S.agent_id]}]:[]}}))};
 same(c,fixed);return c;
}
/** Consumes only an actually issued private handle. No arbitrary supplied capture. */
function readFixtureAdmissionCapture(result:unknown){check(result!==null&&typeof result==='object');const capture=privateCaptures.get(result);check(capture);privateCaptures.delete(result);return capture;}
async function admitCompleteFixture(storage:DurableObjectStorage,input:unknown){
 try{
  const e=expected(input),w=e.workspaces[e.role],actor=e.actors[e.role==='primary'?'S':'X'];let captureStartedAt=0,captureEndedAt=0,transactions=0;
  // Static source-owned wrapper records time in the very transaction doing reads.
  const timed={sql:storage.sql,transactionSync:(callback:()=>unknown)=>storage.transactionSync(()=>{check(++transactions===1);captureStartedAt=Date.now();try{return callback();}finally{captureEndedAt=Date.now();}})} as unknown as DurableObjectStorage;
  const limits=completePhaseReservation('control/provision',e.role),reader=createCompleteSelectedState(timed,{W:w.id,C:actor.credential_id,human:e.human.principal_id,principal:actor.agent_id,operation:'domain.tasks:create',target:'tasks:create',key:'r2_'+'0'.repeat(32)},limits);
  let capture:ReturnType<typeof reader.readPhase>;try{capture=reader.readPhase({stepId:'control/provision',phase:e.role});}finally{reader.close();}
  check(transactions===1&&captureStartedAt<=captureEndedAt);const rows:Record<string,Row[]>={};for(const r of capture.originals){check(!Object.hasOwn(rows,r.selector));rows[r.selector]=JSON.parse(r.canonical) as Row[];}
  check(capture.originals.length===31);check(rows.S.length===schemaVersion&&rows.S.every((r,i)=>r.version===i+1));
  const m=one(rows.M),f=one(rows.F);check(m.workspace_id===w.id&&m.object_name===w.object_name&&m.config_epoch===e.epoch&&m.config_digest===e.config_sha256&&m.installation_digest===w.installation_sha256&&m.admission_state==='installed');
  check(m.message_retained_after_created_at===null&&m.message_retained_after_id===null&&m.event_retained_after_sequence===null);
  check(f.id===1&&f.state==='open'&&f.authority_epoch===e.epoch&&f.generation===w.generation&&f.barrier_id===null&&f.capture_id===null);
  check(typeof m.config_json==='string');const config=configuration(m.config_json,e);
  for(const name of ['U','T','R','Q','A','RA','AR','GEN','AS','AI','MSG','TH','TP','IN','MA','H','P','IW','E1','E2'])check(rows[name].length===0);
  const event=one(rows.E0);check(event.workspace_id===w.id&&event.id==='configuration_'+e.epoch&&event.sequence===1&&event.type==='configuration.installed'&&event.resource_type==='configuration'&&event.resource_id===w.id&&event.resource_version===e.epoch&&event.thread_id===null&&event.task_version===null&&event.run_id===null&&event.fence===null&&event.summary==='Workspace configuration installed.');
  check(typeof event.occurred_at==='number'&&event.occurred_at<=captureEndedAt);check(typeof event.actor_json==='string');const eventActor=closed(JSON.parse(event.actor_json),['kind','principal_id','agent_id']);check(eventActor.kind==='system'&&eventActor.agent_id===null);id(eventActor.principal_id,96);
  const roles=e.role==='primary'?['S','R'] as const:['X'] as const;check(rows.AG.length===roles.length&&rows.CW.length===roles.length);let expiresAt=Number.MAX_SAFE_INTEGER;
  for(const role of roles){const a=e.actors[role],ag=one(rows.AG.filter(r=>r.agent_id===a.agent_id)),cw=one(rows.CW.filter(r=>r.credential_id===a.credential_id)),cfg=config.static_credential_refs.find(r=>r.credential_id===a.credential_id)!;
   check(ag.workspace_id===w.id&&ag.agent_version===1&&ag.display_name===manifest.substitution.grammars.displayLabels[role]&&ag.description===''&&ag.work_role_ids_json==='[]'&&ag.framework===null&&ag.model===null&&ag.status==='active'&&ag.origin==='operator_static'&&ag.config_epoch===e.epoch&&ag.created_at===event.occurred_at&&ag.updated_at===event.occurred_at);
   check(cw.workspace_id===w.id&&cw.agent_id===a.agent_id&&cw.credential_version===1&&cw.token_sha256===a.token_sha256&&cw.scopes_json===canonicalJson(constraints.native_scopes[role])&&cw.project_ids_json==='null'&&cw.enabled===1&&cw.config_epoch===e.epoch&&cw.retired_at_epoch===null&&cw.revoked_at===null&&cw.origin==='operator_static'&&cw.label===''&&cw.issued_by_principal_id===null&&cw.created_at===event.occurred_at&&cw.expires_at===Date.parse(cfg.expires_at));
   check(typeof cw.expires_at==='number'&&cw.expires_at>captureEndedAt);expiresAt=Math.min(expiresAt,cw.expires_at);
  }
  const grant=one(rows.G);check(grant.workspace_id===w.id&&grant.credential_id===actor.credential_id&&grant.agent_id===actor.agent_id&&grant.token_sha256===actor.token_sha256&&grant.enabled===1&&grant.agent_status==='active');
  if(e.role==='foreign')check(rows.HG.length===0&&rows.SE.length===0&&rows.LA.length===0);
  else{
   const h=one(rows.HG),s=one(rows.SE);check(h.workspace_id===w.id&&h.principal_id===e.human.principal_id&&h.issuer===e.human.issuer&&h.subject===e.human.subject&&h.scopes_json===canonicalJson(constraints.human_scopes)&&h.project_ids_json==='null'&&h.enabled===1&&h.config_epoch===e.epoch);
   check(s.id===e.human.session_id&&s.workspace_id===w.id&&s.principal_id===e.human.principal_id&&s.issuer===e.human.issuer&&s.subject===e.human.subject&&s.token_digest===e.human.token_sha256&&s.csrf_digest===e.human.csrf_sha256&&s.auth_epoch===e.epoch&&s.revoked_at===null);
   check(typeof s.created_at==='number'&&s.created_at>=(event.occurred_at as number)&&s.created_at<=captureEndedAt&&typeof s.expires_at==='number'&&s.expires_at>captureEndedAt);expiresAt=Math.min(expiresAt,s.expires_at);
   check(rows.LA.length<=1);if(rows.LA.length){const l=rows.LA[0];check(l.workspace_id===w.id&&l.auth_epoch===e.epoch&&l.nonce===''&&l.pkce_verifier===''&&l.consumed_at===s.created_at&&typeof l.created_at==='number'&&l.created_at<=s.created_at&&l.redirect_uri===e.origin+'/v2/workspaces/'+w.id+'/auth/callback');}
  }
  check(await sha256(m.config_json)===e.config_sha256);
  const commitments=[];for(const r of capture.originals)commitments.push({selector:r.selector,sha256:await sha256(r.canonical),byte_size:r.byteSize});
  const selectedStateSha256=await sha256(canonicalJson(schemaVersion===16?commitments:{profile:currentIdentity.profile,catalog_sha256:currentIdentity.catalog_sha256,commitments})),validatedAt=Date.now();check(validatedAt>=captureEndedAt&&expiresAt>validatedAt);
  const result=Object.freeze({scope:'source-fixture-baseline' as const,installedAuthority:false,native_conformance:false,human_authentication:'not-performed' as const,role:e.role,workspaceId:w.id,configSha256:e.config_sha256,installationSha256:w.installation_sha256,epoch:e.epoch,maintenanceGeneration:w.generation,captureStartedAt,captureEndedAt,validatedAt,expiresAt,selectedStateSha256,actualQueries:reader.snapshot().actualQueries});
  privateCaptures.set(result,Object.freeze({originals:capture.originals}));return result;
 }catch{return reject();}
}

return Object.freeze({admitCompleteFixture,readFixtureAdmissionCapture});
}
export const {admitCompleteFixture,readFixtureAdmissionCapture}=admissionProfile(16);
export const {admitCompleteFixture:admitCurrentCompleteFixture,readFixtureAdmissionCapture:readCurrentFixtureAdmissionCapture}=admissionProfile(17);
