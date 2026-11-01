import {ToolSchema} from '@modelcontextprotocol/sdk/types.js';
import contract from '../../../docs/contracts/mcp-stdio-tools.json';
import {prepareNativeOperation} from '../../client/src/native-request';
import {clientOperations,type EnabledOperationId} from '../../../src/http/generated/client-operations';
export const manifest=contract;
const available=contract.tools.filter(tool=>tool.available);
export const tools=available.map(({name,description,inputSchema,outputSchema,annotations})=>ToolSchema.parse({name,description,inputSchema,outputSchema,annotations}));
export interface PreparedToolCall {operation:EnabledOperationId;request:Record<string,unknown>;idempotencyKey?:string;}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
/** Tool JSON is only native intent; it never becomes credentials/transport options. */
export function prepareToolCall(name:string,args:unknown,origin:string,workspaceId:string):PreparedToolCall {
 const tool=available.find(tool=>tool.name===name);if(!tool)throw Error('MCP_TOOL_UNKNOWN');
 try{
  if(!object(args)||args.workspace_id!==workspaceId)throw 0;
  const allowed=new Set(['workspace_id',...tool.pathFields,...tool.queryFields,...tool.bodyFields,...(tool.mutation?['idempotency_key']:[])]);
  if(Object.keys(args).some(key=>!allowed.has(key)))throw 0;
  const key=args.idempotency_key;if(tool.mutation&&(typeof key!=='string'||key.length<1||key.length>256||!/^[!-~]+$/.test(key)))throw 0;
  const pick=(fields:readonly string[])=>Object.fromEntries(fields.filter(field=>Object.hasOwn(args,field)).map(field=>[field,args[field]]));
  const request:Record<string,unknown>={};if(tool.pathFields.length)request.path=pick(tool.pathFields);if(tool.queryFields.some(field=>Object.hasOwn(args,field)))request.query=pick(tool.queryFields);if(tool.bodyFields.length)request.body=pick(tool.bodyFields);
  const operation=tool.operation as EnabledOperationId;
  if(!Object.hasOwn(clientOperations,operation)||!clientOperations[operation].native)throw 0;
  const prepared=prepareNativeOperation(origin,workspaceId,operation,request);
  return {operation,request:prepared.request,...(tool.mutation?{idempotencyKey:key as string}:{})};
 }catch{throw Error('MCP_INPUT_REJECTED');}
}
