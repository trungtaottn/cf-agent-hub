# Genuine schema18 capture report

Status: Local synthetic source-test evidence; no release, deployment or end-to-end R3 claim.

## Scope and provenance

Actual unchanged schema18 baseline tree `6c1e3df81b9b2ff72bb531438085a7d860b3182f` executed in local workerd, using real SQLite Durable Object storage and local R2 buckets. Public source commit `bfe621c3dab2a0cab672feadd1916ec154188db9`; restored local equivalent `ad0f1b39a1431aa29726b5fc3b77c1a13e08118b`. `baseline-verification.json` independently records exact HEAD/tree and all1432 original tracked-file hashes matching in both restored baseline and isolated capture worktree. No original tracked changes, staging, commit, publication, profile/schema change or production behavior modification.

Three delivered fixture files retain the first successful producer's exact bytes. All share the identical capture object. `fixture-integrity.json` owns exact SHA-256 values; `chunk-integrity.json` lists all34 original chunk metadata/digests/lengths. `reproducer-archive.json` and `reproducer-sha256.json` identify the test-only source. The original schema17 files remain unchanged. Existing synthetic signing material was reused unchanged outside the fixture JSON.

## Meaningful evidence

- Original18 signed manifest and ledger verify using baseline code. Ordinary capture/restore receipts validate against their existing unsigned protocol, without fabricated signatures.
- All34 chunks have correct schema18 tag, exact length and digest; ordered aggregate SHA-256 matches the manifest. The exact5-byte R2 artifact matches its authenticated length/digest.
- Captured source, interrupted target after17of34 chunks, and completed target snapshots were produced by genuine capture/restore executions and DO evictions, not by rewriting newer-schema snapshots.
- The frozen verifier validates the retained bytes and reconstructs source/target snapshots, evicts again, and proves fresh18 restore, partial continuation, exact declared-build fences/no retained-job mutation, captured-source probe and permanent-retirement replay, completed-target probe and synthetic-authorized resume replay.
- The source has104 projected rows/39 tables/50607 SQL bytes; source creation admission and observation diagnostics are absent on completed target. Partial target has76 imported rows/34656 bytes and is closed awaiting chunk17.
- Diagnostic slot/record seeding is synthetic repository-helper/test SQL, not HTTP ingestion. Rich existing history and committed R2 bytes come from unchanged fixture/domain helpers; pending creation reservation comes from a real local browser prepare endpoint.
- Outbox empty; existing event creation bindings NULL; these fixtures do not cover nonempty paused-delivery graphs or consumed creation-binding retention. No new decision tables are represented.

## Commands

Each Vitest command used a fresh empty `XDG_CONFIG_HOME` under `/tmp`. Direct locked binaries ran in the isolated worktree; dependencies were supplied unchanged by the parent. No dependency installation or mutation was performed by this capture subtask.

- Producer: `vitest run --config vitest.schema18-capture.config.ts`: exit0,1file/1test,25.27s. First and only generation succeeded.
- Frozen verification: `vitest run --config vitest.workers.config.ts test/recovery/schema18-frozen-verification.test.ts`: exit0,1file/5tests,26.48s.
- `tsc --noEmit && tsc -p tsconfig.worker.json --noEmit`: exit0.
- `git diff --exit-code`, `git diff --cached --exit-code`, `git diff --check`: exit0.
- Independent Python digest/length check of all34 frozen chunks: passed. Both baseline/worktree tracked-file inventories1432/1432 identical. No original fixture changes.

The fresh-worktree focused producer and verifier passed first time; there were no failed capture/replay executions or fixture corrections. The final combined frozen+existing regression run passed8files/42tests, exit0,282.38s. Its exact file list is recorded in `execution-receipt.json`; this is focused recovery regression evidence, not a full project or R3 acceptance gate.

## Safety and handoff

Only synthetic local state was used. No external authority action, credential copy, actual source retirement/cutover, live Cloudflare call, deployment or publication. Resume tests create synthetic external records solely to exercise existing authorization checks. URL and credential-pattern checks are in `sanitization.json`; no raw logs or environment dumps are packaged. The synthetic release string is not a deployed attestation. Engine-owned metadata is not exported.

Next: independent review of this immutable fixture/provenance bundle. Future schema19 compatibility tests must consume these bytes unchanged and explicitly retain physical18 lifecycle boundaries; this task does not implement or approve that future behavior. The producer/config/frozen verifier are archived test-only reproducer files, not active additions to a future schema19 compiler/test suite.
