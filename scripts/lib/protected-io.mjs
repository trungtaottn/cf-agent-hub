import {constants,openSync,closeSync,fstatSync,lstatSync,readSync,writeSync,fchmodSync,fsyncSync,linkSync,unlinkSync,realpathSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const repository=resolve(fileURLToPath(new URL('../../',import.meta.url)));
export const fail=()=>{throw Error('OPERATOR_INPUT_REJECTED');};
function protectedStat(stat) {
 if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||stat.nlink!==1)fail();
}
function noSymlink(path) {
 const absolute=resolve(path);
 if(realpathSync(absolute)!==absolute)fail();
 return absolute;
}
function readDescriptor(fd,maxBytes) {
 const before=fstatSync(fd);protectedStat(before);
 if(before.size<=0||before.size>maxBytes)fail();
 const data=Buffer.alloc(before.size+1),count=readSync(fd,data,0,data.length,0);
 const after=fstatSync(fd);
 if(count!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)fail();
 return JSON.parse(data.subarray(0,count).toString('utf8'));
}
export function readProtectedJson(path,maxBytes=1048576) {
 const absolute=noSymlink(path),fd=openSync(absolute,constants.O_RDONLY|constants.O_NOFOLLOW);
 try {
  const opened=fstatSync(fd),named=lstatSync(absolute);
  if(opened.ino!==named.ino||opened.dev!==named.dev||named.isSymbolicLink())fail();
  return readDescriptor(fd,maxBytes);
 }finally{closeSync(fd);}
}
export function descriptor(value) {
 if(typeof value!=='string'||!/^\d+$/.test(value))fail();
 const fd=Number(value);if(!Number.isSafeInteger(fd)||fd<3)fail();return fd;
}
export function readProtectedFdJson(fd){return readDescriptor(fd,4096);}
export function validateRevealFd(fd) {
 const stat=fstatSync(fd);protectedStat(stat);if(stat.size!==0||(stat.mode&0o777)!==0o600)fail();
 return stat;
}
function outputParent(path) {
 const absolute=resolve(path),parent=dirname(absolute);
 noSymlink(parent);const directory=lstatSync(parent);
 if(!directory.isDirectory()||directory.uid!==process.getuid()||(directory.mode&0o077)!==0)fail();
 const local=relative(repository,absolute);
 if(!isAbsolute(local)&&local!=='..'&&!local.startsWith('../'))fail();
 try{lstatSync(absolute);fail();}catch(error){if(error?.code!=='ENOENT')throw error;}
 return {absolute,parent};
}
function writeAll(fd,content){
 const bytes=Buffer.from(content,'utf8');let offset=0;
 while(offset<bytes.length){
  const written=writeSync(fd,bytes,offset,bytes.length-offset,offset);
  if(written<=0)fail();offset+=written;
 }
}
/** Same-directory exclusive staging + hard-link publication is atomic and never replaces a name. */
export function publishBundle(path,content,reveal) {
 const {absolute,parent}=outputParent(path);
 if(reveal)validateRevealFd(reveal.fd);
 const temporary=join(parent,'.cfhub.tmp-'+randomBytes(16).toString('hex'));
 let fd;
 try {
  fd=openSync(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  fchmodSync(fd,0o600);writeAll(fd,content);fsyncSync(fd);closeSync(fd);fd=undefined;
  if(reveal){validateRevealFd(reveal.fd);writeAll(reveal.fd,reveal.token+'\n');fsyncSync(reveal.fd);}
  linkSync(temporary,absolute);unlinkSync(temporary);
  const directory=openSync(parent,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(directory);}finally{closeSync(directory);}
 }catch(error){
  if(fd!==undefined)closeSync(fd);
  try{unlinkSync(temporary);}catch{}
  throw error;
 }
}
