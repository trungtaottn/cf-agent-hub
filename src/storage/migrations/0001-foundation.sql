-- Application schema v1. All timestamps are UTC milliseconds; JSON fields retain canonical DTO data.
CREATE TABLE workspace_metadata (
 id INTEGER PRIMARY KEY CHECK(id=1), workspace_id TEXT NOT NULL UNIQUE, object_name TEXT NOT NULL,
 config_epoch INTEGER NOT NULL CHECK(config_epoch>0), config_digest TEXT NOT NULL, installation_digest TEXT NOT NULL,
 config_json TEXT NOT NULL CHECK(json_valid(config_json)), bundle_json TEXT NOT NULL CHECK(json_valid(bundle_json)),
 installed_at INTEGER NOT NULL,
 admission_state TEXT NOT NULL DEFAULT 'installed' CHECK(admission_state IN ('installed','maintenance','retired'))
);
CREATE TABLE human_grants (
 principal_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, issuer TEXT NOT NULL, subject TEXT NOT NULL,
 scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)), project_ids_json TEXT NOT NULL CHECK(json_valid(project_ids_json)),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), config_epoch INTEGER NOT NULL, UNIQUE(issuer,subject)
);
CREATE TABLE static_agents (agent_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,display_name TEXT NOT NULL,config_epoch INTEGER NOT NULL);
CREATE TABLE native_credentials (
 credential_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_id TEXT NOT NULL, token_sha256 TEXT NOT NULL,
 scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)), project_ids_json TEXT NOT NULL CHECK(json_valid(project_ids_json)),
 expires_at INTEGER NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), config_epoch INTEGER NOT NULL,
 retired_at_epoch INTEGER, CHECK(retired_at_epoch IS NULL OR enabled=0)
);
CREATE TABLE login_attempts (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,state_digest TEXT NOT NULL UNIQUE,nonce TEXT NOT NULL,
 pkce_verifier TEXT NOT NULL,cookie_digest TEXT NOT NULL,redirect_uri TEXT NOT NULL,created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,consumed_at INTEGER, CHECK(expires_at>created_at)
);
CREATE INDEX login_attempts_expiry ON login_attempts(expires_at);
CREATE TABLE sessions (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,principal_id TEXT NOT NULL,token_digest TEXT NOT NULL UNIQUE,
 csrf_digest TEXT NOT NULL,issuer TEXT NOT NULL,subject TEXT NOT NULL,created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,revoked_at INTEGER,CHECK(expires_at>created_at)
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE profiles (
 workspace_id TEXT PRIMARY KEY,version INTEGER NOT NULL CHECK(version>0),document_json TEXT NOT NULL CHECK(json_valid(document_json)),
 updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL
);
CREATE TABLE preferences (
 principal_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),
 document_json TEXT NOT NULL CHECK(json_valid(document_json)),updated_at INTEGER NOT NULL
);
CREATE TABLE threads (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,subject TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX threads_created ON threads(created_at,id);
CREATE TABLE thread_participants (
 thread_id TEXT NOT NULL,agent_id TEXT NOT NULL,PRIMARY KEY(thread_id,agent_id),
 FOREIGN KEY(thread_id) REFERENCES threads(id)
);
CREATE TABLE messages (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,thread_id TEXT NOT NULL,sender_kind TEXT NOT NULL CHECK(sender_kind IN ('human','agent')),
 sender_principal_id TEXT NOT NULL,sender_agent_id TEXT,body TEXT NOT NULL CHECK(length(CAST(body AS BLOB))<=32768),
 refs_json TEXT NOT NULL CHECK(json_valid(refs_json)),created_at INTEGER NOT NULL,FOREIGN KEY(thread_id) REFERENCES threads(id)
);
CREATE INDEX messages_thread_order ON messages(thread_id,created_at,id);
CREATE TABLE inbox (
 message_id TEXT NOT NULL,recipient_agent_id TEXT NOT NULL,workspace_id TEXT NOT NULL,created_at INTEGER NOT NULL,
 acknowledged_at INTEGER,PRIMARY KEY(message_id,recipient_agent_id),FOREIGN KEY(message_id) REFERENCES messages(id)
);
CREATE INDEX inbox_recipient_order ON inbox(recipient_agent_id,acknowledged_at,created_at,message_id);
CREATE TABLE events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,workspace_id TEXT NOT NULL,type TEXT NOT NULL,
 actor_json TEXT NOT NULL CHECK(json_valid(actor_json)),resource_type TEXT NOT NULL,resource_id TEXT NOT NULL,
 resource_version INTEGER,thread_id TEXT,request_id TEXT NOT NULL,occurred_at INTEGER NOT NULL,summary TEXT NOT NULL
);
CREATE UNIQUE INDEX events_sequence ON events(sequence);
CREATE TABLE idempotency_outcomes (
 principal_id TEXT NOT NULL,operation TEXT NOT NULL,target TEXT NOT NULL,key TEXT NOT NULL,workspace_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,status INTEGER NOT NULL,outcome_json TEXT NOT NULL CHECK(json_valid(outcome_json)),
 original_request_id TEXT NOT NULL,event_id TEXT,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
 PRIMARY KEY(principal_id,operation,target,key),CHECK(expires_at>=created_at+86400000)
);
CREATE TABLE outbox (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,message_id TEXT NOT NULL,destination_id TEXT NOT NULL,
 notification_id TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 status TEXT NOT NULL CHECK(status IN ('pending','in_flight','succeeded','exhausted','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 6),next_due_at INTEGER NOT NULL,
 retry_multiplier REAL NOT NULL DEFAULT 1 CHECK(retry_multiplier BETWEEN 0.8 AND 1.0),
 lease_token TEXT,lease_expires_at INTEGER,last_status INTEGER,last_error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
);
CREATE INDEX outbox_due ON outbox(status,next_due_at);
CREATE TABLE scheduler_state (id INTEGER PRIMARY KEY CHECK(id=1),next_due_at INTEGER,armed_at INTEGER,last_run_at INTEGER);
CREATE TABLE maintenance_state (
 id INTEGER PRIMARY KEY CHECK(id=1),state TEXT NOT NULL,barrier_id TEXT,authority_epoch INTEGER NOT NULL,
 capture_id TEXT,updated_at INTEGER NOT NULL
);
CREATE TABLE recovery_jobs (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,operation TEXT NOT NULL,state TEXT NOT NULL,authority_epoch INTEGER NOT NULL,
 capture_id TEXT NOT NULL,manifest_digest TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,details_json TEXT NOT NULL CHECK(json_valid(details_json))
);
CREATE TABLE recovery_chunks (
 job_id TEXT NOT NULL,chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),table_name TEXT NOT NULL,
 sha256 TEXT NOT NULL,byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 0 AND 1048576),row_count INTEGER NOT NULL,
 object_key TEXT NOT NULL,PRIMARY KEY(job_id,chunk_index),FOREIGN KEY(job_id) REFERENCES recovery_jobs(id)
);
CREATE TABLE probe_receipts (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,authority_epoch INTEGER NOT NULL,request_id TEXT NOT NULL,
 checked_at INTEGER NOT NULL,receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json))
);
