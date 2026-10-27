import {canonicalJson} from '../config/bootstrap';
import {HttpError} from './envelopes';
import type {Entropy} from '../workspace/context';
/** Only routes with implemented query/retention semantics may mint cursors.
 * Future task/search/history owners extend this closed map with their own bindings. */
const cursorOperations={inbox:'message',thread:'message',events:'sequence',agents:'message',credentials:'message',tasks:'message',artifacts:'message','task-results':'sequence'} as const;
export interface CursorBinding {workspaceId:string;principalId:string;lane:'human'|'agent';credentialId:string|null;sessionId:string|null;operation:keyof typeof cursorOperations;queryHash:string;}
export interface MessagePosition {createdAt:number;id:string;}
export type CursorPosition=MessagePosition|number;
export interface CursorPayload {version:1;binding:CursorBinding;highWater:CursorPosition;lastScanned:CursorPosition;expiresAt:number;}
const utf8=new TextEncoder();
const padded=(operation:CursorBinding['operation'])=>operation==='tasks'||operation==='task-results'||operation==='artifacts';
const PADDED_CLEAR_BYTES=1508; // 12 nonce + 16 GCM tag + 1508 clear => exactly 2048 base64url bytes.
const invalid=():never=>{throw new HttpError('INVALID_REQUEST',400);};
const position=(v:unknown):v is CursorPosition=>typeof v==='number'?Number.isSafeInteger(v)&&v>=0:!!v&&typeof v==='object'&&Object.keys(v).sort().join(',')==='createdAt,id'&&Number.isSafeInteger((v as MessagePosition).createdAt)&&(v as MessagePosition).createdAt>=0&&typeof (v as MessagePosition).id==='string'&&(v as MessagePosition).id.length>0;
export function comparePosition(a:CursorPosition,b:CursorPosition):number {
 if(typeof a==='number'&&typeof b==='number')return a-b;
 if(typeof a==='number'||typeof b==='number')return invalid();
 if(a.createdAt!==b.createdAt)return a.createdAt-b.createdAt;
 const left=utf8.encode(a.id),right=utf8.encode(b.id);for(let i=0;i<Math.min(left.length,right.length);i++)if(left[i]!==right[i])return left[i]-right[i];return left.length-right.length;
}
function validBinding(value:unknown):value is CursorBinding {
 if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='credentialId,lane,operation,principalId,queryHash,sessionId,workspaceId')return false;
 const b=value as CursorBinding;
 const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
 return id(b.workspaceId)&&id(b.principalId)&&typeof b.queryHash==='string'&&/^[a-f0-9]{64}$/.test(b.queryHash)&&
  typeof b.operation==='string'&&Object.hasOwn(cursorOperations,b.operation)&&
  (b.lane==='human'?b.credentialId===null&&id(b.sessionId):b.lane==='agent'&&id(b.credentialId)&&b.sessionId===null);
}
export function validCursorPayload(p:unknown,binding:CursorBinding):p is CursorPayload {
 if(!p||typeof p!=='object'||Object.keys(p).sort().join(',')!=='binding,expiresAt,highWater,lastScanned,version')return false;
 const c=p as CursorPayload;
 return c.version===1&&validBinding(binding)&&validBinding(c.binding)&&canonicalJson(c.binding)===canonicalJson(binding)&&Number.isSafeInteger(c.expiresAt)&&c.expiresAt>0&&position(c.highWater)&&position(c.lastScanned)&&
 (cursorOperations[binding.operation]==='sequence')===(typeof c.highWater==='number')&&typeof c.highWater===typeof c.lastScanned&&comparePosition(c.lastScanned,c.highWater)<=0;
}
const base64=(bytes:Uint8Array)=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');};
/** Key material is a separate managed 256-bit secret, never a bearer verifier or public configuration. */
export function createCursorCodec(keyHex:string,entropy:Entropy){
 if(!/^[a-f0-9]{64}$/i.test(keyHex))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 const keyBytes=Uint8Array.from(keyHex.match(/../g)!,x=>parseInt(x,16));
 const key=()=>crypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
 return {
  async encodeCursor(payload:CursorPayload):Promise<string>{
   if(!validCursorPayload(payload,payload.binding))return invalid();
   const nonce=new Uint8Array(entropy.bytes(12));if(nonce.byteLength!==12)throw new HttpError('INTERNAL_ERROR',500);
   let clear=utf8.encode(canonicalJson(payload));
   if(padded(payload.binding.operation)){if(clear.byteLength>PADDED_CLEAR_BYTES)throw new HttpError('INTERNAL_ERROR',500);const fixed=new Uint8Array(PADDED_CLEAR_BYTES).fill(32);fixed.set(clear);clear=fixed;}
   const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:utf8.encode(canonicalJson(payload.binding)),tagLength:128},await key(),clear));
   const bytes=new Uint8Array(12+ciphertext.length);bytes.set(nonce);bytes.set(ciphertext,12);return base64(bytes);
  },
  async decodeCursor(token:string,expectedBinding:CursorBinding,nowMs:number):Promise<CursorPayload>{
   if(!validBinding(expectedBinding)||!/^[A-Za-z0-9_-]+$/.test(token)||token.length<40||padded(expectedBinding.operation)&&token.length!==2048)return invalid();
   let payload:unknown;
   try{
    const bytes=Uint8Array.from(atob(token.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-token.length%4)%4)),x=>x.charCodeAt(0));
    if(base64(bytes)!==token)return invalid();
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:utf8.encode(canonicalJson(expectedBinding)),tagLength:128},await key(),bytes.slice(12));
    payload=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(clear));
   }catch{return invalid();}
   if(!validCursorPayload(payload,expectedBinding))return invalid();
   if(payload.expiresAt<=nowMs)throw new HttpError('CURSOR_EXPIRED',410);
   return payload;
  }
 };
}
