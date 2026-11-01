import {describe,it,expect} from 'vitest';
import {parseHookJson} from '../../packages/observation-adapter/src/strict-json';
import {projectHook,readHookInput} from '../../packages/observation-adapter/src/claude-hook';
import {Deadline} from '../../packages/client/src/transport';
const encode=(s:string)=>new TextEncoder().encode(s);
const context={root:'/private/checkout',profile:'claude-posttooluse-path-docs-20261101-v1',observedAt:'2026-11-01T00:00:00.000Z'};
const hook=(tool='Read',extra:Record<string,unknown>={})=>({hook_event_name:'PostToolUse',cwd:context.root,tool_name:tool,tool_input:{file_path:'/private/checkout/src/É.ts',...(tool==='Write'?{content:'SECRET_CONTENT'}:tool==='Edit'?{old_string:'SECRET_OLD',new_string:'SECRET_NEW',replace_all:true}:{} )},...extra});
const project=(value:unknown,c=context)=>projectHook(encode(JSON.stringify(value)),c);
describe('closed path projection',()=>{
 for(const tool of ['Read','Write','Edit'])it(`projects_${tool}_paths_only`,()=>expect(project(hook(tool,{tool_response:{token:'SECRET_RESPONSE',fraction:0.5},transcript_path:'/secret/transcript',session_id:'UNTRUSTED',tool_use_id:'UNTRUSTED',permission_mode:'default',duration_ms:1.5}))).toEqual({observed_at:context.observedAt,relative_path:'src/É.ts',activity:tool==='Read'?'read-observed':'write-observed',source_oid:null}));
 for(const extra of [{unknown:true},{hook_event_name:'PreToolUse'},{hook_event_name:'PostToolUseFailure'},{tool_name:'Bash'},{cwd:'/other'},{tool_input:{file_path:'/private/checkout/a',path:'/private/checkout/b'}},{duration_ms:-1},{session_id:2},{tool_input:{file_path:'/private/checkout/a',offset:1.5}},{tool_input:{file_path:'/private/checkout/a',limit:0}}])it(`rejects_unknown_or_ambiguous_shape ${JSON.stringify(extra)}`,()=>expect(project(hook('Read',extra))).toBeNull());
 it('rejects_unknown_profile',()=>expect(project(hook(),{...context,profile:'other'})).toBeNull());
 for(const path of ['a','/private/checkout/../a','/private/checkout/./a','/private/checkout//a','/private/checkout/a/','/private/checkout','/private/checkout-other/a','C:\\private\\a','//private/checkout/a','/private/checkout/a\\b','/private/checkout/a\0b','/private/checkout/C:a'])it(`rejects_traversal_or_ambiguous_path ${JSON.stringify(path)}`,()=>expect(project(hook('Read',{tool_input:{file_path:path}}))).toBeNull());
 it('preserves_unicode_case_without_decoding_or_symlink_claim',()=>expect(project(hook('Read',{tool_input:{file_path:'/private/checkout/link/%2e%2e/Éé.TS'}}))).toEqual({observed_at:context.observedAt,relative_path:'link/%2e%2e/Éé.TS',activity:'read-observed',source_oid:null}));
 it('enforces_exact_path_utf8_cap',()=>{expect(project(hook('Read',{tool_input:{file_path:context.root+'/'+ 'é'.repeat(512)}}))).not.toBeNull();expect(project(hook('Read',{tool_input:{file_path:context.root+'/'+ 'é'.repeat(512)+'a'}}))).toBeNull();});
 it('validates_tool_specific_required_values',()=>{for(const value of [hook('Write',{tool_input:{file_path:context.root+'/a'}}),hook('Edit',{tool_input:{file_path:context.root+'/a',old_string:'a'}}),hook('Edit',{tool_input:{file_path:context.root+'/a',old_string:'a',new_string:'b',replace_all:1}})])expect(project(value)).toBeNull();expect(project(hook('Read',{tool_input:{file_path:context.root+'/a',offset:1,limit:2}}))).not.toBeNull();});
 it('rejects_invalid_context_timestamp_and_root',()=>{expect(project(hook(),{...context,observedAt:'bad'})).toBeNull();expect(project(hook(),{...context,root:'/private//checkout'})).toBeNull();});
});
describe('strict bounded JSON',()=>{
 it('accepts_fractional_discarded_duration_and_finite_json_numbers',()=>expect(parseHookJson(encode('{"duration_ms":1.5,"v":[-0.25,1e2,1e-3]}'))).toEqual({duration_ms:1.5,v:[-0.25,100,0.001]}));
 for(const raw of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"a":{"x":1,"x":2}}','{"v":1e999}','{"v":NaN}','{"v":"\\ud800"}','{"v":"\\udc00"}','{"a":1,}','[1,]','true false','\ufeff{}'])it(`rejects_invalid_json ${raw}`,()=>expect(()=>parseHookJson(encode(raw))).toThrow());
 it('rejects_invalid_utf8_without_raw_error',()=>{expect(()=>parseHookJson(new Uint8Array([0xc0,0x80]))).toThrow();try{parseHookJson(encode('{"SECRET_TOKEN":'));}catch(error){expect(String(error)).not.toContain('SECRET_TOKEN');}});
 it('enforces_exact_input_byte_cap',()=>{const valid='"'+'a'.repeat(1048574)+'"';expect((parseHookJson(encode(valid)) as string).length).toBe(1048574);expect(()=>parseHookJson(encode(valid+' '))).toThrow();});
 it('enforces_exact_depth_container_count',()=>{expect(parseHookJson(encode('['.repeat(16)+'0'+']'.repeat(16)))).toBeDefined();expect(()=>parseHookJson(encode('['.repeat(17)+'0'+']'.repeat(17)))).toThrow();});
 it('enforces_exact_nodes_value_count_not_keys',()=>{expect((parseHookJson(encode('['+Array(8191).fill(0).join(',')+']')) as unknown[]).length).toBe(8191);expect(()=>parseHookJson(encode('['+Array(8192).fill(0).join(',')+']'))).toThrow();expect(parseHookJson(encode('{"key":0}'))).toEqual({key:0});});
 it('projection_never_throws_or_echoes_raw_data',()=>expect(projectHook(encode('SECRET_TOKEN'),context)).toBeNull());
});
describe('bounded reader',()=>{
 const reader=(chunks:Uint8Array[],never=false)=>{let n=0;return {read:()=>n<chunks.length?Promise.resolve({done:false,value:chunks[n++]}):never?new Promise<ReadableStreamReadResult<Uint8Array>>(()=>{}):Promise.resolve({done:true,value:undefined}),cancel:()=>Promise.resolve(),releaseLock:()=>{},closed:Promise.resolve()} as ReadableStreamDefaultReader<Uint8Array>;};
 it('enforces_exact_read_attempt_cap_including_empty_and_eof',async()=>{const deadline=new Deadline(2000);try{expect(await readHookInput(reader(Array.from({length:1023},()=>new Uint8Array())),deadline)).toEqual(new Uint8Array());await expect(readHookInput(reader(Array.from({length:1024},()=>new Uint8Array())),deadline)).rejects.toThrow();}finally{deadline.dispose();}});
 it('bounds_actual_input_bytes_before_parsing',async()=>{const deadline=new Deadline(2000);try{expect((await readHookInput(reader([new Uint8Array(1048576)]),deadline)).length).toBe(1048576);await expect(readHookInput(reader([new Uint8Array(1048576),new Uint8Array(1)]),deadline)).rejects.toThrow();}finally{deadline.dispose();}});
 it('slow_input_aborts_and_does_not_wait_for_cancel',async()=>{const deadline=new Deadline(10);const r=reader([],true);r.cancel=()=>new Promise(()=>{});try{await expect(readHookInput(r,deadline)).rejects.toThrow();}finally{deadline.dispose();}});
});
