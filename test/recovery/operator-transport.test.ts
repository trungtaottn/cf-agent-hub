import {describe,it,expect,afterEach} from 'vitest';
import {env,exports} from 'cloudflare:workers';
import {canonicalJson,prepareBootstrap,sha256} from '../../src/config/bootstrap';
import {canonicalBytes,digestBytes,encodeHeader,decodeHeader} from '../../src/recovery/encoding';
import {operatorOperation,parseOperatorPolicy,type OperatorBindings} from '../../src/recovery/operator';
import {validateRecoveryJobProgress,type RecoveryManifest,type CurrentLedger,type RecoveryCommand,type RecoveryJobProgress} from '../../src/recovery/generated/recovery-validators.js';
import type {RecoveryContext,RecoveryRequest} from '../../src/recovery/protocol';
import type {WorkspaceDO} from '../../src/workspace/workspace-do';
const bindings=env as unknown as OperatorBindings & {SOURCE_WORKSPACE:DurableObjectNamespace<WorkspaceDO>;RECOVERY_TRANSPORT_LEDGER:string;RECOVERY_TRANSPORT_SOURCE_CONFIG:string;RECOVERY_TRANSPORT_SOURCE_BUNDLE:string;};
const workspace='ws_recovery_transport',captureId='capture_transport',url='https://operator.example.invalid/operator/recovery';
afterEach(async()=>{await fetch('https://operator-fixture.example.invalid/control',{method:'POST',body:'normal'});});
async function assertion(claims:Record<string,unknown>={}){return (await fetch('https://operator-fixture.example.invalid/assertion',{method:'POST',body:JSON.stringify({claims})})).text();}
function envelope(operation:RecoveryCommand['operation'],payload:unknown,operationId:string,epoch:number,target=workspace,capture:string|null=captureId){return {operation,workspace_id:target,capture_id:capture,expected_authority_epoch:epoch,operation_id:operationId,reason:'Synthetic operator transport test',payload};}
async function jsonCall(body:unknown,jwt:string){return exports.default.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/json','cf-access-jwt-assertion':jwt},body:JSON.stringify(body)}));}
async function progressOf(response:Response):Promise<RecoveryJobProgress>{expect(response.status).toBe(200);const body=await response.json() as {data:unknown};if(!validateRecoveryJobProgress(body.data))throw Error('Invalid recovery response');return body.data;}
async function sourceCall(stub:DurableObjectStub<WorkspaceDO>,body:RecoveryRequest,digest:string){
 const ctx:RecoveryContext={principalId:'operator_fixture',workspaceId:workspace,objectName:'recovery-source-workspace',environmentId:'fixture_source',requestId:'request_'+crypto.randomUUID(),operationId:body.operation_id,operation:body.operation,captureId:body.capture_id,expectedEpoch:body.expected_authority_epoch,expectedInstallationDigest:digest,proofExpiresAt:Date.now()+120000,requestFingerprint:await digestBytes(canonicalBytes(body)),ledgerAnchor:null};
 const result=await stub.recoveryOperation(ctx,body);if(!result.ok)throw Error('Source RPC failed: '+result.code);return result;
}
async function capturedSource(){
 const input=await prepareBootstrap(JSON.parse(bindings.RECOVERY_TRANSPORT_SOURCE_CONFIG),JSON.parse(bindings.RECOVERY_TRANSPORT_SOURCE_BUNDLE),workspace),stub=bindings.SOURCE_WORKSPACE.getByName('recovery-source-workspace');
 const installed=await stub.installOperation({principalId:'operator_fixture',workspaceId:workspace,requestId:'request_source_install',operation:'install',expectedEpoch:0,expectedInstallationDigest:null,operationId:'source_install',requestFingerprint:'1'.repeat(64),proofExpiresAt:Date.now()+120000},input);if(!installed.ok)throw Error('Source install failed');
 const budget={max_rows:10000,max_artifacts:0,max_total_bytes:16777216};let data:RecoveryJobProgress|undefined;
 for(let step=0;step<100;step++){const result=await sourceCall(stub,envelope('capture',{budget},'source_capture_'+step,1) as RecoveryRequest,input.installationDigest);if(!('data' in result)||!validateRecoveryJobProgress(result.data))throw Error('Source capture response failed');data=result.data;if(data.state!=='running')break;}
 if(data?.state!=='complete'||!data.manifest)throw Error('Source capture incomplete');const manifest=data.manifest,chunks=[];
 for(const entry of manifest.database.chunks){const result=await sourceCall(stub,envelope('read-chunk',{index:entry.index},'source_read_'+entry.index,1) as RecoveryRequest,input.installationDigest);if(!('chunk' in result))throw Error('Source chunk unavailable');chunks.push(result.chunk);}
 return {manifest,chunks};
}
describe('R1 authenticated operator binary transport',()=>{
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
 it('restores real source chunks with exact binary bytes, durable replay, status reconciliation and actual probe',async()=>{
  const {manifest,chunks}=await capturedSource(),ledger=JSON.parse(bindings.RECOVERY_TRANSPORT_LEDGER) as CurrentLedger,jwt=await assertion();
  const restore=envelope('restore',{manifest,ledger},'restore_initial',0),initial=await progressOf(await jsonCall(restore,jwt));expect(initial.authority_epoch).toBe(2);
  expect((await jsonCall(restore,jwt)).status).toBe(409);
  const status=await progressOf(await jsonCall(envelope('status',{job_id:initial.job_id},'status_target',2),jwt));expect(status.job_id).toBe(initial.job_id);expect(status.phase).toBe('awaiting_chunks');
  for(const chunk of chunks){const {index,sha256,byte_size}=chunk.metadata,control=envelope('write-chunk',{index,sha256,byte_size},'write_chunk_'+index,2);
   const upload=()=>exports.default.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/octet-stream','cf-access-jwt-assertion':jwt,'X-CFHub-Recovery-Control':encodeHeader(control)},body:chunk.bytes}));
   if(index===0){const bad=new Uint8Array(chunk.bytes).slice();bad[bad.length-1]^=1;expect((await exports.default.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/octet-stream','cf-access-jwt-assertion':jwt,'X-CFHub-Recovery-Control':encodeHeader(control)},body:bad}))).status).toBe(400);}
   const accepted=await progressOf(await upload());expect(accepted.counts.chunks).toBe(index+1);if(index===0)expect(await progressOf(await upload())).toEqual(accepted);
  }
  let verified:RecoveryJobProgress|undefined;for(let step=0;step<100;step++){verified=await progressOf(await jsonCall(envelope('verify',{manifest},'verify_step_'+step,2),jwt));if(verified.state!=='running')break;}
  expect(verified?.state).toBe('complete');expect(verified?.receipt?.status).toBe('complete');
  const probe=await jsonCall(envelope('probe',{},'target_probe',2,workspace,null),jwt);expect(probe.status).toBe(200);const data=(await probe.json() as {data:{checks:Array<{passed:boolean}>}}).data;expect(data.checks.every(c=>c.passed)).toBe(true);
 },60000);
 it('serves binary read-chunk with the exact closed integrity header and rejects stale reads',async()=>{
  const target='ws_transport_capture',jwt=await assertion(),config=JSON.parse(bindings.RECOVERY_TRANSPORT_SOURCE_CONFIG.replaceAll(workspace,target)),bundle=JSON.parse(bindings.RECOVERY_TRANSPORT_SOURCE_BUNDLE.replaceAll(workspace,target));config.workspace_catalog[0].object_name='operator-fixture-'+target;bundle.config_digest=await sha256(canonicalJson(config));
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(bindings.BOOTSTRAP_INTEGRITY_KEY),c=>c.charCodeAt(0)),{name:'HMAC',hash:'SHA-256'},false,['sign']);const {tag,...auth}=bundle.auth;bundle.auth.tag=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,canonicalBytes({...bundle,auth}).buffer)),b=>b.toString(16).padStart(2,'0')).join('');
  expect((await jsonCall(envelope('install',{config,verification_bundle:bundle},'install_read',0,target,null),jwt)).status).toBe(200);
  const budget={max_rows:10000,max_artifacts:0,max_total_bytes:16777216};let completed:RecoveryJobProgress|undefined;
  for(let step=0;step<100;step++){completed=await progressOf(await jsonCall(envelope('capture',{budget},'read_capture_'+step,1,target,'capture_read'),jwt));if(completed.state!=='running')break;}
  expect(completed?.state).toBe('complete');const entry=completed!.manifest!.database.chunks[0];
  const response=await jsonCall(envelope('read-chunk',{index:0},'read_binary',1,target,'capture_read'),jwt);expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe('application/octet-stream');
  expect(decodeHeader(response.headers.get('X-CFHub-Recovery-Chunk'))).toEqual({capture_id:'capture_read',index:0,sha256:entry.sha256,byte_size:entry.byte_size});const bytes=new Uint8Array(await response.arrayBuffer());expect(bytes.length).toBe(entry.byte_size);expect(await digestBytes(bytes)).toBe(entry.sha256);
  expect((await jsonCall(envelope('read-chunk',{index:0},'stale_read',0,target,'capture_read'),jwt)).status).toBe(409);
 },60000);
});
