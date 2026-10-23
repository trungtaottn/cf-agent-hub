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
