/** Isomorphic test-only safe transport. No filesystem, controller, credentials or authority. */
import {J1_CASES,J1_LIMITS as L} from '../../scripts/lib/r3-source-producer-policy.mjs';
const encoder=new TextEncoder(),typed=Object.getPrototypeOf(Uint8Array.prototype),byteLength=Object.getOwnPropertyDescriptor(typed,'byteLength')!.get!,backing=Object.getOwnPropertyDescriptor(typed,'buffer')!.get!,abLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!,resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
function bad():never{throw Error('R3_SOURCE_PACKET_INVALID');}
function copy(input:unknown){if(!ArrayBuffer.isView(input)||Object.getPrototypeOf(input)!==Uint8Array.prototype)bad();const b=backing.call(input);abLength.call(b);if(resizable?.call(b))bad();const n=byteLength.call(input);if(n<1||n>L.observation)bad();const out=new Uint8Array(n);Uint8Array.prototype.set.call(out,input as Uint8Array);return out;}
function closed(value:unknown,keys:string[]):Record<string,unknown>{if(!value||Object.getPrototypeOf(value)!==Object.prototype)bad();const descriptors=Object.getOwnPropertyDescriptors(value),found=Reflect.ownKeys(descriptors);if(found.length!==keys.length||found.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(descriptors[k],'value')))bad();return Object.fromEntries(keys.map(k=>[k,descriptors[k].value]));}
const hash=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
function base64(bytes:Uint8Array){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
function serialized(value:{format_version:1;stage:string;case_id:string;byte_size:number;sha256:string;base64_json:string}){const packet=JSON.stringify(value);if(encoder.encode(packet).length>L.packet||encoder.encode(JSON.stringify({r3SourceObservation:packet})).length>L.packet)bad();return packet;}
export async function encodeR3SourcePacket(caseId:unknown,artifact:unknown):Promise<string>{try{if(typeof caseId!=='string'||!J1_CASES.includes(caseId))bad();const value=closed(artifact,['bytes','sha256']),bytes=copy(value.bytes),expected=value.sha256;if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||await hash(bytes)!==expected)bad();return serialized({format_version:1,stage:'j1-safe-observation',case_id:caseId,byte_size:bytes.length,sha256:expected,base64_json:base64(bytes)});}catch{bad();}}
export async function decodeR3SourcePacket(input:unknown):Promise<{case_id:string;bytes:Uint8Array;sha256:string}>{try{
 if(typeof input!=='string'||input.length>L.packet||encoder.encode(input).length>L.packet||encoder.encode(JSON.stringify({r3SourceObservation:input})).length>L.packet)bad();
 const v=closed(JSON.parse(input),['format_version','stage','case_id','byte_size','sha256','base64_json']);
 if(v.format_version!==1||v.stage!=='j1-safe-observation'||typeof v.case_id!=='string'||!J1_CASES.includes(v.case_id)||typeof v.byte_size!=='number'||!Number.isSafeInteger(v.byte_size)||v.byte_size<1||v.byte_size>L.observation||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256)||typeof v.base64_json!=='string'||v.base64_json.length!==4*Math.ceil(v.byte_size/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(v.base64_json))bad();
 const binary=atob(v.base64_json);if(binary.length!==v.byte_size)bad();const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 if(base64(bytes)!==v.base64_json||await hash(bytes)!==v.sha256)bad();const canonical=serialized({format_version:1,stage:'j1-safe-observation',case_id:v.case_id,byte_size:v.byte_size,sha256:v.sha256,base64_json:v.base64_json});if(canonical!==input)bad();
 return {case_id:v.case_id,bytes,sha256:v.sha256};
 }catch{bad();}}

declare module 'vitest' { interface TaskMeta { r3SourceObservation?:string } }
