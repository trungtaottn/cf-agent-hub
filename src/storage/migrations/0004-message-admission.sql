-- Forward-only typed membership and durable notification admission.
CREATE TABLE typed_thread_participants (
 thread_id TEXT NOT NULL,participant_kind TEXT NOT NULL CHECK(participant_kind IN ('human','agent')),
 participant_id TEXT NOT NULL,PRIMARY KEY(thread_id,participant_kind,participant_id),
 FOREIGN KEY(thread_id) REFERENCES threads(id)
);
INSERT INTO typed_thread_participants SELECT thread_id,'agent',agent_id FROM thread_participants;
DROP TABLE thread_participants;
ALTER TABLE typed_thread_participants RENAME TO thread_participants;
CREATE TABLE admitted_outbox (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,message_id TEXT NOT NULL,destination_id TEXT NOT NULL,
 notification_id TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 status TEXT NOT NULL CHECK(status IN ('pending','in_flight','succeeded','exhausted','cancelled','suppressed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 6),next_due_at INTEGER NOT NULL,
 retry_multiplier REAL NOT NULL DEFAULT 1 CHECK(retry_multiplier BETWEEN 0.8 AND 1.0),
 lease_token TEXT,lease_expires_at INTEGER,last_status INTEGER,last_error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 destination_snapshot_json TEXT CHECK(destination_snapshot_json IS NULL OR json_valid(destination_snapshot_json))
);
-- Legacy bytes/identities/attempts remain history. Never invent their original route.
INSERT INTO admitted_outbox SELECT id,workspace_id,message_id,destination_id,notification_id,payload_json,status,attempts,next_due_at,retry_multiplier,lease_token,lease_expires_at,last_status,last_error,created_at,updated_at,NULL FROM outbox;
DROP TABLE outbox;
ALTER TABLE admitted_outbox RENAME TO outbox;
CREATE INDEX outbox_due ON outbox(status,next_due_at);
ALTER TABLE scheduler_state ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0 CHECK(dirty IN (0,1));
ALTER TABLE scheduler_state ADD COLUMN generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0 AND typeof(generation)='integer');
