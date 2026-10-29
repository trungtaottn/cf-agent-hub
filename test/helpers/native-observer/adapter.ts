/** Private local source observer: genuine native authentication, never installed authority. */
import type {AuthWorkspace} from '../../../src/auth/context';
import {currentConfiguration} from '../../../src/auth/context';
import {verifyNativeCredential} from '../../../src/auth/native';
import {resolveActor,authorize} from '../../../src/auth/authorize';
import {withTransaction} from '../../../src/storage/transaction';
import {systemClock} from '../../../src/workspace/context';
import {canonicalJson,sha256} from '../../../src/config/bootstrap';
import {storedProfile,readProfile} from '../../../src/config/profile';
import {readConfiguration} from '../../../src/config/settings-service';
import {getAgent} from '../../../src/agents/commands';
import {listAgents} from '../../../src/agents/reads';
import {getTask} from '../../../src/tasks/repository';
import {getRun} from '../../../src/tasks/lease';
import {takeSourceObserverBinding} from './registry';
import {createBoundedObserverStorage} from './bounded-storage';
interface Original {transaction:number;selector:string;byteSize:number;sha256:string;bytes:Uint8Array;}
interface Projection {byteSize:number;sha256:string;bytes:Uint8Array;}
interface Capture {originals:Original[];projection:Projection;}
const captures=new WeakMap<object,Capture>();
const encoder=new TextEncoder();
function fail():never{throw Error('NATIVE_PRIVATE_OBSERVER_REJECTED');}
function requireValue(value:unknown):asserts value{if(!value)fail();}
/** Internal one-use copy-out; private rows never appear in the normal observation result. */
export function readPrivateObserverCapture(handle:object):Readonly<{originals:readonly Readonly<Original>[];projection:Readonly<Projection>}>{
 const captured=captures.get(handle);if(!captured)fail();captures.delete(handle);
 return Object.freeze({originals:Object.freeze(captured.originals.map(r=>Object.freeze({...r,bytes:r.bytes.slice()}))),projection:Object.freeze({...captured.projection,bytes:captured.projection.bytes.slice()})});
}
export function createPrivateNativeObserver(input:{workspace:AuthWorkspace;registry:object}){
 requireValue(input&&Object.getPrototypeOf(input)===Object.prototype);
 const descriptors=Object.getOwnPropertyDescriptors(input);requireValue(Reflect.ownKeys(descriptors).length===2&&['workspace','registry'].every(k=>descriptors[k]?.enumerable&&Object.hasOwn(descriptors[k],'value')));
 const workspace=descriptors.workspace.value as AuthWorkspace,registry=descriptors.registry.value as object;
 requireValue(workspace&&workspace.clock===systemClock);
 let closed=false,poisoned=false,active:Promise<unknown>|null=null,attempts=0,reservedBytes=0;
 const check=()=>requireValue(!closed&&!poisoned);
 function observe(request:unknown){
  try{check();requireValue(active===null&&attempts<7);attempts++;reservedBytes+=475136;requireValue(reservedBytes<=3325952);}catch{poisoned=true;fail();}
  const work=Promise.resolve().then(async()=>{
   check();const binding=takeSourceObserverBinding(registry,request);
   requireValue(workspace.workspaceId===binding.workspace_id&&workspace.objectName===binding.object_name);
   const tokenDigest=await sha256(binding.bearer);check();
   const bounded=createBoundedObserverStorage(workspace.storage,binding,tokenDigest);
   try{
    const guarded={...workspace,storage:bounded.storage};
    const identity=await verifyNativeCredential(guarded,binding.bearer,systemClock.nowMs());check();
    requireValue(identity.kind==='agent'&&identity.workspaceId===binding.workspace_id&&identity.credentialId===binding.credential_id&&identity.tokenDigest===tokenDigest);
    const expectedFence=Object.freeze({authorityEpoch:binding.expected_epoch,maintenanceGeneration:binding.maintenance_generation});
    const value=withTransaction(guarded.storage,tx=>{
     currentConfiguration(tx,guarded,expectedFence);
     const nowMs=systemClock.nowMs(),actor=resolveActor(tx,identity,nowMs);
     requireValue(actor.kind==='agent'&&actor.workspaceId===binding.workspace_id&&actor.principalId===binding.agent_id&&actor.agentId===binding.agent_id&&actor.credentialId===binding.credential_id);
     let data:unknown;
     switch(binding.step_id){
      case 'success/getWorkspace':authorize(tx,actor,'workspace:read',undefined,nowMs);storedProfile(tx,actor);data={workspace_id:actor.workspaceId};break;
      case 'success/getConfiguration':data=readConfiguration(tx,actor);break;
      case 'success/getProfile':data=readProfile(tx,actor);break;
      case 'success/getAgent':data=getAgent(tx,actor,binding.target_id!,nowMs);break;
      case 'success/listAgents':{
       const page=listAgents(tx,actor,{limit:50,nowMs,binding:{workspaceId:actor.workspaceId,principalId:actor.principalId,lane:'agent',credentialId:actor.credentialId,sessionId:null,operation:'agents',queryHash:binding.prepared_request_sha256}});
       requireValue(!page.hasMore&&page.next===null);data=page.items;break;
      }
      case 'success/getTask':data=getTask(tx,{actor,nowMs},binding.target_id!);break;
      case 'success/getRun':data=getRun(tx,{actor,nowMs},binding.target_id!);break;
      default:fail();
     }
     currentConfiguration(tx,guarded,expectedFence);return data;
    });
    const finished=bounded.finish();check();
    const ids:string[]=[];
    const add=(kind:string,row:unknown)=>{requireValue(row&&typeof row==='object');const r=row as {id:unknown;workspace_id:unknown};requireValue(r.workspace_id===binding.workspace_id&&typeof r.id==='string'&&r.id.length>0&&r.id.length<=96&&!/[^A-Za-z0-9_-]/.test(r.id));ids.push(kind+':'+r.id);};
    if(binding.step_id==='success/listAgents'){requireValue(Array.isArray(value));for(const row of value)add('agent',row);}
    else if(binding.step_id==='success/getAgent')add('agent',value);
    else if(binding.step_id==='success/getTask')add('task',value);
    else if(binding.step_id==='success/getRun')add('run',value);
    else ids.push('workspace:'+binding.workspace_id);
    requireValue(ids.length<=64&&new Set(ids).size===ids.length);ids.sort();
    const subject={run_id:binding.run_id,step_id:binding.step_id,invocation_id:binding.invocation_id,prepared_request_sha256:binding.prepared_request_sha256,candidate_sha:binding.candidate_sha,workspace_id:binding.workspace_id,object_name:binding.object_name,config_digest:binding.config_digest,installation_digest:binding.installation_digest,fence:expectedFence};
    const projectionText=canonicalJson({type:'native-source-reader-projection',version:2,scope:'source-reader-object-not-http',subject,resource_ids:ids,data:value,transaction_intervals:finished.transactionIntervals});
    requireValue(projectionText.length<=65536);const projectionBytes=encoder.encode(projectionText);requireValue(projectionBytes.byteLength<=65536);
    const originals:Original[]=[];let privateBytes=projectionBytes.byteLength;
    for(const record of finished.originals){check();privateBytes+=record.byteSize;requireValue(privateBytes<=458752);originals.push({transaction:record.transaction,selector:record.selector,byteSize:record.byteSize,bytes:encoder.encode(record.canonical),sha256:await sha256(record.canonical)});}
    const projection={bytes:projectionBytes,byteSize:projectionBytes.byteLength,sha256:await sha256(projectionText)};
    const metadataText=canonicalJson({subject,resource_ids:ids,counts:finished.counts,originals:originals.map(({transaction,selector,byteSize,sha256})=>({transaction,selector,byteSize,sha256})),projection:{byteSize:projection.byteSize,sha256:projection.sha256}});
    requireValue(metadataText.length<=16384&&encoder.encode(metadataText).byteLength<=16384);
    check();requireValue(systemClock.nowMs()<finished.expiresAt);
    const capture=Object.freeze({scope:'private-source-observer-capture'});captures.set(capture,{originals,projection});
    return Object.freeze({scope:'source-observer' as const,installedAuthority:false as const,native_conformance:false as const,subject:Object.freeze(subject),resourceIds:Object.freeze(ids),counts:finished.counts,capture});
   }catch{bounded.poison();throw Error('NATIVE_PRIVATE_OBSERVER_REJECTED');}
  });
  const terminal=work.catch(()=>{poisoned=true;fail();}).finally(()=>{active=null;});active=terminal;return terminal;
 }
 return Object.freeze({observe,snapshot:()=>Object.freeze({scope:'source-observer',installedAuthority:false,native_conformance:false,attempts,reservedBytes,pending:active!==null,closed,poisoned}),async close(){closed=true;const pending=active;if(pending)await Promise.allSettled([pending]);return Object.freeze({status:'closed' as const});}});
}
