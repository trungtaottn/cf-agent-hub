# Issue26 stacked publication reconciliation

Status: Reviewed local source prepared for draft publication; remote CI, live acceptance and release pending.

## Exact sources and ancestry

The immutable local implementation is commit `393ad95e2fe1756ae96ff741eec4765bab8f5260`, tree `ad7a28ebedcdf6e309f966b27c58aa92ee25475d`, built on synthetic #25 commit `551a064970fb6c434bc717225cc1d74876c3d76f`. Its [execution ledger](issue-026-execution.md) and historical test/review receipts remain unchanged. This source implements only #26 runtime enrollment/presence plus the explicitly reviewed #20/#25 native delegation prerequisite correction.

Publication preparation uses actual predecessor #25 draft [PR100](https://github.com/trungtaottn/cf-agent-hub/pull/100), head `3c8fa87848355d956299b1736a7c75fbe3bde1b5`, tree `79f14eae3816595dba07397300e7b8c6f1cb405a`, as first parent. Fresh read of the original `docs/r2-026-plan` ref returned `45a32b6f33d10b2e7a3b6fb1aef19a3b4c09c295`, retained as second parent. The expected ref must be re-read immediately before non-force publication. Draft target is `docs/r2-025-plan`, never `dev` or `main`; no merge or auto-merge is authorized.

The exact current #26 plan blob is `16c2106202faddb6a54bbcff7638f1aeb5aaf385`, identical to the pinned v3 plan retained in the immutable implementation. Thus this reconciliation adds no new #26 plan-only correction. The earlier v3 changes were historical immutable issue-source links and the finite CLI replay-horizon caveat; they are preserved, not rewritten or reinterpreted as product acceptance. Current predecessor corrections to other retained plans and stack receipts remain inherited from actual #25.

## Equivalence and preserved guidance

No application source, tests, schemas, generated outputs, dependency lock or package version is changed relative to immutable #26. The only selected-tree differences are the predecessor's inherited AGENTS guidance, stack reconciliation documents/corrected historical predecessor plans, and this new reconciliation note. The inherited instruction to compare open-source projects before unfamiliar implementation is preserved; this publication operation adds no unfamiliar feature or new product design.

The isolated publication clone has no Git remote and uses independently copied Git/dependency files, local npm11.19.1 with Node24.22.1, task-specific XDG directories and a workspace-local temporary directory because host `/tmp` is full. No predecessor/source checkout is modified. Missing historical objects inherited by the source-equivalent local graph are not fabricated; original GitHub commit objects are verified by hash, and GitHub retains actual remote ancestry.

## Verification boundary

Immutable implementation evidence remains historical: Node809, Workers568, operator18 and deployment-verifier13 passed; generated/type/contract checks, UI build, runtime boot and documentation/plans passed. Its aggregate exited1 at the existing protected-output recovery CLI restriction (8 passed/18 failed); this is not represented as an aggregate pass. No operational schema8 recovery or live acceptance follows from those checks.

Publication preparation refreshes generated consistency, all TypeScript projects, focused identity/runtime Workers tests, documentation/plans and whitespace, with exact results in the draft PR and external publication manifest. Independent equivalence review checks source bytes, ancestry ordering, issue-only diff and truthful evidence. Unchanged full-suite evidence is reused rather than reported as freshly executed. New-head remote CI is separate and must be observed after publication.

The owner authorizes sequential stacked draft PRs without merging. Publication remains gated by predecessor terminal CI and ordinary tool approval. No pending/denied action may be bypassed or silently retried. No live credentials, provisioning, deployment, Cloud Harness operation, recovery transport or release is performed. Live acceptance remains deferred to the owner-selected post-R4 stage, without claiming it passed.
