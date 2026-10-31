# R2 independent result review research

Status: Local source design comparison for issue35; live acceptance pending. Researched 2026-10-27 before implementation. No remote performance or release claim.

## Primary GitHub code inspected

- [Gitea review identity and resource binding](https://github.com/go-gitea/gitea/blob/f35c67bd79b3bff9c28eb8171d53586cc800bd5c/routers/api/v1/repo/pull_review.go): `preparePullReviewType` rejects approval by the stable pull-request poster; `prepareSingleReview` binds a review to its requested pull request. This supports comparing retained stable identity rather than a token. AgentHub additionally requires a separate agent-axis comparison: a changed principal alias, credential or runtime cannot establish independence. Gitea's other review states and access exceptions were not imported.
- [Temporal activity completion](https://github.com/temporalio/temporal/blob/f7ca7c3c49318cefa10299960b2c8dd7d9d4f9cb/service/history/api/respondactivitytaskcompleted/api.go): the completion path resolves workflow/run identity, validates current mutable state and token binding, then adds completion history within its update operation. AgentHub reuses its existing synchronous workspace command boundary for the analogous run/task/result/history/outcome coupling. Temporal's force-complete branch is explicitly not adopted; this hub never reconstructs execution authority or claims external exactly-once effects.

## Compared approaches

| Approach | Decision |
| --- | --- |
| Compare credential/runtime identity at acceptance | Reject: rotation and alternate runtimes can hide the same submitter |
| Resolve only the submitter's current active account | Reject: archiving must not erase retained attribution or prevent an independent reviewer inspecting it |
| Overwrite a result on the Task row | Reject: cancellation/requeue/recovery need immutable submitted-run evidence and artifact retention |
| Cache artifact authorization at submission | Reject: current project, message-association and grant revocation must still apply during review and replay |
| Add a separate approval state machine or asynchronous review service | Reject: this is R2 result review, not R3 decisions; it would split existing atomic invariants |
| Append retained result and acceptance rows in the existing command transaction | Select: schema14 already has stable identity, exact task/run/result binding, sequence, ordered artifact associations and history |

Submission checks the exact current active run, credential, runtime proof, task version, fence and exclusive lease deadline. It enters Review and releases the execution lease, not Done. Acceptance checks the current result/version and reviewer's current grant/project/artifact graph, rejects either matching stable identity axis, and appends a distinct acceptance before Done. Replay checks current access to both current and original returned resources without reapplying old lease/state/version preconditions. A current runtime proof is still required for submit replay.

## Workers query comparison

`test/tasks/result-query-study.test.ts` invokes the actual `acceptTaskResult` domain producer against SQLite-backed Durable Object storage with zero and2,000 retained historical results. A tracing transaction counts every query's physical `rowsRead`; the complete current-result acceptance path must remain below150 reads in both fixtures. EXPLAIN must report an indexed current result lookup. A deliberately naive history-materialization query reads at least2,001 rows for the larger fixture, over ten times the actual producer's measured work ceiling. Existing unique workspace/task/result and acceptance task/version indexes suffice; no migration or credential-history scan is introduced.

The test measures local SQLite query work, not whole HTTP latency, concurrent production throughput, remote R2 bandwidth or global optimality. Historical rows are explicit SQL-shaped fixtures. Separate tests stage, upload and verify real small R2 bytes before submission; multi-megabyte limit vectors are labeled metadata fixtures rather than claimed physical uploads.

## Reviewed constraints and evidence

Independent plan review required bounding the **whole** TaskCommandResult before commit, not assuming separately bounded Task and Run imply a bounded response. Production applies the existing conservative fit guard to standalone result, embedded Task and complete command data. A700k task plus400k runtime-identifier fixture demonstrates atomic rejection even when individual projections fit. No arbitrary new identifier-size contract is invented.

Code review caught a test-helper default that still supplied a runtime token when acceptance intended to omit it. The corrected test uses an explicit absent header; actual Worker/DO human and independent-agent journeys also assert absence. This was a test-evidence correction, not weakening the production proof requirement on submission.

See [execution evidence](../r2-task-plans/issue-035-execution.md) for RED/GREEN, deterministic races, retained historical-event visibility, atomic faults, exact runtime receipts and remaining gates. Current recovery stays unavailable pending39/43. Integrated acceptance remains owner-scheduled afterR4.
