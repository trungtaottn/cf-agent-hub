import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRecoveryTransport} from '../../scripts/lib/recovery-transport.mjs';
const command={operation:'probe',workspace_id:'ws_example',capture_id:null,expected_authority_epoch:1,operation_id:'probe_one',reason:'Synthetic bounded fixture',payload:{}};
function transport(value,status=409,type='application/json'){
 return createRecoveryTransport({origin:'https://operator.example.invalid',service:{client_id:'synthetic_id',client_secret:'synthetic_secret'}},{requestImpl(_url,_options,callback){const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=status;response.headers={'content-type':type};response.rawHeaders=[];response.destroy=()=>{};callback(response);response.emit('data',Buffer.from(JSON.stringify(value)));response.emit('end');});return req;}});
}
for(const id of ['synthetic_secret','\nINJECTED','x'.repeat(4096),'123e4567-e89b-42d3-a456-426614174000'])test('remote error request ID is never reflected: '+JSON.stringify(id.slice(0,20)),async()=>{
 await assert.rejects(transport({error:{code:'CONFLICT',message:'Operator request denied',retryable:false,request_id:id}})(command),error=>{assert.equal(error.requestId,null);return true;});
});
test('malformed remote error ID cannot become canonical reconciliation evidence',async()=>{
 await assert.rejects(transport({error:{code:'CONFLICT',message:'Operator request denied',retryable:false,request_id:'\nINJECTED'}})(command),error=>{assert.equal(error.canonicalError,false);assert.equal(error.serverCode,null);return true;});
});
import {RecoverySession,verifyCliManifest,recoveryJobId} from '../../scripts/lib/recovery-client.mjs';
import {canonicalBytes} from '../../src/recovery/encoding.ts';
import crypto from 'node:crypto';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
test('current16 restore progress uses retained authenticated manifest, not repeated manifest',async()=>{
 const session=Object.create(RecoverySession.prototype);
 session.config={workspaceId:'ws_example',captureId:'capture_one',command:'restore'};session.targetEpoch=2;
 session.manifest={format_version:2,checkpoint:{contract_revision:'0.2',schema_version:16}};session.state={progress:null};
 const command={operation:'restore',expected_authority_epoch:0};
 const data={job_id:recoveryJobId('ws_example','capture_one','restore'),capture_id:'capture_one',workspace_id:'ws_example',operation:'restore',authority_epoch:2,state:'running',phase:'awaiting_chunks',step:0,counts:{rows:0,chunks:0,bytes:0},pending_operation_id:null,next_operation:'write-chunk',next_chunk_index:0,receipt:null,manifest:null};
 const raw=canonicalBytes({request_id:'req',data});
 await session.validate(command,{status:200,requestId:'req',data,raw,sha256:sha(raw)});
});
import {decodeCliChunk,validateCliCommand} from '../../scripts/lib/recovery-client.mjs';
import {encodeCurrentChunk} from '../../src/recovery/encoding.ts';
test('current decoder supports aggregate and exact reference paths and rejects schema mixing',()=>{
 const value={format_version:2,schema_version:16,capture_id:'capture_one',index:0,table:'schema_migrations',columns:['version','applied_at'],rows:[[1,1]]};
 const bytes=encodeCurrentChunk(value),manifest={format_version:2,checkpoint:{schema_version:16}};
 assert.deepEqual(decodeCliChunk(bytes,manifest),value);
 assert.deepEqual(decodeCliChunk(bytes,manifest,{capture_id:'capture_one',index:0,table:'schema_migrations',row_count:1,byte_size:bytes.length}),value);
 assert.throws(()=>decodeCliChunk(encodeCurrentChunk({...value,schema_version:15}),manifest));
 assert.throws(()=>decodeCliChunk(bytes,{format_version:1}));
});
import {registryForSchema} from '../../src/recovery/table-registry.ts';
import {TABLE_REGISTRY as V1_TABLE_REGISTRY} from '../../src/recovery/table-registry-v1.ts';
import {signRecord} from '../../src/recovery/manifest.ts';
async function currentManifest(schema=16){
 const tables=['schema_migrations','workspace_metadata','maintenance_state'];
 const chunks=tables.map((table,index)=>({index,table,sha256:'a'.repeat(64),byte_size:1,row_count:index===0?schema:1}));
 const integrity={keyId:'synthetic_key',key:Buffer.alloc(32,1).toString('base64')};
 const value={format_version:2,capture_id:'capture_one',workspace_id:'ws_example',environment_id:'source_env',started_at:'2026-10-25T00:00:00Z',ended_at:'2026-10-25T00:01:00Z',checkpoint:{barrier_id:'barrier_one',event_sequence:0,schema_version:schema,contract_revision:'0.2',authority_epoch:1},release:{revision:'fixture_revision',worker_version:'fixture_worker',binding_ids:['workspace_binding','recovery_bucket'],catalog_mapping:{workspace_id:'ws_example',object_name:'source_object'}},database:{sha256:'a'.repeat(64),byte_size:3,table_counts:Object.fromEntries(registryForSchema(schema).map(t=>[t.name,t.name==='schema_migrations'?schema:tables.includes(t.name)?1:0])),chunks},artifacts:[],unfinished_artifact_ids:[],auth:{key_id:'synthetic_key',algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}};
 return {manifest:await signRecord(value,integrity),integrity};
}
test('current manifest dispatcher authenticates17 and retained15/16 and rejects forged or unsupported',async()=>{
 for(const schema of [15,16,17]){const{manifest,integrity}=await currentManifest(schema);assert.deepEqual(await verifyCliManifest(manifest,integrity),manifest);await assert.rejects(verifyCliManifest({...manifest,environment_id:'forged'},integrity));await assert.rejects(verifyCliManifest({...manifest,checkpoint:{...manifest.checkpoint,schema_version:18}},integrity));}
});
import fs from 'node:fs';
import {retainedControlLimit,supportedControlManifest} from '../../scripts/lib/recovery-client.mjs';
import {assertRecoveryEnvelope,RESUME_ENVELOPE_LIMIT} from '../../src/recovery/operator-envelope.ts';
const current={format_version:2,checkpoint:{contract_revision:'0.2',schema_version:16}};
test('retained resume bound follows authenticated manifest identity and legacy stays64KiB',()=>{
 assert.equal(retainedControlLimit('resume',current),203479);
 for(const m of [null,{format_version:1},{...current,checkpoint:{...current.checkpoint,schema_version:15}}])assert.equal(retainedControlLimit('resume',m),65536);
 assert.equal(retainedControlLimit('retire',current),65536);
 assert.throws(()=>supportedControlManifest({...current,checkpoint:{...current.checkpoint,schema_version:15}}),/RECOVERY_FORMAT_UNAVAILABLE/);
});
test('large valid resume envelope needs current manifest and exact component bounds on live and retained paths',()=>{
 const value=JSON.parse(fs.readFileSync(new URL('../../examples/recovery/r1-commands.json',import.meta.url))).commands.find(c=>c.operation==='resume');
 const ledger=value.payload.ledger;
 // Many schema-valid static participants make the signed record approach its independent64KiB ceiling.
 const template=ledger.config.static_participants[0];let n=0;
 while(canonicalBytes(ledger).length<65000)ledger.config.static_participants.push({...template,agent_id:'synthetic_'+(++n),display_name:'x'.repeat(120)});
 value.reason='\0'.repeat(1024);
 assert.ok(canonicalBytes(ledger).length<=65536);assert.ok(canonicalBytes(value).length>65536);
 assert.equal(validateCliCommand(value,current),value);
 assert.throws(()=>validateCliCommand(value,null),/RECOVERY_INPUT_REJECTED/);
 const retained=JSON.parse(Buffer.from(canonicalBytes(value)).toString());assert.deepEqual(validateCliCommand(retained,current),value);
 assert.doesNotThrow(()=>assertRecoveryEnvelope(value,{current16Job:true,rawBytes:RESUME_ENVELOPE_LIMIT}));
 assert.throws(()=>assertRecoveryEnvelope(value,{current16Job:true,rawBytes:RESUME_ENVELOPE_LIMIT+1}));
});
import {bindSessionManifest} from '../../scripts/lib/recovery-client.mjs';
test('retained manifest identity cannot be replaced between restore/control continuations',()=>{
 const session={state:{manifest_sha256:null},save(){}};
 bindSessionManifest(session,{...current,capture_id:'capture_one'});
 assert.doesNotThrow(()=>bindSessionManifest(session,{...current,capture_id:'capture_one'}));
 assert.throws(()=>bindSessionManifest(session,{...current,capture_id:'changed'}),/RECOVERY_MANIFEST_MISMATCH/);
});
test('progress rejects changed epoch, job identity, regression and unrequested current manifest',async()=>{
 const s=Object.create(RecoverySession.prototype);s.config={workspaceId:'ws_example',captureId:'capture_one',command:'restore'};s.targetEpoch=2;s.manifest=current;s.state={progress:{state:'running',step:2,counts:{rows:1,chunks:1,bytes:1}}};
 const valid={job_id:recoveryJobId('ws_example','capture_one','restore'),capture_id:'capture_one',workspace_id:'ws_example',operation:'restore',authority_epoch:2,state:'running',phase:'verify_pages',step:2,counts:{rows:1,chunks:1,bytes:1},pending_operation_id:null,next_operation:'verify',next_chunk_index:null,receipt:null,manifest:null};
 const check=data=>{const raw=canonicalBytes({request_id:'req',data});return s.validate({operation:'verify',expected_authority_epoch:2},{status:200,requestId:'req',data,raw,sha256:sha(raw)});};
 await check(valid);
 for(const changes of [{authority_epoch:3},{job_id:'wrong'},{step:1},{counts:{rows:0,chunks:1,bytes:1}},{manifest:{}}])await assert.rejects(check({...valid,...changes}));
});
test('successful responses reject reflected service secrets and invalid request IDs',async()=>{
 const data={id:'probe_one',workspace_id:'ws_example',config_epoch:1,schema_version:7,checked_at:'2026-10-25T00:00:00Z',checks:[{name:'rollback',passed:true,code:'OK'}]};
 for(const id of ['synthetic_secret','synthetic_id','req\n','x'.repeat(129)])await assert.rejects(transport({request_id:id,data},200)(command),e=>e.code==='RECOVERY_INVALID_RESPONSE');
});
test('V1 manifest authentication and decoder stay compatible',async()=>{
 const source=(await currentManifest(16)).manifest;source.format_version=1;source.checkpoint.schema_version=7;source.checkpoint.contract_revision='0.1';source.database.chunks[0].row_count=7;
 source.database.table_counts=Object.fromEntries(V1_TABLE_REGISTRY.map(t=>[t.name,t.name==='schema_migrations'?7:['workspace_metadata','maintenance_state'].includes(t.name)?1:0]));
 const integrity={keyId:source.auth.key_id,key:Buffer.alloc(32,1).toString('base64')};
 const manifest=await signRecord(source,integrity);
 assert.deepEqual(await verifyCliManifest(manifest,integrity),manifest);
 const value={format_version:1,capture_id:'capture_one',index:0,table:'schema_migrations',columns:['version','applied_at'],rows:[[1,1]]};
 assert.deepEqual(decodeCliChunk(canonicalBytes(value),manifest),value);
 assert.doesNotThrow(()=>supportedControlManifest(manifest));
});

test('unchanged authenticated manifest binding does not rewrite complete evidence',async()=>{const {manifest}=await currentManifest(16);const digest=crypto.createHash('sha256').update(canonicalBytes(manifest)).digest('hex');let saves=0;const session={state:{manifest_sha256:digest,complete:true},save(){saves++;}};bindSessionManifest(session,manifest);assert.equal(saves,0);assert.equal(session.manifest,manifest);});
