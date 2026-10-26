# R2 Issue 32 — Implement immutable artifact stage, upload, commit and authorized download

Status: Implementation pending; planning review and R1 acceptance required.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans after explicit implementation authorization. Execute one issue at a time and obtain independent review. Checkboxes below describe future work, not completed implementation.

**Goal:** Implement existing issues #27–35 without splitting their transaction invariants or creating another authorization, scheduler, messaging or artifact state machine.

**Architecture:** Extend the R1 workspace SQLite command boundary. Domain state, event, scheduler marker and sanitized replay outcome commit together; Worker/R2 effects remain outside SQL and recheck current authority before finalization. Claims and artifact writes remain unavailable until their respective conservative settlement and exclusion protocols are integrated.

**Tech Stack:** Existing TypeScript/Cloudflare Worker, SQLite Durable Object, private R2, Node 24.22.1/npm 11.19.1 and locked Vitest Workers integration. No dependency upgrade is authorized by this plan.

**Spec:** Canonical unchanged [R2 plan](../superpowers/plans/2026-10-23-r2-durable-work.md), [task lifecycle](../task-lifecycle.md), [data model](../data-model.md), [OpenAPI](../../spec/openapi.json), and current [current task issue](https://github.com/trungtaottn/cf-agent-hub/issues/32). Read live issues again before execution.

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

Implement only issue #32; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** BLOCKED — #17 Verified R1 plus named prerequisites must be satisfied before implementation.
**Hard:** #31. **Interface:** #26, #24. **Evidence:** none additional.
**Branch purpose:** plan delivery only. Reconcile accepted dev and predecessor code at future pickup.

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
