import {maintenanceClosed} from '../recovery/maintenance';
import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import {parseDeployment,type DeploymentConfig} from './deployment';
import {HttpError} from '../http/envelopes';
export type WorkspacePolicy=DeploymentConfig['workspace_policies'][number];
/** Reads the installed policy in the same transaction as effects or publication. */
export function settingsPolicy(tx:WorkspaceTransaction,actor:ActorContext):{config:DeploymentConfig;policy:WorkspacePolicy;epoch:number}{
 const row=tx.one<{workspace_id:string;config_epoch:number;config_json:string;admission_state:string}>('SELECT workspace_id,config_epoch,config_json,admission_state FROM workspace_metadata WHERE id=1');
 if(!row||row.workspace_id!==actor.workspaceId||row.admission_state!=='installed'||maintenanceClosed(tx))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 try{
  const config=parseDeployment(JSON.parse(row.config_json)),policy=config.workspace_policies.find(x=>x.workspace_id===actor.workspaceId);
  if(!policy||config.config_epoch!==row.config_epoch)throw Error('POLICY_MISSING');
  return {config,policy,epoch:row.config_epoch};
 }catch{throw new HttpError('DEPENDENCY_UNAVAILABLE',503);}
}
