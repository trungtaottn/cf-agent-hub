import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ensureArtifactDirectory,boundedDirectoryEntries} from './recovery-io.mjs';
export const RECOVERY_RETENTION_BYTES=1073741824;
export const RECOVERY_RETENTION_FILES=32768;
const temporary=/^\.cfhub-recovery-[a-f0-9]{32}$/;
const fail=(code='RECOVERY_LOCAL_CONFLICT')=>{throw Error(code);};
export function assertCapacity(usage,stage='dispatch'){
 const reserve=stage==='dispatch'?{bytes:16*1048576,files:16}:stage==='finish'?{bytes:8*1048576,files:8}:null;
 if(!reserve||!Number.isSafeInteger(usage.bytes)||usage.bytes<0||!Number.isSafeInteger(usage.files)||usage.files<0||usage.bytes>RECOVERY_RETENTION_BYTES-reserve.bytes||usage.files>RECOVERY_RETENTION_FILES-reserve.files)fail('RECOVERY_RETENTION_LIMIT');
}
export function assertOperationCapacity(sequence,attempt){
 if(!Number.isSafeInteger(sequence)||sequence<0||sequence>=16384||!Number.isSafeInteger(attempt)||attempt<0||attempt>=64)fail('RECOVERY_RETENTION_LIMIT');
}
const syncDirectory=directory=>{const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
function regular(stat,links=1){if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o600||stat.nlink!==links)fail();}
function acquire(filename){
 const parent=ensureArtifactDirectory(path.dirname(filename)),token=crypto.randomBytes(32).toString('hex');
 const fd=fs.openSync(filename,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);
 let stat;
 try{fs.fchmodSync(fd,0o600);fs.writeFileSync(fd,token);fs.fsyncSync(fd);stat=fs.fstatSync(fd);regular(stat);syncDirectory(parent);}catch(error){fs.closeSync(fd);throw error;}
 const check=()=>{ensureArtifactDirectory(parent);const named=fs.lstatSync(filename),opened=fs.fstatSync(fd);regular(named);regular(opened);if(named.dev!==stat.dev||named.ino!==stat.ino||opened.dev!==stat.dev||opened.ino!==stat.ino||named.size!==64)fail();const bytes=Buffer.alloc(65);if(fs.readSync(fd,bytes,0,65,0)!==64||bytes.subarray(0,64).toString()!==token)fail();};
 return {check,release(){try{check();fs.unlinkSync(filename);syncDirectory(parent);}finally{fs.closeSync(fd);}}};
}
/** Quota accounting does not authenticate an orphan or authorize its deletion. */
function measured(directory,select){
 const all=boundedDirectoryEntries(directory),entries=[];
 for(const name of all){if(!select(name))continue;const filename=path.join(directory,name),stat=fs.lstatSync(filename);if(stat.isSymbolicLink())fail();if(stat.nlink===1)regular(stat);else if(stat.nlink===2){
  regular(stat,2);const matches=all.filter(other=>{const s=fs.lstatSync(path.join(directory,other));return s.ino===stat.ino&&s.dev===stat.dev;});
  if(matches.length!==2||matches.filter(x=>temporary.test(x)).length!==1)fail();
  for(const other of matches)regular(fs.lstatSync(path.join(directory,other)),2);
 }else fail();entries.push({bytes:stat.size});}
 return {files:entries.length,bytes:entries.reduce((n,e)=>n+e.bytes,0)};
}
export const recoveryLeasePaths=config=>[path.join(path.dirname(config.statePath),'.cfhub-recovery.lock'),path.join(config.artifactDirectory,'.cfhub-recovery.lock')].sort();
export function acquireRecoveryLease(config){
 const stateParent=ensureArtifactDirectory(path.dirname(config.statePath)),artifacts=ensureArtifactDirectory(config.artifactDirectory);
 const paths=recoveryLeasePaths(config);
 if(paths[0]===paths[1])fail();const leases=[];
 try{for(const name of paths)leases.push(acquire(name));}catch(error){for(const lease of leases.reverse()){try{lease.release();}catch{}}if(error?.code==='EEXIST')fail('RECOVERY_LOCAL_LOCKED');throw error;}
 const check=()=>{for(const lease of leases)lease.check();};
 return {check,admit(stage='dispatch'){
  check();const a=measured(artifacts,()=>true),s=measured(stateParent,name=>name===path.basename(config.statePath)||name==='.cfhub-recovery.lock'||temporary.test(name));
  assertCapacity({files:a.files+s.files,bytes:a.bytes+s.bytes},stage);check();
 },release(){let failure;for(const lease of leases.reverse()){try{lease.release();}catch(error){failure??=error;}}if(failure)throw failure;}};
}
