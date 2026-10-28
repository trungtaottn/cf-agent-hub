# Actual issue42 — authorized read-only task board

Status: Local source implemented and bounded verification complete; browser and live acceptance pending. No publication, aggregate-green or release claim.

Primary-source comparisons and bounded synthetic cost evidence are in [read-only board research](../research/r2-kanban-read.md).

## Scope and decisions

The corrected issue42 plan is pinned at `7465d9fa02a5163058fa6d7dfd3f9bcaffdd9713`. The isolated local predecessor is issue41 commit `277ba2ae04b9127b30fa0ce865318eb81d78b8e7`, tree `136268b7e20ad7ad98ef4f44d41bb69742f0e6f5`. This source tree has no remotes. Root owns stacked draft publication; merge, deployment and Cloud Harness remain outside this task. Integrated acceptance is deferred until after R4.

- Browser reads share canonical validation and transport, use a fixed GET-only operation allowlist, same-origin cookies, no-store and redirect-error, a 1 MiB streamed response cap and 30-second total deadline. No native credential provider or mutation path is added.
- Seven independent state-filtered pages replace rather than accumulate records; current task/run/result/event/artifact observations have independent states and bounded optional reads. Current authority changes invalidate cached content and late responses.
- `/tasks` is added to exactly the three owning auth-start/callback enum locations and shell route. Workspace scope projection exposes existing permitted task/artifact read scopes, never grants them. Preferences normalize the supported tasks/kanban alias without inventing new profile authority.
- Semantic headings/lists/links, plain dynamic text, focus restoration and wrapping implement the read-only presentation; task commands, runtime-presence reads and R3 decisions remain unavailable.

## Minimal forward schema amendment

Actual login integration exposed the existing migration2 `login_attempts.return_path` CHECK, which rejected `/tasks` despite valid HTTP input. Migration16 rebuilds only that table to add the exact path, preserving columns, existing rowid/data/defaults/nullability/constraints and expiry index. Migrations1–15 remain unchanged. Focused actual Workers evidence covers preserved rows/restart, exact allowed paths, constraint equivalence, transaction/bookkeeping rollback and frozen/non-installed upgrade denial.

The associated recovery compatibility amendment adds an explicit schema16 manifest branch and exact per-capture chunk-version binding. Actual pre16 drain/pages fixtures survive the current constructor and eviction, complete and remain readable as15; new capture IDs on15 reject. Captured build metadata is retained narrowly while environment/catalogue/bindings remain exact. The first focused combined run passed 65 tests including current16 capture; final independent review and broad verification are recorded below. Restore remains closed under issue43. No old snapshot is silently relabeled.

## Existing independent review

The first bounded UI/client review found seven Important defects involving focus, nullable artifact associations, run-event correlation, task-results404 purge, narrow wrapping, phantom loading and unknown pagination boundaries. These were corrected with source regressions and re-reviewed. Contract/fixture review additionally required a non-ambiguous event assertion and direct auth-start/callback evidence; the latter exposed the real SQLite CHECK prerequisite above. These receipts precede the new schema amendment and do not substitute for its final review.

## Verification and retained limits

Final serial verification is recorded below. Focused Node, structural renderer, actual synthetic Workers fixture and migration results remain separately attributable; they are not live acceptance. The real R2 fixture uses actual authenticated task/runtime/result/artifact commands and DO eviction rather than task DTO-shaped SQL fabrication.

The exact pinned Chromium1248 installation returned a truncated/invalid ZIP. No browser assertions or substitute engine result are claimed. Default recovery CLI temporary-path guard and fresh audit denial remain inherited non-passes; no alternate audit route or protected-fixture relocation is used. Predecessor40's blocked independent security signoff remains blocked and is not replaced by this new issue42 review. No hardware/persistent-host, deployed identity or live acceptance claim follows from local synthetic tests.

## Artifact-bearing historical continuation evidence

The shared version/identity guard is used by artifact copying even though the copy implementation itself is unchanged. A second small fixture was generated from an isolated exact predecessor41 source archive: an actually staged/uploaded/committed 55-byte synthetic artifact, advanced by original schema15 capture code to `capture_artifacts` before copying. The recorded checkpoint includes 15 SQL chunks and the exact product object. Current16 code loads the genuine15 state, survives constructor eviction, rejects a changed binding before object effects and refuses equal-length corrupt product bytes. After restoring the synthetic bytes, the same pending operation survives eviction, copies the exact generation/digest and completes with original15 metadata, valid HMAC, status and byte-identical recorded SQL chunks.

Fixture hydration preserves actual foreign keys: within the setup transaction, nullable artifact-generation links are staged until referenced rows exist, then the exact original artifact row is restored. Whole-table snapshot equality and `foreign_key_check` run before exercising the constructor. No production source, foreign-key setting, migration guard or historical SQL is weakened. An initial hydration-order failure is retained as a setup non-pass; the final focused continuation test passes. This local synthetic fixture is not deployed upgrade or recovery acceptance.

## Final serial verification

| Gate | Observed result |
|---|---|
| Full Node | 1,197 passed across 50 files |
| Full Workers | 1,638 passed across 110 files, including historical artifact-bearing continuation |
| Operator / deployment verifier | 18 / 13 passed |
| Generated / artifact bindings / TypeScript / R1 contract | Pass; all five TypeScript projects |
| UI build / isolated runtime | Pass; schema16 and empty authority closed |
| Browser | 48 collected; 1 launch failure; 47 not run; 0 browser assertions |
| Recovery CLI | 8 passed / 18 failed at unchanged protected default temporary-path guard |
| Aggregate `npm run check` | Exit 1 at recovery CLI; not aggregate-green |

The first Node aggregate retained three old schema-count assertions, one outdated unsupported16 contract probe and one unchanged 5-second journal timeout. Exact current expectations were updated; the timeout was not raised and product behavior was not loosened. Focused 110 and full 1,197 subsequently passed. The first complete Workers run retained 1,633 passes/four stale schema-count/future-version expectation failures. Corrections preserve original behavior assertions, use current16 and genuinely unsupported17, and passed 103 focused tests followed by the full 1,638 run. These initial failures and stream-cancellation diagnostics remain in the evidence.

Independent source reviews retain exact hashes across UI/client, contract/fixture, migration and frozen-capture compatibility. Their findings were repaired and relevant checks rerun; no remaining Critical/Important new issue42 source finding was established. Existing schema15 wire branches, old migration SQL and source provenance were independently compared, not merely assumed from passing tests. This does not supply the blocked predecessor40 security signoff or replace unavailable browser/live acceptance.
