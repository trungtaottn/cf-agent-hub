# D-ID-1 and D-HISTORY: decision study, 2026-10-26

Status: Implementation and live acceptance pending; no released capability claimed.  Historical option study retained as research evidence; the selected authorized-result keyset contract supersedes the earlier filtered-continuation recommendation. Exact hidden-count leakage through empty progress pages is not accepted. See [current decision](../../adr/0008-r2-authority-and-history.md).

## Recommendation
Choose a single registry with explicit immutable operator_static/human_managed provenance; retain identities and evidence, but revoke dynamic credentials and runtime proofs on epoch advance and restore. Advance retained active agent authority epoch without creating scopes or clearing disabled/archive state. Fresh human issuance must resolve the current human grant, agent state, and operator ceiling. Preserve static ref/tombstone exactness; dynamic records must not be interpreted as missing static configuration.

Choose an additive, independently paginated immutable TaskResult history read, not expanded Task fields or audit reconstruction. Suggested contract for owner review: GET /v2/workspaces/{workspace_id}/tasks/{task_id}/results, operationId listTaskResults; closed TaskResultListResponse={data:TaskResult[],page:Page,request_id}. Existing TaskResult DTO unchanged. Reuse existing ListLimit default50, range1..200; not benchmark-derived production tuning. Use internal strictly increasing result submission sequence and (task_id,sequence) index, high-water ceiling, ascending submission order; public submitted_at is evidence, not authority or cursor ordering.

This is design advice, not acceptance, authorization, deployed behavior, or a replacement for independent contract review.

## Source evidence
Read-only source pin: cf-agent-hub PR94 HEAD `5d20de4c7ad3ab26867b938bef0582e7a07c98f4`. The issue020 plan was supplied separately from published revision `9bcd8c4736ce2f66462ff7bae16304bcfb374dc9`; it is not asserted to exist in the PR94 tree.

Source hashes (SHA256):
- src/config/bootstrap.ts f4a7684ceb5b321ed15c215546209f91f2151b184079759ffe52f42594c09dc6
- src/auth/authorize.ts a05f8089b8cb76f1478d4193e30826a94be220fa717420cbd3cc01f634865caf
- src/http/cursors.ts e6952748195dd8ce05ebea9366cfd6545e1430048d7f381b21e9040dcbe24c5f
- src/storage/migrations/0001-foundation.sql ad81e086e616ece52acaec391bffbe3cf696bc96b55839fbd9a4e95f68951d7e
- spec/openapi.json 7a4a93ec163ab291f49cf9340feb67daaa59b903c6fdce71b0e9226040475989

Observed: bootstrap applyAuthorityRows enumerates all credentials as static and requires exact ref or tombstone. authorize.resolveActor checks both credential and agent epoch against installed epoch. Events contain sanitized fixed summaries, not submitted result bodies. TaskResult exposes summary, artifact_ids, run_id, submitted_by, submitted_at. Existing message/event pagination uses lastScanned and encrypted AES-GCM binding, allowing filtered empty pages with a continuation. No implemented R2 TaskResult storage exists on examined baseline; SQL below is a proposed synthetic shape.

## Alternatives

| D-ID-1 | Correctness/security | Integrity/compatibility | Complexity/performance | Decision |
|---|---|---|---|---|
| Retain dynamic credential epoch unchanged | Old epoch fails current auth | No successful fresh issuance if agent epoch remains stale | Simple but unusable retained active agents | Reject as incomplete |
| Copy dynamic credentials into new epoch | Can reactivate pre-backup credentials revoked after backup; preserves stale grants unless separately reconciled | Availability good, revocation integrity poor | Initially cheap; trustworthy revocation/grant ledger needed for safety | Reject without independently authoritative dynamic ledger |
| Delete dynamic identities and credentials | Denies old credentials | Breaks stable attribution, archival references and reviewer independence evidence | Simpler storage, expensive semantic damage | Reject |
| Preserve identity/history; revoke dynamic credentials/proofs; current-epoch fresh issuance | Fail-closed restored authentication; no implicit authority | Static contracts preserved by provenance; intentional re-enrollment cost | One registry, existing current-epoch checks; bulk revocation cost not benchmarked | Select |
| Separate static/dynamic writable registries | Can be made correct | More alias/collision and recovery/auth joins | Two authority paths, unnecessary complexity | Reject for this scope |

Do not promise recovery of dynamic archive/disable edits made after the backup without a trustworthy newer ledger. Preserve state actually present in restored/current authoritative evidence; credential revocation still prevents old authentication. New issuance cannot bypass current disabled/archive state. Neither these model checks nor source inspection prove real restore correctness.

| D-HISTORY | Correctness/security | Compatibility/integrity | Complexity/performance | Decision |
|---|---|---|---|---|
| Current Task.result only | Loses prior visibility after requeue | No API change but fails full-history requirement | Cheapest | Reject for full-history acceptance |
| Audit-only reconstruction | Existing sanitized events cannot reconstruct full summary/artifacts | Coupling events:read to task body exposure would change audit semantics | Indexed summaries fast but not equivalent output | Retain as complementary audit only |
| Unbounded Task.history array | Can represent bodies | Changes every Task response; repeated large payloads | Read/write/replay amplification with history length | Reject |
| Offset-based standalone history | Full output possible | Additive | Deep pages scan skipped entries; shifts with deletion/filter changes | Inferior |
| Immutable standalone keyset page | Full authorized history; bounded scanning | Additive DTO/route, preserves Task contract | One result store and index; current-auth projection needed | Select |

## Reproducible experiment
Run `python study.py` (standard library only). Writes results.json including raw timings, plans, environment and model assertions. Exit0 observed twice. Synthetic, in-memory Python3.12.14/SQLite3.53.1 on Linux6.18.55 x86_64; no network, credentials, R2 or application API. Seed20261026. 100,000 results: hot task20,000 and remaining80,000 randomly distributed among10,000 task IDs; body sizes128/512/2048 summary chars, one artifact reference;400,000 summary events. Deliberately skewed stress distribution, not claimed observed production distribution.75 randomized-order warm query+fetch measurements per shape. SQL result/event indexes supplied; event index is hypothetical too.

Latest retained run:
| Query | Rows returned | median ms | p95 ms | min–max ms |
|---|---:|---:|---:|---:|
| Hot task keyset page after19000 |50|0.039743|0.433785|0.027326–0.708563|
| Same output OFFSET19000 |50|0.899115|1.379057|0.610682–2.646160|
| Full hot history |20000|24.849521|28.941213|20.138054–34.058663|
| Indexed audit summaries |50|0.029163|0.097630|0.017158–0.397311|
| Small task keyset |7|0.029104|0.102607|0.007721–0.210203|

First run (tool transcript, before raw sample persistence added) medians keyset0.083583, offset0.984578, full32.751466ms; p95 respectively0.589847/2.747745/60.595347ms. Variance is substantial; do not advertise a universal speedup or latency SLA. Both runs support bounded keyset query shape, not production performance. Query plans confirm task_id+sequence range search; OFFSET lacks lower sequence seek. Full and audit queries return different data volumes/semantics and are not equivalent performance competitors.

Model assertions: a subsequent (timestamp100,id m) inserted after initial rows (100,b),(100,z) enters timestamp+ID continuation bounded by initial high-water z; result sequence3 cannot enter ceiling2. Epoch-updating a restored enabled credential from7 to8 allows old authentication in the simplified predicate; revoke rejects it. Six active/disabled/archived × old/fresh credential combinations permit only active+fresh. These are minimal counterexamples of proposed strategies, not execution of actual app auth or restore.

## Contract/security details to freeze
- A list call requires current tasks:read and current task project/resource visibility, independent of events:read; no authority from run IDs or submitted_by. Use existing scoped non-disclosure errors for nonexistent/inaccessible task.
- Recheck current artifact visibility for every returned result. Prefer omitting an entire inaccessible result rather than fabricating a canonical TaskResult with missing artifact_ids. Preserve full result in storage. State explicitly that history is complete for currently authorized evidence, not all hidden evidence.
- Bound SQL scan per page and advance lastScanned even for hidden rows; empty data with next cursor is valid. Do not refill until unlimited visible results or expose counts of hidden results.
- Bind confidential authenticated cursor to workspace, task/query/limit/order, principal, actor lane, credential/session, operation, authority epoch/restore incarnation and expiry. A cursor is never an authority grant. Existing cursor schema needs explicit closed-operation and numeric-position extension, not merely TypeScript union change.
- Use immutable submission sequence allocation (AUTOINCREMENT or audited durable counter), no reuse on deletion, preserve counter in backup; restore must invalidate prior incarnation cursors. Timestamp is not safe as sole frozen-set marker under equal timestamp/random IDs or clock regression.
- Do not reuse message/event retention floors for result history. R2 retains results; any future truncation requires result-specific retention semantics and expired-cursor error.
- Persist immutable result, artifact associations, actor/run attribution and audit event atomically. Acceptance is independent, not an invented TaskResult field. Requeue clears current pointer, never historical rows.
- Tests: static/dynamic collision/provenance tampering; static ref/tombstone exactness; same-epoch no-op vs higher epoch; revoked pre-backup credential; fresh issue/runtime after epoch; archived/disabled remains denied; role/scope ceilings; result after requeue; multiple submissions; cross-project/task/workspace cursor; credential revocation between pages; artifact permission revoked between pages; equal timestamps/clock rollback; concurrent append excluded; filtered empty page progresses; restart/restore cursor invalidation; migration/registry roundtrip; bounded large histories.

## External primary-source rationale
SQLite documents the increasing OFFSET cost and row-value scrolling alternative: https://www.sqlite.org/rowvalue.html . Composite index selection is explained in https://www.sqlite.org/queryplanner.html . Non-reuse of automatically allocated rowids requires explicit considerations; AUTOINCREMENT adds overhead and tracks sqlite_sequence: https://www.sqlite.org/autoinc.html . Cloudflare documents private transactional strongly consistent DO storage and loss of in-memory state on eviction/restart: https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/ . These explain design rationale only, not measured Cloudflare runtime behavior. Epoch policy is this project's conservative inference, not a requirement imposed by these sources.

## Remaining validation and stopping boundary
No repository files edited, branch changes, GitHub writes, CH calls, infrastructure, credential issuance, deployments or merges. Required next evidence belongs actual implementation owners: reviewed #20 DTO/ADR/fixtures; #23 cursor/generated routing; #24 real DDL+registry+restoration counters; #25/26 auth/runtime proofs; #27 query and #35 retained result projection; actual Worker negative/concurrency/restore tests and real-source acceptance. This study ends at reproducible comparison and review-ready advice, not runtime/security acceptance.
