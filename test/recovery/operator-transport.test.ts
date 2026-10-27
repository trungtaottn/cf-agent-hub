import {describe,it,expect,afterEach} from 'vitest';
import {env,exports} from 'cloudflare:workers';
import {prepareBootstrap} from '../../src/config/bootstrap';
import {canonicalBytes,digestBytes,encodeHeader} from '../../src/recovery/encoding';
import {operatorOperation,parseOperatorPolicy,type OperatorBindings} from '../../src/recovery/operator';
import type {RecoveryCommand} from '../../src/recovery/generated/recovery-validators.js';
import type {RecoveryContext,RecoveryRequest} from '../../src/recovery/protocol';
import type {WorkspaceDO} from '../../src/workspace/workspace-do';
const bindings=env as unknown as OperatorBindings & {SOURCE_WORKSPACE:DurableObjectNamespace<WorkspaceDO>;RECOVERY_TRANSPORT_LEDGER:string;RECOVERY_TRANSPORT_SOURCE_CONFIG:string;RECOVERY_TRANSPORT_SOURCE_BUNDLE:string;};
const workspace='ws_recovery_transport',captureId='capture_transport',url='https://operator.example.invalid/operator/recovery';
afterEach(async()=>{await fetch('https://operator-fixture.example.invalid/control',{method:'POST',body:'normal'});});
async function assertion(claims:Record<string,unknown>={}){return (await fetch('https://operator-fixture.example.invalid/assertion',{method:'POST',body:JSON.stringify({claims})})).text();}
function envelope(operation:RecoveryCommand['operation'],payload:unknown,operationId:string,epoch:number,target=workspace,capture:string|null=captureId){return {operation,workspace_id:target,capture_id:capture,expected_authority_epoch:epoch,operation_id:operationId,reason:'Synthetic operator transport test',payload};}
async function jsonCall(body:unknown,jwt:string){return exports.default.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/json','cf-access-jwt-assertion':jwt},body:JSON.stringify(body)}));}
async function installedSource(){
 const input=await prepareBootstrap(JSON.parse(bindings.RECOVERY_TRANSPORT_SOURCE_CONFIG),JSON.parse(bindings.RECOVERY_TRANSPORT_SOURCE_BUNDLE),workspace),stub=bindings.SOURCE_WORKSPACE.getByName('recovery-source-workspace');
 const installed=await stub.installOperation({principalId:'operator_fixture',workspaceId:workspace,requestId:'request_source_install',operation:'install',expectedEpoch:0,expectedInstallationDigest:null,operationId:'source_install',requestFingerprint:'1'.repeat(64),proofExpiresAt:Date.now()+120000},input);
 expect(installed.ok).toBe(true);return {input,stub};
}
describe('production schema8 authenticated operator recovery remains unavailable',()=>{
 it('does not consume binary bytes before service authorization or expected-epoch admission',async()=>{
  const body=envelope('write-chunk',{index:0,sha256:'a'.repeat(64),byte_size:1},'binary_denied',999),policy=parseOperatorPolicy(bindings.OPERATOR_POLICY);
  for(const jwt of [null,await assertion(),await assertion({common_name:'install-only.access'})]){
   let pulled=0;const stream=new ReadableStream<Uint8Array>({pull(controller){pulled++;controller.enqueue(new Uint8Array([1]));controller.close();}},{highWaterMark:0});
   const request=new Request(url,{method:'POST',headers:{'content-type':'application/octet-stream','X-CFHub-Recovery-Control':encodeHeader(body),...(jwt?{'cf-access-jwt-assertion':jwt}:{})},body:stream});
   await expect(operatorOperation(request,bindings,policy,'request_bytes_gate')).rejects.toThrow();expect(pulled).toBe(0);
  }
 });
 it('pins the deployed recovery integrity key before accepting binary bytes',async()=>{
  const policy=parseOperatorPolicy(bindings.OPERATOR_POLICY);policy.recovery!.integrity_key_id='unapproved_integrity_key';
  const body=envelope('write-chunk',{index:0,sha256:await digestBytes(new Uint8Array([1])),byte_size:1},'wrong_integrity_key',0,'ws_transport_capture','capture_wrong_key');
  let pulled=0;const stream=new ReadableStream<Uint8Array>({pull(controller){pulled++;controller.enqueue(new Uint8Array([1]));controller.close();}},{highWaterMark:0});
  const request=new Request(url,{method:'POST',headers:{'content-type':'application/octet-stream','X-CFHub-Recovery-Control':encodeHeader(body),'cf-access-jwt-assertion':await assertion()},body:stream});
  await expect(operatorOperation(request,bindings,policy,'request_key_gate')).rejects.toMatchObject({status:503});expect(pulled).toBe(0);
 });
 it('rejects malformed headers, unknown fields and JSON write-chunk envelopes',async()=>{
  const jwt=await assertion(),body=envelope('write-chunk',{index:0,sha256:'a'.repeat(64),byte_size:1},'bad_control',2);
  for(const header of [encodeHeader(body)+'=','a'.repeat(8193),encodeHeader({...body,operator_principal_id:'forged'}),encodeHeader({...body,payload:{...body.payload as object,table:'messages'}})]){
   const response=await exports.default.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/octet-stream','cf-access-jwt-assertion':jwt,'X-CFHub-Recovery-Control':header},body:new Uint8Array([1])}));expect(response.status).toBe(400);
  }
  expect((await jsonCall(body,jwt)).status).toBe(400);
 });
 it('rejects capture before progress and retains installed source authority',async()=>{
  const {input,stub}=await installedSource();
  const before=await stub.authoritySnapshot({workspaceId:workspace,objectName:'recovery-source-workspace'});
  const budget={max_rows:10000,max_artifacts:0,max_total_bytes:16777216};
  const body=envelope('capture',{budget},'capture_unavailable',1) as RecoveryRequest;
  const ctx:RecoveryContext={principalId:'operator_fixture',workspaceId:workspace,objectName:'recovery-source-workspace',environmentId:'fixture_source',requestId:'request_unavailable',operationId:body.operation_id,operation:'capture',captureId,expectedEpoch:1,expectedInstallationDigest:input.installationDigest,proofExpiresAt:Date.now()+120000,requestFingerprint:await digestBytes(canonicalBytes(body)),ledgerAnchor:null};
  expect(await stub.recoveryOperation(ctx,body)).toEqual({ok:false,code:'RECOVERY_UNAVAILABLE'});
  expect(await stub.recoveryOperation(ctx,body)).toEqual({ok:false,code:'RECOVERY_UNAVAILABLE'});
  expect(await stub.authoritySnapshot({workspaceId:workspace,objectName:'recovery-source-workspace'})).toEqual(before);
 });
 it('returns unavailable for authenticated schema8 probe and binary read, not a success receipt',async()=>{
  const jwt=await assertion();
  for(const body of [envelope('probe',{},'probe_unavailable',0,workspace,null),envelope('read-chunk',{index:0},'read_unavailable',0)]){
   const response=await jsonCall(body,jwt);expect(response.status).toBe(503);
   expect(response.headers.get('X-CFHub-Recovery-Chunk')).toBeNull();
   expect(response.headers.get('content-type')).not.toBe('application/octet-stream');
  }
 });
});
