import type {Deadline} from '../../client/src/transport';
import type {ObservationRecord} from '../../../src/http/dto';
import {parseHookJson} from './strict-json';
export interface ProjectionContext {readonly root:string;readonly profile:string;readonly observedAt:string;}
const profile='claude-posttooluse-path-docs-20261101-v1';
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const closed=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).every(k=>keys.includes(k));
const integer=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
function absolute(p:string):boolean {
 return p.startsWith('/')&&!p.includes('\\')&&!p.includes('\0')&&(p==='/'||p.slice(1).split('/').every(s=>s!==''&&s!=='.'&&s!=='..'));
}
/** Lexical display association only. Does not read files or resolve symlinks. */
export function projectHook(bytes:Uint8Array,context:ProjectionContext):ObservationRecord|null{
 try{
  if(context.profile!==profile||!absolute(context.root)||!Number.isFinite(Date.parse(context.observedAt))||new Date(context.observedAt).toISOString()!==context.observedAt)return null;
  const value=parseHookJson(bytes);
  if(!object(value)||!closed(value,['hook_event_name','cwd','tool_name','tool_input','session_id','transcript_path','tool_use_id','permission_mode','duration_ms','tool_response'])||value.hook_event_name!=='PostToolUse'||value.cwd!==context.root||!object(value.tool_input))return null;
  for(const key of ['session_id','transcript_path','tool_use_id','permission_mode'])if(Object.hasOwn(value,key)&&typeof value[key]!=='string')return null;
  if(Object.hasOwn(value,'duration_ms')&&(typeof value.duration_ms!=='number'||!Number.isFinite(value.duration_ms)||value.duration_ms<0))return null;
  const input=value.tool_input,tool=value.tool_name;
  if(tool==='Read'){
   if(!closed(input,['file_path','offset','limit'])||Object.hasOwn(input,'offset')&&!integer(input.offset)||Object.hasOwn(input,'limit')&&!integer(input.limit))return null;
  }else if(tool==='Write'){
   if(!closed(input,['file_path','content'])||typeof input.content!=='string')return null;
  }else if(tool==='Edit'){
   if(!closed(input,['file_path','old_string','new_string','replace_all'])||typeof input.old_string!=='string'||typeof input.new_string!=='string'||Object.hasOwn(input,'replace_all')&&typeof input.replace_all!=='boolean')return null;
  }else return null;
  if(typeof input.file_path!=='string'||!absolute(input.file_path))return null;
  const prefix=context.root==='/'?'/':context.root+'/';
  if(!input.file_path.startsWith(prefix))return null;
  const relative=input.file_path.slice(prefix.length);
  if(!relative||/^[a-zA-Z]:/.test(relative)||new TextEncoder().encode(relative).byteLength>1024)return null;
  return {observed_at:context.observedAt,relative_path:relative,activity:tool==='Read'?'read-observed':'write-observed',source_oid:null};
 }catch{return null;}
}
/** One shared absolute deadline; cancellation never waits for an exotic cancel hook. */
export async function readHookInput(reader:ReadableStreamDefaultReader<Uint8Array>,deadline:Deadline):Promise<Uint8Array>{
 const chunks:Uint8Array[]=[];let bytes=0;
 try{
  for(let attempt=0;attempt<1024;attempt++){
   deadline.check();const {done,value}=await deadline.wait(reader.read());deadline.check();
   if(done){const result=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}deadline.check();return result;}
   if(!(value instanceof Uint8Array)||value.byteLength>1048576-bytes)throw new Error('HOOK_INPUT_LIMIT');
   bytes+=value.byteLength;if(value.byteLength)chunks.push(new Uint8Array(value));
  }
  throw new Error('HOOK_INPUT_LIMIT');
 }finally{try{void reader.cancel().catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}
}
