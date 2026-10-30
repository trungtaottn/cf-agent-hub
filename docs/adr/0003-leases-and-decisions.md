# ADR 0003: Leased execution and versioned decisions

Status: Accepted design direction · Contract revision 0.1 · Implementation pending.

## Context

Multiple runtimes can compete for work, disconnect or continue executing after their authority expires. Human decisions can arrive after a proposal changes. Agent names and wall-clock timestamps cannot provide a reliable ownership test.

## Decision

Claims atomically create a run bound to an agent and runtime, with a server-side lease and a monotonically increasing task fence. Every execution mutation verifies the current run, fence, actor and lease. Heartbeats update run_version only. A terminal attempt never resumes; a subsequent claim creates a new run.

Requesting a human decision checkpoints and ends the current attempt, moving the task to Waiting. The decision binds a human principal to the current task/proposal versions and scope. Approval returns the task to Ready for a fresh claim; rejection returns it to Backlog; expiry leaves a visible unresolved Waiting state. Result acceptance excludes both the submitting principal and submitting agent.

## Alternatives considered

Permanent assignment without a lease leaves stranded work after a crash. A lease without fencing allows an old runtime to submit late. Keeping an active lease while waiting for a human consumes execution authority without useful work and complicates deadline handling. A timeless approval cannot show which proposed action was approved.

## Consequences and evidence

Clients must handle conflicts and loss of authority explicitly. Expiry defaults to an uncertainty hold unless trusted preexisting policy classifies the work replay-safe; stale runtimes cannot mutate their expired attempt to report failure. External tools still need their own side-effect safety. Restore procedures must prevent pre-restore fences and revoked credentials from becoming valid again; restoration is an authorization event as well as a data operation.

Required evidence covers claim races, WIP contention, stale submission, decision expiry, stale approval, cancellation and restored authority. The canonical details are [task lifecycle](../task-lifecycle.md), [security](../security-model.md) and [backup and restore](../backup-restore.md).

## Dated R2 contract amendment — 2026-10-26

[ADR 0008](0008-r2-authority-and-history.md) records the selected provenance and restore-authority contract. This is an additive design amendment, not deployed evidence. Restore revokes human-managed credentials and runtime proofs even at the same numeric authority epoch; it does not revive archived/disabled identities or upgrade revoked credentials. Fresh issuance requires current human authority and operator ceilings. Existing lease/fence checks, independent acceptance and uncertainty holds remain mandatory. R3 decision routes are not enabled by this R2 amendment.

## Issue 29 implementation boundary

The local staged engine adopts conditional ownership checks after comparing [pinned open-source implementations](../research/r2-claim-leases.md). It reuses the workspace SQLite transaction rather than a distributed lock, a second scheduler or PostgreSQL locking syntax. Agent WIP includes unswept active attempts, including expired leases. The scoped run read is a domain interface, not public route activation. Claims stay unavailable until the issue 30/31 expiry and settlement owners integrate. Local source tests cannot establish deployed acceptance or external exactly-once effects.

## Issue 30 conservative failure/expiry implementation

[Open-source comparison and experiments](../research/r2-failure-expiry.md) support extending the existing SQL-authoritative alarm, not importing another scheduler or Redis/PostgreSQL lock semantics. Captured preexecution safety is immutable evidence; current policy or runtime assertions cannot manufacture it. Unknown overrides safe classification; a safe transition consumes fixed remaining budget atomically, never resumes an ended run. The dedicated expiry producer constructs a fixed system identity itself; ordinary command event construction rejects expiry/system injection at runtime.

Alarm projection uses bounded exact repair followed by a durable conservative wake under repeated generation or maintenance changes. Frozen maintenance SQL is never altered by stale continuation. The measured inherited outbox query gap is corrected by forward index-only migration10, bounded source selection and exact keyed completion, rather than hidden by LIMIT. Prior migration bytes remain unchanged and historical schema7 recovery stays separate. [Issue 30 evidence](../r2-task-plans/issue-030-execution.md) distinguishes internal source verification from still-closed public ingress and deferred acceptance.
