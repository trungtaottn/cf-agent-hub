/** Private source-only guard over actual synchronous storage. Never an authenticator or SQL simulator. */
import * as legacyDescriptors from './descriptors.ts';
import {currentObserverDescriptors} from './descriptors.ts';
import type {PreparedObserverBinding} from './registry.ts';
type Row=Readonly<Record<string,string|number|null>>;
interface Original {transaction:number;selector:string;canonical:string;byteSize:number;}
function boundedObserverProfile(schemaVersion:16|17,descriptors:typeof currentObserverDescriptors){
const {getObservationLedger,getPreflightDescriptor,getProductQueryDescriptor,validatePreflightRows,validateProductRows,PREFLIGHT_ORDER}=descriptors;
return function createBoundedObserverStorage(actualStorage:DurableObjectStorage,binding:Readonly<PreparedObserverBinding>,actualTokenDigest:string){
 const ledger=getObservationLedger(binding.step_id),operation=binding.step_id.slice(8);let failed=false,finished=false,active=false,generation=0,transactions=0,preflightQueries=0,productQueries=0,bridgeRawBytes=0,bridgeJsonBytes=0,retainedBytes=0,pendingCursors=0,expiresAt=Infinity;
 const counts:Record<string,number>={},originals:Original[]=[],transactionIntervals:{transaction:number;startedAt:number;endedAt:number}[]=[];
 const preRaw=PREFLIGHT_ORDER.reduce((n,k)=>n+getPreflightDescriptor(k).bridge.rawScalarBytes,0)*3,preJson=PREFLIGHT_ORDER.reduce((n,k)=>n+getPreflightDescriptor(k).bridge.jsonArrayBytes,0)*3;
 const rawBudget=preRaw+ledger.productRawScalarBytes,jsonBudget=preJson+ledger.productJsonArrayBytes;
 const reject=():never=>{failed=true;throw Error('NATIVE_OBSERVER_STORAGE_REJECTED');};
 const check=(value:unknown):void=>{if(!value)reject();};
 const healthy=()=>check(!failed&&!finished);
 const protect=<T>(fn:()=>T):T=>{try{return fn();}catch{return reject();}};
 check(Object.isFrozen(binding)&&typeof actualTokenDigest==='string'&&/^[a-f0-9]{64}$/.test(actualTokenDigest));
 function charge(raw:number,json:number){bridgeRawBytes+=raw;bridgeJsonBytes+=json;check(bridgeRawBytes<=rawBudget&&bridgeJsonBytes<=jsonBudget);}
 let inventory:Record<string,readonly Row[]>={};
 function one(name:string):Row{const rows=inventory[name];check(rows?.length===1);return rows[0];}
 function admission(){
  const now=Date.now(),versions=inventory.S;check(versions.length===schemaVersion&&versions.every((r,i)=>r.version===i+1));const m=one('M'),f=one('F');
  check(m.workspace_id===binding.workspace_id&&m.object_name===binding.object_name&&m.config_digest===binding.config_digest&&m.installation_digest===binding.installation_digest&&m.config_epoch===binding.expected_epoch&&m.admission_state==='installed');
  check(f.id===1&&f.state==='open'&&f.authority_epoch===binding.expected_epoch&&f.generation===binding.maintenance_generation);
  check(m.message_retained_after_created_at===null&&m.message_retained_after_id===null&&m.event_retained_after_sequence===null);
  for(const name of ['C','AG','T','R','P'])for(const r of inventory[name])check(r.workspace_id===binding.workspace_id);
  const matches=inventory.C.filter(r=>r.token_sha256===actualTokenDigest);check(matches.length===1);const c=matches[0];
  check(c.credential_id===binding.credential_id&&c.agent_id===binding.agent_id&&c.origin==='operator_static'&&c.enabled===1&&c.retired_at_epoch===null&&c.revoked_at===null&&c.config_epoch===binding.expected_epoch&&typeof c.expires_at==='number'&&c.expires_at>now);
  const agents=inventory.AG.filter(r=>r.agent_id===binding.agent_id);check(agents.length===1);const a=agents[0];check(a.origin==='operator_static'&&a.status==='active'&&a.config_epoch===binding.expected_epoch);
  const projects=JSON.parse(String(c.project_ids_json)),scopes:unknown=JSON.parse(String(c.scopes_json));check(projects===null&&Array.isArray(scopes));const ss=scopes as unknown[];check(ss.every(s=>typeof s==='string')&&new Set(ss).size===ss.length);const required=['getAgent','listAgents'].includes(operation)?'agents:read':['getTask','getRun'].includes(operation)?'tasks:read':'workspace:read';check(ss.includes(required));
  check(inventory.P.length===0);for(const t of inventory.T)check(t.current_result_id===null&&t.approval_id===null&&t.project_id===null);
  for(const name of ['AG','T','R'])for(const r of inventory[name]){const id=r[name==='AG'?'agent_id':'id'];check(typeof id==='string'&&id.length>0&&id.length<=96&&!/[^A-Za-z0-9_-]/.test(id));}
  if(operation==='getAgent')check(inventory.AG.filter(r=>r.agent_id===binding.target_id).length===1);
  if(operation==='getTask'){const ts=inventory.T.filter(r=>r.id===binding.target_id);check(ts.length===1);const t=ts[0];check(t.state==='backlog'&&t.task_version===1&&t.active_run_id===null&&t.latest_run_id===null);}
  if(operation==='getRun'){const rs=inventory.R.filter(r=>r.id===binding.target_id);check(rs.length===1);const r=rs[0],ts=inventory.T.filter(t=>t.id===r.task_id);check(ts.length===1);const t=ts[0];check(r.status==='active'&&r.run_version===1&&r.agent_id===binding.agent_id&&r.credential_id===binding.credential_id&&r.authority_epoch===binding.expected_epoch&&typeof r.lease_expires_at==='number'&&r.lease_expires_at>now&&r.ended_at===null&&t.state==='doing'&&t.active_run_id===r.id&&t.latest_run_id===r.id);}
  expiresAt=Math.min(expiresAt,c.expires_at as number);
 }
 function preflight(){inventory={};for(const selector of PREFLIGHT_ORDER){const d=getPreflightDescriptor(selector);preflightQueries++;check(preflightQueries<=24);charge(d.bridge.rawScalarBytes,d.bridge.jsonArrayBytes);const raw=actualStorage.sql.exec(d.sql,...d.parameters.map(()=>binding.workspace_id)).toArray(),v=validatePreflightRows(selector,raw);retainedBytes+=v.byteSize;check(retainedBytes<=393216);inventory[selector]=v.rows;originals.push(Object.freeze({transaction:transactions,selector,canonical:v.canonical,byteSize:v.byteSize}));}admission();}
 function argumentsFor(id:number,params:readonly unknown[]){
  let expected:readonly unknown[]=[];const w=binding.workspace_id,c=binding.credential_id;
  if(id===6)expected=[w,actualTokenDigest];else if(id===7||id===10)expected=[c,w];else if(id===8||id===12||id===13)expected=[w];
  else if(id===9){check(params.length===2&&params[0]===w&&(params[1]===binding.agent_id||operation==='getAgent'&&params[1]===binding.target_id));return;}
  else if(id===14){check(operation==='listAgents'&&inventory.AG.length>0);const high=[...inventory.AG].sort((a,b)=>Number(a.created_at)-Number(b.created_at)||(String(a.agent_id)<String(b.agent_id)?-1:String(a.agent_id)>String(b.agent_id)?1:0)).at(-1)!;expected=[w,high.created_at,high.agent_id,51];}
  else if(id===15||id===16){const target=operation==='getRun'?inventory.R.find(r=>r.id===binding.target_id)?.task_id:binding.target_id;check(typeof target==='string');expected=[w,target];}
  else if(id===17||id===18)expected=[w,binding.target_id];
  check(params.length===expected.length&&params.every((v,i)=>v===expected[i]));
 }
 const sql=Object.freeze({exec(query:string,...params:unknown[]){return protect(()=>{healthy();check(active);let id=0;for(let i=1;i<=18;i++)if(getProductQueryDescriptor(i).sql===query){id=i;break;}check(id!==0);argumentsFor(id,params);const allowed=ledger.productCallCounts[String(id)]??0;counts[id]=(counts[id]??0)+1;productQueries++;check(counts[id]<=allowed);const d=getProductQueryDescriptor(id);charge(d.bound.rawScalarBytes,d.bound.jsonArrayBytes);const cursor=actualStorage.sql.exec(query,...params as (string|number|null)[]),issued=generation;let used=false;pendingCursors++;
  return Object.freeze({toArray(){return protect(()=>{healthy();check(active&&issued===generation&&!used);used=true;try{const rows=cursor.toArray();validateProductRows(id,rows);return rows;}finally{pendingCursors--;}});}});
 });}});
 const storage={sql,transactionSync<T>(body:()=>T):T{return protect(()=>{healthy();check(!active&&transactions<3&&typeof body==='function');transactions++;generation++;const startedAt=Date.now();return actualStorage.transactionSync(()=>{active=true;try{preflight();const result=body();if(result!==null&&(typeof result==='object'||typeof result==='function')&&typeof (result as {then?:unknown}).then==='function'){void Promise.resolve(result).catch(()=>{});reject();}healthy();check(pendingCursors===0&&Date.now()<expiresAt);return result;}finally{active=false;inventory={};transactionIntervals.push(Object.freeze({transaction:transactions,startedAt,endedAt:Date.now()}));}});});}} as unknown as DurableObjectStorage;
 function snapshot(){return Object.freeze({transactions,preflightQueries,productQueries,totalQueries:preflightQueries+productQueries,productCounts:Object.freeze({...counts}),bridgeRawBytes,bridgeJsonBytes,retainedBytes,pendingCursors,active,failed,finished});}
 return Object.freeze({storage:Object.freeze(storage),poison(){failed=true;},snapshot,finish(){return protect(()=>{healthy();check(!active&&pendingCursors===0&&transactions===3&&preflightQueries===24&&originals.length===24&&Date.now()<expiresAt);for(const [id,n]of Object.entries(ledger.productCallCounts))check(counts[id]===n);check(productQueries===ledger.authenticationCalls+ledger.finalCalls);finished=true;return Object.freeze({originals:Object.freeze([...originals]),counts:snapshot(),expiresAt,transactionIntervals:Object.freeze([...transactionIntervals])});});}});
}

}
export const createBoundedObserverStorage=boundedObserverProfile(16,legacyDescriptors);
export const createCurrentBoundedObserverStorage=boundedObserverProfile(17,currentObserverDescriptors);
