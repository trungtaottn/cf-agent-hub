import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const read=(path:string)=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url),'utf8'));
const api=read('spec/openapi.json'),schemas=api.components.schemas;
const operation=api.paths['/v2/workspaces/{workspace_id}/search'].get;
const query=operation.parameters.find((p:{name?:string})=>p.name==='q');
const fixtures=read('examples/search/literal-cases.json');
const ajv=new Ajv2020({strict:false,allErrors:true});addFormats(ajv);
const hit=()=>({kind:'task',id:'task_example',title:'Example',snippet:'Literal text',created_at:'2026-10-27T00:00:00Z'});
const validHit=ajv.compile({components:api.components,$ref:'#/components/schemas/SearchHit'});
const validResponse=ajv.compile({components:api.components,$ref:'#/components/schemas/SearchHitListResponse'});
async function helpers(){
 // @ts-expect-error Standalone static verifier has no product TypeScript dependency.
 return import('../../scripts/verify-r2-search-contract.mjs');
}

describe('literal_search_contract (static, not runtime query evidence)',()=>{
 it('defines both decoded and NFC UTF-8 query bounds',()=>{expect(query.required).toBe(true);expect(query.schema.minLength).toBe(1);expect(query.schema['x-utf8-max-bytes']).toBe(2048);expect(query.schema['x-normalized-utf8-max-bytes']).toBe(2048);});
 it('bounds snippets in Unicode code points without adding DTO fields',()=>{expect(Object.keys(schemas.SearchHit.properties).sort()).toEqual(['created_at','id','kind','snippet','title']);expect(schemas.SearchHit.properties.snippet.maxLength).toBe(256);expect(validHit({...hit(),snippet:'😀'.repeat(256)})).toBe(true);expect(validHit({...hit(),snippet:'😀'.repeat(257)})).toBe(false);});
 it('retains the hard candidate cap but requires authorized-only continuation',()=>{expect(operation['x-max-candidates']).toBe(2000);expect(operation['x-pagination-model']).toBe('authorized-results');expect(operation['x-budget-exhaustion']).toBe('DEPENDENCY_UNAVAILABLE');expect(operation['x-empty-continuation']).toBe(false);});
 it('requires padded AEAD and operation-aware retention',()=>{expect(operation['x-cursor-confidentiality']).toBe('padded-aead');expect(operation['x-search-retention']).toEqual({message_inclusive:'proven-message-floor',task_artifact_only:'no-message-floor'});});
 it('keeps both actor lanes and current underlying scopes without R1 activation',()=>{expect(operation.operationId).toBe('searchWorkspace');expect(operation.security).toEqual([{NativeBearer:[]},{HumanSession:[]}]);expect(operation['x-required-scopes']).toEqual(['search:read']);expect(operation['x-actor-kind']).toBe('both');expect(operation['x-r1-available']).toBe(false);for(const scope of ['tasks:read','messages:read','artifacts:read'])expect(operation.description).toContain(scope);});
 it('preserves Task and Page canonical schemas exactly',()=>{const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');expect(digest(schemas.Task)).toBe('1f82d7270f5974881a7b85b730e2539ea4e391805a4e808d84a1aec2c5897522');expect(digest(schemas.Page)).toBe('7b29c73aae3ea6c5d4c6d1812547911483a09b2a20cc650575d60856b9a54763');});
 for(const field of ['total','scanned_count','last_scanned','high_water'])it(`does not expose ${field} at hit, page or response`,()=>{const response={data:[hit()],page:{has_more:false,next_cursor:null},request_id:'req_example'};expect(validHit({...hit(),[field]:'hidden'})).toBe(false);expect(validResponse({...response,[field]:'hidden'})).toBe(false);expect(validResponse({...response,page:{...response.page,[field]:'hidden'}})).toBe(false);});
 it('accepts an empty terminal success without a progress cursor',()=>expect(validResponse({data:[],page:{has_more:false,next_cursor:null},request_id:'req_example'})).toBe(true));
 it('rejects hidden-only empty progress even with a syntactically valid cursor',()=>expect(validResponse({data:[],page:{has_more:true,next_cursor:'opaque_example'},request_id:'req_example'})).toBe(false));
 it('accepts nonempty authorized continuation with an opaque token',()=>expect(validResponse({data:[hit()],page:{has_more:true,next_cursor:'opaque_example'},request_id:'req_example'})).toBe(true));
 it('rejects has_more true with null cursor',()=>expect(validResponse({data:[hit()],page:{has_more:true,next_cursor:null},request_id:'req_example'})).toBe(false));
 it('rejects has_more false with a progress cursor',()=>expect(validResponse({data:[hit()],page:{has_more:false,next_cursor:'opaque_example'},request_id:'req_example'})).toBe(false));
 it('rejects an empty-string continuation token',()=>expect(validResponse({data:[hit()],page:{has_more:true,next_cursor:''},request_id:'req_example'})).toBe(false));
 for(const size of [2048,2049])it(`bounds encoded continuation at ${size} ASCII bytes`,()=>expect(validResponse({data:[hit()],page:{has_more:true,next_cursor:'a'.repeat(size)},request_id:'req_example'})).toBe(size===2048));
 it('rejects multibyte non-base64url continuation rather than mistaking characters for encoded bytes',()=>expect(validResponse({data:[hit()],page:{has_more:true,next_cursor:'😀'.repeat(2048)},request_id:'req_example'})).toBe(false));
 for(const fixture of fixtures.cases)it(`literal fixture ${fixture.name}`,async()=>{const {literalSearchMatch}=await helpers();expect(literalSearchMatch(fixture.text,fixture.query)).toBe(fixture.matches);});
 for(const count of [2048,2049])it(`decoded ASCII query ${count} bytes`,async()=>{const {normalizeSearchQuery}=await helpers();if(count===2048)expect(normalizeSearchQuery('x'.repeat(count))).toBe('x'.repeat(count));else expect(()=>normalizeSearchQuery('x'.repeat(count))).toThrow('LIMIT_EXCEEDED');});
 for(const count of [512,513])it(`astral query ${count*4} UTF-8 bytes`,async()=>{const {normalizeSearchQuery}=await helpers();if(count===512)expect(normalizeSearchQuery('😀'.repeat(count))).toBe('😀'.repeat(count));else expect(()=>normalizeSearchQuery('😀'.repeat(count))).toThrow('LIMIT_EXCEEDED');});
 it('rejects NFC expansion beyond bound even when raw decoded query fits',async()=>{const {normalizeSearchQuery}=await helpers();const input='\u0344'.repeat(1024);expect(Buffer.byteLength(input)).toBe(2048);expect(Buffer.byteLength(input.normalize('NFC'))).toBe(4096);expect(()=>normalizeSearchQuery(input)).toThrow('LIMIT_EXCEEDED');});
 it('rejects oversized decoded query even when NFC would shrink it below bound',async()=>{const {normalizeSearchQuery}=await helpers();const input='e\u0301'.repeat(683);expect(Buffer.byteLength(input)).toBe(2049);expect(Buffer.byteLength(input.normalize('NFC'))).toBe(1366);expect(()=>normalizeSearchQuery(input)).toThrow('LIMIT_EXCEEDED');});
 for(const value of ['',null,42,{}])it(`rejects invalid query ${JSON.stringify(value)} without coercion`,async()=>{const {normalizeSearchQuery}=await helpers();expect(()=>normalizeSearchQuery(value)).toThrow('INVALID_REQUEST');});
 it('snippets normalize then truncate by code point without splitting astral characters',async()=>{const {searchSnippet}=await helpers();const input='e\u0301'+'😀'.repeat(256);expect(searchSnippet(input)).toBe('é'+'😀'.repeat(255));expect(Array.from(searchSnippet(input))).toHaveLength(256);});
 it('leaves short normalized snippets unchanged and rejects non-text input',async()=>{const {searchSnippet,literalSearchMatch}=await helpers();expect(searchSnippet('cafe\u0301')).toBe('café');expect(()=>searchSnippet(null)).toThrow('INVALID_REQUEST');expect(()=>literalSearchMatch(42,'a')).toThrow('INVALID_REQUEST');});
 it('checks named static fixture collection without pretending to query resources',async()=>{const {run}=await helpers();expect(run()).toEqual({scope:'static-search-scalar-contract',cases:fixtures.cases.length});expect(fixtures.status).toBe('static-contract-only');expect(fixtures.cases.length).toBeGreaterThan(0);});
});
