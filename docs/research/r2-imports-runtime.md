# R2 issue37 — reviewed import design and Workers query study

Status: local source evidence; baseline acceptance pending. No deployment, release, capacity or current-recovery claim. Research inspected2026-10-27; existing schema15 and pinned dependencies are unchanged.

## Primary comparisons before implementation

- [OpenTofu saved-plan execution](https://github.com/opentofu/opentofu/blob/main/internal/backend/local/backend_local.go) and [plan documentation](https://github.com/opentofu/opentofu/blob/main/website/docs/cli/commands/plan.mdx): preserve a reviewed plan and reject changed underlying state. Adopt immutable expected-state comparison, not infrastructure execution or remote-effect atomicity.
- [django-import-export resources](https://github.com/django-import-export/django-import-export/blob/main/import_export/resources.py) and [admin confirmation](https://github.com/django-import-export/django-import-export/blob/main/import_export/admin.py): useful dry-run/transaction rollback patterns, but update-oriented hooks and configurable skipping do not implement this create-only immutable source contract. Do not copy an upsert/overwrite path.
- [Git update-ref expected-old-value/absence](https://github.com/git/git/blob/master/Documentation/git-update-ref.adoc): compare both present identity and expected absence. A newly created mapping invalidates another reviewed absent snapshot. Do not adopt optional partial-write success: explicit import partial acceptance selects reviewed rows, never permits a partial commit after failure.
- [Cloudflare synchronous SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/): use existing thenable-rejecting transaction wrapper. Crypto/entropy are prepared outside SQL, original proof/fence and exact snapshots rechecked inside; thrown late failures roll back all task/map/report/event/outcome effects.

These moving upstream refs are discovery sources, not pinned dependencies, copied code or measured performance evidence. The selected implementation reuses this repository's command wrapper, task creation, current visibility and existing scoped mapping key.

## What was measured

`test/imports/query-work.test.ts` runs actual HTTP preview plus unchanged apply through the production import route on SQLite Workers, with100 requested mappings and either0 or10,000 unrelated same-workspace/namespace keys. Requested tasks/maps were created via actual import HTTP. Unrelated history is synthetic, inserted with one recursive SQL statement outside measurement; it is not10,000 completed HTTP imports.

A transaction/SQL proxy records actual cursor `rowsRead`, `rowsWritten`, statement counts and `EXPLAIN QUERY PLAN`. It does not mock returned domain rows. Every production mapping query is a scoped primary-key point seek. A lookup-only bounded set probe and a deliberately rejected whole-workspace materialization probe compare discovery work, not equivalent complete authorization/apply pipelines.

| Observation | 0 unrelated | 10,000 unrelated |
| --- | ---: | ---: |
| Preview + unchanged apply total SQL rows read | 42,238 | 42,238 |
| Total SQL statements | 18,988 | 18,988 |
| Mapping byte-preflight seeks | 900 calls/900 reads | 900 calls/900 reads |
| Mapping full-row seeks | 900 calls/900 reads | 900 calls/900 reads |
| Maximum physical reads per mapping seek | 1 | 1 |
| Bounded set probe,100 keys in98-key chunks | 200 reads/2 statements | 200 reads/2 statements |
| Rejected workspace materialization | 100 reads/100 rows | 10,100 reads/10,100 rows |

All point/set plans use `sqlite_autoindex_import_mappings_1` with workspace+namespace+external-ID constraints; the materialization uses only the workspace prefix. Assertions retain a conservative point-read bound of2, while these fixtures observed1. Total work includes repeated original-proof/current policy/reference/Task-result checks, report-origin validation and command/audit boundaries; it is emphatically **not**100 SQL rows or100 queries. No rows are updated by the lookup probes. The complete apply still persists its own new report/event/outcome.

The bounded-set probe is a possible future optimization, not a drop-in replacement: it must retain scalar preflight bounds, exact absence snapshots, duplicate/privacy ordering and all current visibility checks. Indexed point reads are selected now for simpler proven semantics and batch-bounded discovery without new indexes or dependencies. No production latency optimum is claimed. The two observed local end-to-end intervals (260/352ms) include instrumentation and alternative probes, lack repeated statistical sampling, and do not establish median/p95, throughput, constant-time behavior or a global CPU/heap bound.

## Retained failures and decision limits

The first set probe used100 IDs plus2 scope bindings and hit Workers' SQL variable limit. The corrected probe uses98 IDs plus2 scopes; no runtime limit was raised. The first large-history test spent over5 seconds inserting10,000 rows one at a time and failed the unchanged test timeout. Replacing only equivalent fixture seeding with one recursive statement kept the same10,000 rows/assertions and completed both test cases in under a second each in the recorded run. No timeout weakening or smaller workload was used.

Passing-console output was not visible in the default reporter; the final retained study uses `--reporter=verbose --disableConsoleIntercept`, yielding both complete JSON receipts. Earlier failed runs are retained separately. Source receipt/manifest names live in the local handoff; the [execution record](../r2-task-plans/issue-037-execution.md) describes the wider verification scope and limits.
