# R2 Issue 35 — Submit results and require independent current-authority acceptance

Status: Implementation pending; planning review and R1 acceptance required.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans after explicit implementation authorization. Execute one issue at a time and obtain independent review. Checkboxes below describe future work, not completed implementation.

**Goal:** Implement existing issues #27–35 without splitting their transaction invariants or creating another authorization, scheduler, messaging or artifact state machine.

**Architecture:** Extend the R1 workspace SQLite command boundary. Domain state, event, scheduler marker and sanitized replay outcome commit together; Worker/R2 effects remain outside SQL and recheck current authority before finalization. Claims and artifact writes remain unavailable until their respective conservative settlement and exclusion protocols are integrated.

**Tech Stack:** Existing TypeScript/Cloudflare Worker, SQLite Durable Object, private R2, Node 24.22.1/npm 11.19.1 and locked Vitest Workers integration. No dependency upgrade is authorized by this plan.

**Spec:** Canonical unchanged [R2 plan](../superpowers/plans/2026-10-23-r2-durable-work.md), [task lifecycle](../task-lifecycle.md), [data model](../data-model.md), [OpenAPI](../../spec/openapi.json), and current [current task issue](https://github.com/trungtaottn/cf-agent-hub/issues/35). Read live issues again before execution.

## Global Constraints

- Source inspection baseline: PR #93 candidate `4c8e487eee7b8a3d4f76562ecca2369819aa0a9a`; `dev` was `fcbe6139c65f9baafee9804a5c50867a1fcc0968`. This plan is stacked on the unmerged candidate; rebase/reconcile after maintainer integration.
- Every issue here remains **blocked for implementation** by R1 acceptance #17 and its transitive issue prerequisites. Planning now does not clear that gate, approve amendment #20, or mark a route available.
- Reuse `CommandContext`/`ActorContext` from `src/workspace/context.ts`, `executeCommand`/`CommandDescriptor<B,T>` from `src/workspace/commands.ts`, and synchronous `WorkspaceTransaction`. No network, crypto await, bucket call or async descriptor may escape into SQL.
- Task states: `backlog, ready, doing, waiting, review, done, cancelled`. Run statuses: `active, paused, submitted, failed, expired, cancelled`. Every ended run has `ended_at`; no ended run resumes.
- Execution lease 60 seconds; recommended heartbeat 20 seconds; runtime presence 90 seconds. Deadline is exclusive: `now >= deadline` denies even before an alarm. Successful outcome retention is at least 24 hours.
- JSON envelope 65,536 UTF-8 bytes; references 8,192 serialized UTF-8 bytes; individual artifact 10,485,760 bytes; maximum five attachments and aggregate 26,214,400 bytes; task/event pages default 50, ceiling 200.
- Missing policy never means unlimited execution. Use reviewed #20 policy exactly: WIP 1–100, retry limit 0–10, artifact upload TTL 60–3600 seconds, explicit exact eligibility tuples, trusted preexecution replay-safety evidence.
- One active run per task, monotonic task-local fence, stable principal AND agent independence for acceptance. Runtime proof stays separate from actor display/identity; `refreshActor` currently rejects agent `runtimeId !== null`.
- No hold-clear, retry-budget reset, auto-accept, public object URL, arbitrary bucket/key authority or generic state PATCH. R3 request-decision and approval branches stay unavailable, including restored approved Ready tasks.
- Schema owner #24 produces the next migration (8 only while baseline remains 7), table registry and typed row contract. Consumers do not edit an already-integrated migration; coordinate a forward migration with that owner if an omission is found.

## Current source and integration facts

| Verified owner | Existing behavior / extension obligation |
| --- | --- |
| `src/workspace/commands.ts` | Samples trusted clock inside SQL; re-resolves identity/current installation and maintenance generation; current access before replay; descriptor executes once; wrapper owns event/outcome. Event cases are R1-closed until #23. |
| `src/storage/transaction.ts` | `transactionSync`; rejects thenables and invalidates escaped transaction references. Preserve both protections. |
| `src/outbox/scheduler.ts` | `OutboxScheduler.nextDue` currently inspects outbox only. #30 extends this owner and the existing alarm, not a parallel alarm coordinator. |
| `src/recovery/maintenance.ts` | `AdmissionFence={authorityEpoch,maintenanceGeneration}`; stale effects across same-epoch maintenance are denied. Artifact operations must reserve and drain effects, not merely check once before an await. |
| `src/messages/commands.ts`, `references.ts`, `reads.ts` | Explicitly reject task/artifact references; create and read DTOs hardcode `artifact_ids:[]`. #34 must change admission, visibility and projection together. |
| `src/auth/authorize.ts` | Agent grant lookup joins `static_agents`; #25 owns canonical dynamic identity adoption. Consumers must use the resulting single live-grant reader, not duplicate static/dynamic lookups. |
| `src/workspace/context.ts`, `wrangler.jsonc` | Only `RECOVERY_BUCKET` is currently typed/bound. Product artifact storage is not implemented. #32 must add a reviewed product binding contract; it must not silently expose the recovery bucket through product APIs. |
| `vitest.workers.config.ts` | New tasks/artifacts/config suites are not discovered yet. #23 must install correct-runtime discovery before any focused command can count as evidence. |

## Review Focus

1. Response-loss replay after a run ended must return the original authorized outcome without reapplying its old preconditions; revocation still denies. Owned by #29/#31/#35.
2. A new affected catalog reference appearing after preview must invalidate the whole apply, not evade the captured-version checks. Owned by #28.
3. Delayed upload/delete effects straddling maintenance must not corrupt a complete capture. Owned by #32/#33 and repeated by #39.
4. Message visibility must include current embedded-resource access for each coherent grant, not merely thread membership. Owned by #34.
5. A same-agent reviewer with another credential/principal alias must still fail independence; archived stable identity remains inspectable. Owned by #35.

## Shared interface and ownership contract

The public DTO names and fields below are existing OpenAPI contracts; their generated TypeScript availability is produced by #23. `NativeDTO<K>` is an alias, not another DTO schema. `PageData<T>={items:readonly T[],next:CursorPayload|null,hasMore:boolean}` is internal; HTTP alone encrypts cursors and wraps existing envelopes.

`tx` means `WorkspaceTransaction`; `ctx` means `CommandContext`. `VerifiedRuntime={runtime:Runtime,credentialId:string,authorityEpoch:number}` is produced only by #26 after current proof checks inside the same transaction that consumes it; never cache it across transactions or awaits. Raw proof never enters context, log, event, outcome or exported row. For async work use trusted `AuthWorkspace`, `VerifiedIdentity`, command admission fence, and hashed proof material; reconstruct current transaction context after each await.

**Schema coordination proposal (#24 review gate):** Single-owner names are `tasks` (including durable `next_fence`), `runs` (including issuing credential/epoch and captured retry-safety evidence), `task_results`, `result_artifacts`, `task_acceptances`, `task_history`, `artifacts`, `artifact_generations`, `artifact_associations`, and `message_artifacts`. Generation rows carry unique server object key, expected digest/size, reserved/uploaded/committed/tombstoned state and admission epoch/generation; they need persisted effect-in-flight/drained evidence and observed digest/size before selected generation can be committed. Acceptance needs resulting task version and result/run identity. This is a coordinated schema proposal, not a second independently applied migration; #24 must include these fields and typed registry coverage before consumer implementation.

**Shared-file integrator:** #23 owns initial `src/http/r2-routes.ts`, generator/event definitions and test discovery; each downstream issue provides a narrowly scoped patch for serialized integration into those files, `src/workspace/workspace-do.ts`, and `src/audit/events.ts`. #27 creates task commands/history/repository; #31 and #35 modify those only after their dependencies merge. #29 creates lease; #30/#31 consume it sequentially. #30 owns scheduler extension; #33 adds its artifact source after #30. #24 alone owns migration/registry DDL. No concurrent writers to these shared files.

Use proposed descriptor factories local to each new domain module to adapt these synchronous functions to `executeCommand`; they must retain `resource/checkAccess/checkReplay/execute` separation. A replay access predicate checks current returned-resource visibility, not current task version or an already-ended run's original active status. Exact current ownership belongs to first execution. Reviewed #23 must settle event-case names and system-expiry event construction before consumers compile; do not fabricate a caller-controlled system actor.


## Pickup scope and exact prerequisites

Implement only issue #35; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** BLOCKED — #17 Verified R1 plus named prerequisites must be satisfied before implementation.
**Hard:** #33, #31. **Interface:** #32, #29. **Evidence:** none additional.
**Branch purpose:** plan delivery only. Reconcile accepted dev and predecessor code at future pickup.

## Issue #35 — Result submission and independent acceptance

**Boundary / dependencies:** Hard #33/#31; interface #32/#29. Submission/acceptance stay one issue because stable attribution is their shared invariant.

**Files:** Create `src/tasks/results.ts`, `test/tasks/independent-review.test.ts`; modify `src/tasks/history.ts`, `test/tasks/cancellation-race.test.ts`, serialized routes/DO/events; docs lifecycle/data model/HTTP. #24 owns result/acceptance rows and retained artifact associations.

**Interfaces:** `submitTaskResult(tx,ctx,taskId:string,input:TaskSubmitResultRequest,verified:VerifiedRuntime):TaskCommandResult`; `acceptTaskResult(tx,ctx,taskId:string,input:TaskReasonRequest):TaskCommandResult`. Submission request has expected_version/run_id/fence/result, result is `Checkpoint={summary,artifact_ids}`. Persist canonical `TaskResult={summary,artifact_ids,run_id,submitted_by:Actor,submitted_at}`. Acceptance stores reviewer stable principal/agent, reason, result/run identity, resulting task version/time internally; do not invent public Task fields.

- [ ] **Tests before:** `submit_only_enters_review_and_releases_lease`, `same_principal_or_agent_cannot_accept`, `alternate_credential_runtime_or_archived_identity_cannot_launder_submitter`, `independent_native_and_human_reviewers_succeed`, `concurrent_reviewers_one_acceptance`, `real_cancel_before_submit_denies_owner`, `real_submit_before_cancel_retains_evidence`, `requeue_invalidates_current_not_history`, `invalid_artifact_result_is_atomic`, `lost_response_submit_accept_replay_no_second_transition`.
- [ ] **Red:** `npm run test:workers -- test/tasks/independent-review.test.ts test/tasks/cancellation-race.test.ts`; use actual commands for both orderings, not only #31 fixtures.
- [ ] **Implement:** Check current active run/proof/fence and expected task version; validate committed associations and bounds; persist immutable submitter identity, end run submitted, clear active pointer, enter Review in one transaction. Acceptance requires current tasks:review, result/task version, project/artifact visibility and reviewer differing on both stable identity axes. Commit Done plus distinct immutable acceptance evidence. Historical attribution survives archive/rotation/requeue; no overwrite of prior result.
- [ ] **Green/refactor:** Same tests plus typecheck; restart between submission/review and before replay, revoke reviewer before replay, assert denial under current access. Concurrent reviews yield one result/acceptance event/outcome; stale competitor changes nothing. ACK/comments/webhook success do not enter Done.
- [ ] **Review/commit:** Reviewer inspects both identity comparisons, retention associations and terminal transition. Commit `feat(tasks): require independent acceptance of submitted results`.

**Done / handoff:** #42 board and #40 isolation receive current Task/Run/result projection, not inferred approval. Two-agent journey is source evidence only; exact candidate live acceptance remains #49.

## Regression, evidence and agent pickup protocol

For each issue after green, run `npm run verify:generated`, `npm run typecheck`, then the repository's `npm run check` at serialized integration. Run docs/plan validators with the installed Python executable (this planning workspace has no `python` alias; do not treat command-not-found as a pass). Do not use empty-test success or weaken assertions. Source, browser, isolated deployment and release evidence remain separate.

Record issue, base/head SHA, changed files, actual command/exit/nonzero test counts, deterministic interleaving or fault injected, persisted-state assertion, reviewer identity/findings and remaining gates. A focused suite is not a security exception or operator release approval. Preserve old receipts; append new exact-candidate evidence.

**Agent handoff prompt:** “Read AGENTS.md, live issue #N and this plan's #N section; confirm R1 #17 acceptance, all named hard dependencies, reviewed #20/#23/#24 contracts and current `ai-handle` + `ready to cook` pickup or explicit narrow owner assignment. Reconcile candidate SHA and file ownership. Implement only #N red/green steps in isolated branch; stop on an unresolved interface/permission/evidence gate. No issue closure, implementation push, deployment, credential creation or merge absent separate authority. The user's later authorization for plan-only issue branches/comments does not authorize implementation or round-gate changes. Report exact diff/test evidence and request independent review before handing off.”

## Open design seams requiring reviewed resolution

1. Product artifact binding is absent today. Proposed separate ARTIFACT_BUCKET must be approved in the #20/#23/#32 interface review; actual cloud resource provisioning remains an operator action outside code task scope.
2. Exact SQL row/column/index names, lifecycle event names and trusted system-expiry event seam are produced by #23/#24. Consumers must not independently invent alternatives. Current source only proves R1 names.
3. Incremental SHA-256 implementation and persisted R2-effect drain protocol must be demonstrated against the locked runtime before #32 exposure. Unsupported library assumptions or bounded-buffer claims without measurement block that gate.
4. No change to canonical product behavior is requested here. If a proposed internal seam changes public behavior, return to its owning contract issue rather than claiming owner approval.

**Planning verification only:** source/issues/schema inspection and local Markdown authorship were performed. No R2 implementation or future test command above has run. All nine issue checklists remain unchecked.
