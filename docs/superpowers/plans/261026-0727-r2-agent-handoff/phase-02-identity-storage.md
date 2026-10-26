# Identity and Shared Storage Implementation Plan

Status: Implementation pending; planning review and R1 acceptance required.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare reviewed contracts and one durable identity/storage boundary for R2 without widening R1 authority.

**Architecture:** Extend the existing SQLite transaction, native credential table, authenticated command wrapper, generated OpenAPI types and recovery registry. Keep runtime proof as separate server-verified evidence; never make an ID, display label or runtime field authenticate an actor. The private first-response secret is distinct from the durable sanitized outcome.

**Tech Stack:** Existing TypeScript/Workers/SQLite DO/Vitest stack; candidate pins Node 24.22.1, npm 11.19.1. Do not change dependencies to execute this plan.

**Spec:** Canonical `docs/superpowers/plans/2026-10-23-r2-durable-work.md` Tasks 1–2; `spec/openapi.json`; `docs/data-model.md`; `docs/security-model.md`; live issues #20, #23–26. Full retrieved issue snapshots are in `research/issues-identity.json`.

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

## Task #20 — Bounded policy/catalog and actor-lane amendment

**Files**
- Create `spec/execution-policy.schema.json`, `examples/http/r2-contracts.json`, `test/contracts/r2-policy-catalog.test.ts`.
- Modify `spec/openapi.json`, `spec/deployment-config.schema.json`, `spec/r1-bootstrap.schema.json`, `examples/http/fixture-map.json`, `docs/configuration.md`, `docs/customization.md`, `docs/http-api.md`, `docs/limits.md`, `docs/adr/0003-leases-and-decisions.md`.
- Read—not replace—`src/config/settings-service.ts`; runtime policy/catalog implementation belongs #27/#28 and downstream execution owners.

**Interfaces / exact assertions**
- `ExecutionPolicy={policy_version,agent_wip_limit,task_retry_limit,artifact_upload_ttl_seconds,eligibility_rules,replay_safety_rules}`, all required, additionalProperties false. Bounds respectively >=1, 1..100, 0..10, 60..3600. Exact nullable project/work-role tuple, no wildcard. Eligible agent IDs distinct/current; absent replay classification unsafe, conflicting matches invalid, outcome_unknown overrides replay-safe.
- `EligibilityRule={project_id:string|null,work_role_id:string|null,eligible_agent_ids:string[]}`.
- `ReplaySafetyRule={id,project_id,work_role_id,classification:'replay_safe',evidence_ref}`, operator supplied only.
- `CatalogPreviewRequest={expected_profile_revision>=1,kind:'project'|'work_role',id,operation:'archive'|'remap',replacement_id:string|null,reason}`; `CatalogApplyRequest={preview_id,expected_profile_revision>=1}`.
- `CatalogPlan={id,profile_revision,expires_at,changes:[{kind,id,operation,before,after}],affected_task_ids,affected_agent_ids,conflicts:[{resource_kind,resource_id,code}]}`; before/after are nullable canonical profile named_record. Store touched entity versions internally. At most 200 affected entities; expiry exactly 15 minutes.
- POST `/catalog:preview` operationId previewCatalogChange and POST `/catalog:apply` applyCatalogChange require current human profile:edit, CSRF, idempotency. Task remap additionally tasks:edit; agent roles additionally human agents:manage. Return ProfileView on apply.
- Preserve advisory POST `/profile:preview` and complete-candidate PUT `/profile` using expected_profile_revision; no persisted profile preview ID, profile:apply, Workspace extra field or archive bypass.
- Add imports:manage to Scope and native-disallowed scope declarations; list exact enabled actor lanes without enabling approvals. Review D-ID-1 before describing bootstrap behavior.

**Tests Before / TDD**
- [ ] Write `policy_numeric_boundaries_are_closed`: WIP 0/1/100/101, retries -1/0/10/11, TTL 59/60/3600/3601; missing/unknown fields fail, fixture 1/2/900 passes.
- [ ] Write `exact_null_tuple_is_not_wildcard`, `duplicate_or_conflicting_rules_reject`, `catalog_plan_is_bounded_and_distinct_from_profile_preview`, `native_human_only_scope_denied`; assert 200/201, exact expiry, no profile:apply, and unchanged 0.1 Workspace.
- [ ] Run `npm test -- test/contracts/r2-policy-catalog.test.ts`; require nonzero collection and failure on missing schema/contract, not runner absence.
- [ ] Apply only reviewed schema/docs/fixtures; record D-ID-1 outcome in amendment ADR and add fixture showing higher-epoch static versus dynamic behavior.
- [ ] Run the same focused command, `npm run verify:generated` after generator integration, `npm run check`, docs validators, and diff check. Do not claim working endpoints.
- [ ] Scoped commit `docs(r2): define bounded policy catalog and authority contracts`.

**DoD / evidence / reviewer gate:** Every DTO is closed, all numerical and actor-lane fixtures pass, old profile semantics unchanged, D-ID-1 explicitly reviewed or task remains blocked. Retain exact SHA, schema diff, collected count and command exit; independent contract/security reviewer must agree that labels/roles and scope recognition confer no authority. No production policy value is selected by these fixture numbers.

---

**D-HISTORY — unresolved public read contract (blocks full history acceptance):** Existing OpenAPI exposes current Task.result, getRun and sanitized events, but no prior-result summary/artifact-list read operation after requeue clears current result. Retained SQL evidence is not automatically public API. #20 owns the additive public history decision, #23 generated/route/cursor contract, #27 authorized query and #35 retained result projection after that freeze. Their plans may consult successor requirements without waiting for implementation. No agent may invent a private endpoint, extra Task fields or a task-history cursor. Until reviewed, #42 may render current Task.result and canonical sanitized event/run evidence only and must label full historical result retrieval unavailable; this partial surface does NOT satisfy historical-result acceptance or close #42/#49. Required amendment must define exact DTO/operation, current visibility, bounded pagination, result/artifact provenance and negative fixtures before full history implementation.

## Task #23 — Shared generated and command boundaries

**Files**
- Create `src/contracts/native.ts`, `src/contracts/r2.ts`, `src/http/r2-routes.ts`, `test/contracts/r2-shared-boundary.test.ts`.
- Modify generator owners `scripts/generate-auth-contract.mjs`, `scripts/generate-config-validators.mjs`, `scripts/generate-operator-contract.mjs`; generated outputs under `src/http/generated/`, `src/config/generated/`, `src/recovery/generated/` only through those generators.
- Modify `src/http/dto.ts` only by generation; `src/http/router.ts`, `src/workspace/context.ts`, `src/workspace/commands.ts`, `src/audit/events.ts`, `src/http/cursors.ts`, `src/config/deployment.ts`, `vitest.config.ts`, `vitest.workers.config.ts`, `test/contracts/http-dto-types.ts`, `package.json`.
- Coordinate `wrangler.jsonc` and `worker-configuration.d.ts` binding declaration with #32; no real bucket provisioning.

**Interfaces**
- `NativeDTO<K>` is an indexed alias map of actual generated named types from `src/http/dto.ts`; include TaskCommandResult, Task, Run, Artifact, Agent, Credential, CredentialIssue, Runtime, RuntimeIssue, SearchHit and exact request/amendment names. It must not use unknown or recreate shapes.
- `PageData<T>={items:readonly T[],next:CursorPayload|null,hasMore:boolean}` remains internal. HTTP alone emits existing paged envelope and encrypts continuation after SQL.
- Preserve `CommandDescriptor<B,T>` resource/checkAccess/checkReplay/execute signature and `executeCommand<B,T>(ctx,identity,command,body):CommandOutcome<T>`; all hooks synchronous. #25 owns an additive first-execution-only wrapper result, not public raw state.
- Extend closed event types and resource visibility dispatch only for implemented producers; missing handlers deny. Event versions/run/fence are derived from persisted joins and later schema, never arbitrary HTTP fields.
- Cursor operations add exact implemented resource lanes under one codec: agents, credentials, tasks, artifacts and search only when their public routes require them. Use canonical public route operation map, not generic client-selected cursor kinds. Search retention remains unavailable until #36. Do not register a task-history cursor or route until D-HISTORY has a reviewed public operation/schema.
- Explicit runtime ownership: ordinary Workers includes `test/{agents,runtimes,tasks,artifacts,search,imports}/**/*.test.ts`, `test/acceptance/r2-isolation.test.ts`, `test/acceptance/r2-durable-work.test.ts` and `test/config/catalog-lifecycle.test.ts`. Never use broad `test/acceptance/r2-*.test.ts`.
- Node includes `test/cli/**/*.test.ts` and `test/acceptance/r2-release-evidence.test.ts`; explicitly excludes `test/config/catalog-lifecycle.test.ts` so current config wildcard cannot select a SQLite suite. Node contract/client tests remain Node.
- Dedicated live native configuration owns only `test/acceptance/r2-native-conformance.test.ts`; ordinary Node/Workers explicitly exclude it and never require live credentials. #48 creates that dedicated config/script after reviewed CLI implementation.
- Operator configuration includes `test/recovery/r2-operator.test.ts`; ordinary Workers explicitly excludes it. Existing .mjs operator/recovery CLI tests remain under the Node --test script, not TS Vitest. #46 owns operator integration in coordination with #23.
- Verify each named file is collected by exactly its intended runner and absent from the other runners. Store nonzero per-runner counts; unavailable future files are planned, never counted as passing coverage.

**Tests Before / TDD**
- [ ] Add type assertions covering exact generated aliases and absent duplicate DTO; fixture validation for unknown keys and UTF-8 limits.
- [ ] Add `unknown_event_resource_and_cursor_deny`, `async_domain_hook_rolls_back`, `r3_route_remains_unavailable`, `new_domain_suite_discovery_is_nonzero`. Include old message replay and session expiration regression references.
- [ ] Red: `npm test -- test/contracts/r2-shared-boundary.test.ts`.
- [ ] Extend generator roots, regenerate using `npm run generate:auth`, `npm run generate:config`, `npm run generate:operator`; add thin unavailable R2 dispatch only, not placeholder success.
- [ ] Add discovery fixture test in each new runtime domain only when first real domain test exists; list collection using the installed Vitest CLI's verified list help. A zero-test exit is failure, never acceptance.
- [ ] Green: focused command, `npm run verify:generated`, `npm run typecheck`, `npm run check`. Persist runner matrix with nonzero counts.
- [ ] Scoped commit `feat(r2): extend shared generated and command boundaries`.

**Refactor / restart cases:** No standalone event store, scheduler, request envelope, auth context or DTO generator. Recreated DO must still use durable replay and current actor, with no process-local registry of visibility permissions. Test cursor binding changes, revoked actor on a later page and query mismatch without exposing hidden IDs.

**DoD / reviewer gate:** Exact original R1 tests remain discovered; every newly declared contract has generated freshness coverage; unavailable routes remain closed. Security reviewer checks event/cursor default deny, transaction hooks and public binding separation. #24 waits until consumers can compile against reviewed aliases.

---

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

## Task #25 — Human-only identity and native credential lifecycle

**Files**
- Create `src/agents/commands.ts`, `src/auth/native-credentials.ts`, `test/agents/identity-lifecycle.test.ts`.
- Modify `src/auth/native.ts`, `src/auth/authorize.ts`, `src/auth/context.ts`, `src/messages/references.ts`, `src/outbox/repository.ts`, `src/config/bootstrap.ts`, `src/workspace/commands.ts`, `src/http/r2-routes.ts`, `src/http/router.ts`, `src/workspace/workspace-do.ts`, `docs/agents.md`, `docs/security-model.md`.

**Interfaces**
- `createAgent(tx,ctx,NativeDTO<'AgentCreateRequest'>):Agent`; `patchAgent(tx,ctx,agentId,NativeDTO<'AgentPatchRequest'>):Agent`; `archiveAgent(tx,ctx,agentId,NativeDTO<'AgentArchiveRequest'>):Agent`.
- `issueCredential(tx,ctx,NativeDTO<'CredentialCreateRequest'>,prepared:PreparedCredential):CredentialIssue`, where prepared is server-only `{credentialId:string,tokenSha256:string}`; returned durable CredentialIssue always token:null/revealed:false.
- `revokeCredential(tx,ctx,credentialId,NativeDTO<'CredentialRevokeRequest'>):Credential`.
- `listAgents`/`getAgent` and `listCredentials` consume current scoped actor and bounded CursorPayload, return exact Agent/Credential or PageData, never hashes.
- Add `executeCommandDetailed<B,T>(...same args):{outcome:CommandOutcome<T>,firstExecution:boolean}` internally; preserve existing executeCommand by returning detailed.outcome. firstExecution set only after successful transaction; replay=false. Native route holds raw secret privately and emits token/revealed only when firstExecution true. It is never a descriptor return value or logging argument.
- Public operation IDs remain createAgent,patchAgent,archiveAgent,listAgents,getAgent,listCredentials,createCredential,revokeCredential. No invented credential GET-by-ID or rotation route.

**Tests Before / TDD**
- [ ] `native_admin_and_human_overdelegation_denied`: human session+CSRF/current scopes required; forged native agents:manage/credentials:manage denied; null/[] ceiling remains distinct; archived/unknown work-role IDs fail.
- [ ] `one_time_reveals_never_enter_replay_or_audit`: synthetic deterministic 32-byte secret appears initial response only; inspect all SQL text, replay/event/log/export values for its exact bytes. Wrong key payload conflicts.
- [ ] `lost_response_does_not_recover_token`: throw after commit before response; restart and repeat same key returns token null/revealed false; explicit fresh issuance creates distinct credential. Never repeat original side effect on replay.
- [ ] `archive_rejects_active_runs_and_unresolved_assignments`: every nonterminal assigned task blocks archive; terminal history does not. Inject failure after agent status change and prove credentials/proofs/status all rollback.
- [ ] `revocation_blocks_replay_and_background_delivery`: revoke/archive/epoch change denies native verify, current replay and outbox eligibility without reusing cached grants. Archive preserves result attribution.
- [ ] Red: `npm run test:workers -- test/agents/identity-lifecycle.test.ts`.
- [ ] Implement prepared hash and private first-response projection, current joins and D-ID-1 overlay; keep one coherent credential for all message references, never union scopes across credentials.
- [ ] Green: focused test, `npm run typecheck`, `npm run check`; evidence includes nonzero count, restart and injected rollback. #29 later adds both claim/archive race orders.
- [ ] Scoped commit `feat(agents): add human-authorized identity and credential lifecycle`.

**DoD / reviewer gate:** Safe exact DTOs, immutable IDs, version-bound changes, human-only management, no token retention, next epoch behavior explicit, static R1 auth/dispatch regressions pass. Independent reviewer traces entropy→hash→transaction→response→audit→recovery; a sanitized replay must still reauthorize and reveal no stale private metadata.

---

## Task #26 — Credential-bound runtime proof and presence

**Files**
- Create `src/runtimes/commands.ts`, `src/auth/runtime-proof.ts`, `test/runtimes/proof-lifecycle.test.ts`.
- Modify `src/auth/native.ts`, `src/auth/authorize.ts`, `src/workspace/context.ts`, `src/workspace/commands.ts`, `src/http/r2-routes.ts`, `src/http/router.ts`, `src/workspace/workspace-do.ts`, `docs/agents.md`, `docs/http-api.md`, `docs/security-model.md`.

**Interfaces**
- `enrollRuntime(tx,ctx,NativeDTO<'RuntimeCreateRequest'>,prepared:PreparedRuntime):RuntimeIssue`; prepared server-only `{runtimeId:string,proofSha256:string}`. Durable result always runtime_token:null/revealed:false; private first-response channel from #25 reveals proof once.
- `requireRuntimeProof(tx,ctx,runtimeId:string,proofHash:string):VerifiedRuntime`, `VerifiedRuntime={runtime:Runtime,credentialId:string,authorityEpoch:number}`; only server-produced. Proof hashed before transaction, raw proof never in CommandContext. Recheck at consuming transaction after any awaits.
- `heartbeatRuntime(tx,ctx,runtimeId:string,NativeDTO<'RuntimeHeartbeatRequest'>,proofHash:string):Runtime`; call requireRuntimeProof and current binding checks inside this transaction, not only HTTP middleware. The extra input is server-hashed ingress evidence, never a public JSON parameter; the returned VerifiedRuntime is valid only for this synchronous transaction.
- Public POST runtimes operationId **createRuntime**, body only label; agent derives from active credential. POST runtimes/{runtime_instance_id}:heartbeat operationId heartbeatRuntime; expected_runtime_version required. No runtime-list endpoint.
- Keep ActorContext.runtimeId null for native actor resolution and current authorization; separate VerifiedRuntime is passed explicitly to execution/artifact owners. Do not relax refreshActor to accept public runtime fields.
- Presence renews from trusted transaction clock to now+90,000 ms only while now<old expiry. Heartbeat increments runtime_version only. It changes no task/run version, fence, assignment or lease.

**Tests Before / TDD**
- [ ] `proof_binds_exact_credential_workspace_agent_epoch`: two credentials for one agent cannot transplant proof; wrong workspace/credential/agent/epoch and ID/fence-only requests fail.
- [ ] `presence_boundary_denies_without_alarm`: deadline−1 renews; deadline and +1 fail before cleanup; client time ignored. Replay after expiry fails current access.
- [ ] `presence_never_renews_execution_lease`: capture task/run/fence/lease/version before heartbeat; compare unchanged after.
- [ ] `lost_enrollment_requires_fresh_authority`: response lost after commit, restart/replay sanitized, fresh enrollment has distinct runtime/proof and no inherited run.
- [ ] `revocation_during_proof_hashing_wins`: revoke/change epoch or maintenance generation while async hashing is suspended; final transaction denies. Serialized proof metadata survives restart but revocation remains authoritative.
- [ ] Red: `npm run test:workers -- test/runtimes/proof-lifecycle.test.ts`.
- [ ] Implement prepared enrollment, exact proof verification and trusted presence; integrate explicit current predicates with replay. No raw proof or hash in public Runtime DTO.
- [ ] Green: same focused command, `npm run typecheck`, `npm run check`, no-secret SQL/log scans and DTO fixtures.
- [ ] Scoped commit `feat(runtimes): bind presence to credential-scoped proof`.

**DoD / reviewer gate:** No ID-based authority or presence-as-lease; current credential, agent, epoch, admission and runtime deadline all rechecked transactionally. Reviewer inspects asynchronous boundary and restart/replay tests. #29 owns actual run lease tests and #43 restored-proof invalidation; neither is claimed by enrollment unit tests alone.

## Handoff prompt

Read AGENTS.md, live issue and this file at the assigned SHA. Confirm #17 and named hard gates are satisfied; otherwise return BLOCKED without coding. Reconfirm current dev/PR and migration allocation. Work on exactly one assigned issue in an isolated branch, own only its listed files, and request the shared-file baton before edits. Treat D-ID-1–4 as unapproved until reviewed evidence is linked. Write failing tests, prove nonzero correct-runtime collection, implement narrowly, rerun focused and aggregate checks, and request independent review. Report exact files, SHA, command/exit/count, negative/restart proof and remaining blockers. Never close an issue, publish, provision, merge or mark R2 verified without the corresponding authorization and evidence.
