# Runtime enrollment and proof design study

Status: Local engineering comparison for issue26; production performance and acceptance pending.

## Compared approaches

| Choice | Result | Reason |
| --- | --- | --- |
| Put runtime ID into ActorContext | Rejected | ID is not proof; would relax the current `refreshActor` rejection and create cached authority. |
| Validate proof only in asynchronous middleware | Rejected | Revocation/expiry or maintenance close-and-reopen can occur after hashing; a preflight result cannot authorize a later transaction. |
| Separate synchronous runtime proof predicate | Selected | Current credential/agent/workspace/epoch and deadline are checked within the consuming transaction, with no new registry. |
| Return raw proof in normal command outcome | Rejected | The existing wrapper persists outcomes and returns them on replay. |
| Reuse first-response-only closure | Selected | Established credential issuance channel persists only sanitized output and reveals only after first successful transaction. |
| Reuse presence as task lease | Rejected | Runtime liveness cannot confer ownership; fresh runtime has no inherited run, and heartbeat touches no task/run rows. |

## Evidence and experiments

The pinned existing Workers SQLite synchronous transaction wrapper is retained. No external library/API behavior is newly assumed, no dependencies change and no alternative storage backend is introduced. Source inspection established that idempotency is keyed by agent principal, not individual credential: enrollment replay therefore loads and checks the original runtime's exact credential. The admission snapshot must precede proof hashing; a generation-only close/reopen experiment tests the otherwise invisible race.

Actual local Workers tests exercise duplicate enrollment, initial-only reveal, SQL rollback, proof/credential transplant rejection, expiry at deadline minus one/deadline/plus one millisecond, version conflict versus valid replay, hash-await revocation/epoch/maintenance races, real Durable Object eviction and retained metadata. Seeded active run/task bytes are compared before and after enrollment/heartbeat. These deterministic security experiments are more relevant than microbenchmarking a rejected insecure shortcut. They are not product throughput benchmarks. Exact commands/counts and failures belong to the [execution ledger](../r2-task-plans/issue-026-execution.md).

Restored schema8 authority, real network credentials, live deployment and task lease ownership acceptance remain outside this issue. Historical schema7 recovery passes cannot substitute for #39/#43.

## Delegation integration experiment and correction

A canonical-valid configuration experiment exposed that all four native-only scopes were absent from the human executable enum but demanded by the dynamic issuance subset check. The impossible SQL-grant fixture was not accepted as end-to-end evidence. Independent comparison selected a separate optional exact `delegable_native_scopes` ceiling in the existing installed config JSON, avoiding both new persistence and conflation of human executable authority. Explicit empty denies, omission preserves the legacy intersection, and field removal can restore that fallback. No implicit default or example grant is added.

Actual schema TDD first collected 10 tests with 1 meaningful rejection failure and 9 invalid-input passes, then passed 10 after the schema/generated-validator change. Workers integration first exposed delegated issuance denial and incorrect explicit-empty behavior; after all shared consumers were corrected, actual canonical installation, verified test login, issuance/list/replay, native enrollment/heartbeat and multi-epoch narrowing/regrant succeeded. Current identity/config mismatches and all six authorization/visibility consumer paths have separate tests. These are local source experiments, not live credentials or recovery acceptance.
