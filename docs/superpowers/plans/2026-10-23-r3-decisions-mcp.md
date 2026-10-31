# R3 — Human Decisions and MCP Implementation Plan

Status: Implementation plan reviewed · Implementation pending.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for task-by-task implementation with independent review through the authorized execution environment. Keep shared-checkout mutations sequential and follow the orchestration execution ledger. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation requires an available authorized workspace.

**Goal:** Deliver safe composition, immutable human decision proposals and MCP STDIO, covering F31–F33 and F35.

**Architecture:** The workspace Durable Object remains the transaction and authorization authority. Browser forms and MCP translate to the native commands shared by HTTP/CLI; exact proposal inputs are committed immutable R2 artifacts referenced by SQL. Approval makes work Ready for a fresh claim that rechecks current policy, runtime proof and frozen intent.

**Tech Stack:** TypeScript, Cloudflare Worker, Durable Objects/SQLite, private R2, Vitest with the selected Workers runtime, the existing UI runner, Wrangler and a verified compatible locked MCP SDK targeting `2025-11-25`. No dependency installation or runtime compatibility is asserted by this plan.

**Spec:** [Roadmap](../../roadmap.md), [feature matrix](../../feature-matrix.md), [task lifecycle](../../task-lifecycle.md), [HTTP API](../../http-api.md), [MCP API](../../mcp-api.md), [security model](../../security-model.md), [delivery semantics](../../delivery-semantics.md), [limits](../../limits.md), [testing](../../testing.md), [OpenAPI](../../../spec/openapi.json) and `examples/http/fixture-map.json`. Read these alongside the plan. `ExampleApprovalInputs` is fixture data, not a built-in product action.

## Narrow inactive-source clarification — issue 52

The reviewed first source unit may implement optional structural deployment `decision_policy`, canonical human-only approval scope recognition, closed two-phase types and a query-only transaction-current requirements adapter against a fixed **empty production registry**. Synthetic trusted test composition is not runtime configuration or an enabled product action. Its returned pre-parse requirements are not final eligible resolution or verified input; issue 54 separately owns exact R2 bytes, schema validation/target extraction, runtime-private provenance and final current-SQL authorization. No final constructor or mutation/route is supplied in the first unit.

This records partial inactive-source progress, not Task 1 completion: no actual operator-reviewed product action/schema/target-effect semantics has been selected. The existing instruction to stop action-dependent implementation for an unresolved schema remains in force. This clarification does not unlock action-specific request-decision, approve/reject, claim or dispatch work or clear the literal issue 52/54 dependencies. See [the source contract](../../contracts/r3-decisions.md).

## Adjacent bounded inactive-source clarification — issue 54

The adjacent source-only unit may compose a read-only exact-input verifier against the same **empty production registry**: ordinary committed R2 original bytes/native string generation identity, the existing bounded exact parser, a source-owned closed schema and pure synchronous target extractor, all assigned humans and reference roles, private object-identity provenance, and fresh current-SQL rechecks. Isolated synthetic descriptors remain test-only. A final consuming command must recheck in its own synchronous transaction; a returned resolution is evidence, not run/fence/effect authority. No checkpoint storage, routes, mutation consumers, live configuration, approval lifetime/defaults or actual product action is authorized.

This remains partial inactive source for both issues 52 and 54, not Task 1 completion or literal dependency closure. The unresolved-action-schema stop above and in Task 1 remains in force: **stop action-dependent implementation while a product action/schema/target-effect interpretation is unresolved**. This clarification does not unlock request-decision, approve/reject, claim or dispatch activation. Persisted checkpoint ownership and the full future ingress envelope require their own reviewed integration; synthetic source proof is not deployed acceptance.

## Global Constraints

- R1/R2 implementation and runtime evidence are prerequisites. Documentation validation cannot mark F31–F33/F35 Implemented, Verified or Released.
- Preserve neutral CF Agent Hub and MIT `Copyright (c) 2026 trungtaottn`; no personal content, credentials or fabricated activity.
- One provisioned workspace maps to one authoritative Durable Object. No network/R2 call inside SQL transactions; artifact bytes remain in R2.
- Reuse R1 `ActorContext`, `CommandContext` and `WorkspaceTransaction`; recheck current grants before replay. Public DTOs retain OpenAPI snake_case; adapters cannot accept caller-supplied actor/grants.
- Task states remain `backlog/ready/doing/waiting/review/done/cancelled`. Approval states remain `pending/approved/rejected/expired/invalidated`. Paused runs end permanently.
- Request-decision requires native bearer plus `X-Runtime-Token`, current owner, unexpired lease, fence and task version. Approve/reject require human session, CSRF, current assignment/scope and task/proposal/approval versions.
- Task lease is 60 seconds; recommended run heartbeat 20 seconds; runtime presence expiry 90 seconds; completed idempotency outcomes retained at least 24 hours. Heartbeats update only run version.
- Ceilings: JSON envelope 65,536 UTF-8 bytes; message body 32,768; structured references 8,192; one attachment 10,485,760; attachments per message/result 5 and aggregate 26,214,400 bytes. Task 1 explicitly settles checkpoint/proposal association accounting without silently inventing fields.
- Lists use native bounded pagination and workspace/actor/query-bound cursors. Approval expiry/action policy have no universal defaults; missing reviewed policy disables decisions.
- No automatic hosting, approval MCP tool, arbitrary tool URL, self-acceptance, expired-proposal renewal, or exactly-once external-effect promise.

## Review Focus

1. Summary and JSON disagree or bytes change after display: only the exact immutable digest/action/scope can authorize — Tasks 2/6, `input-binding.test.ts` and `decision.spec.ts`.
2. Policy, membership or cancellation changes after approval but before claim: grant no execution authority — Task 4, `approved-claim.test.ts`.
3. Human clicks at expiry before the alarm runs: deny and remain Waiting — Task 3, `decision-races.test.ts`.
4. Lost form response survives reload/workspace switch: one intent/key, no cross-principal draft or blind new submission — Task 5, `compose.spec.ts`.
5. MCP replays a now-expired claim or forges tool/workspace identity: preserve native semantics and distinguish protocol/domain errors — Task 7, `stdio-parity.test.ts`.

## File and interface map

UI files use plain TypeScript render/event modules and the R1 renderer; no new JSX framework is assumed. Consume the final R1 ActorContext, including any trusted session handle used for revocation, without duplicating its definition. All product/test paths are planned. Inspect the implemented R1/R2 candidate and record exact existing equivalents in `docs/contracts/r3-handoff.md` before imports change; never create a second command layer because paths differ.

`Native<S>` means the OpenAPI-generated schema type exported by `packages/client/src/native-types.ts`. Task 1 binds this alias to R2 types for `Task`, `Run`, `Proposal`, `Approval`, `TaskRequestDecisionRequest`, `ApprovalDecisionRequest` and `TaskCommandResult`. `NativeOperation` and `OperationInput<O>/OperationOutput<O>` map existing operation IDs and complete envelopes. The internal client bridge is `NativeInvoker.invoke<O extends NativeOperation>(operation: O, input: OperationInput<O>): Promise<OperationOutput<O>>`. Auth comes from the existing native/session client; tools never provide an ActorContext.

| Planned files | Responsibility |
| --- | --- |
| `docs/contracts/r3-decisions.md`, `spec/decision-policy.schema.json` | Reviewed action-input schemas, assignment, expiry and immutable-byte rules |
| `src/approvals/contracts.ts`, `src/approvals/input-binding.ts`, `src/approvals/commands.ts`, `src/approvals/queries.ts`, `src/approvals/expiry.ts` | Verification types, decision transactions, bounded reads and due work |
| `src/approvals/execution-guard.ts` | Frozen approval verification for fresh native claims and owned dispatch boundaries |
| `src/storage/migrations/*-approvals.sql` | Immutable proposal/checkpoint/history references; allocate next migration number during execution |
| `src/ui/compose/`, `src/ui/approvals/` | Accessible forms, scoped drafts and exact input presentation |
| `packages/mcp-stdio/src/` | Protected configuration, negotiation, closed tool registry and native envelope mapping |
| `test/approvals/`, `test/ui/`, `test/mcp/`, `test/acceptance/r3.test.ts` | Domain, Workers, browser, subprocess and isolated deployment evidence |

**Entry gate:** R1/R2 revision/evidence must prove auth/session/runtime proof, current-grant replay, tasks, artifacts, atomic outcomes, UI command plumbing, native client and restoration. Missing runtime prerequisites cannot be replaced by mocked release evidence. An unavailable execution workspace pauses implementation; resume at the first unchecked task after access returns.

**Exit gate:** Task 8 retains same-revision domain, browser and real STDIO/native evidence with independent review. Capability flags stay off until their complete paths pass. Failure recovery preserves records/evidence, disables affected new entry points, reconciles ambiguous effects and resumes the failing task; never downgrade SQL or delete history to make rollback appear successful.

---

### Task 1: Finalize decision policy and the R2 bridge

**Dependencies/non-goals:** R2 contracts and implementation available for inspection. Resolve missing action policy/integration seams; do not redesign native routes or implement arbitrary product actions.

**Files:** Create `docs/contracts/r3-handoff.md`, `docs/contracts/r3-decisions.md`, `spec/decision-policy.schema.json`, `examples/decisions/policy-valid.json`, `examples/decisions/policy-invalid.json`, `src/approvals/contracts.ts`, `test/approvals/contract.test.ts`. Modify `packages/client/src/native-types.ts` and, only for reviewed clarifications, `docs/task-lifecycle.md`, `docs/http-api.md`, `docs/limits.md`, `spec/openapi.json` and corresponding fixtures.

**Interfaces:** Consume R1 context/transaction types and R2 client/artifact/task interfaces. Produce the Native aliases/Invoker above and `DecisionPolicy.resolve(actor: ActorContext, task: Native<'Task'>, proposal: Native<'Proposal'>, nowMs: number): DecisionPolicyResolution`. The resolution must carry closed action schema/version, permitted resources, nonempty eligible humans, finite positive expiry duration, policy revision and input access requirements. Freeze its exact internal fields in this task. Produce verifier-only `VerifiedProposalInput` with artifact ID, lowercase SHA-256, byte length, JSON value and policy revision.

- [ ] **Write red tests:** `policy_rejects_unknown_action_or_missing_expiry`, `example_input_is_not_product_action`, `contract_preserves_three_versions_and_proof`, `checkpoint_bounds_are_explicit`. Assert invalid policy cannot enable request-decision; hash actual fixture bytes and match the supplied digest.
- [ ] Run `npm test -- test/approvals/contract.test.ts`; expect missing policy/bridge assertions, not runner failure.
- [ ] Write and review the bounded decision record: supported action IDs and closed input schemas; action/scope/resource validation; exact-byte hashing without reserialization; JSON encoding/duplicate-key policy; MIME and bounds; aggregate association accounting; reviewer resolution/read access; expiry and exact boundary; task/approval version increments for decisions/expiry/cancel; already-approved lifetime and consumption semantics; redaction; unavailable/no-reviewer behavior. Preserve baseline pending-expiry→Waiting semantics. Freeze error fixtures and R2 bridge imports. Every enabled action needs a reviewed schema; unsupported actions remain unavailable.
- [ ] Run the same test and `npm run typecheck`. Retain review decision, schema revision, valid/invalid fixtures and compile-checked bridge evidence. This is contract readiness only.
- [ ] Review/stage only listed paths and commit `docs: finalize decision policy and native integration contract`. Stop dependent implementation for an unresolved action schema; correct the record and rerun rather than adopting fixture action data. **Exit:** complete deterministic policy, accepted fixtures and implementable R2 bridge.

### Task 2: Persist checkpoints and immutable proposals atomically

**Dependencies/non-goals:** Task 1, R2 committed-artifact verification and live run checks. No proposed-action execution or summary-only authorization.

**Files:** Create `src/approvals/input-binding.ts`, `src/approvals/commands.ts`, `src/approvals/queries.ts`, `test/approvals/input-binding.test.ts`, `test/approvals/request-decision.test.ts`; add next `src/storage/migrations/*-approvals.sql`. Modify existing task dispatch and `src/workspace/workspace-do.ts` through Task 1 mapping.

**Interfaces:** `verifyProposalInput(ctx: CommandContext, proposal: Native<'Proposal'>): Promise<VerifiedProposalInput>` hashes bounded immutable R2 bytes outside SQL. `requestTaskDecision(ctx: CommandContext, taskId: string, input: Native<'TaskRequestDecisionRequest'>): Promise<Native<'TaskCommandResult'>>` rechecks current manifest commitment/digest, permissions/policy and run authority inside SQL after verification. Approval queries return existing `ApprovalResponse/ApprovalListResponse` envelopes with bound cursors.

- [ ] **Write red tests:** `request_releases_run_and_freezes_inputs`, `wrong_digest_mime_or_workspace_denied`, `uncommitted_checkpoint_denied`, `grant_revoked_during_verification_denied`, `rollback_has_no_partial_proposal`, `restart_replay_has_one_proposal`. Assert Doing→Waiting, run `paused` with `ended_at`, no active run, correct task/proposal increments, exact checkpoint/input retained, policy-selected humans and one event/outbox/outcome. IDs/fence without proof fail.
- [ ] Run `npm run test:workers -- test/approvals/input-binding.test.ts test/approvals/request-decision.test.ts`; expect missing verifier/handler failures.
- [ ] Implement verification, immutable history and one SQL commit of checkpoint/proposal, paused run, task, event, outbox and outcome. Recheck after async reads to close revocation/retention races. Reuse exact bytes; summary never substitutes. Require assignment recipients can inspect input under the reviewed policy. Approval reads need current `approvals:read` and resource scope; byte reads additionally need artifact authorization.
- [ ] Repeat Workers command and `npm run typecheck`; require actual test R2 binding, restart/rollback assertions, unchanged state on denials and OpenAPI-valid response envelopes.
- [ ] Review transaction/secret-free audit, stage exact paths and commit `feat: persist immutable decision requests and checkpoints`. On transient verification failure, retain the original run only until its ordinary lease expires; retry the same intent/key after reconciliation. **Exit:** state, artifacts, history and replay agree; no partial Waiting task.

### Task 3: Enforce human decisions, conflicts and expiry

**Dependencies/non-goals:** Task 2. No renewal of an expired proposal or implicit scheduling after rejection/expiry.

**Files:** Modify `src/approvals/commands.ts`, `src/approvals/queries.ts`, approval HTTP router and `src/workspace/workspace-do.ts`. Create `src/approvals/expiry.ts`, `test/approvals/decision-races.test.ts`, `test/approvals/decision-auth.test.ts`.

**Interfaces:** `decideApproval(ctx: CommandContext, approvalId: string, decision: 'approve'|'reject', input: Native<'ApprovalDecisionRequest'>): Promise<Native<'TaskCommandResult'>>`. `expireDueApprovals(tx: WorkspaceTransaction, nowMs: number, limit: number): ExpiryBatch` returns processed count/next due time under validated bounded batch policy. Current authorization precedes replay lookup.

- [ ] **Write red tests:** `agent_scope_cannot_decide`, `old_task_proposal_or_approval_version_conflicts`, `approve_reject_race_one_winner`, `expiry_at_deadline_denies_without_alarm`, `cancel_invalidates_pending`, `lost_response_replays_original_outcome`, `revocation_denies_replay`. Assert native `VERSION_CONFLICT/APPROVAL_EXPIRED` as applicable; approve→Ready, reject→Backlog, expiry→Waiting, no new run, preserved reason/history and one decision.
- [ ] Run `npm run test:workers -- test/approvals/decision-races.test.ts test/approvals/decision-auth.test.ts`; expect missing decision/expiry behavior.
- [ ] Implement human lane, CSRF ingress, current eligible assignment/resource scope, all three versions and server-clock checks. `expected_version` is current task version, not `task_version_at_request`. Reverify input binding on approve. Persist decision/outcome/event together; integrate duplicate-safe durable alarm expiry and atomic cancellation invalidation. Native bearer with a similarly named scope remains denied.
- [ ] Repeat Workers command and `npm run typecheck`; retain boundary-clock, race, alarm restart and native envelope results.
- [ ] Review, stage exact paths and commit `feat: enforce human decision and expiry lifecycle`. For expired/stranded Waiting tasks expose the retained decision and authorized cancel/replacement recovery; never retry with silently updated versions. **Exit:** one consistent result per race, no automatic execution.

### Task 4: Bind approved intent to a fresh claim

**Dependencies/non-goals:** Tasks 1–3, R2 claim/metadata/cancel. Hub enforcement cannot promise control over arbitrary external programs.

**Files:** Create `src/approvals/execution-guard.ts`, `test/approvals/approved-claim.test.ts`. Modify R2 claim/PATCH/cancel/artifact-retention hooks through `docs/contracts/r3-handoff.md` and update `docs/integrations.md` with runtime obligations.

**Interfaces:** `verifyApprovedIntent(ctx: CommandContext, taskId: string): Promise<VerifiedApprovedIntent | null>` reads/verifies bytes outside SQL. `assertApprovedIntentCurrent(tx: WorkspaceTransaction, ctx: CommandContext, task: Native<'Task'>, verified: VerifiedApprovedIntent | null): void` rechecks identity, manifest, approved proposal/version/scope and current policy within claim. `VerifiedApprovedIntent` freezes exact action/input reference and policy evidence, never executable code. Owned connector dispatch in R4 consumes this guard plus current run authority at its external-action boundary.

- [ ] **Write red tests:** `fresh_claim_new_run_larger_fence`, `paused_owner_cannot_renew_submit`, `approved_ready_patch_denied`, `revoked_policy_or_cancel_blocks_claim`, `missing_or_changed_bytes_blocks_claim`, `concurrent_approved_claims_one_owner`. Assert checkpoint retention, ordinary proof/lease/WIP guards and independent acceptance before Done.
- [ ] Run `npm run test:workers -- test/approvals/approved-claim.test.ts`; expect missing approved-intent guard assertions.
- [ ] Integrate into the existing claim transaction, rechecking after async reads. Retain exact inputs while active approval/claim/evidence references require them. Block baseline metadata edits to approved Ready intent. Owned dispatch must reject parameter substitution and changed policy; external runtimes enforce durable operation identity and the same intent independently.
- [ ] Repeat Workers command, `npm test -- test/approvals/contract.test.ts` and `npm run typecheck`; prove old run remains ended and cancellation/revocation wins before claim.
- [ ] Review, stage exact paths and commit `feat: preserve approved intent across fresh execution claims`. Missing bytes/current authorization blocks claim and requires investigation; changed intent requires cancel and revised work. **Exit:** approval never transfers a lease or bypasses current policy.

### Task 5: Add safe message and task composition

**Dependencies/non-goals:** R1/R2 UI/client/artifact flow and Task 1 bridge. No browser native credentials or cached authority.

**Files:** Create `src/ui/compose/message-form.ts`, `src/ui/compose/task-form.ts`, `src/ui/compose/draft-store.ts`, `src/ui/compose/submit-intent.ts`, `test/ui/compose.spec.ts`, `test/ui/draft-store.test.ts`; modify existing navigation/client binding.

**Interfaces:** `submitIntent<O extends 'createMessage'|'createTask'>(client: NativeInvoker, intent: SubmitIntent<O>): Promise<OperationOutput<O>>`; `SubmitIntent` freezes operation/payload/key while outcome is unresolved. `DraftStore.load/save/clear(DraftKey, Draft)` uses schema-versioned allowlisted fields scoped to workspace and verified principal; exact method types are exported in `src/ui/compose/draft-store.ts`.

- [ ] **Write red tests:** `double_click_reload_one_intent`, `changed_payload_new_intent_only_after_reconciliation`, `draft_never_crosses_workspace_principal`, `logout_clears_draft`, `utf8_limit_and_uncommitted_attachment_denied`, `stale_reference_preserves_input`. Assert one created entity, native validation/errors, durable-admission/Backlog copy, no secrets/raw file bytes in storage.
- [ ] Run `npm run test:ui -- test/ui/compose.spec.ts` and `npm test -- test/ui/draft-store.test.ts`; expect missing composer/draft behavior.
- [ ] Build labeled accessible forms, inline errors and focus recovery using native DTO validators and CSRF session client. Upload via R2 stage/upload/commit; attach only authorized committed IDs. Allowlist draft text/reference fields, expose discard, revalidate recovered references, clear on logout. Freeze unresolved request/key while edits remain a separate draft; do not persist session/bearer/runtime/CSRF secrets or raw attachments.
- [ ] Repeat both commands and `npm run typecheck` with an actual test server; retain keyboard, multibyte, interrupted upload, session change and lost-response evidence.
- [ ] Review storage/command parity, stage exact paths and commit `feat: add recoverable message and task composition`. Retry same request/key within retention; after retention reconcile entity/events before any fresh write. **Exit:** both composers use domain validation, recover drafts safely and never confuse admission with completion.

### Task 6: Show exact human decisions and recover conflicts accessibly

**Dependencies/non-goals:** Tasks 2–4 and existing UI authentication. No summary-only approval, UI-derived grants or automatic version replacement.

**Files:** Create `src/ui/approvals/decision-list.ts`, `src/ui/approvals/decision-detail.ts`, `src/ui/approvals/input-viewer.ts`, `test/ui/decision.spec.ts`; modify existing client approval operations and navigation.

**Interfaces:** `loadDecisionView(client: NativeInvoker, approvalId: string): Promise<DecisionView>` combines current task/approval and authorized exact input inspection. `DecisionView` holds versions/action/scope/artifact ID/digest/checkpoint/expiry/assignment/load status only as presentation. Submit uses existing `approveApproval/rejectApproval` with unchanged `ApprovalDecisionRequest` and frozen key.

- [ ] **Write red tests:** `shows_exact_input_digest_before_decision`, `input_unavailable_disables_submit`, `conflict_preserves_reason_and_refetches`, `expiry_remains_waiting`, `native_actor_no_decision_control`, `keyboard_decision_focus_recovery`. Hostile JSON is inert; a message saying approved cannot decide. Show the checkpoint and requirement for a fresh claim.
- [ ] Run `npm run test:ui -- test/ui/decision.spec.ts`; expect absent decision views/controls.
- [ ] Implement bounded truthful list/detail states and safe JSON inspection. Large valid inputs must remain fully inspectable through authorized content, not silently truncated permission context. Show exact action/scope, all versions, digest and deadline; missing verified input blocks action. Disable known-expired controls while preserving server authority; explain rejection/expiry/recovery without fabricating a new proposal.
- [ ] Repeat UI command and `npm run typecheck`; require actual human session/CSRF, fresh conflict reads, preserved reason and focus evidence.
- [ ] Review/stage exact paths and commit `feat: add exact human decision interface`. On conflict require an intentional fresh submission after reread. **Exit:** approval, rejection, expiry, execution and accepted result remain distinct.

### Task 7: Implement pinned MCP STDIO and complete parity tests

**Dependencies/non-goals:** R2 native client, Tasks 2–4. No remote MCP, binary upload, enrollment, credential/agent administration, human decisions or result acceptance tools.

**Files:** Create `packages/mcp-stdio/package.json`, `packages/mcp-stdio/src/main.ts`, `packages/mcp-stdio/src/config.ts`, `packages/mcp-stdio/src/tool-registry.ts`, `packages/mcp-stdio/src/native-results.ts`, `test/mcp/stdio-parity.test.ts`, `test/mcp/tool-schemas.test.ts`, `docs/contracts/mcp-stdio-tools.json`. Modify workspace package/lock files and `docs/mcp-api.md` with evidenced launch instructions.

**Interfaces:** `createStdioServer(config: StdioConfig, client: NativeInvoker): StdioServer`; closed tool registry; `toToolResult(envelope: NativeEnvelope, failed: boolean): ToolResult` returns short summary/full envelope in `structuredContent`, output schema and `isError: true` for domain errors. Verify SDK types and protocol error codes against pinned primary specifications during implementation.

| Tools | Native operations |
| --- | --- |
| `hub_workspace_get`, `hub_agents_list` | `getWorkspace`, `listAgents` |
| `hub_tasks_list`, `hub_task_get`, `hub_task_create`, `hub_task_claim` | `listTasks`, `getTask`, `createTask`, `claimTask` |
| `hub_run_get`, `hub_run_heartbeat` | `getRun`, `heartbeatRun` |
| `hub_task_request_decision`, `hub_task_submit_result`, `hub_task_fail` | `requestTaskDecision`, `submitTaskResult`, `failTask` |
| `hub_inbox_get`, `hub_thread_get`, `hub_message_send`, `hub_messages_ack` | `getInbox`, `getThread`, `createMessage`, `ackMessages` |
| `hub_artifact_get`, `hub_search` | `getArtifact`, `searchWorkspace` |

The registry has exactly **17 tools**. Inputs are native fields plus explicit workspace/path IDs and mutation `idempotency_key`. Requested workspace must match protected configured context. Derive each tool's scopes/actor restrictions from OpenAPI `x-required-scopes/x-actor-kind`; runtime-bound operations require securely injected proof. Reject unknown fields, arbitrary URLs and caller identity/grant overrides.

- [ ] **Write red tests:** `registry_exact_native_subset`, `unsupported_revision_refused`, `missing_scope_denied_each_tool`, `native_mcp_envelopes_match`, `lost_claim_replay_no_new_run`, `expired_replayed_claim_no_authority`, `unknown_tool_protocol_error`, `stdout_stderr_secret_free`. Every tool needs allowed/denied parity against the native implementation; retain error code and request correlation.
- [ ] Run `npm test -- test/mcp/tool-schemas.test.ts test/mcp/stdio-parity.test.ts`; expect missing process/registry behavior. Integration tests must spawn the built process and exchange protocol messages, not merely call registry functions.
- [ ] Select/lock a compatible SDK; verify exact `2025-11-25` initialization, transport and tools schemas from primary sources referenced in MCP spec. Implement protected origin/workspace/native credential/runtime proof configuration; stdout only protocol, stderr redacted. Map domain failures to error tool results, protocol failures to protocol errors; preserve versions/fences/envelopes/keys. Connection never creates runtime presence or execution.
- [ ] Repeat tests and `npm run typecheck`. Retain a real pinned-client initialize/discover/call transcript, exact client/SDK versions and each advertised launch configuration; claim only those exercised configurations.
- [ ] Review/stage exact paths and commit `feat: add native-parity MCP STDIO adapter`. Lost connection requires same-key reconciliation/current reads, not cancellation or fresh effect. **Exit:** every advertised tool passes positive/negative parity, bounded pagination and two-workspace denial, with no human-only tool.

### Task 8: Rehearse and independently review the R3 gate

**Dependencies/non-goals:** Tasks 1–7 and R1/R2 gates. No promotion from screenshots/schema checks alone.

**Files:** Create `test/acceptance/r3.test.ts`, `docs/release-evidence/r3-template.md`; extend existing `scripts/verify-release.mjs` for `--round R3` and `docs/release-checklist.md`. Controller owns the feature status matrix/review ledger.

**Interfaces:** Extend the existing R1 evidence manifest, preserving revision/environment/command/expected/observed/evidence/exception fields. Produce separate F31/F32/F33/F35 records and a round decision; do not introduce a competing manifest schema.

- [ ] **Write red tests:** `gate_rejects_missing_runtime_client_evidence`, `checkpoint_human_decide_fresh_claim_review_done`, `cancel_revoke_after_approval`, `restore_never_resumes_paused_run`, `two_workspace_decision_mcp_denial`. Assert missing runtime/browser/STDIO rows block promotion; restored input bytes/digests match and old authority stays invalid.
- [ ] Run `npm run test:workers -- test/acceptance/r3.test.ts`; expect specific absent gate/acceptance assertions.
- [ ] Implement gate extension and execute the isolated journey with two distinct agents, separate authorized human, checkpoint/input artifacts, Waiting, approval, fresh claim, Review and independent acceptance. Include rejection, expiry, stale click, duplicate form, lost response, cancellation/revocation, restored metadata+bytes and MCP/native parity. Capture persisted state/event/outbox/outcome and sanitized transcripts. Obtain independent review, fix material findings and rerun affected checks.
- [ ] Run `npm run check`, focused Workers/UI/MCP commands above, then `npm run verify:release -- --round R3 --evidence <retained-evidence-path>` against the actual selected revision/environment. Require complete passing rows and no untested advertised client.
- [ ] Review/stage exact evidence/verifier paths and commit `test: verify human decisions and MCP release gate`. Report evidence to the controller for truthful status updates. On failure keep affected flags disabled, preserve history and repair/resume the failing task. **Exit:** same-revision runtime evidence and independent review agree; tagging/release follows the authorized controller workflow.

## Coverage and resume rules

| Capability | Tasks | Required evidence |
| --- | --- | --- |
| F31 | 5, 8 | Validation parity, duplicate/lost response, secret-free scoped drafts |
| F32 | 1–4, 8 | Exact JSON/digest, checkpoint, ended run, version binding, fresh claim |
| F33 | 3, 6, 8 | Human-only decision, stale/expired denial, exact scope/input presentation |
| F35 | 7–8 | Protocol/client transcript, 17-tool mapping, scopes/errors/replay parity |

Resume only when prerequisite contracts/evidence still match the working revision. A policy/schema change invalidates dependent evidence until rerun. An access outage pauses execution without changing product design or marking tasks complete.

