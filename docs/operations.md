# Operations

Status: Design baseline · Contract revision 0.1 · Implementation pending.

This guide defines the planned operating contract for a self-hosted CF Agent Hub. Operator screens, diagnostic exports and maintenance commands still require implementation. Acceptance requirements below must be translated into tested tooling before a release can claim operational support. The [HTTP contract](http-api.md) owns route names; this document defines behavior rather than additional endpoints.

## State and responsibility map

| State | Authority | Operational consequence |
|---|---|---|
| Tasks, runs, approvals, memberships, credential hashes | Workspace Durable Object SQLite | Recover coherently; never reconstruct authority from UI caches |
| Events, idempotency outcomes, outbox and retry state | Same workspace transaction | Crash recovery must preserve command outcomes and delivery work |
| Artifact metadata and upload intents | Workspace SQLite | Only committed records permit artifact reads |
| Artifact bytes | Private R2 objects | Reconcile against metadata; a present object alone is not an authorized artifact |
| Workspace catalog, auth and secret bindings | Deployment configuration | Keep release receipt and independently recoverable secret references |
| Runtime presence and browser state | Advisory views backed by bounded freshness | Presence does not prove task ownership or completed work |

The Worker accepts a request, establishes its principal, selects the provisioned workspace, then submits a domain command. The workspace must recheck current membership/grant, actor kind and resource scope inside that command. State, event, outbox work and idempotency outcome commit together before external effects. Cloudflare provides [transactional Durable Object storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/); application transaction boundaries and authorization checks remain implementation obligations.

## Daily checks and actionable signals

Review readiness by workspace and enabled capability, not only an aggregate uptime indicator. Inspect schema compatibility, outbox age and pending count, exhausted deliveries, oldest staged upload, missing committed bytes, unauthorized request trends, storage growth, and time since the last verified recovery exercise. Record observed values before proposing thresholds; this baseline sets no SLO or measured capacity target.

Monitor claim conflicts separately from service faults. Two clients racing for the same ready task should produce one successful claim and one conflict. Monitor repeated stale fences, abnormal lease expiries or continuous runtime replacement because they can indicate disconnected clients or an unsafe retry loop. Compare event cursors with UI projections when a board appears stale. Never overwrite authoritative state with a stale browser view.

Readiness evidence must identify the release, environment, workspace, schema, check time and bounded result. Public responses must not expose bucket names, internal object identifiers, key material or detailed membership inventories. Diagnostics requiring sensitive context belong behind operator authorization.

## Leases, decisions and task recovery

Lease renewal and runtime presence are different signals; the [limits](limits.md) contract owns timing. Heartbeat renewal changes run lease/revision, not task or proposal versions. A stopped runtime eventually loses its lease; a later runtime must claim afresh with a higher fence. The old run must be unable to heartbeat, submit a result or commit an artifact after ownership is invalidated.

When work stops, read the authoritative task, run, lease, fence and recent events before acting. A known failure, or lease expiry for work classified replay-safe by trusted policy before execution, returns work to Ready only while its bounded retry allowance remains; otherwise it returns to Backlog with a `retry_exhausted` hold blocking Ready, requeue and claim. Recovery requires reviewed replacement work or a separately designed policy extension, not resetting the counter. Lease expiry without that prior replay-safe classification is uncertain by default and the server places it in a Backlog hold. A stale runtime cannot invoke a failure command to change the expired attempt; it may only reconcile and escalate. A failure marked `outcome_unknown` always enters a Backlog hold regardless of budget. The hold blocks Ready, requeue and claim until external reconciliation. No hold-clear command is included in the baseline; recovery requires separately reviewed replacement work after reconciling external effects, while the held task remains auditable. A result submission moves work to Review and releases the lease. It becomes Done only after an independent authorized reviewer accepts it. An approval request saves a checkpoint, releases the lease and moves to Waiting. Matching approval makes it eligible for a new claim; expiry keeps it Waiting. Follow [task lifecycle](task-lifecycle.md) for the full state machine.

An approved task in Ready must retain the approved intent: a generic task PATCH must not alter it under an existing approved decision. Cancel and create separately reviewed replacement work when intent changes. An operator must not manufacture success by acknowledging a notification or editing generic task metadata. Cancellation invalidates active runs and pending approvals while retaining audit history. Reconcile irreversible external effects separately before restarting cancelled or failed work.

## Durable delivery and retry queues

The planned outbox is a persisted workspace queue, not a claim that Cloudflare Queues is required. Each delivery record must include a stable event/delivery identity, destination configuration version, attempt count, next eligible time, last bounded error category and terminal status. Scheduling must derive the earliest due work from durable state and recover after an object restart. Cloudflare [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) can provide wakeups with at-least-once execution; an alarm callback must therefore be safe to repeat.

A dispatcher claims a bounded batch, rechecks that its destination and granting credential remain active, sends outside the state transaction, then records the outcome. A crash between receiver acceptance and recording can duplicate delivery. Receivers must deduplicate by stable identity. Notification attempts and delays follow [limits](limits.md); alarm retries and application delivery attempts are distinct and must not multiply the delivery budget accidentally. Delivery timeouts and retryable failures consume the same persisted budget.

On exhaustion, retain a terminal delivery record and expose it for authorized inspection. Fix the receiver before any explicit redrive. A redrive must be audited and preserve the original event identity so deduplication remains possible; it must not silently reset all failed records. A successful HTTP response indicates transport acceptance, not message ACK, task acceptance or external execution completion. See [delivery semantics](delivery-semantics.md).

## Artifact reconciliation and cleanup

Artifacts follow `staged → uploaded → committed` across SQL and R2. Persist an intent and server-generated workspace key first; upload bytes to that immutable key; verify byte count and application checksum; then commit metadata only if the authorized run/fence and task relationship remain valid. SQL and R2 do not form one distributed transaction. Repeating finalization must resolve to the same artifact or a clear conflict.

Cleanup must first atomically mark a deadline-expired, uncommitted intent `expired` in SQLite as a durable cleanup tombstone. The same transaction verifies that no committed reference exists and excludes finalization. Upload and commit must reject intents whose `expires_at` deadline has passed or whose state is `expired`. Only after obtaining this exclusion may cleanup delete the exact immutable R2 key, then record completion. Deletion and completion must be safe to repeat after a crash. An in-flight upload that arrives after cleanup ownership is established cannot commit; treat its late bytes as an orphan for another bounded sweep. A select/check followed directly by deletion is unsafe because finalization could otherwise race it. Stop the cleaner when metadata cannot be read reliably. A missing committed object is an integrity incident, not an orphan candidate; preserve its record and investigate retention, deletion and restore history. R2's [object consistency](https://developers.cloudflare.com/r2/reference/consistency/) does not eliminate this application-level coordination requirement.

## Credential and key maintenance

Issue credentials with the least workspace scope needed. Reveal native bearer material only once, keep verification hashes, and audit grant identity, creator, permitted actions, rotation and revocation without recording tokens. Enrollment additionally reveals a one-time opaque `runtime_token` in `{runtime,runtime_token,revealed}`. A replay returns a null token and `revealed: false`; a lost reveal requires fresh enrollment, not recovery of the secret. Its stored verification hash is bound to workspace, agent, runtime and issuing credential. Claim, execution, run heartbeat, runtime heartbeat and run-bound artifact writes require bearer authentication plus `X-Runtime-Token`; the runtime ID is not a secret or proof. Keep runtime proof out of logs and exports. To rotate a credential, drain and reconcile old work, issue a replacement, enroll a fresh runtime, safely end old run authority, and make a new claim. Do not attach an existing runtime or run to the replacement credential. Revoke the predecessor after cutover; revocation also invalidates runtime proofs bound to it. During an incident revoke first, accepting interruption. Every following command must reject the revoked credential; queued deliveries authorized by it must be stopped or explicitly reauthorized under policy.

Rotate signing/encryption secrets separately from bearer verification records. Introduce a new active key identifier, retain old decrypt/verify keys while dependent retained records exist, migrate or expire dependants, and remove old material only after a recovery test. Store key inventory and recovery access separately from data backups. Membership removal must invalidate future commands even if an identity-provider session remains valid.

## Incident and maintenance completion

Contain the affected scope, preserve sanitized request/event IDs, record which writes and external effects may have occurred, and avoid broad replay. Use [troubleshooting](troubleshooting.md) for symptom isolation, [backup and restore](backup-restore.md) for integrity recovery and [security model](security-model.md) for authorization incidents. Resume mutations, delivery and cleanup in that order only after state consistency, current grants and runtime fence invalidation are verified. Record the remaining reconciliation work and an owner; a green ingress check alone does not close an incident.
