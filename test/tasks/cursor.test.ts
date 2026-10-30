import {it,expect} from 'vitest';
import {createCursorCodec,type CursorBinding,type CursorPayload} from '../../src/http/cursors';
const key='d'.repeat(64),entropy={bytes:(n:number)=>crypto.getRandomValues(new Uint8Array(n))};
const binding=(operation:'tasks'|'task-results'):CursorBinding=>({workspaceId:'ws_example',principalId:'human_operator',lane:'human',credentialId:null,sessionId:'session_task_cursor',operation,queryHash:'a'.repeat(64)});
function payload(operation:'tasks'|'task-results',large=false):CursorPayload{return {version:1,binding:binding(operation),highWater:operation==='tasks'?{createdAt:large?Number.MAX_SAFE_INTEGER:2,id:large?'z'.repeat(128):'z'}:large?Number.MAX_SAFE_INTEGER:2,lastScanned:operation==='tasks'?{createdAt:1,id:'a'}:1,expiresAt:3600001};}
it('task and history cursor lengths remain exactly 2048 regardless of hidden high-water digits',async()=>{
 const codec=createCursorCodec(key,entropy);
 for(const operation of ['tasks','task-results'] as const){const small=payload(operation),large=payload(operation,true),tokens=await Promise.all([codec.encodeCursor(small),codec.encodeCursor(large)]);expect(tokens.map(x=>x.length)).toEqual([2048,2048]);expect(tokens[0]).not.toBe(tokens[1]);expect(await codec.decodeCursor(tokens[0],small.binding,1)).toEqual(small);expect(await codec.decodeCursor(tokens[1],large.binding,1)).toEqual(large);}
});
it('task cursors reject 2049 bytes, truncation, tampering and wrong bound query or lane',async()=>{
 const codec=createCursorCodec(key,entropy);
 for(const operation of ['tasks','task-results'] as const){const original=payload(operation),token=await codec.encodeCursor(original);
  for(const invalid of [token+'A',token.slice(0,-1),token.slice(0,100)+(token[100]==='A'?'B':'A')+token.slice(101)])await expect(codec.decodeCursor(invalid,original.binding,1)).rejects.toMatchObject({code:'INVALID_REQUEST',status:400});
  for(const changed of [{...original.binding,queryHash:'b'.repeat(64)},{...original.binding,workspaceId:'ws_other'},{...original.binding,sessionId:'session_other'},{...original.binding,lane:'agent' as const,sessionId:null,credentialId:'credential_other'}])await expect(codec.decodeCursor(token,changed,1)).rejects.toMatchObject({code:'INVALID_REQUEST',status:400});
 }
});
it('continuation re-encoding preserves absolute expiry rather than sliding its lifetime',async()=>{
 const codec=createCursorCodec(key,entropy),original=payload('task-results'),token=await codec.encodeCursor(original);
 const decoded=await codec.decodeCursor(token,original.binding,original.expiresAt-2),continued=await codec.encodeCursor({...decoded,lastScanned:2});
 expect((await codec.decodeCursor(continued,original.binding,original.expiresAt-1)).expiresAt).toBe(original.expiresAt);
 await expect(codec.decodeCursor(continued,original.binding,original.expiresAt)).rejects.toMatchObject({code:'CURSOR_EXPIRED',status:410});
});
it('unrepresentable padded payload fails closed and does not create oversized continuation',async()=>{
 const codec=createCursorCodec(key,entropy),original=payload('tasks');
 await expect(codec.encodeCursor({...original,highWater:{createdAt:2,id:'z'.repeat(2048)}})).rejects.toMatchObject({code:'INTERNAL_ERROR',status:500});
});
