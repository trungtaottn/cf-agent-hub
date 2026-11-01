import {expect,it} from 'vitest';
import {runReadParity} from './native-worker-parity-driver';
// Literal sixteen core tool pairs below; helper cases are separate, and shared negatives remain separately required.
const rows=[
 ['hub_workspace_get','getWorkspace','workspace:read','/v2/workspaces/ws_example'],
 ['hub_agents_list','listAgents','agents:read','/v2/workspaces/ws_example/agents'],
 ['hub_tasks_list','listTasks','tasks:read','/v2/workspaces/ws_example/tasks'],
 ['hub_task_get','getTask','tasks:read','/v2/workspaces/ws_example/tasks/task_parity'],
] as const;
for(const [tool,operation,scope,path] of rows)it(`${tool}: actual protected SDK/native allowed and public missing-scope parity`,async()=>{
 const {identity,...receipt}=await runReadParity({tool,operation,scope,path});
 expect(identity).toMatchObject({sdk_version:'1.32.2',sdk_entry:'packages/mcp-stdio/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'});
 for(const key of ['worker_sha256','adapter_sha256','sdk_entry_sha256','sdk_package_sha256'] as const)expect(identity[key]).toMatch(/^[a-f0-9]{64}$/);
 expect(receipt).toEqual({tool,operation,allowed:{status:200,dispatches:2,unchanged:true},denied:{status:403,code:'FORBIDDEN',retryable:false,dispatches:2,unchanged:true},acceptance_eligible:false});
},60000);

import {runTaskParity} from './native-worker-parity-driver';
const taskRows=[
 ['hub_task_create','createTask','tasks:create',201],
 ['hub_task_claim','claimTask','tasks:claim',200],
 ['hub_run_get','getRun','tasks:read',200],
 ['hub_run_heartbeat','heartbeatRun','tasks:execute',200],
 ['hub_task_submit_result','submitTaskResult','tasks:execute',200],
 ['hub_task_fail','failTask','tasks:execute',200],
] as const;
for(const [tool,operation,scope,status] of taskRows)it(`task/run ${tool}: actual effect, denial and native comparison parity`,async()=>{
 const receipt=await runTaskParity({tool,operation,scope,status});
 expect(receipt).toMatchObject({tool,operation,status,allowed:true,denied:{status:403,code:'FORBIDDEN',retryable:false},native_replay_unchanged:operation==='getRun'?null:true,comparison_mode:operation==='getRun'?'read-repeat':'original-key-replay',acceptance_eligible:false,denial_control:scope==='tasks:execute'?'test-only-current-scope-removal':'signed-missing-scope'});
},60000);

import {assertSameSemanticBody} from './native-worker-parity-driver';
it('semantic JSON comparison preserves full nested values while allowing key order',()=>{
 expect(()=>assertSameSemanticBody('{"run_id":"run_a","result":{"summary":"x","artifact_ids":["artifact_a"]}}','{"result":{"artifact_ids":["artifact_a"],"summary":"x"},"run_id":"run_a"}')).not.toThrow();
});
it('semantic JSON comparison rejects changed nested artifact identity',()=>{
 expect(()=>assertSameSemanticBody('{"result":{"artifact_ids":["artifact_a"]}}','{"result":{"artifact_ids":["artifact_b"]}}')).toThrow();
});
it('semantic JSON comparison rejects changed generated run identity',()=>{
 expect(()=>assertSameSemanticBody('{"run_id":"run_a"}','{"run_id":"run_b"}')).toThrow();
});

import {runOtherParity} from './native-worker-parity-driver';
const otherRows=[
 ['hub_inbox_get','getInbox','messages:read',200],
 ['hub_thread_get','getThread','messages:read',200],
 ['hub_message_send','createMessage','messages:send',201],
 ['hub_messages_ack','ackMessages','messages:ack',200],
 ['hub_artifact_get','getArtifact','artifacts:read',200],
 ['hub_search','searchWorkspace','search:read',200],
] as const;
for(const [tool,operation,scope,status] of otherRows)it(`other ${tool}: actual native and SDK effects/authorization parity`,async()=>{
 const receipt=await runOtherParity({tool,operation,scope,status});
 expect(receipt).toMatchObject({tool,operation,status,allowed:true,denied:{status:403,code:'FORBIDDEN',retryable:false},denial_control:'signed-missing-scope',acceptance_eligible:false});
},60000);

import {runSharedParity} from './native-worker-parity-driver';
for(const kind of ['cursor','authority','claim-loss'] as const)it(`shared ${kind}: actual source boundary and no hidden business resend`,async()=>{
 expect(await runSharedParity(kind)).toMatchObject({kind,source_only:true,acceptance_eligible:false,completed:true});
},60000);
