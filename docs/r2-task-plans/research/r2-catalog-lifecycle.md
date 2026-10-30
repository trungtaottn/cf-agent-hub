# Issue 28 catalog lifecycle research

Status: Research and local experiments; publication and live acceptance pending.

Observed 2026-10-27 UTC, before implementation. Scope: immutable catalog previews, optimistic concurrency, full affected-set checks, atomic local remaps. No external service, repository write, copied upstream implementation or dependency change was performed.

## Decision

Use the existing workspace command transaction with a persisted immutable preview. Bind the current profile revision, exact affected IDs and versions, request predicate and trusted expiry. At apply, resolve current authority and rebuild the complete affected set in the same synchronous SQL transaction that performs every mutation, event and replay-outcome write. Reject any mismatch and require a newly reviewed preview; do not automatically rebase or partially apply.

This is a hybrid of saved-plan staleness rejection and per-resource optimistic preconditions, strengthened with exact set equality to catch newly introduced references. No long-lived lock is needed during the 15-minute human review window. The preview is evidence, not authority.

## Actual upstream source inspected

1. [OpenTofu saved-plan loading and stale-state validation](https://github.com/opentofu/opentofu/blob/df9a697c1aebcb78d7403f6963eeaa173e9a2cfc/internal/backend/local/backend_local.go#L356-L406). The fetched file is MPL-2.0. Its saved-plan path reads the captured prior state, checks lineage and serial against current metadata, and rejects a changed state. Relevant analogy: wrong workspace/authority context must not be accepted merely because a numeric revision matches; stale review evidence must be rejected rather than silently recomputed.
2. [Kubernetes storage preconditions](https://github.com/kubernetes/kubernetes/blob/dd410c4864ad52093ab74be9f7aa39a8cbc4dc06/staging/src/k8s.io/apiserver/pkg/storage/interfaces.go#L129-L173). The fetched Apache-2.0 source checks both stable UID and resource version. [Its etcd update implementation](https://github.com/kubernetes/kubernetes/blob/dd410c4864ad52093ab74be9f7aa39a8cbc4dc06/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go#L498-L620) rechecks preconditions against current state and uses a revision-conditional write. Relevant analogy: check actual live rows, not cached objects, at the write boundary. Do not adopt its automatic update retry as permission to alter a human-reviewed catalog plan.
3. [Terraform comparison source](https://github.com/hashicorp/terraform/blob/55988303ba5651e41e2c9097e208468c8eb3da4b/internal/backend/local/backend_local.go). The same lineage/serial pattern was inspected in the current source, but the fetched header is BUSL-1.1, not an open-source license. Therefore OpenTofu and Kubernetes, not contemporary Terraform, satisfy the user's open-source comparison requirement. No source code was copied from any project.
4. [Current Cloudflare SQLite Durable Object storage documentation](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactions). Checked 2026-10-27; page metadata says updated 2026-09-21. `transactionSync` rolls back on exception and requires a synchronous callback. SQL cursors must be consumed before an await. This supports the repository's existing guarded `withTransaction`, rather than an ad hoc SQL BEGIN or asynchronous transaction body.

Web searches located these projects and primary-source paths; GitHub read tools resolved current branch commits and fetched the pinned files above. Findings describe the inspected revisions, not an unverified claim about all versions.

## Approaches and tradeoffs

| Approach | Strength | Failure or cost | Fit |
| --- | --- | --- | --- |
| One global workspace revision | Simple staleness test; captures all changes if every writer increments it | Unrelated messages or tasks invalidate previews; requires every writer to participate; not the existing contract | Reject as primary protocol |
| Profile revision only | Existing revision boundary; cheap | Task/agent edits and newly added references can occur without profile change | Insufficient |
| Captured per-row version checks only | Precise for known resources; low false conflicts | Misses a newly inserted or newly matching reference not listed in preview | Insufficient |
| Long-lived lock across preview/apply | Prevents changes to reference graph | Human review blocks work, adds expiry/recovery state and stalls ordinary edits | Reject |
| Exact affected-set equality plus versions and profile revision inside transaction | Detects changed, removed and new references; preserves reviewed intent; atomic rollback | Must prove query completeness and bound work; row/version capture needs deterministic encoding | Recommended |

The catalog contract is local SQL only, unlike a provider-driven infrastructure apply. Do not inherit any expectation of partial or remote-effect reconciliation from infrastructure tools. All authorized eligible task/agent metadata, profile state, plan status, audit and outcome must roll back together.

## Repository integration observations

- Existing `src/storage/transaction.ts` consumes each cursor with `toArray`, rejects thenables and invalidates escaped transaction references. Reuse it without weakening these guards.
- Schema8 already supplies `catalog_plans` with workspace/principal/profile revision, expiry, immutable plan JSON, touched-version JSON and status. No new preview storage architecture is needed.
- Schema8 has `tasks_state_order(workspace_id,state,created_at,id)` but no project/work-role reference index. Agent role IDs are JSON. A filtered `LIMIT 201` bounds rows returned, not rows scanned. Either use a bounded indexed scan with explicit fail-closed exhaustion, or coordinate a forward index migration with the schema owner. Never modify migration8 in place or claim a result limit proves bounded query work.
- Use one deterministic complete predicate for both capture and revalidation, including terminal references that must remain unchanged and live/approved references that block remap. Separately determine which eligible records are mutated; these are not necessarily the full reference set.
- Successful replay must check current access to the captured result/references without rerunning stale first-execution profile/version preconditions. Authorization comes before resource-detail conflicts so hidden references are not revealed by error shape or counts.
- Policy rewrites remain forbidden. A profile catalog operation must not edit operator-authored policy tuples or confer new grants.

## Experiments to run before selecting the final implementation

These are proposed tests, not observed passes:

1. Compare captured-row-only versus full-set validation in actual Workers SQLite using an inserted reference after preview. The former must demonstrate the phantom gap; the latter must reject with no writes/events/outcomes.
2. Inspect query plans and instrument query count/materialized row count for 0, 1, 200, 201 references, many unrelated tasks, and JSON role membership. Establish a hard work bound and fail-closed behavior when completeness cannot be proven. Record actual durations as local measurements, not production throughput claims.
3. Force a transaction exception after the first eligible row update; verify exact equality of profile, tasks, agents, plan status, events and replay-outcome counts before/after.
4. Interleave two applies, same-key replay and different-key apply, including changed authorization. Require one winner and no second mutation.
5. Restart before apply, then test exact expiry (`now == expires_at`), changed profile, changed task/agent, added/removed reference, inaccessible resource and policy configuration changes. Check no hidden-resource oracle and no silent subset/rebase.

## Unresolved implementation decisions

The exact bounded reference-query strategy requires the controller's source/test experiment. Current upstream patterns do not justify changing the contract, bypassing current authority, adding a global validator, or exposing future claim endpoints.

## Actual Workers SQLite experiment — 2026-10-27

Implemented research-only `test/config/catalog-query-study.test.ts`. Both 1,000-row and 10,000-row cases passed using actual `runInDurableObject` SQL, schema 8, fixture-installed workspace, and `PRAGMA foreign_key_check`. Tasks were Backlog; matching rows were at the tail of the ID order. Each size tested zero, one and 201 project/work-role references. Agents used one JSON role per study agent; the identity fixture supplied one additional agent. No authorization behavior is claimed by this storage experiment.

Command: `source /tmp/r2-028-local/env.sh; npm run test:workers -- test/config/catalog-query-study.test.ts --silent=false --reporter=verbose`.

Environment: Node24.22.1, npm11.19.1, Vitest4.1.12, existing locked Workers integration. Exit0, 1 file/2 tests passed; 3.84 seconds overall. Default-output run also passed 2 tests but suppressed measurement logs. The first invocation before discovery registration exited1 with no tests collected; preserved as `logs/catalog-query-study-not-collected.log`, not counted as a pass. The controller corrected runtime suite discovery, not this study's assertions.

Evidence: `/tmp/r2-028-local/logs/catalog-query-study.log`; parsed raw measurements including actual EXPLAIN QUERY PLAN output: `/tmp/r2-028-local/catalog-query-study.json`.

| Query at 10,000 study rows | 0 references: rowsRead | 1 reference: rowsRead | 201 references: rowsRead | Completeness |
| --- | ---: | ---: | ---: | --- |
| Baseline task project filter, LIMIT201 | 10,000 | 10,000 | 10,000 | Complete at these cardinalities, but unbounded work |
| Baseline task work-role filter, LIMIT201 | 10,000 | 10,000 | 10,000 | Same |
| Experimental `(workspace_id,project_id,id)` index | 0 | 2 | 201 | Bounded by matching rows, overflow probe feasible |
| Experimental `(workspace_id,work_role_id,id)` index | 0 | 2 | 201 | Same |
| Indexed task-state physical cap1001 | 1,001 | 1,001 | 1,001 | Incomplete; cannot apply even zero/one-reference requests |
| Agent JSON membership filter, LIMIT201 | 20,001 | 20,000 | 19,800 | Complete here, but unbounded work |
| Agent identity physical cap1001 | 1,001 | 1,001 | 1,001 | Incomplete; must fail closed |

At 1,000 tasks baseline filters read1,000, narrow indexes read 0 / 2 / 201, and physical scan reads1,000. Agent JSON filters read2,001/2,000/1,800, while physical cap reads1,001 including fixture agent. Actual plans select the workspace-identity index for baseline filters, `tasks_state_order` for capped task scan, and the new narrow reference indexes for experimental task filters. Agent filtering additionally scans `json_each` per candidate.

Each experimental task index construction at10,000 rows read20,237 and wrote10,001; measured local durations were3ms and4ms. At1,000, each read2,023 and wrote1,001. These costs are one-time migration work, while ordinary later task writes would maintain the added indexes. Query timings ranged0–2ms at the exposed timer resolution; they are not reliable production latency comparisons. RowsRead and query-plan differences are the primary evidence. Experimental DDL exists only inside disposable tests; no migration was modified.

**Revised recommendation:** Coordinate a forward migration with the schema owner for the two narrow task-reference indexes. Their clear selectivity avoids rejecting valid catalog operations solely because unrelated task history grows. Capped scanning is safe only as a deliberately documented availability limit, not a generally equivalent design. For JSON agent roles, a scalar B-tree cannot index arbitrary membership; either coordinate an indexed normalized role projection maintained by every canonical agent writer, or document and test a physical-agent scan cap as a remaining availability compromise. Do not implement a naive full JSON filter and call it bounded.
