# Verification strategy

Status: Design baseline · Contract revision 0.1 · Implementation pending.

This page defines the evidence needed to trust a future implementation. The current documentation package can be checked for structural consistency; it cannot demonstrate a running authorization boundary, a successful database transaction or an external agent's behavior.

## Evidence layers

| Layer | Verifies | Does not establish |
| --- | --- | --- |
| Documentation/schema checks | Local links, JSON Schema/OpenAPI validity, fixture compatibility and consistent status | Runtime correctness or standards certification |
| Domain tests | State transition guards, versions, scopes and deterministic policy decisions | Cloudflare deployment behavior |
| Storage/concurrency tests | Atomic claims, state/event/outbox consistency, restart and schema behavior | Real provider integration |
| Native API tests | Authenticated envelopes, limits, errors and client replay against the server | Every protocol adapter's parity |
| UI/accessibility tests | Command mapping, stale conflicts, keyboard flow and truthful source states | Server authorization by themselves |
| Adapter tests | Target protocol mapping and preservation of native authority/error behavior | Compatibility with every client or protocol feature |
| Operator rehearsal | Provisioning, recovery, revocation, backup/restore and rollback | A permanent SLA or unmeasured capacity |

Record the revision, environment, command, expected outcome, observed result and retained evidence for each gate. A result with an unknown environment is not reproducible evidence.

## Runtime discovery and shared boundaries

The [runner ownership matrix](../test/helpers/runtime-suites.ts) is consumed by the Node, ordinary Workers and operator Vitest configurations. Future domain paths are reservations, not passing tests. The live native conformance suite is excluded from all three; its dedicated runner belongs to the later CLI owner. Existing recovery CLI `.mjs` tests remain under Node's test runner.

Use the installed Vitest `list --json` against each configuration to collect actual tests, and require nonzero counts with no cross-runner file overlap. `--filesOnly` inventories paths; it does not prove test execution. Do not use `--passWithNoTests` or count absent future files as coverage. Explicit acceptance filenames prevent live credentials or operator bindings from leaking into ordinary source tests.

Generated native DTO aliases share the HTTP schema source; generation does not make a route available. Domain owners must extend event/cursor maps only with implemented current-resource predicates and persisted evidence. Unknown producers and unsupported cursor operations deny; task/search/history retention semantics are not inherited from message cursors. See the [shared-boundary execution record](r2-task-plans/issue-023-execution.md) for scoped local evidence and limitations.

## Core scenario matrix

| Scenario | Failure injected | Required assertion |
| --- | --- | --- |
| Concurrent claim | Two agents claim the same Ready version | One active run and fence; explicit loser conflict; no duplicated event/outbox |
| WIP contention | Two tasks compete for the last agent slot | At most one new active run under the configured limit |
| Stale owner | A replay-safe classified task lease expires; a new run claims; old run submits | Old fence denied; current result and ownership unchanged |
| Heartbeat boundary | Renewal arrives at/after expiry | Denied even before scheduler cleanup; task/proposal versions not changed by valid renewals |
| Lost mutation response | Commit succeeds, response is dropped | Same key/payload replays committed result; different payload conflicts |
| Notification duplication | Repeated alarm and receiver timeout | Persisted attempt budget; same delivery identity; no implicit task completion |
| Stale approval | Proposal/task version changes before decision | Decision rejected and fresh read required; no execution authority granted |
| Expired proposal | Deadline passes during disconnection | Waiting remains visible, approval expired, no automatic action |
| Independent review | Submitter rotates credential or runtime and accepts | Stable principal/agent exclusion still denies self-acceptance |
| Cancellation race | Cancel commits before submit or decision | Stale command fails; no active run or pending approval survives |
| Artifact partial commit | Crash after bytes but before metadata commit | No result can reference uncommitted artifact; bounded reconciliation |
| Restore mismatch | Metadata snapshot and artifact inventory differ | Missing/orphaned bytes identified; affected results not silently declared healthy |
| Profile import | Preset includes a grant or a duplicate ID | Whole change rejected; no security or partial profile mutation |
| Foreign cursor/resource | Workspace B uses IDs/cursor from A | No content, snippets, counts or mutations cross the boundary |
| External action uncertainty | Tool commits but runtime loses its response | Reconciliation/operation identity prevents blind repeated side effect |
| Expiry uncertainty | Lease expires without prior replay-safe policy | Server creates Backlog uncertainty hold; stale runtime cannot mutate old attempt |

Use an injected server clock for expiry cases. Avoid long sleeps and timing-only assertions; synchronize competitors around the actual transaction boundary. Inspect persisted state and audit/outbox together, not just HTTP statuses.

## Authorization tests

Build a table of actor kind, workspace membership/grant, scope, resource relationship and operation. Include an unauthenticated caller, expired/revoked credential, wrong workspace, inactive agent/runtime, insufficient scope, authorized human and independent reviewer. Human-only approval and credential-management operations must reject native agent credentials even when a token contains a similarly named scope.

Search must require both search permission and the underlying resource read scope. Artifact downloads, event records and cursor continuations deserve the same isolation attention as primary task routes. Browser checks include verified origin/CSRF protection and the absence of native tokens in client storage or URLs.

## Fixtures and property checks

Synthetic HTTP fixtures demonstrate shape and naming, not durable state. Task scenarios under `examples/tasks/` describe implementation acceptance sequences and are not directly sendable request bodies. Property checks should express real invariants: at most one current run; terminal attempt cannot renew; a result cannot be accepted by its submitter; an acknowledged message cannot finish a task; a failed transaction exposes no partial command outcome.

Negative schema cases should cover unknown keys, prohibited profile fields, duplicate stable IDs, unsupported revisions, bounds and invalid resource references. Some invariants require semantic validation beyond JSON Schema, such as per-ID uniqueness, workspace ownership, UTF-8 byte size and policy precedence.

## Release evidence and limits

Before a gate is promoted, run its required scenarios against the actual selected runtime and an isolated test deployment. Include one restore rehearsal, credential revocation check and a truthful UI journey for exposed features. Load testing must precede any capacity claim and should report workload, data size and environment.

The documentation validator's output must explicitly state that product tests were not run. Follow [documentation maintenance](docs-maintenance.md) for those checks and the [release checklist](release-checklist.md) for implementation gates.

## Local issue36 search evidence

`test/helpers/r2-isolation.ts` provides two independently installed mapped workspaces, real session/native proof lanes, separate agent runtime proofs, project restriction cases and a genuinely unavailable approval capability. `test/search/` covers exact literal/NFC matching, all underlying graph permissions, confidential authorized-only continuation, candidate/response/ledger budgets, maximum supported cursor bindings, retention, restart, original-proof and graph changes during crypto, and actual Workers SQL plans/rowsRead. `test/auth/native-token-lookup.test.ts` exercises legacy duplicate ambiguity and10,000 retained credentials; storage tests reconstruct original1–14 before schema15 and fault/evict it.

These tests are local source evidence, not live acceptance. Focused and full suites run serially with task-owned Workers SQL temporary storage. Recovery CLI uses its unchanged default temporary path and marker guard; absent pinned browsers remain blocked, not substituted. The [execution record](r2-task-plans/issue-036-execution.md) and [query study](research/r2-search-runtime.md) retain failure explanations and measured limitations.
