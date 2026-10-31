-- Pending browser creation authority is consumed in the domain write transaction.
-- Recovery must invalidate every restored reservation, including pre-consume snapshots.
CREATE TABLE creation_admissions (
 id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL,
 principal_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK (operation IN ('messages:send','tasks:create')),
 target TEXT NOT NULL,
 key_hash TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 created_at INTEGER NOT NULL CHECK (created_at >= 0),
 expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
 UNIQUE (workspace_id,principal_id,operation,target,key_hash)
);
CREATE INDEX creation_admissions_expiry ON creation_admissions(workspace_id,expires_at,id);
CREATE INDEX creation_admissions_scope ON creation_admissions(workspace_id,principal_id);
ALTER TABLE events ADD COLUMN creation_binding TEXT;
