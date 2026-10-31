/** Source-only prepared bindings. This registry never authenticates a native caller. */
export interface PreparedObserverBinding {
 run_id:string;step_id:string;invocation_id:string;prepared_request_sha256:string;
 credential_handle:string;workspace_id:string;object_name:string;credential_id:string;
 agent_id:string;bearer:string;expected_epoch:number;maintenance_generation:number;
 config_digest:string;installation_digest:string;candidate_sha:string;target_id:string|null;
}
const steps=new Set(['getWorkspace','getConfiguration','getProfile','listAgents','getAgent','getTask','getRun'].map(op=>'success/'+op));
const scalarSteps=new Set(['success/getAgent','success/getTask','success/getRun']);
const entryKeys=['step_id','invocation_id','prepared_request_sha256','credential_handle','workspace_id','object_name','credential_id','agent_id','bearer','expected_epoch','maintenance_generation','config_digest','installation_digest','candidate_sha','target_id'];
const requestKeys=['run_id','step_id','invocation_id','prepared_request_sha256','credential_handle'];
const sharedKeys=['workspace_id','object_name','credential_id','agent_id','bearer','expected_epoch','maintenance_generation','config_digest','installation_digest','candidate_sha'];
interface RegistryState {runId:string;entries:Map<string,Readonly<PreparedObserverBinding>>;consumed:Set<string>;failed:boolean;}
const registries=new WeakMap<object,RegistryState>();
function fail():never{throw Error('NATIVE_OBSERVER_REGISTRY_REJECTED');}
function requireValue(value:unknown):asserts value{if(!value)fail();}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{
 requireValue(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype);
 const ds=Object.getOwnPropertyDescriptors(value);requireValue(Reflect.ownKeys(ds).length===keys.length);
 const result:Record<string,unknown>={};
 for(const key of keys){const d=ds[key];requireValue(d?.enumerable&&Object.hasOwn(d,'value'));result[key]=d.value;}
 return result;
}
function identifier(value:unknown,max=96):asserts value is string{requireValue(typeof value==='string'&&value.length>0&&value.length<=max&&!/[^A-Za-z0-9_-]/.test(value));}
function digest(value:unknown,size=64):void{requireValue(typeof value==='string'&&value.length===size&&!/[^a-f0-9]/.test(value));}
function bearer(value:unknown):void{
 requireValue(typeof value==='string'&&value.length===43&&!/[^A-Za-z0-9_-]/.test(value));
 const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'=');
 requireValue(raw.length===32&&btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')===value);
}
export function createSourceObserverRegistry(input:unknown):Readonly<{scope:'source-observer-registry';installedAuthority:false;native_conformance:false}>{
 try{
  const inputRecord=closed(input,['run_id','entries']);identifier(inputRecord.run_id,128);
  const values=inputRecord.entries;requireValue(Array.isArray(values)&&Object.getPrototypeOf(values)===Array.prototype);
  const ds=Object.getOwnPropertyDescriptors(values),count=Object.getOwnPropertyDescriptor(values,'length')?.value;
  requireValue(Number.isSafeInteger(count)&&count>=1&&count<=7&&Reflect.ownKeys(ds).length===count+1);
  const entries=new Map<string,Readonly<PreparedObserverBinding>>(),seenSteps=new Set<string>();let first:Record<string,unknown>|undefined;
  for(let i=0;i<count;i++){
   const d=ds[String(i)];requireValue(d?.enumerable&&Object.hasOwn(d,'value'));const e=closed(d.value,entryKeys);
   requireValue(typeof e.step_id==='string'&&steps.has(e.step_id)&&!seenSteps.has(e.step_id));seenSteps.add(e.step_id);
   for(const key of ['invocation_id','credential_handle'])identifier(e[key],128);
   for(const key of ['workspace_id','credential_id','agent_id'])identifier(e[key]);identifier(e.object_name,512);
   for(const key of ['prepared_request_sha256','config_digest','installation_digest'])digest(e[key]);digest(e.candidate_sha,40);bearer(e.bearer);
   requireValue(Number.isSafeInteger(e.expected_epoch)&&Number(e.expected_epoch)>0&&Number.isSafeInteger(e.maintenance_generation)&&Number(e.maintenance_generation)>=0);
   if(scalarSteps.has(e.step_id))identifier(e.target_id);else requireValue(e.target_id===null);
   if(first)for(const key of sharedKeys)requireValue(e[key]===first[key]);else first=e;
   const id=e.invocation_id as string;requireValue(!entries.has(id));
   entries.set(id,Object.freeze({...e,run_id:inputRecord.run_id}) as unknown as Readonly<PreparedObserverBinding>);
  }
  const brand=Object.freeze({scope:'source-observer-registry' as const,installedAuthority:false as const,native_conformance:false as const});
  registries.set(brand,{runId:inputRecord.run_id,entries,consumed:new Set(),failed:false});return brand;
 }catch{fail();}
}
/** Internal source helper only. Fixed observer must authenticate this bearer itself. */
export function takeSourceObserverBinding(registry:object,request:unknown):Readonly<PreparedObserverBinding>{
 const state=registries.get(registry);if(!state)fail();
 try{
  requireValue(!state.failed);const q=closed(request,requestKeys);identifier(q.run_id,128);identifier(q.invocation_id,128);identifier(q.credential_handle,128);digest(q.prepared_request_sha256);
  requireValue(q.run_id===state.runId&&typeof q.step_id==='string'&&steps.has(q.step_id));
  const record=state.entries.get(q.invocation_id);requireValue(record&&!state.consumed.has(q.invocation_id));
  for(const key of requestKeys)requireValue(q[key]===record[key as keyof PreparedObserverBinding]);
  state.consumed.add(q.invocation_id);return Object.freeze({...record});
 }catch{state.failed=true;fail();}
}
