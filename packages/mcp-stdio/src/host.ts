import {join} from 'node:path';
import {Journal} from '../../cli/src/journal';
import {ProtectedCredentialProvider} from '../../cli/src/secret-store';
import {DurableMutations} from '../../cli/src/durable-mutations';
import {createNativeClient} from '../../client/src/native-client';
import type {ApiResult} from '../../client/src/types';
import {prepareToolCall} from './tool-registry';
import type {McpConfig} from './config';
export interface McpHost {call(name:string,args:unknown):Promise<ApiResult<unknown>>;assertNoSecrets(serialized:string):void;close():void;}
/** Explicit local operation only. O_EXCL protects existing stores; no credentials,
 * runtime enrollment, native requests or legacy-store conversion. */
export function initializeMcpJournal(stateDirectory:string):void {
 const journal=new Journal({directory:join(stateDirectory,'mcp-journal'),profile:'mcp-v1',create:true,authority:()=>false});journal.close();
}
/** Fetch injection is trusted composition for source fixtures, never tool/config JSON. */
export function openMcpHost(config:Extract<McpConfig,{initialize:false}>,fetch:typeof globalThis.fetch=globalThis.fetch):McpHost {
 const {origin,workspaceId,stateDirectory}=config;
 let provider:ProtectedCredentialProvider|undefined,mutations:DurableMutations|undefined;
 try{
  provider=new ProtectedCredentialProvider({directory:join(stateDirectory,'secrets')});
  const protectedProvider=provider,binding=provider.binding();
  if(!binding||binding.origin!==origin||binding.workspaceId!==workspaceId)throw Error();
  const client=createNativeClient({origin:origin,workspaceId:workspaceId,credentialProvider:provider,fetch});
  mutations=new DurableMutations({origin:origin,workspaceId:workspaceId,provider,journalDirectory:join(stateDirectory,'mcp-journal'),journalProfile:'mcp-v1',fetch});
  const coordinator=mutations;let active=false,closed=false;
  const current=()=>{if(closed||JSON.stringify(protectedProvider.binding())!==JSON.stringify(binding))throw Error('MCP_HOST_UNAVAILABLE');};
  return {
   async call(name,args){
    current();if(active)throw Error('MCP_HOST_BUSY');
    const prepared=prepareToolCall(name,args,origin,workspaceId);protectedProvider.assertNoSecrets(JSON.stringify({request:prepared.request,key:prepared.idempotencyKey}));
    active=true;
    try{
     if(prepared.idempotencyKey!==undefined){const intent=await coordinator.prepareOrReuse(prepared.operation,prepared.request as never,{idempotencyKey:prepared.idempotencyKey});current();return await (prepared.operation==='claimTask'?coordinator.dispatchMcpClaim(intent.id):coordinator.dispatch(intent.id));}
     return await client.call(prepared.operation,prepared.request as never,{expectedBinding:binding}) as ApiResult<unknown>;
    }finally{active=false;}
   },
   assertNoSecrets:serialized=>protectedProvider.assertNoSecrets(serialized),
   close(){if(active)throw Error('MCP_HOST_BUSY');if(!closed){closed=true;try{coordinator.close();}finally{protectedProvider.close();}}}
  };
 }catch{try{mutations?.close();}catch{}try{provider?.close();}catch{}throw Error('MCP_HOST_UNAVAILABLE');}
}
