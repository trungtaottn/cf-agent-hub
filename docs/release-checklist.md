# Release checklist

Status: Design baseline · Contract revision 0.1 · Implementation pending.

This checklist is a release gate specification. All capabilities are currently **Specified**. Unchecked requirements below are not reported test failures; they identify evidence that implementation must produce. No release can claim “Implemented” or “Verified” by checking a documentation box without the corresponding runtime results.

## Evidence record

For every intended promotion, record the exact release artifact/version, source revision when available, toolchain and compatibility date, environment, binding identities, application schema, contract revision, policy revision, responsible reviewer and sanitized test receipts. Include the previous compatible release, recovery manifest, rollback decision and unresolved risks. Keep credentials and personal data out of receipts. Gates inherit the requirements of earlier gates.

## R1 — Foundation and truthful participation

- [ ] Worker ingress and provisioned workspace mapping are deployed in isolation with compatible SQLite storage.
- [ ] Static participant configuration and relay behavior match the published contract; UI labels distinguish configuration from live runtime presence.
- [ ] Read views show persisted state and bounded freshness; inactive or unimplemented controls do not imply success.
- [ ] Human authentication and baseline authorization deny invalid identity and cross-workspace reads.
- [ ] Every cookie-authenticated write rejects absent/invalid CSRF and disallowed origins; this is a foundation control rather than a later approval-only feature.
- [ ] Relay outbox scheduling survives restart and duplicate alarms, enforces persisted attempt budgets, retains exhausted deliveries and requires audited identity-preserving redrive. Later releases must retest their extensions.
- [ ] Logs redact credentials; unknown configuration fields fail validation; alternate public routes are reviewed.
- [ ] Deployment receipts and readiness checks exist and demonstrate restart persistence.

R1 must not claim durable task execution, dynamic credential enrollment or completed external work merely because a participant can appear or exchange a message.

## R2 — Durable coordination and native clients

- [ ] Dynamic agents, native credential issuance, one-time reveal, rotation and next-command revocation are verified.
- [ ] Enrollment reveals `runtime_token` once, stores only a hash bound to workspace/agent/runtime/issuing credential, and claim/execution/run and runtime heartbeat plus run-bound artifact writes reject a missing or mismatched `X-Runtime-Token` despite a valid bearer.
- [ ] Parent-credential revocation invalidates runtime proof; rotation drains/reconciles old work, enrolls a fresh runtime and requires a new claim after safely ending old authority. Proof material is absent from logs and exports.
- [ ] Every resource family is isolated across workspaces, including cursors, references, artifacts, credential records and idempotency outcomes.
- [ ] Concurrent claims enforce ready state, eligibility, WIP, grants and version; stale owners fail after lease expiry, cancellation and recovery.
- [ ] State/event/outbox/idempotency outcomes commit together; crash tests cover commit-before-response and dispatch-before-recording.
- [ ] Expected-version conflicts and differing-payload idempotency conflicts preserve state; retries return consistent outcomes.
- [ ] Leases, bounded retry exhaustion, Review submission and independent accept-result follow [task lifecycle](task-lifecycle.md).
- [ ] `outcome_unknown` enters a Backlog hold even with retry budget; Ready, requeue and claim remain blocked. Recovery requires external reconciliation and separately reviewed replacement work; no implicit hold-clear exists.
- [ ] A generic task PATCH cannot change approved Ready intent under an existing decision.
- [ ] Staged/uploaded/committed artifact tests cover interrupted uploads, checksum mismatch, stale fence and safe orphan cleanup, including atomic cleanup ownership excluding concurrent commit and late in-flight uploads remaining uncommitted.
- [ ] HTTP and CLI scenarios prove error semantics, credential custody, pagination and recovery from an uncertain response.
- [ ] Generic task import dry-run, stable source IDs, cutover and reconciliation are demonstrated without destructive partial-page behavior.
- [ ] Backup integrity and isolated restore preserve data and current revocations; code rollback compatibility is tested.

## R3 — Compose, approvals and MCP

- [ ] Composed tasks preserve scope, state ownership and version constraints across UI and agent surfaces.
- [ ] Approval requests checkpoint and release the lease; only the current proposal and assigned authorized human can decide. Authorization-significant inputs bind a committed immutable JSON artifact ID and verified digest, and execution must match them.
- [ ] Human-only `messages:review` read authorization and fixed thread membership prevent reply-based participant expansion or historical disclosure.
- [ ] Approval expiry stays Waiting; stale/replayed/rejected decisions cannot resume unauthorized work.
- [ ] Browser cookie mutations reject missing/incorrect CSRF and disallowed origins; human-only routes reject agent bearer credentials.
- [ ] MCP STDIO tool mappings preserve domain grants and error semantics for each explicitly supported client and pinned protocol revision.
- [ ] If remote MCP is included, discovery, audience validation, client authorization, refresh/revocation and negative cases are evidenced separately.

MCP connection alone must not be reported as runtime activation, task completion or universal client compatibility.

## R4 — Teams, adapters and advanced operations

- [ ] Team membership and invitations operate only on provisioned workspaces and deny stale, replayed or unauthorized invitations.
- [ ] Membership removal takes effect on subsequent commands and stops dependent effects under policy.
- [ ] Any A2A support pins an exact release and subset, with discovery/authentication/state/cancellation recovery tests.
- [ ] Real connectors prove provider resource identities, timestamps, denied access, rate-limit recovery, secret separation and reconciliation.
- [ ] Durable scheduling survives restart and duplicate alarm execution without multiplying retry attempts.
- [ ] Exhausted delivery inspection and deliberate redrive preserve deduplication identities and auditability.
- [ ] A complete recovery drill verifies manifests, all committed artifact bytes, fence invalidation, revocation overlay and outbox reconciliation.
- [ ] Operational thresholds and capacity statements are based on recorded measurements in the intended environment; no synthetic target is advertised as achieved.

## Promotion and failed-candidate decision

- [ ] The [deployment](deployment.md) preflight matches actual account resources; no production binding leaks into the test environment.
- [ ] A disposable public-edge canary proves authentication, transaction persistence, artifact authorization and the release's enabled feature path.
- [ ] Disabled capabilities fail explicitly, with truthful UI and documentation status.
- [ ] Schema change strategy names a compatible rollback or an isolated restore/forward-repair route; namespace deletion is excluded from routine repair.
- [ ] Reviewers inspect sanitized runtime evidence and record go/no-go for the named gate.

If any required check fails, keep the candidate gated, preserve evidence and follow [operations](operations.md) and [backup and restore](backup-restore.md). A code version rollback cannot undo external actions. Resuming a release requires renewed readiness and reconciliation, not a replacement success label. Update [feature matrix](feature-matrix.md), changelog and relevant contracts only to the level supported by that evidence.
