-- R2 storage only. UTC milliseconds, one existing authority registry; no routes or grants.
ALTER TABLE static_agents ADD COLUMN origin TEXT NOT NULL DEFAULT 'operator_static' CHECK(origin IN ('operator_static','human_managed'));
ALTER TABLE static_agents ADD COLUMN agent_version INTEGER NOT NULL DEFAULT 1 CHECK(agent_version>=1);
ALTER TABLE static_agents ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE static_agents ADD COLUMN work_role_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(work_role_ids_json) AND json_type(work_role_ids_json)='array');
ALTER TABLE static_agents ADD COLUMN framework TEXT;
ALTER TABLE static_agents ADD COLUMN model TEXT;
ALTER TABLE static_agents ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived'));
ALTER TABLE static_agents ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE static_agents ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE static_agents SET created_at=COALESCE((SELECT installed_at FROM workspace_metadata WHERE workspace_id=static_agents.workspace_id),0),updated_at=COALESCE((SELECT installed_at FROM workspace_metadata WHERE workspace_id=static_agents.workspace_id),0);
CREATE UNIQUE INDEX agents_workspace_identity ON static_agents(workspace_id,agent_id);
ALTER TABLE native_credentials ADD COLUMN origin TEXT NOT NULL DEFAULT 'operator_static' CHECK(origin IN ('operator_static','human_managed'));
ALTER TABLE native_credentials ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 1 CHECK(credential_version>=1);
ALTER TABLE native_credentials ADD COLUMN label TEXT NOT NULL DEFAULT '';
ALTER TABLE native_credentials ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE native_credentials ADD COLUMN revoked_at INTEGER;
ALTER TABLE native_credentials ADD COLUMN issued_by_principal_id TEXT;
UPDATE native_credentials SET created_at=COALESCE((SELECT installed_at FROM workspace_metadata WHERE workspace_id=native_credentials.workspace_id),0);
CREATE UNIQUE INDEX credentials_workspace_identity ON native_credentials(workspace_id,credential_id);
CREATE UNIQUE INDEX credentials_agent_binding ON native_credentials(workspace_id,agent_id,credential_id);
CREATE UNIQUE INDEX messages_workspace_identity ON messages(workspace_id,id);
CREATE UNIQUE INDEX events_workspace_identity ON events(workspace_id,id);
ALTER TABLE events ADD COLUMN task_version INTEGER CHECK(task_version IS NULL OR task_version>=1);
ALTER TABLE events ADD COLUMN run_id TEXT;
ALTER TABLE events ADD COLUMN fence INTEGER CHECK(fence IS NULL OR fence>=1);
CREATE TABLE runtimes (
 id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, agent_id TEXT NOT NULL, credential_id TEXT NOT NULL,
 authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=1), proof_sha256 TEXT NOT NULL CHECK(length(proof_sha256)=64 AND proof_sha256 NOT GLOB '*[^0-9a-f]*'),
 runtime_version INTEGER NOT NULL CHECK(runtime_version>=1), label TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('online','expired')),
 created_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,presence_expires_at INTEGER NOT NULL,revoked_at INTEGER,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,agent_id,credential_id,id),
 FOREIGN KEY(workspace_id,agent_id,credential_id) REFERENCES native_credentials(workspace_id,agent_id,credential_id),
 FOREIGN KEY(workspace_id,agent_id) REFERENCES static_agents(workspace_id,agent_id)
);
CREATE INDEX runtimes_presence_due ON runtimes(workspace_id,status,presence_expires_at,id);
CREATE TABLE tasks (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('backlog','ready','doing','waiting','review','done','cancelled')),
 task_version INTEGER NOT NULL CHECK(task_version>=1),proposal_version INTEGER NOT NULL CHECK(proposal_version>=0),
 project_id TEXT,work_role_id TEXT,assigned_agent_id TEXT,active_run_id TEXT,latest_run_id TEXT,approval_id TEXT,current_result_id TEXT,
 retry_count INTEGER NOT NULL CHECK(retry_count>=0),retry_limit INTEGER NOT NULL CHECK(retry_limit>=0),
 flags_json TEXT NOT NULL CHECK(json_valid(flags_json) AND json_type(flags_json)='array'),
 next_fence INTEGER NOT NULL DEFAULT 1 CHECK(next_fence>=1),next_result_sequence INTEGER NOT NULL DEFAULT 1 CHECK(next_result_sequence>=1),
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(workspace_id,id),
 CHECK((state='doing')=(active_run_id IS NOT NULL)),
 FOREIGN KEY(workspace_id,assigned_agent_id) REFERENCES static_agents(workspace_id,agent_id),
 FOREIGN KEY(workspace_id,id,active_run_id) REFERENCES runs(workspace_id,task_id,id),
 FOREIGN KEY(workspace_id,id,latest_run_id) REFERENCES runs(workspace_id,task_id,id),
 FOREIGN KEY(workspace_id,id,current_result_id) REFERENCES task_results(workspace_id,task_id,id)
);
CREATE INDEX tasks_state_order ON tasks(workspace_id,state,created_at,id);
CREATE TABLE runs (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,task_id TEXT NOT NULL,agent_id TEXT NOT NULL,runtime_instance_id TEXT NOT NULL,credential_id TEXT NOT NULL,
 authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=1),status TEXT NOT NULL CHECK(status IN ('active','paused','submitted','failed','expired','cancelled')),
 run_version INTEGER NOT NULL CHECK(run_version>=1),fence INTEGER NOT NULL CHECK(fence>=1),lease_expires_at INTEGER NOT NULL,started_at INTEGER NOT NULL,ended_at INTEGER,
 replay_policy_version INTEGER CHECK(replay_policy_version IS NULL OR replay_policy_version>=1),replay_rule_id TEXT,replay_evidence_ref TEXT,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,task_id,id),UNIQUE(workspace_id,task_id,fence),
 CHECK((status='active')=(ended_at IS NULL)),
 CHECK((replay_policy_version IS NULL AND replay_rule_id IS NULL AND replay_evidence_ref IS NULL) OR (replay_policy_version IS NOT NULL AND replay_rule_id IS NOT NULL AND replay_evidence_ref IS NOT NULL)),
 FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id),
 FOREIGN KEY(workspace_id,agent_id,credential_id,runtime_instance_id) REFERENCES runtimes(workspace_id,agent_id,credential_id,id)
);
CREATE UNIQUE INDEX runs_active_owner ON runs(workspace_id,task_id) WHERE status='active';
CREATE INDEX runs_lease_due ON runs(workspace_id,status,lease_expires_at,id);
CREATE INDEX runs_agent_status ON runs(workspace_id,agent_id,status);
CREATE TABLE task_results (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,task_id TEXT NOT NULL,run_id TEXT NOT NULL,
 submission_sequence INTEGER NOT NULL CHECK(submission_sequence>=1),submitted_kind TEXT NOT NULL CHECK(submitted_kind IN ('human','agent','system')),
 submitted_principal_id TEXT NOT NULL,submitted_agent_id TEXT,summary TEXT NOT NULL,created_at INTEGER NOT NULL,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,task_id,id),UNIQUE(workspace_id,task_id,run_id,id),UNIQUE(workspace_id,task_id,submission_sequence),UNIQUE(workspace_id,run_id),
 FOREIGN KEY(workspace_id,task_id,run_id) REFERENCES runs(workspace_id,task_id,id),
 FOREIGN KEY(workspace_id,submitted_agent_id) REFERENCES static_agents(workspace_id,agent_id)
);
CREATE INDEX results_task_order ON task_results(workspace_id,task_id,submission_sequence);
CREATE TABLE task_acceptances (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,task_id TEXT NOT NULL,result_id TEXT NOT NULL,run_id TEXT NOT NULL,
 task_version INTEGER NOT NULL CHECK(task_version>=1),reviewer_principal_id TEXT NOT NULL,reviewer_agent_id TEXT,reason TEXT NOT NULL,created_at INTEGER NOT NULL,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,task_id,task_version),
 FOREIGN KEY(workspace_id,task_id,run_id,result_id) REFERENCES task_results(workspace_id,task_id,run_id,id),
 FOREIGN KEY(workspace_id,reviewer_agent_id) REFERENCES static_agents(workspace_id,agent_id)
);
CREATE TABLE task_history (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,event_id TEXT NOT NULL,task_id TEXT NOT NULL,task_version INTEGER NOT NULL CHECK(task_version>=1),run_id TEXT,kind TEXT NOT NULL,created_at INTEGER NOT NULL,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,event_id),
 FOREIGN KEY(workspace_id,event_id) REFERENCES events(workspace_id,id),FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id),
 FOREIGN KEY(workspace_id,task_id,run_id) REFERENCES runs(workspace_id,task_id,id)
);
CREATE INDEX task_history_order ON task_history(workspace_id,task_id,task_version,id);
CREATE TABLE artifacts (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,task_id TEXT,run_id TEXT,
 owner_kind TEXT NOT NULL CHECK(owner_kind IN ('human','agent','system')),owner_principal_id TEXT NOT NULL,owner_agent_id TEXT,
 creator_credential_id TEXT,creator_runtime_id TEXT,authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=1),
 artifact_version INTEGER NOT NULL CHECK(artifact_version>=1),filename TEXT NOT NULL,media_type TEXT NOT NULL,byte_size INTEGER NOT NULL CHECK(byte_size>=0),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),status TEXT NOT NULL CHECK(status IN ('staged','uploaded','committed','expired')),
 active_generation_id TEXT,committed_generation_id TEXT,created_at INTEGER NOT NULL,committed_at INTEGER,expires_at INTEGER,
 UNIQUE(workspace_id,id),CHECK(run_id IS NULL OR task_id IS NOT NULL),
 CHECK(status NOT IN ('staged','uploaded') OR expires_at IS NOT NULL),CHECK((status='committed')=(committed_at IS NOT NULL)),CHECK(status<>'committed' OR (committed_generation_id IS NOT NULL AND expires_at IS NULL)),
 FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id),FOREIGN KEY(workspace_id,task_id,run_id) REFERENCES runs(workspace_id,task_id,id),
 FOREIGN KEY(workspace_id,owner_agent_id) REFERENCES static_agents(workspace_id,agent_id),
 FOREIGN KEY(workspace_id,creator_credential_id) REFERENCES native_credentials(workspace_id,credential_id),
 FOREIGN KEY(workspace_id,creator_runtime_id) REFERENCES runtimes(workspace_id,id),
 FOREIGN KEY(workspace_id,id,active_generation_id) REFERENCES artifact_generations(workspace_id,artifact_id,id),
 FOREIGN KEY(workspace_id,id,committed_generation_id) REFERENCES artifact_generations(workspace_id,artifact_id,id)
);
CREATE INDEX artifacts_expiry_due ON artifacts(workspace_id,status,expires_at,id);
CREATE TABLE artifact_generations (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,artifact_id TEXT NOT NULL,object_key TEXT NOT NULL,
 expected_sha256 TEXT NOT NULL CHECK(length(expected_sha256)=64 AND expected_sha256 NOT GLOB '*[^0-9a-f]*'),expected_byte_size INTEGER NOT NULL CHECK(expected_byte_size>=0),
 observed_sha256 TEXT CHECK(observed_sha256 IS NULL OR (length(observed_sha256)=64 AND observed_sha256 NOT GLOB '*[^0-9a-f]*')),observed_byte_size INTEGER CHECK(observed_byte_size IS NULL OR observed_byte_size>=0),
 state TEXT NOT NULL CHECK(state IN ('reserved','uploaded','committed','tombstoned')),admission_epoch INTEGER NOT NULL CHECK(admission_epoch>=1),admission_generation INTEGER NOT NULL CHECK(admission_generation>=0),
 expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 effect_operation_id TEXT,effect_kind TEXT CHECK(effect_kind IN ('put','delete')),effect_state TEXT NOT NULL DEFAULT 'none' CHECK(effect_state IN ('none','reserved','in_flight','drained','uncertain')),
 effect_started_at INTEGER,effect_drained_at INTEGER,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,artifact_id,id),UNIQUE(object_key),UNIQUE(workspace_id,effect_operation_id),
 CHECK((observed_sha256 IS NULL)=(observed_byte_size IS NULL)),
 CHECK(state NOT IN ('uploaded','committed') OR (observed_sha256=expected_sha256 AND observed_byte_size=expected_byte_size AND observed_sha256 IS NOT NULL)),
 CHECK((effect_state='none' AND effect_operation_id IS NULL AND effect_kind IS NULL AND effect_started_at IS NULL AND effect_drained_at IS NULL) OR (effect_state<>'none' AND effect_operation_id IS NOT NULL AND effect_kind IS NOT NULL)),
 CHECK(effect_state NOT IN ('in_flight','drained','uncertain') OR effect_started_at IS NOT NULL),
 CHECK((effect_state='drained')=(effect_drained_at IS NOT NULL)),
 FOREIGN KEY(workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id)
);
CREATE INDEX artifact_generations_due ON artifact_generations(workspace_id,state,expires_at,id);
CREATE TABLE result_artifacts (
 workspace_id TEXT NOT NULL,result_id TEXT NOT NULL,artifact_id TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 4),
 PRIMARY KEY(workspace_id,result_id,artifact_id),UNIQUE(workspace_id,result_id,ordinal),
 FOREIGN KEY(workspace_id,result_id) REFERENCES task_results(workspace_id,id),FOREIGN KEY(workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id)
);
CREATE TABLE artifact_associations (
 workspace_id TEXT NOT NULL,artifact_id TEXT NOT NULL,resource_kind TEXT NOT NULL CHECK(resource_kind IN ('task','run','message','result','checkpoint')),resource_id TEXT NOT NULL,
 PRIMARY KEY(workspace_id,artifact_id,resource_kind,resource_id),FOREIGN KEY(workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id)
);
CREATE TABLE message_artifacts (
 workspace_id TEXT NOT NULL,message_id TEXT NOT NULL,artifact_id TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(ordinal>=0),
 PRIMARY KEY(workspace_id,message_id,artifact_id),UNIQUE(workspace_id,message_id,ordinal),
 FOREIGN KEY(workspace_id,message_id) REFERENCES messages(workspace_id,id),FOREIGN KEY(workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id)
);
CREATE TABLE catalog_plans (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,actor_principal_id TEXT NOT NULL,profile_revision INTEGER NOT NULL CHECK(profile_revision>=1),expires_at INTEGER NOT NULL,
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),touched_versions_json TEXT NOT NULL CHECK(json_valid(touched_versions_json)),
 status TEXT NOT NULL CHECK(status IN ('previewed','applied','expired')),created_at INTEGER NOT NULL,UNIQUE(workspace_id,id)
);
CREATE TABLE import_plans (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,actor_principal_id TEXT NOT NULL,namespace TEXT NOT NULL,profile_revision INTEGER NOT NULL CHECK(profile_revision>=1),
 preview_json TEXT NOT NULL CHECK(json_valid(preview_json)),source_rows_json TEXT NOT NULL CHECK(json_valid(source_rows_json)),touched_versions_json TEXT NOT NULL CHECK(json_valid(touched_versions_json)),
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64 AND source_digest NOT GLOB '*[^0-9a-f]*'),report_json TEXT CHECK(report_json IS NULL OR json_valid(report_json)),
 status TEXT NOT NULL CHECK(status IN ('previewed','applied','expired')),expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,UNIQUE(workspace_id,id),CHECK((status='applied')=(report_json IS NOT NULL))
);
CREATE INDEX import_plans_expiry ON import_plans(workspace_id,status,expires_at,id);
CREATE TABLE import_mappings (
 workspace_id TEXT NOT NULL,namespace TEXT NOT NULL,external_id TEXT NOT NULL,task_id TEXT NOT NULL,source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
 mapping_version INTEGER NOT NULL CHECK(mapping_version>=1),source_version TEXT NOT NULL,import_id TEXT NOT NULL,provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,namespace,external_id),FOREIGN KEY(workspace_id,import_id) REFERENCES import_plans(workspace_id,id),FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id)
);
