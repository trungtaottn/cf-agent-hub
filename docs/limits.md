# Limits and time budgets

Status: Design baseline · Contract revision 0.1 · Implementation pending.

This page is the canonical register of proposed default limits. They are design inputs for validation and load testing, not measured capacity, a service level agreement, or an indication that a service is available. Configuration may reduce a limit within the published schema; raising a ceiling requires a contract review and release evidence.

## Payload and pagination limits

| Setting | Default | Hard ceiling | Enforcement point |
| --- | ---: | ---: | --- |
| Inbox page size | 50 items | 200 items | Inbox query before reading the next page |
| Thread page size | 100 items | 500 items | Thread query, scoped to an authorized thread |
| Task and event page size | 50 items | 200 items | Workspace query with an opaque cursor |
| ACK batch | — | 200 message IDs | Whole request before any ACK mutation |
| Message body | — | 32,768 UTF-8 bytes | Body validation before persistence |
| Complete JSON request envelope | — | 65,536 UTF-8 bytes | Entry boundary and domain validation |
| Structured references | — | 8,192 serialized UTF-8 bytes | Canonical references serialization |
| One attachment | — | 10,485,760 bytes (10 MiB) | Declared size and streaming upload byte count |
| Attachments per message or result | — | 5 | Commit/association validation |
| Aggregate attachment bytes per message or result | — | 26,214,400 bytes (25 MiB) | Sum of committed attachment sizes |

These are separate checks. An individually valid body can still exceed the envelope limit after metadata is added. A count of Unicode characters is not a UTF-8 byte count. Uploads must be bounded during transfer, not only after accepting a declared length. Files are uploaded through the artifact flow, not base64-embedded in JSON.

Other list routes use the bounded limit declared in the [OpenAPI contract](../spec/openapi.json); they must not introduce an unbounded export through an omitted limit. Export and backup are separate privileged operations with explicit scope and resource budgets.

## Leases, presence and replay

| Setting | Proposed value | Meaning |
| --- | ---: | --- |
| Default task execution lease | 60 seconds | Server-side deadline for the active run's authority |
| Recommended run heartbeat interval | 20 seconds | Client scheduling guidance, not a guarantee of renewal |
| Runtime presence expiry | 90 seconds | Freshness threshold for connection status only |
| Idempotency outcome retention | 24 hours | Minimum replay window for a completed command outcome |

The server's time is authoritative. Clients must treat a failed or late renewal as lost authority until a fresh response confirms the run remains valid. Presence and ownership are separate: an online runtime can have no task; a task can lose its lease before a runtime is marked offline. A runtime heartbeat does not renew a task lease.

Idempotency expiry is not permission to repeat an irreversible external action. A runtime must retain its own durable operation identifiers or reconcile the external system before retrying uncertain work. See [delivery semantics](delivery-semantics.md) and [task lifecycle](task-lifecycle.md).

## Notification retry budget

The proposed application budget is **six attempts total**, consisting of the initial delivery and up to five retries. Nominal retry delays are **5, 30, 120, 600 and 3,600 seconds**, selected by retry number. A worker may apply downward jitter within the chosen delay: sample a multiplier in `[0.8, 1.0]`, persist the resulting due time, and never exceed the selected delay. A `Retry-After` hint is capped by the R1 operator value below; it must not create an unlimited retry schedule.

Attempt count, next due time, last failure category and terminal disposition belong in durable storage. Restarts must not reset the budget. Cloudflare alarm delivery has its own platform behavior; one alarm callback may process multiple due records, and a repeated callback must not grant additional application attempts. The platform's at-least-once alarm semantics are documented by [Cloudflare](https://developers.cloudflare.com/durable-objects/api/alarms/).

An exhausted notification is visible as failed delivery; R1 offers inbox polling and no replay endpoint. A later authorized replay operation requires its own reviewed contract and audit event. It does not silently cancel or finish the associated task. Do not retry permanent authorization, schema or destination-policy errors as transient network failures.

## Policy values without universal defaults

Workspace WIP ceilings, task retry limits and explicit replay-safety classification, approval expiry, event retention, artifact retention and webhook destination allowlists are policy decisions. This baseline deliberately does not assign a universal numeric default to them. An implementation must declare and validate its selected policy before enabling the affected feature, document it in the release configuration, and expose the effective value to an authorized operator. A missing WIP or retry policy must not mean unlimited execution.

## Acceptance requirements

- Exercise values below, at and above every ceiling, including multi-byte text and misleading upload headers.
- Reject an oversized ACK batch atomically; do not apply a partial set and return a generic error.
- Test lease expiry with an injected clock and stale heartbeat; client time must not extend authority.
- Prove a restarted notification worker retains its attempts and due times.
- Verify pagination remains bounded when filters, deleted records and concurrent inserts are present.
- Record load-test evidence before publishing capacity or latency targets. Changing these limits requires aligned schemas, examples and release notes.

## R1 operational ceilings

| Setting | R1 value | Meaning |
| --- | ---: | --- |
| Cursor lifetime | 3,600 seconds | Expired cursor fails explicitly |
| Dispatcher batch | 25 | Due notifications per claim |
| Notification attempt lease | 30 seconds | Recoverable claim boundary |
| HTTP delivery timeout | 10 seconds | Per callback attempt |
| Scheduler repair | Every 60 seconds | Recovers missed alarm arming |
| Provider Retry-After cap | 3,600 seconds default; 0–3,600 allowed | Zero ignores provider hints |
| Static credential expiry | At most 90 days from provisioning | Required RFC3339 expiry |
| OIDC login attempt | 300 seconds | One use |
| Human session TTL | 300–28,800 seconds | Also capped by ID-token expiry |
| Profile-preview changes/conflicts | 200 each | Closed entries, no truncation |
| Readiness checks | 64 | Closed, redacted entries |
| Recovery JSON envelope/manifest | 65,536 UTF-8 bytes | Finite operator protocol |
| Recovery binary control/chunk headers | 8,192 ASCII bytes | Unpadded base64url canonical JSON |
| Recovery SQL page/chunk/count | 200 rows / 1,048,576 bytes / 256 chunks | Exceeding a bound fails capture |
| Recovery total rows/bytes | 1,000,000 / 268,435,456 | Required budget ceiling |

Persisted retry delay is `max(nominal * jitter, min(validRetryAfterSeconds, retry_after_max_seconds))`, with absent/invalid hints treated as zero. The cap applies only to the provider hint: it never shortens nominal jittered backoff or increases the six-attempt budget. Profile preview and recovery bounds fail explicitly; neither may truncate evidence or partly apply a command. R1 does not expose artifact upload despite retaining its later-release bounds in this register.

## R2 policy and catalog contract bounds — 2026-10-26

These selected bounds constrain future R2 consumers; they are not deployed-capacity measurements. Execution policy requires integer version >=1, WIP 1–100, retries 0–10 and artifact-upload TTL 60–3,600 seconds. No universal policy default is installed; 1/2/900 remain fixture values. Catalog preview affects at most 200 entities and expires exactly 15 minutes after creation. Exceeding a bound rejects the operation rather than truncating its effects. See [configuration](configuration.md) and [catalog lifecycle](customization.md).

### Selected R2 historical-result limits

History uses existing ListLimit default 50 and range 1–200, with up to limit plus one fully authorized rows for lookahead. This is an authorized-output bound, **not** a physical candidate-scan or artifact-lookup bound. Long hidden prefixes/suffixes require actual indexed-query/work-budget proof before #27 activates the read. Exceeding a supported hard work budget rejects the entire request with generic 503, never a partial/progress page.

The new complete serialized history-response ceiling is 1,048,576 UTF-8 bytes including page, cursor and request_id. Never truncate a result. Stop before the next unreturned authorized result exceeds the budget. Submission/restore validation must prove a result fits with maximum supported continuation-envelope overhead; canonical identifier/envelope bounds must be established by the owning implementation before activation. No new identifier-length number is invented here. Oversize persisted invariants fail sanitized 500 rather than looping. Test Unicode and 1MiB−1/at/+1, including large supported envelope fields. Cursor lifetime remains absolute 3,600 seconds; fixed-width/padded history cursor encoding must remain within the existing 2,048-byte limit, including encoding overhead. These are reviewed contract requirements, not measured deployed behavior; [ADR 0008](adr/0008-r2-authority-and-history.md) owns the privacy and sequencing rationale.

## R2 import contract bounds (implementation pending)

Import requests retain the raw 65,536-byte UTF-8 envelope limit, counting whitespace and all JSON overhead before decoding. At most 100 rows are admitted per preview. Namespace/external-ID lengths are at most 128 Unicode code points; source revision at most 256, source state at most 64 and inert source reference at most 2,048. Namespace/external IDs are nonempty. Row title/description retain canonical Task input semantics; neither is exempt from the enclosing byte cap. UTC source timestamp is nullable. Preview lifetime is exactly 900 seconds from trusted creation, and apply at expiry is invalid. Counts are integers 0–100 and reconcile to every input index. No default partial acceptance or silent row truncation exists.

## R2 literal search bounds (specified)

Decoded nonempty search queries are limited to 2,048 UTF-8 bytes before and after NFC; snippets are at most 256 Unicode code points after NFC. Examine at most 2,000 candidates per response, including authorized lookahead, without treating output count as examined work. If the hard cap prevents proving an authorized continuation or terminal high-water exhaustion, return whole-request generic 503 with no partial results or progress cursor. Empty successful pages are terminal, superseding the older empty-filtered-progress design. This can reduce availability on hidden-heavy data; status/timing leakage remains documented.

Keep the shared absolute 3,600-second cursor lifetime and 2,048-byte encoded token maximum; fixed-width/padded search encoding and maximum supported payload fit are activation prerequisites. Candidate limits do not themselves prove bounded physical SQL work, authorization joins or initial high-water establishment. Runtime owners must supply that proof without weakening the cap or inventing interruption support.
