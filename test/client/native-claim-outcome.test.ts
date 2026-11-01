import {it,expect} from 'vitest';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {clientOperations} from '../../src/http/generated/client-operations';
import {prepareNativeOperation} from '../../packages/client/src/native-request';
import type {EnabledOperationId} from '../../packages/client/src/types';
const operation='lookupTaskClaimOutcome' as EnabledOperationId;
const input={path:{task_id:'task_a'},body:{expected_version:2,runtime_instance_id:'runtime_a'}};
it('claim outcome is a separate protected lookup operation with exact original request schema',()=>{
 expect(clientOperations).toHaveProperty(operation);
 expect((clientOperations as Record<string,unknown>)[operation]).toMatchObject({method:'POST',path:'/v2/workspaces/{workspace_id}/tasks/{task_id}:claim-outcome',native:true,runtimeProof:true,idempotency:true,status:200});
 const prepared=prepareNativeOperation('https://hub.example.invalid','ws',operation,input);expect(prepared.request).toEqual(input);
 for(const extra of [{...input,execute:true},{...input,path:{...input.path,workspace_id:'foreign'}},{...input,body:{...input.body,proof:'forged'}},{...input,path:{task_id:''}},{body:input.body}])expect(()=>prepareNativeOperation('https://hub.example.invalid','ws',operation,extra)).toThrow();
});
it('claim lookup body uses the full canonical UTF8 limit',()=>{
 const value=structuredClone(input);value.body.runtime_instance_id='';const remaining=65536-new TextEncoder().encode(JSON.stringify(value.body)).length;
 value.body.runtime_instance_id='é'.repeat(Math.floor(remaining/2))+'x'.repeat(remaining%2);expect(new TextEncoder().encode(JSON.stringify(value.body)).length).toBe(65536);
 expect(()=>prepareNativeOperation('https://hub.example.invalid','ws',operation,value)).not.toThrow();value.body.runtime_instance_id+='x';expect(()=>prepareNativeOperation('https://hub.example.invalid','ws',operation,value)).toThrow();
});
it('generator refuses a claim lookup alias when any canonical wrapper differs',()=>{
 const spec=JSON.parse(readFileSync('spec/openapi.json','utf8')),path='/v2/workspaces/{workspace_id}/tasks/{task_id}:claim-outcome';expect(spec.paths).toHaveProperty(path);
 for(const field of ['path','body']){
  const copy=structuredClone(spec);
  if(field==='path')copy.paths[path].parameters.find((p:{name:string})=>p.name==='task_id').schema.minLength=2;
  else copy.paths[path].post.requestBody.content['application/json'].schema={type:'object',additionalProperties:false,properties:{expected_version:{type:'integer'}}};
  const directory=mkdtempSync(join(tmpdir(),'claim-alias-'));
  try{
   mkdirSync(join(directory,'spec'));mkdirSync(join(directory,'src/contracts'),{recursive:true});
   writeFileSync(join(directory,'spec/openapi.json'),JSON.stringify(copy));writeFileSync(join(directory,'src/contracts/client-operations.json'),readFileSync('src/contracts/client-operations.json'));
   const result=spawnSync(process.execPath,[resolve('scripts/generate-auth-contract.mjs')],{cwd:directory,encoding:'utf8',timeout:10000,maxBuffer:65536});
   expect(result.status).not.toBe(0);expect(result.stderr).toContain('Claim outcome wrapper differs from claimTask');
  }finally{rmSync(directory,{recursive:true,force:true});}
 }
});
