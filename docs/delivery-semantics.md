# Delivery, retries and recovery

Status: Design baseline · Contract revision 0.1 · Implementation pending.

CF Agent Hub must distinguish durable admission, attempted notification, recipient acknowledgment, execution ownership and accepted results. These are separate facts. A successful API response can confirm that a message was stored without proving that a runtime received it, woke up, performed work or completed a task. This document defines the planned failure contract for HTTP, the outbox and external runtimes. It complements the [task lifecycle](task-lifecycle.md) and [native API](http-api.md).

## What each signal establishes

| Signal | Established fact | Remaining work |
| --- | --- | --- |
| Message POST returns 201 | Message, inbox references, event, outbox and command outcome committed locally | Notify recipients and reconcile any missed delivery |
| Notification endpoint returns 2xx | Receiver accepted that HTTP delivery at its own boundary | Receiver durably deduplicates, processes and optionally ACKs |
| Explicit message ACK succeeds | Authenticated recipient recorded receipt | Claim and execute any associated task separately |
| Claim succeeds | Current run owns a time-bounded lease and fence | Runtime executes within its own environment and maintains ownership |
| Result submission succeeds | Result is durable and task is in Review; run ended | Independent reviewer accepts or requeues |
| Accept-result succeeds | Authorized independent acceptance moved task to Done | External publication or other downstream effects still need their own verified outcome |

Delivery is **at least once** wherever retry is enabled. Duplicate notification requests are expected. This does not provide exactly-once external execution or an exactly-once task completion guarantee across independent systems. The hub's transaction and fencing rules protect its own authoritative state.

## Local commit before delivery

The workspace Durable Object is the proposed serialization boundary. A domain command must validate permissions, state/version and input references, then commit its entity changes, append-only event, outbox records and idempotency outcome in one local SQL transaction. It must return a committed outcome before implying success to the caller. Network callbacks do not belong inside that transaction.

An outbox entry records a stable notification ID, destination reference, triggering event/resource, attempt count, next due time and delivery disposition. A worker claims due work, records the attempt, then performs an egress-policy-checked call. A lost response may make the remote result unknown even when the receiver accepted the request. Repeating delivery therefore preserves the notification identity. The receiver must persist that identity before triggering non-repeatable work. Acknowledging a duplicate must not recreate a task or rerun an external operation.

The retry budget and persisted jitter rule are owned by [limits](limits.md). Restarting a worker must not reset either attempt count or due time. The dispatcher must distinguish transient network/dependency failures from permanent authorization, schema or destination-policy failures. The latter require correction; repeatedly sending the same request is not recovery. A failed delivery remains observable alongside the durable inbox item. Notification exhaustion does not delete the message, release a run or cancel a task.

A future operator delivery-replay operation must preserve the original message identity and add an audit event for the new dispatch decision. No replay endpoint is included in this native baseline. Until such an operation is implemented and verified, polling the inbox and event stream is the recovery path. Do not invent an administrative URL during incident response.

## Receiver and runtime responsibilities

External runtimes must retain their own durable processing ledger. For each incoming notification, store its identity, related message/task IDs and processing disposition. Fetch authoritative task state before acting; notification payloads can be delayed or stale. A recipient may ACK after it has durably accepted the message for processing, but an ACK does not grant execution authority. Only a successful atomic claim does.

An active run's agent/runtime binding, lease deadline and fence accompany every result or decision command. A native bearer plus the matching `X-Runtime-Token` proves the caller owns that runtime; readable IDs and fences cannot substitute for proof. A fresh run has a larger task-local fence. Heartbeat only renews that run; presence updates are independent. Once a renewal fails or the lease expires, the runtime must stop issuing new task effects until it reconciles ownership. After losing authority, the runtime may only read and escalate; it cannot call a stale `fail` command or mutate the ended attempt. The server expiry command must conservatively move an expired attempt to Backlog with an `outcome_unknown` hold, unless a trusted replay-safe workspace policy for that task was already verified and persisted with the claim/audit before execution. Only that preexisting classification permits bounded automatic retry on expiry. An active owner that still has a valid proof, lease and fence can explicitly report uncertainty through `fail(outcome_unknown=true)`, which also enters the hold. Ready, Requeue and Claim reject that hold regardless of remaining retry budget. No hold-clear command exists in this baseline; reconcile the external outcome before authorizing reviewed replacement work.

Where the external service supports operation IDs or idempotency keys, use a durable business operation identifier tied to the intended action and proposal. Do not use a short-lived HTTP request ID as the business identity. Where external deduplication is unavailable, reconciliation or an explicitly reviewed compensating action is necessary. A newer hub fence cannot undo a remote action already performed by an older process.

## API retries versus execution retries

An API retry repeats the same command with the same `Idempotency-Key` and fingerprint to learn its committed outcome. A task retry allocates another execution attempt under bounded policy. Notification retries deliver a message again. These counters and identities must never be shared.

If a caller times out after claim, it first repeats the same claim request within the replay window. A replay returns the original run, which may now be expired; the caller reads current task/run state before executing. If the timeout followed submit-result, replay can confirm submission without resubmitting the external action. A version conflict requires a fresh state read and an intentional new command; replacing `expected_version` automatically hides a meaningful concurrent change.

After the idempotency retention window, the server may no longer know whether a matching key previously committed. The client must resolve uncertainty through entity state, events and its own operation ledger before choosing any new write. Retention expiry is not permission to repeat an irreversible action. Task retry exhaustion likewise cannot be bypassed through `:ready` or `:requeue`; revise the work or use a separately designed policy change.

## Artifact persistence boundary

Artifact bytes live in R2 while their manifest and state live in workspace SQL. No distributed atomic transaction across these stores is promised. The flow is stage manifest → upload matching bytes → verify and commit metadata. Staging binds workspace, uploader and, when supplied, task/run ownership and fence. Hash, declared size, stream byte count, attachment count and aggregate sizes must all pass validation.

Only committed artifacts may be attached to messages, checkpoints or results. An upload that wrote bytes but lost its metadata update is reconciled against its immutable manifest. A client must inspect artifact status and retry the same upload identity rather than creating unbounded new objects. Upload and commit must check the upload deadline on every request. Cleanup first atomically marks an eligible uncommitted manifest `expired` in SQL, creating a durable deletion tombstone; commit and that cleanup claim cannot both win. Only then may cleanup delete object bytes. Late in-flight uploads remain orphans and cannot revive or commit the expired record. Cleanup removes these bytes within an operator-defined bounded policy; it must not remove a committed reference merely because a task was cancelled. Downloads reauthorize the request and cannot expose another workspace's object key.

## Failure matrix and acceptance evidence

| Failure point | Required durable truth | Recovery |
| --- | --- | --- |
| Before local transaction commits | No successful mutation outcome | Retry same intent/key after correcting transient failure |
| After commit, before response | Entity/event/outbox/outcome agree | Replay same key, then read current state |
| After receiver accepts, before delivery acknowledgment | Delivery outcome may be unknown | Redeliver same notification identity; receiver deduplicates |
| Run expires during external action | Old run cannot submit, fail or renew; server applies preexisting retry-safety policy | Runtime reads/escalates; server holds uncertain work for external reconciliation |
| Approval expires before click | Task remains Waiting | Reject stale decision; explicit cancellation/revised task if required |
| Bytes stored before metadata update | Orphan or reconcilable staged upload | Verify manifest and reconcile; bounded cleanup otherwise |
| Credential revoked before replay | Old authority is invalid | Reject replay under revoked authority; human/operator reconciliation |

Acceptance tests must inject each failure at the actual boundary, not merely mock a successful response. Verify persisted state after restart; race claim and expiry; repeat outbox delivery; verify receiver deduplication; interrupt uploads; reject stale owners; and confirm that none of these paths marks a task Done without independent acceptance. Operational evidence belongs in the [release checklist](release-checklist.md).

## R1 delivery and recovery refinement

R1 accepts messages without task/artifact execution. Nonempty `artifact_ids` or task/artifact references fail with 400 `INVALID_REQUEST` and the corresponding `details.feature` before mutation. A message reference is permitted only when every initial/fixed-thread participant can access it. A nonrecipient sees null acknowledgment in accepted/view DTOs; a recipient sees only its own ACK. ACK remains independent of delivery and task completion.

The R1 dispatcher claims at most 25 due notifications per batch with a 30-second attempt lease and a 10-second HTTP timeout. Periodic scheduler repair runs every 60 seconds. Persisted retry delay is `max(nominal * jitter, min(validRetryAfterSeconds, retry_after_max_seconds))`; a missing or invalid provider hint contributes zero. The operator cap is 0–3,600 seconds, default 3,600; zero ignores hints. This bounded extension affects only due time, never adds attempts or shortens selected nominal backoff. Exhaustion is visible to authorized operations reads; unauthenticated liveness discloses no queue count. Inbox polling remains the R1 recovery path; no delivery-replay URL exists.

The [operator recovery protocol](runbooks/r1-recovery.md) establishes a durable barrier before capture, freezes a complete logical SQL checkpoint and keeps dispatch paused through restore. Unknown delivery disposition remains unresolved until a retained external evidence digest supports an operator-attested delivered receipt or explicit permanent failure without redrive. Neither decision creates an ACK or another attempt. Resume requires a complete verified receipt, latest current-authority ledger, no unresolved effect, fresh probe and exclusive-authority proof. Target cutover requires authenticated source retirement and catalog cutover records; ordinary capture can resume its unchanged original source. A snapshot or rollback alone never certifies safe redelivery.

## R1 stored notification contract

The closed canonical [MessageNotification](../spec/openapi.json) component has required fields `payload_version:1`, `type:"message.accepted"`, `delivery_id`, `workspace_id`, `recipient_agent_id`, `message_id`, `thread_id`, `event_id` and `occurred_at`. IDs are nonempty opaque identifiers, without slug or length rewriting. `occurred_at` is the accepted event's UTC RFC3339 time. The [sanitized example](../examples/http/r1-message-notification.json) contains no message body, references, credential, destination URL, ACK or mutable transport state. It is an outbound notification component, with no new inbound hub operation.

Acceptance stores canonical UTF-8 payload bytes once. Every attempt must sign and send those original bytes with the same delivery ID; reconstructing from mutable message projections, profile, ACK or destination state is forbidden. The receiver verifies the destination-scoped signature, durably deduplicates delivery ID before effects, and fetches authoritative message content using its own currently authorized credential. A notification grants no access by itself. Transport success does not create receipt ACK, execution or task completion.

Each intent also captures a closed canonical routing snapshot `{agent_id,url,signing_key_ref}`. Dispatch must reject a missing/unprovable snapshot before claiming or spending an attempt. Immediately before dispatch, Task 9 rechecks the stable destination ID, current enabled state, original recipient, exact canonical URL/signing-key reference and current egress policy. A changed routing binding terminates the old intent with a bounded destination-changed category; it cannot redirect it. Key value rotation behind the same protected reference is permitted. Legacy NULL snapshots remain non-executable history, and operator disposition can attest delivered/permanent failure without inventing a route or authorizing redrive. Rejecting a due legacy NULL intent may mark it cancelled while preserving its prior HTTP/error and lease fields as inert historical evidence; no terminal-implies-null-lease invariant is imposed and a late completion cannot reactivate it.

No destination is required for durable inbox admission. Zero enabled destinations produces no notification row and no fabricated transport success. SQL commit precedes any alarm arming or external request. Admission sets durable scheduler dirty/generation alongside due work. Task 9 reads SQL due work, clears dirty only after successful arming of an unchanged captured generation, and leaves/reasserts dirty for failure or stale completion. A bounded periodic repair remains responsible for the commit-to-alarm crash gap; acceptance remains durable if arming fails. Task 9 owns stale-arm interleaving, retry-byte, binding-change and ACK-suppression execution evidence.

## R1 notification wire and receiver verification

Each delivery attempt is an HTTPS POST to the exact enabled operator-approved destination captured at acceptance. Its body is the original stored `payload_json` UTF-8 byte sequence, with `Content-Type: application/json`. Parsing for validation does not authorize serializing a replacement body. Delivery identity and payload acceptance time remain unchanged across retries; each attempt obtains a fresh signing timestamp and signature.

| Header | Exact value |
| --- | --- |
| `X-CF-Agent-Hub-Delivery-Id` | Canonical unpadded base64url of UTF-8 of the well-formed ECMAScript `JSON.stringify(delivery_id)` string serialization, with no replacer or spacing argument |
| `X-CF-Agent-Hub-Timestamp` | Safe nonnegative integer Unix seconds from the trusted signing clock, in canonical decimal: no leading zeroes except `0`, sign, whitespace, fraction or exponent |
| `X-CF-Agent-Hub-Signature` | `v1=` followed by canonical unpadded base64url of the 32-byte HMAC-SHA-256 tag |

HTTP header names are case-insensitive. Delivery IDs remain exact opaque string values/code units: preserve quotes, backslashes, controls, non-ASCII characters and lone UTF-16 surrogates without Unicode normalization. Well-formed JSON string serialization escapes isolated surrogates, so the encoded header remains valid UTF-8/HTTP text. Another language may implement equivalent serialization. Strict decoding must consume canonical unpadded base64url, strict UTF-8 and exactly one JSON string; re-encoding that string must reproduce the header byte-for-byte. Noncanonical alternative escapes, duplicate headers and comma-joined duplicate values are rejected.

The signed byte sequence is UTF-8 of the following prefix, immediately followed by the original stored body bytes:

```text
cf-agent-hub-notification-v1 + LF + encoded_delivery_id + LF + timestamp + LF
```

Each LF is the single byte `0x0a`. The plus signs above describe concatenation, not literal bytes. Add no body newline, whitespace, hex conversion or alternate preimage.

The key is the exact secret-binding string named by the destination's protected `signing_key_ref`, encoded as UTF-8 with at least 32 bytes. Do not base64-decode that binding. Provision at least 32 cryptographically random bytes encoded base64url as the secret string; a length check cannot prove randomness. Keep notification keys separate from bearer, CSRF, operator/recovery and cursor-encryption keys. No secret value appears in the payload, routing snapshot, logs or forwarded request headers. A key-value rotation behind the same reference is allowed; coordinated receiver key rollout remains an operator responsibility. Rebinding the destination ID to another recipient, URL or key reference terminates the previous intent as destination-changed instead of rerouting it.

A receiver independently configures its expected workspace, recipient and verification key. It must not select a secret or a callback location from untrusted request content. Verification proceeds as follows:

1. Reject missing, duplicate, unsupported-version or malformed headers, including noncanonical base64url/decimal encodings and tags of the wrong length.
2. Verify the exact original-body HMAC using a constant-work crypto primitive. Require trusted receiver time to be within inclusive ±300 seconds of the signed timestamp; ±301 seconds is stale.
3. Validate the authenticated body against the closed generated `MessageNotification` schema, require exact decoded-header/body delivery-ID equality and check the independently configured workspace/recipient binding.
4. Only then atomically claim that delivery ID within that verified receiver binding, using durable state that distinguishes in-progress/uncertain work from completed processing.
5. Return a completed duplicate receipt only when the effect or receipt completion is durably established. A claim alone proves exclusion, not completed processing, and does not permit blindly re-executing a potentially completed external effect after a crash.

The [controlled receiver fixture](../test/helpers/notification-receiver.ts) uses SQLite unique claims and a transaction that records its local effect together with the completed receipt. Its tests reopen the same database, exercise concurrent duplicates and retain a claimed-only crash as uncertainty. That arrangement demonstrates local controlled effect/receipt recovery. Arbitrary external effects still require their own durable business-operation deduplication or reconciliation. Neither a successful receiver response nor a completed receiver ledger entry creates a hub inbox ACK or task execution authority. The same string ID in another independently verified workspace/recipient binding does not suppress that other delivery.

The [synthetic wire vectors](../test/fixtures/notification-wire.json) are public test inputs with an intentionally nonrandom synthetic key. For the ordinary ASCII vector, the encoded ID is `ImRlbGl2ZXJ5X2FzY2lpXzAwMSI`, timestamp `1792800000`, and expected signature `v1=2WeuSjx5t1J1JRfAPLo6x_BSaCiw_IefTriIAVSL26w`. The fixture's body base64 is exact byte authority. Expected constants were independently calculated; sender and receiver tests do not derive golden expectations from the signing helper under test. Additional vectors preserve Unicode/control and isolated-surrogate IDs.

## R1 scheduler and failure visibility

A claim spends one of six attempts and persists a unique attempt identity plus its 30-second lease before signing or network work. A batch contains at most 25 claims, dispatched concurrently with a 10-second request abort. Duplicate wakeups do not reclaim a live lease. On lease expiry the transport result is unknown: the spent attempt remains spent, and only the next permitted retry or terminal failure is scheduled. A stale response cannot complete a newer attempt.

The exact target recipient's inbox ACK committed before claim suppresses the intent without spending an attempt. ACK during a started fetch preserves its honest HTTP/network outcome and suppresses future retries. A 2xx response marks transport success; network/timeout, 408, 429 and 5xx are transient. Redirects, permanent HTTP errors, invalid schema/routing, revoked authority and egress denial terminate that intent. Response bodies and provider exception text are never retained as diagnostics. Permanent failure/exhaustion preserves the message, inbox, event and existing work state.

Immediately after asynchronous signing/key preparation, dispatch synchronously rechecks installed workspace/object ownership and epoch, maintenance state, the exact live claim, original sender typed membership/current grant, recipient current eligibility and reference visibility, the captured/current destination binding and egress policy. Background human eligibility uses current installed human grants, independently of an expired historical interactive session. One coherent enabled, unexpired, nonretired same-epoch native credential must satisfy the complete read/reference decision; scopes or project visibility cannot be unioned across credentials.

The installed operator-approved HTTPS host/path allowlist is the documented egress boundary. Canonical URL checks reject credentials, query/fragment, nondefault ports, IP literals and private/loopback/metadata hostname targets; redirects are refused. These checks do not promise that an otherwise approved hostname cannot resolve differently at runtime. Deployments needing stronger DNS restrictions must enforce them separately.

SQL pending due times and in-flight lease expiries are authoritative. Scheduling-relevant writes mark dirty and advance a generation in the same transaction. Post-commit arming clears dirty only after success with an unchanged captured generation. A stale arming completion reasserts dirty even if a newer arming succeeded, then performs bounded repair or a conservative wake; a failed arming preserves dirty and a bounded persisted diagnostic. Ordinary-request repair and the private 60-second operator-catalog sweep reconcile SQL-to-alarm gaps and missing alarms after platform retry exhaustion. There is no public repair or redrive endpoint, and a scheduler failure after message commit does not turn durable acceptance into a reported rejection. Run and repair calls entering a closed maintenance gate do not mutate SQL or alarms. An operation already awaiting an alarm API rechecks maintenance before any scheduler SQL completion/error write; stale physical effects are reconciled, with a final bounded conservative wake permitted under repeated fence changes. Such a closed-gate callback makes no domain mutation or further schedule. Recovery owns deliberately fenced cancellation and mandatory resume recomputation with a fresh scheduling generation; a paused no-op is not a successful scheduler probe.

Authorized human `operations:read` diagnostics expose persisted outbox counts, due times, schema/config epoch and bounded scheduler errors. Until the separately owned readiness probes are implemented, the Operations projection explicitly returns `ready:false` with an unknown `PROBE_NOT_RUN` check and no fabricated probe timestamp. Polling the authorized inbox and event stream remains the recovery path.

## Issue 30 shared lease/outbox wake contract

The existing scheduler owns the single Durable Object alarm. Its deadline is the minimum of pending/in-flight outbox work and active run leases. Each tick reserves at most 25 outbox intents and settles at most 25 expired runs, one transaction per run; an expiry failure does not skip the independent notification lane or erase its own bounded diagnostic. Ties use lease deadline then run ID. A poisoned earliest lease remains due and visible; this is not an implicit quarantine/retry policy.

Alarm writes are asynchronous projections of authoritative SQL. A generation mismatch receives one exact repair retry, then a persisted near-term conservative wake if changes continue. A second maintenance race also ends with a conservative physical wake, never a mutation of frozen SQL. A callback while closed is a no-op. Failed physical writes retain dirty state/diagnostics; SQL dirty alone does not guarantee a wake. Repair triggers are an ordinary request, existing alarm, explicit trusted repair RPC or the existing authorized catalog sweep—not constructor startup or eviction alone.

Lease candidate queries are indexed and physically bounded by their limits. The measured historical outbox MIN/OR/token scans were backlog-proportional; forward index-only migration10 and split covering seeks now bound candidate selection to two sources of at most25 rows, retain SQLite BINARY deadline/ID ordering, hydrate only the selected rows, and complete by exact delivery ID plus original token/deadline/fence. NULL in-flight leases do not hide other deadlines. [The comparison and Workers measurements](research/r2-failure-expiry.md) distinguish bounded row selection from payload/config processing, writes, crypto and network time; this is not a global latency/SLA claim. Injected AlarmPort barriers prove application interleaving defenses; separate actual storage alarm/eviction tests prove the platform path, not every modeled timing naturally occurring in production.

No task-failure/expiry notifications are introduced here. Future issue 31 ingress must preserve dirty admission plus postcommit shared repair, rechecking authority before final sensitive projection and never awaiting unrelated repair after it. Issue 33 adds artifact deadlines to this same scheduler later. Source tests are not release or external-effect reconciliation evidence.
