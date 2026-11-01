import {isAbsolute,normalize} from 'node:path';
import {nativeOrigin,prepareNativeOperation} from '../../client/src/native-request';
export type McpConfig={initialize:true;stateDirectory:string}|{initialize:false;stateDirectory:string;origin:string;workspaceId:string};
export function parseConfig(argv:readonly string[]):McpConfig {
 try{
  const options:Record<string,string>={};let initialize=false;
  for(let i=0;i<argv.length;i++){const key=argv[i];if(key==='--init-journal'){if(initialize)throw 0;initialize=true;continue;}if(!['--origin','--workspace','--state-dir'].includes(key)||Object.hasOwn(options,key)||typeof argv[i+1]!=='string')throw 0;options[key]=argv[++i];}
  const stateDirectory=options['--state-dir'];if(!stateDirectory||!isAbsolute(stateDirectory)||normalize(stateDirectory)!==stateDirectory||stateDirectory.includes('\0'))throw 0;
  if(initialize){if(Object.keys(options).length!==1)throw 0;return {initialize:true,stateDirectory};}
  const origin=nativeOrigin(options['--origin']),workspaceId=options['--workspace'];prepareNativeOperation(origin,workspaceId,'getWorkspace',{});
  return {initialize:false,stateDirectory,origin,workspaceId};
 }catch{throw Error('MCP_CONFIG_REJECTED');}
}
