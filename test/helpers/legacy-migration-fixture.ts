import {migrate} from '../../src/storage/migrations';
import m1 from '../../src/storage/migrations/0001-foundation.sql';
import m2 from '../../src/storage/migrations/0002-session-auth-epoch.sql';
import m3 from '../../src/storage/migrations/0003-preference-owner.sql';
import m4 from '../../src/storage/migrations/0004-message-admission.sql';
import m5 from '../../src/storage/migrations/0005-cursor-retention.sql';
import m6 from '../../src/storage/migrations/0006-outbox-scheduler-diagnostics.sql';
import m7 from '../../src/storage/migrations/0007-maintenance-generation.sql';
import type {SqlValue} from '../../src/storage/transaction';
/** Test-only reconstruction from original migration bytes, not a production downgrade.
 * Retains only the explicit authority/config/event fixture seeds; each caller supplies its legacy payload rows.
 */
export async function resetLegacyAuthorityFixture(storage:DurableObjectStorage,version:1|2|3|6):Promise<void>{
 const seeds=['workspace_metadata','human_grants','static_agents','native_credentials','profiles','events','maintenance_state'].map(table=>({table,rows:storage.sql.exec<Record<string,SqlValue>>('SELECT * FROM '+table).toArray()}));
 await storage.deleteAll();migrate(storage,[m1,m2,m3,m4,m5,m6,m7].slice(0,version).map((sql,i)=>({version:i+1,sql})));
 for(const seed of seeds){const columns=storage.sql.exec<{name:string}>('PRAGMA table_info('+seed.table+')').toArray().map(c=>c.name);for(const row of seed.rows)storage.sql.exec('INSERT INTO '+seed.table+' ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')',...columns.map(c=>row[c]));}
}
