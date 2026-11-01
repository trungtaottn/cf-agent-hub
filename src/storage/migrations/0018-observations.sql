CREATE TABLE observation_slots (
 slot INTEGER PRIMARY KEY NOT NULL CHECK(slot IN (0,1)),
 workspace_id TEXT NOT NULL,
 task_id TEXT NOT NULL,
 project_id TEXT,
 run_id TEXT NOT NULL,
 agent_id TEXT NOT NULL,
 runtime_instance_id TEXT NOT NULL,
 credential_id TEXT NOT NULL,
 authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=1),
 maintenance_generation INTEGER NOT NULL CHECK(maintenance_generation>=0),
 mapping_digest TEXT NOT NULL CHECK(length(mapping_digest)=64),
 session_id TEXT NOT NULL UNIQUE,
 session_epoch INTEGER NOT NULL CHECK(session_epoch>=1 AND session_epoch<=9007199254740991),
 high_water INTEGER NOT NULL CHECK(high_water>=0 AND high_water<=9007199254740991),
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
 metadata_bytes INTEGER NOT NULL CHECK(metadata_bytes>=0 AND metadata_bytes=length(CAST(metadata_json AS BLOB))),
 UNIQUE(workspace_id,task_id,run_id)
);
CREATE TABLE observation_records (
 session_id TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence>=1 AND sequence<=9007199254740991),
 ingest_order INTEGER NOT NULL UNIQUE CHECK(ingest_order>=1 AND ingest_order<=9007199254740991),
 received_at INTEGER NOT NULL CHECK(received_at>=0),
 record_json TEXT NOT NULL CHECK(json_valid(record_json)),
 record_bytes INTEGER NOT NULL CHECK(record_bytes>=0 AND record_bytes=length(CAST(record_json AS BLOB))),
 PRIMARY KEY(session_id,sequence)
);
CREATE INDEX observation_records_eviction ON observation_records(ingest_order,session_id,sequence);
