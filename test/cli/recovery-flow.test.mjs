import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {runRecovery,verifyCapture} from '../../scripts/lib/recovery-client.mjs';
import {loadRecoveryConfig} from '../../scripts/lib/recovery-config.mjs';
import {readEncryptedArtifact} from '../../scripts/lib/recovery-io.mjs';
import {canonicalBytes} from '../../src/recovery/encoding.ts';
import {RecoveryTransportError} from '../../scripts/lib/recovery-transport.mjs';
import {protocolFixture,sha} from './fixtures.mjs';

test('capture drives finite progress and saves only authenticated encrypted files; verify is local',async()=>{
 const f=await protocolFixture();try{
  const result=await runRecovery('capture',f.input,{transport:f.captureTransport});assert.equal(result.outcome,'complete');assert.equal(result.receipt.status,'complete');assert.equal(result.manifest_sha256,sha(canonicalBytes(f.manifest)));
  const config=loadRecoveryConfig('verify',f.input),checked=await verifyCapture(config);assert.equal(checked.metadata.database_sha256,f.manifest.database.sha256);
  for(const name of fs.readdirSync(f.raw.artifact_directory))assert.equal(fs.readFileSync(path.join(f.raw.artifact_directory,name)).includes(Buffer.from('sensitive_row_canary')),false);
 }finally{f.close();}
});
test('pending request is durable before dispatch and lost response replays exact original intent',async()=>{
 const f=await protocolFixture(),seen=[];let lost=true;
 const transport=async command=>{
  const frame=JSON.parse(fs.readFileSync(f.raw.state_path,'utf8')),state=JSON.parse(readEncryptedArtifact(f.raw.state_path,f.encryption,frame.context,1048576));
  assert.deepEqual(state.pending.command,command);seen.push(Buffer.from(canonicalBytes(command)));
  if(command.operation==='capture'&&lost){lost=false;throw new RecoveryTransportError('RECOVERY_NETWORK_ERROR');}
  return f.captureTransport(command);
 };
 try{
  await assert.rejects(runRecovery('capture',f.input,{transport}),/RECOVERY_OUTCOME_UNCERTAIN/);
  const result=await runRecovery('capture',f.input,{transport});assert.equal(result.outcome,'complete');assert.deepEqual(seen[0],seen[1]);
 }finally{f.close();}
});
test('changed protected input cannot replace an unresolved intent',async()=>{
 const f=await protocolFixture();try{
  await assert.rejects(runRecovery('capture',f.input,{transport:async()=>{throw new RecoveryTransportError('RECOVERY_NETWORK_ERROR');}}),/RECOVERY_OUTCOME_UNCERTAIN/);
  fs.writeFileSync(f.input,JSON.stringify({...f.raw,budget:{...f.raw.budget,max_rows:999}}));
  await assert.rejects(runRecovery('capture',f.input,{transport:async()=>{throw Error('MUST_NOT_FETCH');}}),/RECOVERY_STATE_IDENTITY_MISMATCH/);
 }finally{f.close();}
});
test('lost restore initialization reconciles status at ledger epoch and never replays expected zero',async()=>{
 const f=await protocolFixture();try{
  await runRecovery('capture',f.input,{transport:f.captureTransport});const target=await f.target();let initialized=false,current=f.progress('restore',false,1),written=0;const seen=[];
  const transport=async(command,binary)=>{
   seen.push(command);
   if(command.operation==='restore'){assert.equal(initialized,false);assert.equal(command.expected_authority_epoch,0);initialized=true;throw new RecoveryTransportError('RECOVERY_NETWORK_ERROR');}
   assert.equal(command.expected_authority_epoch,3);
   if(command.operation==='status')return f.reply(current);
   if(command.operation==='write-chunk'){assert.equal(sha(binary),f.manifest.database.chunks[written].sha256);written++;current={...current,step:current.step+1,counts:{rows:f.manifest.database.chunks.slice(0,written).reduce((n,x)=>n+x.row_count,0),chunks:written,bytes:f.chunks.slice(0,written).reduce((n,x)=>n+x.length,0)},phase:written===f.chunks.length?'verify_pages':'awaiting_chunks',next_operation:written===f.chunks.length?'verify':'write-chunk',next_chunk_index:written===f.chunks.length?null:written};return f.reply(current);}
   if(command.operation==='verify')return f.reply(f.progress('restore',true,current.step+1));
   throw Error('UNEXPECTED_OPERATION');
  };
  await assert.rejects(runRecovery('restore',target.input,{transport}),/RECOVERY_OUTCOME_UNCERTAIN/);
  const result=await runRecovery('restore',target.input,{transport});assert.equal(result.outcome,'complete');
  assert.equal(seen.filter(x=>x.operation==='restore').length,1);assert.equal(seen[1].operation,'status');assert.equal(written,f.chunks.length);
 }finally{f.close();}
});

test('never-dispatched restore init gets one exact guarded epoch-zero attempt after canonical status conflict',async()=>{
 const f=await protocolFixture();try{
  await runRecovery('capture',f.input,{transport:f.captureTransport});const target=await f.target(),seen=[];let dropped=true,written=0,current=f.progress('restore',false,1);
  const conflict=()=>{const error=new RecoveryTransportError('RECOVERY_HTTP_DENIED',409,'status_conflict','CONFLICT');error.canonicalError=true;return error;};
  const transport=async(command,binary)=>{
   seen.push(command);
   if(command.operation==='restore'){
    assert.equal(command.expected_authority_epoch,0);
    if(dropped){dropped=false;throw new RecoveryTransportError('RECOVERY_NETWORK_ERROR');}
    assert.deepEqual(command,seen[0]);return f.reply(current);
   }
   if(command.operation==='status'){assert.equal(command.expected_authority_epoch,3);throw conflict();}
   assert.equal(command.expected_authority_epoch,3);
   if(command.operation==='write-chunk'){written++;current={...current,step:current.step+1,counts:{rows:f.manifest.database.chunks.slice(0,written).reduce((n,x)=>n+x.row_count,0),chunks:written,bytes:f.chunks.slice(0,written).reduce((n,x)=>n+x.length,0)},next_operation:written===f.chunks.length?'verify':'write-chunk',next_chunk_index:written===f.chunks.length?null:written,phase:written===f.chunks.length?'verify_pages':'awaiting_chunks'};return f.reply(current);}
   return f.reply(f.progress('restore',true,current.step+1));
  };
  await assert.rejects(runRecovery('restore',target.input,{transport}),/RECOVERY_OUTCOME_UNCERTAIN/);
  assert.equal((await runRecovery('restore',target.input,{transport})).outcome,'complete');
  assert.deepEqual(seen.slice(0,3).map(x=>x.operation),['restore','status','restore']);
 }finally{f.close();}
});
test('unrelated installed epoch denies the guarded init and no further epoch-zero attempts occur',async()=>{
 const f=await protocolFixture();try{
  await runRecovery('capture',f.input,{transport:f.captureTransport});const target=await f.target(),seen=[];let first=true;
  const transport=async command=>{
   seen.push(command);
   if(first){first=false;throw new RecoveryTransportError('RECOVERY_NETWORK_ERROR');}
   const error=new RecoveryTransportError('RECOVERY_HTTP_DENIED',409,'conflict','CONFLICT');error.canonicalError=true;throw error;
  };
  await assert.rejects(runRecovery('restore',target.input,{transport}),/RECOVERY_OUTCOME_UNCERTAIN/);
  await assert.rejects(runRecovery('restore',target.input,{transport}),error=>error.status===409);
  await assert.rejects(runRecovery('restore',target.input,{transport}),/RECOVERY_INIT_RECONCILIATION_REQUIRED/);
  assert.equal(seen.filter(x=>x.operation==='restore').length,2);assert.equal(seen.filter(x=>x.operation==='write-chunk').length,0);
 }finally{f.close();}
});
test('an unvalidated generic status denial never enables the guarded init',async()=>{
 const f=await protocolFixture();try{
  await runRecovery('capture',f.input,{transport:f.captureTransport});const target=await f.target();let calls=0;
  const transport=async()=>{calls++;if(calls===1)throw new RecoveryTransportError('RECOVERY_NETWORK_ERROR');throw new RecoveryTransportError('RECOVERY_HTTP_DENIED',409,'opaque','CONFLICT');};
  await assert.rejects(runRecovery('restore',target.input,{transport}),/RECOVERY_OUTCOME_UNCERTAIN/);
  await assert.rejects(runRecovery('restore',target.input,{transport}),error=>error.status===409);assert.equal(calls,2);
 }finally{f.close();}
});

test('configuration, state and external authoritative inputs cannot occupy output artifact namespace',async()=>{
 const f=await protocolFixture();try{
  for(const name of ['chunk-0000.enc','capture_one.request.enc','capture_one-a1.response.enc','capture-capture_one-s1.receipt.enc']){
   fs.writeFileSync(f.input,JSON.stringify({...f.raw,state_path:path.join(f.raw.artifact_directory,name)}));
   await assert.rejects(runRecovery('capture',f.input,{transport:async()=>{throw Error('MUST_NOT_DISPATCH');}}),/RECOVERY_INPUT_REJECTED/);
  }
  const inside=path.join(f.raw.artifact_directory,'manifest.enc');fs.writeFileSync(inside,JSON.stringify(f.raw),{mode:0o600});
  await assert.rejects(runRecovery('capture',inside,{transport:async()=>{throw Error('MUST_NOT_DISPATCH');}}),/RECOVERY_INPUT_REJECTED/);
 }finally{f.close();}
});
