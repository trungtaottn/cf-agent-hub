import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../../../',import.meta.url),spec=JSON.parse(readFileSync(new URL('spec/openapi.json',root),'utf8'));
const pairs=[['hub_workspace_get','getWorkspace'],['hub_agents_list','listAgents'],['hub_tasks_list','listTasks'],['hub_task_get','getTask'],['hub_task_create','createTask'],['hub_task_claim','claimTask'],['hub_run_get','getRun'],['hub_run_heartbeat','heartbeatRun'],['hub_task_request_decision','requestTaskDecision'],['hub_task_submit_result','submitTaskResult'],['hub_task_fail','failTask'],['hub_inbox_get','getInbox'],['hub_thread_get','getThread'],['hub_message_send','createMessage'],['hub_messages_ack','ackMessages'],['hub_artifact_get','getArtifact'],['hub_search','searchWorkspace']];
const deref=value=>value?.$ref?value.$ref.slice(2).split('/').reduce((x,key)=>x[key],spec):value;
function schemaWithDefinitions(schema){
 const definitions={},visiting=new Set();
 const walk=value=>{
  if(Array.isArray(value))return value.map(walk);
  if(!value||typeof value!=='object')return value;
  if(value.$ref){if(!value.$ref.startsWith('#/components/schemas/'))throw Error('Nonlocal schema reference');const name=value.$ref.split('/').at(-1);if(!visiting.has(name)){visiting.add(name);definitions[name]=walk(spec.components.schemas[name]);}return {...walk(Object.fromEntries(Object.entries(value).filter(([k])=>k!=='$ref'))),$ref:'#/$defs/'+name};}
  return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,walk(v)]));
 };
 const output=walk(schema);return {...output,...(Object.keys(definitions).length?{$defs:definitions}:{})};
}
const tools=pairs.map(([name,operation])=>{
 let selected;for(const [path,item]of Object.entries(spec.paths))for(const [method,op]of Object.entries(item))if(op.operationId===operation)selected={path,item,method,op};
 if(!selected)throw Error('Missing operation '+operation);const {path,item,method,op}=selected;
 const mutation=method!=='get',properties={},required=['workspace_id'],pathFields=[],queryFields=[];
 for(const parameter of [...(item.parameters??[]),...(op.parameters??[])].map(deref)){
  if(!['path','query'].includes(parameter.in))continue;properties[parameter.name]=parameter.schema;
  (parameter.in==='path'?pathFields:queryFields).push(parameter.name);
  if(parameter.required&&!required.includes(parameter.name))required.push(parameter.name);
 }
 if(!properties.workspace_id)throw Error('Missing workspace binding');
 const body=op.requestBody?deref(op.requestBody).content['application/json'].schema:undefined;
 const bodySchema=body?deref(body):undefined,bodyFields=Object.keys(bodySchema?.properties??{});
 for(const field of bodyFields){if(Object.hasOwn(properties,field))throw Error('Ambiguous input '+field);properties[field]=bodySchema.properties[field];}
 required.push(...(bodySchema?.required??[]));
 if(mutation){properties.idempotency_key={type:'string',minLength:1,maxLength:256,pattern:'^[!-~]+$'};required.push('idempotency_key');}
 const success=Object.entries(op.responses).find(([status])=>/^2\d\d$/.test(status));if(!success)throw Error('Missing response');
 const response=deref(success[1]).content['application/json'].schema;
 return {name,operation,available:operation!=='requestTaskDecision',mutation,requiredScopes:op['x-required-scopes'],actorKind:op['x-actor-kind'],runtimeProof:op.security?.some(x=>Object.hasOwn(x,'RuntimeProof'))??false,pathFields:pathFields.filter(x=>x!=='workspace_id'),queryFields,bodyFields,
 description:op.summary,inputSchema:schemaWithDefinitions({type:'object',additionalProperties:false,properties,required:[...new Set(required)]}),outputSchema:schemaWithDefinitions({type:'object',anyOf:[response,{$ref:'#/components/schemas/Error'}]}),annotations:{readOnlyHint:!mutation,destructiveHint:mutation,idempotentHint:false,openWorldHint:false}};
});
const value=JSON.stringify({contractRevision:1,protocolVersion:'2025-11-25',sdkVersion:'1.32.2',status:'Partial source:16 executable operations; decision slot unavailable; no17-tool parity',tools},null,2)+'\n';
const path=fileURLToPath(new URL('docs/contracts/mcp-stdio-tools.json',root));
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==value)throw Error('MCP contract drift');}else writeFileSync(path,value);
