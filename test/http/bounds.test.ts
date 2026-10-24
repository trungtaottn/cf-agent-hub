import {it,expect} from 'vitest';
import {parseBoundedJson} from '../../src/http/bounds';
import {fingerprintRequest} from '../../src/workspace/idempotency';
const input=(body='hello',refs:unknown[]=[])=>({recipient_agent_ids:['agent_research'],body,refs,artifact_ids:[]});
function request(value:unknown,headers:Record<string,string>={}) {return new Request('https://hub.example.invalid/command',{method:'POST',headers:{'content-type':'application/json',...headers},body:typeof value==='string'?value:JSON.stringify(value)});}
it('multibyte_32768_and_65536_boundaries',async()=>{
 for(const bytes of [32767,32768])await expect(parseBoundedJson(request(input('😀'.repeat(8191)+'a'.repeat(bytes-32764))),'MessageCreateRequest')).resolves.toHaveProperty('body');
 await expect(parseBoundedJson(request(input('😀'.repeat(8192)+'a')),'MessageCreateRequest')).rejects.toMatchObject({status:413,code:'LIMIT_EXCEEDED'});
 for(const bytes of [65535,65536])await expect(parseBoundedJson(request('{}'+' '.repeat(bytes-2)),'AuthLogoutRequest')).resolves.toEqual({});
 await expect(parseBoundedJson(request('{}'+' '.repeat(65535)),'AuthLogoutRequest')).rejects.toMatchObject({status:413});
});
it('chunked_and_false_content_length_cannot_bypass_limit',async()=>{
 let cancelled=false,reads=0;
 const stream=new ReadableStream<Uint8Array>({pull(c){reads++;c.enqueue(new Uint8Array(32769).fill(32));},cancel(){cancelled=true;}});
 const req=new Request('https://hub.example.invalid/command',{method:'POST',headers:{'content-type':'application/json','content-length':'2'},body:stream,duplex:'half'} as RequestInit);
 await expect(parseBoundedJson(req,'AuthLogoutRequest')).rejects.toMatchObject({status:413});
 expect(cancelled).toBe(true);expect(reads).toBeLessThanOrEqual(3);
 for(const length of ['2','999999'])await expect(parseBoundedJson(request('{}',{'content-length':length}),'AuthLogoutRequest')).resolves.toEqual({});
});
it('canonical_references_8192_and_unknown_nested_fields',async()=>{
 const overhead=new TextEncoder().encode(JSON.stringify([{kind:'message',id:''}])).length;
 for(const bytes of [8191,8192])await expect(parseBoundedJson(request(input('hello',[{kind:'message',id:'a'.repeat(bytes-overhead)}])),'MessageCreateRequest')).resolves.toHaveProperty('refs');
 await expect(parseBoundedJson(request(input('hello',[{kind:'message',id:'a'.repeat(8193-overhead)}])),'MessageCreateRequest')).rejects.toMatchObject({status:413});
 await expect(parseBoundedJson(request(input('hello',[{kind:'message',id:'m',secret:'canary'}])),'MessageCreateRequest')).rejects.toMatchObject({status:400});
 for(const value of ['{','null','[]','1','{"extra":1}'])await expect(parseBoundedJson(request(value),'AuthLogoutRequest')).rejects.toMatchObject({status:400});
 await expect(parseBoundedJson(new Request('https://hub.example.invalid',{method:'POST',body:new Uint8Array([0xff])}),'AuthLogoutRequest')).rejects.toMatchObject({status:400});
});
it('canonical_key_order_replays_array_order_conflicts_and_null_is_distinct',async()=>{
 const fingerprint=(body:unknown,query:unknown={})=>fingerprintRequest('post','/canonical',query,body);
 expect(await fingerprint({a:1,b:[1,2]})).toBe(await fingerprint({b:[1,2],a:1}));
 expect(await fingerprint({a:1,b:[1,2]})).not.toBe(await fingerprint({a:1,b:[2,1]}));
 expect(await fingerprint({})).not.toBe(await fingerprint({a:null}));
 expect(await fingerprint({}, {limit:50,cursor:'x'})).toBe(await fingerprint({}, {cursor:'x',limit:50}));
 for(const invalid of [{value:undefined},[undefined],{value:NaN}])await expect(fingerprint(invalid)).rejects.toMatchObject({code:'INVALID_REQUEST'});
});
