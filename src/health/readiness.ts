import type {AuthWorkspace} from '../auth/context';
import {parseDeployment} from '../config/deployment';
import type {Readiness,ReadinessCheck} from '../http/dto';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import {assertCurrentSchema} from '../storage/schema-version';
import {PROBE_MAX_AGE_MS,readStoredProbe,readResumeProbeLink} from '../recovery/probes';

/** Persisted observations only. This function does not run probes, repair an
 * alarm, refresh a timestamp, create a session or change admission. */
export function projectReadiness(tx:WorkspaceTransaction,workspace:AuthWorkspace,nowMs:number):Readiness{
 const observed=new Date(nowMs).toISOString(),checks:ReadinessCheck[]=[];
 const add=(name:string,status:ReadinessCheck['status'],code:string,checked_at:string|null=observed)=>checks.push({name,status,code,checked_at});
 const row=tx.one<{workspace_id:string;object_name:string;config_epoch:number;installation_digest:string;config_json:string;admission_state:string}>('SELECT workspace_id,object_name,config_epoch,installation_digest,config_json,admission_state FROM workspace_metadata WHERE id=1');
 const schema=tx.one<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations')?.version;
 let schemaCurrent=true;try{assertCurrentSchema(tx);}catch{schemaCurrent=false;}
 add('schema',schemaCurrent?'pass':'fail',schemaCurrent?'SCHEMA_CURRENT':'SCHEMA_MISMATCH');
 if(!row||row.workspace_id!==workspace.workspaceId||row.object_name!==workspace.objectName){
  add('configuration','fail','CONFIGURATION_UNAVAILABLE');return {observed_at:observed,ready:false,checks};
 }
 let config;try{config=parseDeployment(JSON.parse(row.config_json));}catch{config=null;}
 const stale=tx.one<{n:number}>(`SELECT
  (SELECT COUNT(*) FROM human_grants WHERE enabled=1 AND config_epoch<>?)+
  (SELECT COUNT(*) FROM native_credentials WHERE enabled=1 AND config_epoch<>?) AS n`,[row.config_epoch,row.config_epoch])?.n??1;
 const currentAgents=new Set(tx.all<{agent_id:string}>('SELECT agent_id FROM static_agents WHERE workspace_id=? AND config_epoch=?',[workspace.workspaceId,row.config_epoch]).map(agent=>agent.agent_id));
 const configValid=config?.config_epoch===row.config_epoch&&config.workspace_catalog.some(x=>x.workspace_id===workspace.workspaceId&&x.object_name===workspace.objectName)&&stale===0&&config.static_participants.filter(agent=>agent.workspace_id===workspace.workspaceId).every(agent=>currentAgents.has(agent.agent_id));
 add('configuration',configValid?'pass':'fail',configValid?'CONFIGURATION_CURRENT':'AUTHORITY_EPOCH_MISMATCH');
 const keyNames=config?[config.authentication.client_secret_ref,'CSRF_SECRET']:[];
 const keysValid=keyNames.length===2&&keyNames.every(key=>typeof workspace.secrets[key]==='string'&&(workspace.secrets[key] as string).length>=(key==='CSRF_SECRET'?32:1));
 const cursorKeyValid=typeof workspace.secrets.CURSOR_ENCRYPTION_KEY==='string'&&/^[a-f0-9]{64}$/i.test(workspace.secrets.CURSOR_ENCRYPTION_KEY);
 add('cursor_key',cursorKeyValid?'pass':'fail',cursorKeyValid?'KEY_BINDING_PRESENT':'KEY_BINDING_UNAVAILABLE');
 add('authentication_keys',keysValid?'pass':'fail',keysValid?'KEY_BINDINGS_PRESENT':'KEY_BINDING_UNAVAILABLE');
 const bucket=workspace.secrets.RECOVERY_BUCKET as {get?:unknown;put?:unknown}|undefined;
 const bucketBound=!!bucket&&typeof bucket.get==='function'&&typeof bucket.put==='function';
 add('recovery_binding',bucketBound?'pass':'fail',bucketBound?'BINDING_PRESENT':'BINDING_UNAVAILABLE');
 const barrier=tx.one<{state:string;generation:number}>('SELECT state,generation FROM maintenance_state WHERE id=1');
 const open=row.admission_state==='installed'&&barrier?.state==='open';
 add('admission',open?'pass':'fail',open?'ADMISSION_OPEN':row.admission_state==='retired'?'AUTHORITY_RETIRED':'MAINTENANCE_ACTIVE');
 const stored=readStoredProbe(tx,workspace.workspaceId);
 if(!stored){
  add('storage_probe','unknown','PROBE_NOT_RUN',null);add('scheduler_probe','unknown','PROBE_NOT_RUN',null);
 }else{
  const receipt=stored.receipt,checked=Date.parse(receipt.checked_at);
  const link=barrier&&stored.maintenance_generation!==barrier.generation?readResumeProbeLink(tx,workspace.workspaceId,row.config_epoch,barrier.generation):null;
  const generationMatches=!!barrier&&(stored.maintenance_generation===barrier.generation||link?.probe_id===receipt.id&&link.old_generation===stored.maintenance_generation&&link.new_generation===barrier.generation);
  const identityMatches=receipt.workspace_id===workspace.workspaceId&&receipt.config_epoch===row.config_epoch&&receipt.schema_version===schema&&stored.installation_digest===row.installation_digest&&generationMatches;
  const fresh=Number.isFinite(checked)&&checked<=nowMs&&nowMs-checked<=PROBE_MAX_AGE_MS;
  const commonCode=!identityMatches?'PROBE_IDENTITY_MISMATCH':!fresh?'PROBE_STALE':null;
  const commonStatus:ReadinessCheck['status']|null=!identityMatches?'fail':!fresh?'unknown':null;
  const check=(name:string)=>receipt.checks.find(item=>item.name===name)?.passed===true;
  const storagePass=check('sql_write_read')&&check('rollback')&&check('schema'),schedulerPass=check('scheduler');
  add('storage_probe',commonStatus??(storagePass?'pass':'fail'),commonCode??(storagePass?'PROBE_CONFIRMED':'PROBE_FAILED'),Number.isFinite(checked)?receipt.checked_at:null);
  add('scheduler_probe',commonStatus??(schedulerPass?'pass':'fail'),commonCode??(schedulerPass?'PROBE_CONFIRMED':'PROBE_FAILED'),Number.isFinite(checked)?receipt.checked_at:null);
 }
 const scheduler=tx.one<{dirty:number;last_error_code:string|null}>('SELECT dirty,last_error_code FROM scheduler_state WHERE id=1');
 add('scheduler',!scheduler?'unknown':scheduler.last_error_code?'fail':scheduler.dirty?'unknown':'pass',!scheduler?'SCHEDULE_NOT_OBSERVED':scheduler.last_error_code?'SCHEDULER_FAILURE':scheduler.dirty?'SCHEDULE_REPAIR_PENDING':'SCHEDULE_OBSERVED');
 const delivery=tx.one<{n:number}>("SELECT COUNT(*) AS n FROM outbox WHERE workspace_id=? AND (status IN ('exhausted','cancelled') OR (status IN ('pending','in_flight') AND last_error IS NOT NULL))",[workspace.workspaceId])?.n??0;
 add('delivery',delivery?'fail':'pass',delivery?'DELIVERY_FAILURES':'DELIVERY_STATE_OBSERVED');
 // R2 artifact APIs are intentionally unavailable. Presence of the private
 // recovery binding above does not establish an artifact round-trip probe.
 add('r2_artifacts','unknown','CAPABILITY_UNAVAILABLE_R1',null);
 return {observed_at:observed,ready:checks.filter(check=>check.name!=='r2_artifacts').every(check=>check.status==='pass'),checks};
}
export async function evaluateReadiness(workspace:AuthWorkspace,nowMs:number):Promise<Readiness>{
 return withTransaction(workspace.storage,tx=>projectReadiness(tx,workspace,nowMs));
}
