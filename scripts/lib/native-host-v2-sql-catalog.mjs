// Fixed source-only SQLite catalog. No execution, visibility or installed authority.
// MA ordinal0..4 is a stricter required-empty fixture guard; product message_artifacts permits ordinal>=0.
// Schema sequence, required cardinality and coherent current-fence admission belong to the separate reducer.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
const definitions={
  "S": {
    "sql": "SELECT\n  CASE WHEN (typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991) THEN version ELSE NULL END AS version\nFROM schema_migrations\nWHERE 1=1\nORDER BY version\nLIMIT 17;",
    "sqlSha256": "02617c0dc2dbb7f4cf70915d47411f96441d54d20123d80c876a82cb4f35abe8",
    "parameters": [],
    "fields": [
      {
        "name": "version",
        "type": "n1"
      }
    ],
    "limits": {
      "acceptedRows": 16,
      "bridgeRows": 17,
      "rawScalarRowBytes": 16,
      "jsonRowBytes": 40,
      "rawScalarBytes": 272,
      "jsonArrayBytes": 698,
      "canonicalBytes": 16384
    }
  },
  "F": {
    "sql": "SELECT\n  CASE WHEN (typeof(id)='integer' AND id BETWEEN 1 AND 9007199254740991) AND (typeof(state)='text' AND length(CAST(state AS BLOB))<=64) AND (typeof(authority_epoch)='integer' AND authority_epoch BETWEEN 0 AND 9007199254740991) AND (typeof(generation)='integer' AND generation BETWEEN 0 AND 9007199254740991) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(id)='integer' AND id BETWEEN 1 AND 9007199254740991) THEN id ELSE NULL END AS id,\n  CASE WHEN (typeof(state)='text' AND length(CAST(state AS BLOB))<=64) THEN state ELSE NULL END AS state,\n  CASE WHEN (typeof(authority_epoch)='integer' AND authority_epoch BETWEEN 0 AND 9007199254740991) THEN authority_epoch ELSE NULL END AS authority_epoch,\n  CASE WHEN (typeof(generation)='integer' AND generation BETWEEN 0 AND 9007199254740991) THEN generation ELSE NULL END AS generation\nFROM maintenance_state\nWHERE id=1\nORDER BY id\nLIMIT 2;",
    "sqlSha256": "9392d7246794b7b221bf6d2c2fb9530ca5ea33ee9ba784edfc349838f03b1364",
    "parameters": [],
    "fields": [
      {
        "name": "id",
        "type": "n1"
      },
      {
        "name": "state",
        "type": "t64"
      },
      {
        "name": "authority_epoch",
        "type": "n0"
      },
      {
        "name": "generation",
        "type": "n0"
      }
    ],
    "limits": {
      "acceptedRows": 1,
      "bridgeRows": 2,
      "rawScalarRowBytes": 96,
      "jsonRowBytes": 495,
      "rawScalarBytes": 192,
      "jsonArrayBytes": 993,
      "canonicalBytes": 16384
    }
  },
  "M": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(object_name)='text' AND length(CAST(object_name AS BLOB))<=512) AND (typeof(config_epoch)='integer' AND config_epoch BETWEEN 1 AND 9007199254740991) AND (typeof(config_digest)='text' AND length(CAST(config_digest AS BLOB))<=64) AND (typeof(installation_digest)='text' AND length(CAST(installation_digest AS BLOB))<=64) AND (typeof(admission_state)='text' AND length(CAST(admission_state AS BLOB))<=64) AND (typeof(message_retained_after_created_at)='null' OR (typeof(message_retained_after_created_at)='integer' AND message_retained_after_created_at BETWEEN 0 AND 9007199254740991)) AND (typeof(message_retained_after_id)='null' OR (typeof(message_retained_after_id)='text' AND length(CAST(message_retained_after_id AS BLOB))<=96)) AND (typeof(event_retained_after_sequence)='null' OR (typeof(event_retained_after_sequence)='integer' AND event_retained_after_sequence BETWEEN 0 AND 9007199254740991)) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(object_name)='text' AND length(CAST(object_name AS BLOB))<=512) THEN object_name ELSE NULL END AS object_name,\n  CASE WHEN (typeof(config_epoch)='integer' AND config_epoch BETWEEN 1 AND 9007199254740991) THEN config_epoch ELSE NULL END AS config_epoch,\n  CASE WHEN (typeof(config_digest)='text' AND length(CAST(config_digest AS BLOB))<=64) THEN config_digest ELSE NULL END AS config_digest,\n  CASE WHEN (typeof(installation_digest)='text' AND length(CAST(installation_digest AS BLOB))<=64) THEN installation_digest ELSE NULL END AS installation_digest,\n  CASE WHEN (typeof(admission_state)='text' AND length(CAST(admission_state AS BLOB))<=64) THEN admission_state ELSE NULL END AS admission_state,\n  CASE WHEN (typeof(message_retained_after_created_at)='null' OR (typeof(message_retained_after_created_at)='integer' AND message_retained_after_created_at BETWEEN 0 AND 9007199254740991)) THEN message_retained_after_created_at ELSE NULL END AS message_retained_after_created_at,\n  CASE WHEN (typeof(message_retained_after_id)='null' OR (typeof(message_retained_after_id)='text' AND length(CAST(message_retained_after_id AS BLOB))<=96)) THEN message_retained_after_id ELSE NULL END AS message_retained_after_id,\n  CASE WHEN (typeof(event_retained_after_sequence)='null' OR (typeof(event_retained_after_sequence)='integer' AND event_retained_after_sequence BETWEEN 0 AND 9007199254740991)) THEN event_retained_after_sequence ELSE NULL END AS event_retained_after_sequence\nFROM workspace_metadata\nWHERE id=1 AND workspace_id=?\nORDER BY id\nLIMIT 2;",
    "sqlSha256": "81bbeb6ef3d670978268137c267e8b793b5f64c100954b6761f2ae6c23745678",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "object_name",
        "type": "t512"
      },
      {
        "name": "config_epoch",
        "type": "n1"
      },
      {
        "name": "config_digest",
        "type": "t64"
      },
      {
        "name": "installation_digest",
        "type": "t64"
      },
      {
        "name": "admission_state",
        "type": "t64"
      },
      {
        "name": "message_retained_after_created_at",
        "type": "n0?"
      },
      {
        "name": "message_retained_after_id",
        "type": "t96?"
      },
      {
        "name": "event_retained_after_sequence",
        "type": "n0?"
      }
    ],
    "limits": {
      "acceptedRows": 1,
      "bridgeRows": 2,
      "rawScalarRowBytes": 928,
      "jsonRowBytes": 5654,
      "rawScalarBytes": 1856,
      "jsonArrayBytes": 11311,
      "canonicalBytes": 16384
    }
  },
  "G": {
    "sql": "SELECT\n  CASE WHEN (typeof(c.workspace_id)='text' AND length(CAST(c.workspace_id AS BLOB))<=96) AND (typeof(c.credential_id)='text' AND length(CAST(c.credential_id AS BLOB))<=96) AND (typeof(c.agent_id)='text' AND length(CAST(c.agent_id AS BLOB))<=96) AND (typeof(c.credential_version)='integer' AND c.credential_version BETWEEN 1 AND 9007199254740991) AND (typeof(c.token_sha256)='text' AND length(CAST(c.token_sha256 AS BLOB))<=64) AND (typeof(c.scopes_json)='text' AND length(CAST(c.scopes_json AS BLOB))<=4096) AND (typeof(c.project_ids_json)='text' AND length(CAST(c.project_ids_json AS BLOB))<=4096) AND (typeof(c.enabled)='integer' AND c.enabled BETWEEN 0 AND 1) AND (typeof(c.expires_at)='integer' AND c.expires_at BETWEEN 0 AND 9007199254740991) AND (typeof(c.config_epoch)='integer' AND c.config_epoch BETWEEN 1 AND 9007199254740991) AND (typeof(c.retired_at_epoch)='null' OR (typeof(c.retired_at_epoch)='integer' AND c.retired_at_epoch BETWEEN 0 AND 9007199254740991)) AND (typeof(c.revoked_at)='null' OR (typeof(c.revoked_at)='integer' AND c.revoked_at BETWEEN 0 AND 9007199254740991)) AND (typeof(c.origin)='text' AND length(CAST(c.origin AS BLOB))<=64) AND (typeof(a.status)='text' AND length(CAST(a.status AS BLOB))<=64) AND (typeof(a.origin)='text' AND length(CAST(a.origin AS BLOB))<=64) AND (typeof(a.config_epoch)='integer' AND a.config_epoch BETWEEN 1 AND 9007199254740991) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(c.workspace_id)='text' AND length(CAST(c.workspace_id AS BLOB))<=96) THEN c.workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(c.credential_id)='text' AND length(CAST(c.credential_id AS BLOB))<=96) THEN c.credential_id ELSE NULL END AS credential_id,\n  CASE WHEN (typeof(c.agent_id)='text' AND length(CAST(c.agent_id AS BLOB))<=96) THEN c.agent_id ELSE NULL END AS agent_id,\n  CASE WHEN (typeof(c.credential_version)='integer' AND c.credential_version BETWEEN 1 AND 9007199254740991) THEN c.credential_version ELSE NULL END AS credential_version,\n  CASE WHEN (typeof(c.token_sha256)='text' AND length(CAST(c.token_sha256 AS BLOB))<=64) THEN c.token_sha256 ELSE NULL END AS token_sha256,\n  CASE WHEN (typeof(c.scopes_json)='text' AND length(CAST(c.scopes_json AS BLOB))<=4096) THEN c.scopes_json ELSE NULL END AS scopes_json,\n  CASE WHEN (typeof(c.project_ids_json)='text' AND length(CAST(c.project_ids_json AS BLOB))<=4096) THEN c.project_ids_json ELSE NULL END AS project_ids_json,\n  CASE WHEN (typeof(c.enabled)='integer' AND c.enabled BETWEEN 0 AND 1) THEN c.enabled ELSE NULL END AS enabled,\n  CASE WHEN (typeof(c.expires_at)='integer' AND c.expires_at BETWEEN 0 AND 9007199254740991) THEN c.expires_at ELSE NULL END AS expires_at,\n  CASE WHEN (typeof(c.config_epoch)='integer' AND c.config_epoch BETWEEN 1 AND 9007199254740991) THEN c.config_epoch ELSE NULL END AS config_epoch,\n  CASE WHEN (typeof(c.retired_at_epoch)='null' OR (typeof(c.retired_at_epoch)='integer' AND c.retired_at_epoch BETWEEN 0 AND 9007199254740991)) THEN c.retired_at_epoch ELSE NULL END AS retired_at_epoch,\n  CASE WHEN (typeof(c.revoked_at)='null' OR (typeof(c.revoked_at)='integer' AND c.revoked_at BETWEEN 0 AND 9007199254740991)) THEN c.revoked_at ELSE NULL END AS revoked_at,\n  CASE WHEN (typeof(c.origin)='text' AND length(CAST(c.origin AS BLOB))<=64) THEN c.origin ELSE NULL END AS origin,\n  CASE WHEN (typeof(a.status)='text' AND length(CAST(a.status AS BLOB))<=64) THEN a.status ELSE NULL END AS agent_status,\n  CASE WHEN (typeof(a.origin)='text' AND length(CAST(a.origin AS BLOB))<=64) THEN a.origin ELSE NULL END AS agent_origin,\n  CASE WHEN (typeof(a.config_epoch)='integer' AND a.config_epoch BETWEEN 1 AND 9007199254740991) THEN a.config_epoch ELSE NULL END AS agent_epoch\nFROM native_credentials c JOIN static_agents a ON a.workspace_id=c.workspace_id AND a.agent_id=c.agent_id\nWHERE c.workspace_id=? AND c.credential_id=?\nORDER BY c.credential_id\nLIMIT 2;",
    "sqlSha256": "f1722a5d09b30b1f75e1c38131d09ead64a2c307ed5bbd87e27b68fad0151ba6",
    "parameters": [
      "W",
      "C"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "credential_id",
        "type": "t96"
      },
      {
        "name": "agent_id",
        "type": "t96"
      },
      {
        "name": "credential_version",
        "type": "n1"
      },
      {
        "name": "token_sha256",
        "type": "t64"
      },
      {
        "name": "scopes_json",
        "type": "t4096"
      },
      {
        "name": "project_ids_json",
        "type": "t4096"
      },
      {
        "name": "enabled",
        "type": "b"
      },
      {
        "name": "expires_at",
        "type": "n0"
      },
      {
        "name": "config_epoch",
        "type": "n1"
      },
      {
        "name": "retired_at_epoch",
        "type": "n0?"
      },
      {
        "name": "revoked_at",
        "type": "n0?"
      },
      {
        "name": "origin",
        "type": "t64"
      },
      {
        "name": "agent_status",
        "type": "t64"
      },
      {
        "name": "agent_origin",
        "type": "t64"
      },
      {
        "name": "agent_epoch",
        "type": "n1"
      }
    ],
    "limits": {
      "acceptedRows": 1,
      "bridgeRows": 2,
      "rawScalarRowBytes": 8800,
      "jsonRowBytes": 52797,
      "rawScalarBytes": 17600,
      "jsonArrayBytes": 105597,
      "canonicalBytes": 16384
    }
  },
  "U": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) AND (typeof(agent_id)='text' AND length(CAST(agent_id AS BLOB))<=96) AND (typeof(credential_id)='text' AND length(CAST(credential_id AS BLOB))<=96) AND (typeof(authority_epoch)='integer' AND authority_epoch BETWEEN 1 AND 9007199254740991) AND (typeof(proof_sha256)='text' AND length(CAST(proof_sha256 AS BLOB))<=64) AND (typeof(runtime_version)='integer' AND runtime_version BETWEEN 1 AND 9007199254740991) AND (typeof(status)='text' AND length(CAST(status AS BLOB))<=64) AND (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) AND (typeof(last_seen_at)='integer' AND last_seen_at BETWEEN 0 AND 9007199254740991) AND (typeof(presence_expires_at)='integer' AND presence_expires_at BETWEEN 0 AND 9007199254740991) AND (typeof(revoked_at)='null' OR (typeof(revoked_at)='integer' AND revoked_at BETWEEN 0 AND 9007199254740991)) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) THEN id ELSE NULL END AS id,\n  CASE WHEN (typeof(agent_id)='text' AND length(CAST(agent_id AS BLOB))<=96) THEN agent_id ELSE NULL END AS agent_id,\n  CASE WHEN (typeof(credential_id)='text' AND length(CAST(credential_id AS BLOB))<=96) THEN credential_id ELSE NULL END AS credential_id,\n  CASE WHEN (typeof(authority_epoch)='integer' AND authority_epoch BETWEEN 1 AND 9007199254740991) THEN authority_epoch ELSE NULL END AS authority_epoch,\n  CASE WHEN (typeof(proof_sha256)='text' AND length(CAST(proof_sha256 AS BLOB))<=64) THEN proof_sha256 ELSE NULL END AS proof_sha256,\n  CASE WHEN (typeof(runtime_version)='integer' AND runtime_version BETWEEN 1 AND 9007199254740991) THEN runtime_version ELSE NULL END AS runtime_version,\n  CASE WHEN (typeof(status)='text' AND length(CAST(status AS BLOB))<=64) THEN status ELSE NULL END AS status,\n  CASE WHEN (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN created_at ELSE NULL END AS created_at,\n  CASE WHEN (typeof(last_seen_at)='integer' AND last_seen_at BETWEEN 0 AND 9007199254740991) THEN last_seen_at ELSE NULL END AS last_seen_at,\n  CASE WHEN (typeof(presence_expires_at)='integer' AND presence_expires_at BETWEEN 0 AND 9007199254740991) THEN presence_expires_at ELSE NULL END AS presence_expires_at,\n  CASE WHEN (typeof(revoked_at)='null' OR (typeof(revoked_at)='integer' AND revoked_at BETWEEN 0 AND 9007199254740991)) THEN revoked_at ELSE NULL END AS revoked_at\nFROM runtimes\nWHERE workspace_id=?\nORDER BY id\nLIMIT 9;",
    "sqlSha256": "84bd5285534616cbc3c64f8e1418b52ed02478fe1b1b9e6aa82ed2e773af7c8c",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "id",
        "type": "t96"
      },
      {
        "name": "agent_id",
        "type": "t96"
      },
      {
        "name": "credential_id",
        "type": "t96"
      },
      {
        "name": "authority_epoch",
        "type": "n1"
      },
      {
        "name": "proof_sha256",
        "type": "t64"
      },
      {
        "name": "runtime_version",
        "type": "n1"
      },
      {
        "name": "status",
        "type": "t64"
      },
      {
        "name": "created_at",
        "type": "n0"
      },
      {
        "name": "last_seen_at",
        "type": "n0"
      },
      {
        "name": "presence_expires_at",
        "type": "n0"
      },
      {
        "name": "revoked_at",
        "type": "n0?"
      }
    ],
    "limits": {
      "acceptedRows": 8,
      "bridgeRows": 9,
      "rawScalarRowBytes": 568,
      "jsonRowBytes": 3375,
      "rawScalarBytes": 5112,
      "jsonArrayBytes": 30385,
      "canonicalBytes": 16384
    }
  },
  "T": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) AND (typeof(title)='text' AND length(CAST(title AS BLOB))<=512) AND (typeof(description)='text' AND length(CAST(description AS BLOB))<=2048) AND (typeof(state)='text' AND length(CAST(state AS BLOB))<=64) AND (typeof(task_version)='integer' AND task_version BETWEEN 1 AND 9007199254740991) AND (typeof(proposal_version)='integer' AND proposal_version BETWEEN 0 AND 9007199254740991) AND (typeof(project_id)='null' OR (typeof(project_id)='text' AND length(CAST(project_id AS BLOB))<=96)) AND (typeof(work_role_id)='null' OR (typeof(work_role_id)='text' AND length(CAST(work_role_id AS BLOB))<=96)) AND (typeof(assigned_agent_id)='null' OR (typeof(assigned_agent_id)='text' AND length(CAST(assigned_agent_id AS BLOB))<=96)) AND (typeof(active_run_id)='null' OR (typeof(active_run_id)='text' AND length(CAST(active_run_id AS BLOB))<=96)) AND (typeof(latest_run_id)='null' OR (typeof(latest_run_id)='text' AND length(CAST(latest_run_id AS BLOB))<=96)) AND (typeof(approval_id)='null' OR (typeof(approval_id)='text' AND length(CAST(approval_id AS BLOB))<=96)) AND (typeof(current_result_id)='null' OR (typeof(current_result_id)='text' AND length(CAST(current_result_id AS BLOB))<=96)) AND (typeof(retry_count)='integer' AND retry_count BETWEEN 0 AND 9007199254740991) AND (typeof(retry_limit)='integer' AND retry_limit BETWEEN 0 AND 9007199254740991) AND (typeof(flags_json)='text' AND length(CAST(flags_json AS BLOB))<=4096) AND (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) AND (typeof(updated_at)='integer' AND updated_at BETWEEN 0 AND 9007199254740991) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) THEN id ELSE NULL END AS id,\n  CASE WHEN (typeof(title)='text' AND length(CAST(title AS BLOB))<=512) THEN title ELSE NULL END AS title,\n  CASE WHEN (typeof(description)='text' AND length(CAST(description AS BLOB))<=2048) THEN description ELSE NULL END AS description,\n  CASE WHEN (typeof(state)='text' AND length(CAST(state AS BLOB))<=64) THEN state ELSE NULL END AS state,\n  CASE WHEN (typeof(task_version)='integer' AND task_version BETWEEN 1 AND 9007199254740991) THEN task_version ELSE NULL END AS task_version,\n  CASE WHEN (typeof(proposal_version)='integer' AND proposal_version BETWEEN 0 AND 9007199254740991) THEN proposal_version ELSE NULL END AS proposal_version,\n  CASE WHEN (typeof(project_id)='null' OR (typeof(project_id)='text' AND length(CAST(project_id AS BLOB))<=96)) THEN project_id ELSE NULL END AS project_id,\n  CASE WHEN (typeof(work_role_id)='null' OR (typeof(work_role_id)='text' AND length(CAST(work_role_id AS BLOB))<=96)) THEN work_role_id ELSE NULL END AS work_role_id,\n  CASE WHEN (typeof(assigned_agent_id)='null' OR (typeof(assigned_agent_id)='text' AND length(CAST(assigned_agent_id AS BLOB))<=96)) THEN assigned_agent_id ELSE NULL END AS assigned_agent_id,\n  CASE WHEN (typeof(active_run_id)='null' OR (typeof(active_run_id)='text' AND length(CAST(active_run_id AS BLOB))<=96)) THEN active_run_id ELSE NULL END AS active_run_id,\n  CASE WHEN (typeof(latest_run_id)='null' OR (typeof(latest_run_id)='text' AND length(CAST(latest_run_id AS BLOB))<=96)) THEN latest_run_id ELSE NULL END AS latest_run_id,\n  CASE WHEN (typeof(approval_id)='null' OR (typeof(approval_id)='text' AND length(CAST(approval_id AS BLOB))<=96)) THEN approval_id ELSE NULL END AS approval_id,\n  CASE WHEN (typeof(current_result_id)='null' OR (typeof(current_result_id)='text' AND length(CAST(current_result_id AS BLOB))<=96)) THEN current_result_id ELSE NULL END AS current_result_id,\n  CASE WHEN (typeof(retry_count)='integer' AND retry_count BETWEEN 0 AND 9007199254740991) THEN retry_count ELSE NULL END AS retry_count,\n  CASE WHEN (typeof(retry_limit)='integer' AND retry_limit BETWEEN 0 AND 9007199254740991) THEN retry_limit ELSE NULL END AS retry_limit,\n  CASE WHEN (typeof(flags_json)='text' AND length(CAST(flags_json AS BLOB))<=4096) THEN flags_json ELSE NULL END AS flags_json,\n  CASE WHEN (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN created_at ELSE NULL END AS created_at,\n  CASE WHEN (typeof(updated_at)='integer' AND updated_at BETWEEN 0 AND 9007199254740991) THEN updated_at ELSE NULL END AS updated_at\nFROM tasks\nWHERE workspace_id=?\nORDER BY created_at,id\nLIMIT 17;",
    "sqlSha256": "df9f3bc3fef93bbfc6e6173ec1c63c6d285e33479c2b29dab3f48435e616d53d",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "id",
        "type": "t96"
      },
      {
        "name": "title",
        "type": "t512"
      },
      {
        "name": "description",
        "type": "t2048"
      },
      {
        "name": "state",
        "type": "t64"
      },
      {
        "name": "task_version",
        "type": "n1"
      },
      {
        "name": "proposal_version",
        "type": "n0"
      },
      {
        "name": "project_id",
        "type": "t96?"
      },
      {
        "name": "work_role_id",
        "type": "t96?"
      },
      {
        "name": "assigned_agent_id",
        "type": "t96?"
      },
      {
        "name": "active_run_id",
        "type": "t96?"
      },
      {
        "name": "latest_run_id",
        "type": "t96?"
      },
      {
        "name": "approval_id",
        "type": "t96?"
      },
      {
        "name": "current_result_id",
        "type": "t96?"
      },
      {
        "name": "retry_count",
        "type": "n0"
      },
      {
        "name": "retry_limit",
        "type": "n0"
      },
      {
        "name": "flags_json",
        "type": "t4096"
      },
      {
        "name": "created_at",
        "type": "n0"
      },
      {
        "name": "updated_at",
        "type": "n0"
      }
    ],
    "limits": {
      "acceptedRows": 16,
      "bridgeRows": 17,
      "rawScalarRowBytes": 7640,
      "jsonRowBytes": 45923,
      "rawScalarBytes": 129880,
      "jsonArrayBytes": 780709,
      "canonicalBytes": 16384
    }
  },
  "R": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) AND (typeof(task_id)='text' AND length(CAST(task_id AS BLOB))<=96) AND (typeof(agent_id)='text' AND length(CAST(agent_id AS BLOB))<=96) AND (typeof(runtime_instance_id)='text' AND length(CAST(runtime_instance_id AS BLOB))<=96) AND (typeof(credential_id)='text' AND length(CAST(credential_id AS BLOB))<=96) AND (typeof(authority_epoch)='integer' AND authority_epoch BETWEEN 1 AND 9007199254740991) AND (typeof(status)='text' AND length(CAST(status AS BLOB))<=64) AND (typeof(run_version)='integer' AND run_version BETWEEN 1 AND 9007199254740991) AND (typeof(fence)='integer' AND fence BETWEEN 1 AND 9007199254740991) AND (typeof(lease_expires_at)='integer' AND lease_expires_at BETWEEN 0 AND 9007199254740991) AND (typeof(started_at)='integer' AND started_at BETWEEN 0 AND 9007199254740991) AND (typeof(ended_at)='null' OR (typeof(ended_at)='integer' AND ended_at BETWEEN 0 AND 9007199254740991)) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) THEN id ELSE NULL END AS id,\n  CASE WHEN (typeof(task_id)='text' AND length(CAST(task_id AS BLOB))<=96) THEN task_id ELSE NULL END AS task_id,\n  CASE WHEN (typeof(agent_id)='text' AND length(CAST(agent_id AS BLOB))<=96) THEN agent_id ELSE NULL END AS agent_id,\n  CASE WHEN (typeof(runtime_instance_id)='text' AND length(CAST(runtime_instance_id AS BLOB))<=96) THEN runtime_instance_id ELSE NULL END AS runtime_instance_id,\n  CASE WHEN (typeof(credential_id)='text' AND length(CAST(credential_id AS BLOB))<=96) THEN credential_id ELSE NULL END AS credential_id,\n  CASE WHEN (typeof(authority_epoch)='integer' AND authority_epoch BETWEEN 1 AND 9007199254740991) THEN authority_epoch ELSE NULL END AS authority_epoch,\n  CASE WHEN (typeof(status)='text' AND length(CAST(status AS BLOB))<=64) THEN status ELSE NULL END AS status,\n  CASE WHEN (typeof(run_version)='integer' AND run_version BETWEEN 1 AND 9007199254740991) THEN run_version ELSE NULL END AS run_version,\n  CASE WHEN (typeof(fence)='integer' AND fence BETWEEN 1 AND 9007199254740991) THEN fence ELSE NULL END AS fence,\n  CASE WHEN (typeof(lease_expires_at)='integer' AND lease_expires_at BETWEEN 0 AND 9007199254740991) THEN lease_expires_at ELSE NULL END AS lease_expires_at,\n  CASE WHEN (typeof(started_at)='integer' AND started_at BETWEEN 0 AND 9007199254740991) THEN started_at ELSE NULL END AS started_at,\n  CASE WHEN (typeof(ended_at)='null' OR (typeof(ended_at)='integer' AND ended_at BETWEEN 0 AND 9007199254740991)) THEN ended_at ELSE NULL END AS ended_at\nFROM runs\nWHERE workspace_id=?\nORDER BY id\nLIMIT 17;",
    "sqlSha256": "c1bff001fd4796cfd43fec20bc41a691eda60362e7c6de68375dd257ff53cf05",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "id",
        "type": "t96"
      },
      {
        "name": "task_id",
        "type": "t96"
      },
      {
        "name": "agent_id",
        "type": "t96"
      },
      {
        "name": "runtime_instance_id",
        "type": "t96"
      },
      {
        "name": "credential_id",
        "type": "t96"
      },
      {
        "name": "authority_epoch",
        "type": "n1"
      },
      {
        "name": "status",
        "type": "t64"
      },
      {
        "name": "run_version",
        "type": "n1"
      },
      {
        "name": "fence",
        "type": "n1"
      },
      {
        "name": "lease_expires_at",
        "type": "n0"
      },
      {
        "name": "started_at",
        "type": "n0"
      },
      {
        "name": "ended_at",
        "type": "n0?"
      }
    ],
    "limits": {
      "acceptedRows": 16,
      "bridgeRows": 17,
      "rawScalarRowBytes": 696,
      "jsonRowBytes": 4147,
      "rawScalarBytes": 11832,
      "jsonArrayBytes": 70517,
      "canonicalBytes": 16384
    }
  },
  "Q": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) AND (typeof(task_id)='text' AND length(CAST(task_id AS BLOB))<=96) AND (typeof(run_id)='text' AND length(CAST(run_id AS BLOB))<=96) AND (typeof(submission_sequence)='integer' AND submission_sequence BETWEEN 1 AND 9007199254740991) AND (typeof(submitted_kind)='text' AND length(CAST(submitted_kind AS BLOB))<=64) AND (typeof(submitted_principal_id)='text' AND length(CAST(submitted_principal_id AS BLOB))<=96) AND (typeof(submitted_agent_id)='null' OR (typeof(submitted_agent_id)='text' AND length(CAST(submitted_agent_id AS BLOB))<=96)) AND (typeof(summary)='text' AND length(CAST(summary AS BLOB))<=2048) AND (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) THEN id ELSE NULL END AS id,\n  CASE WHEN (typeof(task_id)='text' AND length(CAST(task_id AS BLOB))<=96) THEN task_id ELSE NULL END AS task_id,\n  CASE WHEN (typeof(run_id)='text' AND length(CAST(run_id AS BLOB))<=96) THEN run_id ELSE NULL END AS run_id,\n  CASE WHEN (typeof(submission_sequence)='integer' AND submission_sequence BETWEEN 1 AND 9007199254740991) THEN submission_sequence ELSE NULL END AS submission_sequence,\n  CASE WHEN (typeof(submitted_kind)='text' AND length(CAST(submitted_kind AS BLOB))<=64) THEN submitted_kind ELSE NULL END AS submitted_kind,\n  CASE WHEN (typeof(submitted_principal_id)='text' AND length(CAST(submitted_principal_id AS BLOB))<=96) THEN submitted_principal_id ELSE NULL END AS submitted_principal_id,\n  CASE WHEN (typeof(submitted_agent_id)='null' OR (typeof(submitted_agent_id)='text' AND length(CAST(submitted_agent_id AS BLOB))<=96)) THEN submitted_agent_id ELSE NULL END AS submitted_agent_id,\n  CASE WHEN (typeof(summary)='text' AND length(CAST(summary AS BLOB))<=2048) THEN summary ELSE NULL END AS summary,\n  CASE WHEN (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN created_at ELSE NULL END AS created_at\nFROM task_results\nWHERE workspace_id=?\nORDER BY task_id,submission_sequence,id\nLIMIT 9;",
    "sqlSha256": "50fede6cd9421241176916640df0ec431e91a6288786a01485cd47f6f2a316a2",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "id",
        "type": "t96"
      },
      {
        "name": "task_id",
        "type": "t96"
      },
      {
        "name": "run_id",
        "type": "t96"
      },
      {
        "name": "submission_sequence",
        "type": "n1"
      },
      {
        "name": "submitted_kind",
        "type": "t64"
      },
      {
        "name": "submitted_principal_id",
        "type": "t96"
      },
      {
        "name": "submitted_agent_id",
        "type": "t96?"
      },
      {
        "name": "summary",
        "type": "t2048"
      },
      {
        "name": "created_at",
        "type": "n0"
      }
    ],
    "limits": {
      "acceptedRows": 8,
      "bridgeRows": 9,
      "rawScalarRowBytes": 2712,
      "jsonRowBytes": 16346,
      "rawScalarBytes": 24408,
      "jsonArrayBytes": 147124,
      "canonicalBytes": 16384
    }
  },
  "A": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) AND (typeof(task_id)='text' AND length(CAST(task_id AS BLOB))<=96) AND (typeof(result_id)='text' AND length(CAST(result_id AS BLOB))<=96) AND (typeof(run_id)='text' AND length(CAST(run_id AS BLOB))<=96) AND (typeof(task_version)='integer' AND task_version BETWEEN 1 AND 9007199254740991) AND (typeof(reviewer_principal_id)='text' AND length(CAST(reviewer_principal_id AS BLOB))<=96) AND (typeof(reviewer_agent_id)='null' OR (typeof(reviewer_agent_id)='text' AND length(CAST(reviewer_agent_id AS BLOB))<=96)) AND (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) THEN id ELSE NULL END AS id,\n  CASE WHEN (typeof(task_id)='text' AND length(CAST(task_id AS BLOB))<=96) THEN task_id ELSE NULL END AS task_id,\n  CASE WHEN (typeof(result_id)='text' AND length(CAST(result_id AS BLOB))<=96) THEN result_id ELSE NULL END AS result_id,\n  CASE WHEN (typeof(run_id)='text' AND length(CAST(run_id AS BLOB))<=96) THEN run_id ELSE NULL END AS run_id,\n  CASE WHEN (typeof(task_version)='integer' AND task_version BETWEEN 1 AND 9007199254740991) THEN task_version ELSE NULL END AS task_version,\n  CASE WHEN (typeof(reviewer_principal_id)='text' AND length(CAST(reviewer_principal_id AS BLOB))<=96) THEN reviewer_principal_id ELSE NULL END AS reviewer_principal_id,\n  CASE WHEN (typeof(reviewer_agent_id)='null' OR (typeof(reviewer_agent_id)='text' AND length(CAST(reviewer_agent_id AS BLOB))<=96)) THEN reviewer_agent_id ELSE NULL END AS reviewer_agent_id,\n  CASE WHEN (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN created_at ELSE NULL END AS created_at\nFROM task_acceptances\nWHERE workspace_id=?\nORDER BY id\nLIMIT 9;",
    "sqlSha256": "18e9e672fb34255f5b9f0b019e586c671dfa7c6b5b1a1315d7070a8e0886925f",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "id",
        "type": "t96"
      },
      {
        "name": "task_id",
        "type": "t96"
      },
      {
        "name": "result_id",
        "type": "t96"
      },
      {
        "name": "run_id",
        "type": "t96"
      },
      {
        "name": "task_version",
        "type": "n1"
      },
      {
        "name": "reviewer_principal_id",
        "type": "t96"
      },
      {
        "name": "reviewer_agent_id",
        "type": "t96?"
      },
      {
        "name": "created_at",
        "type": "n0"
      }
    ],
    "limits": {
      "acceptedRows": 8,
      "bridgeRows": 9,
      "rawScalarRowBytes": 696,
      "jsonRowBytes": 4223,
      "rawScalarBytes": 6264,
      "jsonArrayBytes": 38017,
      "canonicalBytes": 16384
    }
  },
  "RA": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(result_id)='text' AND length(CAST(result_id AS BLOB))<=96) AND (typeof(artifact_id)='text' AND length(CAST(artifact_id AS BLOB))<=96) AND (typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 4) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(result_id)='text' AND length(CAST(result_id AS BLOB))<=96) THEN result_id ELSE NULL END AS result_id,\n  CASE WHEN (typeof(artifact_id)='text' AND length(CAST(artifact_id AS BLOB))<=96) THEN artifact_id ELSE NULL END AS artifact_id,\n  CASE WHEN (typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 4) THEN ordinal ELSE NULL END AS ordinal\nFROM result_artifacts\nWHERE workspace_id=?\nORDER BY result_id,ordinal\nLIMIT 9;",
    "sqlSha256": "a2de54fcb51daa43905dd48571d44110d92636de558ab6060b8d1063e9e2e25a",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "result_id",
        "type": "t96"
      },
      {
        "name": "artifact_id",
        "type": "t96"
      },
      {
        "name": "ordinal",
        "type": "o"
      }
    ],
    "limits": {
      "acceptedRows": 8,
      "bridgeRows": 9,
      "rawScalarRowBytes": 304,
      "jsonRowBytes": 1806,
      "rawScalarBytes": 2736,
      "jsonArrayBytes": 16264,
      "canonicalBytes": 16384
    }
  },
  "AR": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) AND (typeof(task_id)='null' OR (typeof(task_id)='text' AND length(CAST(task_id AS BLOB))<=96)) AND (typeof(run_id)='null' OR (typeof(run_id)='text' AND length(CAST(run_id AS BLOB))<=96)) AND (typeof(owner_kind)='text' AND length(CAST(owner_kind AS BLOB))<=64) AND (typeof(owner_principal_id)='text' AND length(CAST(owner_principal_id AS BLOB))<=96) AND (typeof(owner_agent_id)='null' OR (typeof(owner_agent_id)='text' AND length(CAST(owner_agent_id AS BLOB))<=96)) AND (typeof(filename)='text' AND length(CAST(filename AS BLOB))<=512) AND (typeof(media_type)='text' AND length(CAST(media_type AS BLOB))<=512) AND (typeof(status)='text' AND length(CAST(status AS BLOB))<=64) AND (typeof(sha256)='text' AND length(CAST(sha256 AS BLOB))<=64) AND (typeof(byte_size)='integer' AND byte_size BETWEEN 0 AND 9007199254740991) AND (typeof(active_generation_id)='null' OR (typeof(active_generation_id)='text' AND length(CAST(active_generation_id AS BLOB))<=96)) AND (typeof(committed_generation_id)='null' OR (typeof(committed_generation_id)='text' AND length(CAST(committed_generation_id AS BLOB))<=96)) AND (typeof(artifact_version)='integer' AND artifact_version BETWEEN 1 AND 9007199254740991) AND (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) AND (typeof(committed_at)='null' OR (typeof(committed_at)='integer' AND committed_at BETWEEN 0 AND 9007199254740991)) AND (typeof(expires_at)='null' OR (typeof(expires_at)='integer' AND expires_at BETWEEN 0 AND 9007199254740991)) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) THEN id ELSE NULL END AS id,\n  CASE WHEN (typeof(task_id)='null' OR (typeof(task_id)='text' AND length(CAST(task_id AS BLOB))<=96)) THEN task_id ELSE NULL END AS task_id,\n  CASE WHEN (typeof(run_id)='null' OR (typeof(run_id)='text' AND length(CAST(run_id AS BLOB))<=96)) THEN run_id ELSE NULL END AS run_id,\n  CASE WHEN (typeof(owner_kind)='text' AND length(CAST(owner_kind AS BLOB))<=64) THEN owner_kind ELSE NULL END AS owner_kind,\n  CASE WHEN (typeof(owner_principal_id)='text' AND length(CAST(owner_principal_id AS BLOB))<=96) THEN owner_principal_id ELSE NULL END AS owner_principal_id,\n  CASE WHEN (typeof(owner_agent_id)='null' OR (typeof(owner_agent_id)='text' AND length(CAST(owner_agent_id AS BLOB))<=96)) THEN owner_agent_id ELSE NULL END AS owner_agent_id,\n  CASE WHEN (typeof(filename)='text' AND length(CAST(filename AS BLOB))<=512) THEN filename ELSE NULL END AS filename,\n  CASE WHEN (typeof(media_type)='text' AND length(CAST(media_type AS BLOB))<=512) THEN media_type ELSE NULL END AS media_type,\n  CASE WHEN (typeof(status)='text' AND length(CAST(status AS BLOB))<=64) THEN status ELSE NULL END AS status,\n  CASE WHEN (typeof(sha256)='text' AND length(CAST(sha256 AS BLOB))<=64) THEN sha256 ELSE NULL END AS sha256,\n  CASE WHEN (typeof(byte_size)='integer' AND byte_size BETWEEN 0 AND 9007199254740991) THEN byte_size ELSE NULL END AS byte_size,\n  CASE WHEN (typeof(active_generation_id)='null' OR (typeof(active_generation_id)='text' AND length(CAST(active_generation_id AS BLOB))<=96)) THEN active_generation_id ELSE NULL END AS active_generation_id,\n  CASE WHEN (typeof(committed_generation_id)='null' OR (typeof(committed_generation_id)='text' AND length(CAST(committed_generation_id AS BLOB))<=96)) THEN committed_generation_id ELSE NULL END AS committed_generation_id,\n  CASE WHEN (typeof(artifact_version)='integer' AND artifact_version BETWEEN 1 AND 9007199254740991) THEN artifact_version ELSE NULL END AS artifact_version,\n  CASE WHEN (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN created_at ELSE NULL END AS created_at,\n  CASE WHEN (typeof(committed_at)='null' OR (typeof(committed_at)='integer' AND committed_at BETWEEN 0 AND 9007199254740991)) THEN committed_at ELSE NULL END AS committed_at,\n  CASE WHEN (typeof(expires_at)='null' OR (typeof(expires_at)='integer' AND expires_at BETWEEN 0 AND 9007199254740991)) THEN expires_at ELSE NULL END AS expires_at\nFROM artifacts\nWHERE workspace_id=?\nORDER BY created_at,id\nLIMIT 5;",
    "sqlSha256": "3985b6f5179213e0fc87efbc93caa960ae2b994af65d2a8ea16135ff9a98a9f3",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "id",
        "type": "t96"
      },
      {
        "name": "task_id",
        "type": "t96?"
      },
      {
        "name": "run_id",
        "type": "t96?"
      },
      {
        "name": "owner_kind",
        "type": "t64"
      },
      {
        "name": "owner_principal_id",
        "type": "t96"
      },
      {
        "name": "owner_agent_id",
        "type": "t96?"
      },
      {
        "name": "filename",
        "type": "t512"
      },
      {
        "name": "media_type",
        "type": "t512"
      },
      {
        "name": "status",
        "type": "t64"
      },
      {
        "name": "sha256",
        "type": "t64"
      },
      {
        "name": "byte_size",
        "type": "n0"
      },
      {
        "name": "active_generation_id",
        "type": "t96?"
      },
      {
        "name": "committed_generation_id",
        "type": "t96?"
      },
      {
        "name": "artifact_version",
        "type": "n1"
      },
      {
        "name": "created_at",
        "type": "n0"
      },
      {
        "name": "committed_at",
        "type": "n0?"
      },
      {
        "name": "expires_at",
        "type": "n0?"
      }
    ],
    "limits": {
      "acceptedRows": 4,
      "bridgeRows": 5,
      "rawScalarRowBytes": 2032,
      "jsonRowBytes": 12294,
      "rawScalarBytes": 10160,
      "jsonArrayBytes": 61476,
      "canonicalBytes": 16384
    }
  },
  "GEN": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) AND (typeof(artifact_id)='text' AND length(CAST(artifact_id AS BLOB))<=96) AND (typeof(state)='text' AND length(CAST(state AS BLOB))<=64) AND (typeof(expected_sha256)='text' AND length(CAST(expected_sha256 AS BLOB))<=64) AND (typeof(observed_sha256)='null' OR (typeof(observed_sha256)='text' AND length(CAST(observed_sha256 AS BLOB))<=64)) AND (typeof(expected_byte_size)='integer' AND expected_byte_size BETWEEN 0 AND 9007199254740991) AND (typeof(observed_byte_size)='null' OR (typeof(observed_byte_size)='integer' AND observed_byte_size BETWEEN 0 AND 9007199254740991)) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) THEN id ELSE NULL END AS id,\n  CASE WHEN (typeof(artifact_id)='text' AND length(CAST(artifact_id AS BLOB))<=96) THEN artifact_id ELSE NULL END AS artifact_id,\n  CASE WHEN (typeof(state)='text' AND length(CAST(state AS BLOB))<=64) THEN state ELSE NULL END AS state,\n  CASE WHEN (typeof(expected_sha256)='text' AND length(CAST(expected_sha256 AS BLOB))<=64) THEN expected_sha256 ELSE NULL END AS expected_sha256,\n  CASE WHEN (typeof(observed_sha256)='null' OR (typeof(observed_sha256)='text' AND length(CAST(observed_sha256 AS BLOB))<=64)) THEN observed_sha256 ELSE NULL END AS observed_sha256,\n  CASE WHEN (typeof(expected_byte_size)='integer' AND expected_byte_size BETWEEN 0 AND 9007199254740991) THEN expected_byte_size ELSE NULL END AS expected_byte_size,\n  CASE WHEN (typeof(observed_byte_size)='null' OR (typeof(observed_byte_size)='integer' AND observed_byte_size BETWEEN 0 AND 9007199254740991)) THEN observed_byte_size ELSE NULL END AS observed_byte_size\nFROM artifact_generations\nWHERE workspace_id=?\nORDER BY id\nLIMIT 9;",
    "sqlSha256": "19942258a89755ac3ef0fb467b7faec9c1f0e93248aa951a782e44db048bd33b",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "id",
        "type": "t96"
      },
      {
        "name": "artifact_id",
        "type": "t96"
      },
      {
        "name": "state",
        "type": "t64"
      },
      {
        "name": "expected_sha256",
        "type": "t64"
      },
      {
        "name": "observed_sha256",
        "type": "t64?"
      },
      {
        "name": "expected_byte_size",
        "type": "n0"
      },
      {
        "name": "observed_byte_size",
        "type": "n0?"
      }
    ],
    "limits": {
      "acceptedRows": 8,
      "bridgeRows": 9,
      "rawScalarRowBytes": 504,
      "jsonRowBytes": 3065,
      "rawScalarBytes": 4536,
      "jsonArrayBytes": 27595,
      "canonicalBytes": 16384
    }
  },
  "AS": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(artifact_id)='text' AND length(CAST(artifact_id AS BLOB))<=96) AND (typeof(resource_kind)='text' AND length(CAST(resource_kind AS BLOB))<=64) AND (typeof(resource_id)='text' AND length(CAST(resource_id AS BLOB))<=96) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(artifact_id)='text' AND length(CAST(artifact_id AS BLOB))<=96) THEN artifact_id ELSE NULL END AS artifact_id,\n  CASE WHEN (typeof(resource_kind)='text' AND length(CAST(resource_kind AS BLOB))<=64) THEN resource_kind ELSE NULL END AS resource_kind,\n  CASE WHEN (typeof(resource_id)='text' AND length(CAST(resource_id AS BLOB))<=96) THEN resource_id ELSE NULL END AS resource_id\nFROM artifact_associations\nWHERE workspace_id=?\nORDER BY artifact_id,resource_kind,resource_id\nLIMIT 17;",
    "sqlSha256": "4437ed5fb7871e4d1c6950e7b035e00ab5e2d4286aa0686db710bba84637fe68",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "artifact_id",
        "type": "t96"
      },
      {
        "name": "resource_kind",
        "type": "t64"
      },
      {
        "name": "resource_id",
        "type": "t96"
      }
    ],
    "limits": {
      "acceptedRows": 16,
      "bridgeRows": 17,
      "rawScalarRowBytes": 360,
      "jsonRowBytes": 2196,
      "rawScalarBytes": 6120,
      "jsonArrayBytes": 37350,
      "canonicalBytes": 16384
    }
  },
  "MSG": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) AND (typeof(thread_id)='text' AND length(CAST(thread_id AS BLOB))<=96) AND (typeof(sender_kind)='text' AND length(CAST(sender_kind AS BLOB))<=64) AND (typeof(sender_principal_id)='text' AND length(CAST(sender_principal_id AS BLOB))<=96) AND (typeof(sender_agent_id)='null' OR (typeof(sender_agent_id)='text' AND length(CAST(sender_agent_id AS BLOB))<=96)) AND (typeof(body)='text' AND length(CAST(body AS BLOB))<=2048) AND (typeof(refs_json)='text' AND length(CAST(refs_json AS BLOB))<=4096) AND (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) THEN id ELSE NULL END AS id,\n  CASE WHEN (typeof(thread_id)='text' AND length(CAST(thread_id AS BLOB))<=96) THEN thread_id ELSE NULL END AS thread_id,\n  CASE WHEN (typeof(sender_kind)='text' AND length(CAST(sender_kind AS BLOB))<=64) THEN sender_kind ELSE NULL END AS sender_kind,\n  CASE WHEN (typeof(sender_principal_id)='text' AND length(CAST(sender_principal_id AS BLOB))<=96) THEN sender_principal_id ELSE NULL END AS sender_principal_id,\n  CASE WHEN (typeof(sender_agent_id)='null' OR (typeof(sender_agent_id)='text' AND length(CAST(sender_agent_id AS BLOB))<=96)) THEN sender_agent_id ELSE NULL END AS sender_agent_id,\n  CASE WHEN (typeof(body)='text' AND length(CAST(body AS BLOB))<=2048) THEN body ELSE NULL END AS body,\n  CASE WHEN (typeof(refs_json)='text' AND length(CAST(refs_json AS BLOB))<=4096) THEN refs_json ELSE NULL END AS refs_json,\n  CASE WHEN (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN created_at ELSE NULL END AS created_at\nFROM messages\nWHERE workspace_id=?\nORDER BY created_at,id\nLIMIT 5;",
    "sqlSha256": "126cb2a07a7cf4d25844a8989c2009710c2454995dbc713532f08d81678a7b90",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "id",
        "type": "t96"
      },
      {
        "name": "thread_id",
        "type": "t96"
      },
      {
        "name": "sender_kind",
        "type": "t64"
      },
      {
        "name": "sender_principal_id",
        "type": "t96"
      },
      {
        "name": "sender_agent_id",
        "type": "t96?"
      },
      {
        "name": "body",
        "type": "t2048"
      },
      {
        "name": "refs_json",
        "type": "t4096"
      },
      {
        "name": "created_at",
        "type": "n0"
      }
    ],
    "limits": {
      "acceptedRows": 4,
      "bridgeRows": 5,
      "rawScalarRowBytes": 6704,
      "jsonRowBytes": 40300,
      "rawScalarBytes": 33520,
      "jsonArrayBytes": 201506,
      "canonicalBytes": 16384
    }
  },
  "IN": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(message_id)='text' AND length(CAST(message_id AS BLOB))<=96) AND (typeof(recipient_agent_id)='text' AND length(CAST(recipient_agent_id AS BLOB))<=96) AND (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) AND (typeof(acknowledged_at)='null' OR (typeof(acknowledged_at)='integer' AND acknowledged_at BETWEEN 0 AND 9007199254740991)) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(message_id)='text' AND length(CAST(message_id AS BLOB))<=96) THEN message_id ELSE NULL END AS message_id,\n  CASE WHEN (typeof(recipient_agent_id)='text' AND length(CAST(recipient_agent_id AS BLOB))<=96) THEN recipient_agent_id ELSE NULL END AS recipient_agent_id,\n  CASE WHEN (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN created_at ELSE NULL END AS created_at,\n  CASE WHEN (typeof(acknowledged_at)='null' OR (typeof(acknowledged_at)='integer' AND acknowledged_at BETWEEN 0 AND 9007199254740991)) THEN acknowledged_at ELSE NULL END AS acknowledged_at\nFROM inbox\nWHERE workspace_id=?\nORDER BY message_id,recipient_agent_id\nLIMIT 9;",
    "sqlSha256": "3723d5f626be95445dac80d442907ac427d3e9078e28f2496e4c4c1228d00b34",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "message_id",
        "type": "t96"
      },
      {
        "name": "recipient_agent_id",
        "type": "t96"
      },
      {
        "name": "created_at",
        "type": "n0"
      },
      {
        "name": "acknowledged_at",
        "type": "n0?"
      }
    ],
    "limits": {
      "acceptedRows": 8,
      "bridgeRows": 9,
      "rawScalarRowBytes": 312,
      "jsonRowBytes": 1864,
      "rawScalarBytes": 2808,
      "jsonArrayBytes": 16786,
      "canonicalBytes": 16384
    }
  },
  "TH": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) AND (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) THEN id ELSE NULL END AS id,\n  CASE WHEN (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN created_at ELSE NULL END AS created_at\nFROM threads\nWHERE workspace_id=?\nORDER BY id\nLIMIT 5;",
    "sqlSha256": "864fbe2aa53b45bd0e6bb308d3f10a0cc0e256e39e06cad7f12f3decef36bc91",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "id",
        "type": "t96"
      },
      {
        "name": "created_at",
        "type": "n0"
      }
    ],
    "limits": {
      "acceptedRows": 4,
      "bridgeRows": 5,
      "rawScalarRowBytes": 208,
      "jsonRowBytes": 1221,
      "rawScalarBytes": 1040,
      "jsonArrayBytes": 6111,
      "canonicalBytes": 16384
    }
  },
  "TP": {
    "sql": "SELECT\n  CASE WHEN (typeof(t.workspace_id)='text' AND length(CAST(t.workspace_id AS BLOB))<=96) AND (typeof(p.thread_id)='text' AND length(CAST(p.thread_id AS BLOB))<=96) AND (typeof(p.participant_kind)='text' AND length(CAST(p.participant_kind AS BLOB))<=64) AND (typeof(p.participant_id)='text' AND length(CAST(p.participant_id AS BLOB))<=96) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(t.workspace_id)='text' AND length(CAST(t.workspace_id AS BLOB))<=96) THEN t.workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(p.thread_id)='text' AND length(CAST(p.thread_id AS BLOB))<=96) THEN p.thread_id ELSE NULL END AS thread_id,\n  CASE WHEN (typeof(p.participant_kind)='text' AND length(CAST(p.participant_kind AS BLOB))<=64) THEN p.participant_kind ELSE NULL END AS participant_kind,\n  CASE WHEN (typeof(p.participant_id)='text' AND length(CAST(p.participant_id AS BLOB))<=96) THEN p.participant_id ELSE NULL END AS participant_id\nFROM thread_participants p JOIN threads t ON t.id=p.thread_id\nWHERE t.workspace_id=?\nORDER BY p.thread_id,p.participant_kind,p.participant_id\nLIMIT 9;",
    "sqlSha256": "366f5562efa6af97594bdb2f73d82588961e9c1d878ec7224974bb08abdc8fce",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "thread_id",
        "type": "t96"
      },
      {
        "name": "participant_kind",
        "type": "t64"
      },
      {
        "name": "participant_id",
        "type": "t96"
      }
    ],
    "limits": {
      "acceptedRows": 8,
      "bridgeRows": 9,
      "rawScalarRowBytes": 360,
      "jsonRowBytes": 2200,
      "rawScalarBytes": 3240,
      "jsonArrayBytes": 19810,
      "canonicalBytes": 16384
    }
  },
  "MA": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(message_id)='text' AND length(CAST(message_id AS BLOB))<=96) AND (typeof(artifact_id)='text' AND length(CAST(artifact_id AS BLOB))<=96) AND (typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 4) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(message_id)='text' AND length(CAST(message_id AS BLOB))<=96) THEN message_id ELSE NULL END AS message_id,\n  CASE WHEN (typeof(artifact_id)='text' AND length(CAST(artifact_id AS BLOB))<=96) THEN artifact_id ELSE NULL END AS artifact_id,\n  CASE WHEN (typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 4) THEN ordinal ELSE NULL END AS ordinal\nFROM message_artifacts\nWHERE workspace_id=?\nORDER BY message_id,ordinal\nLIMIT 1;",
    "sqlSha256": "0ce3def300ff2dfe8756efa11780990082e3bffec7ab87e6d01aff7ea6637036",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "message_id",
        "type": "t96"
      },
      {
        "name": "artifact_id",
        "type": "t96"
      },
      {
        "name": "ordinal",
        "type": "o"
      }
    ],
    "limits": {
      "acceptedRows": 0,
      "bridgeRows": 1,
      "rawScalarRowBytes": 304,
      "jsonRowBytes": 1807,
      "rawScalarBytes": 304,
      "jsonArrayBytes": 1809,
      "canonicalBytes": 16384
    }
  },
  "AG": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(agent_id)='text' AND length(CAST(agent_id AS BLOB))<=96) AND (typeof(agent_version)='integer' AND agent_version BETWEEN 1 AND 9007199254740991) AND (typeof(display_name)='text' AND length(CAST(display_name AS BLOB))<=512) AND (typeof(description)='text' AND length(CAST(description AS BLOB))<=2048) AND (typeof(work_role_ids_json)='text' AND length(CAST(work_role_ids_json AS BLOB))<=4096) AND (typeof(framework)='null' OR (typeof(framework)='text' AND length(CAST(framework AS BLOB))<=512)) AND (typeof(model)='null' OR (typeof(model)='text' AND length(CAST(model AS BLOB))<=512)) AND (typeof(status)='text' AND length(CAST(status AS BLOB))<=64) AND (typeof(origin)='text' AND length(CAST(origin AS BLOB))<=64) AND (typeof(config_epoch)='integer' AND config_epoch BETWEEN 1 AND 9007199254740991) AND (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) AND (typeof(updated_at)='integer' AND updated_at BETWEEN 0 AND 9007199254740991) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(agent_id)='text' AND length(CAST(agent_id AS BLOB))<=96) THEN agent_id ELSE NULL END AS agent_id,\n  CASE WHEN (typeof(agent_version)='integer' AND agent_version BETWEEN 1 AND 9007199254740991) THEN agent_version ELSE NULL END AS agent_version,\n  CASE WHEN (typeof(display_name)='text' AND length(CAST(display_name AS BLOB))<=512) THEN display_name ELSE NULL END AS display_name,\n  CASE WHEN (typeof(description)='text' AND length(CAST(description AS BLOB))<=2048) THEN description ELSE NULL END AS description,\n  CASE WHEN (typeof(work_role_ids_json)='text' AND length(CAST(work_role_ids_json AS BLOB))<=4096) THEN work_role_ids_json ELSE NULL END AS work_role_ids_json,\n  CASE WHEN (typeof(framework)='null' OR (typeof(framework)='text' AND length(CAST(framework AS BLOB))<=512)) THEN framework ELSE NULL END AS framework,\n  CASE WHEN (typeof(model)='null' OR (typeof(model)='text' AND length(CAST(model AS BLOB))<=512)) THEN model ELSE NULL END AS model,\n  CASE WHEN (typeof(status)='text' AND length(CAST(status AS BLOB))<=64) THEN status ELSE NULL END AS status,\n  CASE WHEN (typeof(origin)='text' AND length(CAST(origin AS BLOB))<=64) THEN origin ELSE NULL END AS origin,\n  CASE WHEN (typeof(config_epoch)='integer' AND config_epoch BETWEEN 1 AND 9007199254740991) THEN config_epoch ELSE NULL END AS config_epoch,\n  CASE WHEN (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN created_at ELSE NULL END AS created_at,\n  CASE WHEN (typeof(updated_at)='integer' AND updated_at BETWEEN 0 AND 9007199254740991) THEN updated_at ELSE NULL END AS updated_at\nFROM static_agents\nWHERE workspace_id=?\nORDER BY created_at,agent_id\nLIMIT 9;",
    "sqlSha256": "c00ce3b7e589d696c5de9a65de6bdbc4fcc33e038bbbfa767980da028f389075",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "agent_id",
        "type": "t96"
      },
      {
        "name": "agent_version",
        "type": "n1"
      },
      {
        "name": "display_name",
        "type": "t512"
      },
      {
        "name": "description",
        "type": "t2048"
      },
      {
        "name": "work_role_ids_json",
        "type": "t4096"
      },
      {
        "name": "framework",
        "type": "t512?"
      },
      {
        "name": "model",
        "type": "t512?"
      },
      {
        "name": "status",
        "type": "t64"
      },
      {
        "name": "origin",
        "type": "t64"
      },
      {
        "name": "config_epoch",
        "type": "n1"
      },
      {
        "name": "created_at",
        "type": "n0"
      },
      {
        "name": "updated_at",
        "type": "n0"
      }
    ],
    "limits": {
      "acceptedRows": 8,
      "bridgeRows": 9,
      "rawScalarRowBytes": 8040,
      "jsonRowBytes": 48279,
      "rawScalarBytes": 72360,
      "jsonArrayBytes": 434521,
      "canonicalBytes": 16384
    }
  },
  "E": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) AND (typeof(sequence)='integer' AND sequence BETWEEN 1 AND 9007199254740991) AND (typeof(type)='text' AND length(CAST(type AS BLOB))<=64) AND (typeof(actor_json)='text' AND length(CAST(actor_json AS BLOB))<=512) AND (typeof(resource_type)='text' AND length(CAST(resource_type AS BLOB))<=64) AND (typeof(resource_id)='text' AND length(CAST(resource_id AS BLOB))<=96) AND (typeof(resource_version)='null' OR (typeof(resource_version)='integer' AND resource_version BETWEEN 0 AND 9007199254740991)) AND (typeof(thread_id)='null' OR (typeof(thread_id)='text' AND length(CAST(thread_id AS BLOB))<=96)) AND (typeof(request_id)='text' AND length(CAST(request_id AS BLOB))<=96) AND (typeof(occurred_at)='integer' AND occurred_at BETWEEN 0 AND 9007199254740991) AND (typeof(summary)='text' AND length(CAST(summary AS BLOB))<=2048) AND (typeof(task_version)='null' OR (typeof(task_version)='integer' AND task_version BETWEEN 1 AND 9007199254740991)) AND (typeof(run_id)='null' OR (typeof(run_id)='text' AND length(CAST(run_id AS BLOB))<=96)) AND (typeof(fence)='null' OR (typeof(fence)='integer' AND fence BETWEEN 1 AND 9007199254740991)) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) THEN id ELSE NULL END AS id,\n  CASE WHEN (typeof(sequence)='integer' AND sequence BETWEEN 1 AND 9007199254740991) THEN sequence ELSE NULL END AS sequence,\n  CASE WHEN (typeof(type)='text' AND length(CAST(type AS BLOB))<=64) THEN type ELSE NULL END AS type,\n  CASE WHEN (typeof(actor_json)='text' AND length(CAST(actor_json AS BLOB))<=512) THEN actor_json ELSE NULL END AS actor_json,\n  CASE WHEN (typeof(resource_type)='text' AND length(CAST(resource_type AS BLOB))<=64) THEN resource_type ELSE NULL END AS resource_type,\n  CASE WHEN (typeof(resource_id)='text' AND length(CAST(resource_id AS BLOB))<=96) THEN resource_id ELSE NULL END AS resource_id,\n  CASE WHEN (typeof(resource_version)='null' OR (typeof(resource_version)='integer' AND resource_version BETWEEN 0 AND 9007199254740991)) THEN resource_version ELSE NULL END AS resource_version,\n  CASE WHEN (typeof(thread_id)='null' OR (typeof(thread_id)='text' AND length(CAST(thread_id AS BLOB))<=96)) THEN thread_id ELSE NULL END AS thread_id,\n  CASE WHEN (typeof(request_id)='text' AND length(CAST(request_id AS BLOB))<=96) THEN request_id ELSE NULL END AS request_id,\n  CASE WHEN (typeof(occurred_at)='integer' AND occurred_at BETWEEN 0 AND 9007199254740991) THEN occurred_at ELSE NULL END AS occurred_at,\n  CASE WHEN (typeof(summary)='text' AND length(CAST(summary AS BLOB))<=2048) THEN summary ELSE NULL END AS summary,\n  CASE WHEN (typeof(task_version)='null' OR (typeof(task_version)='integer' AND task_version BETWEEN 1 AND 9007199254740991)) THEN task_version ELSE NULL END AS task_version,\n  CASE WHEN (typeof(run_id)='null' OR (typeof(run_id)='text' AND length(CAST(run_id AS BLOB))<=96)) THEN run_id ELSE NULL END AS run_id,\n  CASE WHEN (typeof(fence)='null' OR (typeof(fence)='integer' AND fence BETWEEN 1 AND 9007199254740991)) THEN fence ELSE NULL END AS fence\nFROM events\nWHERE workspace_id=?\nORDER BY sequence\nLIMIT 49;",
    "sqlSha256": "5988a946f3070a65b0c2d491ad533fe0c202a11a8dd919a29357ed17941aefab",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "id",
        "type": "t96"
      },
      {
        "name": "sequence",
        "type": "n1"
      },
      {
        "name": "type",
        "type": "t64"
      },
      {
        "name": "actor_json",
        "type": "t512"
      },
      {
        "name": "resource_type",
        "type": "t64"
      },
      {
        "name": "resource_id",
        "type": "t96"
      },
      {
        "name": "resource_version",
        "type": "n0?"
      },
      {
        "name": "thread_id",
        "type": "t96?"
      },
      {
        "name": "request_id",
        "type": "t96"
      },
      {
        "name": "occurred_at",
        "type": "n0"
      },
      {
        "name": "summary",
        "type": "t2048"
      },
      {
        "name": "task_version",
        "type": "n1?"
      },
      {
        "name": "run_id",
        "type": "t96?"
      },
      {
        "name": "fence",
        "type": "n1?"
      }
    ],
    "limits": {
      "acceptedRows": 48,
      "bridgeRows": 49,
      "rawScalarRowBytes": 3312,
      "jsonRowBytes": 19893,
      "rawScalarBytes": 162288,
      "jsonArrayBytes": 974807,
      "canonicalBytes": 16384
    }
  },
  "H": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) AND (typeof(event_id)='text' AND length(CAST(event_id AS BLOB))<=96) AND (typeof(task_id)='text' AND length(CAST(task_id AS BLOB))<=96) AND (typeof(task_version)='integer' AND task_version BETWEEN 1 AND 9007199254740991) AND (typeof(run_id)='null' OR (typeof(run_id)='text' AND length(CAST(run_id AS BLOB))<=96)) AND (typeof(kind)='text' AND length(CAST(kind AS BLOB))<=64) AND (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(id)='text' AND length(CAST(id AS BLOB))<=96) THEN id ELSE NULL END AS id,\n  CASE WHEN (typeof(event_id)='text' AND length(CAST(event_id AS BLOB))<=96) THEN event_id ELSE NULL END AS event_id,\n  CASE WHEN (typeof(task_id)='text' AND length(CAST(task_id AS BLOB))<=96) THEN task_id ELSE NULL END AS task_id,\n  CASE WHEN (typeof(task_version)='integer' AND task_version BETWEEN 1 AND 9007199254740991) THEN task_version ELSE NULL END AS task_version,\n  CASE WHEN (typeof(run_id)='null' OR (typeof(run_id)='text' AND length(CAST(run_id AS BLOB))<=96)) THEN run_id ELSE NULL END AS run_id,\n  CASE WHEN (typeof(kind)='text' AND length(CAST(kind AS BLOB))<=64) THEN kind ELSE NULL END AS kind,\n  CASE WHEN (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991) THEN created_at ELSE NULL END AS created_at\nFROM task_history\nWHERE workspace_id=?\nORDER BY id\nLIMIT 49;",
    "sqlSha256": "d7689047845e16aeb9164948a57af83707bbe929abf585e80191031f407ad5c8",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "id",
        "type": "t96"
      },
      {
        "name": "event_id",
        "type": "t96"
      },
      {
        "name": "task_id",
        "type": "t96"
      },
      {
        "name": "task_version",
        "type": "n1"
      },
      {
        "name": "run_id",
        "type": "t96?"
      },
      {
        "name": "kind",
        "type": "t64"
      },
      {
        "name": "created_at",
        "type": "n0"
      }
    ],
    "limits": {
      "acceptedRows": 48,
      "bridgeRows": 49,
      "rawScalarRowBytes": 568,
      "jsonRowBytes": 3414,
      "rawScalarBytes": 27832,
      "jsonArrayBytes": 167336,
      "canonicalBytes": 16384
    }
  },
  "P": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991) AND (typeof(document_json)='text' AND length(CAST(document_json AS BLOB))<=16384) AND (typeof(updated_at)='integer' AND updated_at BETWEEN 0 AND 9007199254740991) AND (typeof(updated_by)='text' AND length(CAST(updated_by AS BLOB))<=96) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991) THEN version ELSE NULL END AS version,\n  CASE WHEN (typeof(document_json)='text' AND length(CAST(document_json AS BLOB))<=16384) THEN document_json ELSE NULL END AS document_json,\n  CASE WHEN (typeof(updated_at)='integer' AND updated_at BETWEEN 0 AND 9007199254740991) THEN updated_at ELSE NULL END AS updated_at,\n  CASE WHEN (typeof(updated_by)='text' AND length(CAST(updated_by AS BLOB))<=96) THEN updated_by ELSE NULL END AS updated_by\nFROM profiles\nWHERE workspace_id=?\nORDER BY workspace_id\nLIMIT 2;",
    "sqlSha256": "fd550920511f2105f617c69d77f240575fc655509f477043ab2a50a217dfc935",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "version",
        "type": "n1"
      },
      {
        "name": "document_json",
        "type": "t16384"
      },
      {
        "name": "updated_at",
        "type": "n0"
      },
      {
        "name": "updated_by",
        "type": "t96"
      }
    ],
    "limits": {
      "acceptedRows": 1,
      "bridgeRows": 2,
      "rawScalarRowBytes": 16600,
      "jsonRowBytes": 99579,
      "rawScalarBytes": 33200,
      "jsonArrayBytes": 199161,
      "canonicalBytes": 16384
    }
  },
  "I0": {
    "sql": "SELECT\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) AND (typeof(key)='text' AND length(CAST(key AS BLOB))<=128) THEN 1 ELSE 0 END AS __valid,\n  CASE WHEN (typeof(workspace_id)='text' AND length(CAST(workspace_id AS BLOB))<=96) THEN workspace_id ELSE NULL END AS workspace_id,\n  CASE WHEN (typeof(key)='text' AND length(CAST(key AS BLOB))<=128) THEN key ELSE NULL END AS key\nFROM idempotency_outcomes\nWHERE workspace_id=?\nORDER BY key,principal_id,operation,target\nLIMIT 1;",
    "sqlSha256": "54f8de9543b0791fa3b0bae2c6ed335fb5bf73180f5bc1b13816bc282e0ac516",
    "parameters": [
      "W"
    ],
    "fields": [
      {
        "name": "workspace_id",
        "type": "t96"
      },
      {
        "name": "key",
        "type": "t128"
      }
    ],
    "limits": {
      "acceptedRows": 0,
      "bridgeRows": 1,
      "rawScalarRowBytes": 232,
      "jsonRowBytes": 1384,
      "rawScalarBytes": 232,
      "jsonArrayBytes": 1386,
      "canonicalBytes": 16384
    }
  }
};
const fail=()=>{throw Error('NATIVE_SQL_PROFILE_INCOMPLETE');};
function freeze(v){if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
export const NATIVE_SQL_CATALOG=freeze(definitions);
function descriptor(name){if(typeof name!=='string'||!Object.hasOwn(definitions,name))fail();return definitions[name];}
function closed(value,keys){if(!value||typeof value!=='object'||types.isProxy(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();const own=Reflect.ownKeys(value);if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))fail();const result=Object.create(null);for(const k of keys){const d=Object.getOwnPropertyDescriptor(value,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();result[k]=d.value;}return result;}
function id(v){if(typeof v!=='string'||v.length<1||v.length>96||/[^A-Za-z0-9_-]/.test(v))fail();return v;}
export function getNativeSqlSelector(selector,bindings){const d=descriptor(selector),keys=d.parameters.map(p=>p==='W'?'workspaceId':'credentialId'),b=closed(bindings,keys);return freeze({selector,sql:d.sql,parameters:keys.map(k=>id(b[k])),limits:d.limits});}
function scalar(value,type){const nullable=type.endsWith('?');type=type.replace(/\?$/,'');if(value===null){if(!nullable)fail();return value;}if(type[0]==='t'){if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>Number(type.slice(1)))fail();return value;}const lo=type==='n1'?1:0,hi=type==='b'?1:type==='o'?4:Number.MAX_SAFE_INTEGER;if(typeof value!=='number'||!Number.isSafeInteger(value)||Object.is(value,-0)||value<lo||value>hi)fail();return value;}
export function decodeNativeSqlRows(selector,input){
 const d=descriptor(selector);if(!Array.isArray(input)||types.isProxy(input)||Object.getPrototypeOf(input)!==Array.prototype)fail();
 const len=Object.getOwnPropertyDescriptor(input,'length')?.value;if(!Number.isSafeInteger(len)||len>d.limits.acceptedRows)fail();
 const ak=Reflect.ownKeys(input);if(ak.length!==len+1||ak.some(k=>k!=='length'&&(typeof k!=='string'||!/^\d+$/.test(k)||Number(k)>=len||String(Number(k))!==k)))fail();
 const rows=[],parts=[];let size=2;const charge=n=>{size+=n;if(size>d.limits.canonicalBytes)fail();};
 for(let i=0;i<len;i++){
  const entry=Object.getOwnPropertyDescriptor(input,String(i));if(!entry||!Object.hasOwn(entry,'value'))fail();
  const r=closed(entry.value,['__valid',...d.fields.map(f=>f.name)]);if(r.__valid!==1)fail();
  const row={};for(const f of d.fields)row[f.name]=scalar(r[f.name],f.type);
  charge((i?1:0)+2);const fields=[];for(const [j,k]of Object.keys(row).sort().entries()){const value=JSON.stringify(row[k]),key=JSON.stringify(k);charge((j?1:0)+Buffer.byteLength(key)+1+Buffer.byteLength(value));fields.push(key+':'+value);}
  rows.push(freeze(row));parts.push('{'+fields.join(',')+'}');
 }
 const canonical='['+parts.join(',')+']';return freeze({selector,rows,sha256:createHash('sha256').update(canonical).digest('hex'),byteSize:size,scope:'bounded-selected-sql',native_conformance:false});
}
