# Durable Execution Implementation Plan

Status: Implementation pending; planning review and R1 acceptance required.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans after explicit implementation authorization. Execute one issue at a time and obtain independent review. Checkboxes below describe future work, not completed implementation.

**Goal:** Implement existing issues #27–35 without splitting their transaction invariants or creating another authorization, scheduler, messaging or artifact state machine.

**Architecture:** Extend the R1 workspace SQLite command boundary. Domain state, event, scheduler marker and sanitized replay outcome commit together; Worker/R2 effects remain outside SQL and recheck current authority before finalization. Claims and artifact writes remain unavailable until their respective conservative settlement and exclusion protocols are integrated.

**Tech Stack:** Existing TypeScript/Cloudflare Worker, SQLite Durable Object, private R2, Node 24.22.1/npm 11.19.1 and locked Vitest Workers integration. No dependency upgrade is authorized by this plan.

**Spec:** Canonical unchanged [R2 plan](../2026-10-23-r2-durable-work.md), [task lifecycle](../../../task-lifecycle.md), [data model](../../../data-model.md), [OpenAPI](../../../../spec/openapi.json), and current [issues #27–35 snapshot](research/issues-execution.json). Read live issues again before execution.

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

## Issue #28 — Immutable catalog preview and atomic lifecycle apply

**Boundary / dependencies:** One bounded preview/apply transaction protocol. Hard #27/#25; interface #20. Ordinary profile preview remains advisory and nonpersisted.

**Files:** Create `src/config/catalog-commands.ts`, `test/config/catalog-lifecycle.test.ts`; modify `src/config/settings-service.ts`, `src/config/profile.ts`, serialized routes/DO/events; docs `customization.md`, `configuration.md`, `http-api.md`.

**Interfaces:** `previewCatalogChange(tx,ctx,input:CatalogPreviewRequest):CatalogPlan`; `applyCatalogChange(tx,ctx,input:CatalogApplyRequest):ProfileView`. Consume #20 exact schema: preview binds expected profile revision, kind project/work_role, source ID, archive/remap, nullable replacement and reason; apply binds preview ID and expected profile revision. 15-minute expiry; ceiling 200 affected resources. Persist immutable plan plus every affected version and the complete reference-set predicate.

**State invariants:** Archive has null replacement; retains old references, prevents new selection/claim. Remap requires distinct active same-kind destination, permits only Backlog/Ready without approved intent plus explicitly listed agent metadata, preserves terminal/history references. Any live Doing/Waiting/Review, hidden resource, changed version, newly introduced affected record or policy-rule rewrite rejects the whole apply. Human `profile:edit` plus `tasks:edit`/`agents:manage` when those resources change. Presets cannot reactivate archived IDs.

- [ ] **Tests before:** `stable_upsert_preserves_omitted_ids`, `archive_retains_history_blocks_selection`, `remap_rejects_live_approved_or_policy_rewrite`, `preview_binds_complete_affected_set` (introduce an affected task after preview), `stale_task_agent_profile_or_expired_plan_rejects_all`, `preview_200_201_boundary`, `profile_import_cannot_unarchive`.
- [ ] **Red:** `npm run test:workers -- test/config/catalog-lifecycle.test.ts`; collect nonzero tests and record intended failing assertion.
- [ ] **Implement:** Persist preview under command wrapper; at apply requery the entire affected set and compare exact IDs/versions, current permissions and expiry at transaction time, then update all eligible rows/profile in the same transaction. A conflict requires a new preview; never rebase silently or apply a subset. Preserve original accepted outcome on authorized same-key replay.
- [ ] **Green/refactor:** Same focused command plus `npm run typecheck`. Inject failure after first remap write: profile/tasks/agents/event/outcome unchanged. Restart before apply, expire at boundary, race two applies, and confirm one outcome.
- [ ] **Review/commit:** Independent reviewer checks reference-set completeness, hidden-conflict redaction and every update predicate. Commit `feat(catalog): add bounded version-bound lifecycle plans`.

**Done / handoff:** #29 may rely on archived references being unclaimable. Evidence includes both old-reference retention and post-preview new-reference conflict. No policy editor or new `profile:apply` endpoint.

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

## Issue #30 — Conservative failure/expiry and one shared scheduler

**Boundary / dependencies:** Hard #29; interface #20. Own expiry integration into the existing scheduler including outbox preservation.

**Files:** Create `src/tasks/failure.ts`, `test/tasks/failure-recovery.test.ts`; modify `src/outbox/scheduler.ts`, `scheduler-state.ts`, `src/workspace/workspace-do.ts`, serialized events/routes; consume `src/recovery/maintenance.ts`; docs lifecycle/delivery semantics.

**Interfaces:** `failTask(tx,ctx,taskId:string,input:TaskFailRequest,verified:VerifiedRuntime):TaskCommandResult`; `expireDueRuns(tx,nowMs:number,limit:number):{processed:number,nextDueAt:number|null}`, limit1–200. System expiry uses reviewed #23 trusted system-event construction and no client identity. Extend current `OutboxScheduler.repairSchedule/runDueWork`; compute earliest of outbox/lease sources and later #33 artifact source.

**State contract:** End active run failed/expired with ended_at, clear active pointer, keep latest/history. Explicit unknown outcome always → Backlog+outcome_unknown, retry_count unchanged. Without captured replay-safe evidence expiry is unknown. Known safe failure consumes one additional retry only if count<fixed limit; otherwise Backlog+retry_exhausted. WIP frees only with ended status. Failure reason is inert/redacted, not policy.

- [ ] **Tests before:** `unclassified_expiry_is_unknown`, `runtime_cannot_declare_safety_after_expiry`, `unknown_overrides_safe_policy`, `safe_limit_two_counts_1_2_then_exhausts`, `limit_zero_exhausts_first_failure`, `duplicate_alarm_restart_never_double_charges`, `mixed_outbox_and_lease_due_work_survives_failure`, `same_epoch_maintenance_invalidates_delayed_due_work`.
- [ ] **Red:** `npm run test:workers -- test/tasks/failure-recovery.test.ts`; assert nonzero collection and absent behavior.
- [ ] **Implement:** Process bounded authoritative SQL transitions, mark shared generation for scheduling changes, preserve remaining due work on failure and use bounded diagnostics. Recheck admission epoch/generation in each unit. Keep async outbox dispatch after commit; do not overwrite alarm with a lease-only value or clear another source's dirty generation. Never call a future undefined artifact sweeper; #33 adds that source later.
- [ ] **Green/refactor:** Focused test plus `npm run test:workers -- test/outbox/alarm.test.ts test/outbox/recovery.test.ts`; typecheck. Restart between committed units and retry alarm. Assert task/run/history/events, retry/WIP and outbox due state, not just HTTP status.
- [ ] **Review/commit:** Reviewer checks safe-versus-unknown truth table, one shared alarm and absence of client system actor. Commit `feat(tasks): settle attempts with conservative retry holds`.

**Done / handoff:** #31 consumes persisted ended-run/hold semantics. Failed processing remains due and stale owners still fail at command time. #29 exposure remains closed until #31 cancellation is integrated.

## Issue #31 — Cancel and requeue preserving history

**Boundary / dependencies:** Hard #30; interface #27. Do not create another task command module.

**Files:** Modify dependency-owned `src/tasks/commands.ts`, `src/tasks/lease.ts`, serialized routes/DO/events; create `test/tasks/cancellation-race.test.ts`; update `test/tasks/failure-recovery.test.ts` and lifecycle/data-model docs.

**Interfaces:** `requeueTask(tx,ctx,taskId:string,input:TaskReasonRequest):TaskCommandResult`; `cancelTask(tx,ctx,taskId:string,input:TaskReasonRequest):TaskCommandResult`. Input has expected_version and nonempty reason. Requeue only Review/Backlog with tasks:schedule and normal readiness guards; cancel any nonterminal state with tasks:cancel.

- [ ] **Tests before:** `requeue_preserves_budget_holds_and_history` (both holds reject, not clear), `cancel_each_nonterminal_reject_terminal`, `stale_or_foreign_cancel_has_no_effect`, `cancel_invalidates_active_run_and_pending_decision`, `lost_response_cancel_replays_original`, `cancel_review_retains_submitted_fixture`. Use persisted synthetic submitted/Waiting fixtures now; real submit command race belongs to #35.
- [ ] **Red:** `npm run test:workers -- test/tasks/cancellation-race.test.ts test/tasks/failure-recovery.test.ts`.
- [ ] **Implement:** End active run cancelled/ended_at, clear pointer, invalidate only current result/approval pointers, retain all historical evidence and retry counters. Cancel pending decision records atomically without introducing an R3 decision endpoint. Mark scheduler dirty with ownership changes. Version conflict changes no row/event/outcome.
- [ ] **Green/refactor:** Same tests plus typecheck. Restart after cancel; old heartbeat must fail. Race two commands at one version, inject abort between run/task updates and assert no partial cancellation. Requeue creates no run and does not enlarge retry budget.
- [ ] **Review/commit:** Reviewer checks allowed source states, all current-pointer writes and preserved history. Commit `feat(tasks): add history-preserving cancellation and requeue`.

**Done / exposure handoff:** Independently review #29–31 as an integrated claim/expiry/cancel path before enabling claim routes. #35 must replace fixture-only submit/cancel ordering evidence with real commands; do not claim that race proven by #31 alone.

## Issue #32 — Immutable artifact lifecycle and authorized reads

**Boundary / dependencies:** Hard #31; interface #26/#24. Keep stage/reservation/upload/selection/commit in one protocol. **Exposure gate:** artifact writes unavailable until #33 proves cleanup exclusion.

**Files:** Create `src/artifacts/commands.ts`, `src/artifacts/content.ts`, `test/artifacts/commit-integrity.test.ts`; modify serialized routes/DO/events, `src/workspace/context.ts`, `wrangler.jsonc` configuration types/test binding and docs HTTP/limits/data model. Do not provision a bucket or inject credentials.

**Interfaces:** `stageArtifact(tx,ctx,input:ArtifactStageRequest,verified:VerifiedRuntime|null):Artifact`; `authorizeArtifactRead(tx,ctx,artifactId:string):{artifact:Artifact,objectKey:string}`; `assertCommittedArtifacts(tx,ctx,ids:string[]):Artifact[]`; `getArtifact(tx,ctx,id:string):Artifact`; `listArtifacts(tx,ctx,query:{task_id?:string,limit?:number,cursor?:CursorPayload}):PageData<Artifact>`.
Async entrypoints `uploadArtifactContent(ctx:ArtifactOperationContext,artifactId:string,body:ReadableStream<Uint8Array>,idempotencyKey:string):Promise<Artifact>` and `commitArtifact(ctx:ArtifactOperationContext,artifactId:string,input:ArtifactCommitRequest):Promise<Artifact>` use an **internal trusted artifact operation context**, not stale CommandContext. Proposed exact local type in `src/artifacts/content.ts`: `ArtifactOperationContext={workspace:AuthWorkspace,identity:VerifiedIdentity,requestId:string,idempotencyKey:string,admission:AdmissionFence,runtimeId:string|null,proofHash:string|null}`. Freeze this internal type with #23/#26; derive each command fingerprint from the exact staged manifest/content identity rather than adding client authority. Current CommandContext is reconstructed at each SQL boundary; call #26 `requireRuntimeProof` inside that same transaction to obtain a fresh VerifiedRuntime, and require the explicit upload key to equal ctx.idempotencyKey. Do not expose this context as a DTO.

**Reviewed interface proposal, not existing configuration:** Add typed `ARTIFACT_BUCKET:R2Bucket` (the recovery adapter receives the same product binding as its proposed `artifactBucket` property, separate from its recovery destination) as a separate product binding and deterministic test resource. The deployment operator must approve the actual isolated resource mapping before live verification. Never reuse `RECOVERY_BUCKET` implicitly, accept caller object keys, provision infrastructure, or mark availability when binding/required policy is absent.

**Persisted protocol from #24:** Artifact DTO fields plus expected manifest; immutable generation reservation and state; selected generation; owner credential/runtime/epoch/fence; admission generation; upload digest/key replay identity; durable expired tombstone; association records. Exact DDL is the #24 interface gate. Stage returns version1 and TTL from trusted policy. Upload is octet-stream; stage body has task_id/run_id/filename/media_type/byte_size/sha256; commit only expected_artifact_version. No client fence substitution at commit.

- [ ] **Tests before:** `size_limit_minus_one_equal_plus_one`, `streamed_digest_and_length_match_manifest`, `native_unbound_requires_proof`, `human_cannot_bind_foreign_run`, `revocation_expiry_or_maintenance_during_verify_denies_commit`, `crash_put_before_sql_is_unavailable`, `late_upload_never_overwrites_committed_generation`, `same_key_same_bytes_reconciles_changed_digest_conflicts`, `authorized_list_get_content_only` (including task_id filter, confidential continuation, and cursor/filter mismatch denial), `five_six_and_aggregate_attachment_limits`.
- [ ] **Red:** `npm run test:workers -- test/artifacts/commit-integrity.test.ts`; tests use deterministic private bucket adapter/integration fixture and barriers around put/verify/SQL.
- [ ] **Implement:** Reserve fresh server key per accepted write; stream bounded buffers with independent digest/size verification. Persist in-flight effect reservations before R2; a maintenance capture must drain/reconcile them before asserting quiescence. Select exact generation in SQL only after current authority, state/version/deadline and admission checks. Commit verifies selected immutable bytes outside SQL, then repeats checks and wins CAS against expiry tombstone. Never overwrite a selected committed key. Reads require current workspace/project/association access, committed status and safe attachment headers; keys stay internal.
- [ ] **Green/refactor:** Same test plus typecheck. Restart at reservation/put/selection/commit checkpoints. For a response lost after SQL, same-key replay returns original metadata without another generation/commit. Duplicate artifact IDs and aggregate referenced size reject; no committed read from object existence alone. Verify no R2 call occurs inside WorkspaceTransaction.
- [ ] **Review/commit:** Reviewer traces one byte generation through all boundaries, confirms true incremental/bounded streaming support in locked runtime, and rejects any check-then-overwrite or unbounded digest buffer. Commit `feat(artifacts): add immutable staged upload and verified commitment`; keep exposure closed.

**Done / handoff:** #33 receives exclusion/reservation protocol and immutable generation identity; #34/#35 receive committed visibility helper. If incremental hashing support or binding ownership is unresolved, stop that implementation seam and record it—do not silently add a dependency or buffer the entire stream.

## Issue #33 — Expired intents and orphan reconciliation

**Boundary / dependencies:** Hard #32; interface #30. Own consumer of the existing artifact exclusion protocol, not an alternate commit state machine.

**Files:** Create `src/artifacts/reconcile.ts`, `test/artifacts/cleanup-race.test.ts`; modify shared scheduler/DO integration sequentially; consume maintenance and #24 registry; update operations/backup-restore/data-model docs.

**Interfaces:** `expireArtifactIntents(tx,nowMs:number,limit:number):{tombstonedIds:string[],nextDueAt:number|null}`; `reconcileArtifactObjects(workspaceId:string,cursor:string|null,limit:number):Promise<{nextCursor:string|null,orphans:number}>`. Proposed internal limit is integer 1–200 for both sweeps; #20/#24 review freezes this before implementation. Reject 0/201 instead of clamping or performing unlimited scans. Cursor/key work is server-owned and never accepted from a product caller. Consume exact selected/reserved generation checks, not filename heuristics.

- [ ] **Tests before:** `tombstone_first_denies_commit_late_upload_orphans`, `commit_first_preserves_exact_bytes`, `restart_at_each_reservation_put_selection_tombstone_delete_boundary`, `delete_failure_remains_due`, `inventory_cursor_resume_is_bounded`, `retained_result_and_json_input_survive`, `maintenance_drains_inflight_delete_before_complete_capture`.
- [ ] **Red:** `npm run test:workers -- test/artifacts/cleanup-race.test.ts test/artifacts/commit-integrity.test.ts`.
- [ ] **Implement:** Atomically tombstone eligible staged/uploaded intents, reserve deletion only for proven uncommitted immutable generations, then perform deletion outside SQL under the exclusion/admission protocol. A final check before await alone is insufficient: persisted reservation/draining prevents delayed destructive effects from crossing capture completion. Retry idempotently; retain bounded diagnostic and due work after failure. Bounded inventory finds late generations using metadata plus restore inventory, never absence of a current task pointer alone. Add artifact due source into the existing scheduler without starving outbox/lease sources.
- [ ] **Green/refactor:** Same tests plus typecheck. Assert both SQL state and bucket byte existence after restart; committed accepted-result/input bytes survive every ordering. Inventory and cleanup must pause under maintenance and resume only current admission.
- [ ] **Review/commit:** Independent reviewer adversarially orders deletion/commit/capture and checks retained-reference guards. Commit `feat(artifacts): reconcile expired intents without committed-byte loss`.

**Done / exposure handoff:** Independently review #32/#33 together before enabling artifact writes. #39 repeats reservation-drain and complete-byte coverage with recovery; local races are not live-bucket acceptance.

## Issue #34 — Existing message lane gains task/artifact references

**Boundary / dependencies:** Hard #32; interface #27/#25. Merge after committed visibility is stable; artifact write availability still depends on #33. No new messaging lane.

**Files:** Modify `src/messages/commands.ts`, `references.ts`, `reads.ts`, `ack.ts`, `src/outbox/repository.ts`, `dispatcher.ts`, serialized events/HTTP routes; create `test/messages/r2-references.test.ts`; extend `test/messages/acceptance.test.ts`; docs HTTP/data model.

**Existing interfaces to extend, not replace:** `validateMessageReferences(tx,actor,participants,refs,artifactIds,nowMs):void`; `assertMessageVisible(tx,actor,id,nowMs):void`; `participantCanReadMessages(tx,workspaceId,participant,messageIds,nowMs,requiredScope?):boolean`; `projectMessage(tx,actor,id,nowMs):Message|null`. Consume #27 coherent-grant task predicate and #32 committed-artifact predicate; #25 supplies one canonical current grant reader.

**Invariant:** Actual caller and every fixed participant, including omitted recipients on a reply, need one live coherent grant satisfying message access AND all embedded resource scopes/projects. Never union credentials or manufacture a session. Preserve workspace-wide message access requirements. Artifact IDs persist in #24 association table and return identically on accepted/replayed/inbox/thread DTOs. Current resource access applies again on reads/replay/outbox dispatch.

- [ ] **Tests before:** `task_and_artifact_refs_roundtrip_restart`, `omitted_reply_participant_still_checked`, `split_credential_scope_union_denied`, `hidden_foreign_uncommitted_expired_reference_rejects_atomically`, `revocation_before_read_replay_dispatch_hides_embedded_refs`, `five_six_size_and_reference_byte_limits`, `ack_and_delivery_do_not_change_task`, `notification_contains_ids_only`.
- [ ] **Red:** `npm run test:workers -- test/messages/r2-references.test.ts test/messages/acceptance.test.ts`; current unavailable guards should explain initial failure.
- [ ] **Implement:** Replace only implemented-feature guards; persist associations within existing outer transaction, remove both hardcoded empty attachment projections, and validate authorized resource graph without recursive message-reference cycles/unbounded traversal. Existing thread membership never expands. Invalid reference leaves thread/message/inbox/event/outbox/outcome unchanged. Notification payload remains existing canonical ID-only version.
- [ ] **Green/refactor:** Same tests plus typecheck; restart/replay retains exact IDs. Revoke participant/caller between admission and dispatch; deny/suppress under existing policy without leaking metadata. Measure all atomic table counts and no task state change from ACK.
- [ ] **Review/commit:** Reviewer traces sender plus omitted fixed participants through one-grant predicate and dispatch/read paths. Commit `feat(messages): admit authorized committed task artifact references`.

**Done / handoff:** #36 can safely search message references; #40 consumes negative isolation cases. The issue does not activate R3 composition UI or turn a reference into a capability.

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
