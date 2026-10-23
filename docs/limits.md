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

The proposed application budget is **six attempts total**, consisting of the initial delivery and up to five retries. Nominal retry delays are **5, 30, 120, 600 and 3,600 seconds**, selected by retry number. A worker may apply downward jitter within the chosen delay: sample a multiplier in `[0.8, 1.0]`, persist the resulting due time, and never exceed the selected delay. A `Retry-After` hint must be bounded by operator egress policy; it must not create an unlimited retry schedule.

Attempt count, next due time, last failure category and terminal disposition belong in durable storage. Restarts must not reset the budget. Cloudflare alarm delivery has its own platform behavior; one alarm callback may process multiple due records, and a repeated callback must not grant additional application attempts. The platform's at-least-once alarm semantics are documented by [Cloudflare](https://developers.cloudflare.com/durable-objects/api/alarms/).

An exhausted notification is visible as failed delivery and is recoverable by an authorized replay operation with a new audit event. It does not silently cancel or finish the associated task. Do not retry permanent authorization, schema or destination-policy errors as transient network failures.

## Policy values without universal defaults

Workspace WIP ceilings, task retry limits and explicit replay-safety classification, approval expiry, event retention, artifact retention and webhook destination allowlists are policy decisions. This baseline deliberately does not assign a universal numeric default to them. An implementation must declare and validate its selected policy before enabling the affected feature, document it in the release configuration, and expose the effective value to an authorized operator. A missing WIP or retry policy must not mean unlimited execution.

## Acceptance requirements

- Exercise values below, at and above every ceiling, including multi-byte text and misleading upload headers.
- Reject an oversized ACK batch atomically; do not apply a partial set and return a generic error.
- Test lease expiry with an injected clock and stale heartbeat; client time must not extend authority.
- Prove a restarted notification worker retains its attempts and due times.
- Verify pagination remains bounded when filters, deleted records and concurrent inserts are present.
- Record load-test evidence before publishing capacity or latency targets. Changing these limits requires aligned schemas, examples and release notes.
