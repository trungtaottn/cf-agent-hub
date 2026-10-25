import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {protocolFixture} from './fixtures.mjs';
import {runRecovery} from '../../scripts/lib/recovery-client.mjs';
const script=new URL('../../scripts/recover-workspace.mjs',import.meta.url).pathname;
test('entrypoint exposes exactly the finite public workflow and rejects secret-like flags without reflection',()=>{
 const help=spawnSync(process.execPath,[script,'--help'],{encoding:'utf8'});assert.equal(help.status,0);assert.match(help.stdout,/capture.*restore.*verify.*probe.*resolve-delivery.*retire.*resume.*status/s);assert.doesNotMatch(help.stdout,/install/);
 const denied=spawnSync(process.execPath,[script,'capture','--token','SYNTHETIC_CANARY_MUST_NOT_PRINT'],{encoding:'utf8'});assert.equal(denied.status,1);assert.equal(denied.stdout.includes('SYNTHETIC_CANARY'),false);assert.equal(denied.stderr.includes('SYNTHETIC_CANARY'),false);assert.equal(JSON.parse(denied.stdout).error.code,'RECOVERY_INPUT_REJECTED');
});
test('local verify subprocess consumes inherited protected descriptors and prints no keys or row data',async()=>{
 const f=await protocolFixture();try{
  await runRecovery('capture',f.input,{transport:f.captureTransport});
  const raw={...f.raw,operation_id:'verify_one',state_path:path.join(f.directory,'verify-state.enc'),integrity:{key_id:'integrity_key',key_fd:3},encryption:{key_id:'snapshot_key',key_fd:4}};delete raw.service;
  const input=path.join(f.directory,'verify.json');fs.writeFileSync(input,JSON.stringify(raw),{mode:0o600});
  const result=spawnSync(process.execPath,[script,'verify','--input',input],{encoding:'utf8',stdio:['ignore','pipe','pipe',f.raw.integrity.key_fd,f.raw.encryption.key_fd]});
  assert.equal(result.status,0,result.stderr);const output=JSON.parse(result.stdout);assert.equal(output.outcome,'verified_local');assert.equal(output.receipt,null);assert.equal(output.response_sha256,null);
  assert.equal(result.stdout.includes(f.integrity.key),false);assert.equal(result.stdout.includes('sensitive_row_canary'),false);assert.equal(result.stdout.includes(f.directory),false);assert.equal(result.stdout.includes('synthetic_service_secret'),false);
 }finally{f.close();}
});
