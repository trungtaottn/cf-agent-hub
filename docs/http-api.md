# Native HTTP API

Status: Design baseline · Contract revision 0.1 · Implementation pending.

The planned native API is the shared command surface for the web application, external runtimes, CLI and protocol adapters. It coordinates durable work; it does not execute agent code. This reference and [OpenAPI](../spec/openapi.json) own route names and request/response fields. They describe proposed contracts dated 2026-10-23, not a deployed service. The versioned path is `/v2/workspaces/{workspace_id}`; the API path version and documentation contract revision are separate identifiers.

## Authentication and authorization

Every operation must resolve the route workspace through the operator-provisioned catalog, authenticate the caller, then verify current membership or native grant inside that workspace's domain transaction. An agent ID, work role, framework, display name or URL parameter grants no authority. Resources referenced in the request must belong to the same workspace and be visible within the caller's project and resource scope. Inaccessible identifiers return a generic not-found response without revealing another workspace's existence.

There are two explicit credential lanes:

| Lane | Principal and authority | Restrictions |
| --- | --- | --- |
| Human session | Verified Access/OIDC issuer and subject, resolved to current membership and policy | Proposed `cfhub_session` cookie; writes require same-origin checks and `X-CSRF-Token`; no client-supplied human identity |
| Native bearer | Opaque workspace-scoped credential bound to an agent, with explicit scopes and optional project restrictions | Verification hash retained server-side; expiry/revocation checked per command; cannot call human-only endpoints |

An endpoint listing both lanes permits either credential type, subject to all policy checks. The OpenAPI security alternatives are not a global bearer requirement. Its `x-required-scopes` and `x-actor-kind` extensions record constraints that an OpenAPI security scheme alone cannot express. `approvals:decide`, credential management and agent administration require a human session even if an agent's token contains an incorrectly configured scope. An independent native reviewer may accept a result with `tasks:review`, but neither the submitting principal nor the submitting agent may accept it through another token or runtime.

For runtime-bound commands, the authenticated native identity must match the run's agent and registered runtime binding; knowing a run ID or fence is insufficient. Runtime enrollment returns a one-time `runtime_token`, stored server-side only as a verification hash bound to workspace, agent, runtime and issuing native credential. Claim, run commands, runtime heartbeat and native artifact writes require both `Authorization: Bearer ...` and `X-Runtime-Token`; the proof must match the stored run/runtime. The OpenAPI security requirement combines `NativeBearer` and `RuntimeProof` in one AND object. Proof expires with its credential or runtime and is invalid after revocation; credential rotation requires fresh enrollment. Enrollment replay returns `runtime_token: null` and `revealed: false`; a lost proof requires new enrollment. Runtime registration does not start a process. See [agents](agents.md) and [security model](security-model.md).

## Canonical endpoint table

Paths below are relative to `/v2/workspaces/{workspace_id}`. `/` denotes that base resource without a trailing slash. All entries are planned. Task/agent/artifact routes are staged by the [roadmap](roadmap.md); their presence here does not make them available in an earlier release gate.

| Method and relative path | Required scope | Actor lane |
| --- | --- | --- |
| `GET /` | `workspace:read` | Human or native agent |
| `GET /tasks` | `tasks:read` | Human or native agent |
| `POST /tasks` | `tasks:create` | Human or native agent |
| `GET /tasks/{task_id}` | `tasks:read` | Human or native agent |
| `PATCH /tasks/{task_id}` | `tasks:edit` | Human or native agent |
| `POST /tasks/{task_id}:ready` | `tasks:schedule` | Human or native agent |
| `POST /tasks/{task_id}:claim` | `tasks:claim` | Native agent only |
| `POST /tasks/{task_id}:request-decision` | `tasks:execute` | Native agent only |
| `POST /tasks/{task_id}:submit-result` | `tasks:execute` | Native agent only |
| `POST /tasks/{task_id}:accept-result` | `tasks:review` | Human or native agent |
| `POST /tasks/{task_id}:fail` | `tasks:execute` | Native agent only |
| `POST /tasks/{task_id}:cancel` | `tasks:cancel` | Human or native agent |
| `POST /tasks/{task_id}:requeue` | `tasks:schedule` | Human or native agent |
| `GET /runs/{run_id}` | `tasks:read` | Human or native agent |
| `POST /runs/{run_id}:heartbeat` | `tasks:execute` | Native agent only |
| `GET /approvals` | `approvals:read` | Human or native agent |
| `GET /approvals/{approval_id}` | `approvals:read` | Human or native agent |
| `POST /approvals/{approval_id}:approve` | `approvals:decide` | Human session only |
| `POST /approvals/{approval_id}:reject` | `approvals:decide` | Human session only |
| `GET /agents` | `agents:read` | Human or native agent |
| `POST /agents` | `agents:manage` | Human session only |
| `GET /agents/{agent_id}` | `agents:read` | Human or native agent |
| `PATCH /agents/{agent_id}` | `agents:manage` | Human session only |
| `POST /agents/{agent_id}:archive` | `agents:manage` | Human session only |
| `POST /runtimes` | `runtimes:manage` | Native agent only |
| `POST /runtimes/{runtime_instance_id}:heartbeat` | `runtimes:manage` | Native agent only |
| `POST /messages` | `messages:send` | Human or native agent |
| `GET /inbox` | `messages:read` | Native agent only |
| `GET /threads/{thread_id}` | `messages:read` | Human or native agent |
| `POST /messages:ack` | `messages:ack` | Native agent only |
| `GET /artifacts` | `artifacts:read` | Human or native agent |
| `POST /artifacts` | `artifacts:write` | Human or native agent |
| `GET /artifacts/{artifact_id}` | `artifacts:read` | Human or native agent |
| `PUT /artifacts/{artifact_id}/content` | `artifacts:write` | Human or native agent |
| `POST /artifacts/{artifact_id}:commit` | `artifacts:write` | Human or native agent |
| `GET /artifacts/{artifact_id}/content` | `artifacts:read` | Human or native agent |
| `GET /events` | `events:read` | Human or native agent |
| `GET /credentials` | `credentials:manage` | Human session only |
| `POST /credentials` | `credentials:manage` | Human session only |
| `POST /credentials/{credential_id}:revoke` | `credentials:manage` | Human session only |
| `GET /search` | `search:read` | Human or native agent |

A scope is necessary, not sufficient. Message reads also require fixed-thread sender/recipient access or a human with additional `messages:review`; artifact reads require their resource/project scope. Search requires `search:read` plus each underlying resource read scope. Native grants cannot delegate human-only powers. Credential `project_ids: null` means workspace-wide project access bounded by current policy; `project_ids: []` grants no project-scoped access and is never a wildcard. A null task project remains subject to workspace-level permission checks. The native contract deliberately has no catch-all state mutation, arbitrary execution, global workspace enumeration, or team/settings administration route. Team and configuration management require later separately reviewed contracts; their domain design does not imply an endpoint exists.

## Envelope and error contract

JSON requests use `Content-Type: application/json`. Unknown properties are rejected. A single success is `{ "data": ..., "request_id": "..." }`. Lists add `"page": { "next_cursor": null, "has_more": false }` alongside the `data` array. Task transitions return `data.task`, `data.run` and `data.approval`; the last two are nullable. Artifact content is the explicit binary exception: PUT sends raw bytes; GET returns bytes with safe download headers. No artifact bytes belong in a JSON envelope.

The server creates request IDs and UTC timestamps. Request IDs identify processing attempts; resource IDs identify durable entities. Error responses have one stable shape:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "The task changed; read its current version before retrying.",
    "retryable": false,
    "request_id": "req_example_conflict",
    "details": { "current_version": 3 }
  }
}
```

| HTTP status | Typical code | Client action |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Correct schema or unknown fields; do not blindly retry |
| 401 | `UNAUTHENTICATED` | Restore valid authentication; never put secrets in logs |
| 403 / 404 | `FORBIDDEN` / `NOT_FOUND` | Check actor/grant or visible resource identity |
| 409 | `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INVALID_STATE`, `STALE_RUN` | Read current state and decide whether a new command remains appropriate |
| 410 | `CURSOR_EXPIRED`, `APPROVAL_EXPIRED` | Restart a read traversal or resolve expired decision explicitly |
| 413 | `LIMIT_EXCEEDED` | Reduce payload, references or attachments |
| 429 | `RATE_LIMITED` | Honor bounded `Retry-After`; preserve mutation identity |
| 503 | `DEPENDENCY_UNAVAILABLE` | Reconcile ambiguous mutations, then retry with the same key |

`retryable` means the same request may succeed later without changing intent; it is never authorization to repeat an irreversible action in another system. Response details are allowlisted and must not contain credential values, hidden message bodies or stack traces. An unexpected internal failure uses `INTERNAL_ERROR` with a generic message and operator-correlatable request ID.

## Idempotency and concurrent writes

Every mutation, including heartbeats, ACK and upload, requires `Idempotency-Key`. The key is scoped to workspace, authenticated principal and operation including target resource. The request fingerprint includes canonical method/path, semantic query parameters and canonical JSON body; JSON key order is irrelevant, array order remains significant, omitted fields differ from explicit null. Uploads use the verified byte digest and manifest identity. Reusing a key with different intent returns 409. A new command or heartbeat uses a new key; a retry preserves the original key and body.

The command must commit state, event, outbox entries and the replayable outcome in the same local SQL transaction. Replays recheck current authentication and resource visibility, then return the original committed outcome rather than executing the command against today's state. Revocation therefore cannot be bypassed by replay. Current state may have advanced: read again when planning subsequent work. Pre-validation failures create no successful command outcome. Retention is specified in [limits](limits.md).

Credential issuance and runtime enrollment are deliberate secret-handling exceptions. For credential issuance: its initial response contains `token` and `revealed: true`; replay returns the same credential metadata with `token: null` and `revealed: false`. The bearer value is not recoverable. If the initial response is lost, inspect credential metadata, create a replacement and revoke the uncertain credential. Rotation first drains or reconciles the old runtime's work, creates a replacement credential, securely enrolls a fresh runtime, verifies access and ends the old execution authority before a new claim. Then revoke the predecessor credential. Never transfer an active run by changing its credential in place; there is no implicit rotation endpoint.

The claim transaction also persists the trusted workspace retry-safety classification for the attempt and its audit record. Lease expiry defaults to Backlog plus `outcome_unknown`; bounded automatic retry on expiry requires a preexisting replay-safe policy decision. A stale runtime can only read/escalate, not report a state change through its old fence. Task mutations require `expected_version` equal to `task_version`. Claim additionally binds a live runtime; execution commands require `run_id` and current `fence`. A heartbeat checks `expected_run_version` and changes only `run_version` and its lease. Approval decisions check task, proposal and approval versions together. Other mutable entities use their explicit `expected_agent_version`, `expected_runtime_version`, `expected_artifact_version` or `expected_credential_version`. Server time decides expiry even if background cleanup has not run.

PATCH accepts only title, description, project, work role and assignment fields, with an expected version and at least one changed field. This baseline permits those changes only in Backlog or Ready, and rejects them while a current approved decision is attached. Changing approved intent requires cancellation and revised work. Unknown-outcome and exhausted-retry holds block Ready, Requeue and Claim; an unknown execution outcome always returns Backlog for reconciliation, regardless of remaining retry budget. Result submission releases the lease and enters Review; independent acceptance enters Done. Decisions freeze action, scope and an exact `inputs` reference containing the ID and SHA-256 of a committed immutable `application/json` artifact. The approver must be able to inspect those parameters; display summaries alone cannot authorize. The next run rechecks the digest, proposal scope and current policy. Decisions release the old run and require a fresh claim after approval. ACK changes none of these states. [Task lifecycle](task-lifecycle.md) owns the full transition guards and bounded retries.

## Pagination, history and search

All collection reads are bounded; defaults and ceilings live in [limits](limits.md). Send `cursor` unchanged while `has_more` is true; `next_cursor` must be non-null in that case. A final page has `has_more: false` and `next_cursor: null`. Empty pages are possible after authorization filtering; clients still follow a valid continuation cursor.

Lists use ascending immutable creation time plus ID, events use ascending sequence. The first page establishes a high-water boundary so later inserts do not shift that traversal. Cursors bind workspace, caller, filters, sort and boundary; changing any requires a fresh traversal. They are opaque and tamper-resistant. Current authorization is checked on every page. This is not a historical database snapshot: edits may appear in current form, while revoked or deleted objects may disappear. Retention-invalidated cursors return `CURSOR_EXPIRED` rather than silently skipping history.

Inbox reads are recipient-specific and default to unacknowledged items. ACK during a traversal can remove an item from later pages; process observed IDs durably before acknowledging. Thread participants are fixed at creation from sender and initial recipients. Replies may address a subset but cannot add participants; use a new thread instead. Thread pagination exposes all retained authorized history, including older messages beyond the first window. Search performs bounded literal text matching over task text, message bodies and artifact metadata, filtering authorization before returning snippets. It has no implied semantic ranking, file-content indexing or external connector search. New records after a traversal boundary require a new search.

## Contract fixtures and acceptance

[HTTP fixtures](../examples/http/fixture-map.json) map each JSON body to an operation and OpenAPI schema. They illustrate claim, decision, result, ACK, upload staging and errors; they do not prove runtime behavior. Implementations must validate fixtures and rejection cases, race concurrent claims and reviews, prove replay after a lost response, deny cross-workspace references, enforce actor lanes and check multi-page traversal. Exercise byte limits with multi-byte text and interrupted artifact uploads. A schema-valid request can still fail authorization, state or provenance checks.
