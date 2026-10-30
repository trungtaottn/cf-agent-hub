# R2 Issue 27 — Implement versioned task metadata, eligibility and authorized reads

Status: Implementation pending; planning review and R1 acceptance required.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans after explicit implementation authorization. Execute one issue at a time and obtain independent review. Checkboxes below describe future work, not completed implementation.

**Goal:** Implement existing issues #27–35 without splitting their transaction invariants or creating another authorization, scheduler, messaging or artifact state machine.

**Architecture:** Extend the R1 workspace SQLite command boundary. Domain state, event, scheduler marker and sanitized replay outcome commit together; Worker/R2 effects remain outside SQL and recheck current authority before finalization. Claims and artifact writes remain unavailable until their respective conservative settlement and exclusion protocols are integrated.

**Tech Stack:** Existing TypeScript/Cloudflare Worker, SQLite Durable Object, private R2, Node 24.22.1/npm 11.19.1 and locked Vitest Workers integration. No dependency upgrade is authorized by this plan.

**Spec:** Canonical unchanged [R2 plan](../superpowers/plans/2026-10-23-r2-durable-work.md), [task lifecycle](../task-lifecycle.md), [data model](../data-model.md), [OpenAPI](../../spec/openapi.json), and current [current task issue](https://github.com/trungtaottn/cf-agent-hub/issues/27). Read live issues again before execution.

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

Implement only issue #27; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** BLOCKED — #17 Verified R1 plus named prerequisites must be satisfied before implementation.
**Hard:** #26. **Interface:** #20, #24. **Evidence:** none additional.
**Branch purpose:** plan delivery only. Reconcile accepted dev and predecessor code at future pickup.

## Issue #27 — Versioned metadata, policy and authorized reads

**Boundary / dependencies:** One reviewable metadata/eligibility unit. Hard #26; interface #20/#24; transitive #17/#19/#23. Output is not claim authority.

**Files:** Create `src/config/execution-policy.ts`, `src/tasks/commands.ts`, `src/tasks/repository.ts`, `src/tasks/history.ts`, `test/tasks/metadata.test.ts`. Serialize route/DO/event updates with #23; update `docs/task-lifecycle.md`, `docs/data-model.md` only for implemented evidence/approved amendments. No schema redesign inside this issue.

**Interfaces:**
- `validateExecutionPolicy(input:unknown):ExecutionPolicy`.
- `assertTaskEligible(tx,ctx,task:Task,agentId:string|null):EligibilityEvidence`, where `EligibilityEvidence={policyVersion:number,replaySafetyRuleId:string|null}`.
- `createTask(tx,ctx,input:TaskCreateRequest):Task`; `patchTask(tx,ctx,taskId:string,input:TaskPatchRequest):Task`; `readyTask(tx,ctx,taskId:string,input:TaskVersionRequest):TaskCommandResult`.
- `getTask(tx,ctx,taskId:string):Task`; `listTasks(tx,ctx,query:{state?:TaskState,project_id?:string,limit?:number,cursor?:CursorPayload}):PageData<Task>`.
- Produce a reusable current task visibility predicate in `repository.ts`; it must evaluate the supplied current coherent grant, not mint an ActorContext for another participant. Freeze its internal signature with #34/#36 before those consumers begin.

**Storage / invariants:** Persist every canonical Task field, server-generated ID/time, version 1, proposal version 0, current fixed retry limit, retry count 0, null execution/result/approval pointers. An internal fence sequence must survive ended runs. #24 owns exact SQL mapping. Metadata PATCH permits only title/description/project/work-role/assignment, requires at least one field and expected version, and rejects all edits outside Backlog/Ready or under approved authorization. Task list uses current project visibility and encrypted high-water continuation; no global totals or hidden IDs.

- [ ] **Tests before:** Add `create_is_server_owned_backlog` (assert version=1, proposal=0, counters/pointers), `metadata_patch_rejects_authority_fields`, `every_metadata_edit_rejects_live_or_approved_intent`, `eligibility_exact_tuple_and_null_empty_grants`, `missing_or_conflicting_policy_denies_ready`, `holds_cannot_be_cleared`, `task_pages_reauthorize_after_restart`. Seed approved/Waiting fixtures without shipping R3 APIs. Rejected input must leave task/event/outcome counts unchanged.
- [ ] **Red:** Run `npm run test:workers -- test/tasks/metadata.test.ts`; require nonzero collection and a failure on the intended absent behavior, not a missing test glob.
- [ ] **Implement:** Use installed trusted policy and current actor time. Preserve null versus empty project grants, active reference checks and exact assignment eligibility. Reserve IDs outside SQL; let wrapper store event/outcome once. Reads remain scoped at every join; encode cursor only outside SQL then recheck current access before response.
- [ ] **Green/refactor:** Rerun focused command and `npm run typecheck`; restart DO between page1/page2 and before replay; revoke access and assert no returned hidden resource. Inject execute abort to prove task/event/outcome rollback.
- [ ] **Review/commit:** Independent reviewer checks all PATCH fields, no default/unlimited policy and no authorization from role labels. Record exact source SHA, nonzero counts and observed results; commit only owned files as `feat(tasks): add versioned metadata and eligibility`.

**Done / evidence / handoff:** Focused assertions and current-authority replay pass; generated contract matches; authorized read/list consumers receive the exact DTO. Hand #28 current guards and #29 eligibility evidence. No runtime availability or round acceptance claim.

**D-HISTORY — unresolved public read contract (blocks full history acceptance):** Existing OpenAPI exposes current Task.result, getRun and sanitized events, but no prior-result summary/artifact-list read operation after requeue clears current result. Retained SQL evidence is not automatically public API. #20 owns the additive public history decision, #23 generated/route/cursor contract, #27 authorized query and #35 retained result projection after that freeze. Their plans may consult successor requirements without waiting for implementation. No agent may invent a private endpoint, extra Task fields or a task-history cursor. Until reviewed, #42 may render current Task.result and canonical sanitized event/run evidence only and must label full historical result retrieval unavailable; this partial surface does NOT satisfy historical-result acceptance or close #42/#49. Required amendment must define exact DTO/operation, current visibility, bounded pagination, result/artifact provenance and negative fixtures before full history implementation.
