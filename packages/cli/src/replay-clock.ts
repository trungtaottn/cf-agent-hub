import {randomUUID} from 'node:crypto';
import {openSync,readSync,closeSync,constants} from 'node:fs';

export interface DispatchStamp {firstDispatchWallMs:number;firstDispatchMonotonicMs:number;clockEpochId:string;guaranteedRetentionMs:86400000;requestFingerprint:string;}
export interface ReplayClockEvidence {clockEpochId:string;nowMonotonicMs:number;continuityVerified:boolean;suspendAwareElapsedVerified:boolean;}
const epoch='linux-process:'+randomUUID();
/** /proc/uptime is Linux BOOTTIME (includes suspend), printed at 10ms precision.
 * This intentionally proves continuity only in this process, NOT across restart,
 * reboot or time namespace changes. Same boot ID or hrtime alone is insufficient. */
export class LinuxReplayClock {
 #last:number|null=null;#failed=false;
 #read():number|null{
  if(process.platform!=='linux'||this.#failed)return null;
  let fd:number|undefined;
  try{
   fd=openSync('/proc/uptime',constants.O_RDONLY|constants.O_NOFOLLOW);const bytes=Buffer.alloc(128),count=readSync(fd,bytes,0,bytes.length,null);
   if(count===bytes.length)throw Error();const text=bytes.subarray(0,count).toString('ascii');
   if(!/^\d+\.\d{2} \d+\.\d{2}\n$/.test(text))throw Error();
   const value=Math.round(Number(text.split(' ')[0])*1000);
   if(!Number.isSafeInteger(value)||value<0||this.#last!==null&&value<this.#last)throw Error();this.#last=value;return value;
  }catch{this.#failed=true;return null;}finally{if(fd!==undefined)closeSync(fd);}
 }
 sample():ReplayClockEvidence{
  const now=this.#read();return {clockEpochId:epoch,nowMonotonicMs:now===null?0:now+10,continuityVerified:now!==null,suspendAwareElapsedVerified:now!==null};
 }
 stamp(requestFingerprint:string):DispatchStamp{
  const now=this.#read();if(now===null||!Number.isFinite(Date.now()))throw Error('CLOCK_UNPROVEN');
  return {firstDispatchWallMs:Date.now(),firstDispatchMonotonicMs:now,clockEpochId:epoch,guaranteedRetentionMs:86400000,requestFingerprint};
 }
}
