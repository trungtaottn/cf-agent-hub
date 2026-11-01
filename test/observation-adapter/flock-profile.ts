/** Synthetic test-profile selection only. Never imported by product artifacts.
 * Trusted test image owns this fixed installation; one frozen measured pin is
 * passed unchanged to subprocess fixtures, never rediscovered by children. */
import {constants,openSync,closeSync,fstatSync,readSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
function measure(){
 const path='/usr/bin/flock';for(const p of ['/usr','/usr/bin',path])if(lstatSync(p).isSymbolicLink())throw Error('TEST_FLOCK_SYMLINK');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{
 const before=fstatSync(fd,{bigint:true});if(!before.isFile()||before.size<=0n||before.size>1048576n||(before.mode&0o022n)!==0n||(before.mode&0o111n)===0n)throw Error('TEST_FLOCK_INVALID');
 const bytes=Buffer.alloc(Number(before.size)+1);let count=0;while(count<bytes.length){const n=readSync(fd,bytes,count,bytes.length-count,count);if(!n)break;count+=n;}if(count!==Number(before.size))throw Error('TEST_FLOCK_CHANGED');
 const output=execFileSync(path,['--version'],{encoding:'utf8',timeout:1000,maxBuffer:256,stdio:['ignore','pipe','pipe']}),match=/^flock from util-linux (\d+\.\d+(?:\.\d+)?)\n$/.exec(output);if(!match)throw Error('TEST_FLOCK_VERSION');
 const after=fstatSync(fd,{bigint:true}),named=lstatSync(path,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs'] as const)if(before[key]!==after[key]||before[key]!==named[key])throw Error('TEST_FLOCK_CHANGED');
 const pin=Object.freeze({path,sha256:createHash('sha256').update(bytes.subarray(0,count)).digest('hex'),version:match[1]});
 console.info('SYNTHETIC_TEST_FLOCK_PROFILE '+JSON.stringify({...pin,device:String(before.dev),inode:String(before.ino),byte_size:Number(before.size)}));return pin;
 }finally{closeSync(fd);}
}
export const testFlock=measure();
