# R2 authorized literal search: implementation evidence

Status: Local source/query evidence; live acceptance pending. No released capability is claimed.

This is local source evidence for [issue36](https://github.com/trungtaottn/cf-agent-hub/issues/36), not deployment, release or post-R4 acceptance. The [earlier contract comparison](r2-search-contracts/report.md) explicitly supersedes hidden-candidate pagination: only authorized matching results may establish a successful continuation. A hidden-only suffix is terminal; inability to prove a next authorized hit or exhaustion within the work budget returns generic503 with no partial data or cursor.

## Compared approaches

Before coding, primary GitHub implementations were examined:

- [Datasette keyset pagination](https://github.com/simonw/datasette/blob/a8e13cc489b41f2f9a5aa691f5eb1bedf99a0e0b/datasette/views/table.py#L2142-L2255) supplies stable tie-breakers and lookahead. Its readable markers, view OFFSET and count semantics do not meet this confidential contract.
- [sqlakeyset native tuple comparisons](https://github.com/djrobstep/sqlakeyset/blob/ad00b7497e4bf1972ffcddf8b1f0ef6cacca4155/sqlakeyset/paging.py#L49-L132) support SQLite lexicographic seeks. No ORM or new dependency is needed here.
- [Gitea relationship-aware search](https://github.com/go-gitea/gitea/blob/f35c67bd79b3bff9c28eb8171d53586cc800bd5c/models/repo/repo_list.go#L360-L562) demonstrates authorization integrated with discovery, but its lowercased LIKE/totals differ from exact literal matching and no-total requirements.
- SQLite's [instr implementation](https://github.com/sqlite/sqlite/blob/5d1ee888094efc63d1fb25a58af93478b103d441/src/func.c#L236-L310) does not normalize NFC. Filtering by substring before LIMIT can scan arbitrarily many nonmatches. The selected implementation normalizes and matches only after bounded candidate admission and current graph authorization.

The chosen implementation merges three fixed indexed streams in `(created_at,id)` order, using SQL BINARY-compatible UTF-8 comparison. Task and message workspace-order indexes are new; committed artifacts reuse their status/order index. Seven task-state streams are also valid and avoid one new index, but would require nine resource streams rather than three, more ceiling/head probes and more complex budget accounting. An indexed SQL UNION also performs well in the measured fixture; it is not rejected as inherently unsafe. The explicit three-head merge makes every prefetched candidate auditable and keeps heterogeneous projection/current-authority ownership in existing repositories.

Indexes add database space, initial build work and ongoing insertion/update maintenance. The task index is a deliberate simplicity/read-work tradeoff, not a demonstrated global throughput optimum. No schema-free workaround or added FTS/tokenizer package is used.

## Actual Workers SQL measurements

`test/search/query-work-study.test.ts` wraps the production HTTP route's real Durable Object SQL, recording EXPLAIN plans, materialized rows and cursor `rowsRead`. It does not replace SQL with mocks. All probes use synthetic local data.

| Experiment | Observed work |
| --- | --- |
| 4,096-task deep seek using global index | 1 physical row read; no temporary sort |
| Same seek with NOT INDEXED full scan/sort | 4,193 physical rows read; temporary B-tree |
| 4,096-message indexed deep seek | 1 physical row read |
| Indexed two-resource UNION merge | 2 physical rows read |
| Seven task-state heads | 7 queries / 7 physical rows read |
| Production ceiling seek | At most1 physical row per participating stream |
| Production candidate head | At most2 physical rows per call, including exclusive-boundary index step |
| 3,000 equal-timestamp task rows | Exactly2,000 admitted heads, bounded indexed seeks, generic503 |
| Mixed task/message/artifact stream with authorized hit2001 | Exactly2,000 admitted prefetched heads, generic503; no partial result |

Initial production SQL used `CASE … END AS id` to avoid materializing an oversized persisted identifier. Unqualified `ORDER BY id` bound to that expression rather than the indexed table column, introducing a temporary B-tree. The failing plan/rowsRead receipt is retained. All three streams now qualify both ORDER columns. A subsequent test assumption of at most1 physical row per head was also rejected by actual evidence: an exclusive seek can read its boundary and next row. The candidate budget was not reduced to disguise that distinction.

Whole HTTP measurements after the bounded token prerequisite:

| Hidden candidates | HTTP result | Admitted discovery rows | Total SQL rowsRead |
| --- | --- | --- | --- |
| 0 | 200, terminal | 0 | 286 |
| 128 | 200, terminal | 128 | 8,222 |
| 512 | 200, terminal | 512 | 32,030 |
| 2,000 | 200, terminal | 2,000 | 124,286 |
| 2,001 | 503, no data/cursor | 2,000 | 64,211 |

The 2,000 limit counts distinct discovery candidates, including prefetched and authorized lookahead rows. It is **not** a cap on all SQL rows, graph edges or repeat authorization. Up to three indexed ceiling probes are separate. Existing per-resource graph bounds remain authoritative. Final publication rechecks the same private admitted-candidate ledger rather than running discovery again; a ten-candidate test observes ten discovery heads, one ceiling probe and repeated current projections, not twenty admitted rows.

The isolated alternative-query microcases yielded predominantly0ms (the naive query yielded1ms in one run). Instrumented whole-HTTP elapsed samples were3/34/128/460/242ms for0/128/512/2,000/2,001 hidden candidates respectively. These single local wall-clock observations include instrumentation and are not CPU-time, throughput or production latency guarantees. RowsRead and plans establish the query-work evidence. Hidden-heavy requests can differ in status, work, timing and availability; successful continuation confidentiality is not a constant-time or global noninterference claim.

## Narrow native-token prerequisite

The actual HTTP study exposed a preexisting `workspace_id/token_sha256` lookup that materialized all matches and used the first result without ORDER. With10,000 retained credentials, a unique token read10,003 rows. No existing uniqueness constraint guaranteed unambiguous identity. Adding an index alone could change which duplicate credential won.

The owner explicitly authorized this compatibility/security amendment: migration15 adds a **nonunique** `(workspace_id,token_sha256,credential_id)` index; exact lookup fetches at most2 rows; exactly one matching row is required **before** eligibility checks. Disabled, revoked, expired, retired and old-epoch duplicates still make the secret ambiguous. No grants are unioned, no alternate eligible identity is chosen and no stored row is removed. Existing data with reused same-workspace token hashes now fails closed instead of depending on row order. Operators must use distinct secrets through the normal authorized credential lifecycle; this change does not silently rotate or repair credentials.

The check runs both at initial bearer verification and every synchronous `resolveActor` boundary, including after cursor encryption/decryption and replay. Its shared consumers include command, identity, workspace, settings, task, message/event, artifact and search routes. Existing runtime-owner authority still receives the same current-proof checks. Same hash in a different workspace does not conflict; a distinct rotated hash remains a distinct credential. Historical schema7 recovery wire/schema bytes remain frozen; the shared ambiguity-denial semantics apply there, but no new-index physical-work claim is made for schema7.

Actual Workers lookup with10,000 history rows measured2 physical rows for the unique match (including boundary work),0 for absent and2 for duplicates, using the covering index. RED demonstrated six ambiguous credential states accepted before the change and duplicate insertion during both crypto phases; GREEN rejects them. Migration tests reconstruct original1–14, preserve legacy duplicate hashes and all application rows, then verify upgrade, repeated boot, eviction, default insertion fault and SQL fault rollback.

## Publication and persistence boundaries

A private ledger and response each retain the existing1,048,576-byte ceiling. The final no-await transaction rereads original authority/fence, current graph, matching text and authorized lookahead from the same admitted IDs. A changed page fails closed rather than publishing stale data. Message-inclusive cursors alone use message-retention evidence; task/artifact-only cursors do not inherit an unrelated floor.

Cursor AAD binds workspace, stable principal, lane, exact credential/session, operation, normalized query, kind, limit, epoch and maintenance incarnation. The existing padded codec produces exactly2,048 encoded characters, with absolute3,600-second expiry. Maximum configured128-character authority identifiers and generated resource IDs fit; no arbitrary new ID cap was introduced. Legal long persisted IDs can be returned whole; an unrepresentable legacy continuation fails closed without truncation or variable-length leakage.

High-water is a fixed **tuple ceiling**, not an insertion snapshot. Inserts ordered above it are excluded, including during cursor encoding. A later backdated/lower-ID row, or an artifact committed later below that ceiling, may appear on a later page if currently visible. No stronger historical snapshot guarantee is claimed.
