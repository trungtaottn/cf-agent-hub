/** Dedicated local test entry only. Never exported by the production Worker. */
import {WorkspaceDO as ProductWorkspaceDO} from '../../../src/workspace/workspace-do';
import {systemClock,systemEntropy} from '../../../src/workspace/context';
import {canonicalJson} from '../../../src/config/bootstrap';
import {createSourceObserverRegistry} from './registry';
import {createPrivateNativeObserver,readPrivateObserverCapture} from './adapter';
export {default} from '../../../src/index';
function reject():never{throw Error('PRIVATE_OBSERVER_BRIDGE_REJECTED');}
function check(v:unknown):asserts v{if(!v)reject();}
function closed(v:unknown,keys:string[]):Record<string,unknown>{check(v&&Object.getPrototypeOf(v)===Object.prototype);const ds=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(ds).length===keys.length);return Object.fromEntries(keys.map(k=>{check(ds[k]?.enumerable&&Object.hasOwn(ds[k],'value'));return[k,ds[k].value];}));}
const encoder=new TextEncoder(),selectors=['S','F','M','C','AG','T','R','P'];
const entryKeys=['step_id','invocation_id','prepared_request_sha256','credential_handle','workspace_id','object_name','credential_id','agent_id','bearer','expected_epoch','maintenance_generation','config_digest','installation_digest','candidate_sha','target_id'];
type RecordMeta={record_id:string;kind:'sql-canonical'|'source-reader-projection';byte_size:number;sha256:string};
type Held={invocation_id:string;meta:RecordMeta;bytes:Uint8Array};
export class WorkspaceDO extends ProductWorkspaceDO{
 #observer:ReturnType<typeof createPrivateNativeObserver>|null=null;
 #active:Promise<unknown>|null=null;#closed=false;#attempted=false;#runId:string|null=null;
 #records=new Map<string,Held>();#observed=new Set<string>();
 #clear(){for(const row of this.#records.values())row.bytes.fill(0);this.#records.clear();}
 #check(){check(!this.#closed);}
 #execute<T>(body:()=>Promise<T>|T):Promise<T>{
  this.#check();if(this.#active){this.#closed=true;reject();}
  const work=Promise.resolve().then(()=>{this.#check();return body();}).then(value=>{this.#check();return value;}).catch(async()=>{this.#closed=true;this.#clear();if(this.#observer)await this.#observer.close();reject();}).finally(()=>{this.#active=null;});
  this.#active=work;return work;
 }
 installSourceObserver(value:unknown){return this.#execute(()=>{
  check(!this.#attempted);this.#attempted=true;
  const raw=closed(value,['run_id','workspace_id','object_name','entries']);
  for(const k of ['workspace_id','object_name'])check(typeof raw[k]==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(raw[k] as string));
  check(Array.isArray(raw.entries)&&raw.entries.length>=1&&raw.entries.length<=7);
  const ds=Object.getOwnPropertyDescriptors(raw.entries);check(Reflect.ownKeys(ds).length===raw.entries.length+1);
  const entries=Array.from({length:raw.entries.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(raw.entries,String(i));check(d?.enumerable&&Object.hasOwn(d,'value'));return closed(d.value,entryKeys);});
  const registryInput={run_id:raw.run_id,entries};const registry=createSourceObserverRegistry(registryInput);
  check(entries.every(e=>e.workspace_id===raw.workspace_id&&e.object_name===raw.object_name));
  check(encoder.encode(canonicalJson({...raw,entries})).byteLength<=16384);
  check(this.env.WORKSPACE.idFromName(raw.object_name as string).toString()===this.ctx.id.toString());
  this.#runId=raw.run_id as string;
  this.#observer=createPrivateNativeObserver({workspace:{storage:this.ctx.storage,workspaceId:raw.workspace_id as string,objectName:raw.object_name as string,secrets:{},clock:systemClock,entropy:systemEntropy},registry});
  const reply=canonicalJson({status:'bound',entries:entries.length,installedAuthority:false,native_conformance:false});check(encoder.encode(reply).byteLength<=1024);return reply;
 });}
 observeSourceResource(value:unknown){return this.#execute(async()=>{
  check(this.#observer);const request=closed(value,['run_id','step_id','invocation_id','prepared_request_sha256','credential_handle']);check(request.run_id===this.#runId&&typeof request.invocation_id==='string'&&!this.#observed.has(request.invocation_id));
  const result=await this.#observer.observe(request);this.#check();
  const capture=readPrivateObserverCapture(result.capture);check(capture.originals.length===24);
  const records:RecordMeta[]=[];
  for(let i=0;i<24;i++){const row=capture.originals[i],transaction=Math.floor(i/8)+1,selector=selectors[i%8];check(row.transaction===transaction&&row.selector===selector&&row.bytes.byteLength===row.byteSize&&row.byteSize<=16384);records.push({record_id:`sql_t${transaction}_${selector}`,kind:'sql-canonical',byte_size:row.byteSize,sha256:row.sha256});}
  check(capture.projection.bytes.byteLength===capture.projection.byteSize&&capture.projection.byteSize<=65536);
  records.push({record_id:'projection',kind:'source-reader-projection',byte_size:capture.projection.byteSize,sha256:capture.projection.sha256});
  const manifest={type:'source-observer-manifest',subject:result.subject,resource_ids:result.resourceIds,producer_id:'private_source_observer',records,installedAuthority:false,native_conformance:false};
  check(encoder.encode(canonicalJson(manifest)).byteLength<=16384);
  check(this.#records.size+records.length<=175);
  for(let i=0;i<records.length;i++){const meta=records[i],bytes=i===24?capture.projection.bytes:capture.originals[i].bytes;this.#records.set(request.invocation_id+':'+meta.record_id,{invocation_id:request.invocation_id,meta,bytes});}
  this.#observed.add(request.invocation_id);return canonicalJson(manifest);
 });}
 readSourceOriginal(value:unknown){return this.#execute(()=>{
  const input=closed(value,['run_id','invocation_id','record_id','kind','byte_size','sha256']);check(input.run_id===this.#runId&&typeof input.invocation_id==='string'&&typeof input.record_id==='string');
  const key=input.invocation_id+':'+input.record_id,row=this.#records.get(key);check(row&&row.invocation_id===input.invocation_id);
  for(const k of ['record_id','kind','byte_size','sha256'] as const)check(row.meta[k]===input[k]);
  this.#records.delete(key);check(row.bytes.byteLength===row.meta.byte_size&&row.bytes.byteLength<=(row.meta.kind==='sql-canonical'?16384:65536));
  check(encoder.encode(canonicalJson(row.meta)).byteLength<=1024);
  const chunks:string[]=[];for(let i=0;i<row.bytes.length;i+=4096)chunks.push(String.fromCharCode(...row.bytes.subarray(i,i+4096)));const payload_base64=btoa(chunks.join(''));check(payload_base64.length===4*Math.ceil(row.meta.byte_size/3));check(encoder.encode(canonicalJson({...row.meta,payload_base64:''})).byteLength<=1024);const reply=canonicalJson({...row.meta,payload_base64});check(encoder.encode(reply).byteLength<=(row.meta.kind==='sql-canonical'?22872:88408));row.bytes.fill(0);return reply;
 });}
 async closeSourceObserver(){this.#closed=true;const active=this.#active;if(active)await Promise.allSettled([active]);if(this.#observer)await this.#observer.close();this.#clear();this.#observer=null;return canonicalJson({status:'closed',installedAuthority:false,native_conformance:false});}
}
