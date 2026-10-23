# Release Orchestration Implementation Plan

Status: Implementation plan reviewed · Implementation pending.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for task-by-task implementation with independent review through the authorized execution environment. Keep shared-checkout mutations sequential and follow the orchestration execution ledger. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation requires an available authorized workspace.

**Goal:** Turn the four release gates into reviewed, reproducible implementation increments, beginning with R1, and promote only the capabilities proved by the resulting evidence.

**Architecture:** Each workspace has one authoritative domain boundary and SQLite transaction owner. Plans share the native contract, with clients and protocol adapters consuming the same decisions. Repository preparation, implementation, runtime verification and publication are separately observable states.

**Tech Stack:** TypeScript, Cloudflare Workers, SQLite-backed Durable Objects, R2, Vitest with the Workers integration, a browser test runner, Python documentation validators, Git and GitHub. Runtime dependencies are selected and locked during the first runnable R1 task.

**Spec:** [Roadmap](../../roadmap.md), [feature matrix](../../feature-matrix.md), [system architecture](../../system-architecture.md), [testing](../../testing.md), [release checklist](../../release-checklist.md), [native OpenAPI](../../../spec/openapi.json).

## Global Constraints

- Public defaults use CF Agent Hub, empty projects/work roles and opt-in synthetic examples.
- MIT copyright is `Copyright (c) 2026 trungtaottn`; third-party notices remain distinct.
- All baseline capabilities are Specified. Planning approval is not implementation, runtime verification or release evidence.
- Public documentation, examples, metadata, binaries and history contain only reviewed product material. Operational credentials, personal deployments and private working notes are excluded.
- Keep actor/workspace binding, current grants, bounded input, idempotency and transaction rules inside domain commands.
- SQL state, domain events, idempotency outcomes and outbox admission commit together. Network calls and R2 writes occur outside that transaction.
- ACK, transport success, submitted result and independently accepted completion have different meanings.
- Code rollback does not reverse a schema migration, remote side effect or R2 mutation.
- Plans define proposed file paths and future commands. They do not imply those files, scripts or runtime releases exist today.

## Review Focus

1. A documentation pass mistaken for product readiness: `test/acceptance/release-evidence.test.ts` rejects documentation-only evidence for any runtime feature.
2. A dependency or later-round feature accidentally available in an earlier release: `test/acceptance/capability-gates.test.ts` verifies disabled routes, UI and adapters agree.
3. A build differs from its reviewed source: `test/acceptance/release-manifest.test.ts` rejects missing, extra or changed shipped bytes.
4. A rollback reopens revoked authority or runs incompatible schema: `test/acceptance/promotion-recovery.test.ts` rejects incompatible revisions and proves safe rollback/forward-repair selection.
5. An interrupted implementation repeats completed work: the resume check verifies task identity, revision and evidence before marking a task complete; missing evidence returns it to review.

## Plan sequence and handoffs

| Order | Plan | Input | Independently observable result |
| --- | --- | --- | --- |
| 1 | [R1 foundation](2026-10-23-r1-foundation.md) | Existing documentation contract plus explicit R1 amendments | Neutral authenticated workspace, reliable messages and truthful read UI |
| 2 | [R2 durable work](2026-10-23-r2-durable-work.md) | Verified R1 identity, storage, replay and delivery boundaries | Multiple authenticated runtimes coordinate durable tasks and independent review |
| 3 | [R3 decisions and MCP](2026-10-23-r3-decisions-mcp.md) | Verified R2 task/lease/artifact and native-client contracts | Safe human decisions, composition and MCP STDIO parity |
| 4 | [R4 teams and extensions](2026-10-23-r4-teams-extensions.md) | Verified R3 plus a reviewed contract for each chosen extension | Scoped collaboration and individually verified integrations |

R1 is the active implementation target. Later rounds are detailed conditional plans, not a reason to build all subsystems at once. R4 extensions can be independently deferred; their absence must remain explicit in the capability register. Work may be researched in parallel, but mutations to a shared implementation checkout are serialized.

## Execution order inside a round

Run O1 before R1 Task 1. Implement R1 Tasks 1–10 in their stated dependency order. O2 and O3 are required work packages **inside R1 Task 11**, with one owner and one evidence/verifier implementation; do not dispatch them as competing implementations or count them as separately completed product features. Run O4 only after the R1 Task 11 review gate passes. R2–R4 extend the same O2/O3 evidence and recovery machinery in their final acceptance task, then apply O4 to that round.

## Shared interface ownership

| Owner | Produces | Required consumer behavior |
| --- | --- | --- |
| R1 ingress/auth | Verified `ActorContext` and workspace routing | Never accept a body/header actor identity as authority |
| R1 config/storage | Installed monotonic authority revision and `WorkspaceTransaction` | Recheck current grants inside the workspace before replay or mutation |
| R1 delivery | Scoped cursors, envelope/error shape, durable outbox and audit correlation | Reuse for tasks, approvals and adapters without another retry/authorization implementation |
| R2 identity | Opaque credential verification, runtime proof bound to credential/agent/workspace/runtime | Runtime IDs are not secrets and cannot substitute for proof |
| R2 tasks | Versioned commands, lease/fence ownership, uncertainty holds and independent acceptance | UI/adapters express intent; they never patch state directly |
| R2 artifacts | Immutable committed bytes with verified digest and attributable ownership | Approval/result paths reject staged, expired, mismatched or foreign artifacts |
| R2 native client | Native envelopes, replay semantics and typed failures | CLI/MCP/A2A preserve domain error meaning |
| R3 decisions | Immutable exact input binding and current proposal decision | Approved metadata cannot change; execution requires a new claim and current policy |
| R4 teams | Current membership/revocation authority | Existing sessions, credentials, replays and subscriptions cannot retain removed authority |

Wire DTOs remain snake_case per OpenAPI. Internal TypeScript names are explicit plan interfaces, not new public fields. Where a later task uses a helper introduced earlier, its brief includes the signature and relevant invariants. If a helper was renamed during implementation, update dependent briefs before dispatch.

## Task O1: Prepare an authorized, isolated and reviewable candidate

**Files:** Create the new repository's approved `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/`, `spec/`, `examples/`, `validation/`, `scripts/validate_docs.py` and `requirements-docs.txt` from this package. Create `.gitignore` with operational secret/local state exclusions and `THIRD_PARTY_NOTICES.md` when third-party material is retained. Keep provenance and access troubleshooting outside the public tree.

**Interfaces:** Consumes this documentation package and authenticated access to the intended repository. Produces an isolated feature branch, a reviewed candidate tree, a private complete file-disposition inventory, and a stable base revision for task reviews. It produces no product-completion claim.

- [ ] Verify the workspace belongs to the authorized owner and intended target. Read repository guidance and installed execution skills. Confirm a real writable isolated checkout and a branch separate from the default branch before product mutation; inspect remote capabilities separately. A failed open or unavailable clone credential blocks workspace execution. Missing remote push permission blocks publication, while authorized local implementation may proceed in the intended owner-bound workspace if its reviewed commits/patches and evidence can be durably retained. Never treat local write access as remote permission or bypass the repository's access controls.
- [ ] Inventory every candidate path, Git object mode, byte hash and shipped asset. For reused material, privately record retained/sanitized/replaced/omitted dispositions and the reason. Include binaries, generated bundles, symlinks, workflow configuration and dependency locks; a partial text snapshot is insufficient.
- [ ] Establish a fresh public history containing the approved candidate only. Inspect its refs and root commits. Do not transplant unrelated history or private audit material. A repository-creation capability must actually exist and be authorized; an inaccessible target is not proof it has been created.
- [ ] Run the documentation validator with its recorded Python dependencies: `python -B scripts/validate_docs.py`. Expected: exit 0; this establishes only the supplied contract package. Review asset provenance and all scanner findings before publication; do not print suspected credential values.
- [ ] Record the base revision, worktree identity, file inventory and intended next task in the controller's private execution ledger. Commit only scoped reviewed files when repository access supports it. Proceed directly to the first R1 task once these gates pass.

**Recovery:** If workspace access is missing, preserve plans and their review evidence and stop before product writes. If only remote publication access is missing, preserve isolated reviewed work and stop before push/publication. State the exact missing capability without substituting another repository. If content review fails, remove or replace only the affected material and regenerate the candidate inventory. Existing deployed data is not an input to public examples.

## Task O2: Add feature-aware runtime evidence and release checks

**Files:** Create `validation/runtime-evidence.schema.json`, `scripts/verify-release.mjs`, `test/acceptance/release-evidence.test.ts`, `test/acceptance/capability-gates.test.ts` and `test/acceptance/release-manifest.test.ts`; modify `package.json` and `.github/workflows/ci.yml` in the runnable R1 candidate. Create `validation/releases/<release-id>/` only from actual verification runs.

**Interfaces:** Consumes the R1 test harness and implemented feature-capability map. Produces `verifyRelease(input: ReleaseEvidence, files: ReadonlyMap<string,string>): VerificationResult`, where the result has `passed:boolean` and structured findings. Release evidence includes exact revision, tree digest, toolchain/lock digest, environment class, schema revision, commands/exit codes, expected/observed assertions, feature IDs, recovery record and known exceptions. Tokens, private origins and personal fixture bytes are forbidden evidence content.

- [ ] Write `rejects_docs_only_runtime_claim`, `rejects_missing_feature_gate`, `rejects_unreviewed_bytes`, and `disabled_capability_has_no_mutation_surface`. Assert no R1 runtime feature becomes Verified from a docs validator, a named gate cannot disappear from evidence, byte mismatch fails, and unavailable R2/R3/R4 routes/UI actions cannot mutate.
- [ ] Run `npm test -- test/acceptance/release-evidence.test.ts test/acceptance/capability-gates.test.ts test/acceptance/release-manifest.test.ts`. Expected before implementation: specific missing verifier or violated evidence assertion, not merely a missing dependency or broken test harness.
- [ ] Implement the evidence schema and verifier. Add `verify:release` mapped to `node scripts/verify-release.mjs`. Validate revision/tree identity and mandatory gate records; unknown feature IDs, failed commands and missing recovery evidence are errors. Evidence does not authenticate itself: the controller still inspects command output and reviewed source.
- [ ] Rerun the focused tests, then `npm run verify:release -- --round R1 --evidence validation/releases/<release-id>/evidence.json` using actual records. Expected: exit 0 only after all required R1 assertions exist. Keep publication opt-in; fork CI needs no deployment secret.
- [ ] Review exact changed files and test receipts; commit this task as one coherent evidence boundary. If fixtures fake a runtime pass, reject the task and correct the evidence origin.

**Recovery:** A failed verifier stops status promotion; it does not delete data or trigger rollback automatically. Fix the missing implementation or test, rerun affected gates, and produce a new evidence record tied to the changed revision.

## Task O3: Rehearse deployment, compatibility and recovery for each gate

**Files:** Create `test/acceptance/promotion-recovery.test.ts`, `scripts/check-runtime-boot.mjs`, `scripts/verify-readiness.mjs`; modify `.github/workflows/ci.yml`, optional `.github/workflows/deploy.yml`, optional `.github/workflows/rollback.yml`, `docs/deployment.md`, `docs/operations.md`, `docs/backup-restore.md` and the relevant round's release evidence. R1 Tasks 1/11 own the authenticated operator gateway, `src/recovery/` modules, versioned recovery contract, table registry and `scripts/recover-workspace.mjs`; this work package consumes their receipts and adds deployment promotion checks, not another capture/restore mechanism. Later rounds extend the same modules/CLI with their new durable state.

**Interfaces:** Consumes the candidate artifact, explicit isolated target configuration, actual previous-known-good revision and the manifest/receipts produced and verified by R1's operator recovery implementation. Produces a deployment/recovery receipt with target identity, before/after revision, schema compatibility, readiness results and rollback or forward-repair result. R1 captures/restores SQL and message/outbox facts; R2 extends the authenticated chunk/manifest contract with artifact bytes and task/runtime state, with explicit version compatibility. Recovery of metadata and object bytes is coordinated; code rollback alone is not a restoration receipt.

- [ ] Write `challenge_is_not_readiness`, `rollback_rejects_incompatible_schema`, `restored_authority_is_not_resurrected`, and `deployed_bytes_match_reviewed_candidate`. Assert a login challenge/403 is not readiness, incompatible schema blocks code rollback, recovery cannot revive revoked sessions/tokens or old execution fences, and deployed artifact identity matches review.
- [ ] Run `npm run test:workers -- test/acceptance/promotion-recovery.test.ts`. Expected red: the specific missing gate or recovery invariant. Keep network/provider test adapters explicit; never direct tests at a production default.
- [ ] Implement real runtime boot and authenticated readiness checks. One configured deployment target is one serialized mutation lane. Record the previous-known-good version before any promotion. Fail deployment readiness on an incorrect target, missing dependency or application-level failure.
- [ ] Rehearse R1 SQL/message/outbox recovery in isolated resources; R2 adds run/credential epoch invalidation and R2-byte manifest reconciliation. Reconcile external outcomes before replaying uncertain work. A recovery timeout leaves the workspace unavailable for writes and records a recoverable checkpoint.
- [ ] Run the focused suite and the documented isolated smoke/recovery commands. Capture actual results; a skipped remote run remains pending. Review the runbook against those results, then record the scoped change and evidence.

**Recovery:** Prefer a verified previous code revision only when its schema and authority contracts remain compatible. Otherwise keep writes disabled and use the tested forward repair. Never force an older authority revision, replay external side effects blindly or delete committed evidence merely to obtain a green check.

## Task O4: Promote capabilities and publish a reproducible release

**Files:** Modify `docs/feature-matrix.md`, `docs/roadmap.md`, `docs/getting-started.md`, `CHANGELOG.md`, `README.md` and `package-manifest.json`; create the release evidence index and dependency/asset notices for the exact shipped artifact.

**Interfaces:** Consumes all task review verdicts for the selected round, actual runtime evidence, target-specific recovery results and approved content/license review. Produces a tagged artifact and honest feature documentation only when all applicable gates pass.

- [ ] Cross-check every Fxx feature in the round against a concrete implementation path, test/assertion and evidence revision. A partially implemented feature remains below Verified. A disabled extension is described as unavailable and omitted from the runnable quickstart.
- [ ] Run `npm run check`, `npm run verify:release -- --round <round> --evidence <actual-path>`, and `python -B scripts/validate_docs.py`. Record each exit code; inspect output and tree changes. Only broaden tests when a changed shared contract creates a concrete dependency risk.
- [ ] Scan the exact final tree and archive for secrets, private deployment identifiers and unreviewed assets. Verify MIT holder and third-party notices. Compare archive entries, lengths and hashes to the reviewed manifest. Use neutral synthetic screenshots if screenshots are included.
- [ ] Obtain an independent round-level review of authorization boundaries, lifecycle parity, UI truthfulness, migration compatibility and evidence. Resolve every open Critical/Important finding before promotion. “No known blocking finding in this reviewed scope” is the accurate conclusion; no claim of defect-free software is made.
- [ ] Commit/push/tag/publish through the authorized repository workflow using the verified candidate revision. An external write with ambiguous outcome must be reconciled by reading remote state before retry. Record the resulting immutable revision and artifact; update capability status only to the level actually achieved.

**Recovery:** If a release needs withdrawal, retain its evidence and reason, stop promotion of affected capability and publish a corrected revision with clear compatibility notes. Do not rewrite evidence history to imply the earlier artifact passed a gate it failed.

## Controller execution protocol

1. Read the current round's plan, authoritative spec and its private execution ledger. Confirm base revision and review results; never redispatch a completed task because conversation context was lost.
2. Run a plan conflict scan before the first task. Resolve contract, naming, dependency and gate contradictions in writing. A later feature's deliberately gated design task is different from an unresolved blocker in the active R1 task.
3. Give one implementer a bounded task brief with exact interfaces, tests and report path. Keep shared-tree implementation sequential. Use parallel agents for independent research or review only.
4. Observe a meaningful failing behavioral test, then implement the smallest coherent change and rerun the affected tests. Documentation-only work uses structural/contract validation and review rather than artificial runtime tests.
5. Give a fresh reviewer the immutable task diff, requirements and test evidence. Record separate spec-compliance and implementation-quality verdicts. Fix findings, then obtain a scoped re-review of the fixes.
6. Append task identity, revision range, exact commands, observed outcomes, reviewer verdict and outstanding findings to the ledger. If code has not run, record it as pending.
7. Reconcile task interfaces before opening the next task. At the round boundary run its acceptance suite and independent integration review, then decide promotion based on evidence.

This execution sequence is already authorized by the project request. Environment access and concrete missing operator inputs may block it; they are not a reason to restart product-direction approval.

## Stop and resume conditions

| Condition | Stop boundary | Resume evidence |
| --- | --- | --- |
| Missing authorized intended workspace | Before product mutation | Successful owner-bound open, real writable isolated checkout and stable base |
| Missing remote repository write capability | Before push/publication | Verified intended-repository write grant and reconciled remote state; retain authorized local work |
| Unsupported/missing toolchain | Before behavioral implementation | Locked compatible install, runtime boot and meaningful red test |
| Contract contradiction | Before affected task | Explicit amendment, closed schema/fixtures and plan review |
| Unknown external write outcome | Before retry | Authoritative remote reconciliation with idempotency identity |
| Critical/Important review finding | Before next dependent task | Fix and scoped review verdict |
| Missing runtime/recovery evidence | Before Verified/Released status | Exact candidate passes required assertions and rehearsal |

## References checked for implementation planning

- [Cloudflare SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/): scope synchronous SQL transactions to the object's storage.
- [Cloudflare Durable Object testing](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/): use the Workers runtime for real storage/DO tests.
- [Cloudflare alarms](https://developers.cloudflare.com/durable-objects/api/alarms/): one alarm per object and at-least-once execution require durable application scheduling and replay handling.

These references were checked on 2026-10-23. Dependency selection remains a reproducible implementation task, not a claim that a package version has already been installed successfully.
