# R2 Issue 41 — Persist CLI mutation intent and runtime proofs before dispatch

Status: Implementation pending; planning review and R1 acceptance required.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give authorized users and external agents truthful, bounded access to durable work without duplicating the domain authority.

**Architecture:** Extend the existing HTTP transport, AES-GCM cursor codec, transactional command wrapper and semantic HTML UI. Import previews are immutable plans, not execution authority; the CLI durably records intent before dispatch, while all decisions remain server-owned.

**Tech Stack:** Existing pinned TypeScript, Node 24.22.1/npm 11.19.1, Cloudflare Worker/SQLite DO, Vitest and Playwright. No new UI framework or general-purpose retry engine.

**Spec:** `docs/superpowers/plans/2026-10-23-r2-durable-work.md` Tasks 1, 8–11; `spec/openapi.json`; `docs/cli.md`; `docs/kanban.md`; existing issues #21, #36–38, #40–42, #44–45 and #48. Exact issue snapshots are in [historical issue snapshot](https://github.com/trungtaottn/cf-agent-hub/blob/fdabd716b4af7ef0e5082e660dc2c397f003c303/docs/superpowers/plans/261026-0727-r2-agent-handoff/research/issues-clients.json) (prior evidence only; current live issue remains authority).

## Global Constraints

- Planning baseline: PR #93 candidate `4c8e487eee7b8a3d4f76562ecca2369819aa0a9a`; `dev` was `fcbe6139c65f9baafee9804a5c50867a1fcc0968`. Re-read the actual accepted baseline before execution.
- All implementation remains blocked by #17 and the named child dependencies. This plan is not owner approval, deployed evidence or permission to change issue labels.
- Preserve one native API/domain command model. Generated canonical DTOs remain snake_case; browser cookie/CSRF and native credential lanes remain separate.
- Import limit: 100 rows / 65,536-byte envelope; preview lifetime 15 minutes. Search: NFC case-sensitive literal matching, 2,048 UTF-8-byte query, 256-code-point snippets, 2,000-candidate maximum.
- Raw credentials/runtime proofs never enter URLs, journal bodies, logs, normal stdout, browser storage or issue evidence.
- No silent retry/new key, automatic conflict rebase, `--all`, production destination, package publication or R3 decision execution.

## Review Focus

1. Revocation during cursor crypto, artifact verification or response preparation must prevent publication; #36/#40 own these barrier tests.
2. A crash between durable intent and key attachment must send nothing; a crash after attachment must reuse the exact binding; #41 owns process-level fault injection.
3. A malformed HTTP success or wrong content type must never become CLI exit 0; #38/#44 test transport and subprocess behavior.
4. A stale board must not let a user accept a different result; #45 pins expected_version, preserves ordinary conflict drafts and requires a fresh action.
5. Imported source text/URLs and hidden references must remain inert and non-disclosing; #21/#37 test authority fields, foreign IDs, literal text and no outbound fetch.

## Observed source and integration ownership

| Current source | What exists | What must not be assumed |
| --- | --- | --- |
| `packages/client/src/client.ts`, `types.ts` | Browser-only `HubClient(workspaceId, {fetch?})`, explicit mutation keys, same-origin cookie/CSRF, canonical result validation and safe errors | No native origin/credential provider/runtime-proof lane, typed R2 facade or CLI package |
| `src/http/cursors.ts`, `read-routes.ts` | AES-GCM AAD binding, current proof re-resolution and final synchronous projection | Cursor operation union is only inbox/thread/events; mixed search retention is not implemented |
| `src/messages/reads.ts` | Current resource filtering, internal scannedIds and message/event retention floors | Its non-event message floor is not a generic task/artifact retention policy |
| `src/ui/read-state.ts`, `write-intent.ts` | Per-section ReadModel and immutable settings IntentWriter with uncertain/conflict states | No task DTO authority or generic task writer yet |
| `scripts/lib/protected-io.mjs` | POSIX owner/mode/nlink/O_NOFOLLOW checks and exclusive fsync publication | Not a cross-platform credential vault or mutable concurrent journal |
| `vitest.config.ts`, `vitest.workers.config.ts` | Existing R1 node and Worker suites | TS CLI, search/import and full R2 acceptance suites are not discovered yet; #23 must add them |

**Shared-file rule:** #23 owns generated roots, enabled-operation/type map, runner discovery and first shared cursor/event plumbing. #21 supplies its reviewed schema change; #36 supplies search integration. #38 owns shared client edits before #42/#44 consume them. #42 then #45 serialize `src/ui/app.ts`, `write-intent.ts`, test server and helpers. One integrator applies shared OpenAPI/docs/package hunks; parallel branches may not overwrite those files.

**Proposed internal interfaces** below are implementation decisions for review, not claims they already exist. Canonical public schemas and operation IDs win; if producers differ, stop and reconcile interfaces before coding consumers.


## Pickup scope and exact prerequisites

Implement only issue #41; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** BLOCKED — #17 Verified R1 plus named prerequisites must be satisfied before implementation.
**Hard:** #38. **Interface:** #26. **Evidence:** none additional.
**Branch purpose:** plan delivery only. Reconcile accepted dev and predecessor code at future pickup.

## Task #41 — Durable mutation journal and protected runtime proof store

### Summary / problem
One-time proofs and unknown mutation outcomes make filesystem durability a correctness/security boundary. A mutable JSON file without writer exclusion/fsync is insufficient.

### Touchpoints and interfaces
Create `packages/cli/src/journal.ts`, `packages/cli/src/secret-store.ts`, `test/cli/journal-recovery.test.ts`, `test/cli/secret-store.test.ts`; inspect/reuse protected-file primitives from `scripts/lib/protected-io.mjs` without coupling to operator/recovery credentials. Update `docs/cli.md`, `docs/security-model.md`.
Exact contract:
`SemanticRequest={operation,method,path,queryCanonical,canonicalBody,origin,workspaceId}` contains the validated final method, encoded resource path and canonical semantic query/body from the one operation map; no auth/correlation headers or secrets.
`JournalEntry={id,request:SemanticRequest,principal:VerifiedPrincipalBinding,key:string|null,firstDispatch:DispatchStamp|null,replayState:'unsent'|'within-window'|'reconciliation-required'|'settled'}`;
`recordIntent({request:SemanticRequest,principal:VerifiedPrincipalBinding,suppliedKey?:string}):Promise<JournalEntry>`;
`markFirstDispatch(id:string,stamp:DispatchStamp):Promise<JournalEntry>` durably sets the first dispatch stamp once before fetch, never extending it on retry;
`authorizeReplay(id:string,current:VerifiedPrincipalBinding,request:SemanticRequest,clock:ReplayClockEvidence):Promise<'send-once'|'no-send-reconcile'>` compares complete request, verified principal/provider association and conservative elapsed-time proof before dispatch;
`attachKey(intentId:string,key:string):Promise<JournalEntry>`;
`recordOutcome(id:string,redactedOutcome:unknown):Promise<void>`;
`RuntimeProofBinding={origin:string,workspaceId:string,principalId:string,slotId:string,slotGeneration:number,runtimeId:string,provenanceId:string}`;
`SecretStore.putRuntimeProof(binding:RuntimeProofBinding,lease:CredentialDispatchLease,proof:string):Promise<void>`;
`SecretStore.withRuntimeProof(binding:RuntimeProofBinding,lease:CredentialDispatchLease,dispatch:BoundProofDispatch):Promise<void>` exposes the proof only inside the bound dispatch boundary, never ordinary output.
The local protected proof-store key uses the exact captured credential slot/generation plus verified principal/runtime association, not a server credential_id unavailable from RuntimeIssue. Put/get must compare the same authenticated provenance and actual pinned lease atomically; slot/generation or principal/workspace/runtime mismatch denies before storing or dispatching. Runtime enrollment response supplies runtime.id/workspace_id/agent_id for the captured lease; native.ts resolves credential IDs server-side from opaque token hashes. Do not parse opaque tokens, invent identity fields/routes, make human-only credential queries or pair manual metadata. This changes only the proposed local CLI interface: server proofs remain bound to their issuing credential and rotation still requires fresh enrollment.

<!-- Updated: Validation Session 2 — approved R2-RV-01/R2-RV-02 -->
**Binding and replay window:** Unresolved entries never accept changed method/path/resource/query/body/origin/workspace/principal. Consume #38 authenticated association and pinned slot/generation, not free-form principal strings, and verify the actual dispatch lease. Same-agent rotation is not automatically a different principal, but any supported explicit rebind must prove the same principal from canonical authenticated evidence and preserve request/key plus runtime-proof requirements; no silent credential/runtime substitution. Missing provenance or changed target/principal means zero fetches and retained unresolved record.

`DispatchStamp={firstDispatchWallMs,firstDispatchMonotonicMs,clockEpochId,guaranteedRetentionMs:86400000,requestFingerprint}` and `ReplayClockEvidence={clockEpochId,nowMonotonicMs,continuityVerified,suspendAwareElapsedVerified}` are internal nonsecret records, not wire fields. Fsync the first stamp before fetch, so the bound is no later than any successful server commit. Deadline is first dispatch plus existing minimum24h; never reset it on retry. Send only with matching complete binding and trustworthy elapsed time >=0 and strictly <guaranteedRetentionMs. Exact deadline, later time, absent/unknown stamp, clock rollback, reboot/changed epoch or unverified continuity after restart returns no-send-reconcile. Elapsed-time proof must include suspend/sleep intervals; both continuityVerified and suspendAwareElapsedVerified must be true. Same boot ID or process.hrtime alone is not proof of elapsed time across suspend. Wall time alone cannot establish elapsed time. #41 must test the clock-continuity adapter for the owner-approved platform; if continuity cannot be proved, fail closed. Local journal retention does not extend server outcome retention. Out-of-window unresolved entries remain reconciliation-required; authoritative read/manual reconciliation may resolve them, but no mutation redispatch or automatic fresh key. This does not claim production GC is wired or approve D-JOURNAL values.

### Decision gate: backend / platform
No backend or OS support has been owner-approved. Recommended minimal first target is **POSIX owner-only protected local files**, reusing tested uid/mode/O_NOFOLLOW/exclusive-publication discipline with private 0700 parent and 0600 files, outside the repository; clearly document it is access-controlled storage, **not encryption at rest or an OS keychain**. Security/owner review must accept this threat model before implementation, or select an OS credential-vault adapter instead. Windows/cross-platform claims remain blocked until equivalent tested guarantees exist. This is a decision gate, not permission to fall back to plaintext after a secure backend failure.

The journal necessarily stores exact sensitive user payload for replay; it must never store authorization headers/proofs. Define reviewed bounded retention and explicit deletion of settled entries; unresolved entries must not be silently evicted to satisfy a limit (stop new admission instead). Product values for retention/storage cap require review, not arbitrary constants introduced by an agent.

### Acceptance criteria and TDD
- [ ] Write `crash_before_record_sends_nothing`, `keyless_intent_survives_restart`, `crash_after_attach_reuses_exact_complete_request_principal_key_within_window`, `concurrent_different_key_attach_has_one_winner`.
- [ ] Write `corrupt_partial_symlink_insecure_owner_or_mode_denies_dispatch`, `origin_workspace_method_path_query_body_principal_binding_cannot_change`, `forged_principal_or_provider_generation_swap_zero_fetch`, `same_principal_rotation_requires_proven_association_and_runtime_compatibility`, `disk_full_or_fsync_failure_no_dispatch`, `unresolved_limit_blocks_new_intent_without_eviction`.
- [ ] Write `proof_capture_failure_reports_uncertain_without_stdout_secret`, `wrong_binding_cannot_read_proof`, `journal_and_redacted_outcome_contain_no_secret`; use synthetic canaries only.
- [ ] Add `imported_opaque_token_explicit_enrollment_captures_proof_reopen_same_slot_then_claim`, `proof_store_slot_generation_or_principal_swap_denies_put_and_dispatch`, and `runtime_response_without_credential_id_needs_no_native_admin_query`; use canonical RuntimeIssue and captured lease with no credential_id field. Assert durable reopen preserves the exact slot/generation/runtime association, raw proof never enters journal/stdout, and mismatched provider has zero outgoing claim.
- [ ] Run `npm test -- test/cli/journal-recovery.test.ts test/cli/secret-store.test.ts` after #23 enables collection; demonstrate process-kill/reopen and concurrent-writer tests, not only in-memory mocks.
- [ ] Implement immutable record creation and compare-and-set attachment with durable atomic publication and writer exclusion. Persist intent before generating key; persist attachment and first-dispatch stamp before dispatch; never recover with a new key. Add `lost_success_then_24h_plus_legal_gc_restart_zero_send`, `exact_deadline_denies_send`, `clock_rollback_reboot_missing_stamp_or_unproven_continuity_requires_reconciliation`, `same_boot_hrtime_only_is_not_elapsed_proof`, `suspend_elapsed_accounted_or_zero_send`, and `within_proven_window_original_binding_replays_exactly`. Invoke the existing legal GC helper explicitly in the expiry test; do not claim a production caller. Assert no second create/stage/message effect and retained unresolved intent.
- [ ] Rerun focused tests, `npm run typecheck`, `npm run check`; security/filesystem reviewer checks crash windows, private permissions, retention and no secret fallback. Commit only after backend decision is recorded.

### Notes / gate
Hard #38; interface #26. Lost enrollment proof cannot be recovered from server replay; failed capture requires fresh enrollment, while ordinary mutations use complete request/principal/key only inside a proven replay window; otherwise reconciliation is read/manual and no-send. Do not conflate these two recovery rules.


## Handoff contract for every task

Pick exactly one existing issue after its gates clear; read this section, that issue's live body, root AGENTS and producer receipts. State exclusive files before edits. Run the named red test with nonzero collection, implement minimal scoped change, rerun focused and integration checks, then request independent review. Record SHA/base, tests with counts and exit codes, type/schema changes, negative/restart evidence, remaining blockers and next task. A failing required gate pauses downstream pickup; do not weaken tests or claim completion from scaffolding. Keep `ai-handle` distinct from `ready to cook`; none of these plans presently authorizes implementation or promotion.
