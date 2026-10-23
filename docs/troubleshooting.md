# Troubleshooting

Status: Design baseline · Contract revision 0.1 · Implementation pending.

This guide describes expected diagnostic behavior for the proposed service. No diagnostic endpoint, command or operator console is claimed to exist. Use the implemented release's documented tooling when available; request/response names come from [HTTP API](http-api.md). Preserve request IDs, timestamps, workspace, release version and relevant event/run identifiers, while removing credentials and personal content.

## Diagnose before replaying

Establish whether the failure happened before authentication, before command commit, after commit but before response, or during external delivery. A timeout is not proof that nothing committed. Read the authorized current state or repeat the same request with its original idempotency key and payload. Do not generate a new key just to bypass a conflict. An irreversible external action requires separate reconciliation even after local idempotency retention expires.

| Symptom | Evidence to inspect | Safe recovery and verification |
|---|---|---|
| Public route fails but platform deployment reports success | Hostname/route mapping, intended account, Worker version and sanitized edge logs | Correct routing, then recheck public identity denial and authenticated readiness; do not expose an unprotected fallback |
| Authentication rejected | Trusted issuer/audience, signature validation, expiration, key rotation and credential revocation | Correct provider configuration or obtain a new authorized credential; never trust an identity header directly |
| Signed-in human cannot access a workspace | Verified issuer/subject, current membership, provisioned catalog and action policy | An authorized administrator reviews membership; email/display-name matching must not grant access |
| Browser mutation rejected while reads work | Origin, CSRF token/session binding, cookie flags and actual requested action | Renew the authorized session and correct same-origin handling; do not disable CSRF to repair a client |
| One workspace works and another is unavailable | Per-workspace mapping, schema version, migration result and storage readiness | Gate only the affected scope where possible; repair compatible configuration or recover coherently |
| Bound storage appears empty after deployment | Namespace identity, environment, mapping digest and application schema | Stop writes and compare the release receipt; a new object mapping may point to different data, so do not reseed automatically |
| Task claim conflicts | Current state/version, eligibility, WIP policy and existing live run | Refresh state; one winner in a concurrent claim is expected; never force the old version |
| Runtime appears online but run updates fail | Credential scope, matching `X-Runtime-Token`, issuing credential, agent/runtime binding, lease expiry and current fence | Stop stale work and reconcile external effects. A rotated credential needs fresh enrollment and a new claim after old authority safely ends; presence and runtime ID do not prove ownership |
| Task remains Review after result upload | Submission event, validation and reviewer authorization | Independent authorized reviewer accepts the result explicitly; ACK does not complete the task |
| Task remains Waiting after approval expiry | Current proposal/version, decision event and assigned human scope | Inspect and triage the expired proposal; there is no baseline proposal-renewal command. If work must change or restart, an authorized actor cancels it and creates reviewed replacement work. Expiry must not approve or requeue work automatically |
| Task is held in Backlog with `outcome_unknown` | External effect receipts, failure event and reconciliation record | Do not force Ready, requeue or claim. Reconcile externally, then use separately reviewed replacement work; the baseline has no implicit hold-clear action |
| PATCH of an approved Ready task fails | Current approved decision and intended field change | Preserve approved intent; cancel and create separately reviewed replacement work if intent must change |
| Work repeatedly returns to Ready or Backlog | Lease/failure events, retry allowance, runtime clocks and server receipt times | Repair renewal/retry behavior, respect exhausted retry review and use server authority for timing |

## Artifacts and storage integrity

| Symptom | Evidence to inspect | Safe recovery and verification |
|---|---|---|
| Upload returned an uncertain response | Upload intent, exact object key, size/checksum and run fence | Reconcile staged/uploaded status using the original operation identity; retry finalization only while ownership remains valid |
| Bytes exist but artifact is unavailable | Metadata state and task/workspace/run relationship | Uncommitted bytes are deliberately inaccessible; finish valid commit or let bounded cleanup remove the orphan |
| Committed artifact is missing or corrupt | Trusted manifest, object size/checksum, retention and deletion history | Stop destructive cleanup, preserve metadata and restore verified bytes; do not mark the artifact successful |
| Many old staged records accumulate | Cleanup scheduling, oldest intent, durable cleanup ownership and storage failures | Repair bounded cleanup after validating metadata access. Atomically exclude commit before deleting exact keys; late uploads stay uncommitted and require another sweep |
| Artifact download crosses a workspace boundary | Authenticated route, stored workspace and object-key generation | Treat as a security incident, contain access and audit affected records; fixing the UI is insufficient |

R2 [consistency guarantees](https://developers.cloudflare.com/r2/reference/consistency/) do not make a SQL record and object upload atomic. Inspect the two-phase artifact state before treating a missing metadata record as a bucket propagation issue.

## Notifications, adapters and external effects

An increasing outbox backlog can mean a stopped dispatcher, unavailable wakeup, disabled destination or failing receiver. Inspect oldest due work, last scheduled wakeup, attempt budget, destination/grant status and bounded failure category. Keep the original event identity when redriving. Cloudflare [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) can execute more than once, so duplicate wakeups must not create new delivery identities or reset attempts.

A receiver seeing duplicates is consistent with at-least-once delivery. Deduplicate before executing effects and retain a receipt. A receiver returning success while a task remains unchanged is also expected: transport acceptance is not a task transition. If delivery is exhausted, repair the receiver before an authorized explicit redrive; increasing retries without reconciliation can repeat irreversible actions.

An MCP client connecting without an active runtime is not evidence of scheduler failure. Confirm that a separately managed runtime is running, has a valid grant, polls or receives notifications and can claim eligible tasks. If remote MCP authorization fails while native HTTP works, inspect the selected protocol revision, resource audience and authorization flow. Do not reuse a browser cookie or weaken audience checks as a workaround. Unsupported A2A/connector features must remain disabled; see [integrations](integrations.md).

For connector drift, compare actual provider IDs, source timestamps, permission scope, pagination completion and cutover ownership. Missing data after an incomplete page must not trigger deletion. Record unknown external effect outcomes and reconcile with provider receipts before retrying.

## Failed deploy or restore

First gate mutations and delivery, then compare the deployed version, bindings, schema and secret key identifiers with the last known good receipt. Do not print key material. Determine whether old code can read all new state before attempting rollback. Platform [Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) is not a database or artifact restore.

A failed first deployment must remain inaccessible until its readiness requirements pass. A failed restore must remain isolated: verify manifest authenticity, database method, artifact coverage, current revocations and fence invalidation. Never point production traffic at a partly restored workspace. [Backup and restore](backup-restore.md) defines cutover and outbox reconciliation requirements.

Escalate with a sanitized incident record: observed and expected behavior, exact environment/release, request/event identities, affected scope, commit uncertainty, containment and remaining external effects. Completion requires the relevant authorization and integrity checks plus a successful representative operation. A new deployment success indicator alone does not resolve the original failure.
