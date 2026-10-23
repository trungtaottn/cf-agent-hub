import foundation from './migrations/0001-foundation.sql';
import sessionEpoch from './migrations/0002-session-auth-epoch.sql';
import { withTransaction } from './transaction';
export const FOUNDATION_SQL=foundation;
export interface Migration {version:number;sql:string;}
export function migrate(storage:DurableObjectStorage,migrations:readonly Migration[]=[{version:1,sql:foundation},{version:2,sql:sessionEpoch}]):void {
 withTransaction(storage,tx=>{
  tx.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const current=tx.one<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations')?.version??0;
  if(current>migrations[migrations.length-1].version)throw Error('UNSUPPORTED_SCHEMA');
  for(const migration of migrations)if(migration.version>current) {
   tx.exec(migration.sql);
   tx.exec('INSERT INTO schema_migrations (version,applied_at) VALUES (?,?)',[migration.version,Date.now()]);
  }
 });
}
