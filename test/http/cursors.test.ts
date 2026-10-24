import {it,expect} from 'vitest';
import {createCursorCodec,comparePosition,type CursorBinding,type CursorPayload} from '../../src/http/cursors';
const entropy={bytes:(n:number)=>crypto.getRandomValues(new Uint8Array(n))};
const codec=createCursorCodec('a'.repeat(64),entropy);
const binding:CursorBinding={workspaceId:'ws_a',principalId:'principal_a',lane:'agent',credentialId:'credential_a',sessionId:null,operation:'inbox',queryHash:'f'.repeat(64)};
const payload:CursorPayload={version:1,binding,highWater:{createdAt:123,id:'hidden_high_water'},lastScanned:{createdAt:122,id:'hidden_scanned_id'},expiresAt:3600000};
it('cursor_bytes_do_not_disclose_hidden_scanned_ids_and_use_fresh_96_bit_nonce',async()=>{
 const first=await codec.encodeCursor(payload),second=await codec.encodeCursor(payload);
 expect(first).not.toBe(second);
 const decode=(token:string)=>Buffer.from(token,'base64url');
 expect(decode(first).subarray(0,12)).not.toEqual(decode(second).subarray(0,12));
 for(const token of [first,second]){const text=decode(token).toString();expect(text).not.toContain('hidden_scanned_id');expect(text).not.toContain('principal_a');expect(await codec.decodeCursor(token,binding,100)).toEqual(payload);}
});
it('cursor_from_other_workspace_principal_credential_lane_operation_or_filter_denied',async()=>{
 const token=await codec.encodeCursor(payload);
 for(const change of [{workspaceId:'ws_b'},{principalId:'principal_b'},{credentialId:'other'},{lane:'human' as const,credentialId:null,sessionId:'session'},{operation:'events' as const},{queryHash:'e'.repeat(64)}])await expect(codec.decodeCursor(token,{...binding,...change},100)).rejects.toMatchObject({code:'INVALID_REQUEST',status:400});
 await expect(createCursorCodec('b'.repeat(64),entropy).decodeCursor(token,binding,100)).rejects.toMatchObject({status:400});
});
it('tampered_expired_malformed_cursor_denied_without_contents',async()=>{
 const token=await codec.encodeCursor(payload);
 for(const broken of [token.slice(0,24)+(token[24]==='A'?'B':'A')+token.slice(25),token+'=',token.slice(0,-1),'<raw>',''])await expect(codec.decodeCursor(broken,binding,100)).rejects.toMatchObject({code:'INVALID_REQUEST',status:400});
 await expect(codec.decodeCursor(token,binding,3600000)).rejects.toMatchObject({code:'CURSOR_EXPIRED',status:410});
 expect(()=>createCursorCodec('bad',entropy)).toThrowError(expect.objectContaining({status:503}));
});
it('cursor_preserves_opaque_unicode_positions_and_sql_utf8_order',async()=>{
 expect(comparePosition({createdAt:1,id:'\uE000'},{createdAt:1,id:'😀'})).toBeLessThan(0);
 const long={...payload,highWater:{createdAt:1,id:'Ω'.repeat(20000)+'😀'},lastScanned:{createdAt:1,id:'Ω'.repeat(20000)}};
 const token=await codec.encodeCursor(long);expect(await codec.decodeCursor(token,binding,0)).toEqual(long);
});
