import {canonicalJson} from '../config/bootstrap.ts';
import {tableDefinition,type RecoveryTableName,type RegistryTable} from './table-registry.ts';
import type {SqlValue} from '../storage/transaction';
export const CONTROL_LIMIT=65536,CHUNK_LIMIT=1048576,CHUNK_ROWS=200,CHUNK_COUNT=256,CONTROL_HEADER_LIMIT=8192;
/** Contract ceilings; details V2 is not persisted by current runtime. */
export const RECOVERY_JOB_DETAILS_LIMIT=262144,ARTIFACT_COUNT=1000,ARTIFACT_BYTES=10485760,RECOVERY_TOTAL_BYTES=268435456,RECOVERY_ROWS=1000000;
export type SqlCell=null|string|number|{type:'blob';base64:string};
export interface RecoveryChunk {format_version:1;capture_id:string;index:number;table:RecoveryTableName;columns:string[];rows:SqlCell[][];}
const utf8=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false});
export const isSlug=(v:unknown):v is string=>typeof v==='string'&&v.length<=128&&/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(v);
export function closed(value:unknown,keys:readonly string[]):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
function jsonSafe(value:unknown):void {if(typeof value==='number'&&!Number.isFinite(value)||value===undefined||typeof value==='bigint'||typeof value==='function')throw Error('INVALID_CANONICAL_JSON');if(value&&typeof value==='object')for(const v of Object.values(value))jsonSafe(v);}
export function canonicalBytes(value:unknown):Uint8Array<ArrayBuffer>{jsonSafe(value);return new Uint8Array(utf8.encode(canonicalJson(value)));}
export function parseCanonical(bytes:Uint8Array,maximum=CONTROL_LIMIT):unknown {
 if(bytes.byteLength>maximum)throw Error('RECOVERY_BYTES_LIMIT');let value:unknown;
 try{value=JSON.parse(decoder.decode(bytes));}catch{throw Error('INVALID_CANONICAL_JSON');}
 const expected=canonicalBytes(value);if(expected.length!==bytes.length||expected.some((v,i)=>v!==bytes[i]))throw Error('NONCANONICAL_RECOVERY_BYTES');return value;
}
export function hex(bytes:ArrayBuffer):string{return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export async function digestBytes(bytes:Uint8Array):Promise<string>{return hex(await crypto.subtle.digest('SHA-256',bytes.slice().buffer));}
export function base64(bytes:Uint8Array):string{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);}
export function fromBase64(value:string):Uint8Array<ArrayBuffer>{try{const b=Uint8Array.from(atob(value),c=>c.charCodeAt(0));if(base64(b)!==value)throw Error();return b;}catch{throw Error('INVALID_BASE64');}}
export function encodeHeader(value:unknown):string{return base64(canonicalBytes(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export function decodeHeader(value:string|null):unknown {
 if(!value||value.length>CONTROL_HEADER_LIMIT||!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw Error('INVALID_RECOVERY_HEADER');
 const padded=value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4),bytes=fromBase64(padded);
 const parsed=parseCanonical(bytes);if(encodeHeader(parsed)!==value)throw Error('INVALID_RECOVERY_HEADER');return parsed;
}
export function sqlCell(value:SqlValue):SqlCell{return value instanceof ArrayBuffer?{type:'blob',base64:base64(new Uint8Array(value))}:value;}
export function sqlBinding(value:SqlCell):SqlValue{return value!==null&&typeof value==='object'?fromBase64(value.base64).buffer:value;}
function scalarCompare(a:SqlCell,b:SqlCell):number {
 if(typeof a==='number'&&typeof b==='number')return a<b?-1:a>b?1:0;
 if(typeof a==='string'&&typeof b==='string'){const x=utf8.encode(a),y=utf8.encode(b);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]<y[i]?-1:1;return x.length<y.length?-1:x.length>y.length?1:0;}
 throw Error('INVALID_PRIMARY_KEY');
}
export function primaryKey(table:RegistryTable,row:readonly SqlCell[]):SqlCell[]{return table.primaryKey.map(k=>row[table.columns.findIndex(c=>c.name===k)]);}
export function compareKeys(a:readonly SqlCell[],b:readonly SqlCell[]):number {if(a.length!==b.length)throw Error('INVALID_PRIMARY_KEY');for(let i=0;i<a.length;i++){const c=scalarCompare(a[i],b[i]);if(c)return c;}return 0;}
function validateChunk(value:unknown):asserts value is RecoveryChunk {
 if(!closed(value,['format_version','capture_id','index','table','columns','rows'])||value.format_version!==1||!isSlug(value.capture_id)||!Number.isInteger(value.index)||Number(value.index)<0||Number(value.index)>=CHUNK_COUNT||typeof value.table!=='string'||!Array.isArray(value.columns)||!Array.isArray(value.rows)||value.rows.length<1||value.rows.length>CHUNK_ROWS)throw Error('INVALID_RECOVERY_CHUNK');
 const table=tableDefinition(value.table);
 if(JSON.stringify(value.columns)!==JSON.stringify(table.columns.map(c=>c.name)))throw Error('RECOVERY_COLUMN_MISMATCH');
 let last:SqlCell[]|null=null;
 for(const unknownRow of value.rows){
  if(!Array.isArray(unknownRow)||unknownRow.length!==table.columns.length)throw Error('INVALID_RECOVERY_ROW');
  const row=unknownRow as SqlCell[];
  row.forEach((cell,i)=>{const column=table.columns[i];
   if(cell===null){if(column.notNull||column.pk)throw Error('RECOVERY_NULL_IDENTITY');return;}
   if(column.type==='INTEGER'){if(!Number.isSafeInteger(cell))throw Error('RECOVERY_INTEGER');}
   else if(column.type==='REAL'){if(typeof cell!=='number'||!Number.isFinite(cell))throw Error('RECOVERY_REAL');}
   else if(column.type==='TEXT'){if(typeof cell!=='string')throw Error('RECOVERY_TEXT');}
   else if(column.type==='BLOB'){if(!closed(cell,['type','base64'])||cell.type!=='blob'||typeof cell.base64!=='string')throw Error('RECOVERY_BLOB');fromBase64(cell.base64);}
   else throw Error('UNKNOWN_RECOVERY_COLUMN_TYPE');
  });
  const key=primaryKey(table,row);if(last&&compareKeys(last,key)>=0)throw Error('RECOVERY_PRIMARY_KEY_ORDER');last=key;
 }
}
export function encodeChunk(chunk:RecoveryChunk):Uint8Array<ArrayBuffer>{validateChunk(chunk);const bytes=canonicalBytes(chunk);if(bytes.length>CHUNK_LIMIT)throw Error('RECOVERY_CHUNK_LIMIT');return bytes;}
export function decodeChunk(bytes:Uint8Array,expected?:{capture_id:string;index:number;table:string;row_count:number;byte_size:number}):RecoveryChunk {
 const parsed=parseCanonical(bytes,CHUNK_LIMIT);validateChunk(parsed);
 if(expected&&(parsed.capture_id!==expected.capture_id||parsed.index!==expected.index||parsed.table!==expected.table||parsed.rows.length!==expected.row_count||bytes.length!==expected.byte_size))throw Error('RECOVERY_CHUNK_IDENTITY');return parsed;
}
/** No unbounded body buffering. Used only after operator authentication on binary uploads. */
export async function boundedBytes(body:ReadableStream<Uint8Array>|null,maximum:number):Promise<Uint8Array<ArrayBuffer>> {
 if(!body)throw Error('EMPTY_RECOVERY_BODY');const reader=body.getReader(),parts:Uint8Array[]=[];let size=0;
 try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>maximum){await reader.cancel();throw Error('RECOVERY_BYTES_LIMIT');}parts.push(item.value);}}
 finally{reader.releaseLock();}
 const out=new Uint8Array(size);let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}return out;
}
