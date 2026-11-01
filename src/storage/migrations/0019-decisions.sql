-- Generic decision persistence. No product action or installed policy is activated.
CREATE TABLE decision_checkpoints (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,task_id TEXT NOT NULL,run_id TEXT NOT NULL,
 checkpoint_json TEXT NOT NULL CHECK(json_valid(checkpoint_json) AND length(CAST(checkpoint_json AS BLOB))<=65536),created_at INTEGER NOT NULL CHECK((typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991)),
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,task_id,id),
 FOREIGN KEY(workspace_id,task_id,run_id) REFERENCES runs(workspace_id,task_id,id)
);
CREATE TABLE decision_proposals (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,task_id TEXT NOT NULL,
 proposal_version INTEGER NOT NULL CHECK((typeof(proposal_version)='integer' AND proposal_version BETWEEN 0 AND 9007199254740991)) CHECK(proposal_version BETWEEN 1 AND 9007199254740991),
 proposal_json TEXT NOT NULL CHECK(json_valid(proposal_json) AND length(CAST(proposal_json AS BLOB))<=65536),
 binding_json TEXT NOT NULL CHECK(json_valid(binding_json) AND json_type(binding_json)='object' AND length(CAST(binding_json AS BLOB))<=1048576),semantic_anchor_json TEXT NOT NULL CHECK(json_valid(semantic_anchor_json) AND json_type(semantic_anchor_json)='object' AND length(CAST(semantic_anchor_json AS BLOB))<=1048576),created_at INTEGER NOT NULL CHECK((typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991)),
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,task_id,id),UNIQUE(workspace_id,task_id,proposal_version),
 FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id)
);
CREATE TABLE approvals (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,task_id TEXT NOT NULL,run_id TEXT NOT NULL,checkpoint_id TEXT NOT NULL,proposal_id TEXT NOT NULL,
 approval_version INTEGER NOT NULL CHECK((typeof(approval_version)='integer' AND approval_version BETWEEN 0 AND 9007199254740991)) CHECK(approval_version BETWEEN 1 AND 9007199254740991),
 proposal_version INTEGER NOT NULL CHECK((typeof(proposal_version)='integer' AND proposal_version BETWEEN 0 AND 9007199254740991)) CHECK(proposal_version BETWEEN 1 AND 9007199254740991),
 task_version_at_request INTEGER NOT NULL CHECK((typeof(task_version_at_request)='integer' AND task_version_at_request BETWEEN 0 AND 9007199254740991)) CHECK(task_version_at_request BETWEEN 1 AND 9007199254740991),
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','expired','invalidated')),
 reviewer_ids_json TEXT NOT NULL CHECK(json_valid(reviewer_ids_json) AND json_type(reviewer_ids_json)='array' AND length(CAST(reviewer_ids_json AS BLOB))<=16384),
 requested_by_json TEXT NOT NULL CHECK(json_valid(requested_by_json) AND json_type(requested_by_json)='object' AND length(CAST(requested_by_json AS BLOB))<=1024),created_at INTEGER NOT NULL CHECK((typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991)),expires_at INTEGER NOT NULL CHECK((typeof(expires_at)='integer' AND expires_at BETWEEN 0 AND 9007199254740991)) CHECK(expires_at>created_at),
 decided_at INTEGER CHECK(decided_at IS NULL OR (typeof(decided_at)='integer' AND decided_at BETWEEN 0 AND 9007199254740991)),decided_by_json TEXT CHECK(decided_by_json IS NULL OR (json_valid(decided_by_json) AND json_type(decided_by_json)='object' AND length(CAST(decided_by_json AS BLOB))<=1024)),decision_reason TEXT CHECK(decision_reason IS NULL OR length(CAST(decision_reason AS BLOB))<=65536),
 consumed_run_id TEXT,consumed_fence INTEGER CHECK(consumed_fence IS NULL OR (typeof(consumed_fence)='integer' AND consumed_fence BETWEEN 0 AND 9007199254740991)) CHECK(consumed_fence IS NULL OR consumed_fence BETWEEN 1 AND 9007199254740991),
 expiry_hold_code TEXT CHECK(expiry_hold_code IS NULL OR (typeof(expiry_hold_code)='text' AND expiry_hold_code='DECISION_STATE_INVALID')),
 CHECK((consumed_run_id IS NULL)=(consumed_fence IS NULL)),
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,task_id,id),UNIQUE(workspace_id,proposal_id),
 FOREIGN KEY(workspace_id,task_id,run_id) REFERENCES runs(workspace_id,task_id,id),
 FOREIGN KEY(workspace_id,task_id,checkpoint_id) REFERENCES decision_checkpoints(workspace_id,task_id,id),
 FOREIGN KEY(workspace_id,task_id,proposal_id) REFERENCES decision_proposals(workspace_id,task_id,id),
 FOREIGN KEY(workspace_id,task_id,consumed_run_id) REFERENCES runs(workspace_id,task_id,id)
);
CREATE INDEX approvals_due ON approvals(workspace_id,status,expires_at,id) WHERE consumed_run_id IS NULL AND expiry_hold_code IS NULL;
CREATE INDEX approvals_task_order ON approvals(workspace_id,task_id,created_at,id);
CREATE TABLE decision_artifact_edges (
 workspace_id TEXT NOT NULL,approval_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('checkpoint','proposal','input')),
 artifact_id TEXT NOT NULL,generation_id TEXT NOT NULL,artifact_version INTEGER NOT NULL CHECK((typeof(artifact_version)='integer' AND artifact_version BETWEEN 0 AND 9007199254740991)) CHECK(artifact_version BETWEEN 1 AND 9007199254740991),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),byte_size INTEGER NOT NULL CHECK((typeof(byte_size)='integer' AND byte_size BETWEEN 0 AND 9007199254740991)) CHECK(byte_size BETWEEN 0 AND 10485760),
 PRIMARY KEY(workspace_id,approval_id,role,artifact_id),
 FOREIGN KEY(workspace_id,approval_id) REFERENCES approvals(workspace_id,id),
 FOREIGN KEY(workspace_id,artifact_id,generation_id) REFERENCES artifact_generations(workspace_id,artifact_id,id)
);
CREATE INDEX decision_artifact_retention ON decision_artifact_edges(workspace_id,artifact_id,generation_id);
CREATE TABLE decision_lifecycle_heads (
 workspace_id TEXT NOT NULL,approval_id TEXT NOT NULL,task_id TEXT NOT NULL,
 task_version INTEGER NOT NULL CHECK((typeof(task_version)='integer' AND task_version BETWEEN 0 AND 9007199254740991)) CHECK(task_version BETWEEN 1 AND 9007199254740991),
 task_state TEXT NOT NULL CHECK(task_state IN ('backlog','ready','doing','waiting','review','done','cancelled')),
 transition_count INTEGER NOT NULL CHECK((typeof(transition_count)='integer' AND transition_count BETWEEN 0 AND 9007199254740991)) CHECK(transition_count BETWEEN 1 AND 9007199254740991),last_transition_id TEXT NOT NULL,
 PRIMARY KEY(workspace_id,approval_id),
 FOREIGN KEY(workspace_id,task_id,approval_id) REFERENCES approvals(workspace_id,task_id,id)
);
CREATE TABLE decision_lifecycle_transitions (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,approval_id TEXT NOT NULL,task_id TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK((typeof(sequence)='integer' AND sequence BETWEEN 0 AND 9007199254740991)) CHECK(sequence BETWEEN 1 AND 9007199254740991),
 kind TEXT NOT NULL CHECK(kind IN ('request','approve','reject','claim','failure','lease_expiry','submit','accept','cancel','expiry')),
 before_version INTEGER NOT NULL CHECK((typeof(before_version)='integer' AND before_version BETWEEN 0 AND 9007199254740991)) CHECK(before_version BETWEEN 1 AND 9007199254740991),
 after_version INTEGER NOT NULL CHECK((typeof(after_version)='integer' AND after_version BETWEEN 0 AND 9007199254740991)) CHECK(after_version BETWEEN 1 AND 9007199254740991 AND after_version=before_version+1),
 before_state TEXT NOT NULL CHECK(before_state IN ('backlog','ready','doing','waiting','review','done','cancelled')),
 after_state TEXT NOT NULL CHECK(after_state IN ('backlog','ready','doing','waiting','review','done','cancelled')),
 run_id TEXT,created_at INTEGER NOT NULL CHECK((typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991)),
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,approval_id,sequence),
 FOREIGN KEY(workspace_id,task_id,approval_id) REFERENCES approvals(workspace_id,task_id,id),
 FOREIGN KEY(workspace_id,task_id,run_id) REFERENCES runs(workspace_id,task_id,id)
);
-- Bounded workspace-wide approval paging, independent of expiry/status/consumption.
CREATE INDEX approvals_order ON approvals(workspace_id,created_at,id);
-- Durable internal human notification intent only: no delivery, ACK or channel claim.
-- The trusted command wrapper appends its event later in the SAME transaction.
CREATE TABLE decision_notice_intents (
 workspace_id TEXT NOT NULL,approval_id TEXT NOT NULL,
 reviewer_principal_id TEXT NOT NULL CHECK(length(CAST(reviewer_principal_id AS BLOB)) BETWEEN 1 AND 128),
 event_id TEXT NOT NULL,created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY(workspace_id,approval_id,reviewer_principal_id),
 FOREIGN KEY(workspace_id,approval_id) REFERENCES approvals(workspace_id,id),
 FOREIGN KEY(workspace_id,event_id) REFERENCES events(workspace_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX decision_notice_event ON decision_notice_intents(workspace_id,event_id);
