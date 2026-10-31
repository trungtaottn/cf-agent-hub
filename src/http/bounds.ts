import {httpSchemas,type HttpSchemaName} from './generated/http-schemas';
import {canonicalJson} from '../config/bootstrap';
import {HttpError} from './envelopes';
const encoder=new TextEncoder();
/** Count actual streamed bytes, irrespective of Content-Length, before decoding or parsing. */
export async function parseBoundedJson(request:Request,schema:HttpSchemaName,schemaValidationValue?:(value:unknown)=>unknown):Promise<unknown>{
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new HttpError('INVALID_REQUEST',400);
 const reader=request.body?.getReader();if(!reader)throw new HttpError('INVALID_REQUEST',400);
 let total=0;const chunks:Uint8Array[]=[];
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;
   if(total>65536)throw new HttpError('LIMIT_EXCEEDED',413);chunks.push(value);
  }
 }finally{try{await reader.cancel();}catch{/* Cancellation errors never replace the bounded failure. */}reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let value:unknown;
 try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{throw new HttpError('INVALID_REQUEST',400);}
 const checked=schemaValidationValue?schemaValidationValue(value):value;
 if(checked!==null&&(typeof checked==='object'||typeof checked==='function')&&typeof (checked as {then?:unknown}).then==='function'){void Promise.resolve(checked).catch(()=>{});throw new HttpError('INTERNAL_ERROR',500);}
 const contract=httpSchemas[schema];if(!contract||!contract.validate(checked))throw new HttpError('INVALID_REQUEST',400);
 // Rules are generated from the canonical schema's custom byte annotations.
 for(const rule of contract.byteRules){
  const walk=(node:unknown,path:readonly string[]):void=>{
   if(!path.length){
    if(encoder.encode(rule.encoding==='json'?canonicalJson(node):node as string).byteLength>rule.maxBytes)throw new HttpError('LIMIT_EXCEEDED',413);
   }else if(path[0]==='*'){for(const item of node as unknown[])walk(item,path.slice(1));}
   else if(node!==null&&typeof node==='object'&&Object.hasOwn(node,path[0]))walk((node as Record<string,unknown>)[path[0]],path.slice(1));
  };walk(checked,rule.path);
 }
 return value;
}
