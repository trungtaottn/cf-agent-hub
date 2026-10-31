import {constants,openSync,closeSync,readSync,writeSync,fstatSync,lstatSync,fsyncSync,unlinkSync,linkSync,realpathSync,type BigIntStats} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import type {ArtifactDownload} from '../../client/src/types';
export const MAX_CONTENT_BYTES=10485760;
const fail=():never=>{throw Error('ARTIFACT_FILE_REJECTED');};
export interface SealedContent {basename:string;size:number;sha256:string;dev:string;ino:string;uid:string;mode:string;nlink:string;}
const stat=(path:string)=>lstatSync(path,{bigint:true});
const same=(a:BigIntStats,b:BigIntStats)=>a.dev===b.dev&&a.ino===b.ino;
function regular(st:BigIntStats,privateFile=false):void{if(!st.isFile()||st.nlink!==1n||st.uid!==BigInt(process.getuid!())||privateFile&&(st.mode&0o777n)!==0o600n)fail();}
function identity(st:BigIntStats){return {dev:String(st.dev),ino:String(st.ino),uid:String(st.uid),mode:String(st.mode),nlink:String(st.nlink)};}
export function trustedDirectory(path:string,privateDirectory=true):BigIntStats{
 const full=resolve(path);if(realpathSync(full)!==full)fail();
 for(let p=full;;p=dirname(p)){const s=stat(p);if(!s.isDirectory()||s.isSymbolicLink()||(s.uid!==BigInt(process.getuid!())&&s.uid!==0n)||((s.mode&0o022n)!==0n&&!(s.uid===0n&&(s.mode&0o1000n)!==0n)))fail();if(dirname(p)===p)break;}
 const s=stat(full);if(privateDirectory&&(s.uid!==BigInt(process.getuid!())||(s.mode&0o777n)!==0o700n))fail();return s;
}
export function syncArtifactDirectory(path:string):void{const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
export function sourceSize(path:string):number{const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const st=fstatSync(fd,{bigint:true});regular(st);if(!same(st,stat(path))||st.size>BigInt(MAX_CONTENT_BYTES))fail();return Number(st.size);}finally{closeSync(fd);}}
function writeAll(fd:number,bytes:Uint8Array):void{let offset=0;while(offset<bytes.length){const n=writeSync(fd,bytes,offset,bytes.length-offset);if(n<=0)fail();offset+=n;}}
export function captureFile(source:string,directory:string,basename:string,expectedSize:number):SealedContent{
 if(!/^[a-f0-9]{32}\.blob$/.test(basename)||!Number.isSafeInteger(expectedSize)||expectedSize<0||expectedSize>MAX_CONTENT_BYTES)fail();
 const root=trustedDirectory(directory),input=openSync(source,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let output:number|undefined;
 try{const before=fstatSync(input,{bigint:true});regular(before);if(!same(before,stat(source))||before.size!==BigInt(expectedSize))fail();output=openSync(join(directory,basename),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 const hash=createHash('sha256'),block=Buffer.alloc(65536);let total=0;
 for(;;){const n=readSync(input,block,0,block.length,null);if(n===0)break;total+=n;if(total>expectedSize)fail();hash.update(block.subarray(0,n));writeAll(output,block.subarray(0,n));}
 const after=fstatSync(input,{bigint:true});if(total!==expectedSize||!same(before,after)||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||!same(after,stat(source)))fail();
 fsyncSync(output);if(!same(root,trustedDirectory(directory)))fail();syncArtifactDirectory(directory);const sealed=fstatSync(output,{bigint:true});regular(sealed,true);if(!same(sealed,stat(join(directory,basename))))fail();return {basename,size:total,sha256:hash.digest('hex'),...identity(sealed)};
 }finally{closeSync(input);if(output!==undefined)closeSync(output);}
}
export function openSealedContent(directory:string,sealed:SealedContent):{body:ReadableStream<Uint8Array>;close():void}{
 if(!/^[a-f0-9]{32}\.blob$/.test(sealed.basename))fail();trustedDirectory(directory);const path=join(directory,sealed.basename),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let closed=false;
 const close=()=>{if(!closed){closed=true;closeSync(fd);}};
 try{const st=fstatSync(fd,{bigint:true});regular(st,true);if(!same(st,stat(path))||st.size!==BigInt(sealed.size)||Object.entries(identity(st)).some(([k,v])=>sealed[k as keyof SealedContent]!==v))fail();
 const hash=createHash('sha256'),block=Buffer.alloc(65536);let pos=0;for(;;){const n=readSync(fd,block,0,block.length,pos);if(!n)break;pos+=n;if(pos>sealed.size)fail();hash.update(block.subarray(0,n));}const after=fstatSync(fd,{bigint:true});if(pos!==sealed.size||hash.digest('hex')!==sealed.sha256||!same(st,after)||st.size!==after.size||st.mtimeNs!==after.mtimeNs||st.ctimeNs!==after.ctimeNs||!same(after,stat(path)))fail();
 let offset=0;const body=new ReadableStream<Uint8Array>({pull(c){try{if(closed)fail();const bytes=Buffer.alloc(Math.min(65536,sealed.size-offset));const n=bytes.length?readSync(fd,bytes,0,bytes.length,offset):0;if(!n){if(offset!==sealed.size)fail();close();c.close();return;}offset+=n;c.enqueue(bytes.subarray(0,n));}catch(e){close();c.error(e);}},cancel(){close();}});return {body,close};
 }catch(e){close();throw e;}
}
/** Never removes a replaced inode. Used only after a durable deleting transition. */
export function unlinkSealedContent(directory:string,sealed:SealedContent):void{trustedDirectory(directory);const path=join(directory,sealed.basename),s=stat(path);regular(s,true);if(Object.entries(identity(s)).some(([k,v])=>sealed[k as keyof SealedContent]!==v)||s.size!==BigInt(sealed.size))fail();unlinkSync(path);syncArtifactDirectory(directory);}
export function validateDownloadDestination(destination:string):void{const path=resolve(destination);trustedDirectory(dirname(path),false);try{stat(path);fail();}catch(e){if(!(e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT'))throw e;}}
/** Input must be the already validated native committed-artifact download. */
export async function downloadArtifactToFile(download:ArtifactDownload,destination:string):Promise<void>{
 const path=resolve(destination),parent=dirname(path);let fd:number|undefined,owned:BigIntStats|undefined,linked=false;const temp=join(parent,'.agenthub-'+randomBytes(16).toString('hex')+'.tmp');let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{validateDownloadDestination(path);const root=trustedDirectory(parent,false);
 if(download.artifact.status!=='committed'||download.artifact.byte_size>MAX_CONTENT_BYTES)fail();fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);owned=fstatSync(fd,{bigint:true});regular(owned,true);reader=download.body.getReader();const hash=createHash('sha256');let size=0;
 for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>download.artifact.byte_size)fail();hash.update(part.value);writeAll(fd,part.value);}
 const completion=await download.completion;if(!completion.ok||completion.byteSize!==size||size!==download.artifact.byte_size||hash.digest('hex')!==download.artifact.sha256)fail();fsyncSync(fd);if(!same(root,trustedDirectory(parent,false))||!same(owned,stat(temp)))fail();linkSync(temp,path);linked=true;syncArtifactDirectory(parent);unlinkSync(temp);syncArtifactDirectory(parent);
 }catch(error){await reader?.cancel().catch(()=>{});if(!reader)await download.body.cancel().catch(()=>{});if(owned){try{if(same(owned,stat(temp)))unlinkSync(temp);}catch{}}if(linked)throw Error('ARTIFACT_PUBLICATION_UNCERTAIN');throw error;}finally{if(fd!==undefined)closeSync(fd);reader?.releaseLock();}
}
