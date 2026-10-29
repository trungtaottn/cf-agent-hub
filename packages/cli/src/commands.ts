import {parseArgs,type ParseArgsConfig} from 'node:util';
import {clientOperations} from '../../../src/http/generated/client-operations';
import type {EnabledOperationId} from '../../client/src/types';
export interface CommandOptions {origin?:string;workspace?:string;stateDir?:string;json:boolean;idempotencyKey?:string;inputFile?:string;file?:string;contentId?:string;output?:string;}
interface CommandSpec {operation:EnabledOperationId;path?:string;query?:readonly string[];body?:boolean;}
const page=['cursor','limit'];
export const nativeCommandMap:Readonly<Record<string,CommandSpec>>={
 'workspace show':{operation:'getWorkspace'},'workspace configuration':{operation:'getConfiguration'},'workspace profile':{operation:'getProfile'},
 'tasks list':{operation:'listTasks',query:[...page,'state','project-id']},'tasks create':{operation:'createTask',body:true},
 'tasks show':{operation:'getTask',path:'task_id'},'tasks update':{operation:'patchTask',path:'task_id',body:true},
 'tasks ready':{operation:'readyTask',path:'task_id',body:true},'tasks claim':{operation:'claimTask',path:'task_id',body:true},
 'tasks submit-result':{operation:'submitTaskResult',path:'task_id',body:true},'tasks accept-result':{operation:'acceptTaskResult',path:'task_id',body:true},
 'tasks fail':{operation:'failTask',path:'task_id',body:true},'tasks cancel':{operation:'cancelTask',path:'task_id',body:true},'tasks requeue':{operation:'requeueTask',path:'task_id',body:true},'tasks results':{operation:'listTaskResults',path:'task_id',query:page},
 'runs show':{operation:'getRun',path:'run_id'},'runs heartbeat':{operation:'heartbeatRun',path:'run_id',body:true},
 'agents list':{operation:'listAgents',query:page},'agents show':{operation:'getAgent',path:'agent_id'},
 'runtime register':{operation:'createRuntime',body:true},'runtime heartbeat':{operation:'heartbeatRuntime',path:'runtime_instance_id',body:true},
 'messages send':{operation:'createMessage',body:true},'messages ack':{operation:'ackMessages',body:true},'inbox list':{operation:'getInbox',query:[...page,'acknowledged']},'threads show':{operation:'getThread',path:'thread_id',query:page},
 'artifacts list':{operation:'listArtifacts',query:[...page,'task-id']},'artifacts stage':{operation:'stageArtifact',body:true},'artifacts show':{operation:'getArtifact',path:'artifact_id'},'artifacts upload':{operation:'uploadArtifactContent',path:'artifact_id'},'artifacts download':{operation:'downloadArtifactContent',path:'artifact_id'},'artifacts commit':{operation:'commitArtifact',path:'artifact_id',body:true},
 'events list':{operation:'listEvents',query:[...page,'after-sequence']},search:{operation:'searchWorkspace',query:[...page,'query','kind']}
};
const locals:Readonly<Record<string,{id?:boolean;remote?:boolean;file?:boolean}>>={
 'state init':{},'credential import':{},'intent inspect':{id:true,remote:true},'intent dispatch':{id:true,remote:true},'artifacts retain':{file:true},'artifacts inspect-content':{id:true},'artifacts inspect-upload':{id:true,remote:true},'artifacts dispatch-upload':{id:true,remote:true},'state cleanup':{}
};
export interface ParsedCommand {kind:'native'|'local';command:string;operation?:EnabledOperationId;input:{path?:Record<string,string>;query?:Record<string,string|number|boolean>};options:CommandOptions;id?:string;}
function reject():never {throw Error('CLI_ARGUMENT_REJECTED');}
const aliases:Record<string,keyof CommandOptions>={'origin':'origin','workspace':'workspace','state-dir':'stateDir','idempotency-key':'idempotencyKey','input':'inputFile','file':'file','content-id':'contentId','output':'output'};
/** Shell presentation only. Canonical request preparation remains authoritative. */
export function parseCommand(argv:readonly string[]):ParsedCommand {
 try{
  const allStrings=[...Object.keys(aliases),'cursor','limit','state','project-id','acknowledged','task-id','after-sequence','query','kind'];
  const definitions:NonNullable<ParseArgsConfig['options']>={...Object.fromEntries(allStrings.map(k=>[k,{type:'string' as const}])),json:{type:'boolean'}};
  const parsed=parseArgs({args:[...argv],options:definitions,strict:true,allowPositionals:true,tokens:true});
  const seen=new Set<string>();for(const token of parsed.tokens){if(token.kind==='option-terminator')reject();if(token.kind==='option'){if(seen.has(token.name))reject();seen.add(token.name);if(token.value!==undefined&&(token.value.length===0||token.value.includes('\0')))reject();}}
  const words=parsed.positionals,command=words[0]==='search'?'search':words.slice(0,2).join(' '),offset=command==='search'?1:2;
  const spec=Object.hasOwn(nativeCommandMap,command)?nativeCommandMap[command]:undefined,local=Object.hasOwn(locals,command)?locals[command]:undefined;if(!spec&&!local)reject();
  const hasId=Boolean(spec?.path||local?.id);if(words.length!==offset+(hasId?1:0)||hasId&&!words[offset])reject();
  const allowed=new Set(['state-dir','json']);if(spec||local?.remote){allowed.add('origin');allowed.add('workspace');}
  if(spec){for(const q of spec.query??[])allowed.add(q);if(spec.body)allowed.add('input');if(clientOperations[spec.operation].idempotency)allowed.add('idempotency-key');if(spec.operation==='stageArtifact'||spec.operation==='uploadArtifactContent')allowed.add('content-id');if(spec.operation==='uploadArtifactContent')allowed.add('file');if(spec.operation==='downloadArtifactContent')allowed.add('output');}if(local?.file)allowed.add('file');
  for(const name of seen)if(!allowed.has(name))reject();
  const values=parsed.values as Record<string,string|boolean|undefined>,options:CommandOptions={json:values.json===true};
  for(const [flag,key]of Object.entries(aliases))if(typeof values[flag]==='string')Object.assign(options,{[key]:values[flag]});
  if(spec?.body&&!options.inputFile||local?.file&&!options.file||spec?.operation==='stageArtifact'&&!options.contentId||spec?.operation==='downloadArtifactContent'&&!options.output)reject();
  if(spec?.operation==='uploadArtifactContent'&&Boolean(options.file)===Boolean(options.contentId))reject();
  const input:ParsedCommand['input']={};if(spec?.path)input.path={[spec.path]:words[offset]};
  const query:Record<string,string|number|boolean>={};for(const flag of spec?.query??[]){const raw=values[flag];if(raw===undefined)continue;if(typeof raw!=='string')reject();let value:string|number|boolean=raw;if(flag==='limit'||flag==='after-sequence'){if(!/^(0|[1-9][0-9]*)$/.test(raw)||!Number.isSafeInteger(Number(raw)))reject();value=Number(raw);}if(flag==='acknowledged'){if(raw!=='true'&&raw!=='false')reject();value=raw==='true';}query[flag==='query'?'q':flag.replaceAll('-','_')]=value;}
  if(query.cursor!==undefined&&query.after_sequence!==undefined)reject();if(Object.keys(query).length)input.query=query;
  return {kind:spec?'native':'local',command,...(spec?{operation:spec.operation}:{}),input,options,...(hasId?{id:words[offset]}:{})};
 }catch{return reject();}
}
