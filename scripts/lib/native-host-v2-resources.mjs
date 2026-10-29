/** Explicit fixture identity profile, not independent SQL state or native acceptance. */
import {types} from 'node:util';
import {parseNativeCliOutput} from './native-cli-output.mjs';
import {getNativeScenario} from './native-r2-scenario.mjs';
const fail=()=>{throw Error('NATIVE_RESOURCE_PROFILE_INCOMPLETE');},check=v=>{if(!v)fail();};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const mapping={getWorkspace:'workspace',getConfiguration:'workspace-context',getProfile:'workspace-context',listTasks:'task-list',createTask:'task',getTask:'task',patchTask:'task',readyTask:'task-command',claimTask:'task-command',submitTaskResult:'task-command',acceptTaskResult:'task-command',failTask:'task-command',cancelTask:'task-command',requeueTask:'task-command',listTaskResults:'result-list',getRun:'run',heartbeatRun:'run',listAgents:'agent-list',getAgent:'agent',createRuntime:'masked-runtime',heartbeatRuntime:'runtime',createMessage:'message',ackMessages:'ack-union',getInbox:'message-list',getThread:'message-list',listArtifacts:'artifact-list',stageArtifact:'artifact',getArtifact:'artifact',uploadArtifactContent:'artifact',downloadArtifactContent:'artifact',commitArtifact:'artifact',listEvents:'event-list',searchWorkspace:'search-list'};
export const NATIVE_RESOURCE_ID_CONVENTION=freeze({version:2,name:'kind-qualified-ascii-v1',raw_id_pattern:'^[A-Za-z0-9_-]{1,96}$',raw_id_max_bytes:96,qualified_id_max_bytes:107,resource_count_max:64,prefixes:['workspace','task','run','result-run','agent','runtime','message','artifact','event'],ordering:'ascii-code-unit',duplicates:'reject-except-ack-union',task_result:'result-run:run_id',result_unique_key:['workspace_id','run_id'],scope:'response-identity-only',native_conformance:false,operations:{...mapping}});
const steps=new Map(getNativeScenario().steps.filter(s=>s.id==='success/'+s.operation||s.id==='prepare/fail-create').map(s=>[s.id,s]));
function closed(v){check(v&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype);const ds=Object.getOwnPropertyDescriptors(v),keys=['stepId','workspaceId','stdout','stderr'];check(Reflect.ownKeys(ds).length===keys.length);return Object.fromEntries(keys.map(k=>{check(ds[k]?.enumerable&&Object.hasOwn(ds[k],'value'));return[k,ds[k].value];}));}
const raw=v=>{check(typeof v==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(v));return v;};
export function extractNativeResourceIds(input){try{const v=closed(input);check(typeof v.stepId==='string');const step=steps.get(v.stepId);check(step&&step.expectedExit===0&&Object.hasOwn(mapping,step.operation));const workspace=raw(v.workspaceId),output=parseNativeCliOutput({stepId:v.stepId,stdout:v.stdout,stderr:v.stderr,mode:'full'});check(output.kind==='native-success'&&output.schemaStatus==='passed');const parsed=output.parsed,data=parsed.data,ids=new Set();
 const add=(kind,id,union=false)=>{const value=kind+':'+raw(id);check(union||!ids.has(value));ids.add(value);check(ids.size<=64);};
 const owned=row=>{check(row.workspace_id===workspace);};
 const result=row=>add('result-run',row.run_id);
 const task=row=>{owned(row);add('task',row.id);if(row.result!==null)result(row.result);};
 const resource=(kind,row)=>{owned(row);add(kind,row.id);};
 const mode=mapping[step.operation];
 if(mode==='workspace'){check(data.id===workspace);add('workspace',workspace);}
 else if(mode==='workspace-context')add('workspace',workspace);
 else if(mode==='task')task(data);
 else if(mode==='task-command'){check(data.approval===null);task(data.task);if(data.run!==null){check(data.run.task_id===data.task.id);resource('run',data.run);if(data.task.result!==null)check(data.task.result.run_id===data.run.id);}}
 else if(mode==='task-list')data.forEach(task);
 else if(mode==='result-list')data.forEach(result);
 else if(mode==='masked-runtime')resource('runtime',parsed);
 else if(mode==='ack-union'){for(const id of [...data.acknowledged_ids,...data.already_acknowledged_ids])add('message',id,true);}
 else if(mode==='search-list'){for(const row of data){check(['task','message','artifact'].includes(row.kind));add(row.kind,row.id);}}
 else if(mode.endsWith('-list')){const kind=mode.slice(0,-5);data.forEach(row=>resource(kind,row));}
 else resource(mode,data);
 return freeze({type:'native-resource-id-projection',version:2,convention:NATIVE_RESOURCE_ID_CONVENTION.name,step_id:step.id,operation:step.operation,workspace_id:workspace,response_resource_ids:[...ids].sort(),scope:'response-identity-only',native_conformance:false});
 }catch{fail();}}
