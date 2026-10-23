// Fault injection confined to the spawned test CLI process.
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const write=fs.writeSync;
fs.writeSync=(fd,data,...args)=>{
 if(fd<3)return write(fd,data,...args);
 if(process.env.CFHUB_TEST_WRITE_FAILURE==='1')throw Object.assign(new Error('synthetic disk failure'),{code:'ENOSPC'});
 if(typeof data==='string')return write(fd,data.slice(0,Math.max(1,Math.floor(data.length/2))),...args);
 const [offset=0,length=data.byteLength-offset,position=null]=args;
 return write(fd,data,offset,Math.max(1,Math.floor(length/2)),position);
};
syncBuiltinESMExports();
