# R2 Issue 25 — Implement human-authorized agent and native credential lifecycle

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

Implement only issue #25; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** BLOCKED — #17 Verified R1 plus named prerequisites must be satisfied before implementation.
**Hard:** #24. **Interface:** #20. **Evidence:** none additional.
**Branch purpose:** plan delivery only. Reconcile accepted dev and predecessor code at future pickup.

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


## Handoff prompt

Read AGENTS.md, live issue and this file at the assigned SHA. Confirm #17 and named hard gates are satisfied; otherwise return BLOCKED without coding. Reconfirm current dev/PR and migration allocation. Work on exactly one assigned issue in an isolated branch, own only its listed files, and request the shared-file baton before edits. Treat D-ID-1–4 as unapproved until reviewed evidence is linked. Write failing tests, prove nonzero correct-runtime collection, implement narrowly, rerun focused and aggregate checks, and request independent review. Report exact files, SHA, command/exit/count, negative/restart proof and remaining blockers. Never close an issue, publish, provision, merge or mark R2 verified without the corresponding authorization and evidence.
