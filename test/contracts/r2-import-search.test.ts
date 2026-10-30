import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const row=():Record<string,unknown>=>({external_id:'external_1',source_updated_at:null,title:'Imported work',description:'Untrusted source text',project_id:null,work_role_id:null,source_state:'Done',source_ref:null});
const batch=()=>({source_namespace:'example',source_revision:'revision_1',rows:[row()]});
function validate(value:unknown,definition?:string){
 const schema=JSON.parse(readFileSync(new URL('../../spec/import-batch.schema.json',import.meta.url),'utf8'));
 const ajv=new Ajv2020({strict:true,allErrors:true});addFormats(ajv);ajv.addSchema(schema);
 return ajv.compile({$ref:schema.$id+(definition?'#/$defs/'+definition:'')})(value);
}
async function inspect(bytes:Uint8Array){
 // @ts-expect-error Static Node contract verifier has no product TypeScript dependency.
 const {inspectImportInput}=await import('../../scripts/verify-r2-import-input.mjs');
 return inspectImportInput(bytes);
}
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));

describe('import_bounds_and_closed_rows',()=>{
 it('accepts the closed canonical batch without changing its source state or input',()=>{const value=batch(),before=structuredClone(value);expect(validate(value)).toBe(true);expect(value).toEqual(before);});
 for(const count of [0,100,101])it(`bounds ${count} rows`,()=>expect(validate({...batch(),rows:Array.from({length:count},(_,i)=>({...row(),external_id:'external_'+i}))})).toBe(count<=100));
 for(const field of Object.keys(batch()))it(`requires batch ${field}`,()=>{const value:Record<string,unknown>=batch();delete value[field];expect(validate(value)).toBe(false);});
 for(const field of Object.keys(row()))it(`requires row ${field}`,()=>{const value=row();delete value[field];expect(validate({...batch(),rows:[value]})).toBe(false);});
 for(const field of ['owner','assigned_agent_id','credential','token','grants','approval','approval_id','fence','run','result','url','unreviewed'])it(`rejects row authority/unknown ${field}`,()=>expect(validate({...batch(),rows:[{...row(),[field]:'sensitive-value'}]})).toBe(false));
 for(const field of ['external_id','title','description','source_state'])it(`rejects wrong type for ${field}`,()=>expect(validate({...batch(),rows:[{...row(),[field]:42}]})).toBe(false));
 for(const field of ['source_namespace','source_revision'])it(`rejects wrong type for ${field}`,()=>expect(validate({...batch(),[field]:42})).toBe(false));
 it('rejects empty identifiers without rejecting empty revision or source state',()=>{expect(validate({...batch(),source_namespace:''})).toBe(false);expect(validate({...batch(),rows:[{...row(),external_id:''}]})).toBe(false);expect(validate({...batch(),source_revision:'',rows:[{...row(),source_state:''}]})).toBe(true);});
 it('keeps duplicate external IDs for later semantic conflict handling',()=>expect(validate({...batch(),rows:[row(),row()]})).toBe(true));
 it('rejects unknown envelope authority',()=>expect(validate({...batch(),owner:'human_other'})).toBe(false));
 for(const [field,max]of [['external_id',128],['source_state',64],['source_ref',2048]] as const){
  for(const size of [max,max+1])it(`${field} Unicode code points ${size}`,()=>expect(validate({...batch(),rows:[{...row(),[field]:'😀'.repeat(size)}]})).toBe(size<=max));
 }
 for(const [field,max]of [['source_namespace',128],['source_revision',256]] as const){
  for(const size of [max,max+1])it(`${field} Unicode code points ${size}`,()=>expect(validate({...batch(),[field]:'😀'.repeat(size)})).toBe(size<=max));
 }
 for(const stamp of [null,'2026-10-27T00:00:00Z','2026-10-27T00:00:00z','2026-10-27T00:00:00+00:00','2026-10-27T00:00:00.123456Z'])it(`accepts UTC timestamp ${stamp}`,()=>expect(validate({...batch(),rows:[{...row(),source_updated_at:stamp}]})).toBe(true));
 for(const stamp of ['2026-02-30T00:00:00Z','2026-10-27','2026-10-27T00:00:00','2026-10-27T00:00:00+01:00','2026-10-27T00:00:00-00:00',1])it(`rejects invalid/non-UTC timestamp ${stamp}`,()=>expect(validate({...batch(),rows:[{...row(),source_updated_at:stamp}]})).toBe(false));
 for(const field of ['project_id','work_role_id'])for(const value of [null,'id_a',''])it(`${field} ${JSON.stringify(value)}`,()=>expect(validate({...batch(),rows:[{...row(),[field]:value}]})).toBe(value!==''));
 it('preserves Task title/description semantics',()=>{expect(validate({...batch(),rows:[{...row(),title:'',description:''}]})).toBe(false);expect(validate({...batch(),rows:[{...row(),description:''}]})).toBe(true);});
 it('keeps source references inert unrestricted text, not URI format or execution authority',()=>expect(validate({...batch(),rows:[{...row(),source_ref:'not a URL; fetch nothing'}]})).toBe(true));
 it('separates closed envelope admission from invalid rows',()=>{const value={...batch(),rows:[row(),null,{...row(),owner:'secret'}]};expect(validate(value,'ImportEnvelope')).toBe(true);expect(validate(value)).toBe(false);expect(validate({...value,owner:'secret'},'ImportEnvelope')).toBe(false);});
 for(const size of [65536,65537])it(`counts raw envelope whitespace at ${size} bytes`,async()=>{const json=JSON.stringify(batch()),bytes=new TextEncoder().encode(json+' '.repeat(size-new TextEncoder().encode(json).length));expect(bytes.length).toBe(size);expect((await inspect(bytes)).envelope_error).toBe(size===65536?null:'LIMIT_EXCEEDED');});
 for(const size of [65536,65537])it(`counts envelope overhead and multibyte content at ${size} bytes`,async()=>{const value=batch();value.rows[0].description='😀'.repeat(1000);const initial=encode(value).length;value.rows[0].description+='x'.repeat(size-initial);const bytes=encode(value);expect(bytes.length).toBe(size);expect((await inspect(bytes)).envelope_error).toBe(size===65536?null:'LIMIT_EXCEEDED');});
 it('rejects malformed JSON, UTF-8 and envelope without row details',async()=>{for(const bytes of [new Uint8Array([0xff]),new TextEncoder().encode('{'),encode({...batch(),owner:'secret'}),encode({...batch(),rows:Array(101).fill(row())})])expect(await inspect(bytes)).toEqual({envelope_error:'INVALID_REQUEST',rows:[]});});
 it('redacts rejected row identifiers and unknown secrets without mutating input',async()=>{const value={...batch(),rows:[row(),{...row(),external_id:'secret',token:'credential-secret'},{...row(),external_id:'x'.repeat(129)},null]},before=structuredClone(value);const result=await inspect(encode(value));expect(result).toEqual({envelope_error:null,rows:[{index:0,external_id:'external_1',code:null},{index:1,external_id:null,code:'INVALID_ROW'},{index:2,external_id:null,code:'INVALID_ROW'},{index:3,external_id:null,code:'INVALID_ROW'}]});expect(JSON.stringify(result)).not.toContain('secret');expect(value).toEqual(before);});
 it('does not resolve references, assign dispositions or fetch source refs',async()=>{const value=batch();Object.assign(value.rows[0],{project_id:'unverified_project',source_ref:'https://example.invalid/never-fetch'});expect(await inspect(encode(value))).toEqual({envelope_error:null,rows:[{index:0,external_id:'external_1',code:null}]});});
});
