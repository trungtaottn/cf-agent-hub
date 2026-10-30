import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const api=JSON.parse(readFileSync(new URL('../../spec/openapi.json',import.meta.url),'utf8'));
const path='/v2/workspaces/{workspace_id}/tasks/{task_id}/results';
let validator:ReturnType<Ajv2020['compile']>|undefined;
function valid(value:unknown){if(!validator){const ajv=new Ajv2020({strict:false});addFormats(ajv);validator=ajv.compile({components:api.components,$ref:'#/components/schemas/TaskResultListResponse'});}return validator(value);}
const row=()=>({summary:'Synthetic retained result',artifact_ids:['artifact_a'],run_id:'run_a',submitted_by:{kind:'agent',principal_id:'agent_a',agent_id:'agent_a'},submitted_at:'2026-10-26T15:00:00Z'});
const page=()=>({data:[row()],page:{next_cursor:null,has_more:false},request_id:'request_a'});
describe('additive R2 historical result public contract',()=>{
 it('declares authorized read lanes without enabling an R1 route',()=>{
  const op=api.paths[path]?.get;expect(op).toBeDefined();expect(op.operationId).toBe('listTaskResults');expect(op.security).toEqual([{NativeBearer:[]},{HumanSession:[]}]);expect(op['x-required-scopes']).toEqual(['tasks:read']);expect(op['x-r1-available']).toBe(false);expect(op.requestBody).toBeUndefined();expect(op.parameters).toEqual([{$ref:'#/components/parameters/Cursor'},{$ref:'#/components/parameters/ListLimit'}]);
 });
 it('uses authorized lookahead rather than hidden candidate continuation',()=>{
  const op=api.paths[path]?.get;expect(op?.['x-pagination-visibility']).toBe('authorized-results-only');expect(op?.['x-max-response-bytes']).toBe(1048576);expect(op?.['x-query-work-proof-required']).toBe(true);
 });
 it('provides sanitized failure contracts and no-store success',()=>{
  const op=api.paths[path]?.get;expect(op?.responses['200'].headers['Cache-Control'].schema.const).toBe('no-store');for(const status of [400,401,403,404,410,429,500,503])expect(op?.responses[String(status)]).toBeDefined();
 });
 it('preserves canonical Task and TaskResult byte semantics',()=>{
  const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');expect(hash(api.components.schemas.Task)).toBe('1f82d7270f5974881a7b85b730e2539ea4e391805a4e808d84a1aec2c5897522');expect(hash(api.components.schemas.TaskResult)).toBe('1e7f3d09ab0dbbe1c4dae27d07df06d3eba54cc4f841365c1e9cd5d4b7c0eb15');
 });
 it('accepts canonical retained results and empty final page',()=>{expect(valid(page())).toBe(true);expect(valid({...page(),data:[]})).toBe(true);});
 for(const key of ['data','page','request_id'])it('requires '+key,()=>{const p:Record<string,unknown>=page();delete p[key];expect(valid(p)).toBe(false);});
 it('rejects extra response fields and excessive result count',()=>{expect(valid({...page(),hidden_count:1})).toBe(false);expect(valid({...page(),data:Array.from({length:201},row)})).toBe(false);});
 it('rejects altered result DTO and malformed evidence',()=>{
  for(const value of [{...row(),sequence:1},{...row(),submitted_at:'bad'}, {...row(),artifact_ids:Array.from({length:6},(_,i)=>'a'+i)}])expect(valid({...page(),data:[value]})).toBe(false);
 });
});
