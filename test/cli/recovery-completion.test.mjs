import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {runRecovery} from '../../scripts/lib/recovery-client.mjs';
import {readEncryptedArtifact} from '../../scripts/lib/recovery-io.mjs';
import {protocolFixture,sha,receipt} from './fixtures.mjs';
const stateAt=f=>{const frame=JSON.parse(fs.readFileSync(f.raw.state_path,'utf8'));return JSON.parse(readEncryptedArtifact(f.raw.state_path,f.encryption,frame.context,1048576));};
test('acknowledged terminal control is completed from its exact encrypted response after restart',async()=>{
 const f=await protocolFixture(),rename=fs.renameSync;try{
  fs.mkdirSync(f.raw.artifact_directory,{mode:0o700});
  const evidence=path.join(f.directory,'receiver.json');fs.writeFileSync(evidence,'{"observed":"permanent failure"}',{mode:0o600});
  const raw={...f.raw,operation_id:'resolve_one',state_path:path.join(f.directory,'resolve-state.enc'),resolution:{delivery_id:'delivery_one',disposition:'failed_without_redrive',evidence_path:evidence,evidence_sha256:sha(fs.readFileSync(evidence))}};
  f.raw=raw;fs.writeFileSync(f.input,JSON.stringify(raw));let calls=0,stopped=false;
  fs.renameSync=(from,to)=>{rename(from,to);if(to===raw.state_path&&!stopped){const state=stateAt(f);if(state.pending===null&&state.sequence===1&&state.control_result){stopped=true;throw Error('SIMULATED_ACK_STOP');}}};
  await assert.rejects(runRecovery('resolve-delivery',f.input,{transport:async()=>{calls++;return f.reply(receipt());}}),/SIMULATED_ACK_STOP/);
  fs.renameSync=rename;
  const result=await runRecovery('resolve-delivery',f.input,{transport:async()=>{calls++;throw Error('MUST_NOT_DISPATCH');}});
  assert.equal(result.outcome,'complete');assert.equal(calls,1);
 }finally{fs.renameSync=rename;f.close();}
});
test('receipt publication retry uses the exact finish intent timestamp saved before publication',async()=>{
 const f=await protocolFixture(),link=fs.linkSync;try{
  await runRecovery('capture',f.input,{transport:f.captureTransport});
  const raw={...f.raw,operation_id:'verify_one',state_path:path.join(f.directory,'verify-state.enc')};f.raw=raw;fs.writeFileSync(f.input,JSON.stringify(raw));let published;
  fs.linkSync=(from,to)=>{link(from,to);if(to.includes('verify-verify_one-')&&to.endsWith('.receipt.enc')){published=to;throw Error('SIMULATED_FINISH_STOP');}};
  await assert.rejects(runRecovery('verify',f.input),/SIMULATED_FINISH_STOP/);fs.linkSync=link;
  const frame=JSON.parse(fs.readFileSync(published,'utf8')),original=JSON.parse(readEncryptedArtifact(published,f.encryption,frame.context,1048576));
  const result=await runRecovery('verify',f.input);assert.equal(result.completed_at,original.completed_at);assert.equal(result.outcome,'verified_local');
 }finally{fs.linkSync=link;f.close();}
});
