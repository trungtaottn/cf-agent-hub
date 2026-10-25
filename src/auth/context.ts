import {assertAdmissionOpen,type AdmissionFence} from '../recovery/maintenance';
import type { DeploymentConfig } from '../config/deployment';
import type { Clock,Entropy } from '../workspace/context';
import type { WorkspaceTransaction } from '../storage/transaction';
export interface AuthWorkspace {
 storage:DurableObjectStorage; workspaceId:string; objectName:string;
 secrets:Record<string,unknown>; clock:Clock; entropy:Entropy;
}
export class AuthError extends Error {
 constructor(readonly code:'INVALID_REQUEST'|'UNAUTHENTICATED'|'FORBIDDEN'|'AUTH_UNAVAILABLE',readonly status:number) {super(code);}
}
export const deny=():never=>{throw new AuthError('UNAUTHENTICATED',401);};
export interface InstalledAuth {config:DeploymentConfig;epoch:number;fence:AdmissionFence;}
export function currentConfiguration(tx:WorkspaceTransaction,workspace:AuthWorkspace,expectedEpoch?:number|AdmissionFence):InstalledAuth {
 const row=tx.one<{workspace_id:string;object_name:string;config_epoch:number;config_json:string;admission_state:string}>('SELECT workspace_id,object_name,config_epoch,config_json,admission_state FROM workspace_metadata WHERE id=1');
 if(!row||row.admission_state!=='installed'||row.workspace_id!==workspace.workspaceId||row.object_name!==workspace.objectName||typeof expectedEpoch==='number'&&row.config_epoch!==expectedEpoch)deny();
 let fence:AdmissionFence;try{fence=assertAdmissionOpen(tx,typeof expectedEpoch==='object'?expectedEpoch:undefined);}catch{deny();}
 return {config:JSON.parse(row!.config_json) as DeploymentConfig,epoch:row!.config_epoch,fence:fence!};
}
export function secret(workspace:AuthWorkspace,name:string,minimumLength=1):string {
 const value=workspace.secrets[name];if(typeof value!=='string'||value.length<minimumLength)throw new AuthError('AUTH_UNAVAILABLE',503);return value;
}
export function opaque(workspace:AuthWorkspace):string {return btoa(String.fromCharCode(...workspace.entropy.bytes(32))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function readCookie(header:string|null,name:string):string|null {
 const values=(header??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 if(values.length!==1)return null;const value=values[0].slice(name.length+1);return /^[A-Za-z0-9_-]{43}$/.test(value)?value:null;
}
export function cookieHeader(name:string,value:string,maxAge:number):string {return name+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+Math.max(0,Math.floor(maxAge));}
