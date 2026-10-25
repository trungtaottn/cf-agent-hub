# Data model

Status: Design baseline · Contract revision 0.1 · Implementation pending.

This page defines conceptual ownership and invariants. It is not an executed SQL migration. JSON field spelling and request schemas are defined in [HTTP API](http-api.md) and [OpenAPI](../spec/openapi.json). Database table/index design must preserve these invariants while being verified against the chosen runtime.

## Entity ownership

| Entity | Stable identity and ownership | Important relationships and invariant |
| --- | --- | --- |
| Workspace | Operator-provisioned workspace ID | Maps to one Durable Object; profile edits cannot reroute it |
| Human principal | Verified `(issuer, subject)` | Display name/email are attributes, not identity keys |
| Membership | Workspace + principal | Role and grant ceiling; revocation checked on each command |
| Agent | Workspace + agent ID | Capability declarations and lifecycle; not a model name or credential |
| Runtime instance | Workspace + runtime ID | One registered agent binding, credential-bound runtime-proof hash and freshness state |
| Credential/grant | Workspace + credential ID | Opaque native token verification hash, bound agent, scopes, expiry/revocation; raw token is not stored |
| Project | Workspace + project ID | Stable profile entry; archive rather than silently deleting referenced work |
| Work role | Workspace + role ID | Work classification/eligibility hints; never an authorization role |
| Task | Workspace + task ID | Intent, state, versions, assignment, run/result pointers and retry budget |
| Run | Workspace + run ID | One task execution attempt, agent/runtime binding, lease and fence |
| Approval | Workspace + approval ID | Specific task proposal/version, human decision and expiry |
| Message/thread | Workspace + message/thread ID | Immutable actor attribution, references, recipients and delivery tracking |
| Artifact | Workspace + artifact ID | Metadata lifecycle and server-owned R2 object key |
| Event | Workspace + event ID | Append-only actor/action/resource/version evidence |
| Outbox item | Workspace + delivery ID | Destination, attempt count, due time and delivery disposition |
| Idempotency outcome | Workspace + principal + operation + key | Request fingerprint and committed response outcome |

IDs in examples are synthetic. Clients must treat IDs as opaque and use the IDs returned by the server. An ID that belongs to another workspace must never resolve through a global fallback lookup.

## Task and run records

The proposed task representation contains `id`, `workspace_id`, `title`, `description`, `state`, `task_version`, `proposal_version`, nullable `project_id`, `work_role_id`, `assigned_agent_id`, `active_run_id`, `latest_run_id`, `approval_id`, nullable `result`, `retry_count`, `retry_limit`, `flags`, `created_at` and `updated_at`.

`active_run_id` is non-null only when the task is Doing and the referenced run remains active. `latest_run_id` preserves the last attempt even after authority is released. A current result belongs to one submitted run and records its submitting principal and agent, allowing independent acceptance checks even after credential rotation. Historical results and decisions remain auditable when a task is requeued.

The run contains `id`, `workspace_id`, `task_id`, `agent_id`, `runtime_instance_id`, `status`, `run_version`, `fence`, `lease_expires_at`, `started_at` and nullable `ended_at`. Fences increase monotonically per task; they are not timestamps and clients cannot choose them. A unique active-run constraint plus transaction guards enforces one active owner. Internal run/audit evidence also retains the trusted retry-safety policy decision applicable at claim; expiry defaults to uncertainty when no preexisting replay-safe classification exists. A run's nonactive status is terminal for that attempt.

`task_version` advances for committed task-domain mutations. `proposal_version` advances when issuing a new decision proposal. `run_version` advances for run changes including heartbeat. A renewal must not modify task/proposal versions. Use integer versions for compare-and-swap; timestamps alone cannot detect competing edits reliably. The exact transition increments are part of the [lifecycle contract](task-lifecycle.md).

## Identity and attribution

Authorization roles, work roles and runtime capability labels have separate fields and separate validation. An agent's display name cannot turn it into a human or administrator. A human-to-agent action records both the authenticated principal and the target agent without pretending the agent initiated it.

Each event records the request correlation ID, workspace, actor kind and stable actor identity, action, affected resource, resulting versions and server timestamp. Events should reference sensitive payloads rather than duplicating secrets or entire uploaded files. Redaction and retention must preserve enough context to explain decisions while following workspace policy.

## Approvals and result history

An approval references one current proposal with task/proposal versions, scope, inputs, checkpoint, expiry and the eventual human decision. The implementation must preserve the original proposal alongside the decision. A new proposal cannot overwrite a past approved or rejected record. Approval state and task state change in one transaction; an event cannot claim approval while the task still awaits a different proposal.

A result contains a bounded summary and references to committed artifacts. Result submission is not acceptance. Independent review checks the stable submitting principal and agent, not just the token used in the last HTTP request. Archived agents and revoked credentials must remain referentially resolvable for historical attribution.

## Delivery and artifacts

A message's acceptance, destination transport result, recipient ACK and any referenced task state are distinct records. Delivery attempts reference an immutable payload version or a canonical stored envelope, so a retry cannot silently deliver a different command under the same identity. ACK records are idempotent per recipient and message.

Artifact metadata tracks staging, expected digest/size, upload state, committed digest/size, creator, associations and the upload intent expiry. An expired intent is a durable cleanup tombstone; a committed artifact has no active upload deadline. Only server-generated object keys are persisted. Cleanup must first atomically mark an expired uncommitted intent as unavailable for upload/commit before deleting bytes. A late in-flight upload is reconciled as an orphan. Checking for a reference and then deleting without a durable exclusion can race a valid commit and is forbidden. Artifact access derives from workspace grants and association rules; R2 object existence alone is not access. Orphan detection compares metadata with bounded object inventories and restore manifests. Retention must not remove an artifact still required by a retained accepted result without an explicit retention event.

## Index and migration requirements

Expected indexes include scoped task state/order, agent active runs, due leases, pending approvals by expiry, outbox due time/status, thread order, event order and idempotency expiry. Uniqueness includes scoped entity IDs, idempotency keys and applicable active-run constraints. Query plans and per-workspace storage growth must be measured before release.

Restoration must not reuse authority issued after a recovered snapshot. Maintain an enforced recovery epoch or advance fences beyond all previously issued values, and overlay current revocations before reopening admission. Restored active runs cannot simply resume.

Application schema versions are distinct from Cloudflare class lifecycle configuration. Migrations must be versioned, restart-safe and rehearsed on representative snapshots. Destructive changes require an export and verified restoration path; rolling code back does not automatically roll data back. Import uses explicit external IDs and provenance mappings with dry-run reconciliation, never reusing an external owner/run/approval as trusted active authority. See [development](development.md) and [backup and restore](backup-restore.md).

## R1 atomic message admission

R1 admission uses forward application migration 4 after the preference-owner migration 3. Fixed membership is `(thread_id, participant_kind, participant_id)`, with kind exactly `human` or `agent` and a composite primary key. Human IDs are principal IDs; agent IDs are agent IDs. Membership joins the owning thread for workspace isolation. Initial membership is the sender plus unique addressed agents; a reply cannot add members. The closed request has no subject, so a new thread stores empty subject text. An authorized reviewer can read under current policy but cannot send into a thread without membership.

A recipient requires its current installed static identity and one coherent enabled, unexpired, nonretired same-epoch credential with `messages:read` and applicable resource access. Credential scopes and project restrictions are never combined. R1 messages have no project association, so a project-restricted read grant cannot authorize their workspace-wide content. Fixed human participants use their enabled current installed grant without inventing a session. The real caller keeps its own verified credential/session and current authorization; another credential cannot broaden its proof. Every message reference is checked for the actual caller and every fixed participant, including participants omitted from the reply. Task/artifact references remain unavailable in R1.

The command wrapper's existing synchronous outer transaction owns thread/participants, immutable message, one inbox row per addressed recipient, the sole accepted event, notification intent, scheduler marker and durable outcome. The internal fourth execute argument is the wrapper's reserved accepted event ID. Notification event ID and acceptance time match that event exactly. Failure at any insertion rolls back all families. IDs and retry jitter are reserved from owned entropy before SQL. A valid replay reauthorizes and returns its original outcome without executing again. Accepted DTOs have null ACK; later recipient projections expose only that recipient's ACK.

Each new outbox row stores immutable canonical `MessageNotification` JSON and canonical protected `destination_snapshot_json` with exactly `{agent_id,url,signing_key_ref}`. URL is the validated HTTPS URL's canonical serialization; snapshots contain references, never key values. `deliveryId` maps to both `id` and `notification_id`; payload `delivery_id` is identical. Descriptor `attemptCount:0` maps to `attempts=0`, `nextDueAt` to `next_due_at`, status is `pending`, lease/disposition fields are null, and `created_at`/`updated_at` equal acceptance time. Jitter is persisted in `[0.8,1.0]`. There is one intent per enabled destination of an addressed agent, independent of credential count or other thread members.

Migration 4 preserves old outbox bytes, identities, destinations, status and attempt counts and adds `suppressed`. Legacy routing snapshots remain SQL NULL when their original route cannot be proved. Such rows are non-executable history; current catalog values must not be used to manufacture a snapshot. Scheduler state adds `dirty` (0 or 1, default 0) and a nonnegative integer `generation` (default 0). Each inserted intent sets dirty and advances generation in the acceptance transaction. Tasks 8/9 use the shared transaction-only marker for scheduling-relevant changes. Task 9 owns claiming, alarms and delivery; Task 11 validates typed identities, notification version/linkage and routing snapshot relationships before any recovery dispatch and recomputes scheduling under maintenance authority. Preserving legacy history does not activate delivery.
