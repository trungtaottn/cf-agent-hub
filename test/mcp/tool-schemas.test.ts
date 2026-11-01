import {describe,it,expect} from 'vitest';
import {tools,manifest,prepareToolCall} from '../../packages/mcp-stdio/src/tool-registry';
import {clientOperations} from '../../src/http/generated/client-operations';
const samples:Record<string,Record<string,unknown>>={
 hub_workspace_get:{},hub_agents_list:{limit:1},hub_tasks_list:{limit:1},hub_task_get:{task_id:'task'},hub_task_create:{title:'Synthetic',description:''},
 hub_task_claim:{task_id:'task',expected_version:1,runtime_instance_id:'runtime'},hub_run_get:{run_id:'run'},hub_run_heartbeat:{run_id:'run',expected_run_version:1,fence:1},
 hub_task_submit_result:{task_id:'task',expected_version:1,run_id:'run',fence:1,result:{summary:'Synthetic',artifact_ids:[]}},hub_task_fail:{task_id:'task',expected_version:1,run_id:'run',fence:1,reason:'Synthetic',outcome_unknown:true},
 hub_inbox_get:{limit:1},hub_thread_get:{thread_id:'thread',limit:1},hub_message_send:{recipient_agent_ids:['agent'],body:'Synthetic',refs:[],artifact_ids:[]},hub_messages_ack:{message_ids:['message']},hub_artifact_get:{artifact_id:'artifact'},hub_search:{q:'Synthetic',limit:1}
};
describe('closed native MCP registry',()=>{
 it('records17 planned slots but discovers only16 executable native operations',()=>{expect(manifest.tools).toHaveLength(17);expect(tools).toHaveLength(16);expect(tools.map(t=>t.name).sort()).toEqual(Object.keys(samples).sort());expect(manifest.tools.find(t=>t.name==='hub_task_request_decision')).toMatchObject({available:false,operation:'requestTaskDecision'});});
 it.each(Object.keys(samples))('%s maps exactly to native validated request',name=>{const definition=manifest.tools.find(t=>t.name===name)!;const args={workspace_id:'ws',...samples[name],...(definition.mutation?{idempotency_key:'Exact:Key'}:{})};const call=prepareToolCall(name,args,'https://hub.example.invalid','ws');expect(call.operation).toBe(definition.operation);expect(clientOperations[call.operation].validateRequest(call.request)).toBe(true);expect(call.idempotencyKey).toBe(definition.mutation?'Exact:Key':undefined);});
 it.each(['hub_task_request_decision','hub_approval_approve','hub_artifact_upload','not_a_tool'])('%s cannot dispatch',name=>expect(()=>prepareToolCall(name,{workspace_id:'ws'},'https://hub.example.invalid','ws')).toThrow('MCP_TOOL_UNKNOWN'));
 it.each([{workspace_id:'other'},{workspace_id:'ws',origin:'https://evil.invalid'},{workspace_id:'ws',actor:{id:'agent'}},{workspace_id:'ws',runtime_proof:'synthetic'},{workspace_id:'ws',idempotency_key:'read-key'}])('rejects foreign/authority/read-key input %j',args=>expect(()=>prepareToolCall('hub_workspace_get',args,'https://hub.example.invalid','ws')).toThrow('MCP_INPUT_REJECTED'));
 it('requires key and rejects unknown body fields before native invocation',()=>{for(const args of [{workspace_id:'ws',title:'Synthetic'},{workspace_id:'ws',title:'Synthetic',idempotency_key:'key',state:'done'}])expect(()=>prepareToolCall('hub_task_create',args,'https://hub.example.invalid','ws')).toThrow('MCP_INPUT_REJECTED');});
 it('preserves opaque pagination but rejects bounds',()=>{const args={workspace_id:'ws',limit:1,cursor:'opaque'};expect(prepareToolCall('hub_tasks_list',args,'https://hub.example.invalid','ws').request).toEqual({query:{limit:1,cursor:'opaque'}});expect(()=>prepareToolCall('hub_tasks_list',{...args,limit:0},'https://hub.example.invalid','ws')).toThrow();});
});
it('all advertised schemas compile and admit the same valid native fixtures',async()=>{
 const {default:Ajv}=await import('ajv/dist/2020.js');const {default:addFormats}=await import('ajv-formats');const ajv=new Ajv({strict:false});addFormats(ajv);
 for(const tool of tools){const definition=manifest.tools.find(t=>t.name===tool.name)!;const validate=ajv.compile(tool.inputSchema);const args={workspace_id:'ws',...samples[tool.name],...(definition.mutation?{idempotency_key:'Exact:Key'}:{})};expect(validate(args),JSON.stringify(validate.errors)).toBe(true);expect(validate({...args,actor:'forged'})).toBe(false);const output=tool.outputSchema;if(!output)throw Error('Missing output schema');expect(()=>ajv.compile(output)).not.toThrow();}
});
