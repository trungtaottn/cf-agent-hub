import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema=JSON.parse(readFileSync(new URL('../spec/import-batch.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:true,allErrors:true});addFormats(ajv);ajv.addSchema(schema);
const envelope=ajv.compile({$ref:schema.$id+'#/$defs/ImportEnvelope'});
const row=ajv.compile({$ref:schema.$id+'#/$defs/ImportRow'});
const rejected=code=>({envelope_error:code,rows:[]});

/** Static fixture inspection only, not production transport or domain validation.
 * Input is the actual raw JSON byte stream, never a canonicalized object.
 * No network, reference lookup, task/mapping mutation or preview is performed.
 * code:null means shape-valid only, not authorized or eligible for creation.
 */
export function inspectImportInput(bytes){
 if(!(bytes instanceof Uint8Array))return rejected('INVALID_REQUEST');
 if(bytes.byteLength>65536)return rejected('LIMIT_EXCEEDED');
 let value;
 try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}
 catch{return rejected('INVALID_REQUEST');}
 if(!envelope(value))return rejected('INVALID_REQUEST');
 return {envelope_error:null,rows:value.rows.map((value,index)=>{
  const valid=row(value);
  // Invalid input, including a syntactically valid identifier alongside a
  // secret/unknown field, must not leak through a rejected-row projection.
  return {index,external_id:valid?value.external_id:null,code:valid?null:'INVALID_ROW'};
 })};
}
