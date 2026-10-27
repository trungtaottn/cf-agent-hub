# Execution policy and catalog contract progress

Status: Issue #20 contract scope implemented and independently reviewed; exact-head CI and acceptance pending. No released capability is claimed.

The [original issue #20 plan](issue-020.md) is retained byte-for-byte. The [owner development amendment](owner-development-amendment-2026-10-26.md) supersedes its historical #17 development-start restriction. This change begins from PR #94, not from a sibling plan branch's stale source. The eventual stacked draft PR targets `docs/r2-019-plan`; it must preserve the existing `docs/r2-020-plan` history without force-pushing. No merge or deployment is authorized.

## First bounded contract slice

[Execution policy schema](../../spec/execution-policy.schema.json) defines the closed policy shape and numeric bounds. [Contract tests](../../test/contracts/r2-policy-catalog.test.ts) validate independent accepted/rejected boundaries against that schema. The test values are fixtures, not selected production defaults. The first run collected 48 tests and failed because the schema was absent; the same focused command passed 48 after adding it. Typechecking passed on pinned Node/npm. These are local contract tests, not a functioning policy engine or deployed evidence.

Schema validity does not prove exact-tuple conflict detection, current agent eligibility, evidence applicability, or precedence of unknown outcomes. Those semantic checks and their integration are not implemented by this slice. Catalog preview/apply, scope declarations, credential-epoch and history amendments, generated integration and the remaining #20 review are still pending. No working API endpoint or complete #20 acceptance is claimed.

The owner subsequently delegated technical option selection after evidence-based research, comparison and experiments. Earlier documents that call those technical choices owner-pending are historical; decisions must still be recorded and reviewed before their consumers are implemented. This delegation does not expand merge, deployment, credential or release authority.

## Second contract batch — 2026-10-26

The first checkpoint is draft [PR #95](https://github.com/trungtaottn/cf-agent-hub/pull/95), stacked on draft PR #94. Its initial head `a385aff7af0c93527cbddf6fb8d9ef264db543e0` passed [source CI](https://github.com/trungtaottn/cf-agent-hub/actions/runs/40347603816), including 28 recovery CLI tests; skipped release evidence was not acceptance. That result does not cover this later batch.

This batch adds static exact-tuple/replay-rule conflict checks, catalog schemas and semantic combined-200/15-minute-expiry checks, explicit operator R2 actor-lane recognition, and the additive authorized historical-result read contract. Existing generators refresh their existing outputs; generator root expansion, routes, SQL migrations and domain implementations remain successor responsibilities. No new scope is automatically installed or granted, and approval lanes remain unavailable.

[ADR 0008](../adr/0008-r2-authority-and-history.md) records the selected single-registry credential provenance/revocation rule and authorized-only history pagination. It supersedes the historical plan's unresolved D-ID-1/D-ID-2 and D-HISTORY technical choices, not its retained original bytes. Consumers #22–27/#35/#43 must implement and test those contracts. In particular, #27 must prove a bounded feasible authorization/query plan before activating history; output LIMIT is not a physical scan bound. No public hidden-candidate scan frontier is permitted. The worst-case response-envelope fit and padded-cursor obligations are also activation prerequisites.

Meaningful collected red-to-green evidence so far: policy semantic suite 13 (schema plus semantics 61); catalog shape 44 and semantics 47 (combined 91); scope suite 63, then 10 real generated-parser checks (73 total; two failed until regeneration); history schema 10 (nine failed before additive contract, unchanged Task test already passed). An initially malformed synthetic Actor fixture was corrected to the unchanged canonical fields, not accommodated by relaxing the schema. Static semantic verifiers accept explicit hypothetical time contexts and do not implement production authorization or trusted-clock enforcement.

The reproducible [research evidence](../research/r2-contract-options/README.md) is synthetic SQLite/model evidence only. A fresh privacy model run reproduced exact-count leakage from candidate pagination and verified successful authorized-projection transcript invariance; this does not prove Workers query cost, encryption or endpoint correctness. Local aggregate recovery CLI execution remains independently constrained by the execution environment's ancestor `.git` markers; neither that failure nor the first checkpoint's remote success is silently reused as a passing result for changed inputs.

Current batch review, aggregate checks and exact-head CI remain pending until separately recorded. No complete #20 acceptance or working R2 endpoint is claimed by this progress record.

## Local batch verification receipt

Independent review covered all 45 changed/new files and found no unresolved material contract/source defect; one documentation status-marker mismatch was fixed and rechecked. Actual final local checks passed generated verification, all TypeScript targets, R1 contract checks, 510 Node tests, 469 Workers tests, 18 operator tests and 13 deployment-verifier tests. Workers completed normally after a longer startup (173-second suite), not an assumed hang. Documentation validation passed 85 Markdown documents, 151 JSON files, 1,154 local links and 92 fixtures; historical plan validation passed 636 checks.

Aggregate `npm run check` exited **1**: recovery CLI again passed 8 and failed 20, with guarded outside-checkout temporary-path rejection reproduced in this environment. No assertion, guard, timeout or validation rule was weakened. Exact-head remote CI remains required and is distinct from this local failure. The protected bootstrap bundle schema remains unchanged intentionally: it carries immutable verification hashes/tombstones, not scope lists; the deployment schema owns the amended scope recognition. The original task plan and locked dependencies remain unchanged.
