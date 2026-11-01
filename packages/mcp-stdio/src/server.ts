import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {InitializeRequestSchema,ListToolsRequestSchema,CallToolRequestSchema,ErrorCode,McpError} from '@modelcontextprotocol/sdk/types.js';
import type {Readable,Writable} from 'node:stream';
import {BoundedStdioTransport} from './transport';
import {tools} from './tool-registry';
import {toToolResult} from './native-results';
import type {McpHost} from './host';
export interface StdioSession {finished:Promise<void>;close():Promise<void>;}
/** Pinned transport only. Negotiation never enrolls or creates native domain state. */
export async function startStdio(host:McpHost,input:Readable=process.stdin,output:Writable=process.stdout,diagnostic:(text:string)=>void=text=>{process.stderr.write(text+'\n');}):Promise<StdioSession>{
 const transport=new BoundedStdioTransport(input,output,text=>host.assertNoSecrets(text),diagnostic);
 const server=new Server({name:'cf-agent-hub-mcp-stdio',version:'0.1.0'},{capabilities:{tools:{}}});
 let offered=false,initialized=false,pending:Promise<unknown>|undefined,finishing=false;
 let finishedResolve!:()=>void;const finished=new Promise<void>(resolve=>{finishedResolve=resolve;});
 const unavailable=()=>({isError:true,content:[{type:'text' as const,text:'Outcome requires reconciliation. Retain the original intent; no automatic retry.'}]});
 const ready=()=>{if(!initialized||transport.closed)throw new McpError(ErrorCode.InvalidRequest,'Protocol state unavailable');};
 server.setRequestHandler(InitializeRequestSchema,()=>{
  if(offered||transport.closed)throw new McpError(ErrorCode.InvalidRequest,'Protocol state unavailable');offered=true;
  return {protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'cf-agent-hub-mcp-stdio',version:'0.1.0'}};
 });
 server.oninitialized=()=>{if(!offered||initialized){void transport.close();return;}initialized=true;};
 server.setRequestHandler(ListToolsRequestSchema,request=>{ready();if(request.params?.cursor!==undefined)throw new McpError(ErrorCode.InvalidParams,'Invalid cursor');return {tools};});
 server.setRequestHandler(CallToolRequestSchema,async request=>{
  ready();if(request.params.task!==undefined)throw new McpError(ErrorCode.InvalidParams,'Unsupported operation');
  if(pending)return {isError:true,content:[{type:'text' as const,text:'Adapter busy. No additional native request was dispatched.'}]};
  const running=host.call(request.params.name,request.params.arguments);pending=running;
  try{return toToolResult(await running,text=>host.assertNoSecrets(text));}
  catch(error){
   if(error instanceof Error&&['MCP_TOOL_UNKNOWN','MCP_INPUT_REJECTED'].includes(error.message))throw new McpError(ErrorCode.InvalidParams,'Tool or input unavailable');
   return unavailable();
  }finally{if(pending===running)pending=undefined;}
 });
 server.onerror=()=>{try{diagnostic('MCP protocol request failed.');}catch{}};
 server.onclose=()=>{
  if(finishing)return;finishing=true;
  // Closing the protocol aborts SDK waits, not an already admitted native effect.
  void Promise.resolve(pending).catch(()=>{}).then(()=>{try{host.close();}catch{try{diagnostic('MCP local cleanup incomplete.');}catch{}}finally{finishedResolve();}});
 };
 await server.connect(transport);
 return {finished,async close(){await transport.close();await finished;}};
}
