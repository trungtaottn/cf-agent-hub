import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {canonicalBytes} from '../../src/recovery/encoding.ts';
const {O_RDONLY,O_NOFOLLOW,O_CREAT,O_EXCL,O_WRONLY,O_DIRECTORY}=fs.constants;
const fail=(code='RECOVERY_INPUT_REJECTED')=>{throw Error(code);};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const decoder=new TextDecoder('utf-8',{fatal:true});
function protectedFile(stat,links=1){if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||stat.nlink!==links)fail();}
function real(value){if(typeof value!=='string'||!path.isAbsolute(value)||path.resolve(value)!==value||fs.realpathSync(value)!==value)fail();return value;}
export function outsideCheckout(value){
 const absolute=path.resolve(value);let cursor=path.dirname(absolute);
 while(true){if(fs.existsSync(path.join(cursor,'.git')))fail();const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
 return absolute;
}
function privateDirectory(value){
 const absolute=real(value),stat=fs.lstatSync(absolute);
 if(!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)fail();
 outsideCheckout(path.join(absolute,'artifact'));return absolute;
}
export function ensureArtifactDirectory(value,create=false){
 const absolute=path.resolve(value);if(absolute!==value)fail();
 if(!fs.existsSync(absolute)){if(!create)fail();privateDirectory(path.dirname(absolute));fs.mkdirSync(absolute,{mode:0o700});}
 return privateDirectory(absolute);
}
function readFd(fd,maximum,links=1){
 if(!Number.isSafeInteger(fd)||fd<3)fail();
 const before=fs.fstatSync(fd);protectedFile(before,links);
 if(before.size<1||before.size>maximum)fail();
 const data=Buffer.alloc(before.size+1);let offset=0;
 while(offset<data.length){const n=fs.readSync(fd,data,offset,data.length-offset,offset);if(!n)break;offset+=n;}
 const after=fs.fstatSync(fd);if(offset!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino||after.dev!==before.dev||after.nlink!==links)fail();
 return data.subarray(0,offset);
}
export function readProtectedBytes(value,maximum=1048576){
 const absolute=real(value),fd=fs.openSync(absolute,O_RDONLY|O_NOFOLLOW);
 try{const opened=fs.fstatSync(fd),named=fs.lstatSync(absolute);if(opened.ino!==named.ino||opened.dev!==named.dev||named.isSymbolicLink())fail();return readFd(fd,maximum);}
 finally{fs.closeSync(fd);}
}
export function readProtectedJson(value,maximum=1048576){try{return JSON.parse(decoder.decode(readProtectedBytes(value,maximum)));}catch(error){if(error?.message==='RECOVERY_INPUT_REJECTED')throw error;fail();}}
export function readSecretFd(fd){try{return JSON.parse(decoder.decode(readFd(fd,8192)));}catch{fail();}}
function base64(value,maximum){
 if(typeof value!=='string'||value.length>maximum)fail('RECOVERY_ARTIFACT_REJECTED');
 const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value)fail('RECOVERY_ARTIFACT_REJECTED');return bytes;
}
function keyBytes(key){if(!key||typeof key.keyId!=='string'||key.keyId.length<1||key.keyId.length>128||!(key.key instanceof Uint8Array)||key.key.length!==32)fail();return Buffer.from(key.key);}
function aad(key,context){return Buffer.from(canonicalBytes({format_version:1,algorithm:'AES-256-GCM',key_id:key.keyId,context}));}
function seal(bytes,key,context){
 const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',keyBytes(key),nonce);cipher.setAAD(aad(key,context));
 const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
 return Buffer.from(JSON.stringify({format_version:1,algorithm:'AES-256-GCM',key_id:key.keyId,context,nonce:nonce.toString('base64'),ciphertext:ciphertext.toString('base64'),tag:cipher.getAuthTag().toString('base64')})+'\n');
}
function encryptedBytes(value,maximum){
 const absolute=real(value),fd=fs.openSync(absolute,O_RDONLY|O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd),named=fs.lstatSync(absolute);
  if(stat.ino!==named.ino||stat.dev!==named.dev||named.isSymbolicLink())fail();
  if(stat.nlink===1)return {encoded:readFd(fd,maximum),orphan:null};
  protectedFile(stat,2);
  const parent=privateDirectory(path.dirname(absolute));
  if((stat.mode&0o777)!==0o600)fail();
  const candidates=fs.readdirSync(parent).filter(name=>/^\.cfhub-recovery-[a-f0-9]{32}$/.test(name)&&path.join(parent,name)!==absolute).map(name=>path.join(parent,name)).filter(candidate=>{
   const entry=fs.lstatSync(candidate);return entry.isFile()&&!entry.isSymbolicLink()&&entry.ino===stat.ino&&entry.dev===stat.dev&&entry.uid===stat.uid&&entry.nlink===2&&(entry.mode&0o777)===0o600;
  });
  if(candidates.length!==1)fail();
  return {encoded:readFd(fd,maximum,2),orphan:{absolute,parent,temporary:candidates[0],ino:stat.ino,dev:stat.dev,size:stat.size,mtimeMs:stat.mtimeMs}};
 }finally{fs.closeSync(fd);}
}
function repairOwnedPublication(orphan){
 if(!orphan)return;
 privateDirectory(orphan.parent);
 const final=fs.lstatSync(orphan.absolute),temporary=fs.lstatSync(orphan.temporary);
 for(const stat of [final,temporary]){protectedFile(stat,2);if(stat.ino!==orphan.ino||stat.dev!==orphan.dev||stat.size!==orphan.size||stat.mtimeMs!==orphan.mtimeMs||(stat.mode&0o777)!==0o600)fail('RECOVERY_LOCAL_CONFLICT');}
 fs.unlinkSync(orphan.temporary);
 const directory=fs.openSync(orphan.parent,O_RDONLY|O_DIRECTORY);try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
 protectedFile(fs.lstatSync(orphan.absolute));
}
export function readEncryptedArtifact(value,key,context,maximum=1048576){
 const record=encryptedBytes(value,maximum*2+16384),encoded=record.encoded;
 try{
  const frame=JSON.parse(decoder.decode(encoded)),keys=['format_version','algorithm','key_id','context','nonce','ciphertext','tag'];
  if(!frame||typeof frame!=='object'||Array.isArray(frame)||Object.keys(frame).length!==keys.length||keys.some(k=>!Object.hasOwn(frame,k))||frame.format_version!==1||frame.algorithm!=='AES-256-GCM'||frame.key_id!==key.keyId)throw Error();
  const expected=aad(key,context),actual=aad(key,frame.context);if(expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual))throw Error();
  const nonce=base64(frame.nonce,32),tag=base64(frame.tag,32),ciphertext=base64(frame.ciphertext,maximum*2+32);
  if(nonce.length!==12||tag.length!==16||ciphertext.length>maximum)throw Error();
  const decipher=crypto.createDecipheriv('aes-256-gcm',keyBytes(key),nonce);decipher.setAAD(expected);decipher.setAuthTag(tag);
  const plain=Buffer.concat([decipher.update(ciphertext),decipher.final()]);if(plain.length>maximum)throw Error();
  // Repair only our authenticated same-inode publication alias; key/FD readers stay nlink1.
  repairOwnedPublication(record.orphan);return plain;
 }catch{fail('RECOVERY_ARTIFACT_REJECTED');}
}
function atomicWrite(value,bytes,expectedHash){
 const absolute=path.resolve(value);if(absolute!==value)fail();const parent=privateDirectory(path.dirname(absolute));outsideCheckout(absolute);
 let before=null;
 try{before=readProtectedBytes(absolute,2097152);if(expectedHash===null||hash(before)!==expectedHash)fail('RECOVERY_LOCAL_CONFLICT');}
 catch(error){if(error?.code!=='ENOENT')throw error;if(expectedHash!==null)fail('RECOVERY_LOCAL_CONFLICT');}
 const temporary=path.join(parent,'.cfhub-recovery-'+crypto.randomBytes(16).toString('hex'));let fd;
 try{
  fd=fs.openSync(temporary,O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW,0o600);fs.fchmodSync(fd,0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  if(before===null){fs.linkSync(temporary,absolute);fs.unlinkSync(temporary);}
  else{if(hash(readProtectedBytes(absolute,2097152))!==expectedHash)fail('RECOVERY_LOCAL_CONFLICT');fs.renameSync(temporary,absolute);}
  const directory=fs.openSync(parent,O_RDONLY|O_DIRECTORY);try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  return hash(bytes);
 }catch(error){if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch{}if(error?.code==='EEXIST')fail('RECOVERY_LOCAL_CONFLICT');throw error;}
}
export function writeEncryptedArtifact(value,bytes,key,context){
 const data=Buffer.from(bytes);if(data.length>1048576)fail();
 if(fs.existsSync(value)){const prior=readEncryptedArtifact(value,key,context,1048576);if(prior.length!==data.length||!crypto.timingSafeEqual(prior,data))fail('RECOVERY_LOCAL_CONFLICT');return hash(readProtectedBytes(value,data.length*2+16384));}
 return atomicWrite(value,seal(data,key,context),null);
}
export function replaceEncryptedState(value,state,key,context,expectedHash){
 if(expectedHash!==null)readEncryptedArtifact(value,key,context,1048576);
 return atomicWrite(value,seal(Buffer.from(canonicalBytes(state)),key,context),expectedHash);
}
export const fileSha256=value=>hash(readProtectedBytes(value,2097152));
