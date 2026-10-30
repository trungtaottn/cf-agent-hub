# Issue 25 execution ledger

Status: Local development; publication, CI and live acceptance pending.

## Authority and immutable inputs

Owner development amendment permits autonomous engineering choices and local MVP development with acceptance deferred until after R4. The controller assigned only #25. No publication until its predecessor reconciliation baton; no merge, deployment, provisioning or real credentials. Synthetic tests only.

Published plan `issue-025.md` is retained from commit `92710db1867f05402338ef04b02a0cd747f4179f`, blob `6a4e243cf85390b2c441e926709062b6fd81f415`. Historical start-gate wording is superseded, not rewritten. Actual base is independent `--no-hardlinks` clone of #24 local HEAD `982bbe61c9a88e35490134de229b589bd566ffb7`, tree `2e5bd2f6e4bb05282596e210ce5ec3aeaa6d2276`; origin removed. This is synthetic local ancestry, not remote PR evidence.

## AgentKit workflow and plan reconciliation

Read installed ak-vibe 1.4.1, subagent/integration references, ak-worktree, ak-plan validation/red-team, ak-cook workflow/review, ak-research and ak-code-review. Reuse dedicated independent clone. Feature route with autonomous TDD; no --ship/--both. GitHub mutations are deferred by controller authority. This ledger records the journal, not a claim that unavailable hooks ran.

Independent security and assumption reviewers inspected actual schema8/source. Accepted reconciliation requirements:

- No new migration: preserve all 1–8 historical bytes. Reuse the single provenance registry. Restore schema8 remains fail-closed pending its owner.
- Add `src/audit/events.ts`, `src/index.ts` and narrowly scoped identity cursor/read files to ownership: actual audit producer map and public gateway otherwise prevent truthful lifecycle commands. No runtime/task/approval route activation.
- Add exact sanitized lifecycle events and current resource visibility; no caller-supplied arbitrary producers.
- Filter static completeness/hash/tombstone checks by immutable provenance; higher epoch and restore revoke dynamic credentials/proofs while retaining active identities at current epoch and preserving archived state.
- Static local `revoked_at` and agent archive are independent ceilings even when higher-epoch static configuration refreshes enabled values.
- Human-only session and current scope/project checks apply before replay and effects. Native forged admin scope is insufficient. No metadata grants authority.
- Legacy static credentials have empty labels; project a deterministic safe fallback without changing old migrations or identity evidence.
- Private first-execution boolean is returned only after transaction commit. Raw entropy is never descriptor output, actor context, audit, replay, SQL or export data. Lost-response retry returns sanitized stored metadata without issuing another credential.
- For static identity adoption, a single current enabled unrevoked static credential must cover all requested scopes/projects and expiry. Do not union grants. Recheck this ceiling at native authentication and background eligibility; a revoked/expired static ceiling cannot be bypassed by a dynamic child. Dynamic grants also remain beneath the current issuing human grant and canonical native-disallowed scope policy.

Validation inspected real DTOs, commands, bootstrap, auth, router, audit, schema and runtime-suite discovery. No remaining product decision requires a user question under delegated technical authority. Whole-plan sweep reconciles historical source/version/start gates with this ledger; published plan remains immutable. No proof enrollment or task lifecycle is assigned.

## Bounded batches and ownership

1. Identity/credential domain and current-authority overlay, first-response wrapper, meaningful Workers red/green tests; independent review.
2. Thin authenticated HTTP and bounded reads, restart/rollback/races/no-leak tests, regression gates, documentation and independent final review. Return issue-only patch/manifest to controller; publication pending.

Shared edits are serialized by this controller. Subagents receive disjoint ownership. Tests run actual Workers SQLite, not a desktop substitute. Node24.22.1 and task-local npm11.19.1/XDG paths; WRANGLER_SEND_METRICS=false. Dependency copy uses exact predecessor lock SHA256 `8fa7894880bd0b77bfdf6fffe7e13fd8eb1a8b695b1316682dc33f7783873634`; 4,137 regular files checked, no shared inodes or external dependency symlinks. Predecessor remains untouched.

## Verification

Pending fresh exact-head checks. Host `/tmp/.git` protected CLI limitation must be reported without changing guards, permissions or assertions. Source checks do not imply deployed acceptance.

## Actual implementation and review findings

Implemented the eight canonical identity/credential operations only. Runtime enrollment, task transitions, artifact operations and R3 routes remain unavailable. All writes reuse the existing synchronous command/event/outcome owner. Credential entropy/hash preparation runs after ingress proof/CSRF and before the transaction; the original proof and admission fence are resolved again at transaction time. Only a committed first execution decorates the private HTTP response. Duplicate, lost-response and restart retries retain one sanitized issuance outcome.

Independent source review identified two Important findings, both repaired with real Workers regressions: revoke replay must check the original stored grant as well as current row visibility; identity routes must not await unrelated scheduler repair after their final sensitive projection. Identity routes produce no outbox/alarm obligations. Dirty scheduler state remains unchanged, local lifecycle audit remains committed, and the normal scheduler repair path still works. A subsequent Minor finding—operator static retirement not incrementing credential_version—was repaired with a red/green version regression and repeated-tombstone idempotency check. The simplification pass reused the existing grant-subset helper for audit visibility; no second policy implementation was introduced.

The eight former R1-unavailable identity probes now use valid DTOs and assert denial under unchanged R1 grants plus byte-equivalent SQL snapshots in both workspaces. This preserves the no-new-authority contract while recognizing the explicitly implemented R2 endpoints; all other unavailable-route tests remain. No migration, generated contract, frozen recovery registry or historical receipt was changed.

## Verification corrections and limitations

- The first wrapper green attempt exposed invalid synthetic preference IDs; fixtures were corrected to the existing `pref_<32 hex>` contract, without changing product validation. Two wrapper tests then passed.
- Initial missing-module domain/read runs collected zero tests and are not behavioral evidence. Domain tests subsequently recorded four collected red failures before implementation and eight green cases. The read suite has four real Workers cases plus a meaningful closed-cursor mutation failure with the source restored.
- Real OIDC login leaves JOSE's existing five-second JWKS AbortSignal timer alive. The HTTP test timeout remains five seconds. Real login and its timer drain run in setup; issuance, response loss, duplicate race and actual post-issuance eviction/replay remain inside the test. No safety timeout or auth guard was relaxed.
- Research/alternatives and the bounded encoding experiment are in [identity research](../research/r2-identity-lifecycle.md). They do not substitute for Workers SQL evidence.
- The existing plan validator permits formal Implemented promotion only for reviewed R1 evidence. F11/F12 retain formal Specified status with explicit local implementation references until its R2 evidence-register owner extends that contract. No validator was weakened.
- `npm run check` remains exit 1 solely at the protected recovery CLI suite: 8 pass / 18 fail / 26 total, with `RECOVERY_INPUT_REJECTED` before transport under the retained host `/tmp/.git` marker. No marker, permissions, security guard or assertion was changed. Schema8 recovery remains unavailable pending #39/#43; these are not live recovery acceptance results.

Remote issue labels, draft PR publication, exact remote-head review and CI are deferred to the controller's reconciled #24 baton. No merge, auto-merge, deployment, provisioning or real service credential operation occurred. Conditional AgentKit disposition: Research run; Debug limited to observed test/runtime failures; Test run; Docs run locally because publication is paused. Live acceptance remains deferred by owner decision.

## Final local receipt

Final source/test manifest SHA-256: `85baf56cca14d14afe0631f7a6c62183922a64b8827e978b940d475d465786a9` (26 changed source/test files, sorted compact JSON path-to-SHA256 map). Independent reviewer confirmed every file hash and reported 0 Critical / 0 Important / 0 Minor remaining after resolving 2 Important and 1 Minor. The machine-readable [local execution receipt](../../validation/r2-025-local-execution.json) owns exact checks and limitations. Product-source changes are fixed; this receipt is not CI or deployment evidence.

Fresh results: generated contracts, all typechecks and R1 contract checks passed; Node 798/798, Workers 525/525, operator 18/18, deployment-verifier 13/13 passed. Docs/plans and whitespace checks passed. Actual isolated Workers boot reported schema8, liveness contract and closed empty authority. Aggregate check remains failed only at the unchanged protected CLI limitation above. No browser UI change was made; browser acceptance, remote CI and live recovery were not run.

```mermaid
flowchart LR
  A[Live issue and pinned plan] --> B[Isolated clone and research]
  B --> C[Validation and independent red team]
  C --> D[Bounded TDD implementation]
  D --> E[Independent review and regression fixes]
  E --> F[Local tests and docs]
  F --> G[Issue-only commit and handoff]
  G --> H[Remote publication pending controller baton]
```
