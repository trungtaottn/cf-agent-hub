import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {readProtectedJson,readSecretFd,writeEncryptedArtifact,readEncryptedArtifact,replaceEncryptedState} from '../../scripts/lib/recovery-io.mjs';
const directories=[];
function temporary(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cfhub-cli-test-'));fs.chmodSync(dir,0o700);directories.push(dir);return dir;}
test.after(()=>{for(const dir of directories)fs.rmSync(dir,{recursive:true,force:true});});
const key={keyId:'snapshot_key',key:crypto.randomBytes(32)};
const context={purpose:'chunk',workspace_id:'ws_example',capture_id:'capture_one',index:0};

test('protected input rejects public modes, links and out-of-bound files',()=>{
 const dir=temporary(),file=path.join(dir,'input.json');fs.writeFileSync(file,'{}',{mode:0o600});
 assert.deepEqual(readProtectedJson(file,32),{});
 fs.chmodSync(file,0o644);assert.throws(()=>readProtectedJson(file,32),/RECOVERY_INPUT_REJECTED/);fs.chmodSync(file,0o600);
 const link=path.join(dir,'link');fs.symlinkSync(file,link);assert.throws(()=>readProtectedJson(link,32),/RECOVERY_INPUT_REJECTED/);
 const hard=path.join(dir,'hard');fs.linkSync(file,hard);assert.throws(()=>readProtectedJson(file,32),/RECOVERY_INPUT_REJECTED/);
});
test('secret descriptors require owner-only regular files and do not consume their cursor',()=>{
 const dir=temporary(),file=path.join(dir,'fd.json');fs.writeFileSync(file,JSON.stringify({key:'synthetic-key-reference'}),{mode:0o600});
 const fd=fs.openSync(file,'r');try{assert.deepEqual(readSecretFd(fd),readSecretFd(fd));assert.throws(()=>readSecretFd(0),/RECOVERY_INPUT_REJECTED/);}finally{fs.closeSync(fd);}
});
test('encrypted chunks are exclusive0600, authenticated, context-bound and never plaintext',()=>{
 const dir=temporary(),file=path.join(dir,'chunk.enc'),plain=Buffer.from('sensitive_row_canary');
 writeEncryptedArtifact(file,plain,key,context);
 assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.readFileSync(file).includes(plain),false);
 assert.deepEqual(readEncryptedArtifact(file,key,context,1024),plain);
 assert.throws(()=>readEncryptedArtifact(file,key,{...context,index:1},1024),/RECOVERY_ARTIFACT_REJECTED/);
 assert.throws(()=>writeEncryptedArtifact(file,Buffer.from('changed'),key,context),/RECOVERY_LOCAL_CONFLICT/);
 const frame=JSON.parse(fs.readFileSync(file,'utf8'));frame.tag=Buffer.alloc(16).toString('base64');fs.writeFileSync(file,JSON.stringify(frame),{mode:0o600});
 assert.throws(()=>readEncryptedArtifact(file,key,context,1024),/RECOVERY_ARTIFACT_REJECTED/);
});
test('durable encrypted state replaces only its known previous bytes',()=>{
 const dir=temporary(),file=path.join(dir,'state.enc'),binding={purpose:'state',workspace_id:'ws_example',capture_id:'capture_one'};
 const first=replaceEncryptedState(file,{pending:{operation_id:'stable_key',body:'original'}},key,binding,null);
 assert.equal(fs.readFileSync(file).includes(Buffer.from('original')),false);
 assert.throws(()=>replaceEncryptedState(file,{pending:null},key,binding,'0'.repeat(64)),/RECOVERY_LOCAL_CONFLICT/);
 const second=replaceEncryptedState(file,{pending:null},key,binding,first);
 assert.notEqual(second,first);assert.deepEqual(JSON.parse(readEncryptedArtifact(file,key,binding,4096)),{pending:null});
});

test('authenticated owned publication orphan is repaired, while unrelated or multiple links remain denied',()=>{
 const dir=temporary(),file=path.join(dir,'recover.enc'),plain=Buffer.from('owned_encrypted_payload');
 writeEncryptedArtifact(file,plain,key,context);
 const orphan=path.join(dir,'.cfhub-recovery-'+ 'a'.repeat(32));fs.linkSync(file,orphan);assert.equal(fs.statSync(file).nlink,2);
 assert.deepEqual(readEncryptedArtifact(file,key,context,1024),plain);assert.equal(fs.existsSync(orphan),false);assert.equal(fs.statSync(file).nlink,1);
 const unrelated=path.join(dir,'unrelated-link');fs.linkSync(file,unrelated);assert.throws(()=>readEncryptedArtifact(file,key,context,1024));assert.equal(fs.existsSync(unrelated),true);fs.unlinkSync(unrelated);
 fs.linkSync(file,orphan);const extra=path.join(dir,'third-link');fs.linkSync(file,extra);assert.throws(()=>readEncryptedArtifact(file,key,context,1024));assert.equal(fs.existsSync(orphan),true);fs.unlinkSync(extra);
 const fd=fs.openSync(file,'r');try{assert.throws(()=>readSecretFd(fd));}finally{fs.closeSync(fd);} // Secret readers never repair links.
 const wrong={...key,key:crypto.randomBytes(32)};assert.throws(()=>readEncryptedArtifact(file,wrong,context,1024));assert.equal(fs.existsSync(orphan),true);
 assert.deepEqual(readEncryptedArtifact(file,key,context,1024),plain);
});
