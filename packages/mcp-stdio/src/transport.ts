import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import type {JSONRPCMessage} from '@modelcontextprotocol/sdk/types.js';
import type {Readable,Writable} from 'node:stream';
const OUTPUT_MAX=2*1024*1024,PENDING_MAX=4*1024*1024;
/** Bounds every response, including SDK-generated protocol errors/pings/lists.
 * No unbounded output queue; a stalled reader closes admission synchronously. */
export class BoundedStdioTransport implements Transport {
 readonly #inner:StdioServerTransport;readonly #pending=new Set<(error?:Error)=>void>();#bytes=0;#closed=false;
 onclose?:Transport['onclose'];onerror?:Transport['onerror'];onmessage?:Transport['onmessage'];
 get closed(){return this.#closed;}get pendingBytes(){return this.#bytes;}get pendingMessages(){return this.#pending.size;}
 constructor(private readonly input:Readable,private readonly output:Writable,private readonly assertNoSecrets:(text:string)=>void,private readonly diagnostic:(text:string)=>void){
  this.#inner=new StdioServerTransport(input,output,{maxBufferSize:131072});
  this.#inner.onmessage=message=>{
   if(this.#closed)return;
   if('id'in message&&(typeof message.id==='string'?message.id.length>128:!Number.isSafeInteger(message.id))){this.fail();return;}
   this.onmessage?.(message);
  };
  this.#inner.onerror=error=>{
   // Do not serialize SDK parser/validator exception text or input excerpts.
   void this.send({jsonrpc:'2.0',error:{code:error instanceof SyntaxError?-32700:-32600,message:'Invalid protocol message'}}).catch(()=>{});
   this.fail();
  };
  this.#inner.onclose=()=>{void this.close();};
 }
 private readonly streamFailed=()=>this.fail();
 private fail(){if(this.#closed)return;try{this.diagnostic('MCP transport closed.');}catch{}void this.close();}
 async start(){if(this.#closed)throw Error('MCP_TRANSPORT_CLOSED');this.input.once('end',this.streamFailed);this.output.on('error',this.streamFailed);await this.#inner.start();}
 send(message:JSONRPCMessage):Promise<void>{
  if(this.#closed)return Promise.reject(Error('MCP_TRANSPORT_CLOSED'));
  // SDK unknown-method/schema diagnostics may embed attacker-controlled values.
  const safe='error'in message?{jsonrpc:'2.0' as const,id:message.id,error:{code:message.error.code,message:'Protocol request rejected'}}:message;
  let size:number,serialized:string;
  try{serialized=JSON.stringify(safe);this.assertNoSecrets(serialized);size=Buffer.byteLength(serialized)+1;if(size>OUTPUT_MAX||this.#pending.size>=8||this.#bytes+size>PENDING_MAX)throw 0;}
  catch{this.fail();return Promise.reject(Error('MCP_OUTPUT_REJECTED'));}
  this.#bytes+=size;
  return new Promise<void>((resolve,reject)=>{
   let settled=false;
   const finish=(error?:Error)=>{if(settled)return;settled=true;this.#pending.delete(finish);this.#bytes-=size;error?reject(error):resolve();};
   this.#pending.add(finish);
   try{this.output.write(serialized+'\n',error=>{if(error){finish(Error('MCP_TRANSPORT_CLOSED'));this.fail();}else finish();});}catch{finish(Error('MCP_TRANSPORT_CLOSED'));this.fail();}
  });
 }
 async close(){
  if(this.#closed)return;this.#closed=true;
  this.input.removeListener('end',this.streamFailed);
  // Keep the fixed error sink for asynchronous EPIPE after the final callback.
  for(const finish of [...this.#pending])finish(Error('MCP_TRANSPORT_CLOSED'));
  await this.#inner.close();this.output.destroy();this.onclose?.();
 }
}
