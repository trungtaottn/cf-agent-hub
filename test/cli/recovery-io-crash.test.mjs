import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {canonicalBytes} from '../../src/recovery/encoding.ts';
import {readSecretFd,readEncryptedArtifact,writeEncryptedArtifact,replaceEncryptedState,fileSha256} from '../../scripts/lib/recovery-io.mjs';

const ioModule=new URL('../../scripts/lib/recovery-io.mjs',import.meta.url).href;
const childSource=`
import fs from 'node:fs';
const {readProtectedJson,readSecretFd,replaceEncryptedState}=await import(process.argv[1]);
const input=readProtectedJson(process.argv[2]);
const secret=readSecretFd(3);
const key={keyId:input.key_id,key:Buffer.from(secret.key,'base64')};
const realLink=fs.linkSync;
fs.linkSync=function(source,destination,...options){
 realLink.call(fs,source,destination,...options);
 if(destination===input.target)process.exit(91);
};
replaceEncryptedState(input.target,input.state,key,input.context,null);
process.exit(92);
`;

test('encrypted publication resumes after actual process death between link and unlink', {timeout:15000},()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cfhub-io-publication-crash-'));fs.chmodSync(directory,0o700);
 const target=path.join(directory,'state.enc'),keyPath=path.join(directory,'key.json'),inputPath=path.join(directory,'input.json');
 const context={purpose:'state',workspace_id:'ws_crash_fixture',capture_id:'capture_crash_fixture'};
 const initial={format_version:1,sequence:0,pending_operation:'capture_initial'};
 const next={format_version:1,sequence:1,pending_operation:'capture_next'};
 const secret={key:crypto.randomBytes(32).toString('base64')};
 fs.writeFileSync(keyPath,JSON.stringify(secret),{flag:'wx',mode:0o600});
 fs.writeFileSync(inputPath,JSON.stringify({target,key_id:'crash_fixture_key',context,state:initial}),{flag:'wx',mode:0o600});
 const keyFd=fs.openSync(keyPath,'r');
 try{
  const child=spawnSync(process.execPath,['--input-type=module','--eval',childSource,'--',ioModule,inputPath],{
   stdio:['ignore','pipe','pipe',keyFd],encoding:'utf8',timeout:10000,maxBuffer:65536
  });
  assert.equal(child.error,undefined);assert.equal(child.signal,null);
  assert.equal(child.status,91,'the child must terminate immediately after the actual publication link');
  assert.equal(child.stdout,'');assert.equal(child.stderr,'');
  const published=fs.lstatSync(target);
  assert.equal(published.isFile(),true);assert.equal(published.mode&0o777,0o600);assert.equal(published.uid,process.getuid());
  assert.equal(published.nlink,2,'process.exit bypasses the production unlink/finally cleanup');
  const aliases=fs.readdirSync(directory).filter(name=>{const stat=fs.lstatSync(path.join(directory,name));return stat.dev===published.dev&&stat.ino===published.ino;});
  assert.equal(aliases.length,2);assert.ok(aliases.includes('state.enc'));
  assert.equal(aliases.filter(name=>name.startsWith('.cfhub-recovery-')).length,1);
  const publisherAlias=path.join(directory,aliases.find(name=>name!=='state.enc'));

  // Resume through production APIs. The test never repairs or unlinks the orphan itself.
  const loaded=readSecretFd(keyFd),key={keyId:'crash_fixture_key',key:Buffer.from(loaded.key,'base64')};
  const ciphertext=fs.readFileSync(target),initialBytes=Buffer.from(canonicalBytes(initial));
  assert.deepEqual(readEncryptedArtifact(target,key,context),initialBytes);
  assert.equal(fs.lstatSync(target).nlink,1,'authenticated read must repair the publication before any replacement');
  assert.equal(fs.existsSync(publisherAlias),false,'authenticated read removes the exact orphaned publisher alias');
  const originalDigest=fileSha256(target);
  assert.equal(writeEncryptedArtifact(target,initialBytes,key,context),originalDigest);
  assert.deepEqual(fs.readFileSync(target),ciphertext,'idempotent reuse preserves the published ciphertext');
  const nextDigest=replaceEncryptedState(target,next,key,context,originalDigest);
  assert.equal(fileSha256(target),nextDigest);assert.notEqual(nextDigest,originalDigest);
  assert.deepEqual(JSON.parse(readEncryptedArtifact(target,key,context).toString('utf8')),next);
  assert.equal(fs.lstatSync(target).mode&0o777,0o600);assert.equal(fs.lstatSync(target).nlink,1);
  assert.equal(fs.lstatSync(keyPath).nlink,1,'protected key input remains a distinct single-link file');
  assert.equal(fs.readFileSync(target).includes(Buffer.from(secret.key)),false);
 }finally{
  fs.closeSync(keyFd);fs.rmSync(directory,{recursive:true,force:true});
 }
});
