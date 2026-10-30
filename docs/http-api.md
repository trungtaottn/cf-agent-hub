# Native HTTP API

Status: Mixed implemented source and proposed contracts · Contract revision 0.1 · Live acceptance pending.

The planned native API is the shared command surface for the web application, external runtimes, CLI and protocol adapters. It coordinates durable work; it does not execute agent code. This reference and [OpenAPI](../spec/openapi.json) own route names and request/response fields. They describe proposed contracts dated 2026-10-23, not a deployed service. The versioned path is `/v2/workspaces/{workspace_id}`; the API path version and documentation contract revision are separate identifiers.

## Authentication and authorization

Except the bounded authentication protocol and public liveness operations described below, every operation must resolve the route workspace through the operator-provisioned catalog, authenticate the caller, then verify current membership or native grant inside that workspace's domain transaction. An agent ID, work role, framework, display name or URL parameter grants no authority. Resources referenced in the request must belong to the same workspace and be visible within the caller's project and resource scope. Inaccessible identifiers return a generic not-found response without revealing another workspace's existence.

There are two explicit credential lanes:

| Lane | Principal and authority | Restrictions |
| --- | --- | --- |
| Human session | Verified Access/OIDC issuer and subject, resolved to current membership and policy | Proposed `cfhub_session` cookie; writes require same-origin checks and `X-CSRF-Token`; no client-supplied human identity |
| Native bearer | Opaque workspace-scoped credential bound to an agent, with explicit scopes and optional project restrictions | Verification hash retained server-side; expiry/revocation checked per command; cannot call human-only endpoints |

An endpoint listing both lanes permits either credential type, subject to all policy checks. The OpenAPI security alternatives are not a global bearer requirement. Its `x-required-scopes` and `x-actor-kind` extensions record constraints that an OpenAPI security scheme alone cannot express. `approvals:decide`, credential management and agent administration require a human session even if an agent's token contains an incorrectly configured scope. An independent native reviewer may accept a result with `tasks:review`, but neither the submitting principal nor the submitting agent may accept it through another token or runtime.

For runtime-bound commands, the authenticated native identity must match the run's agent and registered runtime binding; knowing a run ID or fence is insufficient. Runtime enrollment returns a one-time `runtime_token`, stored server-side only as a verification hash bound to workspace, agent, runtime and issuing native credential. Claim, run commands, runtime heartbeat and native artifact writes require both `Authorization: Bearer ...` and `X-Runtime-Token`; the proof must match the stored run/runtime. The OpenAPI security requirement combines `NativeBearer` and `RuntimeProof` in one AND object. Proof expires with its credential or runtime and is invalid after revocation; credential rotation requires fresh enrollment. Enrollment replay returns `runtime_token: null` and `revealed: false`; a lost proof requires new enrollment. Runtime registration does not start a process. See [agents](agents.md) and [security model](security-model.md).

## Local issue25 identity/credential subset

Issue25 local source enables `listAgents`, `getAgent`, `createAgent`, `patchAgent`, `archiveAgent`, `listCredentials`, `createCredential` and `revokeCredential`. Issue26 additionally implements `createRuntime` and `heartbeatRuntime`; task, artifact, import, search and approval routes remain unavailable. There is no credential GET-by-ID, token recovery, unarchive or automatic rotation route. See [execution evidence](r2-task-plans/issue-025-execution.md), not this route inventory, for the actual checks and pending acceptance.

Agent and credential management writes require the canonical closed request body, `Idempotency-Key`, current human session, exact allowed origin and CSRF. Agent management requires `agents:manage` and workspace-wide project authority; agent GET/list allows either lane with `agents:read` and `project_ids: null`. Work roles are metadata, never authority. PATCH/archive use `expected_agent_version`; revoke uses `expected_credential_version`. Archive rejects active runs or any nonterminal assigned task with `INVALID_STATE`; reassign/reconcile first rather than treating archival as task cancellation.

Credential management requires `credentials:manage`. Complete requested scopes must fit the operator-configured exact `delegable_native_scopes` ceiling when present, or the legacy native-compatible human-scope intersection when omitted; projects must fit both configured and current human ceilings. Human executable scopes are not expanded by delegation; active named projects and active agent are required. Expiry is future and at most 90 days. A static agent additionally needs one current live static credential covering the complete grant and expiry; no union of grants is allowed. Static provenance remains immutable. Credential listing/revoke exposes only complete grants within the caller's current ceiling, without hashes or bearer values. `null` and `[]` project grants are never interchangeable.

Initial successful `createCredential` returns the bearer once. Same-key/same-body replay returns the original sanitized metadata with `token: null`, `revealed: false`; a changed payload conflicts. Lost-token recovery means an explicit new issuance key followed by revoking the uncertain credential, not reusing a key to obtain another reveal. Replays reauthorize both the current resource and original response visibility. Archived identities remain readable for authorized historical attribution; revoked/archive/epoch authority cannot authenticate merely because a previous command succeeded.

Agent/credential lists accept only `cursor` and `limit` (default 50, range 1–200). They seek by creation time/ID, use a fixed initial high-water bound, and return `{data, page, request_id}`. Only fully visible credentials establish continuation. Encrypted cursors bind operation, workspace, caller lane/session or credential, authority epoch, maintenance generation, limit and ordering; they expire absolutely after one hour and are limited to 2,048 characters. Identity reads do not reuse message-retention floors. Responses are no-store, bounded to 1 MiB, and recheck current authority after cursor crypto; a changed page during preparation fails as a whole rather than disclosing stale metadata.

## Canonical endpoint table

Paths below are relative to `/v2/workspaces/{workspace_id}`. `/` denotes that base resource without a trailing slash. The table is the canonical contract inventory, not a deployment availability claim. R1 source routes and the local issue25 identity/credential subset described below are implemented; other R2/R3 routes remain staged by the [roadmap](roadmap.md). Presence here does not make a route available in an earlier release gate.

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

## R1 foundation amendment

The R1 amendment is `r1-foundation-1` on the existing `/v2` path. The portable profile and preference contracts remain revision 0.1; deployment configuration alone advances to 0.2. OpenAPI marks unavailable later-release routes with `x-r1-available: false`; they return a generic 404. No public writable deployment/policy route or delivery-replay URL exists. `GET /health/live` is the sole unscoped public route and returns only `{"status":"alive"}`.

| Relative route | Lane | Required scope | Result |
| --- | --- | --- | --- |
| `POST /auth/start` | Same-origin protocol | None | One-use OIDC transaction and authorization URL |
| `GET /auth/callback` | OIDC protocol | None | Verified code exchange and redirect |
| `GET /auth/session` | Human session | None | Actor, in-memory CSRF token, expiry; no-store |
| `POST /auth/logout` | Human session | None | Revoke session, expire cookie; Origin and CSRF required |
| `GET /configuration` | Human or native | `workspace:read` | Redacted capabilities, epochs and revisions |
| `GET /profile` | Human or native | `workspace:read` | Portable profile and revision |
| `POST /profile:preview` | Human | `profile:edit` | Advisory merged profile, changes and conflicts |
| `PUT /profile` | Human | `profile:edit` | Atomic stable-ID upsert and new revision |
| `GET /profile:export` | Human | `profile:edit` | Portable presentation, projects and work roles only |
| `GET /preferences`, `PUT /preferences` | Human | `workspace:read` | Caller-owned preferences/effective values; write uses expected revision |
| `GET /operations`, `GET /readiness` | Human | `operations:read` | Redacted diagnostic snapshots |

The two authenticated auth protocol routes require a live verified workspace-bound human session, enabled grant and current authentication epoch, but no domain scope. A `profile:edit`-only member can obtain CSRF/session metadata; no `workspace:read` is implied. The three unauthenticated protocol/public operations are exactly start, callback and liveness. `POST /auth/start` admits an allowlisted relative UI return path only from the same origin; the callback is a narrow, one-use exception to nonmutating GET. State, transient HttpOnly cookie, nonce and PKCE S256 bind the five-minute login attempt. Server-side code exchange verifies the ID token and already installed grant before rotating the opaque session. Provider failure clears the transient cookie without exposing a token. No arbitrary Access header supplies this flow.

The session cookie is `cfhub_session`: Secure, HttpOnly, SameSite=Lax, host-only, Path `/`. It binds workspace and principal and expires no later than the verified ID token or configured session TTL; R1 has no silent refresh. A session from another workspace, a revoked grant, a stale epoch or duplicate credential lanes is denied. Ordinary human writes require exact Origin, `X-CSRF-Token` and `Idempotency-Key`. Start/callback use one-use protocol identity; they do not use ordinary domain mutation idempotency.

Configuration reveals `config_epoch`, profile/preference revisions, allowed preference overrides and enabled features only. Native callers receive `preferences_revision:null`. Grants, identity registry, destinations and secrets are excluded. Preferences target only the caller; stale settings writes return 409 with the current revision. Profile preview is a noncommitting POST with a required key for correlation, not a persisted outcome. Its closed `changes` and `conflicts` each contain at most 200 JSON Pointer entries; the complete response envelope is bounded to 65,536 UTF-8 bytes. Overflow fails explicitly without truncation. Apply rechecks the expected revision and has ordinary durable idempotency. Neither referenced project/role archive nor remap is available in R1.

R1 messages keep the existing DTO. A nonrecipient sees `acknowledgment:null` on accepted/view data; a recipient read shows only that recipient actor's ACK. Nonempty `artifact_ids` and task/artifact references fail before mutation with 400 `INVALID_REQUEST` and `details.feature` set to `artifacts` or `tasks`. Message references must be accessible to every fixed-thread participant. R1 inbox is native-only. Human thread discovery uses authorized `message.accepted` events with a persisted `thread_id`, then `GET /threads/{thread_id}`; no message-ID decoding or new discovery route is implied.

Event `request_id` correlates the original command; a delivery-origin event receives a processing request ID linked internally to the delivery ID. Configuration, profile and preference events have typed resource/version and null task/run/fence/thread fields. Configuration install requires `events:read` plus human `operations:read`; profile requires `events:read` plus `workspace:read`; owner-only preferences require those scopes and principal equality. Message events require `events:read`, `messages:read` and fixed-thread access, or human `messages:review`. Projections join current message access; hidden/deleted links, IDs, counts and summaries are filtered. The event cursor/high-water rules still bound discovery. See [ADR 0007](adr/0007-r1-ingress-and-settings.md).

### R1 personal preference response semantics

Absent GET preferences returns revision 0 and neutral defaults without creating persistent state. First PUT uses `expected_preferences_revision:0` and commits revision 1. The complete portable `UserPreferences` contract revision `0.1` and `/v2` route remain unchanged. `PreferencesData` and `PreferencesDataResponse` add the required response-only `default_view_fallback_reason`: `null | VIEW_UNAVAILABLE | PREFERENCE_NOT_ALLOWED`. Sending that field in the write document is invalid. See [first-use response](../examples/http/r1-preferences-absent.response.json), [first write](../examples/http/r1-preferences-first.request.json), and [committed result](../examples/http/r1-preferences-first.response.json).

Full-document writes permit unchanged disallowed values to carry through, but any changed disallowed field returns 403 with its canonical field pointer and rolls back the entire command. Stored values remain separate from effective values, which follow current policy and available authorized views. Native GET configuration returns preferences_revision:null, an empty allowed_user_overrides list and no preferences capability; native preferences routes are forbidden. GET export requires profile:edit and no CSRF. Preview and PUT require the human same-origin CSRF protocol and Idempotency-Key. Unknown settings query parameters are rejected. Settings CORS preflights admit only the installed origin, the selected route's methods and the documented authentication/content headers.

## R2 policy, catalog and authority contract amendment — 2026-10-26

The [configuration amendment](configuration.md#r2-contract-amendment--2026-10-26), [catalog amendment](customization.md#r2-catalog-contract-amendment--2026-10-26) and [ADR 0008](adr/0008-r2-authority-and-history.md) specify proposed R2 behavior only. Scope recognition in schemas does not enable a handler or grant installed authority. Contract revision `0.1` and `/v2` remain unchanged; R3 approvals remain unavailable.

Catalog preview/apply use their distinct `previewCatalogChange` / `applyCatalogChange` operation IDs and current human `profile:edit`, same-origin CSRF and Idempotency-Key. Task remaps additionally require `tasks:edit`; agent-role changes require human `agents:manage`. Preview captures touched versions and expires after 15 minutes; apply revalidates them atomically and returns `ProfileView`. Neither endpoint replaces advisory `/profile:preview` or complete-candidate PUT `/profile`. Issue28 supplies local catalog handlers; live acceptance and publication are not implied.

### Selected R2 historical-result read

GET `/v2/workspaces/{workspace_id}/tasks/{task_id}/results`, operationId `listTaskResults`, is a proposed R2 route (`x-contract-status: specified`, `x-r1-available: false`), not an implemented R1 endpoint. Its closed response is `{data:TaskResult[],page:Page,request_id}` with unchanged canonical result/page shapes. Current human session or native bearer requires `tasks:read`, workspace admission and task/project access; each returned result requires all referenced artifacts to remain committed, correctly associated and readable under current artifact scope/project permissions. Inaccessible references hide the entire result. Task access loss rejects the request.

Use default limit 50, integer 1–200; fixed initial submission-sequence ceiling; ascending authorized-result keyset; last-returned-authorized cursor; authorized lookahead only. A hidden-only suffix produces terminal false/null, not an empty continuation. The newly selected total JSON ceiling is 1 MiB; byte-limited pages continue before the next unreturned authorized result. See [ADR 0008](adr/0008-r2-authority-and-history.md) for complete cursor, privacy, envelope-fit and bounded-physical-work activation requirements. No total or hidden scanned position is returned. Current authorization is rechecked; visibility newly gained behind the cursor requires a fresh traversal.

No CSRF, Idempotency-Key or body is required for this read. Success and sanitized errors use no-store. Reuse 400/401/403/404/410/429/503 responses and sanitized 500; invalid binding is 400, recognized expiry/obsolescence is 410. Supported work-budget exhaustion fails the whole request with generic 503, no partial page/cursor. Timing and resource-failure side channels remain; successful pagination shape must be independent of hidden-row insertion under fixed visible data/grants. Physical-work enforcement remains unimplemented and must be proven before route activation.

## R2 import contract amendment (specified, not enabled)

Relative to the workspace base, `POST /imports:preview` (`previewImport`), `POST /imports/{import_id}:apply` (`applyImport`) and `GET /imports/{import_id}` (`getImport`) are human-only. Every operation requires current `imports:manage` and `tasks:read`; apply also requires `tasks:create`. POSTs require the existing verified session, allowed origin, CSRF and explicit idempotency key. Import ID/digest possession is never authority. Recheck the owning human principal, workspace, grants and relevant resource visibility on reads, mutations and replays. If an immutable saved plan/report can no longer be disclosed, deny generically rather than rewriting its rows, counts or digest.

ImportBatch has source_namespace, source_revision and at most 100 rows inside the actual raw 65,536-byte JSON envelope. Validate the closed envelope before independently validating closed ImportRow values: malformed/oversized envelopes create no preview, while an invalid row can yield an indexed rejection. The strict complete-batch schema describes wholly valid input, not the only future transport validator. Unknown owner/assignment/run/fence/result/approval/credential/grant fields reject their row. Source references are inert text, never fetched. Timestamp values are null or valid RFC3339 UTC using Z/z or +00:00; -00:00 is an unknown offset and is rejected.

A preview is immutable version 1, expiring exactly 900 seconds after its server-recorded trusted creation. Ordered row indices are contiguous from zero. Counts received/create/unchanged/conflict/rejected partition the rows. New valid rows are create; exact source repeats are unchanged; changed source and duplicate external IDs are conflicts. Every disclosed occurrence of a duplicate external ID conflicts with DUPLICATE_EXTERNAL_ID; no first-row-wins creation is allowed. Check mapping visibility before classification: absent/inaccessible references or inaccessible mapping targets use the same generic INVALID_REFERENCE rejection. Rejected rows expose only their index, null external_id/task_id and a generic code; conflict rows never expose a task ID. Unchanged task IDs require current visibility.

`preview_sha256` is lowercase SHA-256 of UTF-8 canonicalJson of the complete public preview excluding the digest field: sorted object keys, original array order, no extra whitespace. This digest does not hash omitted source bodies. The preview ID must separately bind immutable original input/source hashes and mapping/reference version snapshots server-side; changing those snapshots under the same ID is forbidden. Source hashes use the complete strict ImportRow, not batch revision metadata. Revision-only changes can therefore remain unchanged while their current attempt provenance records the new revision.

Apply requires expected_import_version 1, the exact digest and explicit accept_rejected_rows. False with any rejected/conflict row yields INVALID_STATE. Expiry at or beyond expires_at also yields INVALID_STATE. Wrong version/digest or any changed mapping/reference snapshot yields VERSION_CONFLICT for the whole apply. The server revalidates current references/visibility and commits only the reviewed creates, mappings, provenance/report, events/audit and sanitized replay in one transaction. Failure creates no partial tasks. A successful same-key replay returns the committed outcome only after current authorization; it does not perform a new apply.

GET returns the closed version-1 preview or version-2 applied report union. The report uses created rather than create in counts and row dispositions. Created/unchanged report rows have closed ImportProvenance for this import attempt; conflict/rejected rows have null provenance. This explicitly resolves the original abbreviated report rows shape while preserving the requirement to expose source provenance. Provenance includes source namespace/external ID/revision/timestamp/state/reference/hash plus import/task IDs; it cannot alter the closed Task DTO. New tasks always enter unassigned Backlog without run, result, approval or grants, regardless of source state. Changed external source never overwrites local work.

The [mixed reconciliation fixture](../examples/imports/reconciliation.json) is synthetic schema/semantic evidence only. Static verifiers accept explicit hypothetical clocks and authority/snapshot contexts, not trusted production context. Working routes, mapping uniqueness/transactions, current-authority races and restart/replay remain later implementation obligations.

## R2 literal search privacy amendment (specified, not enabled)

Search keeps the closed SearchHit kind/id/title/snippet/created_at fields, existing Page and both actor lanes. Require search:read plus current tasks:read/messages:read/artifacts:read and each resource's project/thread relationship; message participation or human messages:review remains necessary. Artifact search covers metadata only, never private object bytes.

The decoded nonempty query must fit 2,048 UTF-8 bytes both before and after NFC normalization (NFC can expand some strings). Normalize query and searched text to NFC, then compare literal case-sensitive substrings. Do not trim, lowercase, compatibility-fold or treat percent, underscore, quotes or regex metacharacters specially. Snippets contain at most 256 Unicode code points after normalization, constructed only after authorization.

**Reviewed change from the retained empty-filtered-page plan:** select authorized-only continuation while retaining the hard 2,000 examined-candidate ceiling per request. Use global immutable `(created_at,id)` ordering, globally distinct cross-kind IDs and a fixed initial high-water. Return a cursor only after proving another authorized hit exists; position it at the last returned authorized hit, not a hidden scanned frontier. Empty successful results are terminal. If authorized lookahead or high-water exhaustion cannot be established within the cap, fail the whole request with generic 503 DEPENDENCY_UNAVAILABLE and no partial results or progress cursor. Do not retry automatically or expose scanned counts.

The [reproducible comparison](research/r2-search-contracts/report.md) explains why encrypted hidden-frontier continuation still exposes hidden-dependent successful page counts. The selected availability tradeoff aligns with authorized-result history pagination, but search retains its own 2,000-candidate cap and global creation order rather than task-result sequence ordering. Successful page contents/continuation must be invariant under hidden insertions when the work is feasible. Status/503 and timing remain observable side channels; this is not total noninterference or guaranteed search availability.

Shared search cursor encoding must be fixed-width/padded AEAD, preserve separate key/AAD, and bind workspace/principal/lane/credential/session, operation, normalized query, kind, limit, sort, high-water, authority epoch and restore incarnation. Keep the existing absolute 3,600-second lifetime and 2,048-byte token ceiling. Owners must prove supported payload/identifier fit rather than invent a new ID limit. Decode/encode outside SQL, recheck current authority after each await, and make final authorized projection synchronously with no later await. Search including messages honors the proven message truncation floor; task/artifact-only search must not use that floor. Individual deletion alone is not proof of truncation. No new cursor store or retention engine is introduced.

Before activation, #23/#36 must prove actual indexed high-water, seek, authorization, candidate accounting and physical-work bounds. Every candidate examination counts, including lookahead; a SQL output LIMIT or post-query rows-read metric is not preemptive work enforcement. The synthetic ordered-array study assumes a previously established ceiling and does not prove these runtime operations. The static scalar helper implements no SQL, authorization, pagination or cursor codec.

## Local runtime enrollment and presence (issue26)

`POST /runtimes` accepts only `{label}` from a current native credential with `runtimes:manage`. The agent derives from that credential. The initial success returns `RuntimeIssue.runtime_token` once; replay returns `runtime_token:null,revealed:false`. Keep the token in protected native memory/storage. A lost response requires a new enrollment key, not token recovery. New enrollment creates distinct authority and inherits no run.

`POST /runtimes/{runtime_instance_id}:heartbeat` accepts only `{expected_runtime_version}` and requires both the original native bearer and `X-Runtime-Token`. Another credential for the same agent is not equivalent. The transaction checks current credential/agent/workspace/epoch and live runtime proof before serving replay. At the trusted presence deadline or later, including before cleanup, renewal and replay fail; at deadline minus one millisecond, renewal is allowed. Successful heartbeat advances only runtime version, last-seen time and presence to trusted now plus 90 seconds. It cannot renew a 60-second execution lease.

No runtime-list route, browser enrollment lane, client clock, automatic transfer or raw-proof replay exists. Credential revocation, archive, expiry and authority-epoch changes invalidate proof. These are local source behaviors, not deployed acceptance; [execution evidence](r2-task-plans/issue-026-execution.md) separates checks and remaining work.

## Local issue27 task surface

The local R2 source exposes only task collection create/list, task get/metadata PATCH, `:ready`, and `/results` history from this issue. Existing generated successor schemas do not enable claim, submit-result, fail, cancel, requeue, approval or run endpoints. Public Task and TaskResult fields remain unchanged. GET uses current `tasks:read` and project/resource visibility, no CSRF or Idempotency-Key; mutations retain the existing browser CSRF/native proof, idempotency and operation scope boundary.

Pages default to 50 and cap at 200. They emit no total or scanned-progress count. Continuation requires an authorized lookahead, uses the last returned authorized position and fixes the initial high-water and 3,600-second expiry. Task/history tokens are padded AES-GCM ciphertext of exactly 2,048 characters, bound to original query/task/filter/limit/order, verified principal/lane/credential/session and current authority epoch/maintenance incarnation. Wrong binding/tampering fails 400; expiry fails 410. Current proof and the whole page are rechecked after cursor encryption; a concurrent change fails the whole request rather than publishing a partial page or stale has_more.

The entire serialized page is capped at 1 MiB including actual cursor and request ID. A next authorized result that does not fit establishes continuation without truncation. An impossible persisted oversized item fails sanitized 500. A private work-budget failure returns generic 503 with no partial data or progress token. These availability/error distinctions are not constant-time or cardinality secrecy claims; detailed local measurements and supported limits are in the [issue27 ledger](r2-task-plans/issue-027-execution.md).

### Local catalog preview/apply boundary

POST `catalog:preview` and `catalog:apply` return canonical `CatalogPlan` and `ProfileData` respectively, using status200 and current human session/origin/CSRF plus idempotency. Query parameters and unsupported methods reject. Plans are creator-principal scoped; inaccessible or foreign plan IDs return NOT_FOUND, inaccessible affected resources return generic FORBIDDEN, version/reference-set changes VERSION_CONFLICT, expired/applied/conflicted first attempts INVALID_STATE, affected overflow LIMIT_EXCEEDED, and incomplete bounded agent scans DEPENDENCY_UNAVAILABLE. Restricted callers receive generic FORBIDDEN rather than a potentially hidden overflow count. No hidden IDs or reason text are included in errors/events.

Same-key identical replay returns the original outcome only after current whole-resource access and original extra write scopes pass; stale profile revisions, ended intent and elapsed preview TTL do not invalidate an already committed outcome. Different-key second apply cannot mutate again. The Worker and owning DO route only these catalog operations, with no unrelated scheduler await after final authorization/commit. Claims, result submission/review and cancellation remain unavailable.

## Staged claim and execution-lease engine

The internal issue 29 command and read interfaces do not register public claim or run routes. Production Worker entry and direct DO ingress remain closed to those operations. Their activation depends on issue 30's existing-scheduler extension and issue 31's conservative settlement/cancellation integration; absence of an alarm must never imply a usable expired lease. See the [issue 29 execution ledger](r2-task-plans/issue-029-execution.md) for exact source evidence and remaining gates. Public DTOs and unavailable-route responses are unchanged.

Issue 30 adds internal fail/expiry and shared scheduler source only. It does not register `:fail`, claim or run routes. Issue 31 must finish cancellation/requeue and integrated claim/expiry/cancel activation tests before those routes become available. Result submission and independent acceptance belong to issue 35, not issue 31. No public DTO, scope, retry-control field or client-supplied system actor is added; see [issue 30 execution evidence](r2-task-plans/issue-030-execution.md).

## Local issue31 execution/cancellation ingress

The local successor source enables `tasks/{id}:claim`, `tasks/{id}:fail`, `tasks/{id}:cancel`, `tasks/{id}:requeue`, `runs/{id}` and `runs/{id}:heartbeat` only after integrated29–31 source review. These are not a claim of remote availability or deployment. Claim/fail/renew require the exact current native credential and opaque runtime proof; readable IDs/fences do not authenticate. Run GET uses current task read/whole-result visibility, not execution ownership. Human execution remains denied.

Cancel/requeue use the canonical TaskReasonRequest and return TaskCommandResult with null run/approval. Their reason is retained privately in linked history, never ordinary events/outcomes. Replays recheck current operation permission, current/original returned-resource visibility and active proof where the operation requires one, without reapplying old task/run versions. Background shared alarm repair cannot delay a sensitive response; failed arming leaves durable repair evidence.

Submission, independent acceptance, artifact and approval endpoints remain unavailable. See [issue31 ledger](r2-task-plans/issue-031-execution.md), including the corrected issue35 ownership and future real submit/cancel evidence requirement.
