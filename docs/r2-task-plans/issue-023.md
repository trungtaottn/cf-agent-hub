# R2 Issue 23 — Extend canonical R1 boundaries and discover R2 verification files

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

Implement only issue #23; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** BLOCKED — #17 Verified R1 plus named prerequisites must be satisfied before implementation.
**Hard:** #17. **Interface:** #20, #21, #22. **Evidence:** none additional.
**Branch purpose:** plan delivery only. Reconcile accepted dev and predecessor code at future pickup.

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


## Handoff prompt

Read AGENTS.md, live issue and this file at the assigned SHA. Confirm #17 and named hard gates are satisfied; otherwise return BLOCKED without coding. Reconfirm current dev/PR and migration allocation. Work on exactly one assigned issue in an isolated branch, own only its listed files, and request the shared-file baton before edits. Treat D-ID-1–4 as unapproved until reviewed evidence is linked. Write failing tests, prove nonzero correct-runtime collection, implement narrowly, rerun focused and aggregate checks, and request independent review. Report exact files, SHA, command/exit/count, negative/restart proof and remaining blockers. Never close an issue, publish, provision, merge or mark R2 verified without the corresponding authorization and evidence.
