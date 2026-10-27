# Issue 25 stacked publication reconciliation

Status: Reviewed source prepared for a draft stacked PR; exact new-head CI and live acceptance pending. No released capability is claimed.

## Sources and ancestry

The immutable reviewed implementation is `551a064970fb6c434bc717225cc1d74876c3d76f`, tree `8a3f357c7591411a87a203950f5f33f691ddbcc0`, based on local #24 `982bbe61c9a88e35490134de229b589bd566ffb7`. Its [execution ledger](issue-025-execution.md), [local receipt](../../validation/r2-025-local-execution.json), source, tests and research are retained unchanged.

The actual predecessor is draft [PR #99](https://github.com/trungtaottn/cf-agent-hub/pull/99), head `e2f3162f0313f851a7871915f255da0f44074d35`, tree `d7e99dc1a102608733d41f693f6a0041f3bc49a4`. Publication is gated on its terminal CI baton, not inferred from the local predecessor tests. Actual #24 is the first parent; corrected #25 planning head `295ec23eb670053790d3dcd438cf7d2aee53b034` is the second parent. The corrected plan blob `c48a6bde1afa993b20fe3f64a7d6fa552c6ef65f` is preserved exactly. The historical local implementation read the earlier `92710db1867f05402338ef04b02a0cd747f4179f` plan; fresh remote inspection found the later correction: an immutable historical snapshot link and a conservative CLI replay-retention caveat owned by #41/#44. These do not change #25 behavior. The historical local receipt is not rewritten. Target is existing `docs/r2-025-plan` with draft PR base `docs/r2-024-plan`, expected-old-ref protection and no force.

## Equivalence and boundaries

No product source, tests, migrations, generated contracts, runtime configuration, dependency manifest or lock bytes change from reviewed local #25. Differences are only inherited AGENTS research guidance, original #22 plan newline preservation, predecessor stack receipts, the corrected original #25 plan and this receipt. Prior source-grounded research and rejected alternatives remain in the immutable implementation ledger; reconciliation implements no unfamiliar feature.

The isolated checkout is a no-hardlinks clone, with independently copied dependencies. All 4,137 regular dependency files have separate inodes and symlinks remain inside node_modules. Dependency bytes match except the expected test-run-generated Vitest results cache. Node24.22.1, task-local npm11.19.1, isolated XDG/temp paths and disabled Wrangler telemetry are retained. Original source checkouts are untouched.

Issue #25 owns human-only agent create/edit/archive and native credential issue/revoke, bounded authorized reads, first-response-only reveal and canonical current authority for authentication/delivery. It does not activate runtime enrollment or task lifecycle routes. Archive retains historical attribution, denies unresolved assignments and active runs, and atomically revokes credentials/proofs. Replay remains sanitized and reauthorized. No new migration or persistent secret storage is introduced.

## Verification and limitations

Fresh reconciled checks: generated freshness, all TypeScript projects and 33 Workers identity tests in 9 files passed. Documentation and historical plan validation plus independent exhaustive equivalence review are recorded in the publication manifest before any ref update. Exact new-head CI is separate from predecessor green and historical tests.

Historical local tests remain accurately scoped: Node798, Workers525, operator18 and deployment verifier13 passed; aggregate check exited1 because protected recovery CLI fixtures encountered the retained host `/tmp/.git` marker (8 passed, 18 failed). No security guard, marker or assertion was weakened. Schema8 runtime boot passed locally; operational schema8 recovery still fails closed pending #39/#43. Schema7 tests are historical compatibility, not current operational acceptance.

No merge, auto-merge, deployment, provisioning, real service credential creation, security-setting change, Cloud Harness action or release is authorized. Live acceptance remains deferred to the owner's post-R4 stage and is not claimed passed. The predecessor PR98 process-only metadata-update uncertainty remains separate; this continuation does not touch it or add optional external evidence comments.
