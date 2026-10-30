import foundation from './migrations/0001-foundation.sql';
import sessionEpoch from './migrations/0002-session-auth-epoch.sql';
import preferenceOwner from './migrations/0003-preference-owner.sql';
import messageAdmission from './migrations/0004-message-admission.sql';
import cursorRetention from './migrations/0005-cursor-retention.sql';
import schedulerDiagnostics from './migrations/0006-outbox-scheduler-diagnostics.sql';
import maintenanceGeneration from './migrations/0007-maintenance-generation.sql';
import durableWork from './migrations/0008-durable-work.sql';
import catalogReferenceIndexes from './migrations/0009-catalog-reference-indexes.sql';
import outboxDueIndexes from './migrations/0010-outbox-due-indexes.sql';
import { withTransaction } from './transaction';
export const FOUNDATION_SQL=foundation;
export {CURRENT_SCHEMA_VERSION} from './schema-version';
export interface Migration {version:number;sql:string;}
const defaults:readonly Migration[]=[{version:1,sql:foundation},{version:2,sql:sessionEpoch},{version:3,sql:preferenceOwner},{version:4,sql:messageAdmission},{version:5,sql:cursorRetention},{version:6,sql:schedulerDiagnostics},{version:7,sql:maintenanceGeneration},{version:8,sql:durableWork},{version:9,sql:catalogReferenceIndexes},{version:10,sql:outboxDueIndexes}];
export function migrate(storage:DurableObjectStorage,migrations:readonly Migration[]=defaults):void {
 // Migration-time entropy is prepared before entering SQL. Existing rows keep these IDs forever.
 const hasPreferences=storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name='preferences'").toArray().length>0;
 const priorVersion=storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").toArray().length?storage.sql.exec<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations').one().version??0:0;
 const owners=migrations===defaults&&hasPreferences&&priorVersion<3?storage.sql.exec<{principal_id:string}>('SELECT principal_id FROM preferences').toArray().map(x=>({...x,recordId:'pref_'+crypto.randomUUID().replaceAll('-','')})):[];
 withTransaction(storage,tx=>{
  tx.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const current=tx.one<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations')?.version??0;
  if(current>migrations[migrations.length-1].version)throw Error('UNSUPPORTED_SCHEMA');
  if(current>0&&current<migrations[migrations.length-1].version){
   const tables=new Set(tx.all<{name:string}>("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('workspace_metadata','maintenance_state')").map(x=>x.name));
   if(tables.has('workspace_metadata')&&tx.one("SELECT id FROM workspace_metadata WHERE admission_state<>'installed'")||tables.has('maintenance_state')&&tx.one("SELECT id FROM maintenance_state WHERE state<>'open'"))throw Error('FROZEN_SCHEMA_MIGRATION');
  }
  for(const migration of migrations)if(migration.version>current) {
   if(migrations===defaults&&migration.version===8){
    // Adoption cannot manufacture an identity binding or cross a workspace boundary.
    if(tx.one("SELECT agent_id FROM static_agents WHERE agent_id IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_metadata m WHERE m.workspace_id=static_agents.workspace_id)")||
     tx.one("SELECT credential_id FROM native_credentials c WHERE credential_id IS NULL OR NOT EXISTS (SELECT 1 FROM static_agents a WHERE a.workspace_id=c.workspace_id AND a.agent_id=c.agent_id)"))throw Error('R2_IDENTITY_COLLISION');
   }
   if(migrations===defaults&&migration.version===3){
    const [create,finish]=migration.sql.split('-- @preference-owner-backfill');
    if(!create||!finish)throw Error('PREFERENCE_OWNER_MIGRATION_FAILED');
    tx.exec(create);
    for(const owner of owners)tx.exec('INSERT INTO preferences_with_owner (principal_id,workspace_id,version,document_json,updated_at,record_id) SELECT principal_id,workspace_id,version,document_json,updated_at,? FROM preferences WHERE principal_id=?',[owner.recordId,owner.principal_id]);
    const count=(table:string)=>tx.one<{n:number}>('SELECT count(*) AS n FROM '+table)!.n;
    if(count('preferences')!==count('preferences_with_owner'))throw Error('PREFERENCE_OWNER_MIGRATION_FAILED');
    tx.exec(finish);
   }else tx.exec(migration.sql);
   tx.exec('INSERT INTO schema_migrations (version,applied_at) VALUES (?,?)',[migration.version,Date.now()]);
  }
 });
}
