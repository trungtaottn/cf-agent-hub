import {it,expect} from 'vitest';
import {clientOperations} from '../../src/http/generated/client-operations';
import {prepareNativeOperation} from '../../packages/client/src/native-request';
import type {EnabledOperationId} from '../../packages/client/src/types';
const input={path:{task_id:'task'},body:{expected_version:3,run_id:'run',fence:1,checkpoint:{summary:'Synthetic',artifact_ids:[]},proposal:{summary:'Synthetic',action:'synthetic.task-review',scope:{project_id:null,resource_ids:['task']},artifact_ids:[],inputs:{artifact_id:'artifact',sha256:'a'.repeat(64)}}}};
it('request decision is a canonical protected native operation without enabling human decisions',()=>{
 expect(clientOperations).toHaveProperty('requestTaskDecision');
 const operation='requestTaskDecision' as EnabledOperationId;
 const entry=(clientOperations as Record<string,unknown>)[operation];expect(entry).toMatchObject({method:'POST',path:'/v2/workspaces/{workspace_id}/tasks/{task_id}:request-decision',native:true,runtimeProof:true,idempotency:true,status:200});
 const prepared=prepareNativeOperation('https://hub.example.invalid','ws',operation,input);expect(prepared.request).toEqual(input);
 for(const extra of [{...input,actor:'forged'},{...input,path:{...input.path,workspace_id:'foreign'}},{...input,body:{...input.body,proof:'forged'}},{...input,path:{task_id:''}},{body:input.body}])expect(()=>prepareNativeOperation('https://hub.example.invalid','ws',operation,extra)).toThrow();
 for(const disabled of ['approveApproval','rejectApproval','listApprovals','getApproval'])expect(clientOperations).not.toHaveProperty(disabled);
});
it('decision canonical body enforces the full UTF8 byte boundary without loosening its nested schema',()=>{
 const value=structuredClone(input);value.body.checkpoint.summary='';const fixed=new TextEncoder().encode(JSON.stringify(value.body)).length,remaining=65536-fixed;
 value.body.checkpoint.summary='é'.repeat(Math.floor(remaining/2))+'x'.repeat(remaining%2);expect(new TextEncoder().encode(JSON.stringify(value.body)).length).toBe(65536);
 expect(()=>prepareNativeOperation('https://hub.example.invalid','ws','requestTaskDecision',value)).not.toThrow();value.body.checkpoint.summary+='x';expect(()=>prepareNativeOperation('https://hub.example.invalid','ws','requestTaskDecision',value)).toThrow();
 const extra=structuredClone(input);Object.assign(extra.body.proposal.inputs,{runtime_proof:'forged'});expect(()=>prepareNativeOperation('https://hub.example.invalid','ws','requestTaskDecision',extra)).toThrow();
});
