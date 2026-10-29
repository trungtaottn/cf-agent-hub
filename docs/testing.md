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

## Local issue37 import evidence

`test/imports/` drives real HTTP and SQLite Durable Objects with verified synthetic persisted human sessions/CSRF, not a live OIDC login or deployment. It covers immutable hashes/expiry, no-overwrite/revision-only attempts, duplicate/hidden rows, inert URLs, raw/row limits, sanitized invalid values, current full result/artifact graph rights, preview/GET/apply crypto races, SQL-trigger failures at every commit family, late ID collision, concurrent requests, eviction/restart and exact replay. `query-work.test.ts` measures actual cursor row reads/query plans with unrelated mappings; its single-statement synthetic history seed is outside measurement and does not represent10,000 HTTP imports.

`test/contracts/r2-import-events.test.ts` compares canonical/generated validators, forward/reverse import resource restrictions and a hash of every prior Event allOf clause. [Execution evidence](r2-task-plans/issue-037-execution.md) separates local source gates, independent reviews and environment failures. Formal integrated acceptance remains afterR4; no aggregate-green claim follows while recovery/browser gates are blocked.

## Local issue38 client evidence

`test/client` covers the shared browser/native transport, generated operation/schema/type correspondence, lane/proof filtering, exact context, immutable caller intent, authenticated enrollment/provenance, response validation, finite deadline, secret redaction and binary completion. The guarded subprocess test rejects infinite zero-progress producers rather than relying solely on a timer that a microtask loop could starve. Run focused tests with the existing Node runner; no new runner or dependency is introduced.

`test/runtimes/native-client.test.ts` runs the actual local Workers/SQLite/R2 routes through the facade: claim response-loss/replay, renewal/submission to Review, native messaging/current revocation, and a 1 MiB stage/upload/commit/download. Its 1 MiB/8 MiB pull-versus-eager work study measures actual chunk production and allocation, not throughput, constant memory or deployed conformance. See [measurement limits](research/r2-native-client-runtime.md) and [execution record](r2-task-plans/issue-038-execution.md). Browser launch, recovery CLI, fresh dependency audit and live acceptance remain separately reported gates, never implied by these source tests.

## Local issue40 complete-isolation evidence

`test/acceptance/r2-isolation.test.ts` compares an independently enumerated54-operation manifest with the implemented generated inventory and canonical actor lanes. It executes79 admitted cells (78 protected human/native plus public login start),28 forbidden actor cells,33 real native-facade operations and their original-credential revocation/restart repeats,24 artifact missing/aliased-binding cells, and10 disabled R3 cells. Each successful receipt follows canonical response/content and meaningful durable-effect assertions; a skipped/unexecuted phase cannot satisfy the final receipt ledger. Capability availability is not inferred from OpenAPI support flags.

The fixture uses two independently installed mapped Durable Objects, synthetic signed OIDC and actual native/runtime proofs, SQLite, product R2, and the actual shared native facade. Foreign path/embedded-resource denial, original-proof crypto/R2/signing barriers, current replay, project/credential ceilings, namespaces and closed maintenance/policy/routing states have explicit assertions. Retained focused suites supply deeper per-domain predicate coverage, mapped in the [execution record](r2-task-plans/issue-040-execution.md). Actual operator-gateway tests remain in their separate runner; a product-route404 is not operator authentication evidence.

Three deterministic publication regressions drove a narrowly authorized wrapper repair: no unrelated alarm await may follow a final protected response projection. Startup repair, durable dirty debt, task/message/artifact background repair and catalog/restart sweep remain. Failed-arm debt/restart/retry and the unchanged R1/outbox suites are separate evidence. Graceful fixture eviction is not process-crash or remote-effect-drain proof. The [local study](research/r2-isolation-runtime.md) records the signed-login timer issue without relaxing assertion timeouts.

Final independent security signoff is blocked/unavailable: the reviewer turn was flagged and was not retried or rerouted. Ordinary contract review and reproduced RED→GREEN results do not replace that signoff. Recovery CLI, browser launch, fresh audit and deferred live acceptance remain separately reported gates; this is not aggregate-green acceptance.


## Local issue41 persistence evidence

The existing Node runner collects `test/cli/journal-recovery.test.ts`, `secret-store.test.ts` and coordinator/integration tests. They use synthetic credentials and task-owned private sibling directories, not real user stores or changed recovery fixtures. Real child-process SIGKILL/reopen, competing writers, SQLiteFULL and schema/path corruption are distinguished from injected fsync/policy branches. The timestamp/clock tests include a real competing lock wait; final native-clock tests check ordering after provider access. Canonical server GC is invoked explicitly in the integration fixture, never claimed to be scheduled in production.

New native tests cover protected finalization, runtime-path mismatch, once-only actual-lease proof access, late-capture cleanup and invalid asynchronous-hook rejection without unhandled secret-bearing errors. Process-kill tests do not establish host reboot, container replacement, actual suspend or hardware power-loss durability. Actual-host storage is overlayfs; persistent backing and ext-family/XFS behavior remain separately qualified in [ADR0009](adr/0009-r2-cli-local-durability.md). See [exact results and non-passes](r2-task-plans/issue-041-execution.md).

## CI fixture corrections (2026-10-29)

The issue42 browser run reached 46 passing cases and two failures: `route.fetch()` uses the Node API-request transport, not Chromium's ephemeral SPKI allowlist. The two task/results interceptors now use a test-only HTTPS reader with the fixture's public leaf certificate, exact readiness SPKI, normal hostname verification and `rejectUnauthorized:true`. It connects only to the captured loopback port for the exact synthetic app origin, forwards only relevant JSON GET headers, rejects redirects/cookie updates/encoded responses and bounds response bytes to 2 MiB. No private key or credential is exported in readiness captures. Global TLS validation and browser `ignoreHTTPSErrors:false` remain unchanged. Its 10-second socket timeout is an inactivity bound; the outer Playwright test timeout remains the overall execution bound. The helper is not a general transport.

The journal unresolved-count test intermittently spent over six seconds creating 1,000 individually durable setup entries; rejection and pruning themselves took about 21 ms in the measured failing run. It now seeds 999 valid checksummed entries in one protected fixture transaction, exercises the real 1,000th admission and 1,001st denial, reopens and compares all 1,000 rows exactly. Production SQLite durability, count/byte limits and test timeouts are unchanged. This localizes setup amplification, not a proven hardware/fsync or CI-contention cause.

Local evidence: the TLS reader's positive and negative cases were run RED→GREEN; the clean journal and reader focused suites and TypeScript check were executed separately from remote CI. Browser acceptance remains dependent on the new exact-head CI run; no local browser restriction was bypassed. These fixture repairs do not clear issue40 independent security signoff, dependency audit, protected recovery rehearsal or after-R4 live acceptance.

Issue45's two ready-command interception cases use a separate POST fixture adapter with the same leaf/hostname/SPKI checks. It admits only the synthetic workspace task `:ready` path, requires the captured cookie, exact origin, JSON content type, CSRF and idempotency headers, and forwards the original request bytes (maximum64KiB) unchanged once. The loss case waits for the real committed response before aborting delivery; the wrong-binding case mutates only the captured response. It does not construct commands, retry requests, follow redirects or weaken TLS. All remaining `route.fetch()` sites across issues42–46 were audited and these were the only two beyond the repaired GET cases. Node positive/negative fixture tests are separate from remote browser execution.
