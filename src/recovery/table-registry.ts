import {CURRENT_SCHEMA_VERSION,EXPECTED_SCHEMA_VERSIONS} from '../storage/schema-version.ts';
import type {WorkspaceTransaction} from '../storage/transaction';
export const RECOVERY_SCHEMA_VERSION=CURRENT_SCHEMA_VERSION;
export interface RegistryColumn {name:string;type:string;notNull:boolean;defaultValue:string|null;pk:number;}
export interface RegistryTable {name:string;mode:'evidence'|'invalidate'|'domain-outcomes'|'paused-effects'|'restore';columns:readonly RegistryColumn[];primaryKey:readonly string[];foreignKeys:readonly (readonly (string|number)[])[];}
/** Reviewed schema, not a registry synthesized from the database being captured. */
export const TABLE_REGISTRY = [
 {
  "name": "schema_migrations",
  "mode": "evidence",
  "columns": [
   {
    "name": "version",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "applied_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "version"
  ],
  "foreignKeys": []
 },
 {
  "name": "workspace_metadata",
  "mode": "evidence",
  "columns": [
   {
    "name": "id",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "object_name",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "config_epoch",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "config_digest",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "installation_digest",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "config_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "bundle_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "installed_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "admission_state",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": "'installed'",
    "pk": 0
   },
   {
    "name": "message_retained_after_created_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "message_retained_after_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "event_retained_after_sequence",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": []
 },
 {
  "name": "human_grants",
  "mode": "restore",
  "columns": [
   {
    "name": "principal_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "issuer",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "subject",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "scopes_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "project_ids_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "enabled",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "config_epoch",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "principal_id"
  ],
  "foreignKeys": []
 },
 {
  "name": "static_agents",
  "mode": "restore",
  "columns": [
   {
    "name": "agent_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "display_name",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "config_epoch",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "origin",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": "'operator_static'",
    "pk": 0
   },
   {
    "name": "agent_version",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "1",
    "pk": 0
   },
   {
    "name": "description",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": "''",
    "pk": 0
   },
   {
    "name": "work_role_ids_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": "'[]'",
    "pk": 0
   },
   {
    "name": "framework",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "model",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "status",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": "'active'",
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "0",
    "pk": 0
   },
   {
    "name": "updated_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "0",
    "pk": 0
   }
  ],
  "primaryKey": [
   "agent_id"
  ],
  "foreignKeys": []
 },
 {
  "name": "native_credentials",
  "mode": "restore",
  "columns": [
   {
    "name": "credential_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "agent_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "token_sha256",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "scopes_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "project_ids_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "expires_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "enabled",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "config_epoch",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "retired_at_epoch",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "origin",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": "'operator_static'",
    "pk": 0
   },
   {
    "name": "credential_version",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "1",
    "pk": 0
   },
   {
    "name": "label",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": "''",
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "0",
    "pk": 0
   },
   {
    "name": "revoked_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "issued_by_principal_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "credential_id"
  ],
  "foreignKeys": []
 },
 {
  "name": "login_attempts",
  "mode": "invalidate",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "state_digest",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "nonce",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "pkce_verifier",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "cookie_digest",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "redirect_uri",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "expires_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "consumed_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "auth_epoch",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "0",
    "pk": 0
   },
   {
    "name": "return_path",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": "'/'",
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": []
 },
 {
  "name": "sessions",
  "mode": "invalidate",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "principal_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "token_digest",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "csrf_digest",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "issuer",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "subject",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "expires_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "revoked_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "auth_epoch",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "0",
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": []
 },
 {
  "name": "profiles",
  "mode": "restore",
  "columns": [
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "version",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "document_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "updated_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "updated_by",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "workspace_id"
  ],
  "foreignKeys": []
 },
 {
  "name": "preferences",
  "mode": "restore",
  "columns": [
   {
    "name": "principal_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "version",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "document_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "updated_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "record_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "principal_id"
  ],
  "foreignKeys": []
 },
 {
  "name": "threads",
  "mode": "restore",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "subject",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": []
 },
 {
  "name": "thread_participants",
  "mode": "restore",
  "columns": [
   {
    "name": "thread_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "participant_kind",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 2
   },
   {
    "name": "participant_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 3
   }
  ],
  "primaryKey": [
   "thread_id",
   "participant_kind",
   "participant_id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "threads",
    "thread_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "messages",
  "mode": "restore",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "thread_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "sender_kind",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "sender_principal_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "sender_agent_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "body",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "refs_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "threads",
    "thread_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "inbox",
  "mode": "restore",
  "columns": [
   {
    "name": "message_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "recipient_agent_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 2
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "acknowledged_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "message_id",
   "recipient_agent_id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "messages",
    "message_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "events",
  "mode": "restore",
  "columns": [
   {
    "name": "sequence",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "type",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "actor_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "resource_type",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "resource_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "resource_version",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "thread_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "request_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "occurred_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "summary",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "task_version",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "run_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "fence",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "sequence"
  ],
  "foreignKeys": []
 },
 {
  "name": "idempotency_outcomes",
  "mode": "domain-outcomes",
  "columns": [
   {
    "name": "principal_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "operation",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 2
   },
   {
    "name": "target",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 3
   },
   {
    "name": "key",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 4
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "fingerprint",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "status",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "outcome_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "original_request_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "event_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "expires_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "principal_id",
   "operation",
   "target",
   "key"
  ],
  "foreignKeys": []
 },
 {
  "name": "outbox",
  "mode": "paused-effects",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "message_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "destination_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "notification_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "payload_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "status",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "attempts",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "0",
    "pk": 0
   },
   {
    "name": "next_due_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "retry_multiplier",
    "type": "REAL",
    "notNull": true,
    "defaultValue": "1",
    "pk": 0
   },
   {
    "name": "lease_token",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "lease_expires_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "last_status",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "last_error",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "updated_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "destination_snapshot_json",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": []
 },
 {
  "name": "scheduler_state",
  "mode": "evidence",
  "columns": [
   {
    "name": "id",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "next_due_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "armed_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "last_run_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "dirty",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "0",
    "pk": 0
   },
   {
    "name": "generation",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "0",
    "pk": 0
   },
   {
    "name": "last_error_code",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": []
 },
 {
  "name": "maintenance_state",
  "mode": "evidence",
  "columns": [
   {
    "name": "id",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "state",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "barrier_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "authority_epoch",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "capture_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "updated_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "generation",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "0",
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": []
 },
 {
  "name": "recovery_jobs",
  "mode": "evidence",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "operation",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "state",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "authority_epoch",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "capture_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "manifest_digest",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "updated_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "details_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": []
 },
 {
  "name": "recovery_chunks",
  "mode": "evidence",
  "columns": [
   {
    "name": "job_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "chunk_index",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 2
   },
   {
    "name": "table_name",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "sha256",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "byte_size",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "row_count",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "object_key",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "job_id",
   "chunk_index"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "recovery_jobs",
    "job_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "probe_receipts",
  "mode": "evidence",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "authority_epoch",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "request_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "checked_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "receipt_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": []
 },
 {
  "name": "runtimes",
  "mode": "invalidate",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "agent_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "credential_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "authority_epoch",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "proof_sha256",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "runtime_version",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "label",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "status",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "last_seen_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "presence_expires_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "revoked_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "static_agents",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    1,
    "static_agents",
    "agent_id",
    "agent_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    0,
    "native_credentials",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    1,
    "native_credentials",
    "agent_id",
    "agent_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    2,
    "native_credentials",
    "credential_id",
    "credential_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "tasks",
  "mode": "restore",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "title",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "description",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "state",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "task_version",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "proposal_version",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "project_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "work_role_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "assigned_agent_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "active_run_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "latest_run_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "approval_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "current_result_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "retry_count",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "retry_limit",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "flags_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "next_fence",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "1",
    "pk": 0
   },
   {
    "name": "next_result_sequence",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "1",
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "updated_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "task_results",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    1,
    "task_results",
    "id",
    "task_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    2,
    "task_results",
    "current_result_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    0,
    "runs",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    1,
    "runs",
    "id",
    "task_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    2,
    "runs",
    "latest_run_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    2,
    0,
    "runs",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    2,
    1,
    "runs",
    "id",
    "task_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    2,
    2,
    "runs",
    "active_run_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    3,
    0,
    "static_agents",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    3,
    1,
    "static_agents",
    "assigned_agent_id",
    "agent_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "runs",
  "mode": "restore",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "task_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "agent_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "runtime_instance_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "credential_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "authority_epoch",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "status",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "run_version",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "fence",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "lease_expires_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "started_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "ended_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "replay_policy_version",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "replay_rule_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "replay_evidence_ref",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "runtimes",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    1,
    "runtimes",
    "agent_id",
    "agent_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    2,
    "runtimes",
    "credential_id",
    "credential_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    3,
    "runtimes",
    "runtime_instance_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    0,
    "tasks",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    1,
    "tasks",
    "task_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "task_results",
  "mode": "restore",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "task_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "run_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "submission_sequence",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "submitted_kind",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "submitted_principal_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "submitted_agent_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "summary",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "static_agents",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    1,
    "static_agents",
    "submitted_agent_id",
    "agent_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    0,
    "runs",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    1,
    "runs",
    "task_id",
    "task_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    2,
    "runs",
    "run_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "task_acceptances",
  "mode": "restore",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "task_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "result_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "run_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "task_version",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "reviewer_principal_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "reviewer_agent_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "reason",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "static_agents",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    1,
    "static_agents",
    "reviewer_agent_id",
    "agent_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    0,
    "task_results",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    1,
    "task_results",
    "task_id",
    "task_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    2,
    "task_results",
    "run_id",
    "run_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    3,
    "task_results",
    "result_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "task_history",
  "mode": "restore",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "event_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "task_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "task_version",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "run_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "kind",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "reason",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "runs",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    1,
    "runs",
    "task_id",
    "task_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    2,
    "runs",
    "run_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    0,
    "tasks",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    1,
    "tasks",
    "task_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    2,
    0,
    "events",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    2,
    1,
    "events",
    "event_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "artifacts",
  "mode": "restore",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "task_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "run_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "owner_kind",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "owner_principal_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "owner_agent_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "creator_credential_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "creator_runtime_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "authority_epoch",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "artifact_version",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "filename",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "media_type",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "byte_size",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "sha256",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "status",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "active_generation_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "committed_generation_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "committed_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "expires_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "admission_generation",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "expiry_check_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "artifact_generations",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    1,
    "artifact_generations",
    "id",
    "artifact_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    2,
    "artifact_generations",
    "committed_generation_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    0,
    "artifact_generations",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    1,
    "artifact_generations",
    "id",
    "artifact_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    2,
    "artifact_generations",
    "active_generation_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    2,
    0,
    "runtimes",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    2,
    1,
    "runtimes",
    "creator_runtime_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    3,
    0,
    "native_credentials",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    3,
    1,
    "native_credentials",
    "creator_credential_id",
    "credential_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    4,
    0,
    "static_agents",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    4,
    1,
    "static_agents",
    "owner_agent_id",
    "agent_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    5,
    0,
    "runs",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    5,
    1,
    "runs",
    "task_id",
    "task_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    5,
    2,
    "runs",
    "run_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    6,
    0,
    "tasks",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    6,
    1,
    "tasks",
    "task_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "artifact_generations",
  "mode": "paused-effects",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "artifact_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "object_key",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "expected_sha256",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "expected_byte_size",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "observed_sha256",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "observed_byte_size",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "state",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "admission_epoch",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "admission_generation",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "expires_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "updated_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "effect_operation_id",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "effect_kind",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "effect_state",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": "'none'",
    "pk": 0
   },
   {
    "name": "effect_started_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "effect_drained_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "artifact_version",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "upload_idempotency_sha256",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "cleanup_next_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "cleanup_error_code",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "delete_admission_epoch",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "delete_admission_generation",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "artifacts",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    1,
    "artifacts",
    "artifact_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "result_artifacts",
  "mode": "restore",
  "columns": [
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "result_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 2
   },
   {
    "name": "artifact_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 3
   },
   {
    "name": "ordinal",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "workspace_id",
   "result_id",
   "artifact_id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "artifacts",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    1,
    "artifacts",
    "artifact_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    0,
    "task_results",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    1,
    "task_results",
    "result_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "artifact_associations",
  "mode": "restore",
  "columns": [
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "artifact_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 2
   },
   {
    "name": "resource_kind",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 3
   },
   {
    "name": "resource_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 4
   }
  ],
  "primaryKey": [
   "workspace_id",
   "artifact_id",
   "resource_kind",
   "resource_id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "artifacts",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    1,
    "artifacts",
    "artifact_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "message_artifacts",
  "mode": "restore",
  "columns": [
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "message_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 2
   },
   {
    "name": "artifact_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 3
   },
   {
    "name": "ordinal",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "workspace_id",
   "message_id",
   "artifact_id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "artifacts",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    1,
    "artifacts",
    "artifact_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    0,
    "messages",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    1,
    "messages",
    "message_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "catalog_plans",
  "mode": "restore",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "actor_principal_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "profile_revision",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "expires_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "plan_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "touched_versions_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "status",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": []
 },
 {
  "name": "import_plans",
  "mode": "restore",
  "columns": [
   {
    "name": "id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "actor_principal_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "namespace",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "profile_revision",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "preview_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "source_rows_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "touched_versions_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "source_digest",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "report_json",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "status",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "expires_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": []
 },
 {
  "name": "import_mappings",
  "mode": "restore",
  "columns": [
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "namespace",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 2
   },
   {
    "name": "external_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 3
   },
   {
    "name": "task_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "source_sha256",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "mapping_version",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "source_version",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "import_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "provenance_json",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "created_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "updated_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "workspace_id",
   "namespace",
   "external_id"
  ],
  "foreignKeys": [
   [
    0,
    0,
    "tasks",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    0,
    1,
    "tasks",
    "task_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    0,
    "import_plans",
    "workspace_id",
    "workspace_id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ],
   [
    1,
    1,
    "import_plans",
    "import_id",
    "id",
    "NO ACTION",
    "NO ACTION",
    "NONE"
   ]
  ]
 },
 {
  "name": "artifact_inventory_state",
  "mode": "evidence",
  "columns": [
   {
    "name": "id",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 1
   },
   {
    "name": "workspace_id",
    "type": "TEXT",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "cursor",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "generation",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "0",
    "pk": 0
   },
   {
    "name": "next_due_at",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "last_scan_at",
    "type": "INTEGER",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   },
   {
    "name": "observed_objects",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "0",
    "pk": 0
   },
   {
    "name": "orphan_observations",
    "type": "INTEGER",
    "notNull": true,
    "defaultValue": "0",
    "pk": 0
   },
   {
    "name": "last_error_code",
    "type": "TEXT",
    "notNull": false,
    "defaultValue": null,
    "pk": 0
   }
  ],
  "primaryKey": [
   "id"
  ],
  "foreignKeys": []
 }
] as const satisfies readonly RegistryTable[];
export type RecoveryTableName=(typeof TABLE_REGISTRY)[number]['name'];
export const ENGINE_TABLES=['sqlite_sequence'] as const;
export function tableDefinition(name:string):RegistryTable {
 const table=TABLE_REGISTRY.find(x=>x.name===name);if(!table)throw Error('UNKNOWN_RECOVERY_TABLE');return table;
}
interface ColumnInfo {cid:number;name:string;type:string;notnull:number;dflt_value:string|null;pk:number;}
/** No prefix exclusion: an unexpected application OR engine table is a schema mismatch. */
export function inspectRegistry(tx:WorkspaceTransaction,schemaVersion:15|16=CURRENT_SCHEMA_VERSION):{schemaVersion:15|16;eventSequence:number;tables:number} {
 const actual=tx.all<{name:string}>("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").map(x=>x.name);
 const expected=[...TABLE_REGISTRY.map(x=>x.name),...ENGINE_TABLES].sort();
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('RECOVERY_SCHEMA_MISMATCH');
 for(const table of TABLE_REGISTRY){
  const columns=tx.all<ColumnInfo>('PRAGMA table_info("'+table.name+'")');
  if(columns.length!==table.columns.length||columns.some((c,i)=>{const e:RegistryColumn=table.columns[i];return c.cid!==i||c.name!==e.name||c.type!==e.type||Boolean(c.notnull)!==e.notNull||c.dflt_value!==e.defaultValue||c.pk!==e.pk;}))throw Error('RECOVERY_SCHEMA_MISMATCH');
  const foreign=tx.all<{id:number;seq:number;table:string;from:string;to:string;on_update:string;on_delete:string;match:string}>('PRAGMA foreign_key_list("'+table.name+'")').map(x=>[x.id,x.seq,x.table,x.from,x.to,x.on_update,x.on_delete,x.match]);
  if(JSON.stringify(foreign)!==JSON.stringify(table.foreignKeys))throw Error('RECOVERY_SCHEMA_MISMATCH');
 }
 const engine=tx.all<ColumnInfo>('PRAGMA table_info(sqlite_sequence)');
 if(engine.length!==2||engine.some((c,i)=>c.cid!==i||c.name!==['name','seq'][i]||c.type!==''||c.notnull!==0||c.pk!==0||c.dflt_value!==null))throw Error('RECOVERY_SCHEMA_MISMATCH');
 const versions=tx.all<{version:number}>('SELECT version FROM schema_migrations ORDER BY version').map(x=>x.version);
 if(JSON.stringify(versions)!==JSON.stringify(EXPECTED_SCHEMA_VERSIONS.slice(0,schemaVersion)))throw Error('RECOVERY_SCHEMA_MISMATCH');
 const sequences=tx.all<{name:string;seq:number}>('SELECT name,seq FROM sqlite_sequence');
 if(sequences.length>1||sequences.some(x=>x.name!=='events'||!Number.isSafeInteger(x.seq)||x.seq<0))throw Error('RECOVERY_EVENT_SEQUENCE');
 const eventSequence=sequences[0]?.seq??0;
 const retained=tx.one<{n:number}>('SELECT COALESCE(MAX(sequence),0) AS n FROM events')!.n;
 const floor=tx.one<{n:number|null}>('SELECT event_retained_after_sequence AS n FROM workspace_metadata WHERE id=1')?.n??0;
 if(!Number.isSafeInteger(retained)||!Number.isSafeInteger(floor)||floor<0||eventSequence<retained||eventSequence<floor)throw Error('RECOVERY_EVENT_SEQUENCE');
 return {schemaVersion,eventSequence,tables:expected.length};
}
