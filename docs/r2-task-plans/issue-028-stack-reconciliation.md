# Issue 28 stacked draft reconciliation

Status: Source-equivalent draft preparation; remote checks and live acceptance pending. No released capability.

## Exact ancestry and scope

Immutable local catalog implementation is `4677011e7332076827658063ca677af967b41572`, tree `c663894bf3f0b404f514de2cac082942e1818e44`, on local predecessor `3bc7bba3d05672f8895f0796677334a819bcec51`. Its [execution ledger](issue-028-execution.md) and [research](research/r2-catalog-lifecycle.md) remain unchanged historical evidence.

Publication uses actual predecessor #27 draft [PR102](https://github.com/trungtaottn/cf-agent-hub/pull/102), head `a49cf9be0fa1a8c6d6c61473fb3f66bdb1395136`, tree `315ac8c3c6a87aab9f8779c8a0df3847b603fb4b`, as first parent. Fresh original `docs/r2-028-plan` tip `e4f970a0b0895d332583b038b17710f331a8ca52` is preserved as second parent. Its plan blob `8b164b4d13698309e64c225bcbaf2d61afab93d2` exactly matches the reviewed local plan; no current #28 plan delta. The predecessor's corrected #22/#25 plans and stack receipts remain inherited, not reverted to local historical snapshots. Draft base is `docs/r2-027-plan`, never dev/main. A fresh expected-ref check and non-force update remain required before publication.

Only #28 catalog archive/remap and the reviewed narrow schema prerequisite are implemented. No #29 lease implementation or later submission/review/cancellation/scheduler feature is introduced. Immutable previews bind complete reference sets and versions; apply/replay retain current authority and whole-task visibility. Current schema is 9 through index-only migration 0009; historical migration 0008 bytes are unchanged. Current operational recovery remains unavailable pending #39/#43.

## Equivalence and limitations

All product, test, generated, schema and package/lock bytes are preserved exactly from immutable local #28. Differences are inherited research guidance, corrected predecessor plans/stack receipts and this note only. The issue-only patch applied without source conflict onto actual #27. No unfamiliar implementation is added during reconciliation.

The clone is isolated without hardlinks or a remote, with independently copied locked dependencies, Node 24.22.1, task-local npm 11.19.1 and isolated XDG/temporary directories. Predecessor and immutable source are preserved. Remote commit metadata is SHA-verified; absent historical objects are not fabricated.

Task-reference indexes were independently reviewed after actual Workers SQLite measurements: 10,000 unrelated tasks no longer force an empty-reference denial. Agent role JSON still requires a capped complete scan, so more than 2,048 agents may deny an otherwise empty-role archive. This documented limitation is not solved by task indexes; a normalized membership projection is future work.

## Verification and authority

Historical exact-source evidence: 813 Node, 732 Workers, 18 operator and 13 deployment-verifier tests passed; types/generated/runtime/UI build/docs and 636 plan checks passed. Aggregate exit 1 occurred at the unchanged protected-output recovery CLI guard (8 passed, 18 failed), not an all-green result. Two browser tests were collected but assertions did not run: five official pinned Chromium download attempts failed ZIP integrity. No browser substitution, guard weakening or security change.

Publication refreshes focused catalog/migration Workers, types/generated, docs/plans and independent equivalence review. Exact new results belong in the draft body and external publication manifest. Remote CI/review are exact-head gates. UI screenshots remain unavailable until the actual browser assertions run; source checks do not imply post-R4 live acceptance.

Owner authorization permits reviewed public code and technical/security documents for R2 #26–50 via draft PRs, excluding secrets/private data and merge/deploy authority. Publication waits for predecessor terminal CI, root baton and mandatory tool approvals. No optional external comments, release, merge, deployment, credentials, provisioning or Cloud Harness action. Historical development-start gates are superseded by the owner amendment; acceptance remains deferred until after R4, not falsely passed.
