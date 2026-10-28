import {clientOperations} from '../../../src/http/generated/client-operations';
import type {EnabledOperationId} from './types';
import {ClientFault} from './transport';
const record=(x:unknown):x is Record<string,unknown>=>typeof x==='object'&&x!==null&&!Array.isArray(x);
export function snapshot<T>(value:T):T{
 const walk=(x:unknown):void=>{if(typeof x==='number'&&!Number.isFinite(x)||typeof x==='bigint'||typeof x==='function'||typeof x==='symbol')throw new ClientFault('INVALID_REQUEST');if(Array.isArray(x)){for(const y of x)walk(y);}else if(record(x)){if(Object.getPrototypeOf(x)!==Object.prototype&&Object.getPrototypeOf(x)!==null)throw new ClientFault('INVALID_REQUEST');for(const y of Object.values(x))walk(y);}};
 walk(value);return JSON.parse(JSON.stringify(value)) as T;
}
export function nativeOrigin(value:unknown):string{
 if(typeof value!=='string')throw new Error('Invalid native origin');
 try{const url=new URL(value);if(url.protocol!=='https:'||url.origin!==value||url.username||url.password||url.search||url.hash||url.pathname!=='/'||value.includes('\\'))throw 0;return url.origin;}catch{throw new Error('Invalid native origin');}
}
function validateBytes(value:unknown,rules:readonly {path:readonly string[];encoding:string;maxBytes:number}[]):void{
 const encoder=new TextEncoder();for(const rule of rules){const visit=(node:unknown,path:readonly string[]):void=>{if(!path.length){if(encoder.encode(rule.encoding==='json'?JSON.stringify(node):rule.encoding==='nfc-utf8'?String(node).normalize('NFC'):String(node)).length>rule.maxBytes)throw new ClientFault('INVALID_REQUEST');}else if(path[0]==='*'){for(const item of node as unknown[])visit(item,path.slice(1));}else if(record(node)&&Object.hasOwn(node,path[0]))visit(node[path[0]],path.slice(1));};visit(value,rule.path);}
}

/** Canonical semantic JSON, not a second operation map or authorization layer. */
export function canonicalBody(value:unknown):string {
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalBody).join(',')+']';
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalBody((value as Record<string,unknown>)[key])).join(',')+'}';
}
export function prepareNativeOperation(base:string,workspace:string,operation:EnabledOperationId,input:unknown) {
 nativeOrigin(base);if(!/^[a-zA-Z0-9_-]{1,128}$/.test(workspace))throw new ClientFault('INVALID_REQUEST');
 if(typeof operation!=='string'||!Object.hasOwn(clientOperations,operation)||!clientOperations[operation].native)throw new ClientFault('OPERATION_UNAVAILABLE');
 const contract=clientOperations[operation];
 if(!(contract.validateRequest as (value:unknown)=>boolean)(input))throw new ClientFault('INVALID_REQUEST');
 const request=snapshot(input) as Record<string,unknown>;
 if(!(contract.validateRequest as (value:unknown)=>boolean)(request))throw new ClientFault('INVALID_REQUEST');validateBytes(request,contract.byteRules);
 for(const id of Object.values((request.path??{}) as Record<string,unknown>))if(id==='.'||id==='..')throw new ClientFault('INVALID_REQUEST');
 const queryValues=(request.query??{}) as Record<string,unknown>;
 if(queryValues.cursor!==undefined&&queryValues.after_sequence!==undefined)throw new ClientFault('INVALID_REQUEST');
 if(request.body!==undefined&&new TextEncoder().encode(JSON.stringify(request.body)).length>65536)throw new ClientFault('INVALID_REQUEST');
 let path:string=contract.path.replace('{workspace_id}',workspace);
 for(const [name,value]of Object.entries((request.path??{}) as Record<string,unknown>))path=path.replace('{'+name+'}',encodeURIComponent(String(value)));
 const query=new URLSearchParams();for(const [name,value]of Object.entries(queryValues))if(value!==undefined)query.set(name,String(value));query.sort();
 return {operation,method:contract.method,path,queryCanonical:query.toString(),canonicalBody:request.body===undefined?'':canonicalBody(request.body),origin:base,workspaceId:workspace,request};
}
