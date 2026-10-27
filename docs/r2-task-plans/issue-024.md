# R2 Issue 24 — Migrate R1 identity and the complete R2 storage boundary

Status: Implementation pending; planning review and R1 acceptance required.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare reviewed contracts and one durable identity/storage boundary for R2 without widening R1 authority.

**Architecture:** Extend the existing SQLite transaction, native credential table, authenticated command wrapper, generated OpenAPI types and recovery registry. Keep runtime proof as separate server-verified evidence; never make an ID, display label or runtime field authenticate an actor. The private first-response secret is distinct from the durable sanitized outcome.

**Tech Stack:** Existing TypeScript/Workers/SQLite DO/Vitest stack; candidate pins Node 24.22.1, npm 11.19.1. Do not change dependencies to execute this plan.

**Spec:** Canonical `docs/superpowers/plans/2026-10-23-r2-durable-work.md` Tasks 1–2; `spec/openapi.json`; `docs/data-model.md`; `docs/security-model.md`; live issues #20, #23–26. Full retrieved issue snapshots are in [historical issue snapshot](https://github.com/trungtaottn/cf-agent-hub/blob/fdabd716b4af7ef0e5082e660dc2c397f003c303/docs/superpowers/plans/261026-0727-r2-agent-handoff/research/issues-identity.json) (prior evidence only; current live issue remains authority).

## Global Constraints

- Planning snapshot: PR #93 candidate `4c8e487eee7b8a3d4f76562ecca2369819aa0a9a`, based on dev `fcbe6139c65f9baafee9804a5c50867a1fcc0968`. Candidate is not accepted R1.
- **All implementation in this file is blocked.** #17 R1 acceptance is a hard entry gate, not merely R2 release evidence. #19 must be reviewed; #20–22 amendments and internal interfaces require focused review before consumers. No label promotion follows from this document.
- No implementation, deployment, credential generation, issue edit, push or merge was performed while writing this plan. All tests below are future commands, not passing evidence.
- Trust the actual transaction-time `ctx.nowMs`, `ActorContext.sessionId`, `resolveActor`, `refreshActor`, `authorize` and `WorkspaceTransaction`; no replacement authorization/replay engine.
- JSON request envelope: 65,536 UTF-8 bytes. Runtime presence: 90 seconds. Execution lease: 60 seconds. Completed idempotency retention: at least 24 hours. This minimum is not an indefinite CLI replay promise; #41/#44 enforce conservative dispatch age and fail closed after an expired/unknown window.
- Native secret and runtime proof: server-generated 256-bit opaque values; persist SHA-256 verification material only. No raw secrets in context, SQL, logs, events, exported files or replay.
- Keep portable contract_revision 0.1; snake_case public DTOs, closed request shapes, current scope/project checks, null versus [] projects, disabled R3 approval routes.
- Scope registration does not grant permission. A higher-epoch operator grant is needed for new recognized authority. No runtime execution authority is granted by schema migration.
- One owner per shared file at a time. Each issue ends at its own independent review gate; do not implement all five in one unreviewed batch.

## Review Focus

1. Higher-epoch install currently enumerates **all** native credentials as static; a human-issued row must not break installation or escape revocation. #20 decides the overlay rule; #24/#25 test it.
2. `executeCommand` canonicalizes and stores its returned `data`; adding token to normal output leaks it durably. #25 tests initial-only projection and both post-commit response loss and replay.
3. `refreshActor` rejects agent `runtimeId !== null`; #26 keeps proof separate and tests forged runtime IDs without relaxing this guard.
4. Migration preservation includes retired rows, empty project arrays, exact message/outbox payload bytes and maintenance generations, not only entity counts. #24 tests all.
5. Event/cursor expansion can leak hidden resources or inherit the wrong retention floor. #23 tests closed operation/resource maps; #36 owns mixed-search retention and confidential continuation.

## Source-grounded gap ledger

| Actual source | Observed behavior | Required delta / no-duplication rule |
| --- | --- | --- |
| `src/storage/schema-version.ts`, `migrations.ts` | Versions 1–7; frozen maintenance blocks upgrades | Allocate 8 only if still unused; never alter 1–7 |
| `src/config/bootstrap.ts:applyAuthorityRows` | Every credential requires static ref/tombstone; all known static token hashes immutable | Add explicit static/dynamic provenance and reviewed epoch behavior, not a second registry |
| `src/auth/authorize.ts:resolveActor`; `src/messages/references.ts:participantGrants` | Both join `static_agents`; epoch equality is required | Evolve that one physical table and update all current-authority consumers coherently |
| `src/workspace/commands.ts:executeCommand` | Domain, event and canonical sanitized outcome committed synchronously; no first-response channel | Add private first-execution signal; normal output remains safe |
| `scripts/generate-auth-contract.mjs` | R1 roots only, though canonical OpenAPI has Agent/Runtime/Task/etc. | Extend existing roots and validators; no hand-maintained DTO mirror |
| `src/audit/events.ts` | Four R1 event definitions, task_version/run_id/fence projected null | Closed R2 definitions with persisted evidence; no arbitrary caller event |
| `src/http/cursors.ts` | AES-GCM, operations inbox/thread/events | Extend closed operations; keep encryption and current binding |
| `vitest.workers.config.ts` | Does not include agents/runtimes/tasks/artifacts/imports/search | Explicit runtime discovery before downstream focused tests |
| `src/recovery/table-registry.ts` | Reviewed typed registry; inspectRegistry return type literally schemaVersion:7 | Update literal/version and every column/mode with schema; do not introspect captured DB into its own authority |

## Review decisions required before implementation

**D-ID-1: Dynamic credential authority across operator epochs.** Current contracts require current operator ceilings but do not define dynamic rows absent from a static bootstrap bundle. Proposed conservative amendment: classify each identity/credential as `operator_static` or `human_managed`; static rows retain exact ref/tombstone validation. A higher epoch, including restore overlay, preserves human-managed identity/history but revokes human-managed credentials and runtime proofs, requiring fresh human issuance. Never silently broaden grants or copy old dynamic credentials into a new epoch. #20 and #22 reviewers must accept this explicit behavior before #24/#25; this plan is not owner approval.

**D-ID-2: Physical registry naming.** Proposed implementation choice: evolve existing `static_agents` into the sole canonical registry, retaining its legacy table name to avoid parallel stores or a compatibility-view control plane. Public DTO remains Agent. If reviewers require rename, make one atomic schema/code migration in #24; do not run two writable registries.

**D-ID-3: Prepared one-time issuance.** Canonical illustrative `issueCredential(tx,ctx,request)` cannot safely create/hash entropy asynchronously inside SQL. Use a prepared, internal hash/ID input and a private first-execution result signal, as below; external operationId/createCredential and DTO remain unchanged.

**D-ID-4: Artifact binding and search retention.** #23 must review product `ARTIFACT_BUCKET` separately from operator `RECOVERY_BUCKET` with #32/#22. Reserve closed search cursor operation but do not apply `src/messages/reads.ts:assertCursorRetained` message floor to mixed search. #21/#36 specify per-kind retention before search activation.

The reviewed epoch rule must also advance the retained active human_managed agent row to the newly installed config_epoch while preserving archived/disabled state and never granting scopes; old credentials/proofs remain revoked. Fresh human issuance then uses the current operator ceiling and can enroll a fresh runtime. Add higher_epoch_then_fresh_human_issuance_and_runtime_succeeds alongside old_credential_and_proof_denied and archived_identity_not_resurrected. This is part of proposed D-ID-1, not an approved behavior change.

## Ownership and dependency contract

| Issue | Hard entry | Interface gate | Output consumer |
| --- | --- | --- | --- |
| #20 | #17, #19 | Current R1 profile/bootstrap contracts | #23, #25, #27–31 |
| #23 | #17 | #20, #21, #22 accepted shapes | #24 and every domain/adapter |
| #24 | #19, #23 | #22 restore modes; #27–37 table consumer manifest | #25–39, #43 |
| #25 | #24 | #20 human-only scope/ceiling rules | #26, #28, #34 |
| #26 | #25 | #24 runtime persistence | #27, #29, #32, #41 |

The table preserves issue dependency classes. A producer's reviewed interface may be consumed in parallel only where its hard edges allow it. #20–22 shared OpenAPI/fixture/config integration is serialized by #23 integration owner. #24 exclusively owns migration and table registry. #25 owns bootstrap/auth and secret response extension; #26 follows rather than concurrently editing those files.

---


## Pickup scope and exact prerequisites

Implement only issue #24; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** BLOCKED — #17 Verified R1 plus named prerequisites must be satisfied before implementation.
**Hard:** #23, #19. **Interface:** none additional. **Evidence:** none additional.
**Branch purpose:** plan delivery only. Reconcile accepted dev and predecessor code at future pickup.

## Task #24 — One forward schema and complete recovery registry

**No successor cycle:** Consult #27–37 planners for provisional column/index/restore requirements before this storage freeze; do not require those successor implementations to exist or be complete. Review of a schema proposal is an interface activity, not a runtime dependency.

**Files**
- Create `src/storage/migrations/0008-durable-work.sql` **only if version 7 is still latest**, `test/storage/r2-durable-migration.test.ts`, and reviewed storage manifest `validation/r2-storage-contract.json`.
- Modify `src/storage/migrations.ts`, `src/storage/schema-version.ts`, `src/recovery/table-registry.ts`, `src/recovery/encoding.ts`, `src/config/bootstrap.ts`, `docs/data-model.md`, `test/storage/workspace-bootstrap.test.ts`.
- Historical migration files 0001–0007 are read-only. Schema corrections after integration allocate a new forward version.

**Schema agreement before SQL**
Use SQL TEXT for IDs/JSON/digests/enums, INTEGER for UTC-millisecond times/versions/counters/booleans, nullable only where the canonical DTO allows it or the manifest names it. Each new domain row carries workspace_id and a scoped unique key; cross-resource joins require workspace agreement. JSON columns have json_valid checks; schema validator owns their full closed shape.

| Family | Required normalized fields / constraints | Restore handling |
| --- | --- | --- |
| Existing static_agents, evolved in place | Preserve agent_id/workspace_id/display_name/config_epoch; add origin, agent_version>=1, description, work_role_ids_json, nullable framework/model, status active/archived, created_at/updated_at | Restore history; overlay current authority; archived cannot reactivate |
| Existing native_credentials | Preserve all existing hash/scope/project/epoch/retirement columns; add origin, credential_version>=1,label,created_at, nullable revoked_at and issued_by_principal_id | Static current ledger overlays; dynamic behavior requires D-ID-1 |
| runtimes | id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version>=1,label,status,created_at,last_seen_at,presence_expires_at,nullable revoked_at | Invalidate authority; retain attribution, never restore usable proof |
| tasks | Canonical Task scalar fields, flags_json, nullable current_result_id; result lives in result/history rows; next_fence>=1 | Restore semantic state; #43 invalidates Doing authority and preserves holds |
| runs | Canonical Run fields + credential_id,authority_epoch, nullable replay_policy_version/replay_rule_id/replay_evidence_ref | Unique partial (workspace_id,task_id) WHERE status=active; ended_at null iff active |
| task_results; result_artifacts | Result id/workspace/task/run, stable submitting principal/agent, summary,created_at; result_artifacts result/artifact/ordinal, max five enforced by domain | Retain immutable submission and committed evidence |
| task_acceptances; task_history | Acceptance binds task/result/run/resulting task_version and stable reviewer principal/nullable agent/reason/time; history binds event/task/version/nullable run/kind/time | Restore history; not executable approvals |
| artifacts; artifact_generations | Canonical Artifact metadata + creator credential/runtime/epoch and nullable active/committed generation IDs; generation has immutable object_key, expected and nullable observed digest/bytes, reserved/uploaded/committed/tombstoned state, admission_epoch/generation, expiry/time, durable effect-in-flight/drained evidence | Restore committed association; unfinished generations unavailable until reconciliation |
| artifact_associations; message_artifacts | Artifact/resource-kind/resource-id; message/artifact/ordinal unique, workspace-bound | Restore retained references, no bytes inferred from SQL |
| catalog_plans | id,workspace_id,actor_principal_id,profile_revision,expires_at,plan_json,touched_versions_json,status,created_at | Retain evidence; stale authority never reapplied |
| import_plans; import_mappings | Immutable preview/report JSON and versions/digest/expiry/principal; unique workspace/namespace/external_id mapping to task/source hash/version | Restore provenance; no imported active authority |

The manifest must enumerate **every** actual column, default, primary/foreign key, CHECK, index and registry mode after joint review with #27–37/#22. Artifact-generation consumers additionally require observed_sha256/observed_byte_size and durable effect operation/kind/state/start/drain evidence. #32/#33/#39 must agree this exact effect subrecord before SQL: admission-fence rechecks alone cannot prove a previously dispatched R2 put/delete has drained, and restart/response loss must retain uncertainty rather than set drained optimistically. This is an implementation contract artifact within #24, not permission for consumer-specific tables later. Keep disabled approval/checkpoint compatibility fields in canonical tasks/results; do not expose R3 or fabricate approvals. Review whether extra dormant R3 tables are necessary; unnecessary storage is not required solely because a DTO exists.

**Atomic adoption and overlay**
- Preserve every existing static agent and credential ID/hash exactly; origin=operator_static, new metadata gets deterministic neutral defaults (version1, description empty, work roles [], framework/model null; no new privilege). Existing installed_at supplies fallback created_at rather than migration wall-clock identity.
- Static rows with disabled/expired/retired grants remain so; never synthesize a new token or grant. Reject conflicting identity bindings. Existing messages/outbox bytes/replays unchanged.
- Under D-ID-1, human_managed credential rows are excluded from static reference/tombstone matching, but never from authorization or revocation. Higher epoch revokes them and proofs atomically; static tombstone checks unchanged.
- Constraints/indexes: one active run per task; task state=doing iff active_run_id non-null at committed command boundary; active pointer matches same-workspace/task active run; terminal runs ended_at non-null; monotonic next_fence never reset; unique provenance map; due lease and artifact-expiry indexes; task (workspace_id,state,created_at,id), run (workspace_id,agent_id,status).
- Cross-row invariants requiring transaction guards are tested explicitly; do not claim a CHECK enforces a relationship it cannot inspect. No triggers that create unreviewed shadow state.
- Extend the existing typed registry and restore encoding, including inspectRegistry's schemaVersion literal; preserve evidence/invalidate/domain-outcomes/paused-effects modes for all original tables. Any unregistered table/column blocks capture.

**Tests Before / TDD**
- [ ] Create representative v7 snapshots with static active/disabled/expired/retired credentials, project_ids null/[], immutable message/outbox payload and replay bytes, preference owners and maintenance generations.
- [ ] Write `static_adoption_preserves_identity_revocations_and_ceiling`, `collision_rolls_back_schema_and_rows`, `restart_does_not_duplicate_adoption`, `frozen_maintenance_rejects_upgrade`, `registry_matches_every_column_and_fk`, `active_run_and_provenance_uniqueness_reject`.
- [ ] Red: `npm run test:workers -- test/storage/r2-durable-migration.test.ts test/storage/workspace-bootstrap.test.ts`.
- [ ] Reconfirm version; review exact manifest with identity/execution/artifact/import/recovery owners, then implement one migration+registry change. Inject a failure after identity adoption and before schema bookkeeping: all prior bytes and version7 must remain.
- [ ] Green: same test command, `npm run typecheck`, `npm run check`; recreate DO between migration and reads, run migration twice, compare original bytes and hashes. Record EXPLAIN QUERY PLAN for due/order queries without claiming capacity.
- [ ] Scoped commit `feat(storage): add reviewed R2 durable schema and registry`.

**DoD / reviewer gate:** Approved exhaustive manifest equals actual sqlite_schema, migration atomic/restart-safe, no authority gain, no historical edit and all R1 domain/recovery bytes retained. Independent storage+security review must reject missing tables/modes and untested bootstrap overlay behavior. Rollback is restore procedure, not deleting migration or code-only rollback.

---


## Handoff prompt

Read AGENTS.md, live issue and this file at the assigned SHA. Confirm #17 and named hard gates are satisfied; otherwise return BLOCKED without coding. Reconfirm current dev/PR and migration allocation. Work on exactly one assigned issue in an isolated branch, own only its listed files, and request the shared-file baton before edits. Treat D-ID-1–4 as unapproved until reviewed evidence is linked. Write failing tests, prove nonzero correct-runtime collection, implement narrowly, rerun focused and aggregate checks, and request independent review. Report exact files, SHA, command/exit/count, negative/restart proof and remaining blockers. Never close an issue, publish, provision, merge or mark R2 verified without the corresponding authorization and evidence.
