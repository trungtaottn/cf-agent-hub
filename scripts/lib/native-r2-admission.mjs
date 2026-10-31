import {selectNativeExecutionProfile} from './native-execution-profile.mjs';
import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,readSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {validateNativeConfig} from './native-r2-config.mjs';
import {readProtectedJson} from './protected-io.mjs';
const fail=()=>{throw Error('NATIVE_CONFIG_REJECTED');};
const exists=path=>{try{return lstatSync(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const sha=value=>createHash('sha256').update(value).digest('hex');
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
export const nativeConfigDigest=config=>sha(canonical(validateNativeConfig(config)));
/** A separate input guard; does not modify or relax the CLI's protected storage rules. */
export function inspectNativeDirectory(path,{privateDirectory=true,noGit=true}={}){
 if(process.platform!=='linux'||typeof process.getuid!=='function'||resolve(path)!==path||realpathSync(path)!==path)fail();
 const uid=process.getuid();
 for(let cursor=path;;cursor=dirname(cursor)){
  const st=lstatSync(cursor);if(!st.isDirectory()||st.isSymbolicLink()||(st.uid!==uid&&st.uid!==0)||((st.mode&0o022)!==0&&!(st.uid===0&&(st.mode&0o1000)!==0)))fail();
  if(noGit&&exists(join(cursor,'.git')))fail();
  if(dirname(cursor)===cursor)break;
 }
 const st=lstatSync(path);if(privateDirectory&&(st.uid!==uid||(st.mode&0o777)!==0o700))fail();
 return {dev:String(st.dev),ino:String(st.ino)};
}
export function readNativeConfig(path){
 try{if(typeof path!=='string'||resolve(path)!==path)fail();inspectNativeDirectory(dirname(path));return validateNativeConfig(readProtectedJson(path,65536));}catch{return fail();}
}
export const nativeExecutableModeAllowed=(mode,isNode)=>Number.isSafeInteger(mode)&&mode>=0&&(mode&0o022)===0&&(!isNode||(mode&0o111)!==0);
function inspectExecutable(path,expected,maxBytes,isNode=false){
 inspectNativeDirectory(dirname(path),{privateDirectory:false,noGit:false});if(realpathSync(path)!==path)fail();
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const a=fstatSync(fd,{bigint:true}),named=lstatSync(path,{bigint:true});
  if(!a.isFile()||a.nlink!==1n||(a.uid!==BigInt(process.getuid())&&a.uid!==0n)||!nativeExecutableModeAllowed(Number(a.mode),isNode)||a.size<=0n||a.size>BigInt(maxBytes)||a.ino!==named.ino||a.dev!==named.dev)fail();
  const hash=createHash('sha256'),block=Buffer.alloc(65536);let size=0;
  for(;;){const n=readSync(fd,block,0,block.length,null);if(!n)break;size+=n;if(size>maxBytes)fail();hash.update(block.subarray(0,n));}
  const b=fstatSync(fd,{bigint:true}),after=lstatSync(path,{bigint:true});if(a.size!==BigInt(size)||a.size!==b.size||a.mtimeNs!==b.mtimeNs||a.ctimeNs!==b.ctimeNs||a.ino!==after.ino||a.dev!==after.dev||hash.digest('hex')!==expected)fail();
  return {dev:String(a.dev),ino:String(a.ino),size,sha256:expected};
 }finally{closeSync(fd);}
}
/** Trusted host code is an explicit dependency, never loaded from a config string.
 * This response validates bindings, not the authenticity of a caller's adapter. */
export function admitNativeRun(input,integration){return admitRun(input,integration,false);}
export function admitCompleteNativeRun(input,integration){return admitRun(input,integration,true);}
async function admitRun(input,integration,complete){
 if(!integration||typeof integration.authorize!=='function')throw Error('NATIVE_AUTHORITY_UNAVAILABLE');
 const selected=complete?selectNativeExecutionProfile(input):null;
 if(complete&&selected.config.version!==2)fail();
 const config=complete?selected.config:validateNativeConfig(input),configSha256=complete?selected.configSha256:nativeConfigDigest(config);
 let authorization;
 try{authorization=await integration.authorize(structuredClone({configSha256,config}));}catch{throw Error('NATIVE_AUTHORITY_REJECTED');}
 if(!authorization||Object.keys(authorization).sort().join(',')!=='authorityRecordSha256,configSha256,expiresAt'||authorization.configSha256!==configSha256||authorization.authorityRecordSha256!==config.authority_record_sha256||!Number.isSafeInteger(authorization.expiresAt)||authorization.expiresAt<=Date.now()||authorization.expiresAt>Date.now()+300000)throw Error('NATIVE_AUTHORITY_REJECTED');
 try{
  const identities=[...config.actors.map(actor=>actor.state_directory),...config.fixture_stores.map(item=>item.state_directory),config.fixture_directory,config.output_directory].map(directory=>inspectNativeDirectory(directory));
  if(new Set(identities.map(value=>value.dev+':'+value.ino)).size!==identities.length)throw Error();
  const node=inspectExecutable(config.node.path,config.node.sha256,268435456,true),build=inspectExecutable(config.build.path,config.build.sha256,16777216);
  if(authorization.expiresAt<=Date.now())throw Error();
  return {config,configSha256,authorization:structuredClone(authorization),executables:{node,build}};
 }catch{throw Error('NATIVE_ADMISSION_REJECTED');}
}
