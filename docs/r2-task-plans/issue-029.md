# R2 Issue 29 — Enforce atomic claim, WIP, fences and execution lease renewal

Status: Implementation pending; planning review and R1 acceptance required.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans after explicit implementation authorization. Execute one issue at a time and obtain independent review. Checkboxes below describe future work, not completed implementation.

**Goal:** Implement existing issues #27–35 without splitting their transaction invariants or creating another authorization, scheduler, messaging or artifact state machine.

**Architecture:** Extend the R1 workspace SQLite command boundary. Domain state, event, scheduler marker and sanitized replay outcome commit together; Worker/R2 effects remain outside SQL and recheck current authority before finalization. Claims and artifact writes remain unavailable until their respective conservative settlement and exclusion protocols are integrated.

**Tech Stack:** Existing TypeScript/Cloudflare Worker, SQLite Durable Object, private R2, Node 24.22.1/npm 11.19.1 and locked Vitest Workers integration. No dependency upgrade is authorized by this plan.

**Spec:** Canonical unchanged [R2 plan](../superpowers/plans/2026-10-23-r2-durable-work.md), [task lifecycle](../task-lifecycle.md), [data model](../data-model.md), [OpenAPI](../../spec/openapi.json), and current [current task issue](https://github.com/trungtaottn/cf-agent-hub/issues/29). Read live issues again before execution.

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

Implement only issue #29; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** BLOCKED — #17 Verified R1 plus named prerequisites must be satisfied before implementation.
**Hard:** #26, #28. **Interface:** #27. **Evidence:** none additional.
**Branch purpose:** plan delivery only. Reconcile accepted dev and predecessor code at future pickup.

## Issue #29 — Atomic claim, WIP, fencing and renewal

**Boundary / dependencies:** Keep the full claim invariant in one issue. Hard #26/#28; interface #27. **Exposure gate:** claims remain unavailable until #30 and #31 integrate; this is an exposure dependency, not a circular code dependency.

**Files:** Create `src/tasks/claim.ts`, `src/tasks/lease.ts`, `test/tasks/claim-concurrency.test.ts`, `test/tasks/lease-boundary.test.ts`. Serialize DO/routes/event/scheduler-marker integration; consume #24 schema, do not change its applied migration.

**Interfaces:** `claimTask(tx,ctx,taskId:string,input:TaskClaimRequest,verified:VerifiedRuntime):TaskCommandResult`; `heartbeatRun(tx,ctx,runId:string,input:RunHeartbeatRequest,verified:VerifiedRuntime):Run`; `assertActiveRun(tx,ctx,taskId:string,runId:string,fence:number,verified:VerifiedRuntime):Run`; `getRun(tx,ctx,runId:string):Run`.

**Contract:** Claim request has expected_version and runtime_instance_id. Renewal has expected_run_version and fence. Guard current credential/runtime/agent/epoch, exact task/run pointer, state, assignment, policy, WIP, fence and `now < lease_expires_at`. Persist captured policyVersion/replaySafetyRuleId before execution. Unswept expired rows still count toward WIP until #30 ends them. Increase task-local fence; new run version1; lease now+60,000 ms. Renewal changes run version/lease only.

- [ ] **Tests before:** `two_claims_one_run`, `two_tasks_last_wip_slot`, `archive_racing_claim_has_one_valid_order`, `same_agent_wrong_runtime_denied`, `expiry_at_deadline_before_alarm` at deadline−1/0/+1 ms, `delayed_dispatch_samples_transaction_time`, `heartbeat_only_changes_run_version`, `lost_response_same_key_replays_original_run`, `revocation_denies_replay`, `restored_approved_ready_stays_unavailable`.
- [ ] **Red:** `npm run test:workers -- test/tasks/claim-concurrency.test.ts test/tasks/lease-boundary.test.ts`; require real SQLite Workers fixture and controlled barrier interleavings.
- [ ] **Implement:** Reserve run identity outside SQL, atomically compare task version/state, count agent-wide active attempts, insert one active run, increment fence/task version and mark shared scheduler dirty. Unique-active-run index is defense in depth. Ended-run records never resume. Replays bypass first-execution version/state checks but still resolve current credential/proof and original-result visibility; never manufacture a new run or extend the old deadline.
- [ ] **Green/refactor:** Rerun both files plus typecheck. Restart after winning claim/lost response; assert one active run, one event/outcome, unchanged unrelated outbox and strictly increasing next fence after a later attempt. Abort after run insertion to verify atomic rollback.
- [ ] **Review/commit:** Independent reviewer inspects WIP transaction, stale-owner predicates and same-key path. Commit `feat(tasks): add atomic claims and fenced execution leases`; retain route unavailable until the settlement exposure gate.

**Done / handoff:** #30 receives exact active-owner and captured-safety contract. Scheduler marker exists but no claim is advertised before safe expiry/cancel integration. Fencing protects hub state only, not external exactly-once effects.
