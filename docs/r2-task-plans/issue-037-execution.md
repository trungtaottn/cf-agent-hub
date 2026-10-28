# Issue37 — immutable reviewed imports, local execution evidence

Status: local source implementation and verification complete; baseline acceptance pending. Formal capability rows stay Specified. Owner authorizes autonomous local MVP development and defers integrated acceptance until afterR4; this is not a deployment/release or recovery acceptance record.

## Baseline and workflow

Actual GitHub issue37 and corrected published plan pin `5dc2a15d8f3fd00a62967e850aae6305682d22a8` were read before implementation. Local base is issue36 `e36eb6a146231ad7d2fe4b88b4684ca5de79cd9a`, tree `024c74d939270174f3381e01ac0d4e006a0e4639`. The isolated no-hardlink clone has no remotes; predecessor, migrations1–15, frozen V1/schema8 evidence, registry and lockfile remain protected. No CH, deployment, merge or remote write was performed by this worker.

Actual AgentKit ak-vibe1.4.1, ak-plan2.2.2, ak-cook2.5.1, ak-research, ak-debug, ak-code-review2.0.3 and ak-journal1.3.1 workflow: router/status execution, primary GitHub comparisons, plan validation/security red-team, meaningful real Workers RED→GREEN, implementation, independent review/simplification, documentation and journal. Installed hooks/configuration are not a claim that hooks executed. No invented ak-vibecode alias is claimed. Native plan validation is distinct from semantic review.

## Implemented scope and explicit reconciliations

- Human-only immutable15-minute previews and atomic create-only apply, raw65,536-byte/100-row admission, exact canonical row/public-preview hashes, closed row rejection, all disclosed duplicate occurrences conflict, expected mapping absence/presence and current profile/task snapshots. Fresh previews preserve local edits; stale previews fail whole apply. Changed source never overwrites local work.
- New tasks use canonical unassigned Backlog creation with no run/result/approval/grant. Source references/text remain inert; no outbound fetch. Partial acceptance selects only reviewed valid creates; a stale row or late SQL failure still rolls back everything.
- POSTs reuse verified session/origin/CSRF/idempotency. Reads/replays/events recheck owner and current full resource graph, including task results/artifact/message associations. Immutable outputs are denied whole, never reclassified/redacted. Exact committed replay survives restart and preview expiry without duplicate tasks/maps/events.
- Malformed rows are stored as null, not raw rejected secret/authority values. The original canonical request fingerprint still distinguishes them. Private `source_digest` now means the sanitized immutable binding checksum, not raw-envelope digest; this supersedes an unpublished intermediate local implementation with no baseline rows to migrate. See [data model](../data-model.md) for precise checksum limits.
- The accepted internal provenance seam is bounded `getTaskProvenance(tx,ctx,importId,taskId)`, not the stale task-only helper. Every attempt is durable in its authorized report/audit association; revision-only unchanged attempts retain new provenance without overwriting origin mappings. No public task-centric all-history route is claimed.
- A real runtime failure proved that configuration/profile Event branches could not represent imports. Owner approved the narrow additive import resource, exact human preview/applied producer/type/version/summary pair, null unrelated fields and current owning-import visibility. Old Event allOf constraints remain byte-equivalent. Spec, generated DTO/validators, producer/projection and negative tests changed together. No schema16.
- Positive safe-integer wrong apply versions use a validation-only copy so the original version reaches authorized domain409 and remains fingerprinted. Unknown fields/types still400. Shared finite canonical intent rules reject nonrepresentable numeric JSON such as1e999 with400; ordinary invalid JSON row values are reconciled generically.

## Research, measured work and regression evidence

The [primary-source comparison and actual Workers study](../research/r2-imports-runtime.md) select indexed point lookups over unbounded materialization; bounded98-ID set probes remain a measured future optimization, not an unverified production replacement.100-row preview+unchanged apply measured42,238 total SQL reads at both0/10,000 unrelated mappings, not a100-query bound.

Initial reconciliation/authority RED suites collected12 and11 missing-route404 failures. Later Event RED proved the closed producer/resource mismatch. Independent review exposed canonical expansion of a compact invalid row, missing saved-source corruption checks and report-origin mismatch; targeted failing tests preceded their fixes. A GET post-crypto scope-ordering regression returned409 before revoked-scope403; final scope-first re-entry now denies correctly. Real SQL faults cover last task, mapping, report, task event, import event and replay outcome; a late generated-ID collision also rolls back prior writes. Tests preserve failed receipts rather than labeling the initial runs green.

Before full regression, focused imports passed84/84; subsequent scope-order/nonfinite-number additions and final query study passed47/47. First full Workers finished1,342 passed/4 failed, all obsolete import-unavailable classifier assertions. Corrected valid-body R1 denial retains unchanged grants and complete two-workspace SQL snapshots; R3 stays unavailable and unknown producer tests are stronger. Focused133/133 then final full Workers1,346/1,346 in102 files passed, with no production change for that classifier correction. No test timeout was weakened.

| Final gate | Observed result |
| --- | --- |
| Full Workers / Node | 1,346/1,346 across102 files;838/838 across33 files; exit0 |
| Operator / deployment verifier | 18/18 and13/13; exit0 |
| TypeScript / generated / bindings / R1 | All5 projects and all checks pass; exit0 |
| UI build / local runtime boot | Pass; schema15 and empty authority closed |
| Docs / plan structure | 129 Markdown +169 JSON;636 plan checks; pass |
| Independent security / storage | 56/56 and60/60; exact source reviews approve |
| Recovery CLI | 8 pass/18 fail; unchanged protected default temporary-directory guard |
| Browser | 34 collected;1 launch failure/33 not run;0 assertions; exact Chromium1248 absent |
| Fresh dependency audit | Policy-blocked; no completed current result, no retry |

Independent contract review covers all changed source/test/docs hashes, Event compatibility, helper supersession and truthful limits; scoped simplification is clean. Security/storage reviews have no unresolved actionable findings. Source verification and independent tests do not replace deferred live/integrated acceptance. No aggregate-green assertion is made.

## Known environment and operational boundaries

Node24.22.1/npm11.19.1, hash/inode/symlink-verified copied dependencies, task-local XDG and metrics disabled. Only Workers SQL uses task-owned TMPDIR. Full suites run serially. Recovery CLI must retain its default protected `/tmp/.git` guard; exact pinned Chromium availability must not be substituted. Their actual final outcomes are reported separately. No live OIDC/deployment, current schema recovery, throughput or formal capability promotion follows from synthetic sessions and local Workers tests. R3 approval remains unavailable and current recovery remains closed pending39/43.

### Dependency-audit disclosure boundary

The fresh `npm audit` step was blocked by sandbox policy because it can send dependency metadata to the public registry. No retry, alternate endpoint or workaround was attempted. It produced no audit result; the partial startup warning is not a completed scan. `package.json` and `package-lock.json` are byte-identical to issue36, whose [own execution record](issue-036-execution.md) reports its earlier zero-vulnerability audit. That is attributed historical evidence, not a fresh issue37 clean-audit result. The new local audit gate remains blocked separately from passing source checks.
