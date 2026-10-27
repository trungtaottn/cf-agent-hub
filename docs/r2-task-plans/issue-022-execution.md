# Issue 22 execution ledger

Status: Implementation pending review; local contract work only. No released capability is claimed.

## Intake and provenance

Owner authorized technical choices, local cloud development, and stacked draft PRs without merge/deploy. The [owner amendment](owner-development-amendment-2026-10-26.md) supersedes historical #17 start gates. Exact synthetic local predecessor: `889c945c97e98e3f3ad9559708a4ea6d4569466a`, tree `73fb32829952a2b70f5144863db6a6cb51ebd197`. Isolated clone used `--no-hardlinks`; origin removed. Publication must reconcile actual #21 PR ancestry without rewriting either history. No GitHub write is authorized before the controller baton.

Live issue #22 and both comments read; published issue plan fetched from `docs/r2-022-plan`. Installed AgentKit `ak-vibe` and its integration/orchestration references, plan validate/red-team, cook TDD/review, research and code-review workflows govern this work. The requested alias `ak-vibecode` does not exist; no invocation is fabricated. Mode is feature, autonomous TDD, no merge. GitHub state/ship/PR review are deferred to publication authority.

## Plan validation and red-team rulings

Two independent read-only reviews checked actual manifest, restore, capture, jobs and registry owners. Accepted findings:

- V2/schema7 is a synthetic format fixture only. No invented migration8 or arbitrary table names. #24 owns versioned registry extension. Runtime V2 remains explicitly unavailable before writes; format validation is not restoration.
- Pin V1 compatibility to the historical schema7 table coverage, not a future moving schema constant. No automatic V1-to-R2 migration.
- All bounds are simultaneous ceilings. A 1000-entry array need not fit the 65536-byte manifest; 256 × 200 also bounds represented rows to 51200. Never truncate to claim completeness.
- Add a narrow existing capture entry guard for nonzero artifact budgets while V2 runtime is unavailable; extending its wire shape must not silently imply artifact capture.
- Use distinct trusted private artifact/recovery bindings, exact server-derived immutable keys, and one bounded inventory with one pending restart reservation. No new endpoint, migration, binding provisioning or copy implementation.
- Schema declaration validation cannot prove committed bytes exist. Missing-byte runtime acceptance remains #39/#43; tests must state this limitation.

Technical option selection is delegated by the owner, not a request to approve deployment. Whole-plan consistency: historical planning text retained with this additive superseding execution record; no old receipt rewritten. Two bounded batches: (1) schema/semantic compatibility and meaningful TDD; (2) frozen interfaces/docs and independent whole-diff review. Debug skipped: new contract feature. Research run: trusted mappings and bounded JSON sizing. Test/docs required for public contract changes.

## Checks

Initial TDD run collected 27 tests with 9 failures/18 passes, including one test fixture accessor error. Corrected accessor before implementation; confirmed red run recorded in local logs. This is not a pass or runtime acceptance.

## Local verification and review result

Toolchain: Node 24.22.1, task-local npm 11.19.1 on PATH for nested npm; own XDG directories and Wrangler telemetry disabled. Dependencies copied from the exact predecessor installation without lock changes. No global/security settings changed.

- Baseline focused RED: 27 collected, 9 failed / 18 passed after fixture-access correction. Initial contract GREEN: 27 passed.
- Capture unsupported-format guard: explicitly removed for regression RED, 1 failed / 27 passed; restored guard passes. Existing recovery controls were not weakened.
- Future transfer schema RED: 7 failed / 28 passed (missing validator); GREEN: 35 passed.
- Independent source review: 0 Critical / 1 Important, contradictory restart checkpoint accepted. New tests reproduced 2 failures / 36 passes; generated semantic guards fixed both. Complete now forbids pending; pending index equals the next artifact index. Manifest-relative counts/identity remain named future runtime obligations.
- Final focused contract suite: 40 passed, nonzero collection. Includes exact combined-byte and canonical-manifest boundaries, immutable duplicate generation, authenticated V1, malformed V2 declarations, unsupported runtime V2, and bounded restart cases.
- Final `npm run verify:generated`, `npm run typecheck`, `npm test`: exit 0; 27 Node files / 774 tests passed. Source test count increased by one after the broad run; the entire Node suite and type/generated checks were rerun for that final test change.
- Broad `npm run check` on the final production-source bytes: exit 1, not green. Generated/type/R1-contract stages passed; Node 773 passed at that point; Workers 23 files / 472 tests passed; operator 2 files / 18 tests passed; deployment verifier 13 passed. Recovery CLI: 8 passed / 20 failed. Failures are the predecessor's environment obstruction: protected output paths under `/tmp` encounter the host-managed `/tmp/.git` marker and fail `outsideCheckout`, before any dispatch. Marker, permissions, safety guard and assertions were not modified. Exact per-test failures/logs are retained outside the checkout for handoff; future exact-head remote CI must independently verify.
- Docs validator: exit 0, 92 Markdown documents / 165 JSON files / 18 schemas / 101 mapped fixtures. Plans validator: exit 0, 636 checks. `git diff --check`: exit 0. V1 fixture files have no diff.
- Independent docs/contract review: 0 Critical / 0 Important / 1 Minor finalization note, resolved by this receipt. Independent simplify review found no necessary structural changes; schema/generated expansion is expected.
- Real capture/restore, byte-presence recovery, deployment, live credentials, release verification, browser/UI and dependency audit were not run for this contract change. Existing dependency pins and lock are unchanged. Missing-byte runtime tests remain #39/#43; no release or F40 promotion.

The additive fixture mapping is owned here for the one V2 envelope; #23 must retain it when extending contract discovery. No source/schema/generated file was hand-edited in place of its generator; generated validator outputs came from `npm run generate:operator`. No new runtime copy helper, migration, provisioning or endpoint was implemented.

## Handoff

Local result is ready for stack reconciliation and exact-head remote review/CI, not acceptance. Preserve the existing #22 branch history and actual #21 predecessor. Final commit/tree and patch digest belong to the external handoff record so this committed document does not self-reference a changing hash. No push, PR, labels, merge, deployment or auto-merge was performed by this local worker.

Pipeline: intake → isolated snapshot → research/options/sizing → plan validate/red-team/consistency → TDD schema and bounded interface batches → independent source review/fix → final tests/docs → pending authorized stacked publication. Research, tests and docs ran; debug skipped for the feature route. No unresolved technical decision in #22; runtime and acceptance dependencies remain explicit.
