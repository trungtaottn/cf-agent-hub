import {DurableObject} from 'cloudflare:workers';
import {migrate,type Migration} from '../../src/storage/migrations';
import foundation from '../../src/storage/migrations/0001-foundation.sql';
import sessionEpoch from '../../src/storage/migrations/0002-session-auth-epoch.sql';
import preferenceOwner from '../../src/storage/migrations/0003-preference-owner.sql';
import messageAdmission from '../../src/storage/migrations/0004-message-admission.sql';
import cursorRetention from '../../src/storage/migrations/0005-cursor-retention.sql';
import schedulerDiagnostics from '../../src/storage/migrations/0006-outbox-scheduler-diagnostics.sql';
import maintenanceGeneration from '../../src/storage/migrations/0007-maintenance-generation.sql';

/** Test-only historical SQLite host. Not the production WorkspaceDO or an operational route.
 * Fresh stores execute original migration bytes; eviction reopens the same schema7 database.
 * No upgrade, identity, authorization or recovery implementation is copied into this host.
 */
export class HistoricalStorageDO extends DurableObject {
 constructor(ctx:DurableObjectState,env:Env){
  super(ctx,env);
  const versions:readonly Migration[]=[foundation,sessionEpoch,preferenceOwner,messageAdmission,cursorRetention,schedulerDiagnostics,maintenanceGeneration].map((sql,i)=>({version:i+1,sql}));
  migrate(ctx.storage,versions);
 }
}
