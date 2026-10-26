# Clients, UI, Imports and Search Implementation Plan

Status: Implementation pending; planning review and R1 acceptance required.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give authorized users and external agents truthful, bounded access to durable work without duplicating the domain authority.

**Architecture:** Extend the existing HTTP transport, AES-GCM cursor codec, transactional command wrapper and semantic HTML UI. Import previews are immutable plans, not execution authority; the CLI durably records intent before dispatch, while all decisions remain server-owned.

**Tech Stack:** Existing pinned TypeScript, Node 24.22.1/npm 11.19.1, Cloudflare Worker/SQLite DO, Vitest and Playwright. No new UI framework or general-purpose retry engine.

**Spec:** `docs/superpowers/plans/2026-10-23-r2-durable-work.md` Tasks 1, 8–11; `spec/openapi.json`; `docs/cli.md`; `docs/kanban.md`; existing issues #21, #36–38, #40–42, #44–45 and #48. Exact issue snapshots are in `research/issues-clients.json`.

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

## Task #21 — Freeze import and literal-search contract amendments

### Summary / problem
OpenAPI already proposes search but does not encode the full bounded import amendment. Close contracts before consumers invent overwrite rules or readable pagination.

### Proposed flow and scope
Review closed ImportBatch → immutable ImportPreview v1 → explicit ImportApplyRequest → ImportReport v2. Human imports:manage + tasks:read are required; apply additionally needs tasks:create, verified session/CSRF and explicit idempotency. No native human impersonation, live connector, imported authority or Task DTO provenance additions.

### Touchpoints and interfaces
Modify `spec/openapi.json`, `docs/http-api.md`, `docs/limits.md`, `docs/data-model.md`, `docs/security-model.md`, `examples/http/fixture-map.json`; create `spec/import-batch.schema.json`, `examples/imports/reconciliation.json`, `test/contracts/r2-import-search.test.ts`.
Produce the exact schema names ImportBatch, ImportPreview, ImportApplyRequest, ImportReport and search parameters consumed through #23's generated aliases.
Rows: external_id, nullable UTC source_updated_at, title/description, project_id/work_role_id, source_state, nullable inert source_ref; namespace/external IDs ≤128 characters, revision ≤256, state ≤64, source_ref ≤2,048. Reject unknown authority-bearing fields.
Apply binds expected_import_version, preview_sha256 and accept_rejected_rows. Preview counts use create; report counts use created. GET returns a closed discriminated union.

### Acceptance criteria and TDD
- [ ] Write `import_bounds_and_closed_rows`: 100 accepted / 101 rejected; 65,536-byte envelope accepted if otherwise valid / 65,537 rejected; nullable/valid UTC accepted, invalid timestamp rejected; owner/credential/approval fields rejected.
- [ ] Write `preview_report_discriminants_and_counts`: version1 preview versus version2 report; counts partition received; false partial acceptance with conflict/rejected rows maps to INVALID_STATE.
- [ ] Write `literal_search_contract`: percent, underscore, quotes, NFC-equivalent Unicode, exact query byte/snippet code-point/scan limits; no total or hidden frontier fields.
- [ ] Run `npm test -- test/contracts/r2-import-search.test.ts`; expect nonzero discovered tests and meaningful failures against missing amendments, not an empty-suite pass.
- [ ] Amend schemas/fixtures/docs, then use existing generators through #23's serialized integration.
- [ ] Run the focused command, `npm run verify:generated`, `npm run check`, docs/plan validators. All selected cases must pass; no endpoint implementation is implied.
- [ ] Independent schema/security reviewer checks closed fields, deterministic hashes/counts, error non-disclosure and preserved R1 compatibility; commit only this contract amendment after approval.

### Notes / gate
Hard: #17, #19. Interface output: #23/#36/#37. Keep existing issue; no duplicate child needed. Before final contract approval, record mixed-search retention policy with #23 (see #36); do not silently repurpose the message-only floor.

## Task #36 — Authorized bounded search and reusable isolation fixtures

### Summary / problem
Add search over task, message and artifact metadata using existing current-authority and confidential continuation machinery. Search permission alone grants no underlying content.

### Touchpoints and interfaces
Create `src/search/query.ts`, `test/search/authorized-search.test.ts`, `test/helpers/r2-isolation.ts`. Modify `src/http/read-routes.ts`, `src/workspace/workspace-do.ts`, `docs/limits.md`, `docs/security-model.md`; coordinate `src/http/cursors.ts`, message/reference/event helpers with #23/#34.
Consume WorkspaceTransaction, ActorContext, CursorPayload and #23's PageData; produce:
`searchWorkspace(tx, ctx, {q:string,kind?:'task'|'message'|'artifact',limit?:number,cursor?:CursorPayload}):PageData<SearchHit>`.
SearchHit stays exactly kind/id/title/snippet/created_at. Extend the existing binding with operation search; queryHash binds normalized query, kind, limit and sort, alongside workspace/principal/lane/credential/session.

### Proposed flow and invariants
Decode cursor outside SQL, refresh proof in the query transaction, scan a bounded globally ordered candidate set, authorize before constructing snippets, encode continuation outside SQL, then reauthorize/reproject scanned IDs immediately before response with no further await. Preserve existing AAD/key separation. Use globally distinct IDs, (created_at,id) high-water and lastScanned, no total. Empty filtered pages may have continuation.

**Retention integration decision:** #21/#23 review an operation-aware hook before implementation. For search including messages, conservatively expire when the existing proven message truncation floor overtakes the search frontier; task/artifact-only search must not use that floor. R2 retains task/committed artifact history, so do not invent deletion floors absent a reviewed deletion feature. Add a regression that a message-floor update cannot invalidate task-only search. If producers adopt a different reviewed retention contract, amend this interface first; never add a second cursor store.

### Acceptance criteria and TDD
- [ ] Write `search_scope_alone_returns_no_hidden_resources`, `thread_participation_precedes_snippet`, `foreign_project_has_no_counts_or_frontier_leak`, and `null_projects_differs_from_empty_projects`; hidden IDs/bytes/snippets absent from the envelope, and raw base64-decoded external cursor bytes must not reveal hidden IDs. Test-only decryption may inspect the internal frontier; that internal value is precisely what authenticated encryption protects.
- [ ] Write `literal_unicode_and_punctuation_bounds`, `scan_stops_at_2000`, `empty_filtered_page_continues`, `high_water_excludes_later_insert`, `query_actor_kind_swap_and_tamper_reject`.
- [ ] Write `revocation_during_cursor_encode_blocks_publication`, `restart_preserves_authorized_cancelled_history`, `artifact_search_never_reads_object_bytes`, and retention cases above. Instrument candidates examined, not only returned count.
- [ ] Run `npm run test:workers -- test/search/authorized-search.test.ts`; expect named failures and nonzero collection after #23.
- [ ] Implement parameterized queries and current-resource predicates; add fixture builder for two workspaces, restricted grants, fixed threads and separate runtimes without auth bypass.
- [ ] Run focused command and `npm run check`; retain query-plan/scan-count evidence and exact denied cases.
- [ ] Independent reviewer inspects filter-before-projection, no-await final proof checks, cursor confidentiality and finite scan. Commit the bounded search/fixtures deliverable.

### Notes / gate
Hard #35/#34; interface #21/#23. #37 consumes fixtures, not #40's later final matrix. No semantic/regex/content search or complete-isolation claim.

## Task #37 — Immutable import preview and atomic apply

### Summary / problem
Do not turn external source status or repeated IDs into local updates or active authority. A lost apply response must replay one complete report, not repeat row creation.

### Touchpoints and interfaces
Create `src/imports/commands.ts`, `src/imports/provenance.ts`, `test/imports/reconciliation.test.ts`; integrate existing `src/workspace/commands.ts`, `src/workspace/workspace-do.ts`, `src/http/router.ts`, `src/audit/events.ts`, and owning import docs.
Consume #21 DTOs, #24 registered import tables, #27 task creation and #36 fixtures. Produce:
`previewImport(tx,ctx,batch:ImportBatch):ImportPreview`;
`applyImport(tx,ctx,importId:string,input:ImportApplyRequest):ImportReport`;
`getImport(tx,ctx,importId:string):ImportPreview|ImportReport`;
`getTaskProvenance(tx,ctx,taskId:string):readonly ImportProvenance[]`.
ImportProvenance contains source_namespace/external_id/source_revision/source_updated_at/source_state/source_ref/source_sha256/import_id/task_id; never extend closed Task.

### Proposed flow and invariants
Canonical source hashes and immutable preview are persisted with audit only. Preview creates no task/map. Mapping unique key is workspace + namespace + external_id; unchanged preserves internal ID, changed source conflicts. Apply rechecks human proof/grants, owner/workspace/digest/version/expiry and each reference/mapping version. Explicit accept_rejected_rows permits selected valid new rows only; any execution-time stale reference or failure rolls back the entire transaction. Task/map/report/audit/idempotency outcome commit together. Imported tasks are Backlog without assignment/run/result/approval.

### Acceptance criteria and TDD
- [ ] Write `dry_run_has_no_tasks_or_mapping`, `repeat_preserves_id_and_local_edit`, `changed_source_conflicts_not_upsert`, `every_source_state_becomes_backlog`, `source_ref_is_never_fetched`.
- [ ] Write `false_partial_flag_denies`, `true_partial_flag_creates_reviewed_valid_rows_only`, `duplicate_external_ids_conflict`, `foreign_reference_returns_generic_row_code`, `stale_mapping_after_preview_rolls_back_all`, `expiry_and_digest_mismatch_create_nothing`.
- [ ] Write `crash_after_commit_same_key_replays_exact_report` and `restart_retains_mapping_and_counts`; assert received=created+unchanged+conflict+rejected and task/map delta=created.
- [ ] Run `npm run test:workers -- test/imports/reconciliation.test.ts`; expect bounded contract failures.
- [ ] Implement through the existing synchronous command transaction; crypto precomputation occurs before final current-authority transaction, never network fetch in SQL.
- [ ] Run focused command, #36 fixture tests and `npm run check`; retain rollback and restart receipts.
- [ ] Reviewer checks mapping uniqueness, local-edit preservation, human-only lane and exact replay; commit the complete preview/apply feature.

### Notes / gate
Hard #27/#31; interfaces #21/#36 and storage #24. No live connector or automatic conflict repair. #40 later repeats full isolation; #39 capture must register all preview/report/mapping state.

## Task #38 — Typed native facade over the existing transport

### Summary / problem
The current HubClient is explicitly browser-only. Extend its implementation rather than adding a second fetch/error stack; retain browser behavior unchanged.

### Touchpoints and interfaces
Modify `packages/client/src/client.ts`, `packages/client/src/types.ts`, `test/client/r1-client.test.ts`, `docs/http-api.md`, `docs/cli.md`; create `packages/client/src/native-client.ts`, `test/client/native-conformance.test.ts`.
Consume #23's enabled-operation and canonical DTO mapping. Preserve existing constructor `HubClient(workspaceId, options?:HubClientOptions)`, `setCsrfToken(token:string|null)`, `request<T,O>(operation,input,options):Promise<ApiResult<T>>`.
Produce canonical facade:
`createNativeClient({origin,workspaceId,credentialProvider,fetch}):NativeClient`;
`call<K extends EnabledOperationId>(operation:K,request:RequestFor<K>,options:{idempotencyKey?:string,runtimeProof?:string}):Promise<ResponseFor<K>>`.
Define ResponseFor as the same ApiResult of generated operation data, not a thrown-error or second envelope family. CredentialProvider is an injected async provider of an opaque credential at dispatch; request boundary alone sees it. Exact provider type and streaming request/response variants belong in `types.ts` and type tests before consumers begin.

### Proposed flow and scope
Explicit exact HTTPS origin/workspace for native lane; browser retains relative URLs, same-origin cookies and CSRF. Use one operation map with per-lane availability, runtime-proof requirements and content validation. Reject userinfo/fragment/non-origin URL, redirects, mixed browser/native credentials and unenabled/R3 operations before requests. Finite abort timeout; caller owns mutation keys. Artifact byte operations use bounded streams with metadata validation, not JSON-envelope parsing of raw content. No arbitrary RPC or all-pages helper.

### Acceptance criteria and TDD
- [ ] Add compile-time operation/request/response correspondence tests and `native_headers_only_on_native_lane`, `browser_constructor_and_csrf_unchanged`, `unknown_or_human_only_operation_no_fetch`.
- [ ] Add `non_https_or_ambiguous_origin_no_fetch`, `redirect_never_receives_bearer`, `runtime_proof_only_for_required_operation`, `malformed_success_content_type_request_id_or_dto_rejected`.
- [ ] Add `timeout_one_dispatch_preserves_key`, `version_conflict_never_rekeys`, `one_time_proof_excluded_from_diagnostics`, streaming size bound and response-loss tests.
- [ ] Run `npm test -- test/client/native-conformance.test.ts test/client/r1-client.test.ts` and `npm run typecheck`; first assert meaningful new failures, then implement minimal shared-lane transport and rerun to pass.
- [ ] Run `npm run check`; record operation-map parity and request counts. Independent reviewer inspects header routing, stream-vs-JSON handling and browser regression diff.
- [ ] Commit the transport/facade only; no platform/distribution/live-conformance claim.

### Notes / gate
Hard #37/#34; interface #23 and all consumed domain DTO producers. Preserve this existing dependency despite native CLI not exposing human-only import administration: #38 covers the complete reviewed operation inventory with lane filtering, not a reason to weaken the issue gate.

## Task #40 — Complete local R2 isolation matrix

### Summary / problem
A search test or one foreign workspace URL is not proof of every R2 authorization boundary. This issue owns evidence, not permissive fallback fixes.

### Touchpoints and interfaces
Create `test/acceptance/r2-isolation.test.ts`; reuse `test/helpers/r2-isolation.ts`, `test/helpers/auth.ts`, `test/acceptance/r1-isolation.test.ts`. Update `docs/testing.md` and `docs/security-model.md` only for observed coverage.
Consume enabled operation map from #23 and native facade #38. Produce a table-driven case manifest keyed by operation + actor lane + mutation/read phase; coverage assertion fails if an enabled operation lacks authorized and foreign-resource cases.

### Acceptance criteria and TDD
- [ ] Write operation-coverage assertion first; run `npm run test:workers -- test/acceptance/r2-isolation.test.ts` and demonstrate that omitting one operation fails.
- [ ] Add foreign path IDs and embedded IDs for task/run/agent/credential/runtime/message/thread/artifact/content/search/event/catalog/import/cursor. Test null projects versus [] and no union of separate credentials.
- [ ] Add revocation/expiry barriers before mutation/replay, between pages, during artifact verification and before background dispatch; wrong runtime of the same agent denies.
- [ ] After process/DO restart replay all representative protected reads/mutations with revoked proof; inspect outputs/audit/cursor bytes for hidden IDs, snippets/counts and assert zero partial writes.
- [ ] Add R1 regression coverage and negative unavailable R3/R4/recovery-product-credential cases; no test-only auth bypass.
- [ ] Run full matrix plus `npm run check`, record exact revision/runtime/case counts and skips as incomplete.
- [ ] Independent security reviewer maps route/predicate to each case and requires fixes in the owning feature issue; commit only matrix/docs evidence work.

### Notes / gate
Hard #36/#37/#38/#34. Evidence output is required by #48/#49, not proof of real deployed isolation by itself. Keep #37 independent of this later gate to avoid a cycle.

## Task #41 — Durable mutation journal and protected runtime proof store

### Summary / problem
One-time proofs and unknown mutation outcomes make filesystem durability a correctness/security boundary. A mutable JSON file without writer exclusion/fsync is insufficient.

### Touchpoints and interfaces
Create `packages/cli/src/journal.ts`, `packages/cli/src/secret-store.ts`, `test/cli/journal-recovery.test.ts`, `test/cli/secret-store.test.ts`; inspect/reuse protected-file primitives from `scripts/lib/protected-io.mjs` without coupling to operator/recovery credentials. Update `docs/cli.md`, `docs/security-model.md`.
Exact contract:
`JournalEntry={id,operation,workspaceId,origin,canonicalBody,key:string|null}`;
`recordIntent({operation,workspaceId,origin,canonicalBody,suppliedKey?:string}):Promise<JournalEntry>`;
`attachKey(intentId:string,key:string):Promise<JournalEntry>`;
`recordOutcome(id:string,redactedOutcome:unknown):Promise<void>`;
`SecretStore.putRuntimeProof(binding:{origin:string,workspaceId:string,credentialId:string,runtimeId:string},proof:string):Promise<void>`.
A same-binding get operation may return the proof only into the credential dispatch boundary; ordinary output never receives it.

### Decision gate: backend / platform
No backend or OS support has been owner-approved. Recommended minimal first target is **POSIX owner-only protected local files**, reusing tested uid/mode/O_NOFOLLOW/exclusive-publication discipline with private 0700 parent and 0600 files, outside the repository; clearly document it is access-controlled storage, **not encryption at rest or an OS keychain**. Security/owner review must accept this threat model before implementation, or select an OS credential-vault adapter instead. Windows/cross-platform claims remain blocked until equivalent tested guarantees exist. This is a decision gate, not permission to fall back to plaintext after a secure backend failure.

The journal necessarily stores exact sensitive user payload for replay; it must never store authorization headers/proofs. Define reviewed bounded retention and explicit deletion of settled entries; unresolved entries must not be silently evicted to satisfy a limit (stop new admission instead). Product values for retention/storage cap require review, not arbitrary constants introduced by an agent.

### Acceptance criteria and TDD
- [ ] Write `crash_before_record_sends_nothing`, `keyless_intent_survives_restart`, `crash_after_attach_reuses_exact_key_body`, `concurrent_different_key_attach_has_one_winner`.
- [ ] Write `corrupt_partial_symlink_insecure_owner_or_mode_denies_dispatch`, `origin_workspace_operation_binding_cannot_change`, `disk_full_or_fsync_failure_no_dispatch`, `unresolved_limit_blocks_new_intent_without_eviction`.
- [ ] Write `proof_capture_failure_reports_uncertain_without_stdout_secret`, `wrong_binding_cannot_read_proof`, `journal_and_redacted_outcome_contain_no_secret`; use synthetic canaries only.
- [ ] Run `npm test -- test/cli/journal-recovery.test.ts test/cli/secret-store.test.ts` after #23 enables collection; demonstrate process-kill/reopen and concurrent-writer tests, not only in-memory mocks.
- [ ] Implement immutable record creation and compare-and-set attachment with durable atomic publication and writer exclusion. Persist intent before generating key; persist attachment before dispatch; never recover with a new key for a keyed entry.
- [ ] Rerun focused tests, `npm run typecheck`, `npm run check`; security/filesystem reviewer checks crash windows, private permissions, retention and no secret fallback. Commit only after backend decision is recorded.

### Notes / gate
Hard #38; interface #26. Lost enrollment proof cannot be recovered from server replay; failed capture requires fresh enrollment, while ordinary mutations reconcile stored same-key intent. Do not conflate these two recovery rules.

## Task #42 — Read-only authorized board and task evidence

**D-HISTORY — unresolved public read contract (blocks full history acceptance):** Existing OpenAPI exposes current Task.result, getRun and sanitized events, but no prior-result summary/artifact-list read operation after requeue clears current result. Retained SQL evidence is not automatically public API. #20 owns the additive public history decision, #23 generated/route/cursor contract, #27 authorized query and #35 retained result projection after that freeze. Their plans may consult successor requirements without waiting for implementation. No agent may invent a private endpoint, extra Task fields or a task-history cursor. Until reviewed, #42 may render current Task.result and canonical sanitized event/run evidence only and must label full historical result retrieval unavailable; this partial surface does NOT satisfy historical-result acceptance or close #42/#49. Required amendment must define exact DTO/operation, current visibility, bounded pagination, result/artifact provenance and negative fixtures before full history implementation.

### Summary / problem
Extend existing per-section ReadModel projections; do not create a browser task database or invent Task fields to make history convenient.

### Touchpoints and interfaces
Create `src/ui/kanban.ts`, `src/ui/task-detail.ts`, `test/ui/r2-kanban-read.spec.ts`; modify `src/ui/app.ts`, `read-state.ts`, `dom.ts`, `styles.ts`, `src/http/ui-routes.ts`, `src/config/preferences.ts`, `scripts/start-ui-test-server.mjs`, `test/helpers/ui.ts`, `docs/kanban.md`.
Review all owning auth return-path/profile availability schemas when adding /tasks; UI documents currently allow only /, /overview, /activity, /inbox, /settings. Never add an auth-return bypass.
Produce `KanbanView({tasks:readonly Task[],page,loadState,actorCapabilities,onCommand})` and TaskDetail projection from Task + Run + canonical authorized events and current result, with full historical-result projection blocked by D-HISTORY with separate source/time/error metadata. Use generated Task.task_version, latest_run_id and result.submitted_by; do not fabricate an acceptance actor field on Task.

### Acceptance criteria and TDD
- [ ] Write `six_columns_and_authorized_cancelled_archive_reload`, `partial_page_not_workspace_total`, `section_failure_preserves_other_reads`, `historical_result_unavailable_without_reviewed_contract`; after D-HISTORY freeze add `historical_result_labeled` against the accepted public operation, never a fabricated field.
- [ ] Write `runtime_presence_not_execution_lease`, `waiting_controls_r3_unavailable`, `hidden_board_does_not_pause_engine`, `profile_default_fallback_and_focus_regression`.
- [ ] Write `revoked_resource_removed_and_late_response_ignored`, `escaped_task_artifact_names`, `keyboard_narrow_screen_headings_and_state_text`; use actual R2 test server responses and restart.
- [ ] Run `npm run test:ui -- test/ui/r2-kanban-read.spec.ts`; expect visible missing-view assertions before implementing.
- [ ] Implement semantic HTML/plain TS view with fixed Backlog/Ready/Doing/Waiting/Review/Done columns and separate cancelled archive, bounded pages and truthful empty/loading/stale/partial/unavailable/forbidden.
- [ ] Run focused UI tests, existing navigation/settings regressions, `npm run build:ui`, `npm run check`; retain accessibility assertions/screenshots as supplemental evidence.
- [ ] Reviewer verifies route return paths, no invented data, profile and current-auth behavior; commit read-only board.

### Notes / gate
Hard #38/#35; interface #36. This is a user-visible read-only deliverable, independently reviewable from #45 commands. No framework, composition, native proof storage or R3 approval controls.

## Task #45 — Version-bound accessible board commands

### Summary / problem
A reconnect or 409 cannot silently replace the user's versioned intent. Settings IntentWriter currently has a closed three-operation union, so generalize deliberately without weakening its regressions.

### Touchpoints and interfaces
Create `src/ui/task-actions.ts`, `test/ui/r2-kanban.spec.ts`; modify `src/ui/write-intent.ts`, `read-state.ts`, `app.ts`, `dom.ts`, `test/helpers/ui.ts`, `docs/kanban.md`, `docs/design-guidelines.md`. Preserve settings behavior.
TaskCommandIntent = {taskId,expectedVersion,operation:'readyTask'|'cancelTask'|'requeueTask'|'acceptTaskResult',reason?:string}. readyTask body is exactly TaskVersionRequest {expected_version}; cancel/requeue/accept use TaskReasonRequest {expected_version,reason}. task_id is path input, not an invented JSON property. No generic state PATCH.

### Acceptance criteria and TDD
- [ ] Write `keyboard_equals_drag_ready_and_accept`: identical path/body/key semantics; only Backlog→Ready and eligible Review→Done drag; Doing/Waiting forbidden.
- [ ] Write `self_review_disabled_and_direct_server_denied`, `revocation_between_render_and_command_no_success`, `reconnect_requires_current_read`.
- [ ] Write `version_conflict_preserves_reason_requires_fresh_action`, `lost_response_replay_exact_key_body_once`, `late_read_cannot_reenable_stale_action`; genuine 401/403 clears protected state according to existing policy, ordinary 409 does not erase drafts.
- [ ] Write `focus_returns_to_changed_card`, `live_update_never_steals_focus`, keyboard-only narrow-screen and live-announcement cases.
- [ ] Run `npm run test:ui -- test/ui/r2-kanban.spec.ts`; expect behavioral failures. Generalize IntentWriter with typed operation/input parameters or a shared internal generic core, preserving its existing default settings types/API and uncertainty state machine.
- [ ] Wire commands via browser lane of shared transport; after conflict fetch current version and require deliberate new intent. After uncertainty reconcile original intent, never generate a replacement key.
- [ ] Run focused UI + settings/navigation suites, `npm run check`, and #35's actual two-agent acceptance journey when authorized. Review every affordance against server state/scope/self-review matrix; commit.

### Notes / gate
Hard #42; interfaces #38/#35. Local UI success follows authoritative response only. Missing fresh authority disables actions; no optimistic Done or drag-created execution authority.

## Task #44 — Built native CLI and safe artifact I/O

### Summary / problem
Deliver a thin executable, not a second domain engine. Local conformance cannot satisfy F24's deployed evidence.

### Touchpoints and interfaces
Create `packages/cli/src/main.ts`, `packages/cli/package.json`, `packages/client/package.json`, `test/cli/command-behavior.test.ts`; modify root `package.json`/`package-lock.json` only for required workspace/build wiring, `docs/cli.md`. Reuse #38 facade and #41 journal/store. Keep existing recovery CLI separate.
Proposed testable process entry `runCli(argv:readonly string[],deps:CliDependencies):Promise<0|2|3|4|5|6>`; CliDependencies supplies input/output streams, clock, native factory, journal and secret store. Main sets process exitCode without printing raw exceptions.

### Proposed flow
Validate explicit HTTPS context and input before dispatch; interactive selected context goes to stderr. Map commands from docs to enabled operation IDs, adding tasks accept-result/requeue and disabling request-decision/human admin/import/catalog. Use explicit --limit/--cursor only. Journal exact canonical body/key before one send. For enrollment, secure capture precedes envelope output with runtime_token=null/revealed=false. Exit 0 success, 2 local/no request, 3 auth denial, 4 state/version/idempotency conflict, 5 retryable/unknown, 6 other server rejection.
Uploads compute size/digest, stage, stream, reconcile ambiguous status, then commit; downloads exclusively create no-symlink output and verify digest/length, never overwrite. Heartbeat denial stops subsequent owner effects pending reconciliation.

### Acceptance criteria and TDD
- [ ] Write command-map coverage for every enabled CLI operation including accept/requeue, and no-request unsupported command/context/input tests.
- [ ] Write subprocess assertions for stdout native envelope, stderr context, all six exits, malformed response, secret canary redaction and secure capture failure.
- [ ] Write process restart preserving journal origin/workspace/key/body; heartbeat failure prevents next effect; wrong runtime/workspace preserves server denial.
- [ ] Write existing-file/symlink download refusal, length/digest mismatch, interrupted upload/status reconciliation and no replacement of committed artifact.
- [ ] Run `npm test -- test/cli/command-behavior.test.ts test/client/native-conformance.test.ts`; expect meaningful failures, implement parsing/build/process handling with existing locked toolchain, then rerun.
- [ ] Run `npm run typecheck`, `npm run check`, and the exact new CLI build script added in this change. Invoke the generated binary in tests; inspect package contents and absence of secrets.
- [ ] Independent reviewer checks no hidden retry, no secret flags, binary entrypoint, file safety and documented platform limits; commit without publishing package.

### Notes / gate
Hard #41/#38; interface #34. The exact build command is owned here: add `build:cli` using existing TypeScript/esbuild toolchain and make tests consume its output; do not pretend it exists on baseline. #23 must include new TS CLI sources in typechecking and Node tests. #48 owns live F24.

## Task #48 — Real isolated HTTPS conformance of the built CLI

### Summary / problem
Own the live runner now rather than depending on a test first invented at final acceptance. Missing environment/credential authorization keeps this evidence blocked.

### Touchpoints and interfaces
Create `scripts/test-native-r2.mjs`, `vitest.native.config.ts`, `test/acceptance/r2-native-conformance.test.ts`, `test/acceptance/r2-native-config.ts`; modify `package.json`, `docs/cli.md`, `docs/testing.md`, `docs/release-checklist.md`.
Produce `npm run test:native:r2 -- --config <protected-isolated-config-path>`. The runner consumes protected input itself; it must not pass that path as Vitest's --config. Exact HTTPS origin/workspaces, secret-store references, bounded fixture budget and isolated target classification are required. No embedded credentials, production fallback or redirects.

### Acceptance criteria and TDD
- [ ] First test missing/insecure/production/secret-bearing config fails before network; fake target classification cannot silently authorize a destination.
- [ ] Implement a source-controlled bounded scenario driven by the **built CLI processes**, not only native helper calls: Backlog → Ready → enrolled-runtime Claim → staged/uploaded/committed artifact → Submit Review → distinct second agent accepts Done.
- [ ] Run wrong-workspace/runtime and revoked-proof cases against server; induce controlled lost-response after commit, restart CLI, and prove exact-key/body journal reconciliation without duplicate transition.
- [ ] Verify real status/content-type/envelopes/request IDs, stdout redaction and process exit codes. Record committed artifact byte integrity and independent actor attribution.
- [ ] Execute the new command only after explicit isolated target/credentials/fixture cleanup authority; no authorization is granted by this plan. Capture exact source SHA, binary digest, runtime, redacted target/config identity, case counts and fixture cleanup outcome.
- [ ] On failure preserve receipts and uncertain intent; do not issue new cleanup effects until outcome is reconciled. Independent reviewer verifies actual HTTPS provenance and server state, not a mock receipt.
- [ ] Link exact immutable evidence to #49. Skipped live cases leave F24 unverified.

### Notes / gate
Hard #44; evidence #40; operational authorization/isolated configuration required. No production deploy, package publication or broader recovery rehearsal.

## Handoff contract for every task

Pick exactly one existing issue after its gates clear; read this section, that issue's live body, root AGENTS and producer receipts. State exclusive files before edits. Run the named red test with nonzero collection, implement minimal scoped change, rerun focused and integration checks, then request independent review. Record SHA/base, tests with counts and exit codes, type/schema changes, negative/restart evidence, remaining blockers and next task. A failing required gate pauses downstream pickup; do not weaken tests or claim completion from scaffolding. Keep `ai-handle` distinct from `ready to cook`; none of these plans presently authorizes implementation or promotion.
