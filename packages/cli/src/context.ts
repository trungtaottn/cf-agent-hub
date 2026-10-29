import {isAbsolute,normalize} from 'node:path';
import {nativeOrigin,prepareNativeOperation} from '../../client/src/native-request';
import type {CommandOptions} from './commands';
export interface CliContext {stateDirectory:string;origin?:string;workspaceId?:string;}
export interface RemoteContext extends CliContext {origin:string;workspaceId:string;}
function rejected():never {throw Error('CLI_CONTEXT_REJECTED');}
/** No saved context, default workspace, implicit import, or filesystem mutation. */
export function resolveContext(options:CommandOptions,env:Readonly<Record<string,string|undefined>>,requireRemote=true):CliContext {
 try{
  const state=options.stateDir;if(!state||!isAbsolute(state)||state.includes('\0')||normalize(state)!==state)rejected();
  if(!requireRemote)return {stateDirectory:state};
  const origin=options.origin??env.CF_AGENT_HUB_URL,workspaceId=options.workspace??env.CF_AGENT_HUB_WORKSPACE;
  if(!origin||!workspaceId)rejected();nativeOrigin(origin);
  if(env.CF_AGENT_HUB_URL!==undefined&&nativeOrigin(env.CF_AGENT_HUB_URL)!==origin||env.CF_AGENT_HUB_WORKSPACE!==undefined&&env.CF_AGENT_HUB_WORKSPACE!==workspaceId)rejected();
  prepareNativeOperation(origin,workspaceId,'getWorkspace',{});
  return {stateDirectory:state,origin,workspaceId};
 }catch{return rejected();}
}
export function requireRemoteContext(options:CommandOptions,env:Readonly<Record<string,string|undefined>>):RemoteContext {return resolveContext(options,env,true) as RemoteContext;}
