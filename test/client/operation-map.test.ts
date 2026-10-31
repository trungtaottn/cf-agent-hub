import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const spec=JSON.parse(readFileSync('spec/openapi.json','utf8'));
const operations=Object.entries(spec.paths).flatMap(([path,item]:[string,any])=>Object.entries(item).filter(([,op]:[string,any])=>op.operationId).map(([method,op]:[string,any])=>({path,method,...op})));
const disabled=['requestTaskDecision','listApprovals','getApproval','approveApproval','rejectApproval'];
describe('generated workspace operation contract',()=>{
 it('has one reviewed inventory, covering every OpenAPI operation explicitly',async()=>{
  const inventory=JSON.parse(readFileSync('src/contracts/client-operations.json','utf8'));
  expect([...inventory.supported,...Object.keys(inventory.excluded)].sort()).toEqual(operations.map(o=>o.operationId).sort());
  expect(inventory.supported).toHaveLength(56);
  for(const id of disabled)expect(inventory.excluded[id]).toBe('R3 unavailable');
 });
 it('derives every supported method, path, native lane and proof exactly from OpenAPI',async()=>{
  const {clientOperations}=await import('../../src/http/generated/client-operations');
  expect(Object.keys(clientOperations)).toHaveLength(56);
  let native=0,proof=0;
  for(const [id,contract] of Object.entries(clientOperations)){
   const op=operations.find(o=>o.operationId===id)!;
   expect(contract.method).toBe(op.method.toUpperCase());expect(contract.path).toBe(op.path);
   const scheme=(op.security??[]).find((s:any)=>Object.hasOwn(s,'NativeBearer'));
   expect(contract.native).toBe(Boolean(scheme));expect(contract.runtimeProof).toBe(Boolean(scheme&&Object.hasOwn(scheme,'RuntimeProof')));
   native+=Number(contract.native);proof+=Number(contract.runtimeProof);
  }
  expect(native).toBe(33);expect(proof).toBe(8);
  for(const id of ['reconcileMessageCreation','reconcileTaskCreation'] as const)expect(clientOperations[id]).toMatchObject({native:false,runtimeProof:false,method:'POST',status:200});
  for(const id of disabled)expect(Object.hasOwn(clientOperations,id)).toBe(false);
 });
});
it('keeps status, idempotency, body kind and canonical pagination metadata in parity',async()=>{
 const {clientOperations}=await import('../../src/http/generated/client-operations');
 const resolve=(value:any):any=>{if(!value?.$ref)return value;return value.$ref.split('/').slice(1).reduce((p:any,k:string)=>p[k],spec);};
 for(const [id,c]of Object.entries(clientOperations)){
  const o=operations.find(o=>o.operationId===id)!,parameters=[...(spec.paths[o.path].parameters??[]),...(o.parameters??[])].map(resolve);
  const status=Object.keys(o.responses).find(k=>k.startsWith('2'))!,content=resolve(o.responses[status]).content,response=resolve(content['application/json']?.schema);
  expect(c.status).toBe(Number(status));expect(c.idempotency).toBe(parameters.some((p:any)=>p.in==='header'&&p.name.toLowerCase()==='idempotency-key'));
  expect(c.upload).toBe(Boolean(o.requestBody?.content['application/octet-stream']));expect(c.download).toBe(Boolean(content['application/octet-stream']));expect(c.page).toBe(Boolean(response?.properties.page));
  expect(c.invocationMode).toBe(id==='createRuntime'?'enrollment':'ordinary');
  if(parameters.some((p:any)=>p.in==='path'&&p.name!=='workspace_id'))expect(c.validateRequest({})).toBe(false);
  if(o.requestBody?.content['application/json'])expect(c.validateRequest({body:{unexpected:'not canonical'}})).toBe(false);
 }
});
it('generates raw and normalized search byte bounds from canonical annotations',async()=>{
 const {clientOperations}=await import('../../src/http/generated/client-operations');
 expect(clientOperations.searchWorkspace.byteRules).toEqual(expect.arrayContaining([{path:['query','q'],encoding:'utf8',maxBytes:2048},{path:['query','q'],encoding:'nfc-utf8',maxBytes:2048}]));
 const {nativeFixture}=await import('./native-helpers');const f=nativeFixture();expect(await f.client.call('searchWorkspace',{query:{q:'\u0344'.repeat(600)}})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(f.acquire).not.toHaveBeenCalled();
});
