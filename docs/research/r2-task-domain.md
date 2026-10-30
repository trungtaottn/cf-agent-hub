# Issue 27 implementation research

Status: Source research complete; implementation verification and live acceptance pending. No released capability.

Observed 2026-10-27 UTC. Read-only research; no runtime implementation, dependencies, remote changes, or benchmark pass is claimed. Installed `ak-research` and `ak-docs-seeker` instructions were read. Web search located primary GitHub sources; connected GitHub reads resolved immutable commits and inspected implementation and licenses. Local source inspected at predecessor 393ad95e2fe1756ae96ff741eec4765bab8f5260.

## Decision

Retain the existing synchronous WorkspaceTransaction and command wrapper. Implement private, bounded, indexed candidate retrieval followed by the one current coherent-grant visibility predicate. Never use LIMIT as a work bound when SQL also filters inaccessible candidates. Prove the bounded candidate queries on installed Workers SQLite before choosing numeric production budgets. If bounded private work cannot establish an authorized lookahead or exhaustion, fail the entire request with generic 503, no partial items and no cursor. This supports the ADR's explicit resource-failure exception without introducing hidden-progress continuation.

No inspected project is a drop-in implementation of this repository's strict confidential pagination, current authority, outcome/event transaction, epoch/incarnation and whole-result artifact visibility requirements. Reuse concepts, not unreviewed code or a second policy engine.

## Pinned source comparison

### Datasette: compound seeks and explicit query interruption

Pin: `a8e13cc489b41f2f9a5aa691f5eb1bedf99a0e0b`.

- [utils implementation](https://github.com/simonw/datasette/blob/a8e13cc489b41f2f9a5aa691f5eb1bedf99a0e0b/datasette/utils/__init__.py): `compound_keys_after_sql` constructs lexicographic comparisons; `sqlite_timelimit` calls Python sqlite3 `set_progress_handler`, with VM-instruction polling and cleanup.
- [table query implementation](https://github.com/simonw/datasette/blob/a8e13cc489b41f2f9a5aa691f5eb1bedf99a0e0b/datasette/views/table.py): queries page size plus one, then `_next_value_and_url` positions continuation at the last returned row, not the extra lookahead. Some views use offsets instead. Its write projection separately verifies view permission before returning inserted rows.
- [database transaction implementation](https://github.com/simonw/datasette/blob/a8e13cc489b41f2f9a5aa691f5eb1bedf99a0e0b/datasette/database.py): write functions use a serialized write connection and transactional callback, including BEGIN IMMEDIATE. Post-write event tracking does not by itself supply this repo's atomic durable event/outcome invariant.

Fit: deterministic compound order and lookahead are useful. Rejection: opaque-looking URL tokens are not encrypted/padded actor-bound cursors; page-size output limits do not bound rejected work; Python's progress handler cannot be transplanted into Workers. Do not copy the offset fallback or start a separate writer/queue.

### Cloudflare workerd: actual installed storage API

Local lock pins workerd `1.20261019.1`; tag resolves to `781048bc05cb205c92e503c1062ef3266ab959b5`.

- [installed API declaration](https://github.com/cloudflare/workerd/blob/781048bc05cb205c92e503c1062ef3266ab959b5/src/workerd/api/sql.h): public SqlStorage exposes exec and databaseSize; cursor exposes iteration/toArray/one/raw and rowsRead/rowsWritten. No public progress callback, interruption or cancel method is exposed. Experimental prepared statements are not an authorization to use unsupported APIs.
- [installed API implementation](https://github.com/cloudflare/workerd/blob/781048bc05cb205c92e503c1062ef3266ab959b5/src/workerd/api/sql.c%2B%2B): row iteration proactively steps to the next result, so one JS next call can do additional SQL work. Counters describe work already performed. Their existence is not a preemptive cap.
- Current upstream `a9ffb25f465144b777de75b91fecc2398af95726` was also inspected and has the same relevant public API limitation, but installed-version evidence is the applicable baseline.
- [official API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) documents synchronous consumption, rows-read accounting, and transactionSync rather than SQL BEGIN/SAVEPOINT. Runtime exceptions from unlimited filtered scans cannot substitute for a designed physical-work bound.

Fit: instrument real locked Workers with rowsRead and query plans. Rejection: no invented `interrupt()`, SQL progress handler, async streaming cursor, or telemetry-as-prevention claim.

### PocketBase: scoped transaction handles and record access checks

Pin: `7f2773ec234b62d0b80ca47c508397cb3d0da3ea`.

- [transaction wrapper](https://github.com/pocketbase/pocketbase/blob/7f2773ec234b62d0b80ca47c508397cb3d0da3ea/core/db_tx.go): nested calls reuse the transaction app; callback receives the transactional handle; completion callbacks run after commit/rollback.
- [record query/access implementation](https://github.com/pocketbase/pocketbase/blob/7f2773ec234b62d0b80ca47c508397cb3d0da3ea/core/record_query.go): `CanAccessRecord` binds record ID before applying access rule, denies malformed rules/query errors, and distinguishes nil from empty rules. `FindRecordsByFilter` is a lower-level filter/sort/offset/limit helper, not a request authorization function.

Fit: a scoped transaction capability and explicit per-record access predicate reinforce the existing repo architecture. Rejection: its nil/empty semantics, superuser shortcut, dynamic rule compiler, offsets and optional unlimited query are not this repo's grant semantics. Do not mint substitute actors, translate role labels into grants, or treat a low-level repository filter as authorization. Keep task metadata, event and replay outcome in the same existing transaction, not after-commit hooks.

### pg-boss: captured job policy and atomic admission

Pin: `c8ce91da5c811f26ac22e3cdeb780f891c20d50f`.

- [SQL plans](https://github.com/timgit/pg-boss/blob/c8ce91da5c811f26ac22e3cdeb780f891c20d50f/src/plans.ts): `insertJobs` explicitly lists insert columns, assigns server time, reads queue policy into the new job and captures retry limit/delay. It conditionally exposes internal singleton-slot input only on a trusted path rather than accidentally making an unvalidated internal column public. Unique partial indexes enforce queue/state policies. `notifyQueue` can be committed with admission rather than performing a precommit external send.
- [manager](https://github.com/timgit/pg-boss/blob/c8ce91da5c811f26ac22e3cdeb780f891c20d50f/src/manager.ts): transaction capability checks and timeout support are explicit per backend. PostgreSQL transaction timeout GUCs are not portable Workers SQLite controls.

Fit: closed insert columns, server-assigned state/time, policy capture at admission and atomic state constraints support this task's fixed retry snapshot. Rejection: pg-boss accepts caller retry overrides and falls back to queue/default retry values (default two); this repo must instead reject authority fields and missing/conflicting installed execution policy. It is a trusted application job queue, not a workspace authorization system; its queue policy is not a substitute for exact project/work-role/agent tuples or current coherent grants. Do not import its scheduler, workers, SQL dialect, generated UUID-in-SQL, defaults or retry semantics. Ready is not execution and must not claim/notify an external worker as a side effect here. No code copied. Its inspected LICENSE is MIT, copyright Tim Jones; preserve notice if substantial code is later reused.

## Query alternatives and necessary experiments

1. **SQL authorization predicate plus LIMIT.** Attractive compact query and fewer returned records, but hidden-only rows can force unbounded scanning and joins before first output. Reject as sole bound. Benchmark as the intentionally unsafe comparison, including empty authorized output.
2. **Bounded unfiltered indexed seek then in-transaction authorization.** Preferred candidate. SQL retrieves only physical rows in an indexed ordering interval; JS authorizes at most the configured private candidate budget and bounded associations per result. Repeat only while budget remains. Response cursor always uses last returned authorized row, and has_more needs fully authorized lookahead. Exhaustion must be positively established; budget exhaustion is not exhaustion.
3. **Materialized per-principal visibility index.** Could make authorized enumeration cheaper but becomes an additional authority/cache needing atomic invalidation for every grant, catalog, result and artifact change. Reject scope/complexity for #27.
4. **Per-project or per-state index streams.** Existing schema8 has tasks_state_order(workspace_id,state,created_at,id), not workspace/created_at/id. A globally sorted no-state query may scan and sort everything. A bounded merge of the seven fixed canonical state streams can use existing indexes without rewriting migration8; each stream must use fixed equality on workspace/state and a tuple seek, with bounded retrieval, then merge by created_at/id. Project filtering must happen after physical candidate bounding unless an appropriate proven index is supplied by schema owner. Alternative is an explicitly reviewed forward index migration, not silent mutation of migration8. Neither alternative is yet measured.

History has results_task_order(workspace_id,task_id,submission_sequence), suitable for candidate seeks at fixed task. Authorization needs bounded artifact association queries too: a `LIMIT 6` guard against violating the canonical five-association invariant must itself use a scoped index with no hidden selective predicate before the physical cap. Inspect the exact association indexes and all current-grant lookups before claiming end-to-end bounds.

### Benchmark matrix (required, not run by research)

Use actual locked Vitest Workers SQLite. Record SQL text, bindings, EXPLAIN QUERY PLAN output, cursor rowsRead after complete bounded consumption, output count, candidate/auth-query counts, and elapsed time (diagnostic, not correctness criterion). Compare data sizes at least an order of magnitude apart, shallow/deep last-returned positions, tied timestamps, seven-state distributions, absent/present project filters, hidden-only prefix/suffix, alternating visibility, sparse visible results and limit1/50/200. Cover first-page high-water acquisition as well as next-page query: an unbounded MAX or sort invalidates an otherwise bounded scan. Use fixed-state descending LIMIT1 candidates for a seven-stream task high-water if plans prove it.

Measure output LIMIT with SQL visibility predicate versus physical candidate LIMIT before authorization. Do not select a production candidate/auth-work budget from this proposal: choose supported bounds from actual measured query shapes, operation counts, maximum association/DTO sizes and negative-case proof. Timeouts do not prove a row cap. Check padded cursor bounds, byte-envelope overflow and authorized lookahead after byte-limited pages independently.

## Licensing and provenance

Datasette and workerd LICENSE files were inspected: Apache-2.0. PocketBase LICENSE.md was inspected: MIT, copyright Gani Georgiev. This report recommends independent implementation of general patterns, and copies no source code. Any later copying requires retaining applicable copyright/license/NOTICE and modification notices; do not assume MIT in the destination removes Apache obligations. No package addition is recommended.

## Open evidence

Actual Workers measurements, numeric budget selection, all authorization-query plan bounds, final whole-result fit, and independent plan validation/red-team remain implementation gates. Existing R1 cursor/message pagination is not evidence of the stricter #20 history contract: local cursors.ts currently has no task-results operation, no epoch/incarnation binding, and no padding; existing message continuation tracks scanned IDs. Extend only the new owned contract rather than citing that legacy behavior as acceptance.

## Platform bound interpretation — checked 2026-10-27

The official [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) list a default 30-second CPU ceiling, 2 MB maximum SQL string/row size, 100 KB SQL statement size and 100 bound parameters. The [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) discusses the isolate's 128 MB memory limit. These are platform ceilings, not application budgets or a throughput promise; D1 HTTP query-count limits are not substituted for embedded DO SQL.

Local query timings are wall-clock diagnostics, not production CPU receipts. The implementation uses a stricter 1 MiB serialized response cap, bounded physical rows, bounded five-reference joins, numeric-only history buffers and seven single-row task heads. Two observation passes around cursor crypto can roughly double query work. Large supported strings, maximum operator config, concurrent requests and billing/throughput still require post-R4 deployed evaluation. No platform limits were raised, and no live target was provisioned.

A final comparison replaces per-artifact point statements with one indexed five-row association join and projected authorization booleans per result. This preserves outer row bounds and current grant/provenance checks while substantially reducing statement overhead. Exact raw counters, query plans and comparison receipts are retained by the issue27 execution ledger; they establish local source behavior, not deployed acceptance.
