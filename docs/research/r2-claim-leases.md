# Issue 29: source comparison before implementation

Status: Source comparison only; live acceptance pending, no released capability.

Research date: 2026-10-27 UTC. Scope: atomic claim, durable ownership generation, exact-owner renewal, conservative WIP and transaction boundaries. This is design research, not a product or performance test. No dependency was installed and no upstream implementation was copied into product code.

## Recommendation

Reuse the existing workspace `transactionSync` command boundary. In one transaction, resolve current credential/runtime proof and configuration, check eligibility and Ready revision, count all status-active attempts including expired unswept attempts, allocate the next task-local fence, insert the run, update the task pointer, mark the shared scheduler dirty, and retain the event and sanitized idempotency outcome. For renewal, compare current pointer, exact run/agent/runtime/credential/authority epoch and fence, run version and exclusive deadline before updating only the run version/lease. A durable ownership generation must be compared at mutation time; possession of an old run ID is not authority.

This recommendation comes from the following inspected source, not repository popularity. The versions below are deliberately pinned comparison snapshots, not claims about the latest release or security status. The GitHub connector returned their full source and blob hashes; receipts are in `research-sources.json` outside the product tree.

## Source comparison

### 1. etcd v3.6.5: lease-bound mutex with revision comparison

- [mutex.go](https://github.com/etcd-io/etcd/blob/v3.6.5/client/v3/concurrency/mutex.go), blob `6898bbcec4144383b6370a229f266c6385ac4d22`. Inspected `tryAcquire`, `Lock`, and `IsOwner`.
- [session.go](https://github.com/etcd-io/etcd/blob/v3.6.5/client/v3/concurrency/session.go), blob `2275e96c972cc8ac8540e08bb3c05e45bdef4a4b`. Inspected `NewSession`, `WithLease`, and keepalive handling.
- License: Apache-2.0, declared in both source headers.

Observed: acquisition uses a transaction comparing absence of the session key, attaches a lease, and obtains the first-created owner. The ownership predicate compares the key's creation revision with the acquisition revision. Waiting code rechecks that its session key still exists before success. Session code permits reuse of an existing lease and maintains it through keepalive.

Adopt the generation comparison principle, translated to the existing task-local monotonic fence and exact run binding. Reject a distributed mutex service, wait queue, session reattachment or automatic keepalive as execution authority: one workspace SQLite transaction already serializes the local invariant, and this product requires distinct runtime presence and execution lease. An ended run must never resume. etcd does not supply this product's credential, project, WIP, policy or external-effect rules.

### 2. Temporal v1.28.1: current-run pointer and optimistic version checked in SQL transaction

- [execution.go](https://github.com/temporalio/temporal/blob/v1.28.1/common/persistence/sql/execution.go), blob `5ec234ac065e7e566c3f5961a97beaceb1c233d0`. Inspected `txExecuteShardLocked`, `createWorkflowExecutionTx` and `updateWorkflowExecutionTx`.
- [execution_util.go](https://github.com/temporalio/temporal/blob/v1.28.1/common/persistence/sql/execution_util.go), blob `feaae423a0c2a698714af0a18c4d4f7cd50e5700`. Inspected `assertRunIDAndUpdateCurrentExecution`, `assertCurrentExecution`, `lockAndCheckExecution` and `lockExecution`.
- [License](https://github.com/temporalio/temporal/blob/v1.28.1/LICENSE): MIT, blob `3349f76795f4409cba6ae18ea56adf9fbd8346f3`.

Observed: mutable execution updates are routed through a shard-locked transaction. A current-execution check locks and compares the previous run ID before changing the pointer. Execution mutation checks the stored record version (or legacy event condition) while holding the transaction lock and reports a condition failure rather than treating an old execution as current.

Adopt the separation between run identity, current pointer and version. Each matters independently: run existence is insufficient, and heartbeat needs its own expected run version without modifying task version. Reject importing Temporal's workflow modes, shard infrastructure or multi-step history storage layout. Its history append precedes the mutable-state transaction in the inspected entrypoint; this product instead requires domain/event/outcome atomicity within its existing single SQL transaction.

### 3. River v0.24.0: database-owned claim and separate rescue machinery

- [river_job.sql](https://github.com/riverqueue/river/blob/v0.24.0/riverdriver/riverpgxv5/internal/dbsqlc/river_job.sql), blob `503a18b12b333090f77877890da8760703fcb27c`. Inspected `JobGetAvailable`, `JobGetStuck`, `JobRescueMany` and `JobRetry`.
- [License](https://github.com/riverqueue/river/blob/v0.24.0/LICENSE): MPL-2.0, blob `2f8ed188e8baccf3ba1e11e52a79f851d6a13468`.

Observed: available-job selection locks candidates with `FOR UPDATE SKIP LOCKED`; one statement then changes state to running, increments attempt and records attempted time/worker. Stuck-job lookup and rescue are separate operations. Retry does not touch running jobs, but its retry policy can increase the maximum attempts for exhausted jobs.

Adopt database-owned state transition and the distinction between claiming and later settlement. Reject PostgreSQL locking syntax for SQLite, opportunistic expired-run stealing, automatic rescue/retry, and retry-budget expansion. They are either platform-inapplicable or contrary to this issue's conservative WIP/hold boundaries. No River code is copied, avoiding accidental MPL notice loss or unsupported translation.

## Local fit and experiment guidance

Inspected local `src/storage/transaction.ts`, `src/workspace/commands.ts` and `src/outbox/scheduler-state.ts` at predecessor HEAD `4677011e7332076827658063ca677af967b41572`. The wrapper already rejects async descriptors, samples trusted time inside SQL, rechecks configuration and maintenance generation, resolves current authority before replay, and retains event/outcome together. `markSchedulerDirty` already provides the shared durable generation marker. A separate global validator or another alarm owner would duplicate these existing mechanisms.

Use real Workers SQLite experiments to compare bounded indexed WIP probes versus full counts if cardinality warrants it. Performance has not been measured in this research. Prefer a count/probe over all active attempts, not a time-filtered count: deadline expiry denies the stale owner immediately but does not free capacity until the separate settlement owner resolves the attempt. Claim/replay/renewal tests must include two-task last-slot races, rollback after insert, lost responses, credential rotation, runtime mismatch, boundary time and restarted storage. Any benchmark must preserve these correctness predicates and disclose fixture cardinalities and query plans.

No adoption or dependency security review is claimed. These are source-pattern comparisons only; no CVE claim is made for the pinned projects. No unresolved design decision remains from this comparison. The implementation controller still must reconcile the pinned task plan, exposure gate and source schema, and complete independent plan/code review before delivery.
